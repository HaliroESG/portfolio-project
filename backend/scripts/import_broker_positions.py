from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

CURRENT_DIR = os.path.dirname(__file__)
BACKEND_ROOT = os.path.dirname(CURRENT_DIR)
sys.path.append(BACKEND_ROOT)

from broker_ingest.reconciliation import BrokerPosition, parse_broker_positions_csv  # noqa: E402
from supabase_key_guard import require_backend_supabase_key  # noqa: E402


SUPPORTED_BROKERS = {"fortuneo", "ibkr", "linxea", "manual"}


@dataclass
class AggregatedPosition:
    portfolio_id: str
    ticker: str
    quantity: Decimal = Decimal("0")
    weighted_cost_total: Decimal = Decimal("0")
    weighted_cost_quantity: Decimal = Decimal("0")
    isin: str | None = None
    name: str | None = None
    currency: str | None = None
    sources: list[dict[str, Any]] = field(default_factory=list)

    @property
    def pru(self) -> Decimal | None:
        if self.weighted_cost_quantity == 0:
            return None
        return self.weighted_cost_total / self.weighted_cost_quantity


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required for non-dry-run broker position imports")
    return value


def _build_supabase_client() -> Any:
    from supabase import create_client

    return create_client(_required_env("SUPABASE_URL"), require_backend_supabase_key(os.environ))


def _response_data(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", response.get("data") if isinstance(response, dict) else None)
    return data or []


def _decimal_to_json(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value.normalize(), "f")


def _parse_as_of_date(value: str | None) -> date:
    if not value:
        return date.today()
    return datetime.strptime(value, "%Y-%m-%d").date()


def _clean_upper(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip().upper().replace(" ", "")
    return cleaned or None


def _snapshot_idempotency_key(
    *,
    broker: str,
    account_id: str,
    portfolio_id: str,
    envelope: str | None,
    as_of_date: date,
    source_file: str,
) -> str:
    envelope_key = envelope or "-"
    return f"{broker.upper()}:{account_id}:{portfolio_id}:{envelope_key}:{as_of_date.isoformat()}:{source_file}"


def _position_payload(position: BrokerPosition) -> dict[str, Any]:
    return {
        "symbol": _clean_upper(position.symbol),
        "isin": _clean_upper(position.isin),
        "name": position.name,
        "quantity": _decimal_to_json(position.quantity),
        "average_cost": _decimal_to_json(position.average_cost),
        "currency": _clean_upper(position.currency),
        "source_row": position.source_row,
    }


def _snapshot_preview(positions: list[BrokerPosition]) -> list[dict[str, Any]]:
    return [_position_payload(position) for position in positions]


def resolve_ticker_from_isin(supabase_client: Any, isin: str) -> str | None:
    response = (
        supabase_client
        .table("instrument_identifier_map")
        .select("ticker")
        .eq("isin", isin)
        .limit(1)
        .execute()
    )
    rows = _response_data(response)
    if not rows:
        return None
    return _clean_upper(str(rows[0].get("ticker") or ""))


def _resolve_ticker_for_item(item: dict[str, Any], supabase_client: Any | None) -> tuple[str | None, str | None]:
    symbol = _clean_upper(str(item.get("symbol") or "")) if item.get("symbol") is not None else None
    isin = _clean_upper(str(item.get("isin") or "")) if item.get("isin") is not None else None
    if isin and supabase_client is not None:
        try:
            ticker = resolve_ticker_from_isin(supabase_client, isin)
        except Exception as exc:
            if symbol:
                return symbol, f"ISIN resolution failed for {isin}; fell back to symbol {symbol}: {exc}"
            return None, f"ISIN resolution failed for {isin}: {exc}"
        if ticker:
            return ticker, None
    if symbol:
        return symbol, None
    if not isin:
        return None, "missing symbol and isin"
    if supabase_client is None:
        return None, f"ticker missing and ISIN {isin} cannot be resolved without Supabase"
    return None, f"ticker missing and ISIN {isin} could not be resolved"


def _read_latest_snapshot_runs(supabase_client: Any, portfolio_id: str) -> list[dict[str, Any]]:
    response = (
        supabase_client
        .table("broker_position_snapshot_runs")
        .select("id,broker,account_id,portfolio_id,envelope,as_of_date,source_file,position_count,created_at,updated_at")
        .eq("portfolio_id", portfolio_id)
        .order("as_of_date", desc=True)
        .order("created_at", desc=True)
        .limit(10000)
        .execute()
    )
    rows = _response_data(response)
    latest: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in rows:
        key = (
            str(row.get("broker") or "").upper(),
            str(row.get("account_id") or ""),
            str(row.get("envelope") or ""),
        )
        if key not in latest:
            latest[key] = row
    return list(latest.values())


def _read_snapshot_items(supabase_client: Any, run_ids: list[str]) -> list[dict[str, Any]]:
    if not run_ids:
        return []
    response = (
        supabase_client
        .table("broker_position_snapshot_items")
        .select(
            "run_id,portfolio_id,broker,account_id,envelope,as_of_date,"
            "symbol,isin,name,currency,quantity,average_cost,source_row"
        )
        .in_("run_id", run_ids)
        .execute()
    )
    return _response_data(response)


def _decimal_from_row(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    text = str(value).strip().replace("\u00a0", "").replace(" ", "").replace(",", ".")
    if not text or text == "-":
        return Decimal("0")
    return Decimal(text)


def _optional_decimal_from_row(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    text = str(value).strip().replace("\u00a0", "").replace(" ", "").replace(",", ".")
    if not text or text == "-":
        return None
    return Decimal(text)


def _extract_parenthesized_symbol(label: str | None) -> str | None:
    if not label:
        return None
    match = re.search(r"\(([^()]*)\)\s*$", label.strip())
    if not match:
        return None
    symbol = match.group(1).strip()
    return None if not symbol or symbol == "-" else _clean_upper(symbol)


def _rows_from_ibkr_portfolio_analyst_csv(path: str | Path) -> list[BrokerPosition]:
    positions: list[BrokerPosition] = []
    header: list[str] | None = None
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        for raw_row in reader:
            if len(raw_row) >= 3 and raw_row[0] == "Open Position Summary" and raw_row[1] == "Header":
                header = raw_row[2:]
                continue
            if header is None:
                continue
            if len(raw_row) >= 2 and raw_row[1] == "Header":
                break
            if len(raw_row) < 3 or raw_row[0] != "Open Position Summary" or raw_row[1] != "Data":
                continue

            payload = dict(zip(header, raw_row[2:]))
            if payload.get("Date") == "Total":
                continue
            quantity = _decimal_from_row(payload.get("Quantity"))
            if quantity == 0:
                continue

            instrument = str(payload.get("FinancialInstrument") or "").strip()
            currency = _clean_upper(payload.get("Currency"))
            symbol = _clean_upper(payload.get("Symbol"))
            cost_basis = _optional_decimal_from_row(payload.get("Cost Basis"))
            average_cost = None
            if instrument.lower() == "cash":
                average_cost = Decimal("1")
                symbol = currency
            elif cost_basis is not None and quantity != 0:
                average_cost = cost_basis / quantity

            positions.append(
                BrokerPosition(
                    symbol=symbol,
                    isin=None,
                    quantity=quantity,
                    average_cost=average_cost,
                    currency=currency,
                    name=str(payload.get("Description") or "").strip() or None,
                )
            )
    return positions


def _positions_from_fortuneo_dataframe(frame: Any) -> list[BrokerPosition]:
    header_index = None
    for idx, row in frame.iterrows():
        values = [str(value).strip() for value in row.tolist()]
        if "Libellé" in values:
            header_index = idx
            break
    if header_index is None:
        raise RuntimeError("Fortuneo positions file does not contain a Libellé header row")

    headers = [str(value).strip() if str(value) != "nan" else "" for value in frame.iloc[header_index].tolist()]
    positions: list[BrokerPosition] = []
    for row_number, row in frame.iloc[header_index + 1 :].iterrows():
        payload = {headers[i]: row.iloc[i] for i in range(min(len(headers), len(row))) if headers[i]}
        label = str(payload.get("Libellé") or "").strip()
        if not label or label == "nan" or label == "Solde position CPT":
            continue
        quantity = _decimal_from_row(payload.get("Qté"))
        if quantity == 0:
            continue
        positions.append(
            BrokerPosition(
                symbol=_extract_parenthesized_symbol(label),
                isin=_clean_upper(str(payload.get("ISIN") or "")),
                quantity=quantity,
                average_cost=_optional_decimal_from_row(payload.get("PRU")),
                currency=_clean_upper(str(payload.get("Dev") or "")) or "EUR",
                name=label,
                source_row=int(row_number) + 1,
            )
        )
    return positions


def _positions_from_linxea_dataframe(frame: Any) -> list[BrokerPosition]:
    positions: list[BrokerPosition] = []
    for row_number, row in frame.iterrows():
        name = str(row.get("Nom du support") or "").strip()
        isin = _clean_upper(str(row.get("ISIN") or ""))
        quantity = _decimal_from_row(row.get("Nbre de parts"))
        if not name or not isin or quantity == 0:
            continue
        positions.append(
            BrokerPosition(
                symbol=None,
                isin=isin,
                quantity=quantity,
                average_cost=_optional_decimal_from_row(row.get("Prix de Revient Moyen")),
                currency="EUR",
                name=name,
                source_row=int(row_number) + 2,
            )
        )
    return positions


def parse_positions_file(path: str | Path, *, broker: str) -> list[BrokerPosition]:
    source = Path(path)
    broker_key = broker.lower()
    suffix = source.suffix.lower()

    if broker_key == "ibkr" and suffix == ".csv":
        positions = _rows_from_ibkr_portfolio_analyst_csv(source)
        if positions:
            return positions

    if broker_key == "fortuneo" and suffix in {".xls", ".xlsx"}:
        import pandas as pd

        frame = pd.read_excel(source, sheet_name=0, header=None)
        return _positions_from_fortuneo_dataframe(frame)

    if broker_key == "linxea" and suffix in {".xls", ".xlsx"}:
        import pandas as pd

        frame = pd.read_excel(source, sheet_name=0)
        return _positions_from_linxea_dataframe(frame)

    return parse_broker_positions_csv(source)


def aggregate_snapshot_items(
    items: list[dict[str, Any]],
    *,
    supabase_client: Any | None = None,
) -> tuple[dict[str, AggregatedPosition], list[str]]:
    aggregated: dict[str, AggregatedPosition] = {}
    warnings: list[str] = []

    for item in items:
        ticker, warning = _resolve_ticker_for_item(item, supabase_client)
        if warning:
            warnings.append(f"row {item.get('source_row') or '?'}: {warning}")
        if not ticker:
            continue

        portfolio_id = str(item.get("portfolio_id") or "")
        quantity = _decimal_from_row(item.get("quantity"))
        average_cost = item.get("average_cost")
        aggregate = aggregated.setdefault(
            ticker,
            AggregatedPosition(portfolio_id=portfolio_id, ticker=ticker),
        )
        aggregate.quantity += quantity
        aggregate.isin = aggregate.isin or _clean_upper(str(item.get("isin") or ""))
        aggregate.name = aggregate.name or (str(item.get("name")).strip() if item.get("name") else None)
        aggregate.currency = aggregate.currency or _clean_upper(str(item.get("currency") or ""))
        aggregate.sources.append({
            "broker": str(item.get("broker") or "").upper(),
            "account_id": item.get("account_id"),
            "envelope": item.get("envelope"),
            "as_of_date": item.get("as_of_date"),
            "quantity": _decimal_to_json(quantity),
        })
        if average_cost is not None and average_cost != "" and quantity != 0:
            quantity_abs = abs(quantity)
            aggregate.weighted_cost_total += _decimal_from_row(average_cost) * quantity_abs
            aggregate.weighted_cost_quantity += quantity_abs

    return aggregated, warnings


def _existing_positions(supabase_client: Any, portfolio_id: str) -> dict[str, dict[str, Any]]:
    response = (
        supabase_client
        .table("portfolio_positions")
        .select("ticker,target_weight_pct,actual_source")
        .eq("portfolio_id", portfolio_id)
        .execute()
    )
    return {str(row["ticker"]).upper(): row for row in _response_data(response) if row.get("ticker")}


def _position_update_payload(position: AggregatedPosition, *, now_iso: str) -> dict[str, Any]:
    as_of_dates = [source.get("as_of_date") for source in position.sources if source.get("as_of_date")]
    payload: dict[str, Any] = {
        "quantity_current": _decimal_to_json(position.quantity),
        "actual_source": "broker_snapshot",
        "actual_source_accounts": position.sources,
        "actual_as_of_date": max(as_of_dates) if as_of_dates else None,
        "actual_updated_at": now_iso,
        "updated_at": now_iso,
    }
    if position.pru is not None:
        payload["pru"] = _decimal_to_json(position.pru)
    if position.name:
        payload["name"] = position.name
    if position.currency:
        payload["currency"] = position.currency
    if position.isin:
        payload["isin"] = position.isin
    return payload


def sync_portfolio_positions_from_snapshots(
    supabase_client: Any,
    *,
    portfolio_id: str,
) -> dict[str, Any]:
    latest_runs = _read_latest_snapshot_runs(supabase_client, portfolio_id)
    run_ids = [str(row["id"]) for row in latest_runs if row.get("id")]
    items = _read_snapshot_items(supabase_client, run_ids)
    aggregated, warnings = aggregate_snapshot_items(items, supabase_client=supabase_client)
    existing = _existing_positions(supabase_client, portfolio_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    updated: list[dict[str, Any]] = []
    inserted: list[dict[str, Any]] = []
    zeroed: list[dict[str, Any]] = []

    for ticker, position in sorted(aggregated.items()):
        if position.quantity == 0 and ticker not in existing:
            continue
        payload = _position_update_payload(position, now_iso=now_iso)
        if ticker in existing:
            (
                supabase_client
                .table("portfolio_positions")
                .update(payload)
                .eq("portfolio_id", portfolio_id)
                .eq("ticker", ticker)
                .execute()
            )
            updated.append({"ticker": ticker, "quantity_current": _decimal_to_json(position.quantity)})
            continue

        insert_payload = {
            **payload,
            "portfolio_id": portfolio_id,
            "ticker": ticker,
        }
        supabase_client.table("portfolio_positions").insert(insert_payload).execute()
        inserted.append({"ticker": ticker, "quantity_current": _decimal_to_json(position.quantity)})

    stale_actual_tickers = [
        ticker
        for ticker, row in existing.items()
        if row.get("actual_source") == "broker_snapshot" and ticker not in aggregated
    ]
    for ticker in stale_actual_tickers:
        payload = {
            "quantity_current": "0",
            "actual_source": "broker_snapshot",
            "actual_source_accounts": [],
            "actual_updated_at": now_iso,
            "updated_at": now_iso,
        }
        (
            supabase_client
            .table("portfolio_positions")
            .update(payload)
            .eq("portfolio_id", portfolio_id)
            .eq("ticker", ticker)
            .execute()
        )
        zeroed.append({"ticker": ticker, "quantity_current": "0"})

    return {
        "latest_runs": len(latest_runs),
        "snapshot_items": len(items),
        "updated": updated,
        "inserted": inserted,
        "zeroed": zeroed,
        "warnings": warnings,
    }


def _persist_snapshot_run(
    supabase_client: Any,
    *,
    broker: str,
    account_id: str,
    portfolio_id: str,
    envelope: str | None,
    as_of_date: date,
    source_file: str,
    positions: list[BrokerPosition],
    report_json: dict[str, Any],
) -> str:
    idempotency_key = _snapshot_idempotency_key(
        broker=broker,
        account_id=account_id,
        portfolio_id=portfolio_id,
        envelope=envelope,
        as_of_date=as_of_date,
        source_file=source_file,
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    payload = {
        "broker": broker.upper(),
        "account_id": account_id,
        "portfolio_id": portfolio_id,
        "envelope": envelope,
        "as_of_date": as_of_date.isoformat(),
        "source_file": source_file,
        "position_count": len(positions),
        "idempotency_key": idempotency_key,
        "report_json": report_json,
        "updated_at": now_iso,
    }
    response = (
        supabase_client
        .table("broker_position_snapshot_runs")
        .upsert(payload, on_conflict="idempotency_key")
        .execute()
    )
    rows = _response_data(response)
    if rows and rows[0].get("id"):
        return str(rows[0]["id"])

    lookup = (
        supabase_client
        .table("broker_position_snapshot_runs")
        .select("id")
        .eq("idempotency_key", idempotency_key)
        .limit(1)
        .execute()
    )
    lookup_rows = _response_data(lookup)
    if not lookup_rows:
        raise RuntimeError("Snapshot run upsert did not return an id and lookup failed")
    return str(lookup_rows[0]["id"])


def _persist_snapshot_items(
    supabase_client: Any,
    *,
    run_id: str,
    broker: str,
    account_id: str,
    portfolio_id: str,
    envelope: str | None,
    as_of_date: date,
    positions: list[BrokerPosition],
) -> int:
    (
        supabase_client
        .table("broker_position_snapshot_items")
        .delete()
        .eq("run_id", run_id)
        .execute()
    )
    payloads = []
    for position in positions:
        payloads.append({
            "run_id": run_id,
            "portfolio_id": portfolio_id,
            "broker": broker.upper(),
            "account_id": account_id,
            "envelope": envelope,
            "as_of_date": as_of_date.isoformat(),
            **_position_payload(position),
        })
    if not payloads:
        return 0
    supabase_client.table("broker_position_snapshot_items").insert(payloads).execute()
    return len(payloads)


def run_import(
    *,
    broker: str,
    account_id: str,
    portfolio_id: str,
    positions_file: str | Path,
    envelope: str | None = None,
    as_of_date: date | None = None,
    dry_run: bool = True,
    supabase_client: Any | None = None,
) -> dict[str, Any]:
    broker_key = broker.lower()
    if broker_key not in SUPPORTED_BROKERS:
        supported = ", ".join(sorted(SUPPORTED_BROKERS))
        raise RuntimeError(f"Unsupported broker '{broker}'. Supported brokers: {supported}")

    path = Path(positions_file)
    snapshot_date = as_of_date or date.today()
    positions = parse_positions_file(path, broker=broker_key)
    base_report = {
        "ok": True,
        "dry_run": dry_run,
        "broker": broker_key.upper(),
        "account_id": account_id,
        "portfolio_id": portfolio_id,
        "envelope": envelope,
        "as_of_date": snapshot_date.isoformat(),
        "source_file": path.name,
        "positions_read": len(positions),
        "positions_accepted": len(positions),
        "positions_skipped": 0,
        "snapshot_preview": _snapshot_preview(positions[:25]),
        "warnings": [],
    }
    if dry_run:
        return {
            **base_report,
            "snapshot_run_id": None,
            "items_persisted": 0,
            "portfolio_sync": {
                "updated": [],
                "inserted": [],
                "zeroed": [],
                "warnings": ["dry run: Supabase was not written"],
            },
        }

    client = supabase_client or _build_supabase_client()
    run_id = _persist_snapshot_run(
        client,
        broker=broker_key,
        account_id=account_id,
        portfolio_id=portfolio_id,
        envelope=envelope,
        as_of_date=snapshot_date,
        source_file=path.name,
        positions=positions,
        report_json=base_report,
    )
    items_persisted = _persist_snapshot_items(
        client,
        run_id=run_id,
        broker=broker_key,
        account_id=account_id,
        portfolio_id=portfolio_id,
        envelope=envelope,
        as_of_date=snapshot_date,
        positions=positions,
    )
    portfolio_sync = sync_portfolio_positions_from_snapshots(client, portfolio_id=portfolio_id)
    return {
        **base_report,
        "snapshot_run_id": run_id,
        "items_persisted": items_persisted,
        "portfolio_sync": portfolio_sync,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import broker position snapshot into Supabase")
    parser.add_argument("--broker", required=True, choices=sorted(SUPPORTED_BROKERS))
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--portfolio-id", required=True)
    parser.add_argument("--envelope", default=None, help="Optional account envelope, for example PEA or CTO")
    parser.add_argument("--as-of-date", default=None, help="Snapshot date, formatted YYYY-MM-DD")
    parser.add_argument("--positions-file", required=True, help="Broker positions snapshot CSV")
    parser.add_argument("--dry-run", action="store_true", help="Parse and report without writing Supabase")
    parser.add_argument("--apply", action="store_true", help="Persist snapshot and consolidate portfolio_positions")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON report")
    args = parser.parse_args()
    if args.dry_run and args.apply:
        parser.error("--dry-run and --apply are mutually exclusive")
    if not args.dry_run and not args.apply:
        args.dry_run = True
    return args


def main() -> int:
    args = _parse_args()
    try:
        report = run_import(
            broker=args.broker,
            account_id=args.account_id,
            portfolio_id=args.portfolio_id,
            envelope=args.envelope,
            as_of_date=_parse_as_of_date(args.as_of_date),
            positions_file=args.positions_file,
            dry_run=args.dry_run,
        )
    except Exception as exc:
        report = {
            "ok": False,
            "dry_run": args.dry_run,
            "broker": args.broker.upper(),
            "account_id": args.account_id,
            "portfolio_id": args.portfolio_id,
            "source_file": Path(args.positions_file).name,
            "error": str(exc),
        }
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
