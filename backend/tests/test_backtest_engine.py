import pandas as pd

from backtest.engine import (
    BacktestConfig,
    compute_kpis,
    get_contribution_dates,
    is_rebalance_date,
    simulate_nav,
    simulate_nav_with_holdings,
)


def make_prices(start: str, end: str, columns: dict[str, list[float]]) -> pd.DataFrame:
    index = pd.bdate_range(start=start, end=end)
    data = {}
    for ticker, values in columns.items():
        if len(values) == 1:
            data[ticker] = [values[0]] * len(index)
        else:
            if len(values) != len(index):
                raise ValueError("values length mismatch")
            data[ticker] = values
    return pd.DataFrame(data, index=index)


def test_nav_simple_single_asset_no_fee_no_rebalance():
    prices = make_prices("2020-01-01", "2020-01-03", {"AAA": [10, 11, 12]})
    config = BacktestConfig(
        initial_cash=100,
        recurring_cash=0,
        recurring_frequency="none",
        recurring_day=1,
        rebalance_frequency="none",
        fee_bps=0,
        date_mode="common_start",
        inflation_adjusted=False,
    )
    nav = simulate_nav(prices, {"AAA": 100}, config)["nav"].tolist()
    assert nav == [100.0, 110.0, 120.0]


def test_dca_monthly_dates():
    prices = make_prices("2020-01-01", "2020-03-31", {"AAA": [10]})
    config = BacktestConfig(
        initial_cash=0,
        recurring_cash=100,
        recurring_frequency="monthly",
        recurring_day=1,
        rebalance_frequency="none",
        fee_bps=0,
        date_mode="common_start",
        inflation_adjusted=False,
    )
    nav_df = simulate_nav(prices, {"AAA": 100}, config)
    contribution_dates = get_contribution_dates(prices.index, "monthly", 1)
    total = 0.0
    for dt in prices.index:
        if dt in contribution_dates:
            total += 100.0
        assert nav_df.loc[dt, "nav"] == total


def test_rebalance_converges_to_target_weights():
    prices = make_prices("2020-01-01", "2020-04-30", {"AAA": [10], "BBB": [10]})
    # Make AAA trend up, BBB flat to force rebalance
    prices["AAA"] = prices["AAA"].values * (1 + 0.001 * pd.Series(range(len(prices)), index=prices.index))
    config = BacktestConfig(
        initial_cash=1000,
        recurring_cash=0,
        recurring_frequency="none",
        recurring_day=1,
        rebalance_frequency="monthly",
        fee_bps=0,
        date_mode="common_start",
        inflation_adjusted=False,
    )
    nav_df, holdings = simulate_nav_with_holdings(prices, {"AAA": 50, "BBB": 50}, config)
    previous = None
    for dt in nav_df.index:
        if is_rebalance_date(dt, previous, "monthly"):
            total_value = holdings.loc[dt, "AAA"] * prices.loc[dt, "AAA"] + holdings.loc[dt, "BBB"] * prices.loc[dt, "BBB"]
            weight_aaa = (holdings.loc[dt, "AAA"] * prices.loc[dt, "AAA"]) / total_value
            weight_bbb = (holdings.loc[dt, "BBB"] * prices.loc[dt, "BBB"]) / total_value
            assert abs(weight_aaa - 0.5) < 1e-6
            assert abs(weight_bbb - 0.5) < 1e-6
        previous = dt


def test_kpis_basic():
    prices = make_prices("2020-01-01", "2020-12-31", {"AAA": [10]})
    config = BacktestConfig(
        initial_cash=100,
        recurring_cash=0,
        recurring_frequency="none",
        recurring_day=1,
        rebalance_frequency="none",
        fee_bps=0,
        date_mode="common_start",
        inflation_adjusted=False,
    )
    nav_df = simulate_nav(prices, {"AAA": 100}, config)
    kpis = compute_kpis(nav_df)
    assert kpis["max_drawdown"] <= 0
    assert kpis["cagr"] is not None
    expected_cagr = (nav_df["nav"].iloc[-1] / nav_df["nav"].iloc[0]) ** (365 / 365) - 1
    assert abs(kpis["cagr"] - expected_cagr) < 1e-6
