import argparse
import os
import time
from datetime import datetime, date, timedelta

import pandas as pd
import yfinance as yf
from supabase import create_client

from backtest.presets import get_preset_tickers

DEFAULT_START_DATE = "1999-01-01"


def get_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} manquant")
    return value


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def normalize_index(series: pd.Series) -> pd.Series:
    series = series.copy()
    series.index = pd.to_datetime(series.index).tz_localize(None)
    return series.sort_index()


def download_adj_close(ticker: str, start: date, end: date) -> pd.Series | None:
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


def upsert_rows(supabase, table: str, rows: list[dict], chunk_size: int = 1000) -> int:
    total = 0
    for i in range(0, len(rows), chunk_size):
        batch = rows[i:i + chunk_size]
        if not batch:
            continue
        supabase.table(table).upsert(batch, on_conflict="ticker,date").execute()
        total += len(batch)
    return total


def fetch_tickers(supabase) -> set[str]:
    tickers: set[str] = set()

    try:
        response = supabase.table("portfolio_positions").select("ticker").execute()
        for row in response.data or []:
            ticker = row.get("ticker")
            if ticker:
                tickers.add(str(ticker).upper())
    except Exception as exc:
        print(f"⚠️ portfolio_positions indisponible: {exc}", flush=True)

    try:
        response = supabase.table("governance_targets").select("ticker").execute()
        for row in response.data or []:
            ticker = row.get("ticker")
            if ticker:
                tickers.add(str(ticker).upper())
    except Exception as exc:
        print(f"⚠️ governance_targets indisponible: {exc}", flush=True)

    preset_tickers = get_preset_tickers(include_proxies=False)
    for ticker in preset_tickers:
        tickers.add(str(ticker).upper())

    return tickers


def sync_prices(
    supabase,
    tickers: list[str],
    start: date,
    end: date,
    dry_run: bool = False,
) -> dict:
    print(f"--- HISTORICAL PRICES {start} -> {end} ---", flush=True)
    stats = {"tickers": len(tickers), "rows_upserted": 0, "tickers_ok": 0, "tickers_failed": 0}

    currency_map = fetch_currency_map(supabase, tickers)
    now_iso = datetime.utcnow().isoformat()

    for ticker in tickers:
        print(f"→ {ticker}", flush=True)
        series = download_adj_close(ticker, start, end)
        if series is None or series.empty:
            print(f"    ❌ Pas de données {ticker}", flush=True)
            stats["tickers_failed"] += 1
            continue

        currency = currency_map.get(ticker)
        if not currency:
            currency = fetch_currency_from_yfinance(ticker)
        if not currency:
            currency = "USD"
            print(f"    ⚠️ Devise inconnue, fallback USD", flush=True)

        payloads = [
            {
                "ticker": ticker,
                "date": idx.date().isoformat(),
                "adj_close": float(value),
                "currency": currency,
                "source": "yfinance",
                "updated_at": now_iso,
            }
            for idx, value in series.items()
        ]

        if dry_run:
            print(f"    ℹ️ Dry-run: {len(payloads)} lignes prêtes", flush=True)
        else:
            stats["rows_upserted"] += upsert_rows(supabase, "historical_prices", payloads)
        stats["tickers_ok"] += 1
        print(f"    ✅ {len(payloads)} lignes", flush=True)

    return stats


def main():
    parser = argparse.ArgumentParser(description="Sync historical prices (yfinance)")
    parser.add_argument("--start-date", default=DEFAULT_START_DATE)
    parser.add_argument("--end-date", default=None)
    parser.add_argument("--tickers", default=None, help="Comma-separated tickers override")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    end_date = args.end_date or datetime.utcnow().date().isoformat()
    start = parse_date(args.start_date)
    end = parse_date(end_date)

    supabase_url = get_env("SUPABASE_URL")
    supabase_key = get_env("SUPABASE_KEY")
    supabase = create_client(supabase_url, supabase_key)

    if args.tickers:
        tickers = {t.strip().upper() for t in args.tickers.split(",") if t.strip()}
    else:
        tickers = fetch_tickers(supabase)

    if not tickers:
        print("⚠️ Aucun ticker détecté, arrêt.", flush=True)
        return

    started = time.time()
    stats = sync_prices(supabase, sorted(tickers), start, end, dry_run=args.dry_run)
    duration = time.time() - started
    print(f"--- FINISHED {stats} in {duration:.1f}s ---", flush=True)


if __name__ == "__main__":
    main()
