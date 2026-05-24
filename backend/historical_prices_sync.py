import argparse
import os
import time
from datetime import datetime, date, timedelta

import numpy as np
import pandas as pd
import yfinance as yf
from supabase import create_client

from backtest.presets import get_preset_tickers, get_proxy_map
from etl_stats import build_etl_stats

BASE_CURRENCY = "EUR"
DEFAULT_START_DATE = "1999-01-01"


def get_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} manquant")
    return value


def get_supabase_client():
    supabase_url = get_env("SUPABASE_URL")
    supabase_key = get_env("SUPABASE_KEY")
    return create_client(supabase_url, supabase_key)


def start_etl_run(supabase, job_name: str) -> str | None:
    try:
        response = (
            supabase
            .table("etl_runs")
            .insert({
                "job_name": job_name,
                "status": "RUNNING",
                "started_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
            })
            .execute()
        )
        if response.data and len(response.data) > 0:
            return response.data[0].get("id")
    except Exception as exc:
        print(f"⚠️ Impossible de démarrer etl_runs: {exc}", flush=True)
    return None


def finish_etl_run(
    supabase,
    run_id: str | None,
    status: str,
    duration_sec: float,
    stats: dict | None = None,
    error: str | None = None,
) -> None:
    if not run_id:
        return
    try:
        payload = {
            "status": status,
            "finished_at": datetime.now().isoformat(),
            "duration_sec": round(duration_sec, 2),
            "updated_at": datetime.now().isoformat(),
        }
        if stats is not None:
            payload["stats"] = stats
        if error:
            payload["error"] = error
        supabase.table("etl_runs").update(payload).eq("id", run_id).execute()
    except Exception as exc:
        print(f"⚠️ Impossible de clôturer etl_runs: {exc}", flush=True)


def safe_float(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (float, int, np.floating, np.integer)):
        if isinstance(value, float) and np.isnan(value):
            return None
        return float(value)
    try:
        return float(value)
    except Exception:
        return None


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def normalize_index(series: pd.Series) -> pd.Series:
    series = series.copy()
    series.index = pd.to_datetime(series.index).tz_localize(None)
    return series.sort_index()


def download_price_series(ticker: str, start: date, end: date) -> pd.Series | None:
    try:
        end_inclusive = end + timedelta(days=1)
        data = yf.download(
            ticker,
            start=start.isoformat(),
            end=end_inclusive.isoformat(),
            progress=False,
            auto_adjust=False,
        )
        if data is None or data.empty:
            return None
        if isinstance(data.columns, pd.MultiIndex):
            data.columns = data.columns.get_level_values(0)
        if "Adj Close" in data.columns:
            series = data["Adj Close"]
        elif "Close" in data.columns:
            series = data["Close"]
        else:
            return None
        series = series.dropna()
        if series.empty:
            return None
        return normalize_index(series)
    except Exception as exc:
        print(f"    ❌ Erreur download {ticker}: {exc}", flush=True)
        return None


def fetch_currency_map(supabase, tickers: list[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}

    def apply_rows(rows):
        for row in rows or []:
            ticker = row.get("ticker")
            currency = row.get("currency")
            if not ticker or not currency:
                continue
            mapping[str(ticker).upper()] = str(currency).upper()

    try:
        response = (
            supabase
            .table("portfolio_positions")
            .select("ticker,currency")
            .in_("ticker", tickers)
            .execute()
        )
        apply_rows(response.data)
    except Exception as exc:
        print(f"⚠️ Currency map portfolio_positions: {exc}", flush=True)

    try:
        response = (
            supabase
            .table("market_watch")
            .select("ticker,currency")
            .in_("ticker", tickers)
            .execute()
        )
        apply_rows(response.data)
    except Exception as exc:
        print(f"⚠️ Currency map market_watch: {exc}", flush=True)

    return mapping


def fetch_currency_from_yfinance(ticker: str) -> str | None:
    try:
        info = yf.Ticker(ticker).info
        currency = info.get("currency")
        if currency:
            return str(currency).upper()
    except Exception as exc:
        print(f"    ⚠️ Devise yfinance indisponible {ticker}: {exc}", flush=True)
    return None


def get_rate_from_currencies_table(supabase, currency: str) -> float | None:
    try:
        response = (
            supabase
            .table("currencies")
            .select("rate_to_eur")
            .eq("id", currency)
            .limit(1)
            .execute()
        )
        if response.data and len(response.data) > 0:
            return safe_float(response.data[0].get("rate_to_eur"))
    except Exception as exc:
        print(f"    ⚠️ FX table currencies indisponible ({currency}): {exc}", flush=True)
    return None


def get_fx_series(
    supabase,
    currency: str,
    start: date,
    end: date,
    fx_cache: dict[str, pd.Series],
) -> pd.Series | None:
    if currency == BASE_CURRENCY:
        return None
    if currency in fx_cache:
        return fx_cache[currency]

    direct_ticker = f"{currency}{BASE_CURRENCY}=X"
    inverse_ticker = f"{BASE_CURRENCY}{currency}=X"

    series = download_price_series(direct_ticker, start, end)
    if series is not None and not series.empty:
        fx_cache[currency] = series
        return series

    series = download_price_series(inverse_ticker, start, end)
    if series is not None and not series.empty:
        inverted = 1 / series.replace(0, np.nan)
        inverted = inverted.replace([np.inf, -np.inf], np.nan).dropna()
        fx_cache[currency] = inverted
        return inverted

    fallback_rate = get_rate_from_currencies_table(supabase, currency)
    if fallback_rate is not None:
        dates = pd.bdate_range(start=start, end=end)
        fallback_series = pd.Series(fallback_rate, index=dates)
        fx_cache[currency] = fallback_series
        print(
            f"    ⚠️ FX historique indisponible pour {currency}, "
            f"fallback taux spot {fallback_rate}",
            flush=True,
        )
        return fallback_series

    print(f"    ❌ FX introuvable pour {currency}", flush=True)
    return None


def convert_prices_to_eur(
    supabase,
    prices: pd.Series,
    currency: str,
    start: date,
    end: date,
    fx_cache: dict[str, pd.Series],
) -> pd.Series | None:
    if currency == BASE_CURRENCY:
        return prices
    fx_series = get_fx_series(supabase, currency, start, end, fx_cache)
    if fx_series is None or fx_series.empty:
        return None
    fx_aligned = fx_series.reindex(prices.index, method="ffill")
    fx_aligned = fx_aligned.bfill()
    fx_aligned = fx_aligned.replace([np.inf, -np.inf], np.nan)
    fx_aligned = fx_aligned.dropna()
    if fx_aligned.empty:
        return None
    aligned_prices = prices.loc[fx_aligned.index]
    return aligned_prices * fx_aligned


def build_price_payloads(
    ticker: str,
    prices_eur: pd.Series,
    sources: pd.Series,
    local_prices: pd.Series | None = None,
    local_currency: str | None = None,
) -> list[dict]:
    now_iso = datetime.utcnow().isoformat()
    sources = sources.reindex(prices_eur.index, method="ffill")
    aligned_local = None
    if local_prices is not None and not local_prices.empty:
        aligned_local = local_prices.reindex(prices_eur.index)

    payloads = []
    for idx, value in prices_eur.items():
        eur_value = safe_float(value)
        source = str(sources.loc[idx])
        local_value = None
        fx_rate = None

        if aligned_local is not None and not source.startswith("proxy:"):
            local_value = safe_float(aligned_local.loc[idx])
            if eur_value is not None and local_value not in (None, 0):
                fx_rate = eur_value / local_value

        payloads.append({
            "ticker": ticker,
            "date": idx.date().isoformat(),
            "adj_close": eur_value,
            "currency": BASE_CURRENCY,
            "source": source,
            "adj_close_local": local_value,
            "local_currency": local_currency if local_value is not None else None,
            "fx_rate_to_eur": safe_float(fx_rate),
            "updated_at": now_iso,
        })
    return payloads


def upsert_rows(supabase, table: str, rows: list[dict], chunk_size: int = 1000) -> int:
    total = 0
    for i in range(0, len(rows), chunk_size):
        batch = rows[i:i + chunk_size]
        if not batch:
            continue
        supabase.table(table).upsert(batch, on_conflict="ticker,date").execute()
        total += len(batch)
    return total


def upsert_coverage(
    supabase,
    ticker: str,
    start: date,
    end: date,
    earliest: date | None,
    coverage_pct: float | None,
    used_proxy: bool,
) -> None:
    payload = {
        "ticker": ticker,
        "requested_start_date": start.isoformat(),
        "requested_end_date": end.isoformat(),
        "earliest_date": earliest.isoformat() if earliest else None,
        "coverage_pct": coverage_pct,
        "used_proxy": used_proxy,
        "updated_at": datetime.utcnow().isoformat(),
    }
    supabase.table("historical_price_coverage").upsert(payload).execute()


def compute_coverage(prices: pd.Series, start: date, end: date) -> float | None:
    if prices is None or prices.empty:
        return None
    expected = pd.bdate_range(start=start, end=end)
    if expected.empty:
        return None
    coverage = (len(prices.index) / len(expected)) * 100
    return float(min(100.0, max(0.0, coverage)))


def fetch_tickers(supabase) -> set[str]:
    tickers: set[str] = set()

    try:
        response = supabase.table("portfolio_positions").select("ticker").execute()
        for row in response.data or []:
            ticker = row.get("ticker")
            if ticker:
                tickers.add(str(ticker).upper())
    except Exception as exc:
        print(f"⚠️ Erreur portfolio_positions: {exc}", flush=True)

    try:
        response = supabase.table("governance_targets").select("ticker").execute()
        for row in response.data or []:
            ticker = row.get("ticker")
            if ticker:
                tickers.add(str(ticker).upper())
    except Exception as exc:
        print(f"⚠️ governance_targets ticker indisponible: {exc}", flush=True)

    preset_tickers = get_preset_tickers(include_proxies=True)
    for ticker in preset_tickers:
        tickers.add(str(ticker).upper())

    return tickers


def build_ticker_currency_map(
    supabase,
    tickers: list[str],
) -> dict[str, str]:
    mapping = fetch_currency_map(supabase, tickers)
    for ticker in tickers:
        if ticker in mapping:
            continue
        currency = fetch_currency_from_yfinance(ticker)
        if currency:
            mapping[ticker] = currency
    return mapping


def run_sync(
    supabase,
    start: date,
    end: date,
    tickers: list[str],
    dry_run: bool = False,
) -> dict:
    print(f"--- HISTORICAL PRICES {start} -> {end} ---", flush=True)
    fx_cache: dict[str, pd.Series] = {}
    proxy_map = get_proxy_map()
    stats = {
        "tickers": len(tickers),
        "rows_upserted": 0,
        "rows_with_local": 0,
        "rows_without_local": 0,
        "tickers_ok": 0,
        "tickers_failed": 0,
        "tickers_proxy": 0,
        "local_currencies": {},
    }

    currency_map = build_ticker_currency_map(supabase, tickers)

    for ticker in tickers:
        print(f"→ {ticker}", flush=True)
        currency = currency_map.get(ticker)
        if not currency:
            currency = BASE_CURRENCY
            print(f"    ⚠️ Devise inconnue, fallback {BASE_CURRENCY}", flush=True)

        series = download_price_series(ticker, start, end)
        if series is None or series.empty:
            print(f"    ❌ Pas d'historique {ticker}", flush=True)
            stats["tickers_failed"] += 1
            upsert_coverage(supabase, ticker, start, end, None, None, False)
            continue

        local_series = series.replace([np.inf, -np.inf], np.nan).dropna()

        converted = convert_prices_to_eur(
            supabase, series, currency, start, end, fx_cache
        )
        if converted is None or converted.empty:
            print(f"    ❌ Conversion FX échouée {ticker}", flush=True)
            stats["tickers_failed"] += 1
            upsert_coverage(supabase, ticker, start, end, None, None, False)
            continue

        earliest = converted.index.min().date()
        sources = pd.Series("yfinance", index=converted.index)
        used_proxy = False

        if earliest > start and ticker in proxy_map:
            proxy_ticker = proxy_map[ticker]
            print(f"    ⚠️ Proxy {proxy_ticker} pour couvrir {start} -> {earliest}", flush=True)
            proxy_series = download_price_series(proxy_ticker, start, end)
            if proxy_series is not None and not proxy_series.empty:
                proxy_currency = currency_map.get(proxy_ticker)
                if not proxy_currency:
                    proxy_currency = fetch_currency_from_yfinance(proxy_ticker) or BASE_CURRENCY
                    currency_map[proxy_ticker] = proxy_currency
                proxy_converted = convert_prices_to_eur(
                    supabase, proxy_series, proxy_currency, start, end, fx_cache
                )
                if proxy_converted is not None and not proxy_converted.empty:
                    proxy_cut = proxy_converted[proxy_converted.index.date < earliest]
                    if not proxy_cut.empty:
                        used_proxy = True
                        combined = pd.concat([proxy_cut, converted]).sort_index()
                        sources = pd.concat([
                            pd.Series(f"proxy:{proxy_ticker}", index=proxy_cut.index),
                            pd.Series("yfinance", index=converted.index),
                        ]).sort_index()
                        converted = combined
                        stats["tickers_proxy"] += 1
                else:
                    print(f"    ⚠️ Proxy conversion échouée {proxy_ticker}", flush=True)
            else:
                print(f"    ⚠️ Proxy sans données {proxy_ticker}", flush=True)

        converted = converted.replace([np.inf, -np.inf], np.nan).dropna()
        if converted.empty:
            print(f"    ❌ Série vide après nettoyage {ticker}", flush=True)
            stats["tickers_failed"] += 1
            upsert_coverage(supabase, ticker, start, end, None, None, used_proxy)
            continue

        payloads = build_price_payloads(
            ticker,
            converted,
            sources,
            local_prices=local_series,
            local_currency=currency,
        )
        coverage_pct = compute_coverage(converted, start, end)
        earliest_date = converted.index.min().date() if not converted.empty else None

        if dry_run:
            print(f"    ℹ️ Dry-run: {len(payloads)} lignes prêtes", flush=True)
        else:
            stats["rows_upserted"] += upsert_rows(
                supabase, "historical_prices", payloads
            )
            upsert_coverage(
                supabase,
                ticker,
                start,
                end,
                earliest_date,
                coverage_pct,
                used_proxy,
            )
        local_rows = sum(1 for row in payloads if row.get("adj_close_local") is not None)
        stats["rows_with_local"] += local_rows
        stats["rows_without_local"] += len(payloads) - local_rows
        if local_rows > 0:
            local_currencies = stats["local_currencies"]
            local_currencies[currency] = local_currencies.get(currency, 0) + local_rows
        stats["tickers_ok"] += 1
        if coverage_pct is None:
            print(f"    ✅ {len(payloads)} lignes", flush=True)
        else:
            print(
                f"    ✅ {len(payloads)} lignes ({coverage_pct:.1f}% coverage)",
                flush=True,
            )

    return stats


def main():
    parser = argparse.ArgumentParser(description="Historical prices ETL")
    parser.add_argument("--start-date", default=DEFAULT_START_DATE)
    parser.add_argument("--end-date", default=None)
    parser.add_argument("--tickers", default=None, help="Comma-separated tickers override")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    end_date = args.end_date or datetime.utcnow().date().isoformat()
    start = parse_date(args.start_date)
    end = parse_date(end_date)

    supabase = get_supabase_client()

    if args.tickers:
        tickers = {t.strip().upper() for t in args.tickers.split(",") if t.strip()}
    else:
        tickers = fetch_tickers(supabase)

    if not tickers:
        print("⚠️ Aucun ticker détecté, arrêt.", flush=True)
        return

    job_name = "historical_prices_sync"
    started = time.time()
    run_id = start_etl_run(supabase, job_name)
    try:
        stats = run_sync(
            supabase,
            start,
            end,
            sorted(tickers),
            dry_run=args.dry_run,
        )
        normalized_stats = build_etl_stats(
            job_name,
            stats,
            items_total=stats.get("tickers"),
            items_success=stats.get("tickers_ok"),
            items_failed=stats.get("tickers_failed"),
        )
        finish_etl_run(
            supabase,
            run_id,
            "SUCCESS",
            time.time() - started,
            stats=normalized_stats,
        )
        print(f"--- FINISHED: {normalized_stats} ---", flush=True)
    except Exception as exc:
        finish_etl_run(
            supabase,
            run_id,
            "FAILED",
            time.time() - started,
            error=str(exc),
        )
        raise


if __name__ == "__main__":
    main()
