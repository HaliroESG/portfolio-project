from __future__ import annotations

from typing import Any, Iterable

from .models import CanonicalTransaction


def _to_payload(tx: CanonicalTransaction, source_file: str | None = None) -> dict[str, Any]:
    return {
        "broker": tx.broker,
        "account_id": tx.account_id,
        "external_txn_id": tx.external_txn_id,
        "idempotency_key": f"{tx.broker}:{tx.account_id}:{tx.external_txn_id}",
        "trade_date": tx.trade_date.isoformat(),
        "settlement_date": tx.settlement_date.isoformat() if tx.settlement_date else None,
        "symbol": tx.symbol,
        "isin": tx.isin,
        "side": tx.side,
        "quantity": str(tx.quantity),
        "price": str(tx.price) if tx.price is not None else None,
        "gross_amount": str(tx.gross_amount),
        "fees": str(tx.fees),
        "taxes": str(tx.taxes),
        "net_amount": str(tx.net_amount),
        "currency": tx.currency,
        "envelope": tx.envelope,
        "raw_type": tx.raw_type,
        "source_file": source_file,
    }


def upsert_canonical_transactions(
    supabase_client: Any,
    transactions: Iterable[CanonicalTransaction],
    source_file: str | None = None,
) -> int:
    payloads = [_to_payload(tx, source_file=source_file) for tx in transactions]
    if not payloads:
        return 0

    (
        supabase_client
        .table("broker_transactions")
        .upsert(payloads, on_conflict="idempotency_key")
        .execute()
    )
    return len(payloads)
