from datetime import date, datetime, timezone

from macro_regime import (
    SeriesDefinition,
    build_latest_series_point,
    build_satellite_targets,
    classify_regime,
    regime_snapshot_payload,
    satellite_target_payload,
    series_point_payload,
)


def monthly(values, *, start_year=2024, start_month=1):
    rows = []
    year = start_year
    month = start_month
    for value in values:
        rows.append((date(year, month, 1), float(value)))
        month += 1
        if month > 12:
            year += 1
            month = 1
    return rows


def daily(values, *, start_day=1):
    return [(date(2026, 6, start_day + index), float(value)) for index, value in enumerate(values)]


def base_history():
    return {
        "PAYEMS": monthly([
            100000, 100100, 100200, 100300, 100400, 100500, 100600, 100700,
            100800, 100900, 101000, 101100, 101220, 101340, 101460, 101580,
        ]),
        "UNRATE": monthly([
            4.1, 4.1, 4.1, 4.0, 4.0, 4.0, 3.9, 3.9,
            3.9, 3.9, 3.8, 3.8, 3.8, 3.8, 3.8, 3.8,
        ]),
        "CPIAUCSL": monthly([
            300, 301, 302, 303, 304, 305, 306, 307,
            308, 309, 310, 311, 314, 315, 316, 317,
        ]),
        "CPILFESL": monthly([
            300, 301, 302, 303, 304, 305, 306, 307,
            308, 309, 310, 311, 314, 315, 317, 319,
        ]),
        "T10YIE": daily([2.3, 2.35, 2.4]),
        "T10Y2Y": daily([0.4, 0.5, 0.6]),
        "BAMLH0A0HYM2": daily([3.1, 3.2, 3.3]),
    }


def test_classify_regime_reflation_when_growth_and_inflation_rise():
    snapshot = classify_regime(base_history(), as_of_date=date(2026, 7, 5))

    assert snapshot.regime == "REFLATION"
    assert snapshot.growth_signal == "UP"
    assert snapshot.inflation_signal == "UP"
    assert snapshot.regime_state == "PARTIAL"
    assert "regime_partial_inputs" in snapshot.reason_codes


def test_classify_regime_deflation_when_growth_and_inflation_fall():
    history = base_history()
    history["PAYEMS"] = monthly([
        100000, 100100, 100200, 100300, 100400, 100500, 100600, 100700,
        100800, 100900, 101000, 101100, 101000, 100900, 100800, 100700,
    ])
    history["UNRATE"] = monthly([
        3.8, 3.8, 3.8, 3.9, 3.9, 3.9, 4.0, 4.0,
        4.0, 4.1, 4.1, 4.1, 4.2, 4.3, 4.4, 4.5,
    ])
    history["CPILFESL"] = monthly([
        300, 301, 302, 303, 304, 305, 306, 307,
        308, 309, 310, 311, 313, 314, 314.5, 315,
    ])
    history["T10YIE"] = daily([2.9, 3.0, 3.1])

    snapshot = classify_regime(history, as_of_date=date(2026, 7, 5))

    assert snapshot.regime == "DEFLATION"
    assert snapshot.growth_signal == "DOWN"
    assert snapshot.inflation_signal == "DOWN"


def test_build_satellite_targets_blocks_below_ma200_and_reallocates_to_cash():
    snapshot = classify_regime(base_history(), as_of_date=date(2026, 7, 5))
    trend_rows = [
        {"ticker": "CPER", "ma200_status": "below", "trend_state": "BEARISH"},
        {"ticker": "XLE", "ma200_status": "above", "trend_state": "BULLISH"},
        {"ticker": "EEM", "ma200_status": "above", "trend_state": "NEUTRAL"},
    ]

    targets = build_satellite_targets(snapshot, trend_rows)
    by_bucket = {target.bucket_key: target for target in targets}

    assert by_bucket["copper"].data_state == "BLOCKED_TREND"
    assert by_bucket["copper"].effective_weight_pct == 0
    assert by_bucket["cash"].effective_weight_pct == 10
    assert "trend_block_reallocation" in by_bucket["cash"].reason_codes


def test_build_satellite_targets_keeps_unknown_ma200_explicit():
    snapshot = classify_regime(base_history(), as_of_date=date(2026, 7, 5))
    targets = build_satellite_targets(snapshot, [])

    assert all(
        target.data_state in {"TREND_UNKNOWN", "READY", "REGIME_PARTIAL"}
        for target in targets
    )
    assert any(target.data_state == "TREND_UNKNOWN" for target in targets)


def test_payloads_are_stable_for_upsert_contracts():
    now = datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc)
    point = build_latest_series_point(
        SeriesDefinition("T10Y2Y", "Spread", "DAILY", 10),
        daily([0.1, 0.2], start_day=1),
        today=date(2026, 7, 5),
    )
    point_payload = series_point_payload(point, now=now)
    snapshot = classify_regime(base_history(), as_of_date=date(2026, 7, 5))
    snapshot_payload = regime_snapshot_payload(snapshot, now=now)
    target_payload = satellite_target_payload(
        build_satellite_targets(snapshot, [{"ticker": "CPER", "ma200_status": "above", "trend_state": "BULLISH"}])[0],
        snapshot_id="snapshot-1",
        now=now,
    )

    assert point_payload["series_id"] == "T10Y2Y"
    assert point_payload["as_of_date"] == "2026-06-02"
    assert snapshot_payload["as_of_date"] == "2026-07-05"
    assert target_payload["snapshot_id"] == "snapshot-1"
    assert target_payload["recommended_envelope"] == "CTO"
