#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@dataclass(frozen=True)
class FreshnessRule:
    job_name: str
    label: str
    sla_hours: float


FRESHNESS_RULES: dict[str, tuple[FreshnessRule, ...]] = {
    "core": (
        FreshnessRule("bridge_sync", "portfolio and market snapshot", 24.0),
        FreshnessRule("macro_sync", "macro indicators", 24.0),
        FreshnessRule("news_sync", "news feed", 24.0),
    ),
    "history": (
        FreshnessRule("historical_prices_sync", "historical prices", 36.0),
    ),
    "trident": (
        FreshnessRule("trident_screener_sync", "Trident screener", 8.0 * 24.0),
        FreshnessRule("historical_prices_trident_sync", "Trident historical prices", 8.0 * 24.0),
        FreshnessRule("trident_stock_insights_sync", "Trident stock insights", 8.0 * 24.0),
    ),
    "backtest": (
        FreshnessRule("backtest_run", "production reference backtest", 36.0),
    ),
}


def rules_for_scope(scope: str) -> list[FreshnessRule]:
    normalized = "all" if scope == "validate" else scope
    if normalized == "all":
        rules: list[FreshnessRule] = []
        for key in ("core", "history", "trident", "backtest"):
            rules.extend(FRESHNESS_RULES[key])
        return rules
    if normalized not in FRESHNESS_RULES:
        valid = ", ".join(["all", "validate", *FRESHNESS_RULES])
        raise ValueError(f"Unsupported scope '{scope}'. Expected one of: {valid}")
    return list(FRESHNESS_RULES[normalized])


def parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def latest_timestamp(row: Mapping[str, Any]) -> datetime | None:
    for key in ("finished_at", "updated_at", "started_at"):
        parsed = parse_timestamp(row.get(key))
        if parsed is not None:
            return parsed
    return None


def evaluate_rule(
    rule: FreshnessRule,
    row: Mapping[str, Any] | None,
    *,
    now: datetime,
) -> dict[str, Any]:
    if row is None:
        return {
            "job_name": rule.job_name,
            "label": rule.label,
            "status": "FAIL",
            "reason": "No etl_runs row found for required job.",
            "sla_hours": rule.sla_hours,
        }

    latest_status = str(row.get("status") or "").upper()
    completed_at = latest_timestamp(row)
    payload: dict[str, Any] = {
        "job_name": rule.job_name,
        "label": rule.label,
        "latest_status": latest_status or None,
        "started_at": row.get("started_at"),
        "finished_at": row.get("finished_at"),
        "updated_at": row.get("updated_at"),
        "duration_sec": row.get("duration_sec"),
        "sla_hours": rule.sla_hours,
    }
    if row.get("error"):
        payload["latest_error"] = row.get("error")

    if latest_status != "SUCCESS":
        payload["status"] = "FAIL"
        payload["reason"] = f"Latest etl_runs status is {latest_status or 'missing'}, expected SUCCESS."
        return payload

    if completed_at is None:
        payload["status"] = "FAIL"
        payload["reason"] = "Latest etl_runs row has no parseable timestamp."
        return payload

    age_hours = (now - completed_at).total_seconds() / 3600
    payload["age_hours"] = round(age_hours, 2)
    if age_hours > rule.sla_hours:
        payload["status"] = "FAIL"
        payload["reason"] = f"Latest successful run is older than {rule.sla_hours:g}h SLA."
        return payload

    payload["status"] = "PASS"
    return payload


def build_report(
    rows_by_job: Mapping[str, Mapping[str, Any] | None],
    *,
    scope: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    checks = [
        evaluate_rule(rule, rows_by_job.get(rule.job_name), now=now_utc)
        for rule in rules_for_scope(scope)
    ]
    status = "PASS" if all(check["status"] == "PASS" for check in checks) else "FAIL"
    return {
        "ok": status == "PASS",
        "status": status,
        "scope": scope,
        "generated_at": now_utc.isoformat(),
        "checks": checks,
    }


def get_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def get_supabase_client() -> Any:
    from supabase import create_client

    api_key = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not api_key:
        raise RuntimeError("SUPABASE_KEY or SUPABASE_SERVICE_ROLE_KEY is required")
    return create_client(get_env("SUPABASE_URL"), api_key)


def fetch_latest_run(supabase: Any, job_name: str) -> dict[str, Any] | None:
    response = (
        supabase
        .table("etl_runs")
        .select("job_name,status,started_at,finished_at,updated_at,duration_sec,error,stats")
        .eq("job_name", job_name)
        .order("started_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def write_report(path: str | None, report: Mapping[str, Any]) -> None:
    text = json.dumps(report, indent=2, sort_keys=True)
    print(text)
    if path:
        Path(path).write_text(text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate freshness of required etl_runs jobs")
    parser.add_argument(
        "--scope",
        default="all",
        choices=["all", "validate", "core", "history", "trident", "backtest"],
    )
    parser.add_argument("--output", default=None, help="Optional JSON report path")
    args = parser.parse_args()

    try:
        rules = rules_for_scope(args.scope)
        supabase = get_supabase_client()
        rows = {rule.job_name: fetch_latest_run(supabase, rule.job_name) for rule in rules}
        report = build_report(rows, scope=args.scope)
    except Exception as exc:
        report = {
            "ok": False,
            "status": "FAIL",
            "scope": args.scope,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
        }
        write_report(args.output, report)
        return 2

    write_report(args.output, report)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
