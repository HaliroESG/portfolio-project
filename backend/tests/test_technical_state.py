import numpy as np
import pandas as pd

from technical_state import (
    calculate_rsi_series,
    classify_trend_state,
    normalize_indicator_value,
)


def test_calculate_rsi_series_returns_100_on_strict_uptrend():
    prices = pd.Series(np.arange(1, 80, dtype=float))
    rsi = calculate_rsi_series(prices, period=14)

    assert rsi.iloc[-1] == 100.0


def test_calculate_rsi_series_returns_50_on_flat_market():
    prices = pd.Series(np.repeat(100.0, 80))
    rsi = calculate_rsi_series(prices, period=14)

    assert rsi.iloc[-1] == 50.0


def test_classify_trend_state_rule_and_missing_states():
    assert classify_trend_state(1.2, 1.0, 65.0, 3.0, indicator_points=120) == "BULLISH"
    assert classify_trend_state(0.8, 1.0, 35.0, -3.0, indicator_points=120) == "BEARISH"
    assert classify_trend_state(1.0, 1.0, 55.0, 0.2, indicator_points=120) == "NEUTRAL"

    assert classify_trend_state(None, 1.0, 55.0, 0.2, indicator_points=20) == "INSUFFICIENT_HISTORY"
    assert classify_trend_state(None, 1.0, 55.0, 0.2, indicator_points=80) == "UNKNOWN"


def test_normalize_indicator_value_rejects_non_finite():
    assert normalize_indicator_value(np.nan) is None
    assert normalize_indicator_value(np.inf) is None
    assert normalize_indicator_value("-") is None
    assert normalize_indicator_value(1.25) == 1.25
