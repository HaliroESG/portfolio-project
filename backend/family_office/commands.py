from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Mapping, TypeVar

from broker_ingest.fortuneo import parse_fortuneo_csv
from broker_ingest.ibkr import parse_ibkr_trades_csv
from broker_ingest.models import CanonicalTransaction
from broker_ingest.reconciliation import parse_broker_positions_csv

from .ledger import build_book
from .models import LedgerEvent
from .repository import FamilyOfficeRepository


T = TypeVar("T")


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def command_scope(payload: Mapping[str, Any]) -> dict[str, str]:
    serialized = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        default=str,
    )
    return {"request_sha256": hashlib.sha256(serialized.encode("utf-8")).hexdigest()}


def require_owned_portfolio(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    portfolio_id: str,
) -> dict[str, Any]:
    portfolio = repository.first(
        "fo_portfolios", filters={"id": portfolio_id, "owner_user_id": owner_user_id}
    )
    if portfolio is None:
        raise ValueError("Unknown portfolio")
    return portfolio


def require_owned_resource(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    table: str,
    resource_id: str,
    label: str,
    portfolio_required: bool = False,
) -> dict[str, Any]:
    resource = repository.first(
        table, filters={"id": resource_id, "owner_user_id": owner_user_id}
    )
    if resource is None:
        raise ValueError(f"Unknown {label}")
    portfolio_id = resource.get("portfolio_id")
    if portfolio_required and not portfolio_id:
        raise ValueError(f"Unknown {label} portfolio")
    if portfolio_id:
        require_owned_portfolio(
            repository,
            owner_user_id=owner_user_id,
            portfolio_id=str(portfolio_id),
        )
    return resource


def require_order_scope(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    decision_id: str,
    account_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    decision = require_owned_resource(
        repository,
        owner_user_id=owner_user_id,
        table="fo_decisions",
        resource_id=decision_id,
        label="decision",
        portfolio_required=True,
    )
    account = require_owned_resource(
        repository,
        owner_user_id=owner_user_id,
        table="fo_accounts",
        resource_id=account_id,
        label="account",
        portfolio_required=True,
    )
    if decision["portfolio_id"] != account["portfolio_id"]:
        raise ValueError("Decision and account must belong to the same portfolio")
    return decision, account


def _assert_matching_command(
    record: Mapping[str, Any],
    *,
    command_type: str,
    scope: Mapping[str, str],
) -> None:
    before_state = record.get("before_state")
    recorded_scope = (
        before_state.get("command_scope") if isinstance(before_state, Mapping) else None
    )
    if record.get("command_type") != command_type or recorded_scope != dict(scope):
        raise ValueError("Idempotency-Key does not match the original command request")


def execute_audited_command(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    command_id: str,
    command_type: str,
    scope: Mapping[str, str],
    authorize: Callable[[], Any],
    operation: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    authorize()
    existing = repository.existing_command(owner_user_id, command_id)
    if existing is not None:
        _assert_matching_command(existing, command_type=command_type, scope=scope)
        return dict(existing.get("after_state") or {})

    accepted = repository.existing_audit(owner_user_id, command_id, "ACCEPTED")
    failed = repository.existing_audit(owner_user_id, command_id, "FAILED")
    if accepted is not None:
        _assert_matching_command(accepted, command_type=command_type, scope=scope)
    if failed is not None:
        _assert_matching_command(failed, command_type=command_type, scope=scope)
    audit_scope = {"command_scope": dict(scope)}
    if accepted is None:
        repository.audit(
            owner_user_id=owner_user_id,
            command_id=command_id,
            command_type=command_type,
            status="ACCEPTED",
            before_state=audit_scope,
        )
    try:
        result = operation()
        repository.audit(
            owner_user_id=owner_user_id,
            command_id=command_id,
            command_type=command_type,
            status="COMPLETED",
            resource_type=result.get("resource_type"),
            resource_id=result.get("resource_id"),
            before_state=audit_scope,
            after_state=result,
        )
        return result
    except Exception as exc:
        if failed is None:
            repository.audit(
                owner_user_id=owner_user_id,
                command_id=command_id,
                command_type=command_type,
                status="FAILED",
                before_state=audit_scope,
                error=str(exc)[:2000],
            )
        else:
            repository.update(
                "fo_audit_log",
                {"error": str(exc)[:2000]},
                filters={"id": failed["id"], "owner_user_id": owner_user_id},
            )
        raise


def bootstrap_default_book(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    portfolio_name: str = "Patrimoine familial",
) -> dict[str, Any]:
    existing = repository.first("fo_portfolios", filters={"owner_user_id": owner_user_id})
    if existing:
        return {"resource_type": "portfolio", "resource_id": existing["id"], "portfolio": existing}

    entity = repository.insert(
        "fo_legal_entities",
        {
            "owner_user_id": owner_user_id,
            "name": "Patrimoine personnel",
            "entity_type": "PERSONAL",
            "tax_country": "FR",
        },
    )
    portfolio = repository.insert(
        "fo_portfolios",
        {
            "owner_user_id": owner_user_id,
            "legal_entity_id": entity["id"],
            "name": portfolio_name,
            "portfolio_type": "PERSONAL",
            "base_currency": "EUR",
        },
    )
    institutions: dict[str, dict[str, Any]] = {}
    for name, institution_type in (("Fortuneo", "BROKER"), ("Interactive Brokers", "BROKER"), ("Actifs déclaratifs", "OTHER")):
        institutions[name] = repository.insert(
            "fo_institutions",
            {
                "owner_user_id": owner_user_id,
                "name": name,
                "institution_type": institution_type,
                "country_code": "FR" if name != "Interactive Brokers" else "US",
            },
        )

    policy = repository.insert(
        "fo_ips_policies",
        {
            "owner_user_id": owner_user_id,
            "portfolio_id": portfolio["id"],
            "name": "Politique Core-Satellite 70/30",
            "effective_from": date.today().isoformat(),
            "core_target_pct": 70,
            "satellite_target_pct": 30,
            "minimum_cash_pct": 5,
            "drift_tolerance_pct": 3,
            "status": "ACTIVE",
        },
    )
    repository.insert_many(
        "fo_allocation_targets",
        [
            {
                "owner_user_id": owner_user_id,
                "policy_id": policy["id"],
                "bucket_key": "CORE_QUALITY",
                "bucket_label": "Core Quality",
                "target_weight_pct": 70,
                "lower_band_pct": 65,
                "upper_band_pct": 80,
                "preferred_envelope": "PEA",
            },
            {
                "owner_user_id": owner_user_id,
                "policy_id": policy["id"],
                "bucket_key": "SATELLITE_MACRO",
                "bucket_label": "Satellite Macro",
                "target_weight_pct": 30,
                "lower_band_pct": 20,
                "upper_band_pct": 35,
                "preferred_envelope": "CTO",
            },
        ],
    )
    return {
        "resource_type": "portfolio",
        "resource_id": portfolio["id"],
        "portfolio": portfolio,
        "institutions": institutions,
        "policy_id": policy["id"],
    }


def create_account(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    portfolio_id: str,
    institution_id: str,
    external_account_id: str,
    name: str,
    envelope: str,
    base_currency: str,
) -> dict[str, Any]:
    require_owned_portfolio(
        repository,
        owner_user_id=owner_user_id,
        portfolio_id=portfolio_id,
    )
    require_owned_resource(
        repository,
        owner_user_id=owner_user_id,
        table="fo_institutions",
        resource_id=institution_id,
        label="institution",
    )
    account = repository.insert(
        "fo_accounts",
        {
            "owner_user_id": owner_user_id,
            "portfolio_id": portfolio_id,
            "institution_id": institution_id,
            "external_account_id": external_account_id.strip(),
            "name": name.strip(),
            "envelope": envelope,
            "base_currency": base_currency.upper(),
        },
    )
    return {"resource_type": "account", "resource_id": account["id"], "account": account}


def _instrument_key(transaction: CanonicalTransaction) -> str | None:
    if transaction.isin:
        return f"isin:{transaction.isin.strip().upper()}"
    if transaction.symbol:
        return f"ticker:{transaction.symbol.strip().upper()}"
    return None


def _instrument_type(transaction: CanonicalTransaction) -> str:
    raw = (transaction.raw_type or "").upper()
    if "ETF" in raw:
        return "ETF"
    if "BOND" in raw:
        return "BOND"
    if "FUND" in raw:
        return "FUND"
    return "EQUITY"


def _resolve_instrument(
    repository: FamilyOfficeRepository,
    transaction: CanonicalTransaction,
) -> dict[str, Any] | None:
    key = _instrument_key(transaction)
    if key is None:
        return None
    existing = repository.first("fo_instruments", filters={"instrument_key": key})
    if existing:
        return existing
    resolved_ticker = transaction.symbol.strip().upper() if transaction.symbol else None
    if resolved_ticker is None and transaction.isin:
        mapping = repository.first(
            "instrument_identifier_map",
            "ticker",
            filters={"isin": transaction.isin.strip().upper()},
        )
        if mapping and mapping.get("ticker"):
            resolved_ticker = str(mapping["ticker"]).strip().upper()
    return repository.insert(
        "fo_instruments",
        {
            "instrument_key": key,
            "isin": transaction.isin.strip().upper() if transaction.isin else None,
            "ticker": resolved_ticker,
            "name": resolved_ticker or transaction.isin or "Instrument à qualifier",
            "instrument_type": _instrument_type(transaction),
            "currency": transaction.currency,
        },
    )


def _event_type_and_cash(transaction: CanonicalTransaction) -> tuple[str, Decimal]:
    net = transaction.net_amount
    if transaction.side == "BUY":
        return "BUY", -abs(net or transaction.gross_amount)
    if transaction.side == "SELL":
        return "SELL", abs(net or transaction.gross_amount)
    if transaction.side == "DIVIDEND":
        return "DIVIDEND", abs(net)
    if transaction.side == "INTEREST":
        return "INTEREST", abs(net)
    if transaction.side == "FEE":
        return "FEE", -abs(net or transaction.fees)
    if transaction.side == "TAX":
        return "TAX", -abs(net or transaction.taxes)
    return ("DEPOSIT", abs(net)) if net >= 0 else ("WITHDRAWAL", -abs(net))


def import_broker_transactions(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    account_id: str,
    broker: str,
    source_path: Path,
    source_name: str | None = None,
) -> dict[str, Any]:
    account = require_owned_resource(
        repository,
        owner_user_id=owner_user_id,
        table="fo_accounts",
        resource_id=account_id,
        label="account",
        portfolio_required=True,
    )

    parser = {"FORTUNEO": parse_fortuneo_csv, "IBKR": parse_ibkr_trades_csv}.get(broker.upper())
    if parser is None:
        raise ValueError("Broker must be FORTUNEO or IBKR")
    transactions = parser(source_path, account["external_account_id"], account["envelope"])
    source_sha256 = hashlib.sha256(source_path.read_bytes()).hexdigest()
    existing_run = repository.first(
        "fo_import_runs",
        filters={"account_id": account_id, "import_type": "TRANSACTIONS", "source_sha256": source_sha256},
    )
    if existing_run and existing_run["status"] in {"COMPLETED", "PARTIAL"}:
        return {
            "resource_type": "import_run",
            "resource_id": existing_run["id"],
            "import_run": existing_run,
            "inserted_count": 0,
            "duplicate": True,
        }

    run_payload = {
            "owner_user_id": owner_user_id,
            "account_id": account_id,
            "source_kind": broker.upper(),
            "import_type": "TRANSACTIONS",
            "source_file": source_name or source_path.name,
            "source_sha256": source_sha256,
            "status": "PENDING",
            "row_count": len(transactions),
            "accepted_count": 0,
            "rejected_count": 0,
            "report_json": {},
            "finished_at": None,
        }
    if existing_run:
        import_run = repository.update(
            "fo_import_runs", run_payload, filters={"id": existing_run["id"]}
        )
    else:
        import_run = repository.insert("fo_import_runs", run_payload)

    existing_entries = repository.select(
        "fo_ledger_entries",
        "idempotency_key",
        filters={"account_id": account_id},
    )
    known_keys = {row["idempotency_key"] for row in existing_entries}
    rows: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    duplicate_count = 0
    for transaction in transactions:
        idempotency_key = f"{broker.upper()}:{account_id}:{transaction.external_txn_id}"
        if idempotency_key in known_keys:
            duplicate_count += 1
            continue
        event_type, cash_amount = _event_type_and_cash(transaction)
        instrument = _resolve_instrument(repository, transaction)
        if event_type in {"BUY", "SELL"} and instrument is None:
            rejected.append({"external_entry_id": transaction.external_txn_id, "reason": "INSTRUMENT_MISSING"})
            continue
        rows.append(
            {
                "owner_user_id": owner_user_id,
                "account_id": account_id,
                "import_run_id": import_run["id"],
                "external_entry_id": transaction.external_txn_id,
                "event_type": event_type,
                "trade_date": transaction.trade_date.isoformat(),
                "settlement_date": transaction.settlement_date.isoformat() if transaction.settlement_date else None,
                "instrument_id": instrument["id"] if instrument else None,
                "quantity": str(abs(transaction.quantity)),
                "unit_price": str(transaction.price) if transaction.price is not None else None,
                "gross_amount": str(transaction.gross_amount),
                "fees": str(transaction.fees),
                "taxes": str(transaction.taxes),
                "cash_amount": str(cash_amount),
                "currency": transaction.currency,
                "description": transaction.raw_type,
                "source_payload": {
                    "broker": transaction.broker,
                    "symbol": transaction.symbol,
                    "isin": transaction.isin,
                    "envelope": transaction.envelope,
                },
                "idempotency_key": idempotency_key,
            }
        )
        known_keys.add(idempotency_key)
    inserted_count = repository.insert_many("fo_ledger_entries", rows) if rows else 0
    final_status = "PARTIAL" if rejected else "COMPLETED"
    final_run = repository.update(
        "fo_import_runs",
        {
            "status": final_status,
            "accepted_count": inserted_count,
            "rejected_count": len(rejected),
            "report_json": {
                "rejected": rejected,
                "parsed_count": len(transactions),
                "duplicate_count": duplicate_count,
            },
            "finished_at": _iso_now(),
        },
        filters={"id": import_run["id"]},
    )
    for item in rejected:
        repository.insert(
            "fo_exceptions",
            {
                "owner_user_id": owner_user_id,
                "portfolio_id": account["portfolio_id"],
                "account_id": account_id,
                "exception_type": "IMPORT_INSTRUMENT_MISSING",
                "severity": "CRITICAL",
                "title": "Instrument non identifié dans l'import broker",
                "details": item,
                "source_ref": f"import:{import_run['id']}:{item['external_entry_id']}",
            },
        )
    return {
        "resource_type": "import_run",
        "resource_id": import_run["id"],
        "import_run": final_run,
        "inserted_count": inserted_count,
        "rejected_count": len(rejected),
        "duplicate_count": duplicate_count,
        "duplicate": False,
    }


def _decimal(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    return Decimal(str(value))


def reconcile_broker_positions(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    account_id: str,
    broker: str,
    source_path: Path,
    source_name: str | None = None,
    reconciliation_date: date | None = None,
) -> dict[str, Any]:
    account = require_owned_resource(
        repository,
        owner_user_id=owner_user_id,
        table="fo_accounts",
        resource_id=account_id,
        label="account",
        portfolio_required=True,
    )
    target_date = reconciliation_date or date.today()
    source_sha256 = hashlib.sha256(source_path.read_bytes()).hexdigest()
    existing_import = repository.first(
        "fo_import_runs",
        filters={"account_id": account_id, "import_type": "POSITIONS", "source_sha256": source_sha256},
    )
    if existing_import and existing_import["status"] in {"COMPLETED", "PARTIAL"}:
        existing_run = repository.first(
            "fo_reconciliation_runs",
            filters={"account_id": account_id, "import_run_id": existing_import["id"]},
        )
        return {
            "resource_type": "reconciliation_run",
            "resource_id": existing_run["id"] if existing_run else existing_import["id"],
            "reconciliation": existing_run,
            "duplicate": True,
        }

    broker_positions = parse_broker_positions_csv(source_path)
    import_payload = {
            "owner_user_id": owner_user_id,
            "account_id": account_id,
            "source_kind": broker.upper(),
            "import_type": "POSITIONS",
            "source_file": source_name or source_path.name,
            "source_sha256": source_sha256,
            "as_of_date": target_date.isoformat(),
            "status": "PENDING",
            "row_count": len(broker_positions),
            "accepted_count": 0,
            "rejected_count": 0,
            "report_json": {},
            "finished_at": None,
        }
    if existing_import:
        import_run = repository.update(
            "fo_import_runs", import_payload, filters={"id": existing_import["id"]}
        )
    else:
        import_run = repository.insert("fo_import_runs", import_payload)
    instruments = repository.select("fo_instruments")
    instrument_by_id = {str(row["id"]): row for row in instruments}
    instrument_by_key: dict[str, dict[str, Any]] = {}
    for instrument in instruments:
        if instrument.get("isin"):
            instrument_by_key[f"isin:{str(instrument['isin']).upper()}"] = instrument
        if instrument.get("ticker"):
            instrument_by_key[f"ticker:{str(instrument['ticker']).upper()}"] = instrument

    ledger_rows = repository.select(
        "fo_ledger_entries", filters={"account_id": account_id}, order="trade_date"
    )
    ledger_events = [
        LedgerEvent(
            id=str(row["id"]),
            account_id=account_id,
            portfolio_id=str(account["portfolio_id"]),
            event_type=str(row["event_type"]),
            trade_date=date.fromisoformat(str(row["trade_date"])),
            currency=str(row["currency"]),
            cash_amount=_decimal(row["cash_amount"]),
            instrument_id=str(row["instrument_id"]) if row.get("instrument_id") else None,
            quantity=_decimal(row.get("quantity")),
            gross_amount=_decimal(row.get("gross_amount")),
            fees=_decimal(row.get("fees")),
            taxes=_decimal(row.get("taxes")),
            fx_rate_to_eur=Decimal(str(row["fx_rate_to_eur"])) if row.get("fx_rate_to_eur") else None,
            created_at=str(row.get("created_at") or ""),
        )
        for row in ledger_rows
        if date.fromisoformat(str(row["trade_date"])) <= target_date
    ]
    book = build_book(ledger_events)
    ledger_by_instrument = {position.instrument_id: position for position in book.positions}
    matched_instruments: set[str] = set()
    item_rows: list[dict[str, Any]] = []
    state_counts: dict[str, int] = {}

    for position in broker_positions:
        key = (
            f"isin:{position.isin.strip().upper()}"
            if position.isin
            else f"ticker:{position.symbol.strip().upper()}"
            if position.symbol
            else "unknown"
        )
        instrument = instrument_by_key.get(key)
        ledger_position = ledger_by_instrument.get(str(instrument["id"])) if instrument else None
        ledger_quantity = ledger_position.quantity if ledger_position else Decimal("0")
        ledger_cost = ledger_position.average_cost if ledger_position else None
        quantity_delta = ledger_quantity - position.quantity
        if instrument is None:
            state = "MISSING_IN_LEDGER"
        elif abs(quantity_delta) > Decimal("0.000001"):
            state = "MISMATCH_QTY"
        elif position.average_cost is not None and ledger_cost is not None and abs(position.average_cost - ledger_cost) > Decimal("0.01"):
            state = "MISMATCH_COST"
        else:
            state = "MATCH"
        if instrument:
            matched_instruments.add(str(instrument["id"]))
        state_counts[state] = state_counts.get(state, 0) + 1
        item_rows.append(
            {
                "owner_user_id": owner_user_id,
                "instrument_id": instrument["id"] if instrument else None,
                "state": state,
                "ledger_quantity": str(ledger_quantity),
                "broker_quantity": str(position.quantity),
                "quantity_delta": str(quantity_delta),
                "ledger_average_cost": str(ledger_cost) if ledger_cost is not None else None,
                "broker_average_cost": str(position.average_cost) if position.average_cost is not None else None,
                "details": {
                    "instrument_key": key,
                    "symbol": position.symbol,
                    "isin": position.isin,
                    "currency": position.currency,
                    "source_row": position.source_row,
                },
            }
        )

    for instrument_id, ledger_position in ledger_by_instrument.items():
        if instrument_id in matched_instruments or ledger_position.quantity == 0:
            continue
        instrument = instrument_by_id.get(instrument_id, {})
        state_counts["LEDGER_ONLY"] = state_counts.get("LEDGER_ONLY", 0) + 1
        item_rows.append(
            {
                "owner_user_id": owner_user_id,
                "instrument_id": instrument_id,
                "state": "LEDGER_ONLY",
                "ledger_quantity": str(ledger_position.quantity),
                "broker_quantity": "0",
                "quantity_delta": str(ledger_position.quantity),
                "ledger_average_cost": str(ledger_position.average_cost) if ledger_position.average_cost is not None else None,
                "broker_average_cost": None,
                "details": {"ticker": instrument.get("ticker"), "isin": instrument.get("isin")},
            }
        )

    status = "MATCH" if all(row["state"] == "MATCH" for row in item_rows) else "MISMATCH"
    reconciliation = repository.insert(
        "fo_reconciliation_runs",
        {
            "owner_user_id": owner_user_id,
            "account_id": account_id,
            "import_run_id": import_run["id"],
            "reconciliation_date": target_date.isoformat(),
            "status": status,
            "state_counts": state_counts,
        },
    )
    for row in item_rows:
        row["run_id"] = reconciliation["id"]
    if item_rows:
        repository.insert_many("fo_reconciliation_items", item_rows)
    repository.update(
        "fo_import_runs",
        {
            "status": "COMPLETED" if status == "MATCH" else "PARTIAL",
            "accepted_count": len(item_rows),
            "rejected_count": sum(count for state, count in state_counts.items() if state != "MATCH"),
            "report_json": {"reconciliation_status": status, "state_counts": state_counts},
            "finished_at": _iso_now(),
        },
        filters={"id": import_run["id"]},
    )
    if status != "MATCH":
        repository.insert(
            "fo_exceptions",
            {
                "owner_user_id": owner_user_id,
                "portfolio_id": account["portfolio_id"],
                "account_id": account_id,
                "exception_type": "BROKER_RECONCILIATION_MISMATCH",
                "severity": "CRITICAL",
                "title": f"Écart de rapprochement {broker.upper()}",
                "details": {"run_id": reconciliation["id"], "state_counts": state_counts},
                "source_ref": f"reconciliation:{reconciliation['id']}",
            },
        )
    else:
        for exception_status in ("OPEN", "ACKNOWLEDGED"):
            prior_exceptions = repository.select(
                "fo_exceptions",
                "id",
                filters={
                    "owner_user_id": owner_user_id,
                    "account_id": account_id,
                    "exception_type": "BROKER_RECONCILIATION_MISMATCH",
                    "status": exception_status,
                },
            )
            for exception in prior_exceptions:
                repository.update(
                    "fo_exceptions",
                    {"status": "RESOLVED", "resolved_at": _iso_now()},
                    filters={"id": exception["id"]},
                )
    return {
        "resource_type": "reconciliation_run",
        "resource_id": reconciliation["id"],
        "reconciliation": reconciliation,
        "state_counts": state_counts,
        "duplicate": False,
    }


def create_manual_holding(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    portfolio_id = str(payload.get("portfolio_id") or "")
    require_owned_portfolio(
        repository,
        owner_user_id=owner_user_id,
        portfolio_id=portfolio_id,
    )
    holding = repository.insert("fo_manual_holdings", {"owner_user_id": owner_user_id, **payload})
    return {"resource_type": "manual_holding", "resource_id": holding["id"], "holding": holding}


def add_manual_valuation(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    holding_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    require_owned_resource(
        repository,
        owner_user_id=owner_user_id,
        table="fo_manual_holdings",
        resource_id=holding_id,
        label="manual holding",
        portfolio_required=True,
    )
    valuation = repository.insert(
        "fo_manual_valuations",
        {"owner_user_id": owner_user_id, "holding_id": holding_id, **payload},
    )
    return {"resource_type": "manual_valuation", "resource_id": valuation["id"], "valuation": valuation}


def prepare_monthly_close(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    portfolio_id: str,
    period_end: date,
    finalize: bool,
) -> dict[str, Any]:
    portfolio = require_owned_portfolio(
        repository,
        owner_user_id=owner_user_id,
        portfolio_id=portfolio_id,
    )
    existing = repository.first(
        "fo_monthly_closes",
        filters={
            "owner_user_id": owner_user_id,
            "portfolio_id": portfolio_id,
            "period_end": period_end.isoformat(),
        },
    )
    if existing and existing["status"] == "CLOSED":
        return {
            "resource_type": "monthly_close",
            "resource_id": existing["id"],
            "monthly_close": existing,
        }

    performance_rows = repository.select(
        "fo_performance_daily",
        filters={"portfolio_id": portfolio_id},
        order="performance_date",
    )
    performance = next(
        (
            row
            for row in reversed(performance_rows)
            if str(row["performance_date"]) <= period_end.isoformat()
        ),
        None,
    )
    risk_rows = repository.select(
        "fo_risk_daily", filters={"portfolio_id": portfolio_id}, order="risk_date"
    )
    risk = next(
        (row for row in reversed(risk_rows) if str(row["risk_date"]) <= period_end.isoformat()),
        None,
    )
    positions = repository.select(
        "fo_position_snapshots",
        filters={"portfolio_id": portfolio_id, "snapshot_date": period_end.isoformat()},
    )
    instruments = {
        str(row["id"]): row
        for row in repository.select(
            "fo_instruments", "id,instrument_key,isin,ticker,name,instrument_type,currency"
        )
    }
    positions = [
        {**instruments.get(str(row["instrument_id"]), {}), **row}
        for row in positions
    ]
    cash = repository.select(
        "fo_cash_balances_daily",
        filters={"portfolio_id": portfolio_id, "balance_date": period_end.isoformat()},
    )

    manual_holdings: list[dict[str, Any]] = []
    for holding in repository.select(
        "fo_manual_holdings", filters={"portfolio_id": portfolio_id, "status": "ACTIVE"}
    ):
        valuations = repository.select(
            "fo_manual_valuations",
            filters={"holding_id": holding["id"]},
            order="valuation_date",
        )
        valuation = next(
            (
                row
                for row in reversed(valuations)
                if str(row["valuation_date"]) <= period_end.isoformat()
            ),
            None,
        )
        manual_holdings.append({**holding, **(valuation or {}), "holding_id": holding["id"]})

    exceptions: list[dict[str, Any]] = []
    for exception_status in ("OPEN", "ACKNOWLEDGED"):
        exceptions.extend(
            row
            for row in repository.select(
                "fo_exceptions",
                filters={"portfolio_id": portfolio_id, "status": exception_status},
                order="detected_at",
                descending=True,
            )
            if str(row["detected_at"])[:10] <= period_end.isoformat()
        )
    critical = [row for row in exceptions if row["severity"] == "CRITICAL"]
    coverage = float(performance.get("coverage_pct") or 0) if performance else 0.0
    performance_state = str(performance.get("data_state") or "MISSING") if performance else "MISSING"
    checks = {
        "period_valuation_present": performance is not None and performance.get("nav_eur") is not None,
        "coverage_ready": coverage >= 100,
        "performance_ready": performance_state == "READY",
        "critical_exceptions_clear": len(critical) == 0,
    }
    can_close = all(checks.values())
    close_status = "CLOSED" if finalize and can_close else ("BLOCKED" if finalize else "DRAFT")
    reconciliation_state = (
        "MATCH"
        if performance_state == "READY"
        else "MISMATCH"
        if any(row.get("reconciliation_state") == "MISMATCH" for row in positions)
        else "NOT_CHECKED"
    )
    report = {
        "version": 1,
        "generated_at": _iso_now(),
        "portfolio": portfolio,
        "positions": positions,
        "cash": cash,
        "manual_holdings": manual_holdings,
        "performance": [performance] if performance else [],
        "risk": risk,
        "exceptions": exceptions,
    }
    payload = {
        "owner_user_id": owner_user_id,
        "portfolio_id": portfolio_id,
        "period_end": period_end.isoformat(),
        "status": close_status,
        "nav_eur": performance.get("nav_eur") if performance else None,
        "coverage_pct": coverage,
        "open_exception_count": len(exceptions),
        "reconciliation_state": reconciliation_state,
        "checks_json": checks,
        "report_json": report,
        "closed_at": _iso_now() if close_status == "CLOSED" else None,
    }
    repository.upsert_many("fo_monthly_closes", [payload], "portfolio_id,period_end")
    close = repository.first(
        "fo_monthly_closes",
        filters={
            "owner_user_id": owner_user_id,
            "portfolio_id": portfolio_id,
            "period_end": period_end.isoformat(),
        },
    )
    if close is None:
        raise RuntimeError("Monthly close upsert returned no row")
    return {
        "resource_type": "monthly_close",
        "resource_id": close["id"],
        "monthly_close": close,
    }


VALID_DECISION_TRANSITIONS = {
    "DRAFT": {"VALIDATED", "CANCELLED"},
    "VALIDATED": {"EXPORTED", "CANCELLED"},
    "EXPORTED": {"EXECUTED", "CANCELLED"},
    "EXECUTED": {"RECONCILED"},
    "RECONCILED": set(),
    "CANCELLED": set(),
}


def transition_decision(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    decision_id: str,
    target_status: str,
) -> dict[str, Any]:
    decision = require_owned_resource(
        repository,
        owner_user_id=owner_user_id,
        table="fo_decisions",
        resource_id=decision_id,
        label="decision",
        portfolio_required=True,
    )
    current = decision["status"]
    if target_status not in VALID_DECISION_TRANSITIONS.get(current, set()):
        raise ValueError(f"Invalid decision transition {current} -> {target_status}")
    timestamps: dict[str, Any] = {"updated_at": _iso_now()}
    if target_status == "VALIDATED":
        timestamps["validated_at"] = _iso_now()
    elif target_status == "EXECUTED":
        timestamps["executed_at"] = _iso_now()
    elif target_status == "RECONCILED":
        timestamps["reconciled_at"] = _iso_now()
    updated = repository.update(
        "fo_decisions",
        {"status": target_status, **timestamps},
        filters={"id": decision_id, "owner_user_id": owner_user_id},
    )
    return {"resource_type": "decision", "resource_id": decision_id, "decision": updated}
