from datetime import datetime, timezone
import base64
import json

from scripts.check_refresh_freshness import build_report
from scripts.run_data_refresh import build_step_plan, normalize_env, run_step, trident_price_start_date


def _jwt_for_role(role: str) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none"}).encode()).decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
    return f"{header}.{payload}.signature"


def test_freshness_report_passes_recent_successes():
    now = datetime(2026, 5, 24, 23, 0, tzinfo=timezone.utc)
    rows = {
        "bridge_sync": {
            "status": "SUCCESS",
            "started_at": "2026-05-24T22:00:00+00:00",
            "finished_at": "2026-05-24T22:10:00+00:00",
        },
        "macro_sync": {
            "status": "SUCCESS",
            "started_at": "2026-05-24T22:10:00+00:00",
            "finished_at": "2026-05-24T22:11:00+00:00",
        },
        "news_sync": {
            "status": "SUCCESS",
            "started_at": "2026-05-24T22:11:00+00:00",
            "finished_at": "2026-05-24T22:12:00+00:00",
        },
    }

    report = build_report(rows, scope="core", now=now)

    assert report["status"] == "PASS"
    assert [check["job_name"] for check in report["checks"]] == [
        "bridge_sync",
        "macro_sync",
        "news_sync",
    ]


def test_freshness_report_fails_stale_or_failed_latest_run():
    now = datetime(2026, 5, 24, 23, 0, tzinfo=timezone.utc)
    rows = {
        "trident_screener_sync": {
            "status": "FAILED",
            "started_at": "2026-05-24T22:00:00+00:00",
            "finished_at": "2026-05-24T22:15:00+00:00",
            "error": "provider failed",
        },
    }

    report = build_report(rows, scope="trident", now=now)

    assert report["status"] == "FAIL"
    assert report["checks"][0]["latest_status"] == "FAILED"
    assert "expected SUCCESS" in report["checks"][0]["reason"]


def test_refresh_plan_skips_daily_trident_when_no_cap_is_configured():
    steps = build_step_plan(
        scope="trident",
        trident_mode="daily",
        trident_price_start=None,
        env={"SUPABASE_URL": "url", "SUPABASE_KEY": "key"},
        now=datetime(2026, 5, 24, tzinfo=timezone.utc),
    )

    assert len(steps) == 1
    assert steps[0].key == "trident_screener_sync"
    assert steps[0].skip_reason is not None


def test_refresh_plan_runs_full_trident_without_daily_caps():
    steps = build_step_plan(
        scope="trident",
        trident_mode="full",
        trident_price_start="2026-05-01",
        env={
            "SUPABASE_URL": "url",
            "SUPABASE_KEY": "key",
            "TRIDENT_LIMIT": "25",
            "TRIDENT_PER_INDEX_LIMIT": "5",
        },
        now=datetime(2026, 5, 24, tzinfo=timezone.utc),
    )

    assert [step.key for step in steps] == [
        "trident_screener_sync",
        "historical_prices_trident_sync",
    ]
    assert steps[0].env_overrides == {
        "TRIDENT_LIMIT": None,
        "TRIDENT_PER_INDEX_LIMIT": None,
    }
    assert steps[1].command[-1] == "2026-05-01"


def test_refresh_plan_all_orders_core_history_trident_backtest():
    steps = build_step_plan(
        scope="all",
        trident_mode="daily",
        trident_price_start=None,
        env={
            "SUPABASE_URL": "url",
            "SUPABASE_KEY": "key",
            "TRIDENT_PER_INDEX_LIMIT": "2",
        },
        now=datetime(2026, 5, 24, tzinfo=timezone.utc),
    )

    assert [step.key for step in steps] == [
        "bridge_sync",
        "macro_sync",
        "news_sync",
        "historical_prices_sync",
        "trident_screener_sync",
        "historical_prices_trident_sync",
        "backtest_run",
    ]


def test_normalize_env_maps_service_key_aliases():
    env = normalize_env({"SUPABASE_URL": "url", "SUPABASE_SERVICE_KEY": "service"})

    assert env["SUPABASE_KEY"] == "service"
    assert env["SUPABASE_SERVICE_ROLE_KEY"] == "service"


def test_normalize_env_prefers_secret_backend_key():
    env = normalize_env({
        "SUPABASE_URL": "url",
        "SUPABASE_KEY": _jwt_for_role("anon"),
        "SUPABASE_SECRET_KEY": "sb_secret_live",
    })

    assert env["SUPABASE_KEY"] == "sb_secret_live"
    assert env["SUPABASE_SERVICE_ROLE_KEY"] == "sb_secret_live"


def test_run_step_rejects_public_supabase_key():
    steps = build_step_plan(
        scope="history",
        trident_mode="daily",
        trident_price_start=None,
        env={"SUPABASE_URL": "url", "SUPABASE_KEY": _jwt_for_role("anon")},
        now=datetime(2026, 5, 24, tzinfo=timezone.utc),
    )

    result = run_step(steps[0], {"SUPABASE_URL": "url", "SUPABASE_KEY": _jwt_for_role("anon")})

    assert result["status"] == "FAILED"
    assert result["returncode"] == 2
    assert "Backend ETL writes require" in result["error"]


def test_trident_price_start_defaults_to_ten_days_before_now():
    now = datetime(2026, 5, 24, 12, 0, tzinfo=timezone.utc)

    assert trident_price_start_date(None, now) == "2026-05-14"
