from datetime import datetime, timedelta

from utils.state_helpers import classify_trend_state, parse_numeric, calculate_data_status


def test_parse_numeric_variants():
    assert parse_numeric('1 234,56') == 1234.56
    assert parse_numeric('') is None
    assert parse_numeric(None) is None
    assert parse_numeric('€12.5') == 12.5


def test_classify_trend_state_cases():
    assert classify_trend_state(None, 1, 60, 1) == 'INSUFFICIENT_HISTORY'
    assert classify_trend_state(2, 1, 65, 1.2) == 'BULLISH'
    assert classify_trend_state(1, 2, 30, -2) == 'BEARISH'
    assert classify_trend_state(1, 1, 50, 0) == 'NEUTRAL'


def test_calculate_data_status_cases():
    assert calculate_data_status(0, None) == 'LOW_CONFIDENCE'
    assert calculate_data_status(10, datetime.now() - timedelta(days=10)) == 'STALE'
    assert calculate_data_status(10, datetime.now()) == 'OK'
