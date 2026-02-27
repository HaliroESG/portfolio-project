#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from typing import Any

from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

CRITICAL_SCHEMA: dict[str, list[str]] = {
    "market_watch": [
        "ticker", "last_price", "currency", "data_status", "last_update",
        "ma200_value", "ma200_status", "trend_slope", "volatility_30d",
        "macd_line", "macd_signal", "macd_hist", "rsi_14", "momentum_20",
        "trend_state", "trend_changed",
    ],
    "etl_runs": [
        "job_name", "status", "started_at", "finished_at", "duration_sec",
        "stats", "error", "updated_at",
    ],
    "valuation_snapshots": ["coverage_pct", "created_at"],
    "currencies": ["id", "symbol", "rate_to_eur", "last_update"],
    "news_feed": ["ticker", "published_at", "impact_score", "impact_level"],
    "macro_indicators": ["id", "value", "last_update"],
    "portfolio_positions": ["portfolio_id", "ticker", "quantity_current", "target_weight_pct"],
    "portfolios": ["id", "name"],
}


def _headers(api_key: str) -> dict[str, str]:
    return {"apikey": api_key, "Authorization": f"Bearer {api_key}", "Accept": "application/json"}


def _safe_json_bytes(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {"raw": raw.decode("utf-8", errors="replace")}


def _http_get(base_url: str, api_key: str, table: str, select_expr: str) -> tuple[int, Any]:
    params = urlencode({"select": select_expr, "limit": 1})
    url = f"{base_url}/rest/v1/{table}?{params}"
    req = Request(url, headers=_headers(api_key), method="GET")
    try:
        with urlopen(req, timeout=20) as resp:
            status = getattr(resp, "status", 200)
            body = resp.read()
            return status, _safe_json_bytes(body)
    except HTTPError as e:
        body = e.read() if hasattr(e, "read") else b""
        return e.code, _safe_json_bytes(body)
    except URLError as e:
        return 599, {"message": str(e)}


def check_table_exists(base_url: str, api_key: str, table: str) -> tuple[bool, str | None]:
    status, payload = _http_get(base_url, api_key, table, "*")
    if status in (200, 206):
        return True, None
    msg = payload.get("message") if isinstance(payload, dict) else str(payload)
    return False, f"HTTP {status}: {msg}"


def check_column_exists(base_url: str, api_key: str, table: str, column: str) -> tuple[bool, str | None]:
    status, payload = _http_get(base_url, api_key, table, column)
    if status in (200, 206):
        return True, None
    msg = payload.get("message") if isinstance(payload, dict) else str(payload)
    return False, f"HTTP {status}: {msg}"


def run_check(base_url: str, api_key: str) -> dict[str, Any]:
    report: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "supabase_url": base_url,
        "pass": True,
        "tables": {},
    }

    for table, required_columns in CRITICAL_SCHEMA.items():
        exists, table_error = check_table_exists(base_url, api_key, table)
        missing_columns: list[str] = []
        errors: list[str] = []

        if not exists:
            errors.append(table_error or "table does not exist")
        else:
            for col in required_columns:
                ok, col_err = check_column_exists(base_url, api_key, table, col)
                if not ok:
                    missing_columns.append(col)
                    if col_err:
                        errors.append(f"{col}: {col_err}")

        table_pass = exists and not missing_columns
        if not table_pass:
            report["pass"] = False

        report["tables"][table] = {
            "exists": exists,
            "required_columns": required_columns,
            "missing_columns": missing_columns,
            "errors": errors,
            "pass": table_pass,
        }

    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Supabase schema parity check (read-only)")
    parser.add_argument("--output", help="Optional output JSON file")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    args = parser.parse_args()

    base_url = os.environ.get("SUPABASE_URL")
    api_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")

    if not base_url or not api_key:
        payload = {
            "pass": False,
            "error": "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY)",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        print(json.dumps(payload, indent=2 if args.pretty else None))
        return 2

    report = run_check(base_url.rstrip('/'), api_key)
    text = json.dumps(report, indent=2 if args.pretty else None)
    print(text)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fp:
            fp.write(text)

    return 0 if report.get("pass") else 1


if __name__ == "__main__":
    raise SystemExit(main())
