import pandas as pd

from market_history_utils import (
    choose_indicator_series,
    pct_change,
    rows_to_adj_close_series,
    trailing_reference,
    year_start_reference,
)


def test_rows_to_adj_close_series_parses_and_sorts():
    rows = [
        {"date": "2026-01-03", "adj_close": 103},
        {"date": "2026-01-01", "adj_close": 101},
        {"date": "2026-01-02", "adj_close": 102},
        {"date": "bad-date", "adj_close": 99},
        {"date": "2026-01-02", "adj_close": 102.5},
    ]
    series = rows_to_adj_close_series(rows)

    assert series is not None
    assert len(series) == 3
    assert series.index[0] == pd.Timestamp("2026-01-01")
    assert float(series.iloc[-1]) == 103.0
    assert float(series.loc[pd.Timestamp("2026-01-02")]) == 102.5


def test_choose_indicator_series_uses_fallback_when_primary_short():
    primary = pd.Series([100.0, 101.0])
    fallback = pd.Series([float(100 + i) for i in range(40)])

    selected, source = choose_indicator_series(primary, fallback, min_points=35)

    assert source == "fallback"
    assert len(selected) == 40


def test_reference_helpers_and_pct_change():
    index = pd.to_datetime(["2025-12-30", "2026-01-02", "2026-01-03"])
    series = pd.Series([98.0, 100.0, 102.0], index=index)

    assert trailing_reference(series, 1) == 100.0
    assert trailing_reference(series, 10) == 98.0
    assert year_start_reference(series, 2026) == 98.0
    assert abs(pct_change(102.0, 100.0) - 0.02) < 1e-12
    assert pct_change(102.0, 0.0) == 0.0
