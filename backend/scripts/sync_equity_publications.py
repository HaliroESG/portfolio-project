#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from supabase import create_client


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from equity_publications import (
    TARGET_INDEXES,
    configured_event_overrides,
    run_equity_publications_sync,
)
from supabase_key_guard import require_backend_supabase_key


def csv_values(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(item.strip() for item in value.split(",") if item.strip())


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Synchronize CAC 40 and S&P 500 reporting data and calendar"
    )
    parser.add_argument(
        "--mode",
        choices=["daily", "full"],
        default=os.environ.get("EQUITY_PUBLICATIONS_MODE", "daily"),
    )
    parser.add_argument("--indexes", default=",".join(TARGET_INDEXES))
    parser.add_argument("--symbols", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--max-periods", type=int, default=8)
    parser.add_argument(
        "--sleep-seconds",
        type=float,
        default=float(os.environ.get("EQUITY_PUBLICATIONS_SLEEP_SEC", "0.1")),
    )
    parser.add_argument(
        "--event-overrides-csv",
        default=configured_event_overrides(),
    )
    parser.add_argument(
        "--sec-user-agent",
        default=os.environ.get("SEC_USER_AGENT"),
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    if not supabase_url:
        print("Missing SUPABASE_URL", flush=True)
        return 2
    try:
        supabase_key = require_backend_supabase_key(os.environ)
    except Exception as exc:
        print(str(exc), flush=True)
        return 2

    stats = run_equity_publications_sync(
        create_client(supabase_url, supabase_key),
        mode=args.mode,
        indexes=csv_values(args.indexes) or TARGET_INDEXES,
        symbols=csv_values(args.symbols),
        limit=args.limit,
        max_periods=args.max_periods,
        sleep_seconds=max(0.0, args.sleep_seconds),
        event_overrides_csv=args.event_overrides_csv,
        sec_user_agent=args.sec_user_agent,
        dry_run=args.dry_run,
    )
    print(f"Equity publications sync complete: {stats}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
