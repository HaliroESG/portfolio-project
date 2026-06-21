from __future__ import annotations

from equity_screener import build_screener_rows, deduplicate_screener_rows, run_equity_screener_sync


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
            "regression_slope_pct": 12,
            "regression_z_score": 1.2,
            "ma200_state": "ABOVE",
            "momentum_3m_pct": 8,
            "momentum_12m_pct": 22,
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
            "regression_slope_pct": 9,
            "regression_z_score": 0.4,
            "ma200_state": "ABOVE",
            "momentum_3m_pct": 5,
            "momentum_12m_pct": 18,
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
            "regression_slope_pct": 6,
            "regression_z_score": 0.9,
            "ma200_state": "ABOVE",
            "momentum_3m_pct": 4,
            "momentum_12m_pct": 12,
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
            "regression_slope_pct": -2,
            "regression_z_score": -1.1,
            "ma200_state": "BELOW",
            "momentum_3m_pct": -4,
            "momentum_12m_pct": -8,
        },
    ]


def _coverage():
    return [
        {"ticker": "ACN", "earliest_date": "2001-07-19", "coverage_pct": 87.4},
        {"ticker": "CAP.PA", "earliest_date": "2000-01-03", "coverage_pct": 94.9},
        {"ticker": "INFY.NS", "earliest_date": "2000-01-03", "coverage_pct": 94.9},
        {"ticker": "TM", "earliest_date": None, "coverage_pct": None},
    ]


def _currencies():
    return [
        {"id": "USD", "rate_to_eur": 0.92, "last_update": "2026-06-19T18:00:00+00:00"},
        {"id": "GBP", "rate_to_eur": 1.18, "last_update": "2026-06-19T18:00:00+00:00"},
        {"id": "JPY", "rate_to_eur": 0.0062, "last_update": "2026-06-19T18:00:00+00:00"},
        {"id": "KRW", "rate_to_eur": 0.00062, "last_update": "2026-06-19T18:00:00+00:00"},
        {"id": "INR", "rate_to_eur": 0.0099, "last_update": "2026-06-19T18:00:00+00:00"},
    ]


def test_world_sample_screener_classifies_it_services_and_value_candidates():
    rows = build_screener_rows(_world_universe(), _financials(), _trident_results(), _insights(), _coverage())
    by_key = {row["instrument_key"]: row for row in rows}

    assert "IT_SERVICES" in by_key["global_yahoo:acn"]["themes"]
    assert "IT_SERVICES" in by_key["global_yahoo:cap.pa"]["themes"]
    assert "IT_SERVICES" in by_key["global_yahoo:infy.ns"]["themes"]
    assert "IT_SERVICES" not in by_key["global_yahoo:tm"]["themes"]
    assert by_key["global_yahoo:cap.pa"]["valuation_tag"] == "POTENTIAL_VALUE"
    assert by_key["global_yahoo:tm"]["valuation_tag"] == "EXPENSIVE"
    assert round(by_key["global_yahoo:acn"]["target_upside"], 6) == 0.2
    assert by_key["global_yahoo:acn"]["regression_slope_pct"] == 12
    assert by_key["global_yahoo:acn"]["price_coverage_pct"] == 87.4
    assert "MOMENTUM_TREND" in by_key["global_yahoo:acn"]["score_details"]["strategy_tags"]


def test_market_cap_usd_conversion_keeps_source_currency_visible():
    rows = build_screener_rows(
        _world_universe(),
        _financials(),
        _trident_results(),
        _insights(),
        _coverage(),
        _currencies(),
    )
    by_key = {row["instrument_key"]: row for row in rows}

    assert by_key["global_yahoo:acn"]["market_cap_usd"] == 120_000_000_000
    assert by_key["global_yahoo:acn"]["market_cap_fx_rate"] == 1
    assert round(by_key["global_yahoo:cap.pa"]["market_cap_usd"], 2) == round(25_000_000_000 / 0.92, 2)
    assert round(by_key["global_yahoo:infy.ns"]["market_cap_usd"], 2) == round(6_500_000_000_000 * 0.0099 / 0.92, 2)
    assert by_key["global_yahoo:tm"]["market_cap_fx_as_of"] == "2026-06-19T18:00:00+00:00"
    assert "MARKET_CAP_USD_UNAVAILABLE" not in by_key["global_yahoo:cap.pa"]["data_state"]


def test_market_cap_usd_missing_fx_stays_explicit():
    rows = build_screener_rows(
        [_world_universe()[2]],
        _financials(),
        _trident_results(),
        [_insights()[2]],
        _coverage(),
        [{"id": "USD", "rate_to_eur": 0.92, "last_update": "2026-06-19T18:00:00+00:00"}],
    )

    assert rows[0]["market_cap_usd"] is None
    assert rows[0]["market_cap_fx_rate"] is None
    assert "FX_RATE_UNAVAILABLE" in rows[0]["data_state"]
    assert "MARKET_CAP_USD_UNAVAILABLE" in rows[0]["data_state"]


def test_market_cap_usd_stale_fx_stays_explicit():
    stale_currencies = [
        {"id": "USD", "rate_to_eur": 0.92, "last_update": "2026-01-02T18:00:00+00:00"},
        {"id": "INR", "rate_to_eur": 0.0099, "last_update": "2026-01-02T18:00:00+00:00"},
    ]
    rows = build_screener_rows(
        [_world_universe()[2]],
        _financials(),
        _trident_results(),
        [_insights()[2]],
        _coverage(),
        stale_currencies,
    )

    assert rows[0]["market_cap_usd"] is not None
    assert "FX_RATE_STALE" in rows[0]["data_state"]
    assert "MARKET_CAP_USD_UNAVAILABLE" not in rows[0]["data_state"]


def test_it_services_universe_keeps_insufficient_rows_visible():
    insights = [row for row in _insights() if row["instrument_key"] != "global_yahoo:cap.pa"]
    rows = build_screener_rows(
        _world_universe()[:2],
        _financials(),
        _trident_results(),
        insights,
        _coverage(),
    )
    it_services = [row for row in rows if "IT_SERVICES" in row["themes"]]
    by_key = {row["instrument_key"]: row for row in it_services}

    assert set(by_key) == {"global_yahoo:acn", "global_yahoo:cap.pa"}
    assert by_key["global_yahoo:acn"]["valuation_tag"] == "POTENTIAL_VALUE"
    assert by_key["global_yahoo:cap.pa"]["valuation_tag"] == "INSUFFICIENT_DATA"
    assert "INSIGHTS_UNAVAILABLE" in by_key["global_yahoo:cap.pa"]["data_state"]


def test_missing_forecast_and_forward_metrics_stay_explicit():
    insights = [row for row in _insights() if row["instrument_key"] != "global_yahoo:acn"]
    rows = build_screener_rows([_world_universe()[0]], _financials(), _trident_results(), insights, _coverage())

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


def test_missing_price_history_stays_explicit_without_changing_score():
    rows = build_screener_rows([_world_universe()[0]], _financials(), _trident_results(), _insights())

    assert rows[0]["quality_value_score"] > 0
    assert rows[0]["price_coverage_pct"] is None
    assert "PRICE_HISTORY_UNAVAILABLE" in rows[0]["data_state"]


def test_deduplicate_screener_rows_prefers_complete_global_provider():
    rows = [
        {
            "instrument_key": "portfolio_seed:rey.mi",
            "ticker": "REY.MI",
            "provider": "portfolio_seed",
            "source_index": "portfolio",
            "quality_value_score": 20,
            "market_cap": 3_000_000_000,
            "data_state": [
                "FINANCIALS_UNAVAILABLE",
                "FCF_YIELD_UNAVAILABLE",
                "INSIGHTS_UNAVAILABLE",
            ],
        },
        {
            "instrument_key": "global_yahoo:rey.mi",
            "ticker": "REY.MI",
            "provider": "global_yahoo",
            "source_index": "Curated IT Services",
            "quality_value_score": 94,
            "market_cap": 3_400_000_000,
            "data_state": ["FORECAST_UNAVAILABLE"],
        },
    ]

    canonical, stats = deduplicate_screener_rows(rows)

    assert len(canonical) == 1
    assert canonical[0]["instrument_key"] == "global_yahoo:rey.mi"
    assert stats["duplicates_suppressed"] == 1


def test_dry_run_sync_reports_global_theme_and_country_coverage():
    supabase = _FakeSupabase({
        "trident_equity_universe": _world_universe(),
        "trident_financial_annual": _financials(),
        "trident_results": _trident_results(),
        "trident_stock_insights": _insights(),
        "historical_price_coverage": _coverage(),
        "currencies": _currencies(),
        "equity_screener_results": [],
    })

    stats = run_equity_screener_sync(supabase, dry_run=True)

    assert stats["screener_rows"] == 4
    assert stats["raw_screener_rows"] == 4
    assert stats["theme_counts"]["IT_SERVICES"] == 3
    assert stats["strategy_counts"]["MOMENTUM_TREND"] >= 1
    assert stats["country_counts"]["US"] == 1
    assert stats["country_counts"]["FR"] == 1
    assert stats["country_counts"]["IN"] == 1
    assert stats["valuation_tag_counts"]["POTENTIAL_VALUE"] >= 1
    assert stats["financials_coverage_pct"] == 100.0
    assert stats["insights_coverage_pct"] == 100.0
    assert stats["fx_coverage_pct"] == 100.0
    assert stats["quality_gate_failures"]
