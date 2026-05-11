from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable, Mapping

import pandas as pd


def rows_to_adj_close_series(rows: Iterable[Mapping[str, Any]] | None) -> pd.Series | None:
    if not rows:
        return None

    points: list[tuple[pd.Timestamp, float]] = []
    for row in rows:
        raw_date = row.get("date")
        raw_price = row.get("adj_close")
        try:
            ts = pd.to_datetime(raw_date, errors="coerce")
            price = float(raw_price)
        except (TypeError, ValueError):
            continue
        if pd.isna(ts) or not pd.notna(price) or price <= 0:
            continue
        points.append((ts, price))

    if not points:
        return None

    points.sort(key=lambda item: item[0])
    dedup: dict[pd.Timestamp, float] = {}
    for ts, price in points:
        dedup[ts] = price

    series = pd.Series(dedup).sort_index()
    return series if not series.empty else None


def choose_indicator_series(
    primary_series: pd.Series,
    fallback_series: pd.Series | None,
    *,
    min_points: int = 35,
) -> tuple[pd.Series, str]:
    primary = primary_series.dropna()
    if len(primary) >= min_points:
        return primary, "primary"

    if fallback_series is not None:
        fallback = fallback_series.dropna()
        if len(fallback) >= min_points:
            return fallback, "fallback"

    return primary, "primary"


def trailing_reference(series: pd.Series, periods_back: int) -> float | None:
    clean = series.dropna()
    if clean.empty:
        return None
    idx = max(len(clean) - 1 - periods_back, 0)
    try:
        return float(clean.iloc[idx])
    except (TypeError, ValueError):
        return None


def year_start_reference(series: pd.Series, year: int | None = None) -> float | None:
    clean = series.dropna()
    if clean.empty:
        return None

    ref_year = year if year is not None else datetime.now().year
    cutoff = pd.Timestamp(ref_year, 1, 1)
    history = clean[clean.index < cutoff]
    target = history.iloc[-1] if not history.empty else clean.iloc[0]
    try:
        return float(target)
    except (TypeError, ValueError):
        return None


def pct_change(current: float | None, base: float | None) -> float:
    if current is None or base is None or base == 0:
        return 0.0
    return (current / base) - 1
