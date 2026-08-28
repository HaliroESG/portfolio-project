from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any


ZERO = Decimal("0")


@dataclass(frozen=True)
class LedgerEvent:
    id: str
    account_id: str
    portfolio_id: str
    event_type: str
    trade_date: date
    currency: str
    cash_amount: Decimal
    instrument_id: str | None = None
    quantity: Decimal = ZERO
    unit_price: Decimal | None = None
    gross_amount: Decimal = ZERO
    fees: Decimal = ZERO
    taxes: Decimal = ZERO
    fx_rate_to_eur: Decimal | None = None
    created_at: str | None = None


@dataclass(frozen=True)
class BookPosition:
    account_id: str
    portfolio_id: str
    instrument_id: str
    quantity: Decimal
    average_cost: Decimal | None
    cost_basis_local: Decimal
    realized_pnl_local: Decimal
    cost_basis_eur: Decimal | None = None
    realized_pnl_eur: Decimal | None = None


@dataclass(frozen=True)
class BookState:
    positions: tuple[BookPosition, ...]
    cash_by_account_currency: dict[tuple[str, str], Decimal]
    external_flows_eur_by_date: dict[date, Decimal]
    warnings: tuple[dict[str, Any], ...]


@dataclass(frozen=True)
class DailyValuation:
    valuation_date: date
    nav_eur: Decimal | None
    external_flow_eur: Decimal
    coverage_pct: Decimal
    reconciled: bool


@dataclass(frozen=True)
class PerformancePoint:
    performance_date: date
    nav_eur: Decimal | None
    external_flow_eur: Decimal
    twr_daily: Decimal | None
    twr_mtd: Decimal | None
    twr_ytd: Decimal | None
    twr_since_inception: Decimal | None
    xirr_since_inception: Decimal | None
    coverage_pct: Decimal
    data_state: str
