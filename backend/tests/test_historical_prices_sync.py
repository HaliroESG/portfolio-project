import pandas as pd

import historical_prices_sync
from historical_prices_sync import (
    PriceTarget,
    build_price_payloads,
    build_ticker_currency_map,
    fetch_trident_price_targets,
    run_sync,
)


class _FakeResponse:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows
        self._filters = []
        self._range = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self._filters.append((column, value))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        rows = list(self._rows)
        for column, value in self._filters:
            rows = [row for row in rows if row.get(column) == value]
        if self._range:
            start, end = self._range
            rows = rows[start:end + 1]
        return _FakeResponse(rows)


class _FakeSupabase:
    def __init__(self, tables):
        self._tables = tables

    def table(self, name):
        return _FakeQuery(self._tables.get(name, []))


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


def test_fetch_trident_price_targets_uses_provider_symbol_and_currency():
    supabase = _FakeSupabase({
        "trident_equity_universe": [
            {
                "ticker": "air.pa",
                "provider_symbol": "AI.PA",
                "currency": "eur",
                "source_index": "CAC 40",
                "provider": "global_yahoo",
                "is_active": True,
            },
            {
                "ticker": "old.pa",
                "provider_symbol": "OLD.PA",
                "currency": "EUR",
                "source_index": "CAC 40",
                "provider": "global_yahoo",
                "is_active": False,
            },
        ],
    })

    targets = fetch_trident_price_targets(supabase)

    assert set(targets) == {"AIR.PA"}
    assert targets["AIR.PA"].ticker == "AIR.PA"
    assert targets["AIR.PA"].provider_symbol == "AI.PA"
    assert targets["AIR.PA"].currency == "EUR"
    assert targets["AIR.PA"].source_index == "CAC 40"


def test_build_ticker_currency_map_trusts_trident_currency(monkeypatch):
    calls = []

    def fake_fetch_currency_from_yfinance(ticker):
        calls.append(ticker)
        return "USD"

    monkeypatch.setattr(
        historical_prices_sync,
        "fetch_currency_from_yfinance",
        fake_fetch_currency_from_yfinance,
    )

    mapping = build_ticker_currency_map(
        None,
        [PriceTarget("AIR.PA", "AI.PA", currency="EUR", source_index="CAC 40")],
    )

    assert mapping == {"AIR.PA": "EUR"}
    assert calls == []


def test_run_sync_downloads_provider_symbol_but_stores_trident_ticker(monkeypatch):
    dates = pd.to_datetime(["2026-01-02", "2026-01-05"])
    downloaded = []
    upserted = []
    coverage = []

    def fake_download(symbol, _start, _end):
        downloaded.append(symbol)
        if symbol == "AI.PA":
            return pd.Series([100.0, 102.0], index=dates)
        return None

    def fake_upsert_rows(_supabase, table, rows, chunk_size=1000):
        assert table == "historical_prices"
        assert chunk_size == 1000
        upserted.extend(rows)
        return len(rows)

    def fake_upsert_coverage(_supabase, ticker, start, end, earliest, coverage_pct, used_proxy):
        coverage.append({
            "ticker": ticker,
            "start": start,
            "end": end,
            "earliest": earliest,
            "coverage_pct": coverage_pct,
            "used_proxy": used_proxy,
        })

    monkeypatch.setattr(historical_prices_sync, "download_price_series", fake_download)
    monkeypatch.setattr(historical_prices_sync, "upsert_rows", fake_upsert_rows)
    monkeypatch.setattr(historical_prices_sync, "upsert_coverage", fake_upsert_coverage)
    monkeypatch.setattr(historical_prices_sync, "get_proxy_map", lambda: {})

    stats = run_sync(
        None,
        pd.Timestamp("2026-01-01").date(),
        pd.Timestamp("2026-01-10").date(),
        [PriceTarget("AIR.PA", "AI.PA", currency="EUR", source_index="CAC 40")],
    )

    assert downloaded == ["AI.PA"]
    assert [row["ticker"] for row in upserted] == ["AIR.PA", "AIR.PA"]
    assert upserted[0]["adj_close_local"] == 100.0
    assert upserted[0]["local_currency"] == "EUR"
    assert coverage[0]["ticker"] == "AIR.PA"
    assert stats["tickers_ok"] == 1
    assert stats["source_indexes"]["CAC 40"]["tickers_requested"] == 1
    assert stats["source_indexes"]["CAC 40"]["tickers_with_prices"] == 1


def test_run_sync_records_source_index_errors(monkeypatch):
    monkeypatch.setattr(historical_prices_sync, "download_price_series", lambda *_args: None)
    monkeypatch.setattr(historical_prices_sync, "upsert_coverage", lambda *_args: None)

    stats = run_sync(
        None,
        pd.Timestamp("2026-01-01").date(),
        pd.Timestamp("2026-01-10").date(),
        [PriceTarget("000080.KS", "000080.KS", currency="KRW", source_index="KOSPI 200")],
    )

    bucket = stats["source_indexes"]["KOSPI 200"]
    assert stats["tickers_failed"] == 1
    assert bucket["tickers_requested"] == 1
    assert bucket["tickers_without_prices"] == 1
    assert bucket["errors"][0]["ticker"] == "000080.KS"
    assert bucket["errors"][0]["error"] == "no_price_history"
