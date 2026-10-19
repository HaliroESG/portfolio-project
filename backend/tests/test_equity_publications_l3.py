from dataclasses import replace
from datetime import date

import pandas as pd
import pytest

import equity_publications as ep
from test_equity_publications import record, financial_frames


def test_estimate_never_becomes_reported_by_advancing_clock():
    frame = pd.DataFrame([{"Reported EPS": None}], index=[pd.Timestamp("2026-10-17T23:30:00-04:00")])
    for today in (date(2026, 10, 17), date(2026, 10, 18), date(2027, 1, 1)):
        result = ep.normalize_earnings_frame(record(), frame, today=today)[0]
        assert result.status == "ESTIMATED"
        assert result.event_date == date(2026, 10, 17)
        assert result.event_time_utc.date() == date(2026, 10, 18)
    assert ep.parse_datetime("2026-10-17") is None
    assert ep.parse_datetime("2026-10-17T14:00:00") is None
    assert ep.parse_datetime("2026-03-29T03:30:00+02:00").hour == 1


def test_aggregator_actual_is_distinct_from_official_evidence():
    frame = pd.DataFrame([{"Reported EPS": 0}], index=[pd.Timestamp("2026-10-17T20:00:00Z")])
    result = ep.normalize_earnings_frame(record(), frame, today=date(2026, 10, 18))[0]
    assert result.status == "REPORTED"
    assert result.metadata["publication_evidence"]["basis"] == "AGGREGATOR_RESULT"
    matched = ep.match_events_to_periods([result], [], ((2026, date(2026, 9, 30)),))[0]
    assert matched.match_confidence == "INFERRED"
    assert matched.event_key == result.event_key
    assert matched.metadata == result.metadata
    estimated = ep.normalize_earnings_frame(record(), pd.DataFrame([{"Reported EPS": None}], index=frame.index), today=date(2026, 10, 18))[0]
    a = ep.merge_reporting_events([estimated, result])[0]
    b = ep.merge_reporting_events([result, estimated])[0]
    assert a == b
    assert a.status == "REPORTED"
    assert a.metadata["status_observations"] == ["ESTIMATED", "REPORTED"]
    assert ep.merge_reporting_events([a, estimated, result]) == [a]


@pytest.mark.parametrize("actuals", [(1, 2), (0, 1), (-1, 1), (-1, -2)])
def test_conflicting_reported_eps_never_uses_input_order(actuals):
    events = [ep.normalize_earnings_frame(record(), pd.DataFrame([
        {"Reported EPS": eps}], index=[pd.Timestamp("2026-10-17T20:00:00Z")]),
        today=date(2026, 10, 18))[0] for eps in actuals]
    for ordered in (events, list(reversed(events)), [events[0], *events]):
        with pytest.raises(ValueError, match="RECONCILIATION"):
            ep.merge_reporting_events(ordered)


@pytest.mark.parametrize("actual", [0, -2, 1])
def test_identical_reported_eps_replay_is_idempotent(actual):
    event = ep.normalize_earnings_frame(record(), pd.DataFrame([
        {"Reported EPS": actual}], index=[pd.Timestamp("2026-10-17T20:00:00Z")]),
        today=date(2026, 10, 18))[0]
    assert ep.merge_reporting_events([event, event, event]) == [event]


def sec_payload():
    return {"cik": "320193", "filings": {"recent": {
        "form": ["10-Q", "10-Q", "10-Q", "10-Q/A"],
        "filingDate": ["2026-02-01", "2026-05-01", "2026-08-01", "2026-08-01"],
        "reportDate": ["2025-12-31", "2026-03-31", "2026-06-30", "2026-06-30"],
        "accessionNumber": [f"0000320193-26-00000{i}" for i in range(1, 5)],
        "primaryDocument": [f"fixture{i}.htm" for i in range(1, 5)],
    }}}


def test_sec_document_identity_idempotence_and_amendments():
    events = ep.normalize_sec_submissions(record(), sec_payload())
    assert len(events) == len({r.event_key for r in events}) == 4
    assert len(ep.merge_reporting_events([*events, events[0]])) == 4
    assert events[0].fiscal_year == 2026  # Offset fiscal year, not calendar year.
    assert events[-1].metadata["amendment"] is True
    assert events[-1].metadata["amends_event_key"] is None  # Not guessed from date.
    assert events[-1].metadata["publication_evidence"]["basis"] == "OFFICIAL_DOCUMENT"
    # One issuer may have several listed share classes. Keep the document's
    # native identity, but never overwrite another instrument's event row.
    other = ep.normalize_sec_submissions(record("SHARE-B"), sec_payload())
    assert len(ep.merge_reporting_events([*events, *other])) == 8
    with pytest.raises(ValueError, match="RECONCILIATION"):
        ep.merge_reporting_events([events[0], replace(events[0], instrument_key="other")])
    with pytest.raises(ValueError, match="RECONCILIATION"):
        ep.merge_reporting_events([events[0], replace(events[0], event_date=date(2026, 2, 2))])


def test_unknown_sec_identity_is_not_synthesized():
    payload = sec_payload()
    payload["filings"]["recent"]["accessionNumber"] = []
    assert ep.normalize_sec_submissions(record(), payload) == []


def test_no_new_supabase_financial_columns():
    rows = ep.normalize_interim_financials(record(), *financial_frames())
    payload = ep.financial_payload(rows[0], "2026-10-18T12:00:00Z")
    assert not {"period_start", "accounting_basis", "calendar_basis", "definition", "consolidation_scope"} & set(payload)


def test_all_symbol_failures_keep_calendar_without_global_success(monkeypatch):
    event = ep.normalize_calendar_frame({"AAPL": record()}, pd.DataFrame([{
        "Event Start Date": "2026-10-17", "Event Name": "Q3 2026 Earnings"}], index=["AAPL"]), today=date(2026, 10, 18))[0]
    class FakeProvider:
        def __init__(self, **kwargs):
            pass
        def fetch_global_calendar(self, *_args, **_kwargs):
            return [event]
        def fetch_symbol(self, *_args, **_kwargs):
            raise RuntimeError("SYNTHETIC_FAILURE")
    class NoDatabase:
        def __getattr__(self, name):
            raise AssertionError("Database I/O forbidden: " + name)
    finishes = []
    monkeypatch.setattr(ep, "YahooReportingProvider", FakeProvider)
    monkeypatch.setattr(ep, "fetch_universe", lambda *a, **k: [record()])
    monkeypatch.setattr(ep, "_finish_etl_run", lambda *a, **k: finishes.append(k))
    result = ep.run_equity_publications_sync(NoDatabase(), dry_run=True, today=date(2026, 10, 18), sleep_seconds=0)
    assert result["quality_state"] == "PARTIAL"
    assert result["event_rows"] == 1
    assert result["financial_rows"] == 0
    assert result["items_success"] == 0
    assert result["coverage_pct"] == 0
    assert result["coverage_dimensions"]["calendar_completeness"] == "UNVERIFIED"
    assert finishes[0]["status"] == "FAILED"


def _synthetic_sync(monkeypatch, *, due_symbols, financial_symbols, mode, reasons=True, error_symbols=()):
    records = [record("AAPL"), record("MSFT")]
    events = ep.normalize_calendar_frame(
        {r.provider_symbol: r for r in records}, pd.DataFrame([
            {"Event Start Date": "2026-10-17" if r.provider_symbol in due_symbols else "2026-10-20",
             "Event Name": "Q3 2026 Earnings"} for r in records], index=[r.provider_symbol for r in records]),
        today=date(2026, 10, 18))
    attempted, finishes = [], []

    class FakeProvider:
        def __init__(self, **kwargs):
            pass
        def fetch_global_calendar(self, *_args, **_kwargs):
            return events
        def fetch_symbol(self, target, **_kwargs):
            attempted.append(target.provider_symbol)
            if target.provider_symbol in error_symbols:
                raise RuntimeError("SYNTHETIC_FAILURE")
            financials = (tuple(ep.normalize_interim_financials(target, *financial_frames()))
                          if target.provider_symbol in financial_symbols else ())
            return ep.SymbolReportingResult(financials, (),
                ("INTERIM_UNAVAILABLE",) if not financials and reasons else ())

    class NoDatabase:
        def __getattr__(self, name):
            raise AssertionError("Database I/O forbidden: " + name)

    monkeypatch.setattr(ep, "YahooReportingProvider", FakeProvider)
    monkeypatch.setattr(ep, "fetch_universe", lambda *a, **k: records)
    monkeypatch.setattr(ep, "refresh_index_memberships", lambda *a, **k: [])
    monkeypatch.setattr(ep, "_finish_etl_run", lambda *a, **k: finishes.append(k))
    result = ep.run_equity_publications_sync(NoDatabase(), dry_run=True, mode=mode,
        today=date(2026, 10, 18), sleep_seconds=0)
    return result, finishes[0]["status"], attempted


@pytest.mark.parametrize("mode", ["daily", "full"])
@pytest.mark.parametrize("reasons", [False, True])
def test_calendar_only_normal_return_is_not_financial_success(monkeypatch, mode, reasons):
    result, status, attempted = _synthetic_sync(monkeypatch, due_symbols={"AAPL", "MSFT"},
        financial_symbols=set(), mode=mode, reasons=reasons)
    assert set(attempted) == {"AAPL", "MSFT"}
    assert result["event_rows"] == 2
    assert result["financial_rows"] == result["items_success"] == 0
    assert result["items_total"] == result["items_failed"] == 2
    assert result["quality_state"] == "PARTIAL"
    assert status == "FAILED"


@pytest.mark.parametrize("mode,financial_symbols,expected", [
    ("daily", {"AAPL"}, "SUCCESS"),  # MSFT is not due; no spurious failure.
    ("full", {"AAPL"}, "FAILED"),   # Both attempted, one missing.
    ("full", {"AAPL", "MSFT"}, "SUCCESS"),
])
def test_financial_failure_is_bound_to_attempted_targets(monkeypatch, mode, financial_symbols, expected):
    result, status, attempted = _synthetic_sync(monkeypatch, due_symbols={"AAPL"},
        financial_symbols=financial_symbols, mode=mode)
    assert status == expected
    assert set(attempted) == ({"AAPL"} if mode == "daily" else {"AAPL", "MSFT"})
    assert result["items_success"] == len(financial_symbols)
    assert result["items_total"] == len(attempted)
    assert result["items_failed"] == len(attempted) - len(financial_symbols)
    assert result["coverage_dimensions"]["calendar_completeness"] == "UNVERIFIED"


def test_daily_with_no_due_targets_is_not_a_financial_failure(monkeypatch):
    result, status, attempted = _synthetic_sync(monkeypatch, due_symbols=set(),
        financial_symbols=set(), mode="daily")
    assert attempted == []
    assert status == "SUCCESS"
    assert result["items_total"] == result["items_success"] == result["items_failed"] == 0
    assert result["quality_state"] == "PARTIAL"  # No claim of financial completeness.


@pytest.mark.parametrize("mode,due,financial,errors,counts,expected_status,coverage", [
    ("daily", {"AAPL"}, {"AAPL"}, set(), (1, 1, 0), "SUCCESS", 50.0),
    ("daily", {"AAPL"}, set(), set(), (1, 0, 1), "FAILED", 0.0),
    ("daily", {"AAPL", "MSFT"}, {"AAPL"}, set(), (2, 1, 1), "FAILED", 50.0),
    ("daily", set(), {"AAPL", "MSFT"}, set(), (0, 0, 0), "SUCCESS", 0.0),
    ("full", set(), {"AAPL", "MSFT"}, set(), (2, 2, 0), "SUCCESS", 100.0),
    ("full", {"AAPL"}, {"AAPL"}, set(), (2, 1, 1), "FAILED", 50.0),
    ("full", set(), set(), set(), (2, 0, 2), "FAILED", 0.0),
    ("daily", {"AAPL"}, {"AAPL"}, {"AAPL"}, (1, 0, 1), "FAILED", 0.0),
    ("full", {"AAPL"}, {"AAPL", "MSFT"}, {"MSFT"}, (2, 1, 1), "FAILED", 50.0),
])
def test_attempt_counters_are_distinct_from_universe_coverage(
    monkeypatch, mode, due, financial, errors, counts, expected_status, coverage,
):
    result, status, attempted = _synthetic_sync(
        monkeypatch, due_symbols=due, financial_symbols=financial,
        mode=mode, reasons=False, error_symbols=errors,
    )
    actual = tuple(result[key] for key in ("items_total", "items_success", "items_failed"))
    assert actual == counts
    assert actual[0] == actual[1] + actual[2] == len(attempted)
    assert result["symbol_refresh_count"] == actual[0]
    assert status == expected_status
    assert result["universe_count"] == 2
    assert result["coverage_dimensions"]["universe_instruments"] == 2
    assert result["coverage_pct"] == coverage  # Universe denominator, not attempts.
    assert result["financial_instruments"] == actual[1]
    assert result["coverage_dimensions"]["financial_instruments_with_rows"] == actual[1]
    assert result["event_rows"] == result["calendar_instruments"] == 2
    assert result["coverage_dimensions"]["calendar_completeness"] == "UNVERIFIED"
    assert result["quality_state"] == ("UNVERIFIED" if coverage == 100 else "PARTIAL")
