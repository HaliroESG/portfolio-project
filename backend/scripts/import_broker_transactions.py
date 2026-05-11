from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

CURRENT_DIR = os.path.dirname(__file__)
BACKEND_ROOT = os.path.dirname(CURRENT_DIR)
sys.path.append(BACKEND_ROOT)

from broker_ingest.fortuneo import parse_fortuneo_csv  # noqa: E402
from broker_ingest.ibkr import parse_ibkr_trades_csv  # noqa: E402
from broker_ingest.models import CanonicalTransaction  # noqa: E402
from broker_ingest.reconciliation import (  # noqa: E402
    build_reconciliation_report,
    parse_broker_positions_csv,
)
from broker_ingest.sync_reconciliation import persist_reconciliation_report  # noqa: E402
from broker_ingest.sync_transactions import upsert_canonical_transactions  # noqa: E402


ParserFn = Callable[[str | Path, str, str | None], list[CanonicalTransaction]]

PARSERS: dict[str, ParserFn] = {
    "fortuneo": parse_fortuneo_csv,
    "ibkr": parse_ibkr_trades_csv,
}


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required for non-dry-run broker imports")
    return value


def _build_supabase_client() -> Any:
    from supabase import create_client

    return create_client(_required_env("SUPABASE_URL"), _required_env("SUPABASE_KEY"))


def _side_counts(transactions: list[CanonicalTransaction]) -> dict[str, int]:
    return dict(sorted(Counter(tx.side for tx in transactions).items()))


def _currency_counts(transactions: list[CanonicalTransaction]) -> dict[str, int]:
    return dict(sorted(Counter(tx.currency for tx in transactions).items()))


def _amount_totals(transactions: list[CanonicalTransaction]) -> dict[str, str]:
    gross = sum((tx.gross_amount for tx in transactions), Decimal("0"))
    fees = sum((tx.fees for tx in transactions), Decimal("0"))
    taxes = sum((tx.taxes for tx in transactions), Decimal("0"))
    net = sum((tx.net_amount for tx in transactions), Decimal("0"))
    return {
        "gross_amount": str(gross),
        "fees": str(fees),
        "taxes": str(taxes),
        "net_amount": str(net),
    }


def build_import_report(
    broker: str,
    account_id: str,
    source_file: str | Path,
    transactions: list[CanonicalTransaction],
    dry_run: bool,
    upserted_count: int,
    positions_file: str | Path | None = None,
) -> dict[str, Any]:
    broker_positions = parse_broker_positions_csv(positions_file) if positions_file else None
    position_affecting_count = len([tx for tx in transactions if tx.side in {"BUY", "SELL"}])
    return {
        "broker": broker.upper(),
        "account_id": account_id,
        "source_file": Path(source_file).name,
        "dry_run": dry_run,
        "parsed_count": len(transactions),
        "upserted_count": upserted_count,
        "position_affecting_count": position_affecting_count,
        "side_counts": _side_counts(transactions),
        "currency_counts": _currency_counts(transactions),
        "amount_totals": _amount_totals(transactions),
        "reconciliation": build_reconciliation_report(transactions, broker_positions),
    }


def run_import(
    broker: str,
    source_file: str | Path,
    account_id: str,
    envelope: str | None = None,
    dry_run: bool = True,
    positions_file: str | Path | None = None,
    persist_reconciliation: bool = False,
    reconciliation_date: date | None = None,
    supabase_client: Any | None = None,
) -> dict[str, Any]:
    if persist_reconciliation and dry_run:
        raise RuntimeError("persist_reconciliation requires dry_run=False")
    if persist_reconciliation and not positions_file:
        raise RuntimeError("persist_reconciliation requires positions_file")

    broker_key = broker.lower()
    parser = PARSERS.get(broker_key)
    if parser is None:
        supported = ", ".join(sorted(PARSERS))
        raise RuntimeError(f"Unsupported broker '{broker}'. Supported brokers: {supported}")

    path = Path(source_file)
    transactions = parser(path, account_id, envelope)

    upserted_count = 0
    client = None
    if not dry_run and (transactions or persist_reconciliation):
        client = supabase_client or _build_supabase_client()

    if not dry_run and transactions:
        try:
            upserted_count = upsert_canonical_transactions(
                client,
                transactions,
                source_file=path.name,
            )
        except Exception as exc:
            raise RuntimeError(
                f"Broker import upsert failed for {broker_key}:{account_id}:{path.name}: {exc}"
            ) from exc

    report = build_import_report(
        broker=broker_key,
        account_id=account_id,
        source_file=path,
        transactions=transactions,
        dry_run=dry_run,
        upserted_count=upserted_count,
        positions_file=positions_file,
    )
    if persist_reconciliation:
        try:
            sync_result = persist_reconciliation_report(
                client,
                report,
                reconciliation_date=reconciliation_date or date.today(),
                source_file=path.name,
                positions_file=str(positions_file) if positions_file else None,
            )
        except Exception as exc:
            raise RuntimeError(
                f"Broker reconciliation sync failed for {broker_key}:{account_id}:{path.name}: {exc}"
            ) from exc
        report["reconciliation_persisted"] = sync_result

    return report


def _print_text_report(report: dict[str, Any]) -> None:
    print(
        "broker={broker} account_id={account_id} source_file={source_file} dry_run={dry_run}".format(
            **report
        )
    )
    print(
        "parsed={parsed_count} upserted={upserted_count} position_affecting={position_affecting_count}".format(
            **report
        )
    )
    print(f"side_counts={report['side_counts']}")
    print(f"currency_counts={report['currency_counts']}")
    print(f"amount_totals={report['amount_totals']}")

    reconciliation = report["reconciliation"]
    print(f"reconciliation_mode={reconciliation['mode']}")
    print(f"reconciliation_states={reconciliation['state_counts']}")
    ledger_only = reconciliation.get("ledger_only", [])
    if ledger_only:
        print(f"ledger_only_count={len(ledger_only)}")
    if report.get("reconciliation_persisted"):
        print(f"reconciliation_persisted={report['reconciliation_persisted']}")


def _parse_reconciliation_date(value: str | None) -> date | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import broker transactions into Supabase")
    parser.add_argument("--broker", required=True, choices=sorted(PARSERS))
    parser.add_argument("--file", required=True, help="Broker transaction CSV export")
    parser.add_argument("--account-id", required=True)
    parser.add_argument("--envelope", default=None, help="Optional account envelope, for example PEA or CTO")
    parser.add_argument("--positions-file", default=None, help="Optional broker positions snapshot CSV")
    parser.add_argument("--dry-run", action="store_true", help="Parse and report without writing Supabase")
    parser.add_argument("--apply", action="store_true", help="Write parsed transactions to Supabase")
    parser.add_argument(
        "--persist-reconciliation",
        action="store_true",
        help="Persist reconciliation run/items; requires --apply and --positions-file",
    )
    parser.add_argument(
        "--reconciliation-date",
        default=None,
        help="Run date for reconciliation persistence, formatted YYYY-MM-DD",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON report")
    args = parser.parse_args()
    if args.dry_run and args.apply:
        parser.error("--dry-run and --apply are mutually exclusive")
    if not args.dry_run and not args.apply:
        args.dry_run = True
    if args.persist_reconciliation and args.dry_run:
        parser.error("--persist-reconciliation requires --apply")
    if args.persist_reconciliation and not args.positions_file:
        parser.error("--persist-reconciliation requires --positions-file")
    return args


def main() -> None:
    args = _parse_args()
    report = run_import(
        broker=args.broker,
        source_file=args.file,
        account_id=args.account_id,
        envelope=args.envelope,
        dry_run=args.dry_run,
        positions_file=args.positions_file,
        persist_reconciliation=args.persist_reconciliation,
        reconciliation_date=_parse_reconciliation_date(args.reconciliation_date),
    )
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
        return
    _print_text_report(report)


if __name__ == "__main__":
    main()
