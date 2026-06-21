from __future__ import annotations

from equity_screener import build_screener_rows, run_equity_screener_sync


class _FakeResponse:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows):
        self._rows = list(rows)
        self._range = None
        self._upsert_rows = None

    def select(self, *_args, **_kwargs):
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def upsert(self, rows, **_kwargs):
        self._upsert_rows = list(rows)
        return self

    def execute(self):
        if self._upsert_rows is not None:
            return _FakeResponse(self._upsert_rows)
        rows = list(self._rows)
        if self._range is not None:
            start, end = self._range
            rows = rows[start:end + 1]
        return _FakeResponse(rows)


class _FakeSupabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _FakeQuery(self.tables.get(name, []))


def _world_universe():
    return [
        {
            "instrument_key": "global_yahoo:acn",
            "ticker": "ACN",
            "name": "Accenture plc",
            "exchange": "NYSE",
            "country": "US",
            "sector": "Information Technology",
            "industry": "Information Technology Services",
            "currency": "USD",
            "provider": "global_yahoo",
            "provider_symbol": "ACN",
            "source_index": "S&P 500",
            "is_active": True,
        },
        {
            "instrument_key": "global_yahoo:cap.pa",
            "ticker": "CAP.PA",
            "name": "Capgemini SE",
            "exchange": "Euronext Paris",
            "country": "FR",
            "sector": "Technology",
            "industry": "IT Consulting and Other Services",
            "currency": "EUR",
            "provider": "global_yahoo",
            "provider_symbol": "CAP.PA",
            "source_index": "CAC 40",
            "is_active": True,
        },
        {
            "instrument_key": "global_yahoo:infy.ns",
            "ticker": "INFY.NS",
            "name": "Infosys Limited",
            "exchange": "National Stock Exchange of India",
            "country": "IN",
            "sector": "Technology",
            "industry": "Information Technology Services",
            "currency": "INR",
            "provider": "global_yahoo",
            "provider_symbol": "INFY.NS",
            "source_index": "NIFTY 50",
            "is_active": True,
        },
        {
            "instrument_key": "global_yahoo:tm",
            "ticker": "TM",
            "name": "Toyota Motor Corporation",
            "exchange": "NYSE",
            "country": "JP",
            "sector": "Consumer Cyclical",
            "industry": "Auto Manufacturers",
            "currency": "JPY",
            "provider": "global_yahoo",
            "provider_symbol": "TM",
            "source_index": "World sample",
            "is_active": True,
        },
    ]


def _financials():
    rows = []
    for instrument_key, currency, base_revenue, fcf_margin in [
        ("global_yahoo:acn", "USD", 44_000_000_000, 0.14),
        ("global_yahoo:cap.pa", "EUR", 14_000_000_000, 0.11),
        ("global_yahoo:infy.ns", "INR", 1_100_000_000_000, 0.18),
        ("global_yahoo:tm", "JPY", 30_000_000_000_000, 0.03),
    ]:
        for index, year in enumerate(range(2020, 2025)):
            revenue = base_revenue * (1.07 ** index)
            rows.append({
                "instrument_key": instrument_key,
                "fiscal_year": year,
                "currency": currency,
                "revenue": revenue,
                "free_cash_flow": revenue * fcf_margin,
            })
    return rows


def _trident_results():
    return [
        {
            "instrument_key": "global_yahoo:acn",
            "overall_state": "QUALIFIED",
            "score": 88,
            "latest_roic": 0.22,
            "latest_net_debt_to_ebitda": 0.4,
        },
        {
            "instrument_key": "global_yahoo:cap.pa",
            "overall_state": "WATCHLIST",
            "score": 73,
            "latest_roic": 0.16,
            "latest_net_debt_to_ebitda": 1.8,
        },
        {
            "instrument_key": "global_yahoo:infy.ns",
            "overall_state": "QUALIFIED",
            "score": 91,
            "latest_roic": 0.31,
            "latest_net_debt_to_ebitda": -0.2,
        },
        {
            "instrument_key": "global_yahoo:tm",
            "overall_state": "WATCHLIST",
            "score": 44,
            "latest_roic": 0.07,
            "latest_net_debt_to_ebitda": 3.2,
        },
    ]


def _insights():
    return [
        {
            "instrument_key": "global_yahoo:acn",
            "market_cap": 120_000_000_000,
            "trailing_pe": 18,
            "forward_pe": 16,
            "latest_price": 300,
            "target_mean_price": 360,
            "price_currency": "USD",
            "recommendation_key": "buy",
            "number_of_analyst_opinions": 22,
        },
        {
            "instrument_key": "global_yahoo:cap.pa",
            "market_cap": 25_000_000_000,
            "trailing_pe": 13,
            "forward_pe": 11,
            "latest_price": 180,
            "target_mean_price": 230,
            "price_currency": "EUR",
            "recommendation_key": "buy",
            "number_of_analyst_opinions": 15,
        },
        {
            "instrument_key": "global_yahoo:infy.ns",
            "market_cap": 6_500_000_000_000,
            "trailing_pe": 24,
            "forward_pe": 20,
            "latest_price": 1500,
            "target_mean_price": 1650,
            "price_currency": "INR",
            "recommendation_key": "hold",
            "number_of_analyst_opinions": 36,
        },
        {
            "instrument_key": "global_yahoo:tm",
            "market_cap": 42_000_000_000_000,
            "trailing_pe": 42,
            "forward_pe": 38,
            "latest_price": 3000,
            "target_mean_price": 2900,
            "price_currency": "JPY",
            "recommendation_key": "hold",
            "number_of_analyst_opinions": 18,
        },
    ]


def test_world_sample_screener_classifies_it_services_and_value_candidates():
    rows = build_screener_rows(_world_universe(), _financials(), _trident_results(), _insights())
    by_key = {row["instrument_key"]: row for row in rows}

    assert "IT_SERVICES" in by_key["global_yahoo:acn"]["themes"]
    assert "IT_SERVICES" in by_key["global_yahoo:cap.pa"]["themes"]
    assert "IT_SERVICES" in by_key["global_yahoo:infy.ns"]["themes"]
    assert "IT_SERVICES" not in by_key["global_yahoo:tm"]["themes"]
    assert by_key["global_yahoo:cap.pa"]["valuation_tag"] == "POTENTIAL_VALUE"
    assert by_key["global_yahoo:tm"]["valuation_tag"] == "EXPENSIVE"
    assert round(by_key["global_yahoo:acn"]["target_upside"], 6) == 0.2


def test_missing_forecast_and_forward_metrics_stay_explicit():
    insights = [row for row in _insights() if row["instrument_key"] != "global_yahoo:acn"]
    rows = build_screener_rows([_world_universe()[0]], _financials(), _trident_results(), insights)

    assert rows[0]["forecast_revenue_growth"] is None
    assert "FORECAST_UNAVAILABLE" in rows[0]["data_state"]
    assert "INSIGHTS_UNAVAILABLE" in rows[0]["data_state"]
    assert "MARKET_CAP_UNAVAILABLE" in rows[0]["data_state"]


def test_currency_mismatch_blocks_fcf_yield_instead_of_guessing_fx():
    insight_rows = [
        {
            **_insights()[1],
            "price_currency": "USD",
        }
    ]
    rows = build_screener_rows([_world_universe()[1]], _financials(), _trident_results(), insight_rows)

    assert rows[0]["financial_currency"] == "EUR"
    assert rows[0]["valuation_currency"] == "USD"
    assert rows[0]["fcf_yield"] is None
    assert "CURRENCY_MISMATCH" in rows[0]["data_state"]
    assert "FCF_YIELD_UNAVAILABLE" in rows[0]["data_state"]


def test_dry_run_sync_reports_global_theme_and_country_coverage():
    supabase = _FakeSupabase({
        "trident_equity_universe": _world_universe(),
        "trident_financial_annual": _financials(),
        "trident_results": _trident_results(),
        "trident_stock_insights": _insights(),
    })

    stats = run_equity_screener_sync(supabase, dry_run=True)

    assert stats["screener_rows"] == 4
    assert stats["theme_counts"]["IT_SERVICES"] == 3
    assert stats["country_counts"]["US"] == 1
    assert stats["country_counts"]["FR"] == 1
    assert stats["country_counts"]["IN"] == 1
    assert stats["valuation_tag_counts"]["POTENTIAL_VALUE"] >= 1
