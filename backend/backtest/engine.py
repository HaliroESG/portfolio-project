from dataclasses import dataclass
from datetime import datetime, date
import hashlib
import json
from typing import Iterable

import numpy as np
import pandas as pd

from backtest.presets import build_preset_specs, select_preset_keys
from backtest.data_quality import compute_common_start, get_earliest_dates

BASE_CURRENCY = "EUR"
TRADING_DAYS = 252


@dataclass
class BacktestConfig:
    initial_cash: float
    recurring_cash: float
    recurring_frequency: str
    recurring_day: int
    rebalance_frequency: str
    fee_bps: float
    date_mode: str
    inflation_adjusted: bool


def _parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def parse_config(config_json: dict | None) -> BacktestConfig:
    config_json = config_json or {}
    return BacktestConfig(
        initial_cash=float(config_json.get("initial_cash", 10000)),
        recurring_cash=float(config_json.get("recurring_cash", 0)),
        recurring_frequency=str(config_json.get("recurring_frequency", "monthly")),
        recurring_day=int(config_json.get("recurring_day", 1)),
        rebalance_frequency=str(config_json.get("rebalance_frequency", "monthly")),
        fee_bps=float(config_json.get("fee_bps", 0)),
        date_mode=str(config_json.get("date_mode", "common_start")),
        inflation_adjusted=bool(config_json.get("inflation_adjusted", False)),
    )


def normalize_weights(weights_pct: dict[str, float]) -> dict[str, float]:
    cleaned = {k: float(v) for k, v in weights_pct.items() if v and v > 0}
    total = sum(cleaned.values())
    if total <= 0:
        return {}
    return {k: v / total for k, v in cleaned.items()}


def normalize_weights_pct(weights_pct: dict[str, float]) -> dict[str, float]:
    cleaned = {k: float(v) for k, v in weights_pct.items() if v and v > 0}
    total = sum(cleaned.values())
    if total <= 0:
        return {}
    return {k: (v / total) * 100 for k, v in cleaned.items()}


def compute_config_hash(payload: dict) -> str:
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def chunked(items: Iterable[str], size: int) -> Iterable[list[str]]:
    chunk = []
    for item in items:
        chunk.append(item)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def fetch_all_rows(query, page_size: int = 10000) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        response = query.range(offset, offset + page_size - 1).execute()
        batch = response.data or []
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def fetch_historical_prices(
    supabase,
    tickers: list[str],
    start: date,
    end: date,
) -> dict[str, pd.Series]:
    series_by_ticker: dict[str, pd.Series] = {}
    if not tickers:
        return series_by_ticker

    for chunk in chunked(tickers, 50):
        query = (
            supabase
            .table("historical_prices")
            .select("ticker,date,adj_close,source")
            .in_("ticker", chunk)
            .gte("date", start.isoformat())
            .lte("date", end.isoformat())
        )
        rows = fetch_all_rows(query)
        for row in rows:
            ticker = str(row.get("ticker") or "").upper()
            if not ticker:
                continue
            price = row.get("adj_close")
            if price is None:
                continue
            dt = pd.to_datetime(row.get("date"))
            if pd.isna(dt):
                continue
            series = series_by_ticker.setdefault(ticker, pd.Series(dtype="float64"))
            series.loc[dt] = float(price)

    for ticker, series in list(series_by_ticker.items()):
        if series.empty:
            series_by_ticker.pop(ticker, None)
            continue
        series = series.sort_index()
        series.index = pd.to_datetime(series.index).tz_localize(None)
        series_by_ticker[ticker] = series

    return series_by_ticker


def apply_proxy_series(
    ticker: str,
    series: pd.Series,
    proxy_series: pd.Series | None,
    start: date,
) -> tuple[pd.Series, bool]:
    if series is None or series.empty:
        return series, False
    earliest = series.index.min().date()
    if earliest <= start or proxy_series is None or proxy_series.empty:
        return series, False

    proxy_cut = proxy_series[proxy_series.index.date < earliest]
    if proxy_cut.empty:
        return series, False
    combined = pd.concat([proxy_cut, series]).sort_index()
    return combined, True


def build_price_frame(
    series_by_ticker: dict[str, pd.Series],
    tickers: list[str],
    start: date,
    end: date,
    date_mode: str,
) -> tuple[pd.DataFrame, date, dict[str, dict]]:
    if not tickers:
        raise ValueError("Aucun ticker pour le portfolio")

    index = pd.bdate_range(start=start, end=end)
    price_frame = pd.DataFrame(index=index)
    diagnostics: dict[str, dict] = {}

    for ticker in tickers:
        series = series_by_ticker.get(ticker)
        if series is None or series.empty:
            diagnostics[ticker] = {
                "earliest": None,
                "coverage_pct": 0.0,
                "used_proxy": False,
            }
            continue
        aligned = series.reindex(index)
        aligned = aligned.ffill()
        earliest = series.index.min().date()
        diagnostics[ticker] = {
            "earliest": earliest,
            "coverage_pct": None,
            "used_proxy": False,
        }
        price_frame[ticker] = aligned

    valid_start = start
    if date_mode == "common_start":
        earliest_dates = [
            diag["earliest"] for diag in diagnostics.values() if diag["earliest"]
        ]
        if earliest_dates:
            valid_start = max(earliest_dates)
    else:
        earliest_dates = [
            diag["earliest"] for diag in diagnostics.values() if diag["earliest"]
        ]
        if earliest_dates:
            valid_start = max(earliest_dates)

    price_frame = price_frame.loc[price_frame.index.date >= valid_start]
    price_frame = price_frame.ffill()

    expected_start = valid_start if date_mode == "common_start" else start
    expected = pd.bdate_range(start=expected_start, end=end)
    for ticker in tickers:
        series = price_frame[ticker] if ticker in price_frame.columns else None
        if series is None or series.empty:
            diagnostics[ticker]["coverage_pct"] = 0.0
            continue
        coverage = (series.notna().sum() / len(expected)) * 100 if len(expected) else 0
        diagnostics[ticker]["coverage_pct"] = float(min(100.0, max(0.0, coverage)))

    price_frame = price_frame.dropna(axis=0, how="any")
    return price_frame, valid_start, diagnostics


def get_contribution_dates(
    index: pd.DatetimeIndex,
    frequency: str,
    day: int,
) -> set[pd.Timestamp]:
    if frequency == "none":
        return set()
    dates: set[pd.Timestamp] = set()
    if frequency == "monthly":
        months = pd.period_range(index.min(), index.max(), freq="M")
        for month in months:
            month_dates = index[(index.month == month.month) & (index.year == month.year)]
            if month_dates.empty:
                continue
            target = month_dates[month_dates.day >= day]
            dates.add(target[0] if not target.empty else month_dates[0])
    return dates


def is_rebalance_date(
    current: pd.Timestamp,
    previous: pd.Timestamp | None,
    frequency: str,
) -> bool:
    if frequency == "none":
        return False
    if frequency == "daily":
        return True
    if previous is None:
        return True
    if frequency == "weekly":
        return current.isocalendar().week != previous.isocalendar().week
    if frequency == "monthly":
        return current.month != previous.month
    if frequency == "quarterly":
        return current.quarter != previous.quarter or current.year != previous.year
    if frequency == "semiannual":
        prev_half = 1 if previous.month <= 6 else 2
        curr_half = 1 if current.month <= 6 else 2
        return curr_half != prev_half or current.year != previous.year
    if frequency == "annual":
        return current.year != previous.year
    return False


def apply_fee(holdings: dict[str, float], fee_bps: float) -> None:
    if fee_bps <= 0:
        return
    daily_rate = (fee_bps / 10000.0) / TRADING_DAYS
    factor = max(0.0, 1.0 - daily_rate)
    for ticker in holdings:
        holdings[ticker] *= factor


def simulate_nav(
    prices: pd.DataFrame,
    weights_pct: dict[str, float],
    config: BacktestConfig,
) -> pd.DataFrame:
    weights = normalize_weights(weights_pct)
    if not weights:
        raise ValueError("Weights vides pour le portfolio")

    holdings = {ticker: 0.0 for ticker in weights.keys()}
    nav_values = []
    dates = prices.index
    contribution_dates = get_contribution_dates(
        dates,
        config.recurring_frequency,
        config.recurring_day,
    )

    previous_date = None
    for i, current_date in enumerate(dates):
        row = prices.loc[current_date]

        if i == 0 and config.initial_cash > 0:
            for ticker, weight in weights.items():
                holdings[ticker] += (config.initial_cash * weight) / row[ticker]

        if current_date in contribution_dates and config.recurring_cash > 0:
            for ticker, weight in weights.items():
                holdings[ticker] += (config.recurring_cash * weight) / row[ticker]

        if is_rebalance_date(current_date, previous_date, config.rebalance_frequency):
            total_value = sum(holdings[t] * row[t] for t in holdings)
            for ticker, weight in weights.items():
                holdings[ticker] = (total_value * weight) / row[ticker]

        apply_fee(holdings, config.fee_bps)

        nav = sum(holdings[t] * row[t] for t in holdings)
        nav_values.append(nav)
        previous_date = current_date

    nav_series = pd.Series(nav_values, index=dates)
    returns = nav_series.pct_change().fillna(0)
    drawdown = nav_series / nav_series.cummax() - 1
    return pd.DataFrame(
        {
            "nav": nav_series,
            "returns_daily": returns,
            "drawdown": drawdown,
        }
    )


def simulate_nav_with_holdings(
    prices: pd.DataFrame,
    weights_pct: dict[str, float],
    config: BacktestConfig,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    weights = normalize_weights(weights_pct)
    if not weights:
        raise ValueError("Weights vides pour le portfolio")

    holdings = {ticker: 0.0 for ticker in weights.keys()}
    nav_values = []
    holdings_rows = []
    dates = prices.index
    contribution_dates = get_contribution_dates(
        dates,
        config.recurring_frequency,
        config.recurring_day,
    )

    previous_date = None
    for i, current_date in enumerate(dates):
        row = prices.loc[current_date]

        if i == 0 and config.initial_cash > 0:
            for ticker, weight in weights.items():
                holdings[ticker] += (config.initial_cash * weight) / row[ticker]

        if current_date in contribution_dates and config.recurring_cash > 0:
            for ticker, weight in weights.items():
                holdings[ticker] += (config.recurring_cash * weight) / row[ticker]

        if is_rebalance_date(current_date, previous_date, config.rebalance_frequency):
            total_value = sum(holdings[t] * row[t] for t in holdings)
            for ticker, weight in weights.items():
                holdings[ticker] = (total_value * weight) / row[ticker]

        apply_fee(holdings, config.fee_bps)

        nav = sum(holdings[t] * row[t] for t in holdings)
        nav_values.append(nav)
        holdings_rows.append({ticker: holdings[ticker] for ticker in holdings})
        previous_date = current_date

    nav_series = pd.Series(nav_values, index=dates)
    returns = nav_series.pct_change().fillna(0)
    drawdown = nav_series / nav_series.cummax() - 1
    nav_df = pd.DataFrame(
        {
            "nav": nav_series,
            "returns_daily": returns,
            "drawdown": drawdown,
        }
    )
    holdings_df = pd.DataFrame(holdings_rows, index=dates)
    return nav_df, holdings_df


def compute_kpis(nav_df: pd.DataFrame) -> dict:
    nav = nav_df["nav"]
    returns = nav_df["returns_daily"]

    if len(nav) < 2:
        return {
            "cagr": None,
            "vol": None,
            "sharpe": None,
            "sortino": None,
            "max_drawdown": None,
            "calmar": None,
            "worst_year": None,
            "best_year": None,
        }

    days = (nav.index[-1].date() - nav.index[0].date()).days
    cagr = (nav.iloc[-1] / nav.iloc[0]) ** (365.0 / days) - 1 if days > 0 else None
    vol = returns.std() * np.sqrt(TRADING_DAYS)
    sharpe = (returns.mean() * TRADING_DAYS) / vol if vol and vol > 0 else None

    downside = returns[returns < 0]
    downside_dev = downside.std() * np.sqrt(TRADING_DAYS)
    sortino = (returns.mean() * TRADING_DAYS) / downside_dev if downside_dev and downside_dev > 0 else None

    drawdown = nav_df["drawdown"]
    max_dd = float(drawdown.min()) if not drawdown.empty else None
    calmar = (cagr / abs(max_dd)) if max_dd and max_dd < 0 and cagr is not None else None

    yearly_returns = []
    for year, series in nav.groupby(nav.index.year):
        if len(series) < 100:
            continue
        yearly_returns.append((year, series.iloc[-1] / series.iloc[0] - 1))

    worst_year = min((r for _, r in yearly_returns), default=None)
    best_year = max((r for _, r in yearly_returns), default=None)

    return {
        "cagr": float(cagr) if cagr is not None else None,
        "vol": float(vol) if vol is not None else None,
        "sharpe": float(sharpe) if sharpe is not None else None,
        "sortino": float(sortino) if sortino is not None else None,
        "max_drawdown": float(max_dd) if max_dd is not None else None,
        "calmar": float(calmar) if calmar is not None else None,
        "worst_year": float(worst_year) if worst_year is not None else None,
        "best_year": float(best_year) if best_year is not None else None,
    }


def fetch_default_portfolio_id(supabase) -> str | None:
    try:
        response = supabase.table("portfolios").select("id").limit(1).execute()
        if response.data and len(response.data) > 0:
            return response.data[0].get("id")
    except Exception as exc:
        print(f"⚠️ Impossible de récupérer portfolio_id: {exc}", flush=True)
    return None


def fetch_portfolio_positions(supabase, portfolio_id: str) -> list[dict]:
    try:
        response = (
            supabase
            .table("portfolio_positions")
            .select("*")
            .eq("portfolio_id", portfolio_id)
            .execute()
        )
        return response.data or []
    except Exception as exc:
        print(f"⚠️ portfolio_positions indisponible: {exc}", flush=True)
        return []


def fetch_governance_targets(supabase, portfolio_id: str) -> list[dict]:
    try:
        response = (
            supabase
            .table("governance_targets")
            .select("*")
            .eq("portfolio_id", portfolio_id)
            .execute()
        )
        return response.data or []
    except Exception as exc:
        print(f"⚠️ governance_targets indisponible: {exc}", flush=True)
        return []


def extract_target_weights(governance_rows: list[dict]) -> dict[str, float]:
    weights: dict[str, float] = {}
    for row in governance_rows:
        ticker = row.get("ticker") or row.get("symbol")
        if not ticker:
            continue
        weight = (
            row.get("target_weight_pct")
            or row.get("target_pct")
            or row.get("weight_pct")
        )
        if weight is None:
            continue
        try:
            weights[str(ticker).upper()] = float(weight)
        except Exception:
            continue
    return weights


def extract_target_weights_from_positions(positions: list[dict]) -> dict[str, float]:
    weights: dict[str, float] = {}
    for row in positions:
        ticker = row.get("ticker")
        if not ticker:
            continue
        weight = row.get("target_weight_pct")
        if weight is None:
            continue
        try:
            weights[str(ticker).upper()] = float(weight)
        except Exception:
            continue
    return weights


def extract_current_weights_from_positions(
    positions: list[dict],
    price_map: dict[str, float],
) -> dict[str, float]:
    values: dict[str, float] = {}
    for row in positions:
        ticker = row.get("ticker")
        if not ticker:
            continue
        price = price_map.get(str(ticker).upper())
        if not price:
            continue
        quantity = row.get("quantity_current") or row.get("quantity_buy")
        if quantity is None:
            continue
        try:
            values[str(ticker).upper()] = float(quantity) * float(price)
        except Exception:
            continue
    total = sum(values.values())
    if total <= 0:
        return {}
    return {ticker: (value / total) * 100 for ticker, value in values.items()}


def get_latest_prices(
    series_by_ticker: dict[str, pd.Series],
    end: date,
) -> dict[str, float]:
    price_map: dict[str, float] = {}
    cutoff = pd.Timestamp(end)
    for ticker, series in series_by_ticker.items():
        series = series[series.index <= cutoff]
        if series.empty:
            continue
        price_map[ticker] = float(series.iloc[-1])
    return price_map


def build_preset_specs() -> list[dict]:
    specs = []
    for key, payload in PRESET_PORTFOLIOS.items():
        specs.append({
            "portfolio_key": key,
            "portfolio_id": None,
            "preset_key": key,
            "label": payload["label"],
            "role": payload["role"],
            "weights": payload["weights"],
        })
    return specs


def upsert_rows(supabase, table: str, rows: list[dict], chunk_size: int = 1000) -> int:
    total = 0
    for i in range(0, len(rows), chunk_size):
        batch = rows[i:i + chunk_size]
        if not batch:
            continue
        supabase.table(table).upsert(batch).execute()
        total += len(batch)
    return total


def create_backtest_run(
    supabase,
    run_name: str,
    base_currency: str,
    start: date,
    end: date,
    config: BacktestConfig,
    raw_config: dict | None,
    config_hash: str,
    requested_start: date,
    requested_end: date,
    effective_start: date,
    effective_end: date,
    data_mode: str,
    diagnostics: dict,
) -> str:
    config_payload = dict(raw_config or {})
    config_payload.update({
        "initial_cash": config.initial_cash,
        "recurring_cash": config.recurring_cash,
        "recurring_frequency": config.recurring_frequency,
        "recurring_day": config.recurring_day,
        "rebalance_frequency": config.rebalance_frequency,
        "fee_bps": config.fee_bps,
        "date_mode": config.date_mode,
        "inflation_adjusted": config.inflation_adjusted,
        "config_hash": config_hash,
    })
    payload = {
        "name": run_name,
        "base_currency": base_currency,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "requested_start_date": requested_start.isoformat(),
        "requested_end_date": requested_end.isoformat(),
        "start_date_effective": effective_start.isoformat(),
        "end_date_effective": effective_end.isoformat(),
        "data_mode": data_mode,
        "diagnostics_json": diagnostics,
        "rebalance_freq": config.rebalance_frequency,
        "fee_bps": config.fee_bps,
        "inflation_adjusted": config.inflation_adjusted,
        "config_json": config_payload,
    }
    response = supabase.table("backtest_runs").insert(payload).execute()
    run_id = response.data[0]["id"]
    return run_id


def find_existing_run(
    supabase,
    config_hash: str,
    start: date,
    end: date,
    base_currency: str,
) -> str | None:
    try:
        response = (
            supabase
            .table("backtest_runs")
            .select("id,created_at")
            .eq("config_json->>config_hash", config_hash)
            .eq("start_date", start.isoformat())
            .eq("end_date", end.isoformat())
            .eq("base_currency", base_currency)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if response.data and len(response.data) > 0:
            return response.data[0].get("id")
    except Exception as exc:
        print(f"⚠️ Lookup run existant échoué: {exc}", flush=True)
    return None


def run_has_results(supabase, run_id: str) -> bool:
    try:
        response = (
            supabase
            .table("backtest_results")
            .select("run_id")
            .eq("run_id", run_id)
            .limit(1)
            .execute()
        )
        return bool(response.data)
    except Exception as exc:
        print(f"⚠️ Vérif résultats échouée: {exc}", flush=True)
        return False


def persist_portfolio(
    supabase,
    run_id: str,
    spec: dict,
    start_effective: date,
) -> None:
    payload = {
        "run_id": run_id,
        "portfolio_key": spec["portfolio_key"],
        "portfolio_id": spec.get("portfolio_id"),
        "preset_key": spec.get("preset_key"),
        "label": spec["label"],
        "role": spec["role"],
        "weights_json": spec["weights"],
        "start_date_effective": start_effective.isoformat(),
    }
    supabase.table("backtest_portfolios").upsert(payload).execute()


def persist_results(
    supabase,
    run_id: str,
    portfolio_key: str,
    nav_df: pd.DataFrame,
) -> None:
    rows = []
    for idx, row in nav_df.iterrows():
        rows.append({
            "run_id": run_id,
            "portfolio_key": portfolio_key,
            "date": idx.date().isoformat(),
            "nav": float(row["nav"]),
            "drawdown": float(row["drawdown"]),
            "returns_daily": float(row["returns_daily"]),
        })
    upsert_rows(supabase, "backtest_results", rows)


def persist_kpis(
    supabase,
    run_id: str,
    portfolio_key: str,
    kpis: dict,
) -> None:
    payload = {"run_id": run_id, "portfolio_key": portfolio_key}
    payload.update(kpis)
    supabase.table("backtest_kpis").upsert(payload).execute()


def run_backtest(
    supabase,
    run_name: str,
    base_currency: str,
    start: date,
    end: date,
    config_json: dict | None = None,
    portfolio_id: str | None = None,
    include_presets: str = "baseline",
    preset_keys: list[str] | None = None,
) -> dict:
    config = parse_config(config_json)
    if config.date_mode != "common_start":
        print("⚠️ Mode A only: date_mode forcé à common_start", flush=True)
        config.date_mode = "common_start"
    if base_currency != BASE_CURRENCY:
        print(f"⚠️ Base currency {base_currency} ignorée, EUR imposée", flush=True)
        base_currency = BASE_CURRENCY

    if portfolio_id is None:
        portfolio_id = fetch_default_portfolio_id(supabase)
    if not portfolio_id:
        raise RuntimeError("portfolio_id introuvable")

    positions = fetch_portfolio_positions(supabase, portfolio_id)
    governance_rows = fetch_governance_targets(supabase, portfolio_id)
    target_weights = extract_target_weights(governance_rows)
    if not target_weights:
        target_weights = extract_target_weights_from_positions(positions)
        if target_weights:
            print("ℹ️ Target weights fallback portfolio_positions", flush=True)
        else:
            print("⚠️ Target weights introuvables", flush=True)

    all_tickers = set()
    selected_preset_keys = select_preset_keys(include_presets, preset_keys)
    specs = build_preset_specs(selected_preset_keys)
    for spec in specs:
        all_tickers.update(spec["weights"].keys())

    for ticker in target_weights.keys():
        all_tickers.add(ticker)
    for row in positions:
        ticker = row.get("ticker")
        if ticker:
            all_tickers.add(str(ticker).upper())

    earliest_dates_all = get_earliest_dates(supabase, sorted(all_tickers))
    effective_start, _, _ = compute_common_start(
        earliest_dates=earliest_dates_all,
        requested_start=start,
        end_date=end,
        series_by_ticker=None,
    )

    series_by_ticker = fetch_historical_prices(
        supabase, sorted(all_tickers), effective_start, end
    )

    if not series_by_ticker:
        raise RuntimeError("historical_prices vide pour la période demandée")

    price_map = get_latest_prices(series_by_ticker, end)
    current_weights = extract_current_weights_from_positions(positions, price_map)
    if not current_weights:
        print("⚠️ Current weights introuvables, fallback target", flush=True)
        current_weights = target_weights

    if target_weights:
        specs.append({
            "portfolio_key": f"{portfolio_id}:target",
            "portfolio_id": portfolio_id,
            "preset_key": None,
            "label": "Target",
            "role": "target",
            "weights": target_weights,
        })
    if current_weights:
        specs.append({
            "portfolio_key": f"{portfolio_id}:current",
            "portfolio_id": portfolio_id,
            "preset_key": None,
            "label": "Current",
            "role": "current",
            "weights": current_weights,
        })

    cleaned_specs = []
    for spec in specs:
        weights = dict(spec["weights"])
        missing = [t for t in weights.keys() if t not in series_by_ticker]
        if missing:
            print(
                f"⚠️ {spec['label']} tickers manquants: {', '.join(missing)}",
                flush=True,
            )
            for ticker in missing:
                weights.pop(ticker, None)
            weights = normalize_weights_pct(weights)
        if not weights:
            print(f"⚠️ Portfolio {spec['label']} vide, skip.", flush=True)
            continue
        spec["weights"] = weights
        cleaned_specs.append(spec)

    if not cleaned_specs:
        raise RuntimeError("Aucun portfolio valide pour le backtest")

    run_tickers = sorted({ticker for spec in cleaned_specs for ticker in spec["weights"].keys()})
    earliest_dates = {ticker: earliest_dates_all.get(ticker) for ticker in run_tickers}
    effective_start, coverage_per_ticker, coverage_global = compute_common_start(
        earliest_dates=earliest_dates,
        requested_start=start,
        end_date=end,
        series_by_ticker=series_by_ticker,
    )

    effective_start, coverage_per_ticker, coverage_global = compute_common_start(
        earliest_dates=earliest_dates,
        requested_start=start,
        end_date=end,
        series_by_ticker=series_by_ticker,
    )

    config_payload = {
        "run_params": {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "base_currency": base_currency,
            "include_presets": include_presets,
            "preset_keys": selected_preset_keys,
        },
        "config": config_json or {},
        "portfolios": [
            {
                "key": spec["portfolio_key"],
                "role": spec["role"],
                "weights": spec["weights"],
            }
            for spec in cleaned_specs
        ],
    }
    config_hash = compute_config_hash(config_payload)
    existing_run = find_existing_run(supabase, config_hash, start, end, base_currency)
    if existing_run and run_has_results(supabase, existing_run):
        print(f"✅ Reuse existing run {existing_run}", flush=True)
        return {"run_id": existing_run, "reused": True}

    diagnostics = {
        "tickers": run_tickers,
        "requested_start": start.isoformat(),
        "requested_end": end.isoformat(),
        "effective_start": effective_start.isoformat(),
        "effective_end": end.isoformat(),
        "earliest_dates": {
            ticker: (value.isoformat() if value else None)
            for ticker, value in earliest_dates.items()
        },
        "coverage_per_ticker": coverage_per_ticker,
        "coverage_global": coverage_global,
    }

    print(
        f"--- common_start requested={start} effective={effective_start} "
        f"coverage_global={coverage_global:.1f}% ---",
        flush=True,
    )
    for ticker in run_tickers:
        coverage = coverage_per_ticker.get(ticker, 0.0)
        earliest = earliest_dates.get(ticker)
        print(
            f"    {ticker}: earliest={earliest} coverage={coverage:.1f}%",
            flush=True,
        )

    run_id = create_backtest_run(
        supabase,
        run_name,
        base_currency,
        start,
        end,
        config,
        config_json,
        config_hash,
        requested_start=start,
        requested_end=end,
        effective_start=effective_start,
        effective_end=end,
        data_mode=config.date_mode or "common_start",
        diagnostics=diagnostics,
    )

    for spec in cleaned_specs:
        tickers = sorted(spec["weights"].keys())
        for ticker in tickers:
            if ticker not in series_by_ticker:
                print(f"⚠️ Pas de données pour {ticker}", flush=True)

        price_frame, start_effective, diagnostics = build_price_frame(
            series_by_ticker,
            tickers,
            effective_start,
            end,
            config.date_mode,
        )

        print(
            f"--- Portfolio {spec['label']} start_effective={start_effective} ---",
            flush=True,
        )
        for ticker, diag in diagnostics.items():
            coverage = diag["coverage_pct"]
            coverage_label = f"{coverage:.1f}%" if coverage is not None else "n/a"
            print(
                f"    {ticker}: earliest={diag['earliest']} "
                f"coverage={coverage_label}",
                flush=True,
            )

        nav_df = simulate_nav(price_frame, spec["weights"], config)
        kpis = compute_kpis(nav_df)

        persist_portfolio(supabase, run_id, spec, start_effective)
        persist_results(supabase, run_id, spec["portfolio_key"], nav_df)
        persist_kpis(supabase, run_id, spec["portfolio_key"], kpis)

    print(f"✅ Backtest completed: run_id={run_id}", flush=True)
    return {"run_id": run_id, "reused": False}
