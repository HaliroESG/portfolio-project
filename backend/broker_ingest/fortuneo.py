from __future__ import annotations

import csv
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Iterable, Optional

from .models import CanonicalTransaction, normalize_side


def _parse_decimal(value: str) -> Decimal:
    cleaned = value.strip().replace("\u00a0", "").replace(" ", "")
    cleaned = cleaned.replace(",", ".")
    if not cleaned:
        return Decimal("0")
    return Decimal(cleaned)


def _parse_date(value: str) -> datetime.date:
    return datetime.strptime(value.strip(), "%Y-%m-%d").date()


def _get(row: dict[str, str], *keys: str) -> str:
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    return ""


def parse_fortuneo_csv(path: str | Path, account_id: str, envelope: Optional[str] = None) -> list[CanonicalTransaction]:
    transactions: list[CanonicalTransaction] = []
    with open(path, "r", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for idx, row in enumerate(reader, start=1):
            trade_date = _parse_date(_get(row, "trade_date", "date_operation"))
            settlement_raw = _get(row, "settlement_date", "date_valeur")
            settlement_date = _parse_date(settlement_raw) if settlement_raw.strip() else None

            side = normalize_side(_get(row, "side", "sens", "type_operation"))
            quantity = _parse_decimal(_get(row, "quantity", "quantite"))
            price_raw = _get(row, "price", "prix_unitaire")
            price = _parse_decimal(price_raw) if price_raw.strip() else None

            gross_amount = _parse_decimal(_get(row, "gross_amount", "montant_brut"))
            fees = _parse_decimal(_get(row, "fees", "frais"))
            taxes = _parse_decimal(_get(row, "taxes", "taxes"))
            net_amount_raw = _get(row, "net_amount", "montant_net")
            net_amount = _parse_decimal(net_amount_raw) if net_amount_raw.strip() else gross_amount - fees - taxes

            external_txn_id = _get(row, "external_txn_id", "id_operation") or f"fortuneo-{account_id}-{idx}"
            currency = (_get(row, "currency", "devise") or "EUR").strip().upper()

            tx = CanonicalTransaction(
                broker="FORTUNEO",
                account_id=account_id,
                external_txn_id=external_txn_id,
                trade_date=trade_date,
                settlement_date=settlement_date,
                symbol=_get(row, "symbol", "ticker") or None,
                isin=_get(row, "isin") or None,
                side=side,
                quantity=quantity,
                price=price,
                gross_amount=gross_amount,
                fees=fees,
                taxes=taxes,
                net_amount=net_amount,
                currency=currency,
                envelope=envelope,
                raw_type=_get(row, "raw_type", "type_operation") or None,
            )
            transactions.append(tx)
    return transactions


def to_idempotency_keys(transactions: Iterable[CanonicalTransaction]) -> list[str]:
    return [f"{tx.broker}:{tx.account_id}:{tx.external_txn_id}" for tx in transactions]
