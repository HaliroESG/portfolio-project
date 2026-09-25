from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Iterable, Optional

from .models import CanonicalTransaction


RECONCILIATION_STATES = {
    "MATCH",
    "MISMATCH_QTY",
    "MISMATCH_COST",
    "MISSING_IN_LEDGER",
}


@dataclass(frozen=True)
class BrokerPosition:
    symbol: Optional[str]
    isin: Optional[str]
    quantity: Decimal
    average_cost: Optional[Decimal] = None
    currency: Optional[str] = None
    name: Optional[str] = None
    source_row: Optional[int] = None


@dataclass
class _LedgerPosition:
    symbol: Optional[str]
    isin: Optional[str]
    quantity: Decimal
    cost_basis: Decimal
    currency: Optional[str]
    transaction_count: int

    @property
    def average_cost(self) -> Decimal | None:
        if self.quantity == 0:
            return None
        return self.cost_basis / self.quantity


def _parse_decimal(value: str | None) -> Decimal:
    if value is None:
        return Decimal("0")
    cleaned = value.strip().replace("\u00a0", "").replace(" ", "").replace(",", ".")
    if not cleaned:
        return Decimal("0")
    return Decimal(cleaned)


def _get(row: dict[str, str], *keys: str) -> str:
    normalized = {_normalize_key(key): value for key, value in row.items() if key is not None}
    for key in keys:
        value = row.get(key)
        if value is not None:
            return value
        normalized_value = normalized.get(_normalize_key(key))
        if normalized_value is not None:
            return normalized_value
    return ""


def _normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.strip().lower())


def _instrument_key(symbol: str | None, isin: str | None) -> str:
    if isin and isin.strip():
        return f"isin:{isin.strip().upper()}"
    if symbol and symbol.strip():
        return f"symbol:{symbol.strip().upper()}"
    return "instrument:UNKNOWN"


def parse_broker_positions_csv(path: str | Path) -> list[BrokerPosition]:
    positions: list[BrokerPosition] = []
    with open(path, "r", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row_number, row in enumerate(reader, start=2):
            average_cost_raw = _get(row, "average_cost", "avg_cost", "pru", "cost_basis")
            average_cost = _parse_decimal(average_cost_raw) if average_cost_raw.strip() else None
            positions.append(
                BrokerPosition(
                    symbol=_get(row, "symbol", "ticker").strip() or None,
                    isin=_get(row, "isin").strip() or None,
                    quantity=_parse_decimal(_get(row, "quantity", "qty", "quantity_current")),
                    average_cost=average_cost,
                    currency=(_get(row, "currency", "devise").strip().upper() or None),
                    name=_get(row, "name", "nom", "security", "instrument", "description").strip() or None,
                    source_row=row_number,
                )
            )
    return positions


def _decimal_to_string(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value.normalize(), "f")


def compute_ledger_positions(transactions: Iterable[CanonicalTransaction]) -> dict[str, _LedgerPosition]:
    positions: dict[str, _LedgerPosition] = {}
    for tx in transactions:
        if tx.side not in {"BUY", "SELL"}:
            continue

        key = _instrument_key(tx.symbol, tx.isin)
        position = positions.setdefault(
            key,
            _LedgerPosition(
                symbol=tx.symbol,
                isin=tx.isin,
                quantity=Decimal("0"),
                cost_basis=Decimal("0"),
                currency=tx.currency,
                transaction_count=0,
            ),
        )
        position.transaction_count += 1

        if tx.side == "BUY":
            position.quantity += tx.quantity
            position.cost_basis += abs(tx.net_amount)
            continue

        if position.quantity > 0:
            average_cost = position.cost_basis / position.quantity
            reduced_quantity = min(position.quantity, tx.quantity)
            position.cost_basis -= average_cost * reduced_quantity
        position.quantity -= tx.quantity
        if position.quantity <= 0:
            position.cost_basis = Decimal("0")

    return positions


def build_reconciliation_report(
    transactions: Iterable[CanonicalTransaction],
    broker_positions: Iterable[BrokerPosition] | None = None,
    quantity_tolerance: Decimal = Decimal("0.000001"),
    cost_tolerance: Decimal = Decimal("0.01"),
) -> dict[str, object]:
    txs = list(transactions)
    ledger_positions = compute_ledger_positions(txs)
    ignored_transaction_count = len([tx for tx in txs if tx.side not in {"BUY", "SELL"}])

    if broker_positions is None:
        return {
            "mode": "ledger_rollup",
            "snapshot_provided": False,
            "ignored_transaction_count": ignored_transaction_count,
            "state_counts": {},
            "positions": [
                _ledger_position_payload(key, position, state="NOT_CHECKED")
                for key, position in sorted(ledger_positions.items())
            ],
            "ledger_only": [],
        }

    snapshot = list(broker_positions)
    rows: list[dict[str, object]] = []
    state_counts = {state: 0 for state in sorted(RECONCILIATION_STATES)}
    matched_keys: set[str] = set()

    for broker_position in snapshot:
        key = _instrument_key(broker_position.symbol, broker_position.isin)
        matched_keys.add(key)
        ledger_position = ledger_positions.get(key)
        if ledger_position is None:
            ledger_quantity = Decimal("0")
            ledger_average_cost = None
            state = "MATCH" if broker_position.quantity == 0 else "MISSING_IN_LEDGER"
        else:
            ledger_quantity = ledger_position.quantity
            ledger_average_cost = ledger_position.average_cost
            quantity_delta = ledger_quantity - broker_position.quantity
            if abs(quantity_delta) > quantity_tolerance:
                state = "MISMATCH_QTY"
            elif (
                broker_position.average_cost is not None
                and ledger_average_cost is not None
                and abs(ledger_average_cost - broker_position.average_cost) > cost_tolerance
            ):
                state = "MISMATCH_COST"
            else:
                state = "MATCH"

        state_counts[state] += 1
        rows.append(
            {
                "instrument_key": key,
                "symbol": broker_position.symbol,
                "isin": broker_position.isin,
                "currency": broker_position.currency,
                "state": state,
                "ledger_quantity": _decimal_to_string(ledger_quantity),
                "broker_quantity": _decimal_to_string(broker_position.quantity),
                "quantity_delta": _decimal_to_string(ledger_quantity - broker_position.quantity),
                "ledger_average_cost": _decimal_to_string(ledger_average_cost),
                "broker_average_cost": _decimal_to_string(broker_position.average_cost),
            }
        )

    ledger_only = [
        _ledger_position_payload(key, position, state="LEDGER_ONLY")
        for key, position in sorted(ledger_positions.items())
        if key not in matched_keys and position.quantity != 0
    ]

    return {
        "mode": "broker_snapshot",
        "snapshot_provided": True,
        "ignored_transaction_count": ignored_transaction_count,
        "state_counts": state_counts,
        "positions": rows,
        "ledger_only": ledger_only,
    }


def _ledger_position_payload(
    key: str,
    position: _LedgerPosition,
    state: str,
) -> dict[str, object]:
    return {
        "instrument_key": key,
        "symbol": position.symbol,
        "isin": position.isin,
        "currency": position.currency,
        "state": state,
        "ledger_quantity": _decimal_to_string(position.quantity),
        "ledger_average_cost": _decimal_to_string(position.average_cost),
        "transaction_count": position.transaction_count,
    }
