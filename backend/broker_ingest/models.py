from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional


@dataclass(frozen=True)
class CanonicalTransaction:
    """Normalized broker transaction event.

    Monetary fields follow signed portfolio convention:
    - BUY: negative net cash effect
    - SELL: positive net cash effect
    """

    broker: str
    account_id: str
    external_txn_id: str
    trade_date: date
    settlement_date: Optional[date]
    symbol: Optional[str]
    isin: Optional[str]
    side: str
    quantity: Decimal
    price: Optional[Decimal]
    gross_amount: Decimal
    fees: Decimal
    taxes: Decimal
    net_amount: Decimal
    currency: str
    envelope: Optional[str]
    raw_type: Optional[str]


VALID_SIDES = {"BUY", "SELL", "DIVIDEND", "FEE", "TAX", "INTEREST", "TRANSFER"}


def normalize_side(raw_side: str) -> str:
    side = raw_side.strip().upper()
    if side not in VALID_SIDES:
        return "TRANSFER"
    return side
