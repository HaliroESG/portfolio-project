from datetime import date

import pandas as pd

from equity_publications import (
    PublicationUniverseRecord,
    build_ttm_summary,
    infer_fiscal_period,
    match_events_to_periods,
    merge_reporting_events,
    normalize_calendar_frame,
    normalize_interim_financials,
    normalize_sec_submissions,
    normalize_index_keys,
    reporting_event_key,
)


def record(
    symbol: str = "AAPL",
    *,
    fiscal_year_end_month: int = 9,
    source_index: str = "S&P 500",
) -> PublicationUniverseRecord:
    return PublicationUniverseRecord(
        instrument_key=f"global_yahoo:{symbol.lower()}",
        ticker=symbol,
        name=symbol,
        provider_symbol=symbol,
        source_index=source_index,
        currency="USD" if source_index == "S&P 500" else "EUR",
        country="US" if source_index == "S&P 500" else "FR",
        fiscal_year_end_month=fiscal_year_end_month,
        annual_periods=((2025, date(2025, fiscal_year_end_month, 30)),),
    )


def financial_frames(periods: int = 4):
    columns = pd.to_datetime(
        ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30"][:periods]
    )
    income = pd.DataFrame(
        [
            [100.0, 90.0, 80.0, 70.0][:periods],
            [25.0, 22.0, 20.0, 18.0][:periods],
            [20.0, 18.0, 16.0, 14.0][:periods],
            [15.0, 14.0, 12.0, 10.0][:periods],
            [1.5, 1.4, 1.2, 1.0][:periods],
        ],
        index=[
            "Total Revenue",
            "EBITDA",
            "Operating Income",
            "Net Income",
            "Diluted EPS",
        ],
        columns=columns,
    )
    cashflow = pd.DataFrame(
        [
            [18.0, 17.0, 16.0, 15.0][:periods],
            [-3.0, -3.0, -2.0, -2.0][:periods],
        ],
        index=["Operating Cash Flow", "Capital Expenditure"],
        columns=columns,
    )
    return income, cashflow


def test_infers_fiscal_quarters_for_non_calendar_fiscal_year():
    assert infer_fiscal_period(date(2025, 12, 31), 9) == (2026, "Q1")
    assert infer_fiscal_period(date(2026, 3, 31), 9) == (2026, "Q2")
    assert infer_fiscal_period(date(2026, 6, 30), 9) == (2026, "Q3")
    assert infer_fiscal_period(date(2026, 9, 30), 9) == (2026, "Q4")


def test_normalizes_publication_index_names_without_losing_memberships():
    assert normalize_index_keys(("CAC 40", "S&P 500")) == ("cac_40", "sp500")
    assert normalize_index_keys(("cac_40", "CAC 40")) == ("cac_40",)


def test_normalizes_quarterly_metrics_and_marks_derived_fcf():
    income, cashflow = financial_frames()

    rows = normalize_interim_financials(record(), income, cashflow)

    assert len(rows) == 4
    latest = rows[-1]
    assert latest.period_kind == "Q3"
    assert latest.revenue == 100.0
    assert latest.ebitda == 25.0
    assert latest.free_cash_flow == 15.0
    assert latest.data_state == "READY"
    assert "FCF_DERIVED" in latest.reason_codes


def test_empty_cac_quarterly_frames_do_not_fabricate_values():
    empty = pd.DataFrame()

    rows = normalize_interim_financials(
        record("MC.PA", fiscal_year_end_month=12, source_index="CAC 40"),
        empty,
        empty,
    )

    assert rows == []


def test_ttm_requires_four_complete_sequential_quarters():
    income, cashflow = financial_frames(periods=3)
    three_rows = normalize_interim_financials(record(), income, cashflow)
    assert build_ttm_summary(three_rows) is None

    income, cashflow = financial_frames(periods=4)
    four_rows = normalize_interim_financials(record(), income, cashflow)
    summary = build_ttm_summary(four_rows)
    assert summary is not None
    assert summary["revenue"] == 340.0
    assert summary["free_cash_flow"] == 56.0


def test_calendar_event_key_is_stable_for_a_fiscal_slot():
    frame = pd.DataFrame(
        [
            {
                "Event Name": "Q3 2026 Earnings Announcement",
                "Event Start Date": pd.Timestamp("2026-07-30T20:00:00Z"),
                "Timing": "AMC",
                "EPS Estimate": 1.89,
                "Reported EPS": None,
                "Surprise(%)": None,
            }
        ],
        index=["AAPL"],
    )
    first = normalize_calendar_frame(
        {"AAPL": record()},
        frame,
        today=date(2026, 7, 27),
    )[0]
    revised_key = reporting_event_key(
        first.instrument_key,
        first.event_type,
        first.source_provider,
        date(2026, 7, 31),
        fiscal_year=2026,
        period_kind="Q3",
    )

    assert first.status == "ESTIMATED"
    assert first.event_key == revised_key


def test_calendar_slot_event_deduplicates_same_day_ticker_event():
    global_frame = pd.DataFrame(
        [
            {
                "Event Name": "Q3 2026 Earnings Announcement",
                "Event Start Date": pd.Timestamp("2026-07-30T20:00:00Z"),
                "EPS Estimate": 1.89,
            }
        ],
        index=["AAPL"],
    )
    ticker_frame = pd.DataFrame(
        [{"EPS Estimate": 1.89, "Reported EPS": None}],
        index=[pd.Timestamp("2026-07-30T20:00:00Z")],
    )
    from equity_publications import normalize_earnings_frame

    events = merge_reporting_events(
        [
            *normalize_calendar_frame(
                {"AAPL": record()},
                global_frame,
                today=date(2026, 7, 27),
            ),
            *normalize_earnings_frame(
                record(),
                ticker_frame,
                today=date(2026, 7, 27),
            ),
        ]
    )

    assert len(events) == 1
    assert events[0].event_key.endswith("q3-2026")


def test_reported_events_are_mapped_to_the_closest_unmatched_period():
    income, cashflow = financial_frames()
    financials = normalize_interim_financials(record(), income, cashflow)
    frame = pd.DataFrame(
        [
            {
                "Event Name": "Q3 2026 Earnings Announcement",
                "Event Start Date": pd.Timestamp("2026-07-30T20:00:00Z"),
                "Reported EPS": 1.5,
            }
        ],
        index=["AAPL"],
    )
    event = normalize_calendar_frame(
        {"AAPL": record()},
        frame,
        today=date(2026, 8, 1),
    )[0]

    matched = match_events_to_periods([event], financials, ())

    assert matched[0].fiscal_period_end == date(2026, 6, 30)
    assert matched[0].period_kind == "Q3"
    assert matched[0].match_confidence == "INFERRED"


def test_sec_filings_keep_official_report_and_filing_dates():
    payload = {
        "cik": "320193",
        "filings": {
            "recent": {
                "form": ["10-Q", "8-K"],
                "filingDate": ["2026-05-01", "2026-05-01"],
                "reportDate": ["2026-03-28", ""],
                "accessionNumber": ["0000320193-26-000050", "x"],
                "primaryDocument": ["aapl-20260328.htm", "x.htm"],
            }
        },
    }

    events = normalize_sec_submissions(record(), payload)

    assert len(events) == 1
    assert events[0].event_type == "REGULATORY_FILING"
    assert events[0].event_date == date(2026, 5, 1)
    assert events[0].fiscal_period_end == date(2026, 3, 28)
    assert events[0].match_confidence == "HIGH"
