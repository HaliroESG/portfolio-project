from datetime import date
from decimal import Decimal

from family_office.analytics import calculate_performance_series, calculate_risk_snapshot, xirr
from family_office.models import DailyValuation


def test_twr_neutralizes_external_flows() -> None:
    series = calculate_performance_series(
        [
            DailyValuation(date(2026, 1, 1), Decimal("1000"), Decimal("1000"), Decimal("100"), True),
            DailyValuation(date(2026, 1, 2), Decimal("1200"), Decimal("100"), Decimal("100"), True),
            DailyValuation(date(2026, 1, 3), Decimal("1210"), Decimal("0"), Decimal("100"), True),
        ]
    )
    assert series[1].twr_daily == Decimal("0.1")
    expected_day_return = Decimal("1210") / Decimal("1200") - Decimal("1")
    assert abs(series[2].twr_daily - expected_day_return) < Decimal("1e-26")
    assert series[-1].data_state == "READY"
    assert series[-1].twr_since_inception is not None


def test_data_state_never_hides_missing_or_unreconciled_data() -> None:
    series = calculate_performance_series(
        [
            DailyValuation(date(2026, 1, 1), None, Decimal("0"), Decimal("0"), False),
            DailyValuation(date(2026, 1, 2), Decimal("100"), Decimal("0"), Decimal("80"), False),
        ]
    )
    assert series[0].data_state == "MISSING"
    assert series[1].data_state == "UNRECONCILED"


def test_xirr_and_risk_are_bounded_and_deterministic() -> None:
    result = xirr(
        [
            (date(2025, 1, 1), Decimal("-1000")),
            (date(2026, 1, 1), Decimal("1100")),
        ]
    )
    assert result is not None
    assert abs(result - Decimal("0.1")) < Decimal("0.000001")

    risk = calculate_risk_snapshot(
        [(date(2026, 1, 1), Decimal("100")), (date(2026, 1, 2), Decimal("90")), (date(2026, 1, 3), Decimal("95"))],
        [Decimal("40"), Decimal("20")],
        Decimal("10"),
        Decimal("25"),
        Decimal("30"),
    )
    assert risk["max_drawdown_ytd_pct"] == Decimal("-10.0")
    assert risk["largest_position_pct"] == Decimal("40") / Decimal("95") * Decimal("100")
