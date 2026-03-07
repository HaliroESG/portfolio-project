from __future__ import annotations

from typing import Literal

import numpy as np
import pandas as pd

TrendState = Literal["BULLISH", "BEARISH", "NEUTRAL", "UNKNOWN", "INSUFFICIENT_HISTORY"]


def normalize_indicator_value(value) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(parsed):
        return None
    return parsed


def calculate_rsi_series(prices: pd.Series, period: int = 14) -> pd.Series:
    """
    RSI standard (Wilder smoothing) à partir d'une série de prix.
    Gère explicitement les cas sans pertes (RSI=100) et marché plat (RSI=50).
    """
    delta = prices.diff()
    gains = delta.where(delta > 0, 0.0)
    losses = -delta.where(delta < 0, 0.0)

    avg_gain = gains.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = losses.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))

    no_losses = (avg_loss == 0) & (avg_gain > 0)
    flat_market = (avg_loss == 0) & (avg_gain == 0)
    rsi = rsi.where(~no_losses, 100.0)
    rsi = rsi.where(~flat_market, 50.0)
    return rsi


def classify_trend_state(
    macd_line: float | None,
    macd_signal: float | None,
    rsi_14: float | None,
    momentum_20: float | None,
    *,
    indicator_points: int | None,
    min_required_points: int = 35,
) -> TrendState:
    """
    Classification de tendance:
    - BULLISH: MACD > signal, RSI >= 60, momentum > 0
    - BEARISH: MACD < signal, RSI < 40, momentum < 0
    - NEUTRAL: indicateurs présents mais sans alignement
    - INSUFFICIENT_HISTORY: historique trop court pour les indicateurs
    - UNKNOWN: historique suffisant mais indicateurs non exploitables
    """
    values = (
        normalize_indicator_value(macd_line),
        normalize_indicator_value(macd_signal),
        normalize_indicator_value(rsi_14),
        normalize_indicator_value(momentum_20),
    )
    has_all_indicators = all(value is not None for value in values)

    if has_all_indicators:
        macd, signal, rsi, momentum = values
        if macd > signal and rsi >= 60 and momentum > 0:
            return "BULLISH"
        if macd < signal and rsi < 40 and momentum < 0:
            return "BEARISH"
        return "NEUTRAL"

    if indicator_points is not None and indicator_points < min_required_points:
        return "INSUFFICIENT_HISTORY"

    return "UNKNOWN"
