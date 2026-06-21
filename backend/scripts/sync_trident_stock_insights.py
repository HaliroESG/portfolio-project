#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import signal
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

import requests
import yfinance as yf
from supabase import create_client

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from etl_stats import build_etl_stats
from historical_prices_sync import finish_etl_run, start_etl_run
from supabase_key_guard import require_backend_supabase_key
from trident_screener import CURATED_IT_SERVICES_SYMBOLS

JOB_NAME = "trident_stock_insights_sync"
DEFAULT_TOP_N = 200
DEFAULT_STALE_HOURS = 24
PRICE_ROW_PAGE_SIZE = 1000
MIN_REGRESSION_POINTS = 30
MA200_WINDOW = 200
NEWS_LIMIT = 5
DEFAULT_PROFILE_TIMEOUT_SEC = 30.0
DEFAULT_UPSERT_BATCH_SIZE = 25

TRIDENT_SELECTOR = ",".join([
    "instrument_key",
    "ticker",
    "provider_symbol",
    "name",
    "currency",
    "score",
])


@dataclass(frozen=True)
class TridentInsightTarget:
    instrument_key: str
    ticker: str
    provider_symbol: str | None
    name: str | None
    currency: str | None
    score: float | None

    @property
    def lookup_symbol(self) -> str:
        return self.provider_symbol or self.ticker


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


def normalize_symbol(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip().upper()
    return normalized or None


def clean_text(value: Any, *, max_len: int | None = None) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    if not text:
        return None
    if max_len is not None and len(text) > max_len:
        return text[: max_len - 1].rstrip() + "..."
    return text


def safe_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def safe_int(value: Any) -> int | None:
    parsed = safe_float(value)
    if parsed is None:
        return None
    return int(parsed)


def parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError:
        return None


def is_fresh(value: Any, *, stale_hours: int, now: datetime | None = None) -> bool:
    parsed = parse_timestamp(value)
    if parsed is None:
        return False
    return ((now or datetime.now(timezone.utc)) - parsed).total_seconds() < stale_hours * 3600


def target_from_row(row: Mapping[str, Any]) -> TridentInsightTarget | None:
    instrument_key = clean_text(row.get("instrument_key"))
    ticker = normalize_symbol(row.get("ticker"))
    if not instrument_key or not ticker:
        return None
    return TridentInsightTarget(
        instrument_key=instrument_key,
        ticker=ticker,
        provider_symbol=normalize_symbol(row.get("provider_symbol")),
        name=clean_text(row.get("name"), max_len=240),
        currency=normalize_symbol(row.get("currency")),
        score=safe_float(row.get("score")),
    )


def fetch_top_targets(supabase: Any, top_n: int) -> list[TridentInsightTarget]:
    response = (
        supabase
        .table("trident_screener_latest")
        .select(TRIDENT_SELECTOR)
        .order("score", desc=True, nullsfirst=False)
        .limit(top_n)
        .execute()
    )
    return [
        target
        for row in (response.data or [])
        if (target := target_from_row(row)) is not None
    ]


def fetch_target_by_instrument_key(supabase: Any, instrument_key: str) -> list[TridentInsightTarget]:
    response = (
        supabase
        .table("trident_screener_latest")
        .select(TRIDENT_SELECTOR)
        .eq("instrument_key", instrument_key)
        .limit(1)
        .execute()
    )
    return [
        target
        for row in (response.data or [])
        if (target := target_from_row(row)) is not None
    ]


def fetch_target_by_ticker(supabase: Any, ticker: str) -> list[TridentInsightTarget]:
    normalized = normalize_symbol(ticker)
    if not normalized:
        return []

    response = (
        supabase
        .table("trident_screener_latest")
        .select(TRIDENT_SELECTOR)
        .eq("ticker", normalized)
        .limit(10)
        .execute()
    )
    rows = list(response.data or [])
    if not rows:
        response = (
            supabase
            .table("trident_screener_latest")
            .select(TRIDENT_SELECTOR)
            .eq("provider_symbol", normalized)
            .limit(10)
            .execute()
        )
        rows = list(response.data or [])

    return [
        target
        for row in rows
        if (target := target_from_row(row)) is not None
    ]


def fetch_targets_by_symbols(supabase: Any, symbols: list[str]) -> list[TridentInsightTarget]:
    normalized_symbols = [symbol for symbol in (normalize_symbol(value) for value in symbols) if symbol]
    if not normalized_symbols:
        return []

    rows_by_key: dict[str, Mapping[str, Any]] = {}
    for column in ("ticker", "provider_symbol"):
        response = (
            supabase
            .table("trident_screener_latest")
            .select(TRIDENT_SELECTOR)
            .in_(column, normalized_symbols)
            .execute()
        )
        for row in response.data or []:
            key = clean_text(row.get("instrument_key"))
            if key:
                rows_by_key[key] = row

    targets = [
        target
        for row in rows_by_key.values()
        if (target := target_from_row(row)) is not None
    ]
    symbol_rank = {symbol: index for index, symbol in enumerate(normalized_symbols)}
    return sorted(
        targets,
        key=lambda target: (
            symbol_rank.get(normalize_symbol(target.lookup_symbol) or "", len(symbol_rank)),
            target.ticker,
        ),
    )


def fetch_existing_updates(supabase: Any, instrument_keys: list[str]) -> dict[str, str | None]:
    if not instrument_keys:
        return {}
    response = (
        supabase
        .table("trident_stock_insights")
        .select("instrument_key,updated_at")
        .in_("instrument_key", instrument_keys)
        .execute()
    )
    return {
        str(row.get("instrument_key")): row.get("updated_at")
        for row in (response.data or [])
        if row.get("instrument_key")
    }


def _yfinance_timeout_handler(_signum: int, _frame: Any) -> None:
    raise TimeoutError("yfinance profile request timed out")


def yfinance_profile_timeout_sec() -> float:
    raw_value = os.environ.get("YFINANCE_PROFILE_TIMEOUT_SEC", str(DEFAULT_PROFILE_TIMEOUT_SEC))
    try:
        return float(raw_value)
    except (TypeError, ValueError):
        return DEFAULT_PROFILE_TIMEOUT_SEC


def fetch_yfinance_info(symbol: str) -> tuple[dict[str, Any], str | None]:
    timeout_sec = yfinance_profile_timeout_sec()
    try:
        if timeout_sec > 0 and hasattr(signal, "SIGALRM"):
            previous_handler = signal.getsignal(signal.SIGALRM)
            try:
                signal.signal(signal.SIGALRM, _yfinance_timeout_handler)
                signal.setitimer(signal.ITIMER_REAL, timeout_sec)
                info = yf.Ticker(symbol).info
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, previous_handler)
        else:
            info = yf.Ticker(symbol).info
    except Exception as exc:
        return {}, str(exc)
    return dict(info or {}), None


def extract_profile_fields(info: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    payload = {
        "business_summary": clean_text(info.get("longBusinessSummary"), max_len=4000),
        "website": clean_text(info.get("website"), max_len=500),
        "market_cap": safe_float(info.get("marketCap")),
        "trailing_pe": safe_float(info.get("trailingPE")),
        "forward_pe": safe_float(info.get("forwardPE")),
        "recommendation_key": clean_text(info.get("recommendationKey"), max_len=80),
        "recommendation_mean": safe_float(info.get("recommendationMean")),
        "target_mean_price": safe_float(info.get("targetMeanPrice")),
        "target_high_price": safe_float(info.get("targetHighPrice")),
        "target_low_price": safe_float(info.get("targetLowPrice")),
        "number_of_analyst_opinions": safe_int(info.get("numberOfAnalystOpinions")),
    }
    states: list[str] = []
    if not payload["business_summary"] and not payload["website"]:
        states.append("PROFILE_UNAVAILABLE")
    if not any(
        payload[key] is not None
        for key in (
            "recommendation_key",
            "recommendation_mean",
            "target_mean_price",
            "number_of_analyst_opinions",
        )
    ):
        states.append("CONSENSUS_UNAVAILABLE")
    return payload, states


def fetch_price_rows_for_symbol(supabase: Any, symbol: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = (
            supabase
            .table("historical_prices")
            .select("date,adj_close,adj_close_local,local_currency,source,updated_at")
            .eq("ticker", symbol)
            .order("date", desc=False)
            .range(offset, offset + PRICE_ROW_PAGE_SIZE - 1)
            .execute()
        )
        batch = list(response.data or [])
        rows.extend(batch)
        if len(batch) < PRICE_ROW_PAGE_SIZE:
            break
        offset += PRICE_ROW_PAGE_SIZE
    return rows


def fetch_price_rows(supabase: Any, target: TridentInsightTarget) -> tuple[list[dict[str, Any]], str | None]:
    rows = fetch_price_rows_for_symbol(supabase, target.ticker)
    if rows:
        return rows, target.ticker
    if target.provider_symbol and target.provider_symbol != target.ticker:
        fallback = fetch_price_rows_for_symbol(supabase, target.provider_symbol)
        if fallback:
            return fallback, target.provider_symbol
    return [], None


def build_price_points(rows: list[dict[str, Any]]) -> tuple[list[tuple[date, float]], str | None]:
    local_points: list[tuple[date, float]] = []
    eur_points: list[tuple[date, float]] = []
    local_currency: str | None = None

    for row in rows:
        row_date = parse_date(row.get("date"))
        if row_date is None:
            continue
        local_price = safe_float(row.get("adj_close_local"))
        if local_price is not None and local_price > 0:
            local_points.append((row_date, local_price))
            local_currency = normalize_symbol(row.get("local_currency")) or local_currency
        eur_price = safe_float(row.get("adj_close"))
        if eur_price is not None and eur_price > 0:
            eur_points.append((row_date, eur_price))

    if len(local_points) >= MIN_REGRESSION_POINTS:
        return sorted(local_points), local_currency
    return sorted(eur_points), "EUR"


def average(values: list[float]) -> float:
    return sum(values) / len(values)


def pct_change(current: float, previous: float | None) -> float | None:
    if previous is None or previous <= 0:
        return None
    return ((current / previous) - 1) * 100


def anchor_price(points: list[tuple[date, float]], target_date: date) -> float | None:
    candidates = [price for point_date, price in points if point_date <= target_date]
    if candidates:
        return candidates[-1]
    return points[0][1] if points else None


def compute_regression(points: list[tuple[date, float]]) -> tuple[float | None, float | None]:
    if len(points) < MIN_REGRESSION_POINTS:
        return None, None

    first_date = points[0][0]
    xs = [(point_date - first_date).days for point_date, _price in points]
    ys = [math.log(price) for _point_date, price in points]
    x_mean = average([float(value) for value in xs])
    y_mean = average(ys)
    denominator = sum((x - x_mean) ** 2 for x in xs)
    if denominator <= 0:
        return None, None
    slope = sum((x - x_mean) * (ys[index] - y_mean) for index, x in enumerate(xs)) / denominator
    intercept = y_mean - slope * x_mean
    predicted = [intercept + slope * x for x in xs]
    residuals = [ys[index] - predicted[index] for index in range(len(ys))]
    sigma = math.sqrt(sum(residual ** 2 for residual in residuals) / max(len(points) - 2, 1))
    latest_z = residuals[-1] / sigma if sigma > 0 else None
    slope_pct = (math.exp(slope * 365.25) - 1) * 100
    return (
        slope_pct if math.isfinite(slope_pct) else None,
        latest_z if latest_z is not None and math.isfinite(latest_z) else None,
    )


def compute_trend_facts(
    rows: list[dict[str, Any]],
    *,
    fallback_currency: str | None = None,
    now: date | None = None,
) -> tuple[dict[str, Any], list[str]]:
    points, price_currency = build_price_points(rows)
    states: list[str] = []
    today = now or datetime.now(timezone.utc).date()

    if not points:
        return {
            "latest_price": None,
            "price_currency": fallback_currency,
            "regression_slope_pct": None,
            "regression_z_score": None,
            "ma200_state": "UNAVAILABLE",
            "momentum_3m_pct": None,
            "momentum_12m_pct": None,
            "trend_state": "UNKNOWN",
            "trend_reason_codes": ["no_price_history"],
            "price_history_state": "NO_PRICE_HISTORY",
        }, ["NO_PRICE_HISTORY"]

    latest_date, latest_price = points[-1]
    stale = (today - latest_date).days > 7
    if stale:
        states.append("STALE")

    history_state = "OK"
    if len(points) < MIN_REGRESSION_POINTS:
        history_state = "SHORT_HISTORY"
        states.append("SHORT_HISTORY")
    elif stale:
        history_state = "STALE"

    regression_slope_pct, regression_z_score = compute_regression(points)
    ma200_value = average([price for _point_date, price in points[-MA200_WINDOW:]]) if len(points) >= MA200_WINDOW else None
    ma200_state = "UNAVAILABLE"
    if ma200_value is not None:
        ma200_state = "ABOVE" if latest_price >= ma200_value else "BELOW"

    momentum_3m_pct = pct_change(latest_price, anchor_price(points, latest_date - timedelta(days=91)))
    momentum_12m_pct = pct_change(latest_price, anchor_price(points, latest_date - timedelta(days=365)))

    reason_codes: list[str] = []
    if regression_slope_pct is not None:
        reason_codes.append("positive_regression" if regression_slope_pct >= 0 else "negative_regression")
    if ma200_state != "UNAVAILABLE":
        reason_codes.append("above_ma200" if ma200_state == "ABOVE" else "below_ma200")
    if momentum_3m_pct is not None:
        reason_codes.append("positive_3m_momentum" if momentum_3m_pct >= 0 else "negative_3m_momentum")
    if stale:
        reason_codes.append("stale_price")

    if history_state == "SHORT_HISTORY" or regression_slope_pct is None:
        trend_state = "UNKNOWN"
    elif regression_slope_pct > 0 and ma200_state == "ABOVE":
        trend_state = "BULLISH"
    elif regression_slope_pct < 0 and ma200_state == "BELOW":
        trend_state = "BEARISH"
    else:
        trend_state = "NEUTRAL"

    return {
        "latest_price": latest_price,
        "price_currency": price_currency or fallback_currency,
        "regression_slope_pct": regression_slope_pct,
        "regression_z_score": regression_z_score,
        "ma200_state": ma200_state,
        "momentum_3m_pct": momentum_3m_pct,
        "momentum_12m_pct": momentum_12m_pct,
        "trend_state": trend_state,
        "trend_reason_codes": reason_codes,
        "price_history_state": history_state,
    }, states


def fetch_news_items(supabase: Any, target: TridentInsightTarget) -> tuple[list[dict[str, Any]], list[str]]:
    symbols = [target.ticker]
    if target.provider_symbol and target.provider_symbol != target.ticker:
        symbols.append(target.provider_symbol)

    for days in (14, 30):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        response = (
            supabase
            .table("news_feed")
            .select("title,url,source,published_at,impact_level,impact_score,ticker")
            .in_("ticker", symbols)
            .gte("published_at", cutoff)
            .order("published_at", desc=True)
            .limit(NEWS_LIMIT)
            .execute()
        )
        items = [normalize_news_item(row) for row in (response.data or [])]
        items = [item for item in items if item is not None]
        if items:
            return items, []

    return [], ["NEWS_UNAVAILABLE"]


def normalize_news_item(row: Mapping[str, Any]) -> dict[str, Any] | None:
    title = clean_text(row.get("title"), max_len=240)
    url = clean_text(row.get("url"), max_len=1000)
    if not title or not url:
        return None
    return {
        "title": title,
        "url": url,
        "source": clean_text(row.get("source"), max_len=120),
        "published_at": clean_text(row.get("published_at"), max_len=80),
        "impact_level": clean_text(row.get("impact_level"), max_len=40),
        "impact_score": safe_float(row.get("impact_score")),
        "ticker": normalize_symbol(row.get("ticker")),
    }


def response_text(payload: Mapping[str, Any]) -> str | None:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    for output_item in payload.get("output", []) if isinstance(payload.get("output"), list) else []:
        if not isinstance(output_item, Mapping):
            continue
        for content in output_item.get("content", []) if isinstance(output_item.get("content"), list) else []:
            if not isinstance(content, Mapping):
                continue
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()
    return None


def generate_ai_summary(
    target: TridentInsightTarget,
    profile: Mapping[str, Any],
    trend: Mapping[str, Any],
    news_items: list[dict[str, Any]],
    *,
    enabled: bool,
) -> tuple[str | None, str, str | None]:
    if not enabled:
        return None, "AI_SUMMARY_UNAVAILABLE", None

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None, "AI_SUMMARY_UNAVAILABLE", None

    model = os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")
    bounded_input = {
        "company": {
            "ticker": target.ticker,
            "provider_symbol": target.provider_symbol,
            "name": target.name,
            "business_summary": profile.get("business_summary"),
        },
        "consensus": {
            "recommendation_key": profile.get("recommendation_key"),
            "recommendation_mean": profile.get("recommendation_mean"),
            "target_mean_price": profile.get("target_mean_price"),
            "target_high_price": profile.get("target_high_price"),
            "target_low_price": profile.get("target_low_price"),
            "number_of_analyst_opinions": profile.get("number_of_analyst_opinions"),
        },
        "trend": trend,
        "news": news_items,
    }
    request_payload = {
        "model": model,
        "instructions": (
            "Tu rediges une synthese courte en francais pour un cockpit de portefeuille. "
            "Utilise uniquement les faits fournis. N'invente pas de causalite, de chiffres, "
            "ni de recommandation d'achat/vente. Si les donnees sont insuffisantes, dis-le."
        ),
        "input": (
            "Explique en 3 phrases maximum ce que fait l'entreprise, la tendance boursiere "
            "actuelle et les facteurs plausibles cites par les news/consensus. Donnees JSON: "
            f"{json.dumps(bounded_input, ensure_ascii=False, sort_keys=True)}"
        ),
        "max_output_tokens": 360,
    }

    try:
        response = requests.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=request_payload,
            timeout=45,
        )
        response.raise_for_status()
        text = clean_text(response_text(response.json()), max_len=1200)
        if text:
            return text, "READY", model
        return None, "AI_SUMMARY_FAILED", model
    except Exception as exc:
        print(f"AI summary unavailable for {target.ticker}: {exc}", flush=True)
        return None, "AI_SUMMARY_FAILED", model


def yahoo_url(symbol: str) -> str:
    return f"https://finance.yahoo.com/quote/{symbol}"


def build_insight_payload(
    supabase: Any,
    target: TridentInsightTarget,
    *,
    ai_enabled: bool,
) -> dict[str, Any]:
    info, info_error = fetch_yfinance_info(target.lookup_symbol)
    profile, data_states = extract_profile_fields(info)
    if info_error and "PROFILE_UNAVAILABLE" not in data_states:
        data_states.append("PROFILE_UNAVAILABLE")

    price_rows, source_ticker = fetch_price_rows(supabase, target)
    trend, trend_states = compute_trend_facts(price_rows, fallback_currency=target.currency)
    news_items, news_states = fetch_news_items(supabase, target)

    ai_summary, ai_summary_state, ai_model = generate_ai_summary(
        target,
        profile,
        trend,
        news_items,
        enabled=ai_enabled,
    )
    if ai_summary_state != "READY":
        data_states.append(ai_summary_state)

    all_states = sorted(set(data_states + trend_states + news_states))
    source_symbol = source_ticker or target.lookup_symbol
    return {
        "instrument_key": target.instrument_key,
        "ticker": target.ticker,
        "provider_symbol": target.provider_symbol,
        "name": target.name,
        **profile,
        **trend,
        "news_items": news_items,
        "ai_trend_summary": ai_summary,
        "ai_summary_state": ai_summary_state,
        "ai_model": ai_model,
        "source_provider": "yfinance",
        "source_url": yahoo_url(source_symbol),
        "data_state": all_states,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def upsert_rows(supabase: Any, rows: list[dict[str, Any]], *, dry_run: bool) -> int:
    if dry_run or not rows:
        return 0
    response = (
        supabase
        .table("trident_stock_insights")
        .upsert(rows, on_conflict="instrument_key")
        .execute()
    )
    return len(response.data or rows)


def run_sync(
    supabase: Any,
    targets: list[TridentInsightTarget],
    *,
    stale_hours: int,
    force: bool = False,
    dry_run: bool = False,
    ai_enabled: bool = True,
    batch_size: int = DEFAULT_UPSERT_BATCH_SIZE,
) -> dict[str, Any]:
    existing = {} if force else fetch_existing_updates(supabase, [target.instrument_key for target in targets])
    stats: dict[str, Any] = {
        "targets": len(targets),
        "processed": 0,
        "skipped_fresh": 0,
        "upserted": 0,
        "failed": 0,
        "ai_ready": 0,
        "states": {},
        "dry_run": dry_run,
        "batch_size": batch_size,
    }
    pending_payloads: list[dict[str, Any]] = []
    sample_payloads: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    def flush_pending() -> None:
        if not pending_payloads:
            return
        stats["upserted"] += upsert_rows(supabase, pending_payloads, dry_run=dry_run)
        pending_payloads.clear()

    for target in targets:
        if not force and is_fresh(existing.get(target.instrument_key), stale_hours=stale_hours):
            stats["skipped_fresh"] += 1
            continue
        try:
            payload = build_insight_payload(supabase, target, ai_enabled=ai_enabled)
            stats["processed"] += 1
            if dry_run and len(sample_payloads) < 5:
                sample_payloads.append(payload)
            if not dry_run:
                pending_payloads.append(payload)
                if len(pending_payloads) >= batch_size:
                    flush_pending()
            if payload.get("ai_summary_state") == "READY":
                stats["ai_ready"] += 1
            for state in payload.get("data_state") or ["READY"]:
                states = stats["states"]
                states[state] = states.get(state, 0) + 1
        except Exception as exc:
            stats["failed"] += 1
            errors.append({"ticker": target.ticker, "error": str(exc)})
            print(f"Failed insight sync for {target.ticker}: {exc}", flush=True)

    flush_pending()
    if errors:
        stats["errors"] = errors[:25]
    if dry_run:
        stats["sample_payloads"] = sample_payloads
    return stats


def resolve_targets(args: argparse.Namespace, supabase: Any) -> list[TridentInsightTarget]:
    if args.instrument_key:
        return fetch_target_by_instrument_key(supabase, args.instrument_key)
    if args.ticker:
        return fetch_target_by_ticker(supabase, args.ticker)
    if args.curated_it_services:
        return fetch_targets_by_symbols(supabase, list(CURATED_IT_SERVICES_SYMBOLS))
    return fetch_top_targets(supabase, args.top_n)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync backend-generated Trident stock insights.")
    parser.add_argument("--top-n", type=int, default=DEFAULT_TOP_N)
    parser.add_argument("--ticker", default=None)
    parser.add_argument("--instrument-key", default=None)
    parser.add_argument("--curated-it-services", action="store_true")
    parser.add_argument("--stale-hours", type=int, default=DEFAULT_STALE_HOURS)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-ai", action="store_true")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_UPSERT_BATCH_SIZE)
    parser.add_argument("--output", default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.top_n <= 0:
        raise RuntimeError("--top-n must be greater than zero")
    if args.stale_hours <= 0:
        raise RuntimeError("--stale-hours must be greater than zero")
    if args.batch_size <= 0:
        raise RuntimeError("--batch-size must be greater than zero")

    supabase = get_supabase_client()
    targets = resolve_targets(args, supabase)
    if not targets:
        raise RuntimeError("No Trident insight targets found")

    started = time.time()
    run_id = start_etl_run(supabase, JOB_NAME)
    try:
        stats = run_sync(
            supabase,
            targets,
            stale_hours=args.stale_hours,
            force=args.force,
            dry_run=args.dry_run,
            ai_enabled=not args.no_ai,
            batch_size=args.batch_size,
        )
        status = "SUCCESS" if stats.get("failed", 0) == 0 else "FAILED"
        normalized_stats = build_etl_stats(
            JOB_NAME,
            stats,
            items_total=stats.get("targets"),
            items_success=stats.get("processed"),
            items_failed=stats.get("failed"),
        )
        finish_etl_run(
            supabase,
            run_id,
            status,
            time.time() - started,
            stats=normalized_stats,
            error=None if status == "SUCCESS" else json.dumps(stats.get("errors", [])),
        )
    except Exception as exc:
        finish_etl_run(supabase, run_id, "FAILED", time.time() - started, error=str(exc))
        raise

    report = {
        "ok": status == "SUCCESS",
        "status": status,
        "job_name": JOB_NAME,
        "target_count": len(targets),
        "stats": normalized_stats,
    }
    text = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text + "\n", encoding="utf-8")
    print(text, flush=True)
    if status != "SUCCESS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
