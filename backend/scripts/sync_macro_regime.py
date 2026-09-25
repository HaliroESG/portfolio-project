#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import time
from datetime import datetime
from pathlib import Path

from supabase import create_client

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from etl_stats import build_etl_stats
from macro_regime import run_macro_regime_sync
from supabase_key_guard import require_backend_supabase_key


def start_etl_run(supabase, job_name: str) -> str | None:
    try:
        response = (
            supabase
            .table("etl_runs")
            .insert({
                "job_name": job_name,
                "status": "RUNNING",
                "started_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
            })
            .execute()
        )
        if response.data:
            return response.data[0].get("id")
    except Exception as exc:
        print(f"Warning: unable to start etl_runs: {exc}", flush=True)
    return None


def finish_etl_run(
    supabase,
    run_id: str | None,
    status: str,
    duration_sec: float,
    *,
    stats: dict | None = None,
    error: str | None = None,
) -> None:
    if not run_id:
        return
    try:
        payload = {
            "status": status,
            "finished_at": datetime.now().isoformat(),
            "duration_sec": round(duration_sec, 2),
            "updated_at": datetime.now().isoformat(),
        }
        if stats is not None:
            payload["stats"] = stats
        if error:
            payload["error"] = error
        supabase.table("etl_runs").update(payload).eq("id", run_id).execute()
    except Exception as exc:
        print(f"Warning: unable to finish etl_runs: {exc}", flush=True)


def main() -> int:
    supabase_url = os.environ.get("SUPABASE_URL")
    if not supabase_url:
        print("Missing SUPABASE_URL", flush=True)
        return 2
    try:
        supabase_key = require_backend_supabase_key(os.environ)
    except Exception as exc:
        print(str(exc), flush=True)
        return 2

    supabase = create_client(supabase_url, supabase_key)
    job_name = "macro_regime_sync"
    started = time.time()
    run_id = start_etl_run(supabase, job_name)
    try:
        stats = run_macro_regime_sync(supabase)
        normalized_stats = build_etl_stats(
            job_name,
            stats,
            items_total=stats.get("items_total"),
            items_success=stats.get("items_success"),
            items_failed=stats.get("items_failed"),
            coverage_pct=stats.get("coverage_pct"),
        )
        finish_etl_run(supabase, run_id, "SUCCESS", time.time() - started, stats=normalized_stats)
        print(f"Macro regime sync complete: {stats}", flush=True)
        return 0
    except Exception as exc:
        finish_etl_run(supabase, run_id, "FAILED", time.time() - started, error=str(exc))
        raise


if __name__ == "__main__":
    raise SystemExit(main())
