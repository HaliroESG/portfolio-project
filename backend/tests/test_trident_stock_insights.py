from __future__ import annotations

from datetime import date, timedelta

from scripts import sync_trident_stock_insights as insights


class _FakeResponse:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows):
        self._rows = list(rows)
        self._filters = []
        self._in_filters = []
        self._limit = None
        self._range = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self._filters.append((column, value))
        return self

    def in_(self, column, values):
        self._in_filters.append((column, set(values)))
        return self

    def gte(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, value):
        self._limit = value
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        rows = list(self._rows)
        for column, value in self._filters:
            rows = [row for row in rows if row.get(column) == value]
        for column, values in self._in_filters:
            rows = [row for row in rows if row.get(column) in values]
        if self._range:
            start, end = self._range
            rows = rows[start:end + 1]
        if self._limit is not None:
            rows = rows[:self._limit]
        return _FakeResponse(rows)


class _FakeSupabase:
    def __init__(self, tables):
        self._tables = tables
        self.upserted = []

    def table(self, name):
        if name == "trident_stock_insights":
            return _FakeUpsertQuery(self)
        return _FakeQuery(self._tables.get(name, []))


class _FakeUpsertQuery:
    def __init__(self, supabase):
        self._supabase = supabase
        self._rows = []

    def select(self, *_args, **_kwargs):
        return _FakeQuery(self._supabase._tables.get("trident_stock_insights", []))

    def in_(self, column, values):
        return self.select().in_(column, values)

    def upsert(self, rows, **_kwargs):
        self._rows = list(rows)
        return self

    def execute(self):
        self._supabase.upserted.extend(self._rows)
        return _FakeResponse(self._rows)


def test_extract_profile_fields_reports_missing_consensus():
    profile, states = insights.extract_profile_fields({
        "longBusinessSummary": "  Enterprise software vendor.  ",
        "website": "https://example.com",
        "marketCap": "1200",
    })

    assert profile["business_summary"] == "Enterprise software vendor."
    assert profile["market_cap"] == 1200
    assert "PROFILE_UNAVAILABLE" not in states
    assert "CONSENSUS_UNAVAILABLE" in states


def test_compute_trend_facts_reports_no_price_history():
    facts, states = insights.compute_trend_facts([], fallback_currency="USD")

    assert facts["price_history_state"] == "NO_PRICE_HISTORY"
    assert facts["trend_state"] == "UNKNOWN"
    assert facts["price_currency"] == "USD"
    assert states == ["NO_PRICE_HISTORY"]


def test_compute_trend_facts_detects_positive_regression_and_ma200():
    start = date(2025, 1, 1)
    rows = [
        {
            "date": (start + timedelta(days=index)).isoformat(),
            "adj_close": 100 + index,
            "adj_close_local": 100 + index,
            "local_currency": "USD",
        }
        for index in range(230)
    ]

    facts, states = insights.compute_trend_facts(
        rows,
        fallback_currency="USD",
        now=start + timedelta(days=230),
    )

    assert facts["price_history_state"] == "OK"
    assert facts["trend_state"] == "BULLISH"
    assert facts["ma200_state"] == "ABOVE"
    assert facts["regression_slope_pct"] is not None
    assert "positive_regression" in facts["trend_reason_codes"]
    assert states == []


def test_generate_ai_summary_without_key_is_explicit(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    target = insights.TridentInsightTarget("global:MSFT", "MSFT", None, "Microsoft", "USD", 88)

    summary, state, model = insights.generate_ai_summary(target, {}, {}, [], enabled=True)

    assert summary is None
    assert state == "AI_SUMMARY_UNAVAILABLE"
    assert model is None


def test_run_sync_dry_run_builds_payload_without_upsert(monkeypatch):
    target = insights.TridentInsightTarget("global:MSFT", "MSFT", None, "Microsoft", "USD", 88)
    supabase = _FakeSupabase({
        "trident_stock_insights": [],
        "historical_prices": [
            {
                "ticker": "MSFT",
                "date": "2026-05-01",
                "adj_close": 100,
                "adj_close_local": 100,
                "local_currency": "USD",
            }
        ],
        "news_feed": [],
    })

    monkeypatch.setattr(insights, "fetch_yfinance_info", lambda _symbol: ({
        "longBusinessSummary": "Microsoft builds software.",
        "recommendationKey": "buy",
        "numberOfAnalystOpinions": 42,
    }, None))

    stats = insights.run_sync(
        supabase,
        [target],
        stale_hours=24,
        dry_run=True,
        ai_enabled=False,
    )

    assert stats["processed"] == 1
    assert stats["upserted"] == 0
    assert stats["sample_payloads"][0]["business_summary"] == "Microsoft builds software."
    assert "SHORT_HISTORY" in stats["sample_payloads"][0]["data_state"]
    assert supabase.upserted == []
