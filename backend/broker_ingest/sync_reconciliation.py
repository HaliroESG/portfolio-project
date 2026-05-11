from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Any


def _run_idempotency_key(
    broker: str,
    account_id: str,
    reconciliation_date: date,
    source_file: str | None,
    positions_file: str | None,
) -> str:
    source_name = Path(source_file).name if source_file else "-"
    positions_name = Path(positions_file).name if positions_file else "-"
    return ":".join([
        broker.upper(),
        account_id,
        reconciliation_date.isoformat(),
        source_name,
        positions_name,
    ])


def _run_status(report: dict[str, Any]) -> str:
    reconciliation = report["reconciliation"]
    if not reconciliation.get("snapshot_provided"):
        return "NOT_CHECKED"

    state_counts = reconciliation.get("state_counts", {})
    mismatch_count = (
        int(state_counts.get("MISMATCH_QTY", 0))
        + int(state_counts.get("MISMATCH_COST", 0))
        + int(state_counts.get("MISSING_IN_LEDGER", 0))
        + len(reconciliation.get("ledger_only", []))
    )
    return "MISMATCH" if mismatch_count else "MATCH"


def _run_payload(
    report: dict[str, Any],
    reconciliation_date: date,
    source_file: str | None,
    positions_file: str | None,
) -> dict[str, Any]:
    reconciliation = report["reconciliation"]
    position_count = len(reconciliation.get("positions", [])) + len(reconciliation.get("ledger_only", []))
    updated_at = datetime.utcnow().isoformat()
    return {
        "broker": report["broker"],
        "account_id": report["account_id"],
        "reconciliation_date": reconciliation_date.isoformat(),
        "source_file": Path(source_file).name if source_file else report.get("source_file"),
        "positions_file": Path(positions_file).name if positions_file else None,
        "mode": reconciliation["mode"],
        "status": _run_status(report),
        "parsed_count": report["parsed_count"],
        "position_count": position_count,
        "state_counts": reconciliation.get("state_counts", {}),
        "report_json": report,
        "idempotency_key": _run_idempotency_key(
            report["broker"],
            report["account_id"],
            reconciliation_date,
            source_file or report.get("source_file"),
            positions_file,
        ),
        "updated_at": updated_at,
    }


def _item_payload(run_id: str, row: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "instrument_key": row["instrument_key"],
        "symbol": row.get("symbol"),
        "isin": row.get("isin"),
        "currency": row.get("currency"),
        "state": row["state"],
        "ledger_quantity": row.get("ledger_quantity"),
        "broker_quantity": row.get("broker_quantity"),
        "quantity_delta": row.get("quantity_delta"),
        "ledger_average_cost": row.get("ledger_average_cost"),
        "broker_average_cost": row.get("broker_average_cost"),
        "transaction_count": row.get("transaction_count"),
    }


def persist_reconciliation_report(
    supabase_client: Any,
    report: dict[str, Any],
    reconciliation_date: date,
    source_file: str | None = None,
    positions_file: str | None = None,
) -> dict[str, Any]:
    run_payload = _run_payload(
        report,
        reconciliation_date=reconciliation_date,
        source_file=source_file,
        positions_file=positions_file,
    )
    response = (
        supabase_client
        .table("broker_reconciliation_runs")
        .upsert(run_payload, on_conflict="idempotency_key")
        .execute()
    )
    data = getattr(response, "data", response.get("data") if isinstance(response, dict) else None)
    if not data:
        raise RuntimeError("broker_reconciliation_runs upsert did not return a run id")
    run_id = data[0].get("id")
    if not run_id:
        raise RuntimeError("broker_reconciliation_runs upsert returned no id")

    reconciliation = report["reconciliation"]
    rows = list(reconciliation.get("positions", [])) + list(reconciliation.get("ledger_only", []))
    item_payloads = [_item_payload(run_id, row) for row in rows]

    (
        supabase_client
        .table("broker_reconciliation_items")
        .delete()
        .eq("run_id", run_id)
        .execute()
    )
    if item_payloads:
        supabase_client.table("broker_reconciliation_items").insert(item_payloads).execute()

    return {
        "run_id": run_id,
        "status": run_payload["status"],
        "item_count": len(item_payloads),
    }
