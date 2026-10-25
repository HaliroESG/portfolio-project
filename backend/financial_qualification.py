"""Conservative FI03 publication boundary, not a replacement financial engine.

No calculation version is financially qualified in this protection release.
READY, finite values, full coverage and cached receipts cannot grant qualification.
The same contract is exercised against the frontend with shared offline fixtures.
"""
from __future__ import annotations

import math
import re
from decimal import Decimal
from typing import Any, Mapping

POLICY_VERSION = "fi03-protect-v1"
REASON_CODE = "CALCULATION_NOT_QUALIFIED"
MESSAGE = "Calcul et historique non qualifiés : indicateur indisponible."
FIELDS = {
    "PORTFOLIO_PERFORMANCE": (
        "twr_daily", "twr_mtd", "twr_ytd", "twr_since_inception",
        "xirr_since_inception", "benchmark_daily", "benchmark_ytd",
    ),
    "PORTFOLIO_RISK": ("volatility_30d_pct", "max_drawdown_ytd_pct"),
    "BACKTEST": (
        "drawdown", "returns_daily", "cagr", "vol", "sharpe", "sortino",
        "max_drawdown", "calmar", "worst_year", "best_year",
    ),
}
RISK_EXPORT_FIELDS = (
    "portfolio_id", "risk_date", "calculated_at", "data_state",
    "volatility_30d_pct", "max_drawdown_ytd_pct", "largest_position_pct",
    "top10_concentration_pct", "cash_pct", "illiquid_pct", "fx_exposure_pct",
)


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        return None
    if isinstance(value, str) and not re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", value.strip()):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return result if math.isfinite(result) else None


def qualification(family: str, row: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Return provenance with an explicit abstention, even for unknown families."""
    row = row or {}
    return {
        "policy_version": POLICY_VERSION,
        "state": "UNQUALIFIED",
        "reason_code": REASON_CODE,
        "message": MESSAGE,
        "metric_family": family if family in FIELDS else "UNKNOWN",
        "calculation_version": _text(row.get("calculation_version")),
        "portfolio_id": _text(row.get("portfolio_id") or row.get("portfolio_key")),
        "run_id": _text(row.get("run_id")),
        "window_start": _text(row.get("start_date")),
        "window_end": _text(row.get("end_date") or row.get("performance_date") or row.get("risk_date") or row.get("period_end") or row.get("date")),
        "calculated_at": _text(row.get("calculated_at")),
        "coverage_pct": _finite(row.get("coverage_pct")),
    }


def protect_fields(row: Mapping[str, Any], family: str) -> dict[str, Any]:
    """Copy only; never mutate a frozen report, caller object or database row."""
    protected = dict(row)
    for key in FIELDS[family]:
        if key in protected:
            protected[key] = None
    return protected


def protect_performance_payload(row: Mapping[str, Any]) -> dict[str, Any]:
    protected = protect_fields(row, "PORTFOLIO_PERFORMANCE")
    if protected.get("data_state") == "READY":
        protected["data_state"] = "PARTIAL"
    return protected


def protect_risk_payload(row: Mapping[str, Any]) -> dict[str, Any]:
    protected = protect_fields(row, "PORTFOLIO_RISK")
    if protected.get("data_state") == "READY":
        protected["data_state"] = "PARTIAL"
    return protected


def risk_export(row: Mapping[str, Any] | None) -> dict[str, Any]:
    # An allowlist prevents historical JSON/details/unknown aliases from bypassing
    # the named-column filter through the previous generic CSV risk dump.
    safe = {key: row[key] for key in RISK_EXPORT_FIELDS if row and key in row}
    return protect_risk_payload(safe)


def has_protected_dependency(value: Any) -> bool:
    """Recognize structured financial inputs, without blocking independent weights."""
    if isinstance(value, str):
        return value in FIELDS or any(value in fields for fields in FIELDS.values())
    if isinstance(value, list):
        return any(has_protected_dependency(item) for item in value)
    if not isinstance(value, Mapping):
        return False
    protected_keys = {key for fields in FIELDS.values() for key in fields}
    for key, item in value.items():
        if key in protected_keys or (key == "metric_family" and isinstance(item, str) and item in FIELDS):
            return True
        if has_protected_dependency(item):
            return True
    return False
