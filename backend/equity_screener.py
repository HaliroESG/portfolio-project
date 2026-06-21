from __future__ import annotations

import argparse
import json
import os
import sys
import time
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

from etl_stats import build_etl_stats


BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

JOB_NAME = "equity_screener_sync"
PAGE_SIZE = 1000

THEME_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "IT_SERVICES",
        (
            "information technology services",
            "it services",
            "it consulting",
            "technology consulting",
            "digital services",
            "systems integrator",
            "business consulting",
            "outsourcing",
            "consulting services",
            "computer services",
        ),
    ),
    (
        "SOFTWARE",
        (
            "software",
            "application software",
            "systems software",
            "cloud",
            "saas",
        ),
    ),
    (
        "SEMICONDUCTOR",
        (
            "semiconductor",
            "semiconductors",
            "chip",
            "integrated circuit",
        ),
    ),
)

KNOWN_IT_SERVICES_NAMES = (
    "accenture",
    "capgemini",
    "sopra steria",
    "wavestone",
    "atos",
    "cgi",
    "infosys",
    "wipro",
    "tata consultancy",
    "tcs",
    "hcl technologies",
    "cognizant",
    "epam",
    "globant",
    "endava",
    "reply",
    "aubay",
    "infotel",
    "alten",
)


def clean_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def safe_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value == value:
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        parsed = float(text)
    except ValueError:
        return None
    return parsed if parsed == parsed else None


def safe_int(value: Any) -> int | None:
    parsed = safe_float(value)
    return int(parsed) if parsed is not None else None


def normalize_currency(value: Any) -> str | None:
    text = clean_string(value)
    if not text:
        return None
    normalized = text.upper()
    return normalized if len(normalized) == 3 else None


def normalize_text(*values: Any) -> str:
    joined = " ".join(str(value) for value in values if value is not None)
    stripped = unicodedata.normalize("NFKD", joined).encode("ascii", "ignore").decode("ascii")
    return " ".join(stripped.lower().split())


def ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


def annualized_growth(start_value: float | None, end_value: float | None, years: int) -> float | None:
    if years <= 0 or start_value is None or end_value is None or start_value <= 0 or end_value <= 0:
        return None
    return (end_value / start_value) ** (1 / years) - 1


def extract_themes(universe_row: Mapping[str, Any]) -> list[str]:
    haystack = normalize_text(
        universe_row.get("name"),
        universe_row.get("sector"),
        universe_row.get("industry"),
    )
    themes: set[str] = set()
    for theme, needles in THEME_RULES:
        if any(needle in haystack for needle in needles):
            themes.add(theme)
    if any(name in haystack for name in KNOWN_IT_SERVICES_NAMES):
        themes.add("IT_SERVICES")
    return sorted(themes)


def record_year(row: Mapping[str, Any]) -> int | None:
    return safe_int(row.get("fiscal_year"))


def latest_financial(records: list[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    dated = [(record_year(record), record) for record in records]
    dated = [(year, record) for year, record in dated if year is not None]
    if not dated:
        return None
    return max(dated, key=lambda item: item[0])[1]


def cagr_for_years(records: list[Mapping[str, Any]], field: str, years: int) -> float | None:
    latest = latest_financial(records)
    latest_year = record_year(latest or {})
    if latest is None or latest_year is None:
        return None
    candidates = [
        (record_year(record), record)
        for record in records
        if record_year(record) is not None and record_year(record) <= latest_year - years
    ]
    if not candidates:
        return None
    start_year, start = max(candidates, key=lambda item: item[0])
    return annualized_growth(
        safe_float(start.get(field)),
        safe_float(latest.get(field)),
        latest_year - start_year,
    )


def market_cap_segment(market_cap: float | None) -> str | None:
    if market_cap is None:
        return None
    if market_cap >= 200_000_000_000:
        return "MEGA"
    if market_cap >= 10_000_000_000:
        return "LARGE"
    if market_cap >= 2_000_000_000:
        return "MID"
    if market_cap >= 300_000_000:
        return "SMALL"
    return "MICRO"


def score_band(value: float | None, bands: tuple[tuple[float, int], ...]) -> int:
    if value is None:
        return 0
    for threshold, points in bands:
        if value >= threshold:
            return points
    return 0


def inverse_score_band(value: float | None, bands: tuple[tuple[float, int], ...]) -> int:
    if value is None or value <= 0:
        return 0
    for threshold, points in bands:
        if value <= threshold:
            return points
    return 0


def quality_value_score(
    *,
    trailing_pe: float | None,
    forward_pe: float | None,
    fcf_yield: float | None,
    fcf_margin: float | None,
    revenue_cagr_3y: float | None,
    roic: float | None,
    net_debt_to_ebitda: float | None,
) -> tuple[float, dict[str, Any]]:
    valuation_points = max(
        inverse_score_band(trailing_pe, ((12, 20), (18, 16), (25, 10), (35, 4))),
        inverse_score_band(forward_pe, ((12, 20), (18, 16), (25, 10), (35, 4))),
    )
    fcf_points = score_band(fcf_yield, ((0.08, 25), (0.05, 18), (0.03, 10), (0.01, 4)))
    quality_points = (
        score_band(roic, ((0.20, 12), (0.15, 9), (0.10, 5)))
        + score_band(fcf_margin, ((0.15, 8), (0.10, 6), (0.05, 3)))
    )
    growth_points = score_band(revenue_cagr_3y, ((0.10, 15), (0.06, 11), (0.03, 6), (0.0, 2)))
    if net_debt_to_ebitda is None:
        health_points = 0
    elif net_debt_to_ebitda < 1.5:
        health_points = 20
    elif net_debt_to_ebitda < 2.5:
        health_points = 14
    elif net_debt_to_ebitda < 3.5:
        health_points = 7
    else:
        health_points = 0

    score = valuation_points + fcf_points + quality_points + growth_points + health_points
    details = {
        "valuation_points": valuation_points,
        "fcf_points": fcf_points,
        "quality_points": quality_points,
        "growth_points": growth_points,
        "health_points": health_points,
    }
    return float(min(max(score, 0), 100)), details


def valuation_tag(
    *,
    score: float,
    trailing_pe: float | None,
    forward_pe: float | None,
    fcf_yield: float | None,
    fcf_margin: float | None,
    revenue_cagr_3y: float | None,
) -> str:
    pe_values = [value for value in (forward_pe, trailing_pe) if value is not None and value > 0]
    best_pe = min(pe_values) if pe_values else None
    if best_pe is None and fcf_yield is None:
        return "INSUFFICIENT_DATA"
    if score >= 55 and (fcf_yield or 0) >= 0.04 and (best_pe is None or best_pe <= 25):
        return "POTENTIAL_VALUE"
    if best_pe is not None and best_pe >= 40:
        return "EXPENSIVE"
    if best_pe is not None and best_pe >= 35 and fcf_yield is not None and fcf_yield < 0.03:
        return "EXPENSIVE"
    if fcf_yield is not None and fcf_yield < 0.01 and (fcf_margin or 0) < 0.05 and (revenue_cagr_3y or 0) < 0.03:
        return "EXPENSIVE"
    return "FAIR"


def build_screener_rows(
    universe_rows: Iterable[Mapping[str, Any]],
    financial_rows: Iterable[Mapping[str, Any]],
    trident_rows: Iterable[Mapping[str, Any]],
    insight_rows: Iterable[Mapping[str, Any]],
    *,
    as_of_date: date | None = None,
) -> list[dict[str, Any]]:
    as_of = as_of_date or datetime.now(timezone.utc).date()
    financials_by_key: dict[str, list[Mapping[str, Any]]] = {}
    for row in financial_rows:
        key = clean_string(row.get("instrument_key"))
        if key:
            financials_by_key.setdefault(key, []).append(row)

    trident_by_key = {
        clean_string(row.get("instrument_key")): row
        for row in trident_rows
        if clean_string(row.get("instrument_key"))
    }
    insight_by_key = {
        clean_string(row.get("instrument_key")): row
        for row in insight_rows
        if clean_string(row.get("instrument_key"))
    }

    output: list[dict[str, Any]] = []
    for universe in universe_rows:
        if universe.get("is_active") is False:
            continue
        instrument_key = clean_string(universe.get("instrument_key"))
        ticker = clean_string(universe.get("ticker"))
        provider = clean_string(universe.get("provider"))
        if not instrument_key or not ticker or not provider:
            continue

        financials = financials_by_key.get(instrument_key, [])
        latest = latest_financial(financials)
        trident = trident_by_key.get(instrument_key, {})
        insight = insight_by_key.get(instrument_key, {})

        financial_currency = normalize_currency((latest or {}).get("currency"))
        valuation_currency = normalize_currency(insight.get("price_currency")) or normalize_currency(universe.get("currency"))
        currency = normalize_currency(universe.get("currency"))
        market_cap = safe_float(insight.get("market_cap"))
        revenue = safe_float((latest or {}).get("revenue"))
        free_cash_flow = safe_float((latest or {}).get("free_cash_flow"))
        fcf_margin = ratio(free_cash_flow, revenue)
        currencies_match = (
            financial_currency is not None
            and valuation_currency is not None
            and financial_currency == valuation_currency
        )
        fcf_yield = ratio(free_cash_flow, market_cap) if currencies_match else None
        revenue_cagr_3y = cagr_for_years(financials, "revenue", 3)
        revenue_cagr_5y = cagr_for_years(financials, "revenue", 5)
        trailing_pe = safe_float(insight.get("trailing_pe"))
        forward_pe = safe_float(insight.get("forward_pe"))
        roic = safe_float(trident.get("latest_roic"))
        net_debt_to_ebitda = safe_float(trident.get("latest_net_debt_to_ebitda"))
        target_mean_price = safe_float(insight.get("target_mean_price"))
        latest_price = safe_float(insight.get("latest_price"))
        target_upside = ratio(target_mean_price, latest_price)
        if target_upside is not None:
            target_upside -= 1

        score, details = quality_value_score(
            trailing_pe=trailing_pe,
            forward_pe=forward_pe,
            fcf_yield=fcf_yield,
            fcf_margin=fcf_margin,
            revenue_cagr_3y=revenue_cagr_3y,
            roic=roic,
            net_debt_to_ebitda=net_debt_to_ebitda,
        )
        details["market_cap_segment"] = market_cap_segment(market_cap)

        data_state: set[str] = set()
        if latest is None:
            data_state.add("FINANCIALS_UNAVAILABLE")
        if not insight:
            data_state.add("INSIGHTS_UNAVAILABLE")
        if market_cap is None:
            data_state.add("MARKET_CAP_UNAVAILABLE")
        if free_cash_flow is None:
            data_state.add("FCF_UNAVAILABLE")
        if revenue_cagr_3y is None:
            data_state.add("GROWTH_HISTORY_UNAVAILABLE")
        if forward_pe is None:
            data_state.add("FORWARD_PE_UNAVAILABLE")
        data_state.add("FORECAST_UNAVAILABLE")
        if financial_currency and valuation_currency and financial_currency != valuation_currency:
            data_state.add("CURRENCY_MISMATCH")
        if fcf_yield is None:
            data_state.add("FCF_YIELD_UNAVAILABLE")
        if not data_state:
            data_state.add("READY")

        output.append({
            "instrument_key": instrument_key,
            "as_of_date": as_of.isoformat(),
            "ticker": ticker,
            "name": clean_string(universe.get("name")),
            "exchange": clean_string(universe.get("exchange")),
            "country": clean_string(universe.get("country")),
            "sector": clean_string(universe.get("sector")),
            "industry": clean_string(universe.get("industry")),
            "currency": currency,
            "provider": provider,
            "provider_symbol": clean_string(universe.get("provider_symbol")),
            "source_index": clean_string(universe.get("source_index")),
            "themes": extract_themes(universe),
            "latest_fiscal_year": record_year(latest or {}),
            "financial_currency": financial_currency,
            "valuation_currency": valuation_currency,
            "market_cap": market_cap,
            "revenue": revenue,
            "free_cash_flow": free_cash_flow,
            "fcf_margin": fcf_margin,
            "fcf_yield": fcf_yield,
            "revenue_cagr_3y": revenue_cagr_3y,
            "revenue_cagr_5y": revenue_cagr_5y,
            "forecast_revenue_growth": None,
            "trailing_pe": trailing_pe,
            "forward_pe": forward_pe,
            "latest_roic": roic,
            "latest_net_debt_to_ebitda": net_debt_to_ebitda,
            "target_upside": target_upside,
            "recommendation_key": clean_string(insight.get("recommendation_key")),
            "analyst_count": safe_int(insight.get("number_of_analyst_opinions")),
            "trident_score": safe_float(trident.get("score")),
            "trident_state": clean_string(trident.get("overall_state")),
            "quality_value_score": score,
            "valuation_tag": valuation_tag(
                score=score,
                trailing_pe=trailing_pe,
                forward_pe=forward_pe,
                fcf_yield=fcf_yield,
                fcf_margin=fcf_margin,
                revenue_cagr_3y=revenue_cagr_3y,
            ),
            "score_details": details,
            "data_state": sorted(data_state),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    return output


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


def fetch_all_rows(supabase: Any, table: str, selector: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for offset in range(0, 1_000_000, PAGE_SIZE):
        response = (
            supabase
            .table(table)
            .select(selector)
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        batch = list(response.data or [])
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
    return rows


def upsert_rows(supabase: Any, rows: list[dict[str, Any]], *, dry_run: bool) -> int:
    if dry_run or not rows:
        return 0
    total = 0
    for index in range(0, len(rows), 500):
        batch = rows[index:index + 500]
        response = (
            supabase
            .table("equity_screener_results")
            .upsert(batch, on_conflict="instrument_key")
            .execute()
        )
        total += len(response.data or batch)
    return total


def run_equity_screener_sync(
    supabase: Any,
    *,
    dry_run: bool = False,
    limit: int | None = None,
) -> dict[str, Any]:
    universe = fetch_all_rows(
        supabase,
        "trident_equity_universe",
        "instrument_key,ticker,name,exchange,country,sector,industry,currency,provider,provider_symbol,source_index,is_active",
    )
    financials = fetch_all_rows(
        supabase,
        "trident_financial_annual",
        "instrument_key,fiscal_year,currency,revenue,free_cash_flow",
    )
    trident = fetch_all_rows(
        supabase,
        "trident_results",
        "instrument_key,overall_state,score,latest_roic,latest_net_debt_to_ebitda",
    )
    insights = fetch_all_rows(
        supabase,
        "trident_stock_insights",
        "instrument_key,market_cap,trailing_pe,forward_pe,target_mean_price,latest_price,price_currency,recommendation_key,number_of_analyst_opinions",
    )
    active_universe = [row for row in universe if row.get("is_active") is not False]
    if limit is not None:
        active_universe = active_universe[:limit]

    rows = build_screener_rows(active_universe, financials, trident, insights)
    upserted = upsert_rows(supabase, rows, dry_run=dry_run)
    theme_counts: dict[str, int] = {}
    tag_counts: dict[str, int] = {}
    state_counts: dict[str, int] = {}
    country_counts: dict[str, int] = {}
    for row in rows:
        for theme in row["themes"]:
            theme_counts[theme] = theme_counts.get(theme, 0) + 1
        tag = str(row["valuation_tag"])
        tag_counts[tag] = tag_counts.get(tag, 0) + 1
        country = str(row.get("country") or "UNKNOWN")
        country_counts[country] = country_counts.get(country, 0) + 1
        for state in row["data_state"]:
            state_counts[state] = state_counts.get(state, 0) + 1

    stats = {
        "source_universe_rows": len(universe),
        "active_universe_rows": len(active_universe),
        "financial_rows": len(financials),
        "trident_rows": len(trident),
        "insight_rows": len(insights),
        "screener_rows": len(rows),
        "upserted_rows": upserted,
        "theme_counts": dict(sorted(theme_counts.items())),
        "valuation_tag_counts": dict(sorted(tag_counts.items())),
        "state_counts": dict(sorted(state_counts.items())),
        "country_counts": dict(sorted(country_counts.items())),
        "items_total": len(active_universe),
        "items_success": len(rows),
        "items_failed": max(len(active_universe) - len(rows), 0),
    }
    if dry_run:
        stats["dry_run"] = True
        stats["sample_rows"] = rows[:5]
    return stats


def start_etl_run(supabase: Any) -> str | None:
    try:
        response = (
            supabase
            .table("etl_runs")
            .insert({
                "job_name": JOB_NAME,
                "status": "RUNNING",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            .execute()
        )
        if response.data:
            return response.data[0].get("id")
    except Exception as exc:
        print(f"Could not start etl_runs for {JOB_NAME}: {exc}", flush=True)
    return None


def finish_etl_run(
    supabase: Any,
    run_id: str | None,
    status: str,
    duration_sec: float,
    *,
    stats: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    if not run_id:
        return
    payload: dict[str, Any] = {
        "status": status,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "duration_sec": round(duration_sec, 2),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if stats is not None:
        payload["stats"] = stats
    if error:
        payload["error"] = error
    try:
        supabase.table("etl_runs").update(payload).eq("id", run_id).execute()
    except Exception as exc:
        print(f"Could not finish etl_runs for {JOB_NAME}: {exc}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync open equity screener read model")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    supabase = get_supabase_client()
    run_id = None if args.dry_run else start_etl_run(supabase)
    started = time.time()
    try:
        stats = run_equity_screener_sync(supabase, dry_run=args.dry_run, limit=args.limit)
        normalized = build_etl_stats(
            JOB_NAME,
            stats,
            items_total=stats.get("items_total"),
            items_success=stats.get("items_success"),
            items_failed=stats.get("items_failed"),
        )
        if not args.dry_run:
            finish_etl_run(supabase, run_id, "SUCCESS", time.time() - started, stats=normalized)
        text = json.dumps(normalized, indent=2, sort_keys=True)
        print(text)
        if args.output:
            Path(args.output).write_text(text, encoding="utf-8")
    except Exception as exc:
        if not args.dry_run:
            finish_etl_run(supabase, run_id, "FAILED", time.time() - started, error=str(exc))
        raise


if __name__ == "__main__":
    main()
