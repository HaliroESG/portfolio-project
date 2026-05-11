import argparse
import json
import os
import sys
import time
from datetime import datetime

from supabase import create_client

CURRENT_DIR = os.path.dirname(__file__)
BACKEND_ROOT = os.path.dirname(CURRENT_DIR)
sys.path.append(BACKEND_ROOT)

from backtest.engine import run_backtest  # noqa: E402
from etl_stats import build_etl_stats  # noqa: E402


def get_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} manquant")
    return value


def parse_json(value: str | None) -> dict | None:
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception as exc:
        raise RuntimeError(f"config_json invalide: {exc}") from exc


def start_etl_run(supabase, job_name: str) -> str | None:
    try:
        response = (
            supabase
            .table("etl_runs")
            .insert({
                "job_name": job_name,
                "status": "RUNNING",
                "started_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
            })
            .execute()
        )
        if response.data and len(response.data) > 0:
            return response.data[0].get("id")
    except Exception as exc:
        print(f"⚠️ Impossible de démarrer etl_runs: {exc}", flush=True)
    return None


def finish_etl_run(
    supabase,
    run_id: str | None,
    status: str,
    duration_sec: float,
    stats: dict | None = None,
    error: str | None = None,
) -> None:
    if not run_id:
        return
    try:
        payload = {
            "status": status,
            "finished_at": datetime.utcnow().isoformat(),
            "duration_sec": round(duration_sec, 2),
            "updated_at": datetime.utcnow().isoformat(),
        }
        if stats is not None:
            payload["stats"] = stats
        if error:
            payload["error"] = error
        supabase.table("etl_runs").update(payload).eq("id", run_id).execute()
    except Exception as exc:
        print(f"⚠️ Impossible de clôturer etl_runs: {exc}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Run backtest engine")
    parser.add_argument("--run-name", required=True)
    parser.add_argument("--base-currency", default="EUR")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", default=None)
    parser.add_argument("--config-json", default=None)
    parser.add_argument("--portfolio-id", default=None)
    parser.add_argument(
        "--include-presets",
        default="baseline",
        choices=["all", "baseline", "list", "none"],
    )
    parser.add_argument(
        "--preset-keys",
        default=None,
        help="Comma-separated preset keys when --include-presets=list",
    )
    args = parser.parse_args()

    end_date = args.end_date or datetime.utcnow().date().isoformat()
    start = datetime.strptime(args.start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()

    supabase_url = get_env("SUPABASE_URL")
    supabase_key = get_env("SUPABASE_KEY")
    supabase = create_client(supabase_url, supabase_key)

    config = parse_json(args.config_json)

    preset_keys = None
    if args.preset_keys:
        preset_keys = [key.strip() for key in args.preset_keys.split(",") if key.strip()]

    job_name = "backtest_run"
    started = time.time()
    etl_run_id = start_etl_run(supabase, job_name)

    try:
        result = run_backtest(
            supabase=supabase,
            run_name=args.run_name,
            base_currency=args.base_currency,
            start=start,
            end=end,
            config_json=config,
            portfolio_id=args.portfolio_id,
            include_presets=args.include_presets,
            preset_keys=preset_keys,
        )
        stats = {
            "run_id": result.get("run_id"),
            "reused": result.get("reused"),
        }
        normalized_stats = build_etl_stats(
            job_name,
            stats,
            items_total=1,
            items_success=1,
            items_failed=0,
        )
        finish_etl_run(supabase, etl_run_id, "SUCCESS", time.time() - started, stats=normalized_stats)
    except Exception as exc:
        finish_etl_run(
            supabase,
            etl_run_id,
            "FAILED",
            time.time() - started,
            error=str(exc),
        )
        raise


if __name__ == "__main__":
    main()
