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
    "portfolio_positions": [
        "portfolio_id", "ticker", "quantity_current", "target_weight_pct",
        "isin", "target_notes", "target_source", "target_source_file",
        "target_updated_at", "actual_source", "actual_source_accounts",
        "actual_as_of_date", "actual_updated_at",
    ],
    "portfolios": ["id", "name"],
    "historical_prices": [
        "ticker", "date", "adj_close", "currency", "source", "updated_at",
        "adj_close_local", "local_currency", "fx_rate_to_eur",
    ],
    "historical_price_coverage": [
        "ticker", "requested_start_date", "requested_end_date", "earliest_date",
        "coverage_pct", "used_proxy", "updated_at",
    ],
    "backtest_runs": [
        "id", "name", "created_at", "base_currency", "start_date", "end_date",
        "rebalance_freq", "fee_bps", "inflation_adjusted", "config_json",
        "requested_start_date", "requested_end_date", "start_date_effective",
        "end_date_effective", "data_mode", "diagnostics_json",
    ],
    "backtest_portfolios": [
        "run_id", "portfolio_key", "portfolio_id", "preset_key", "label", "role",
        "weights_json", "start_date_effective", "created_at",
    ],
    "backtest_results": [
        "run_id", "portfolio_key", "date", "nav", "drawdown", "returns_daily",
    ],
    "backtest_kpis": [
        "run_id", "portfolio_key", "cagr", "vol", "sharpe", "sortino",
        "max_drawdown", "calmar", "worst_year", "best_year",
    ],
    "trident_equity_universe": [
        "instrument_key", "ticker", "name", "exchange", "country", "sector",
        "industry", "currency", "provider", "provider_symbol", "source_license_note",
        "source_index", "is_active", "updated_at",
    ],
    "trident_financial_annual": [
        "instrument_key", "fiscal_year", "currency", "revenue", "eps_diluted",
        "free_cash_flow", "gross_profit", "operating_income", "net_income",
        "invested_capital", "total_equity", "capital_employed", "ebitda",
        "net_debt", "interest_expense", "total_debt", "shares_diluted", "provider",
    ],
    "trident_results": [
        "instrument_key", "as_of_date", "latest_fiscal_year", "overall_state",
        "score", "confidence", "growth_score", "profitability_score",
        "capital_score", "health_score", "latest_roic",
        "latest_net_debt_to_ebitda", "failed_eliminators", "horizons", "summary",
    ],
    "trident_criterion_results": [
        "instrument_key", "horizon_years", "criterion_key", "category", "label",
        "status", "actual", "threshold", "comparator", "is_eliminating", "reason",
    ],
    "trident_screener_latest": [
        "instrument_key", "ticker", "name", "exchange", "country", "sector",
        "provider", "provider_symbol", "source_provider", "source_index", "overall_state", "score", "confidence", "latest_roic",
        "latest_net_debt_to_ebitda", "horizons", "summary",
        "criteria_pass_count", "criteria_fail_count", "criteria_missing_count",
    ],
    "trident_stock_insights": [
        "instrument_key", "ticker", "provider_symbol", "business_summary",
        "website", "market_cap", "trailing_pe", "forward_pe",
        "recommendation_key", "recommendation_mean", "target_mean_price",
        "target_high_price", "target_low_price", "number_of_analyst_opinions",
        "latest_price", "price_currency", "regression_slope_pct",
        "regression_z_score", "ma200_state", "momentum_3m_pct",
        "momentum_12m_pct", "trend_state", "trend_reason_codes",
        "price_history_state", "news_items", "ai_trend_summary",
        "ai_summary_state", "source_provider", "source_url", "data_state",
        "updated_at",
    ],
    "equity_screener_results": [
        "instrument_key", "as_of_date", "ticker", "name", "exchange", "country",
        "sector", "industry", "currency", "provider", "provider_symbol",
        "source_index", "themes", "latest_fiscal_year", "financial_currency",
        "valuation_currency", "market_cap", "revenue", "free_cash_flow",
        "market_cap_usd", "market_cap_fx_rate", "market_cap_fx_as_of",
        "fcf_margin", "fcf_yield", "revenue_cagr_3y", "revenue_cagr_5y",
        "forecast_revenue_growth", "trailing_pe", "forward_pe", "latest_roic",
        "latest_net_debt_to_ebitda", "target_upside", "recommendation_key",
        "analyst_count", "trident_score", "trident_state",
        "regression_slope_pct", "regression_z_score", "ma200_state",
        "momentum_3m_pct", "momentum_12m_pct", "price_coverage_pct",
        "quality_value_score", "valuation_tag", "score_details", "data_state",
        "updated_at",
    ],
    "equity_screener_latest": [
        "instrument_key", "ticker", "name", "country", "sector", "industry",
        "themes", "market_cap", "revenue", "free_cash_flow", "fcf_margin",
        "market_cap_usd", "market_cap_fx_rate", "market_cap_fx_as_of",
        "fcf_yield", "revenue_cagr_3y", "forecast_revenue_growth",
        "trailing_pe", "forward_pe", "target_upside",
        "regression_slope_pct", "regression_z_score", "ma200_state",
        "momentum_3m_pct", "momentum_12m_pct", "price_coverage_pct",
        "quality_value_score",
        "valuation_tag", "data_state", "updated_at",
    ],
    "broker_transactions": [
        "id", "broker", "account_id", "external_txn_id", "idempotency_key",
        "trade_date", "settlement_date", "symbol", "isin", "side", "quantity",
        "price", "gross_amount", "fees", "taxes", "net_amount", "currency",
        "envelope", "raw_type", "source_file",
    ],
    "broker_reconciliation_runs": [
        "id", "broker", "account_id", "reconciliation_date", "mode", "status",
        "parsed_count", "position_count", "state_counts", "report_json", "idempotency_key",
    ],
    "broker_reconciliation_items": [
        "id", "run_id", "instrument_key", "symbol", "isin", "currency", "state",
        "ledger_quantity", "broker_quantity", "quantity_delta", "ledger_average_cost",
        "broker_average_cost", "transaction_count",
    ],
    "broker_position_snapshot_runs": [
        "id", "broker", "account_id", "portfolio_id", "envelope", "as_of_date",
        "source_file", "position_count", "idempotency_key", "report_json",
        "created_at", "updated_at",
    ],
    "broker_position_snapshot_items": [
        "id", "run_id", "portfolio_id", "broker", "account_id", "envelope",
        "as_of_date", "symbol", "isin", "name", "currency", "quantity",
        "average_cost", "source_row", "created_at",
    ],
    "portfolio_decision_items_latest": [
        "portfolio_id", "ticker", "name", "currency", "current_quantity",
        "current_value_eur", "current_weight_pct", "target_weight_pct", "drift_pct",
        "rebalance_amount_eur", "action", "confidence", "reason_codes",
        "data_state", "price_state", "updated_at",
    ],
    "support_sources": [
        "id", "source_name", "source_kind", "provider", "source_file", "source_date",
        "source_quality", "source_url", "report_json", "imported_at", "updated_at",
    ],
    "investment_supports": [
        "source_id", "isin", "name", "support_type", "legal_form", "manager",
        "sri", "performance_1y_pct", "performance_5y_pct", "asset_fee_pct",
        "contract_fee_pct", "total_fee_pct", "morningstar_rating",
        "quantalys_rating", "metrics_state", "score", "score_details",
        "page", "raw_text", "updated_at",
    ],
    "support_availability": [
        "source_id", "isin", "envelope", "available", "constraints_json", "updated_at",
    ],
    "support_source_rows": [
        "source_id", "external_id", "isin", "name", "support_type", "legal_form",
        "manager", "sri", "performance_1y_pct", "performance_5y_pct",
        "asset_fee_pct", "contract_fee_pct", "total_fee_pct", "retrocession_pct",
        "source_quality", "identifier_state", "envelope", "score", "score_details",
        "page", "raw_text", "updated_at",
    ],
    "target_models": [
        "id", "portfolio_scope", "model_name", "source_file", "source_kind",
        "as_of_date", "is_active", "target_total_pct", "status", "report_json",
        "imported_at", "updated_at",
    ],
    "target_buckets": [
        "id", "model_id", "portfolio_scope", "bucket_key", "bucket_label",
        "parent_bucket_key", "target_weight_pct", "lower_band_pct",
        "upper_band_pct", "source_sheet", "source_row", "updated_at",
    ],
    "target_envelope_lines": [
        "id", "model_id", "portfolio_scope", "envelope", "ticker", "isin",
        "instrument", "asset_class", "region", "currency", "target_weight_pct",
        "target_value_eur", "notes", "source_sheet", "source_row", "updated_at",
    ],
    "target_model_audit_holdings": [
        "id", "model_id", "portfolio_scope", "envelope", "ticker", "isin",
        "instrument", "asset_class", "region", "currency", "market_value_eur",
        "quantity", "notes", "source_sheet", "source_row", "updated_at",
    ],
    "allocation_advice_items_latest": [
        "portfolio_scope", "model_id", "model_name", "bucket_key",
        "bucket_label", "current_value_eur", "current_weight_pct",
        "target_weight_pct", "drift_pct", "rebalance_amount_eur",
        "action", "confidence", "reason_codes", "preferred_execution", "updated_at",
    ],
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
