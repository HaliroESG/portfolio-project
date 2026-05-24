import pandas as pd

from historical_prices_sync import build_price_payloads


def test_build_price_payloads_keeps_eur_and_native_local_prices():
    dates = pd.to_datetime(["2026-01-02", "2026-01-05"])
    eur_prices = pd.Series([90.0, 108.0], index=dates)
    local_prices = pd.Series([100.0, 120.0], index=dates)
    sources = pd.Series("yfinance", index=dates)

    payloads = build_price_payloads(
        "ABC",
        eur_prices,
        sources,
        local_prices=local_prices,
        local_currency="USD",
    )

    assert payloads[0]["adj_close"] == 90.0
    assert payloads[0]["currency"] == "EUR"
    assert payloads[0]["adj_close_local"] == 100.0
    assert payloads[0]["local_currency"] == "USD"
    assert payloads[0]["fx_rate_to_eur"] == 0.9
    assert payloads[1]["adj_close_local"] == 120.0


def test_build_price_payloads_does_not_attach_local_price_to_proxy_segment():
    dates = pd.to_datetime(["2025-12-31", "2026-01-02"])
    eur_prices = pd.Series([75.0, 90.0], index=dates)
    local_prices = pd.Series([100.0], index=[pd.Timestamp("2026-01-02")])
    sources = pd.Series(["proxy:SPY", "yfinance"], index=dates)

    payloads = build_price_payloads(
        "ABC",
        eur_prices,
        sources,
        local_prices=local_prices,
        local_currency="USD",
    )

    assert payloads[0]["source"] == "proxy:SPY"
    assert payloads[0]["adj_close"] == 75.0
    assert payloads[0]["adj_close_local"] is None
    assert payloads[0]["local_currency"] is None
    assert payloads[0]["fx_rate_to_eur"] is None
    assert payloads[1]["source"] == "yfinance"
    assert payloads[1]["adj_close_local"] == 100.0
    assert payloads[1]["local_currency"] == "USD"
