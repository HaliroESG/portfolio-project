from datetime import date

import pandas as pd


def get_earliest_dates(supabase, tickers: list[str]) -> dict[str, date | None]:
    earliest: dict[str, date | None] = {ticker: None for ticker in tickers}
    for ticker in tickers:
        try:
            response = (
                supabase
                .table("historical_prices")
                .select("date")
                .eq("ticker", ticker)
                .order("date", desc=False)
                .limit(1)
                .execute()
            )
            if response.data and len(response.data) > 0:
                raw = response.data[0].get("date")
                if raw:
                    earliest[ticker] = pd.to_datetime(raw).date()
        except Exception as exc:
            print(f"⚠️ earliest_date échoué {ticker}: {exc}", flush=True)
            earliest[ticker] = None
    return earliest


def compute_common_start(
    earliest_dates: dict[str, date | None],
    requested_start: date,
    end_date: date,
    series_by_ticker: dict[str, pd.Series] | None = None,
) -> tuple[date, dict[str, float], float]:
    existing = [value for value in earliest_dates.values() if value]
    max_earliest = max(existing) if existing else requested_start
    effective_start = max(requested_start, max_earliest)

    coverage_per_ticker: dict[str, float] = {}
    business_days = pd.bdate_range(start=effective_start, end=end_date)
    expected = len(business_days)

    if expected == 0:
        return effective_start, {ticker: 0.0 for ticker in earliest_dates}, 0.0

    for ticker, earliest in earliest_dates.items():
        if not earliest:
            coverage_per_ticker[ticker] = 0.0
            continue
        if series_by_ticker is None or ticker not in series_by_ticker:
            coverage_per_ticker[ticker] = 0.0
            continue
        series = series_by_ticker[ticker]
        if series is None or series.empty:
            coverage_per_ticker[ticker] = 0.0
            continue
        aligned = series.reindex(business_days).ffill()
        covered = aligned.notna().sum()
        coverage_per_ticker[ticker] = float((covered / expected) * 100)

    coverage_global = min(coverage_per_ticker.values()) if coverage_per_ticker else 0.0
    return effective_start, coverage_per_ticker, coverage_global
