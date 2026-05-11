from __future__ import annotations

import csv
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Optional

from .models import CanonicalTransaction, normalize_side


def _parse_decimal(value: str) -> Decimal:
    cleaned = value.strip().replace(",", "")
    if not cleaned:
        return Decimal("0")
    return Decimal(cleaned)


def _parse_date(value: str) -> datetime.date:
    return datetime.strptime(value.strip(), "%Y-%m-%d").date()


def parse_ibkr_trades_csv(path: str | Path, account_id: str, envelope: Optional[str] = None) -> list[CanonicalTransaction]:
    transactions: list[CanonicalTransaction] = []
    with open(path, "r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for idx, row in enumerate(reader, start=1):
            quantity = _parse_decimal(row.get("Quantity", "0"))
            price = _parse_decimal(row.get("TradePrice", "0"))
            gross_amount = _parse_decimal(row.get("Proceeds", "0"))
            fees = abs(_parse_decimal(row.get("Comm/Fee", "0")))
            taxes = abs(_parse_decimal(row.get("Tax", "0")))
            net_amount = gross_amount - fees - taxes

            tx = CanonicalTransaction(
                broker="IBKR",
                account_id=account_id,
                external_txn_id=row.get("TradeID") or f"ibkr-{account_id}-{idx}",
                trade_date=_parse_date(row.get("TradeDate", "")),
                settlement_date=_parse_date(row["SettleDate"]) if row.get("SettleDate", "").strip() else None,
                symbol=row.get("Symbol") or None,
                isin=row.get("ISIN") or None,
                side=normalize_side(row.get("Buy/Sell", "TRANSFER")),
                quantity=abs(quantity),
                price=price,
                gross_amount=gross_amount,
                fees=fees,
                taxes=taxes,
                net_amount=net_amount,
                currency=(row.get("Currency") or "USD").strip().upper(),
                envelope=envelope,
                raw_type=row.get("AssetClass") or None,
            )
            transactions.append(tx)
    return transactions
