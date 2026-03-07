from __future__ import annotations

from typing import Any, Mapping


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return None
    return max(parsed, 0)


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed


def build_etl_stats(
    job_name: str,
    stats: Mapping[str, Any] | None = None,
    *,
    items_total: int | None = None,
    items_success: int | None = None,
    items_failed: int | None = None,
    coverage_pct: float | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = dict(stats or {})

    normalized_total = _to_int(items_total)
    if normalized_total is None:
        normalized_total = _to_int(payload.get("items_total"))
    if normalized_total is None:
        normalized_total = _to_int(payload.get("assets_total"))
    if normalized_total is None:
        normalized_total = _to_int(payload.get("tickers"))
    if normalized_total is None:
        normalized_total = _to_int(payload.get("unique_count"))

    normalized_success = _to_int(items_success)
    if normalized_success is None:
        normalized_success = _to_int(payload.get("items_success"))
    if normalized_success is None:
        normalized_success = _to_int(payload.get("status_ok"))
    if normalized_success is None:
        normalized_success = _to_int(payload.get("tickers_ok"))
    if normalized_success is None:
        normalized_success = _to_int(payload.get("updated"))
    if normalized_success is None:
        normalized_success = _to_int(payload.get("unique_count"))

    normalized_failed = _to_int(items_failed)
    if normalized_failed is None:
        normalized_failed = _to_int(payload.get("items_failed"))
    if normalized_failed is None:
        normalized_failed = _to_int(payload.get("tickers_failed"))
    if normalized_failed is None:
        normalized_failed = _to_int(payload.get("failed"))

    if normalized_total is None and normalized_success is not None and normalized_failed is not None:
        normalized_total = normalized_success + normalized_failed
    if normalized_failed is None and normalized_total is not None and normalized_success is not None:
        normalized_failed = max(normalized_total - normalized_success, 0)
    if normalized_success is None and normalized_total is not None and normalized_failed is not None:
        normalized_success = max(normalized_total - normalized_failed, 0)

    normalized_coverage = _to_float(coverage_pct)
    if normalized_coverage is None:
        normalized_coverage = _to_float(payload.get("coverage_pct"))
    if normalized_coverage is not None:
        normalized_coverage = max(0.0, min(100.0, normalized_coverage))
        payload["coverage_pct"] = round(normalized_coverage, 2)

    if normalized_total is not None:
        payload["items_total"] = normalized_total
    if normalized_success is not None:
        payload["items_success"] = normalized_success
    if normalized_failed is not None:
        payload["items_failed"] = normalized_failed

    payload["stats_schema_version"] = 1
    payload["job_name"] = job_name
    return payload
