#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from supabase import create_client

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import historical_prices_sync
from etl_stats import build_etl_stats
from supabase_key_guard import require_backend_supabase_key

DEFAULT_START_DATE = "1999-01-01"
DEFAULT_TOP_N = 50
JOB_NAME = "historical_prices_trident_sync"


def _normalize_symbol(value: Any) -> str | None:
    if value is None:
        return None
    symbol = str(value).strip().upper()
    return symbol or None


def _is_missing_provider_symbol_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "provider_symbol" in message and (
        "does not exist" in message
        or "could not find" in message
        or "schema cache" in message
        or "unknown column" in message
    )


def get_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def get_supabase_client():
    return create_client(
        get_env("SUPABASE_URL"),
        require_backend_supabase_key(os.environ),
    )


def fetch_top_trident_rows(supabase, top_n: int) -> tuple[list[dict[str, Any]], bool]:
    if top_n <= 0:
        raise ValueError("--top-n must be greater than 0")

    try:
        response = (
            supabase
            .table("trident_screener_latest")
            .select("ticker,provider_symbol,score,name")
            .order("score", desc=True, nullsfirst=False)
            .limit(top_n)
            .execute()
        )
        return list(response.data or []), True
    except Exception as exc:
        if not _is_missing_provider_symbol_error(exc):
            raise
        print(
            "⚠️ trident_screener_latest.provider_symbol unavailable; "
            "falling back to ticker-only price targets.",
            flush=True,
        )

    response = (
        supabase
        .table("trident_screener_latest")
        .select("ticker,score,name")
        .order("score", desc=True, nullsfirst=False)
        .limit(top_n)
        .execute()
    )
    rows = list(response.data or [])
    for row in rows:
        row.setdefault("provider_symbol", None)
    return rows, False


def build_price_targets(rows: list[dict[str, Any]]) -> list[historical_prices_sync.PriceTarget]:
    targets: dict[str, historical_prices_sync.PriceTarget] = {}
    for row in rows:
        ticker = _normalize_symbol(row.get("ticker"))
        provider_symbol = _normalize_symbol(row.get("provider_symbol"))
        if not ticker:
            continue

        target = historical_prices_sync.make_price_target(
            ticker,
            provider_symbol=provider_symbol,
            source_index="trident_top_scores",
            source_provider="trident_screener_latest",
        )
        if target is not None:
            targets.setdefault(target.ticker, target)

        if provider_symbol and provider_symbol != ticker:
            provider_target = historical_prices_sync.make_price_target(
                provider_symbol,
                provider_symbol=provider_symbol,
                source_index="trident_top_scores_provider_symbol",
                source_provider="trident_screener_latest",
            )
            if provider_target is not None:
                targets.setdefault(provider_target.ticker, provider_target)

    return sorted(targets.values(), key=lambda target: target.ticker)


def build_dry_run_report(
    rows: list[dict[str, Any]],
    targets: list[historical_prices_sync.PriceTarget],
    *,
    top_n: int,
    start_date: str,
    end_date: str,
    provider_symbol_available: bool,
) -> dict[str, Any]:
    return {
        "ok": True,
        "dry_run": True,
        "top_n": top_n,
        "row_count": len(rows),
        "ticker_count": len(targets),
        "start_date": start_date,
        "end_date": end_date,
        "provider_symbol_available": provider_symbol_available,
        "tickers": [target.ticker for target in targets],
        "rows": rows,
    }


def run_backfill(
    supabase,
    *,
    top_n: int,
    start_date: str,
    end_date: str,
    dry_run: bool = False,
) -> dict[str, Any]:
    rows, provider_symbol_available = fetch_top_trident_rows(supabase, top_n)
    targets = build_price_targets(rows)

    if not targets:
        raise RuntimeError("No Trident price targets found")

    if dry_run:
        return build_dry_run_report(
            rows,
            targets,
            top_n=top_n,
            start_date=start_date,
            end_date=end_date,
            provider_symbol_available=provider_symbol_available,
        )

    started = time.time()
    run_id = historical_prices_sync.start_etl_run(supabase, JOB_NAME)
    try:
        stats = historical_prices_sync.run_sync(
            supabase,
            historical_prices_sync.parse_date(start_date),
            historical_prices_sync.parse_date(end_date),
            targets,
            dry_run=False,
        )
        coverage_pct = None
        if stats.get("tickers"):
            coverage_pct = (stats.get("tickers_ok", 0) / stats["tickers"]) * 100
        normalized_stats = build_etl_stats(
            JOB_NAME,
            stats,
            items_total=stats.get("tickers"),
            items_success=stats.get("tickers_ok"),
            items_failed=stats.get("tickers_failed"),
            coverage_pct=coverage_pct,
        )
        historical_prices_sync.finish_etl_run(
            supabase,
            run_id,
            "SUCCESS",
            time.time() - started,
            stats=normalized_stats,
        )
    except Exception as exc:
        historical_prices_sync.finish_etl_run(
            supabase,
            run_id,
            "FAILED",
            time.time() - started,
            error=str(exc),
        )
        raise

    return {
        "ok": True,
        "dry_run": False,
        "top_n": top_n,
        "row_count": len(rows),
        "ticker_count": len(targets),
        "start_date": start_date,
        "end_date": end_date,
        "provider_symbol_available": provider_symbol_available,
        "stats": normalized_stats,
        "tickers": [target.ticker for target in targets],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill historical prices for top-scored Trident rows first."
    )
    parser.add_argument("--top-n", type=int, default=DEFAULT_TOP_N)
    parser.add_argument("--start-date", default=DEFAULT_START_DATE)
    parser.add_argument("--end-date", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--output", default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    end_date = args.end_date or datetime.utcnow().date().isoformat()
    report = run_backfill(
        get_supabase_client(),
        top_n=args.top_n,
        start_date=args.start_date,
        end_date=end_date,
        dry_run=args.dry_run,
    )

    payload = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(payload + "\n", encoding="utf-8")
    print(payload, flush=True)


if __name__ == "__main__":
    main()
