from __future__ import annotations

import math
from datetime import date
from decimal import Decimal
from typing import Iterable, Sequence

from .models import DailyValuation, PerformancePoint, ZERO


def _decimal(value: float) -> Decimal:
    if not math.isfinite(value):
        raise ValueError("non-finite decimal")
    return Decimal(str(value))


def xnpv(rate: float, cash_flows: Sequence[tuple[date, Decimal]]) -> float:
    if rate <= -1:
        return math.inf
    if not cash_flows:
        return 0.0
    origin = min(flow_date for flow_date, _ in cash_flows)
    return sum(
        float(amount) / ((1 + rate) ** ((flow_date - origin).days / 365.0))
        for flow_date, amount in cash_flows
    )


def xirr(cash_flows: Sequence[tuple[date, Decimal]]) -> Decimal | None:
    """Return annualized IRR with a bounded bisection solver.

    At least one positive and one negative cash flow are required. Bisection is
    slower than Newton-Raphson but deterministic for this low-volume workflow.
    """

    if not cash_flows:
        return None
    amounts = [amount for _, amount in cash_flows]
    if not any(amount > 0 for amount in amounts) or not any(amount < 0 for amount in amounts):
        return None

    low, high = -0.9999, 10.0
    low_value = xnpv(low, cash_flows)
    high_value = xnpv(high, cash_flows)
    expansion_count = 0
    while low_value * high_value > 0 and expansion_count < 8:
        high *= 2
        high_value = xnpv(high, cash_flows)
        expansion_count += 1
    if low_value * high_value > 0:
        return None

    for _ in range(160):
        middle = (low + high) / 2
        middle_value = xnpv(middle, cash_flows)
        if abs(middle_value) < 1e-8:
            return _decimal(middle)
        if low_value * middle_value <= 0:
            high = middle
        else:
            low = middle
            low_value = middle_value
    return _decimal((low + high) / 2)


def _compound(returns: Iterable[Decimal]) -> Decimal:
    compounded = Decimal("1")
    for value in returns:
        compounded *= Decimal("1") + value
    return compounded - Decimal("1")


def calculate_performance_series(valuations: Sequence[DailyValuation]) -> list[PerformancePoint]:
    ordered = sorted(valuations, key=lambda point: point.valuation_date)
    results: list[PerformancePoint] = []
    valid_daily_returns: list[tuple[date, Decimal]] = []
    investor_flows: list[tuple[date, Decimal]] = []
    previous_nav: Decimal | None = None

    for valuation in ordered:
        if valuation.external_flow_eur != 0:
            # A deposit is positive portfolio cash but negative investor cash flow.
            investor_flows.append((valuation.valuation_date, -valuation.external_flow_eur))

        daily_return: Decimal | None = None
        if valuation.nav_eur is not None and previous_nav not in (None, ZERO):
            daily_return = (
                valuation.nav_eur - valuation.external_flow_eur - previous_nav
            ) / previous_nav
            valid_daily_returns.append((valuation.valuation_date, daily_return))

        if valuation.nav_eur is not None:
            previous_nav = valuation.nav_eur
        else:
            # Never bridge a return across a period whose NAV is unknown.
            previous_nav = None

        inception_returns = [value for _, value in valid_daily_returns]
        month_returns = [
            value
            for value_date, value in valid_daily_returns
            if value_date.year == valuation.valuation_date.year
            and value_date.month == valuation.valuation_date.month
        ]
        year_returns = [
            value
            for value_date, value in valid_daily_returns
            if value_date.year == valuation.valuation_date.year
        ]
        terminal_flows = list(investor_flows)
        if valuation.nav_eur is not None:
            terminal_flows.append((valuation.valuation_date, valuation.nav_eur))

        if valuation.nav_eur is None:
            data_state = "MISSING"
        elif not valuation.reconciled:
            data_state = "UNRECONCILED"
        elif valuation.coverage_pct < 100:
            data_state = "PARTIAL"
        else:
            data_state = "READY"

        results.append(
            PerformancePoint(
                performance_date=valuation.valuation_date,
                nav_eur=valuation.nav_eur,
                external_flow_eur=valuation.external_flow_eur,
                twr_daily=daily_return,
                twr_mtd=_compound(month_returns) if month_returns else None,
                twr_ytd=_compound(year_returns) if year_returns else None,
                twr_since_inception=_compound(inception_returns) if inception_returns else None,
                xirr_since_inception=xirr(terminal_flows),
                coverage_pct=valuation.coverage_pct,
                data_state=data_state,
            )
        )
    return results


def calculate_risk_snapshot(
    nav_history: Sequence[tuple[date, Decimal]],
    position_values: Sequence[Decimal],
    cash_eur: Decimal,
    illiquid_eur: Decimal,
    fx_exposed_eur: Decimal,
) -> dict[str, Decimal | None]:
    ordered_nav = [value for _, value in sorted(nav_history) if value > 0]
    total_nav = ordered_nav[-1] if ordered_nav else ZERO
    daily_returns = [
        float((current / previous) - Decimal("1"))
        for previous, current in zip(ordered_nav, ordered_nav[1:])
        if previous > 0
    ]
    recent_returns = daily_returns[-30:]
    volatility: Decimal | None = None
    if len(recent_returns) >= 2:
        mean = sum(recent_returns) / len(recent_returns)
        variance = sum((value - mean) ** 2 for value in recent_returns) / (len(recent_returns) - 1)
        volatility = _decimal(math.sqrt(variance) * math.sqrt(252) * 100)

    peak = ZERO
    max_drawdown = ZERO
    for nav in ordered_nav:
        peak = max(peak, nav)
        if peak > 0:
            max_drawdown = min(max_drawdown, (nav / peak) - Decimal("1"))

    sorted_positions = sorted((value for value in position_values if value > 0), reverse=True)
    return {
        "volatility_30d_pct": volatility,
        "max_drawdown_ytd_pct": max_drawdown * 100 if ordered_nav else None,
        "largest_position_pct": (sorted_positions[0] / total_nav * 100) if sorted_positions and total_nav else None,
        "top10_concentration_pct": (sum(sorted_positions[:10], ZERO) / total_nav * 100) if total_nav else None,
        "cash_pct": (cash_eur / total_nav * 100) if total_nav else None,
        "illiquid_pct": (illiquid_eur / total_nav * 100) if total_nav else None,
        "fx_exposure_pct": (fx_exposed_eur / total_nav * 100) if total_nav else None,
    }
