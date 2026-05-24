from trident_screener import (
    FinancialRecord,
    GLOBAL_INDEX_SOURCES,
    GlobalYahooDataProvider,
    PortfolioSeedDataProvider,
    UniverseRecord,
    compute_trident_for_instrument,
    run_trident_sync,
    yahoo_safe_symbol,
)


class _FakeResponse:
    def __init__(self, data):
        self.data = data


class _FakeTable:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def execute(self):
        return _FakeResponse(self.rows)


class _FakeSupabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _FakeTable(self.tables.get(name, []))


def build_records(
    *,
    years: range = range(2015, 2026),
    roic_override: float | None = None,
    debt_multiple: float = 1.0,
    interest_coverage: float = 20.0,
) -> list[FinancialRecord]:
    records: list[FinancialRecord] = []
    for index, year in enumerate(years):
        revenue = 100.0 * (1.15 ** index)
        eps = 1.0 * (1.18 ** index)
        gross_profit = revenue * 0.52
        operating_income = revenue * 0.24
        net_income = revenue * 0.19
        free_cash_flow = revenue * 0.16
        target_roic = roic_override if roic_override is not None else 0.24
        invested_capital = operating_income / target_roic
        total_equity = net_income / 0.20
        capital_employed = operating_income / 0.22
        ebitda = operating_income * 1.2
        total_debt = total_equity * 0.2 if debt_multiple <= 1 else total_equity * 0.8
        records.append(
            FinancialRecord(
                instrument_key="csv:pass",
                fiscal_year=year,
                currency="USD",
                revenue=revenue,
                eps_diluted=eps,
                free_cash_flow=free_cash_flow,
                gross_profit=gross_profit,
                operating_income=operating_income,
                net_income=net_income,
                invested_capital=invested_capital,
                total_equity=total_equity,
                capital_employed=capital_employed,
                ebitda=ebitda,
                net_debt=ebitda * debt_multiple,
                interest_expense=operating_income / interest_coverage,
                total_debt=total_debt,
                shares_diluted=100.0 - index,
            )
        )
    return records


def criterion_rows(result, horizon: int, key: str):
    return [
        row
        for row in result.criterion_rows
        if row["horizon_years"] == horizon and row["criterion_key"] == key
    ]


def test_complete_company_passes_trident():
    result = compute_trident_for_instrument("csv:pass", build_records())

    assert result.result_row["overall_state"] == "QUALIFIED"
    assert result.result_row["score"] == 100
    assert result.result_row["confidence"] == 100
    assert result.result_row["horizons"]["10"]["status"] == "complete"
    assert criterion_rows(result, 10, "roic")[0]["status"] == "pass"


def test_partial_data_keeps_missing_visible_without_frontend_guessing():
    result = compute_trident_for_instrument("csv:partial", build_records(years=range(2025, 2026)))

    assert result.result_row["overall_state"] == "WATCHLIST"
    assert result.result_row["confidence"] < 100
    assert result.result_row["horizons"]["3"]["status"] == "missing"
    assert criterion_rows(result, 3, "revenue_cagr")[0]["status"] == "missing"


def test_empty_financial_history_keeps_no_data_explicit():
    result = compute_trident_for_instrument("portfolio_seed:aapl", [])

    assert result.result_row["overall_state"] == "NO_DATA"
    assert result.result_row["score"] == 0
    assert result.result_row["confidence"] == 0
    assert result.result_row["latest_fiscal_year"] is None
    assert criterion_rows(result, 1, "revenue_cagr")[0]["status"] == "missing"


def test_portfolio_seed_provider_builds_equity_universe_without_financials():
    supabase = _FakeSupabase(
        {
            "portfolio_positions": [
                {
                    "ticker": "CW8.PA",
                    "name": "MSCI World ETF",
                    "instrument_type": "ETF",
                    "currency": "EUR",
                    "updated_at": "2026-05-24T10:00:00+00:00",
                },
                {
                    "ticker": "AAPL",
                    "name": "Apple older",
                    "instrument_type": "STOCK",
                    "currency": "USD",
                    "updated_at": "2026-01-01T10:00:00+00:00",
                },
                {
                    "ticker": "AAPL",
                    "name": "Apple",
                    "instrument_type": "ACTION",
                    "currency": "USD",
                    "updated_at": "2026-05-24T10:00:00+00:00",
                },
                {
                    "ticker": "AI.PA",
                    "name": "Air Liquide",
                    "instrument_type": "ACTION",
                    "currency": "EUR",
                    "updated_at": "2026-05-24T10:00:00+00:00",
                },
            ],
            "market_watch": [],
        }
    )
    provider = PortfolioSeedDataProvider(supabase)

    universe = provider.fetch_universe()

    assert [record.ticker for record in universe] == ["AAPL", "AI.PA"]
    assert universe[0].country == "US"
    assert universe[1].exchange == "Euronext Paris"
    assert provider.fetch_financials(universe) == []


def test_global_yahoo_provider_builds_world_index_universe(monkeypatch):
    import pandas as pd

    provider = GlobalYahooDataProvider(indexes=("sp500", "kospi_200"), sleep_seconds=0)

    def fake_tables(source):
        if source.key == "sp500":
            return [
                pd.DataFrame(
                    [
                        {
                            "Symbol": "BRK.B",
                            "Security": "Berkshire Hathaway",
                            "GICS Sector": "Financials",
                            "GICS Sub-Industry": "Multi-Sector Holdings",
                        }
                    ]
                    * 10
                )
            ]
        if source.key == "kospi_200":
            return [
                pd.DataFrame(
                    [
                        {
                            "Company": "Samsung Electronics",
                            "Symbol": "005930",
                            "GICS Sector": "Information Technology",
                        }
                    ]
                    * 10
                )
            ]
        raise AssertionError(source.key)

    monkeypatch.setattr(provider, "_fetch_index_tables", fake_tables)

    universe = provider.fetch_universe()

    assert [record.ticker for record in universe] == ["005930.KS", "BRK-B"]
    assert universe[0].exchange == "Korea Exchange"
    assert universe[0].country == "KR"
    assert universe[0].sector == "Information Technology"
    assert universe[0].source_index == "KOSPI 200"
    assert universe[1].country == "US"
    assert universe[1].industry == "Multi-Sector Holdings"
    assert universe[1].source_index == "S&P 500"


def test_global_yahoo_symbol_suffixes_do_not_double_encode_european_tickers():
    assert yahoo_safe_symbol("AI.PA", GLOBAL_INDEX_SOURCES["cac_40"]) == "AI.PA"
    assert yahoo_safe_symbol("ADS.DE", GLOBAL_INDEX_SOURCES["dax"]) == "ADS.DE"
    assert yahoo_safe_symbol("AIR.PA", GLOBAL_INDEX_SOURCES["dax"]) == "AIR.DE"
    assert yahoo_safe_symbol("AD.AS", GLOBAL_INDEX_SOURCES["euro_stoxx_50"], "NL") == "AD.AS"
    assert yahoo_safe_symbol("AD.AS", GLOBAL_INDEX_SOURCES["euro_stoxx_50"]) == "AD.AS"
    assert yahoo_safe_symbol("BRK.B", GLOBAL_INDEX_SOURCES["sp500"]) == "BRK-B"


def test_global_yahoo_provider_extracts_annual_financials_from_yfinance_frames():
    import pandas as pd

    column = pd.Timestamp("2025-12-31")

    class FakeTicker:
        income_stmt = pd.DataFrame(
            {
                column: {
                    "Total Revenue": 1000.0,
                    "Diluted EPS": 5.0,
                    "Gross Profit": 520.0,
                    "Operating Income": 240.0,
                    "Net Income": 190.0,
                    "EBITDA": 288.0,
                    "Interest Expense": -12.0,
                    "Diluted Average Shares": 90.0,
                }
            }
        )
        balance_sheet = pd.DataFrame(
            {
                column: {
                    "Invested Capital": 1000.0,
                    "Stockholders Equity": 950.0,
                    "Capital Employed": 1090.0,
                    "Total Debt": 200.0,
                    "Cash And Cash Equivalents": 50.0,
                }
            }
        )
        cashflow = pd.DataFrame(
            {
                column: {
                    "Operating Cash Flow": 180.0,
                    "Capital Expenditure": -40.0,
                }
            }
        )

        def get_info(self):
            return {"financialCurrency": "USD"}

    class FakeYfinance:
        @staticmethod
        def Ticker(_symbol):
            return FakeTicker()

    provider = GlobalYahooDataProvider(indexes=("sp500",), sleep_seconds=0)
    records = provider._records_for_symbol(
        FakeYfinance,
        UniverseRecord(
            instrument_key="global_yahoo:aapl",
            ticker="AAPL",
            name="Apple",
            exchange="US listed",
            country="US",
            sector="Information Technology",
            industry=None,
            currency="USD",
            isin=None,
            provider="global_yahoo",
            provider_symbol="AAPL",
            source_license_note=None,
        ),
    )

    assert len(records) == 1
    assert records[0].fiscal_year == 2025
    assert records[0].free_cash_flow == 140.0
    assert records[0].net_debt == 150.0
    assert records[0].source_url == "https://finance.yahoo.com/quote/AAPL/financials"


def test_roic_failure_is_eliminating():
    result = compute_trident_for_instrument("csv:low-roic", build_records(roic_override=0.08))

    assert result.result_row["overall_state"] == "REJECTED"
    assert "roic" in result.result_row["failed_eliminators"]
    roic_rows = criterion_rows(result, 5, "roic")
    assert roic_rows[0]["status"] == "fail"
    assert roic_rows[0]["is_eliminating"] is True


def test_highly_indebted_company_fails_health_criteria():
    result = compute_trident_for_instrument(
        "csv:debt",
        build_records(debt_multiple=4.2, interest_coverage=6.0),
    )

    assert result.result_row["overall_state"] == "REJECTED"
    assert result.result_row["latest_net_debt_to_ebitda"] > 3
    assert criterion_rows(result, 1, "net_debt_to_ebitda")[0]["status"] == "fail"
    assert criterion_rows(result, 1, "net_debt_to_ebitda")[0]["is_eliminating"] is True
    assert criterion_rows(result, 1, "interest_coverage")[0]["status"] == "fail"
    assert criterion_rows(result, 1, "debt_to_equity")[0]["status"] == "fail"


def test_secondary_failures_do_not_reject_when_eliminators_pass():
    records = build_records(roic_override=0.24, debt_multiple=0.5)
    adjusted = [
        FinancialRecord(
            **{
                **record.__dict__,
                "gross_profit": record.revenue * 0.30,
                "net_income": record.revenue * 0.10,
            }
        )
        for record in records
    ]

    result = compute_trident_for_instrument("csv:watchlist", adjusted)

    assert result.result_row["overall_state"] != "REJECTED"
    assert result.result_row["score"] < 100
    assert result.result_row["summary"]["criteria_fail"] > 0
    assert result.result_row["failed_eliminators"] == []


class _FakeTridentProvider:
    provider_name = "fake"
    source_license_note = "fake"
    financial_errors = {"fake:missing": "no annual financial statements returned"}

    def fetch_universe(self):
        return [
            UniverseRecord(
                instrument_key="fake:covered",
                ticker="COVERED",
                name="Covered",
                exchange="Test",
                country="US",
                sector=None,
                industry=None,
                currency="USD",
                isin=None,
                provider=self.provider_name,
                provider_symbol="COVERED",
                source_license_note=self.source_license_note,
                source_index="Test Index",
            ),
            UniverseRecord(
                instrument_key="fake:missing",
                ticker="MISSING",
                name="Missing",
                exchange="Test",
                country="US",
                sector=None,
                industry=None,
                currency="USD",
                isin=None,
                provider=self.provider_name,
                provider_symbol="MISSING",
                source_license_note=self.source_license_note,
                source_index="Test Index",
            ),
        ]

    def fetch_financials(self, _universe):
        records = build_records(years=range(2024, 2026))
        return [
            FinancialRecord(
                **{
                    **record.__dict__,
                    "instrument_key": "fake:covered",
                    "provider": self.provider_name,
                }
            )
            for record in records
        ]


def test_trident_sync_stats_include_index_coverage_in_dry_run():
    stats = run_trident_sync(None, _FakeTridentProvider(), dry_run=True)

    assert stats["items_total"] == 2
    assert stats["items_success"] == 1
    assert stats["items_failed"] == 1
    assert stats["coverage_pct"] == 50
    assert stats["coverage_by_index"][0]["source_index"] == "Test Index"
    assert stats["coverage_by_index"][0]["financial_instruments"] == 1
    assert stats["coverage_by_index"][0]["missing_financials"] == 1
    assert stats["coverage_by_index"][0]["sample_errors"][0]["ticker"] == "MISSING"
