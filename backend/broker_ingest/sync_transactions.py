from __future__ import annotations

from typing import Any, Iterable

from .models import CanonicalTransaction
from owner_scope import owner_scoped_identifier, require_owner_user_id


def _to_payload(
    tx: CanonicalTransaction,
    owner_user_id: str,
    source_file: str | None = None,
) -> dict[str, Any]:
    owner = require_owner_user_id(owner_user_id)
    return {
        "owner_user_id": owner,
        "broker": tx.broker,
        "account_id": tx.account_id,
        "external_txn_id": tx.external_txn_id,
        "idempotency_key": owner_scoped_identifier(
            owner,
            tx.broker,
            tx.account_id,
            tx.external_txn_id,
        ),
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
    owner_user_id: str,
    source_file: str | None = None,
) -> int:
    owner = require_owner_user_id(owner_user_id)
    payloads = [
        _to_payload(tx, owner_user_id=owner, source_file=source_file)
        for tx in transactions
    ]
    if not payloads:
        return 0

    (
        supabase_client
        .table("broker_transactions")
        .upsert(payloads, on_conflict="owner_user_id,idempotency_key")
        .execute()
    )
    return len(payloads)
