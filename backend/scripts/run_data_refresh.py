#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from supabase_key_guard import SupabaseBackendKeyError, require_backend_supabase_key

PYTHON = sys.executable


@dataclass(frozen=True)
class RefreshStep:
    key: str
    label: str
    command: tuple[str, ...]
    required_env: tuple[str, ...] = ()
    env_overrides: Mapping[str, str | None] | None = None
    skip_reason: str | None = None


def normalize_env(source: Mapping[str, str]) -> dict[str, str]:
    env = dict(source)
    backend_key = (
        env.get("SUPABASE_SECRET_KEY")
        or env.get("SUPABASE_SERVICE_ROLE_KEY")
        or env.get("SUPABASE_SERVICE_KEY")
        or env.get("SUPABASE_KEY")
    )
    if backend_key:
        env["SUPABASE_KEY"] = backend_key
        env.setdefault("SUPABASE_SERVICE_ROLE_KEY", backend_key)
    return env


def command_text(command: tuple[str, ...]) -> str:
    parts: list[str] = []
    for part in command:
        try:
            rel = Path(part).resolve().relative_to(BACKEND_DIR)
            parts.append(str(rel))
        except Exception:
            parts.append(part)
    return " ".join(parts)


def missing_env(env: Mapping[str, str], required: tuple[str, ...]) -> list[str]:
    return [name for name in required if not env.get(name)]


def trident_price_start_date(value: str | None, now: datetime | None = None) -> str:
    if value:
        return value
    generated = (now or datetime.now(timezone.utc)) - timedelta(days=10)
    return generated.date().isoformat()


def build_trident_steps(
    *,
    trident_mode: str,
    trident_price_start: str | None,
    env: Mapping[str, str],
    now: datetime | None = None,
) -> list[RefreshStep]:
    mode = trident_mode.lower()
    if mode not in {"daily", "full"}:
        raise ValueError("trident_mode must be daily or full")

    has_daily_cap = bool(env.get("TRIDENT_LIMIT") or env.get("TRIDENT_PER_INDEX_LIMIT"))
    if mode == "daily" and not has_daily_cap:
        return [
            RefreshStep(
                key="trident_screener_sync",
                label="Trident screener",
                command=(PYTHON, "scripts/sync_trident_screener.py"),
                skip_reason=(
                    "Daily Trident refresh skipped because neither TRIDENT_LIMIT nor "
                    "TRIDENT_PER_INDEX_LIMIT is configured. Weekly full refresh still runs."
                ),
            )
        ]

    overrides: dict[str, str | None] = {}
    if mode == "full":
        overrides["TRIDENT_LIMIT"] = None
        overrides["TRIDENT_PER_INDEX_LIMIT"] = None

    command = [PYTHON, "scripts/sync_trident_screener.py"]
    if mode == "daily":
        if env.get("TRIDENT_LIMIT"):
            command.extend(["--limit", env["TRIDENT_LIMIT"]])
        if env.get("TRIDENT_PER_INDEX_LIMIT"):
            command.extend(["--per-index-limit", env["TRIDENT_PER_INDEX_LIMIT"]])

    return [
        RefreshStep(
            key="trident_screener_sync",
            label="Trident screener",
            command=tuple(command),
            required_env=("SUPABASE_URL", "SUPABASE_KEY"),
            env_overrides=overrides,
        ),
        RefreshStep(
            key="historical_prices_trident_sync",
            label="Trident historical prices",
            command=(
                PYTHON,
                "historical_prices_sync.py",
                "--trident-only",
                "--start-date",
                trident_price_start_date(trident_price_start or env.get("TRIDENT_PRICE_SYNC_START_DATE"), now),
            ),
            required_env=("SUPABASE_URL", "SUPABASE_KEY"),
        ),
        RefreshStep(
            key="trident_stock_insights_sync",
            label="Trident stock insights",
            command=(
                PYTHON,
                "scripts/sync_trident_stock_insights.py",
                "--top-n",
                env.get("TRIDENT_STOCK_INSIGHTS_TOP_N", "200"),
                "--batch-size",
                env.get("TRIDENT_STOCK_INSIGHTS_BATCH_SIZE", "25"),
            ),
            required_env=("SUPABASE_URL", "SUPABASE_KEY"),
        ),
        RefreshStep(
            key="equity_screener_sync",
            label="Open equity screener",
            command=(PYTHON, "scripts/sync_equity_screener.py"),
            required_env=("SUPABASE_URL", "SUPABASE_KEY"),
        ),
    ]


def build_step_plan(
    *,
    scope: str,
    trident_mode: str,
    trident_price_start: str | None,
    env: Mapping[str, str] | None = None,
    now: datetime | None = None,
) -> list[RefreshStep]:
    source_env = normalize_env(env or os.environ)
    normalized = scope.lower()
    if normalized == "all":
        scopes = ("core", "history", "trident", "backtest")
    elif normalized == "validate":
        scopes = ("validate",)
    elif normalized in {"core", "history", "trident", "backtest"}:
        scopes = (normalized,)
    else:
        raise ValueError("scope must be one of core, history, trident, backtest, all, validate")

    steps: list[RefreshStep] = []
    for item in scopes:
        if item == "core":
            steps.extend([
                RefreshStep(
                    key="bridge_sync",
                    label="portfolio and market snapshot",
                    command=(PYTHON, "bridge.py"),
                    required_env=("SUPABASE_URL", "SUPABASE_KEY", "GSPREAD_SERVICE_ACCOUNT", "GSHEET_NAME"),
                ),
                RefreshStep(
                    key="macro_sync",
                    label="macro indicators",
                    command=(PYTHON, "macro_sync.py"),
                    required_env=("SUPABASE_URL", "SUPABASE_KEY"),
                ),
                RefreshStep(
                    key="news_sync",
                    label="news feed",
                    command=(PYTHON, "news_sync.py"),
                    required_env=("SUPABASE_URL", "SUPABASE_KEY"),
                ),
            ])
        elif item == "history":
            steps.append(
                RefreshStep(
                    key="historical_prices_sync",
                    label="historical prices",
                    command=(PYTHON, "historical_prices_sync.py", "--no-trident"),
                    required_env=("SUPABASE_URL", "SUPABASE_KEY"),
                )
            )
        elif item == "trident":
            steps.extend(
                build_trident_steps(
                    trident_mode=trident_mode,
                    trident_price_start=trident_price_start,
                    env=source_env,
                    now=now,
                )
            )
        elif item == "backtest":
            steps.append(
                RefreshStep(
                    key="backtest_run",
                    label="production reference backtest",
                    command=(
                        PYTHON,
                        "scripts/run_backtest.py",
                        "--run-name",
                        "Production Reference",
                        "--start-date",
                        "2024-01-01",
                        "--include-presets",
                        "baseline",
                    ),
                    required_env=("SUPABASE_URL", "SUPABASE_KEY"),
                )
            )
        elif item == "validate":
            steps.extend([
                RefreshStep(
                    key="schema_check",
                    label="Supabase schema check",
                    command=(PYTHON, "tools/schema_check.py", "--pretty", "--output", "schema-check.json"),
                    required_env=("SUPABASE_URL", "SUPABASE_KEY"),
                ),
                RefreshStep(
                    key="refresh_freshness_check",
                    label="ETL freshness check",
                    command=(
                        PYTHON,
                        "scripts/check_refresh_freshness.py",
                        "--scope",
                        "all",
                        "--output",
                        "refresh-freshness-report.json",
                    ),
                    required_env=("SUPABASE_URL", "SUPABASE_KEY"),
                ),
            ])
    return steps


def run_step(step: RefreshStep, base_env: Mapping[str, str]) -> dict[str, Any]:
    started = time.time()
    payload: dict[str, Any] = {
        "key": step.key,
        "label": step.label,
        "command": command_text(step.command),
        "started_at": datetime.now(timezone.utc).isoformat(),
    }

    if step.skip_reason:
        payload.update({
            "status": "SKIPPED",
            "ok": True,
            "reason": step.skip_reason,
            "duration_sec": 0,
        })
        print(f"[SKIP] {step.key}: {step.skip_reason}", flush=True)
        return payload

    env = normalize_env(base_env)
    for key, value in (step.env_overrides or {}).items():
        if value is None:
            env.pop(key, None)
        else:
            env[key] = value

    missing = missing_env(env, step.required_env)
    if missing:
        payload.update({
            "status": "FAILED",
            "ok": False,
            "returncode": 2,
            "error": f"Missing required env vars: {', '.join(missing)}",
            "duration_sec": round(time.time() - started, 2),
        })
        print(f"[FAIL] {step.key}: {payload['error']}", flush=True)
        return payload

    if "SUPABASE_KEY" in step.required_env:
        try:
            env["SUPABASE_KEY"] = require_backend_supabase_key(env)
        except SupabaseBackendKeyError as exc:
            payload.update({
                "status": "FAILED",
                "ok": False,
                "returncode": 2,
                "error": str(exc),
                "duration_sec": round(time.time() - started, 2),
            })
            print(f"[FAIL] {step.key}: {payload['error']}", flush=True)
            return payload

    print(f"[RUN] {step.key}: {payload['command']}", flush=True)
    completed = subprocess.run(step.command, cwd=BACKEND_DIR, env=env, check=False)
    payload.update({
        "returncode": completed.returncode,
        "duration_sec": round(time.time() - started, 2),
        "finished_at": datetime.now(timezone.utc).isoformat(),
    })
    if completed.returncode == 0:
        payload.update({"status": "SUCCESS", "ok": True})
        print(f"[PASS] {step.key}", flush=True)
    else:
        payload.update({
            "status": "FAILED",
            "ok": False,
            "error": f"Command exited with status {completed.returncode}",
        })
        print(f"[FAIL] {step.key}: {payload['error']}", flush=True)
    return payload


def write_report(path: str | None, report: Mapping[str, Any]) -> None:
    text = json.dumps(report, indent=2, sort_keys=True)
    print(text)
    if path:
        Path(path).write_text(text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run production data refresh scopes")
    parser.add_argument(
        "--scope",
        required=True,
        choices=["core", "history", "trident", "backtest", "all", "validate"],
    )
    parser.add_argument("--output", default="refresh-report.json")
    parser.add_argument("--trident-mode", default=os.environ.get("REFRESH_TRIDENT_MODE", "daily"), choices=["daily", "full"])
    parser.add_argument("--trident-price-start-date", default=None)
    args = parser.parse_args()

    try:
        steps = build_step_plan(
            scope=args.scope,
            trident_mode=args.trident_mode,
            trident_price_start=args.trident_price_start_date,
            env=os.environ,
        )
    except Exception as exc:
        report = {
            "ok": False,
            "status": "FAILED",
            "scope": args.scope,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
            "steps": [],
        }
        write_report(args.output, report)
        return 2

    step_reports: list[dict[str, Any]] = []
    for step in steps:
        result = run_step(step, os.environ)
        step_reports.append(result)
        if not result["ok"]:
            break

    ok = all(step["ok"] for step in step_reports)
    report = {
        "ok": ok,
        "status": "SUCCESS" if ok else "FAILED",
        "scope": args.scope,
        "trident_mode": args.trident_mode,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "steps": step_reports,
    }
    write_report(args.output, report)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
