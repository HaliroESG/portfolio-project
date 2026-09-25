from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Iterable

from .models import BookPosition, BookState, LedgerEvent, ZERO


EXTERNAL_FLOW_TYPES = {"DEPOSIT", "WITHDRAWAL"}


@dataclass
class _MutablePosition:
    account_id: str
    portfolio_id: str
    instrument_id: str
    quantity: Decimal = ZERO
    cost_basis_local: Decimal = ZERO
    realized_pnl_local: Decimal = ZERO
    cost_basis_eur: Decimal = ZERO
    realized_pnl_eur: Decimal = ZERO
    eur_cost_complete: bool = True
    eur_pnl_complete: bool = True

    @property
    def average_cost(self) -> Decimal | None:
        if self.quantity == 0:
            return None
        return self.cost_basis_local / self.quantity


def _event_sort_key(event: LedgerEvent) -> tuple[date, str, str]:
    return (event.trade_date, event.created_at or "", event.id)


def _eur_amount(event: LedgerEvent) -> Decimal | None:
    if event.currency == "EUR":
        return event.cash_amount
    if event.fx_rate_to_eur is None:
        return None
    return event.cash_amount * event.fx_rate_to_eur


def build_book(events: Iterable[LedgerEvent]) -> BookState:
    """Replay append-only events using a moving-average cost basis.

    Cash movements are preserved in their native currency. Deposits and
    withdrawals are also exposed as investor flows for TWR/XIRR calculations.
    """

    positions: dict[tuple[str, str], _MutablePosition] = {}
    cash: dict[tuple[str, str], Decimal] = defaultdict(lambda: ZERO)
    external_flows: dict[date, Decimal] = defaultdict(lambda: ZERO)
    warnings: list[dict[str, str]] = []

    for event in sorted(events, key=_event_sort_key):
        cash[(event.account_id, event.currency)] += event.cash_amount

        if event.event_type in EXTERNAL_FLOW_TYPES:
            amount_eur = _eur_amount(event)
            if amount_eur is None:
                warnings.append(
                    {
                        "code": "FLOW_FX_MISSING",
                        "event_id": event.id,
                        "currency": event.currency,
                    }
                )
            else:
                external_flows[event.trade_date] += amount_eur

        if event.event_type not in {"BUY", "SELL"}:
            continue
        if event.instrument_id is None:
            warnings.append({"code": "INSTRUMENT_MISSING", "event_id": event.id})
            continue

        key = (event.account_id, event.instrument_id)
        position = positions.setdefault(
            key,
            _MutablePosition(
                account_id=event.account_id,
                portfolio_id=event.portfolio_id,
                instrument_id=event.instrument_id,
            ),
        )

        if event.event_type == "BUY":
            acquisition_cost = abs(event.gross_amount) + abs(event.fees) + abs(event.taxes)
            if acquisition_cost == 0:
                acquisition_cost = abs(event.cash_amount)
            position.quantity += abs(event.quantity)
            position.cost_basis_local += acquisition_cost
            if event.currency == "EUR":
                position.cost_basis_eur += acquisition_cost
            elif event.fx_rate_to_eur is not None:
                position.cost_basis_eur += acquisition_cost * event.fx_rate_to_eur
            else:
                position.eur_cost_complete = False
            continue

        sold_quantity = abs(event.quantity)
        if sold_quantity > position.quantity:
            warnings.append(
                {
                    "code": "NEGATIVE_POSITION",
                    "event_id": event.id,
                    "instrument_id": event.instrument_id,
                }
            )
        average_cost = position.average_cost or ZERO
        reduced_quantity = min(position.quantity, sold_quantity)
        released_cost = average_cost * reduced_quantity
        sale_proceeds = abs(event.gross_amount) - abs(event.fees) - abs(event.taxes)
        if sale_proceeds == 0:
            sale_proceeds = abs(event.cash_amount)
        position.realized_pnl_local += sale_proceeds - released_cost
        released_cost_eur = ZERO
        if position.quantity > 0 and position.eur_cost_complete:
            released_cost_eur = position.cost_basis_eur / position.quantity * reduced_quantity
            position.cost_basis_eur -= released_cost_eur
        if event.currency == "EUR" and position.eur_cost_complete:
            position.realized_pnl_eur += sale_proceeds - released_cost_eur
        elif event.fx_rate_to_eur is not None and position.eur_cost_complete:
            position.realized_pnl_eur += sale_proceeds * event.fx_rate_to_eur - released_cost_eur
        else:
            position.eur_pnl_complete = False
        position.quantity -= sold_quantity
        position.cost_basis_local -= released_cost
        if position.quantity <= 0:
            position.cost_basis_local = ZERO
            position.cost_basis_eur = ZERO
            position.eur_cost_complete = True

    immutable_positions = tuple(
        BookPosition(
            account_id=position.account_id,
            portfolio_id=position.portfolio_id,
            instrument_id=position.instrument_id,
            quantity=position.quantity,
            average_cost=position.average_cost,
            cost_basis_local=position.cost_basis_local,
            realized_pnl_local=position.realized_pnl_local,
            cost_basis_eur=position.cost_basis_eur if position.eur_cost_complete else None,
            realized_pnl_eur=position.realized_pnl_eur if position.eur_pnl_complete else None,
        )
        for _, position in sorted(positions.items())
        if position.quantity != 0
    )
    return BookState(
        positions=immutable_positions,
        cash_by_account_currency=dict(cash),
        external_flows_eur_by_date=dict(external_flows),
        warnings=tuple(warnings),
    )
