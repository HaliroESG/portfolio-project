from __future__ import annotations

from datetime import date

import historical_prices_sync
from scripts import backfill_top_trident_prices


class _FakeResponse:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows, *, fail_provider_symbol=False):
        self._rows = rows
        self._fail_provider_symbol = fail_provider_symbol
        self._selector = ""
        self._limit = None

    def select(self, selector):
        self._selector = selector
        if self._fail_provider_symbol and "provider_symbol" in selector:
            raise RuntimeError("Could not find provider_symbol in schema cache")
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, value):
        self._limit = value
        return self

    def execute(self):
        rows = list(self._rows)
        if self._limit is not None:
            rows = rows[:self._limit]
        return _FakeResponse(rows)


class _FakeSupabase:
    def __init__(self, rows, *, fail_provider_symbol=False):
        self._rows = rows
        self._fail_provider_symbol = fail_provider_symbol

    def table(self, name):
        assert name == "trident_screener_latest"
        return _FakeQuery(
            self._rows,
            fail_provider_symbol=self._fail_provider_symbol,
        )


def test_build_price_targets_adds_provider_symbol_fallback():
    targets = backfill_top_trident_prices.build_price_targets([
        {"ticker": "air.pa", "provider_symbol": "AI.PA", "score": 91},
        {"ticker": "AI.PA", "provider_symbol": "AI.PA", "score": 90},
        {"ticker": "", "provider_symbol": "MISS.PA", "score": 80},
    ])

    assert [target.ticker for target in targets] == ["AI.PA", "AIR.PA"]
    by_ticker = {target.ticker: target for target in targets}
    assert by_ticker["AIR.PA"].provider_symbol == "AI.PA"
    assert by_ticker["AIR.PA"].source_index == "trident_top_scores"
    assert by_ticker["AI.PA"].provider_symbol == "AI.PA"
    assert by_ticker["AI.PA"].source_index == "trident_top_scores_provider_symbol"


def test_fetch_top_trident_rows_falls_back_when_provider_symbol_missing():
    rows, provider_symbol_available = backfill_top_trident_prices.fetch_top_trident_rows(
        _FakeSupabase(
            [{"ticker": "MSFT", "score": 88}],
            fail_provider_symbol=True,
        ),
        50,
    )

    assert provider_symbol_available is False
    assert rows == [{"ticker": "MSFT", "score": 88, "provider_symbol": None}]


def test_run_backfill_dry_run_does_not_start_etl(monkeypatch):
    started = []

    monkeypatch.setattr(
        historical_prices_sync,
        "start_etl_run",
        lambda *_args, **_kwargs: started.append(True),
    )

    report = backfill_top_trident_prices.run_backfill(
        _FakeSupabase([
            {"ticker": "air.pa", "provider_symbol": "AI.PA", "score": 91},
        ]),
        top_n=50,
        start_date="1999-01-01",
        end_date="2026-05-25",
        dry_run=True,
    )

    assert report["dry_run"] is True
    assert report["ticker_count"] == 2
    assert report["tickers"] == ["AI.PA", "AIR.PA"]
    assert started == []


def test_run_backfill_records_successful_etl(monkeypatch):
    calls = []
    finished = []

    def fake_run_sync(_supabase, start, end, targets, dry_run=False):
        calls.append({
            "start": start,
            "end": end,
            "targets": targets,
            "dry_run": dry_run,
        })
        return {
            "tickers": len(targets),
            "tickers_ok": len(targets) - 1,
            "tickers_failed": 1,
        }

    monkeypatch.setattr(
        historical_prices_sync,
        "start_etl_run",
        lambda _supabase, job_name: f"run-{job_name}",
    )
    monkeypatch.setattr(historical_prices_sync, "run_sync", fake_run_sync)
    monkeypatch.setattr(
        historical_prices_sync,
        "finish_etl_run",
        lambda *args, **kwargs: finished.append((args, kwargs)),
    )

    report = backfill_top_trident_prices.run_backfill(
        _FakeSupabase([
            {"ticker": "air.pa", "provider_symbol": "AI.PA", "score": 91},
        ]),
        top_n=50,
        start_date="1999-01-01",
        end_date="2026-05-25",
    )

    assert calls[0]["start"] == date(1999, 1, 1)
    assert calls[0]["end"] == date(2026, 5, 25)
    assert calls[0]["dry_run"] is False
    assert [target.ticker for target in calls[0]["targets"]] == ["AI.PA", "AIR.PA"]
    assert report["stats"]["coverage_pct"] == 50.0
    assert finished[0][0][2] == "SUCCESS"
