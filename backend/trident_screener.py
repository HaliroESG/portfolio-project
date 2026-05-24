from __future__ import annotations

import argparse
import csv
import os
import time
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Protocol

import numpy as np

from etl_stats import build_etl_stats

HORIZONS = (1, 3, 5, 10)
TRIDENT_JOB_NAME = "trident_screener_sync"
PORTFOLIO_SEED_EQUITY_TYPES = {"ACTION", "COMMON_STOCK", "EQUITY", "SHARE", "STOCK"}
PORTFOLIO_SEED_EXCLUDED_NAME_MARKERS = (
    " ETF",
    "ETC",
    "ISHARES",
    "LYXOR",
    "MSCI",
    "S&P",
    "GOLD",
    "OVERNIGHT",
)
TICKER_MARKET_HINTS = {
    ".AS": ("Euronext Amsterdam", "NL"),
    ".BR": ("Euronext Brussels", "BE"),
    ".DE": ("Xetra", "DE"),
    ".L": ("London Stock Exchange", "GB"),
    ".MC": ("Bolsa de Madrid", "ES"),
    ".MI": ("Borsa Italiana", "IT"),
    ".PA": ("Euronext Paris", "FR"),
    ".SW": ("SIX Swiss Exchange", "CH"),
}


@dataclass(frozen=True)
class UniverseRecord:
    instrument_key: str
    ticker: str
    name: str | None
    exchange: str | None
    country: str | None
    sector: str | None
    industry: str | None
    currency: str | None
    isin: str | None
    provider: str
    provider_symbol: str
    source_license_note: str | None
    is_active: bool = True


@dataclass(frozen=True)
class FinancialRecord:
    instrument_key: str
    fiscal_year: int
    fiscal_period_end: str | None = None
    currency: str | None = None
    revenue: float | None = None
    eps_diluted: float | None = None
    free_cash_flow: float | None = None
    gross_profit: float | None = None
    operating_income: float | None = None
    net_income: float | None = None
    invested_capital: float | None = None
    total_equity: float | None = None
    capital_employed: float | None = None
    ebitda: float | None = None
    net_debt: float | None = None
    interest_expense: float | None = None
    total_debt: float | None = None
    shares_diluted: float | None = None
    provider: str = "csv"
    source_url: str | None = None


@dataclass(frozen=True)
class CriterionResult:
    horizon_years: int
    criterion_key: str
    category: str
    label: str
    status: str
    actual: float | None
    threshold: float | None
    comparator: str | None
    is_eliminating: bool = False
    reason: str | None = None


@dataclass(frozen=True)
class TridentResult:
    result_row: dict[str, Any]
    criterion_rows: list[dict[str, Any]]


class StockDataProvider(Protocol):
    provider_name: str
    source_license_note: str

    def fetch_universe(self) -> list[UniverseRecord]:
        ...

    def fetch_financials(self, universe: list[UniverseRecord]) -> list[FinancialRecord]:
        ...


def safe_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if value == "":
            return None
        value = value.replace(",", ".")
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(parsed):
        return None
    return parsed


def safe_int(value: Any) -> int | None:
    parsed = safe_float(value)
    if parsed is None:
        return None
    return int(parsed)


def clean_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_currency(value: Any) -> str | None:
    text = clean_string(value)
    if not text:
        return None
    upper = text.upper()
    return upper if len(upper) == 3 else None


def make_instrument_key(provider: str, provider_symbol: str) -> str:
    normalized_provider = provider.strip().lower().replace(" ", "_")
    normalized_symbol = provider_symbol.strip().lower().replace(" ", "")
    return f"{normalized_provider}:{normalized_symbol}"


def parse_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "active"}:
        return True
    if text in {"0", "false", "no", "n", "inactive"}:
        return False
    return default


def parse_date_text(value: Any) -> str | None:
    text = clean_string(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def first_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


class CsvStockDataProvider:
    provider_name = "csv"
    source_license_note = "User-supplied CSV source; verify provider license before production use."

    def __init__(
        self,
        universe_csv: str | Path,
        financials_csv: str | Path,
        provider_name: str = "csv",
        source_license_note: str | None = None,
    ) -> None:
        self.universe_csv = Path(universe_csv)
        self.financials_csv = Path(financials_csv)
        self.provider_name = provider_name
        if source_license_note:
            self.source_license_note = source_license_note

    def fetch_universe(self) -> list[UniverseRecord]:
        if not self.universe_csv.exists():
            raise FileNotFoundError(f"TRIDENT_UNIVERSE_CSV introuvable: {self.universe_csv}")

        records: list[UniverseRecord] = []
        with self.universe_csv.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                ticker = clean_string(first_value(row, "ticker", "symbol"))
                provider_symbol = clean_string(first_value(row, "provider_symbol", "symbol", "ticker"))
                if not ticker or not provider_symbol:
                    continue
                provider = clean_string(row.get("provider")) or self.provider_name
                instrument_key = (
                    clean_string(row.get("instrument_key"))
                    or make_instrument_key(provider, provider_symbol)
                ).lower()
                records.append(
                    UniverseRecord(
                        instrument_key=instrument_key,
                        ticker=ticker.upper(),
                        name=clean_string(row.get("name")),
                        exchange=clean_string(row.get("exchange")),
                        country=clean_string(row.get("country")),
                        sector=clean_string(row.get("sector")),
                        industry=clean_string(row.get("industry")),
                        currency=normalize_currency(row.get("currency")),
                        isin=clean_string(row.get("isin")),
                        provider=provider,
                        provider_symbol=provider_symbol.upper(),
                        source_license_note=(
                            clean_string(row.get("source_license_note"))
                            or self.source_license_note
                        ),
                        is_active=parse_bool(row.get("is_active"), default=True),
                    )
                )
        return records

    def fetch_financials(self, universe: list[UniverseRecord]) -> list[FinancialRecord]:
        if not self.financials_csv.exists():
            raise FileNotFoundError(f"TRIDENT_FINANCIALS_CSV introuvable: {self.financials_csv}")

        key_by_ticker = {record.ticker.upper(): record.instrument_key for record in universe}
        key_by_provider_symbol = {
            record.provider_symbol.upper(): record.instrument_key for record in universe
        }
        records: list[FinancialRecord] = []

        with self.financials_csv.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                explicit_key = clean_string(row.get("instrument_key"))
                symbol = clean_string(first_value(row, "ticker", "symbol", "provider_symbol"))
                instrument_key = explicit_key.lower() if explicit_key else None
                if not instrument_key and symbol:
                    instrument_key = key_by_ticker.get(symbol.upper())
                if not instrument_key and symbol:
                    instrument_key = key_by_provider_symbol.get(symbol.upper())
                fiscal_year = safe_int(first_value(row, "fiscal_year", "year"))
                if not instrument_key or fiscal_year is None:
                    continue

                records.append(
                    FinancialRecord(
                        instrument_key=instrument_key,
                        fiscal_year=fiscal_year,
                        fiscal_period_end=parse_date_text(
                            first_value(row, "fiscal_period_end", "period_end", "date")
                        ),
                        currency=normalize_currency(row.get("currency")),
                        revenue=safe_float(row.get("revenue")),
                        eps_diluted=safe_float(first_value(row, "eps_diluted", "eps")),
                        free_cash_flow=safe_float(first_value(row, "free_cash_flow", "fcf")),
                        gross_profit=safe_float(row.get("gross_profit")),
                        operating_income=safe_float(first_value(row, "operating_income", "ebit")),
                        net_income=safe_float(row.get("net_income")),
                        invested_capital=safe_float(row.get("invested_capital")),
                        total_equity=safe_float(first_value(row, "total_equity", "shareholders_equity")),
                        capital_employed=safe_float(row.get("capital_employed")),
                        ebitda=safe_float(row.get("ebitda")),
                        net_debt=safe_float(row.get("net_debt")),
                        interest_expense=safe_float(row.get("interest_expense")),
                        total_debt=safe_float(row.get("total_debt")),
                        shares_diluted=safe_float(first_value(row, "shares_diluted", "shares_outstanding")),
                        provider=clean_string(row.get("provider")) or self.provider_name,
                        source_url=clean_string(row.get("source_url")),
                    )
                )
        return records


def row_timestamp_score(row: dict[str, Any]) -> float:
    text = clean_string(row.get("updated_at"))
    if not text:
        return 0.0
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def infer_market_from_ticker(
    ticker: str,
    currency: str | None = None,
) -> tuple[str | None, str | None]:
    upper = ticker.upper()
    for suffix, market in TICKER_MARKET_HINTS.items():
        if upper.endswith(suffix):
            return market
    if "." not in upper and currency == "USD":
        return "US listed", "US"
    return None, None


def is_portfolio_seed_equity(row: dict[str, Any], name: str | None) -> bool:
    instrument_type = clean_string(row.get("instrument_type"))
    if instrument_type:
        normalized_type = instrument_type.upper().replace(" ", "_")
        if normalized_type not in PORTFOLIO_SEED_EQUITY_TYPES:
            return False

    label = f" {name or ''} ".upper()
    if any(marker in label for marker in PORTFOLIO_SEED_EXCLUDED_NAME_MARKERS):
        return False
    return True


class PortfolioSeedDataProvider:
    provider_name = "portfolio_seed"
    source_license_note = (
        "Universe seeded from Supabase portfolio_positions; annual financial "
        "statements are not configured, so NO_DATA rows are explicit."
    )

    def __init__(self, supabase: Any, source_license_note: str | None = None) -> None:
        self.supabase = supabase
        if source_license_note:
            self.source_license_note = source_license_note

    def _fetch_rows(self, table_name: str, selector: str) -> list[dict[str, Any]]:
        response = self.supabase.table(table_name).select(selector).execute()
        data = getattr(response, "data", None) or []
        return [row for row in data if isinstance(row, dict)]

    def fetch_universe(self) -> list[UniverseRecord]:
        portfolio_rows = self._fetch_rows(
            "portfolio_positions",
            "ticker,name,instrument_type,currency,updated_at",
        )
        market_rows = self._fetch_rows(
            "market_watch",
            "ticker,name,currency,updated_at",
        )
        market_by_ticker = {
            str(row["ticker"]).upper(): row
            for row in market_rows
            if clean_string(row.get("ticker"))
        }

        records_by_ticker: dict[str, UniverseRecord] = {}
        sorted_rows = sorted(portfolio_rows, key=row_timestamp_score, reverse=True)
        for row in sorted_rows:
            ticker = clean_string(row.get("ticker"))
            if not ticker:
                continue
            ticker = ticker.upper()
            if ticker in records_by_ticker:
                continue

            market_row = market_by_ticker.get(ticker, {})
            name = clean_string(row.get("name")) or clean_string(market_row.get("name"))
            if not is_portfolio_seed_equity(row, name):
                continue

            currency = normalize_currency(row.get("currency")) or normalize_currency(
                market_row.get("currency")
            )
            exchange, country = infer_market_from_ticker(ticker, currency)
            instrument_key = make_instrument_key(self.provider_name, ticker).lower()
            records_by_ticker[ticker] = UniverseRecord(
                instrument_key=instrument_key,
                ticker=ticker,
                name=name,
                exchange=exchange,
                country=country,
                sector=None,
                industry=None,
                currency=currency,
                isin=None,
                provider=self.provider_name,
                provider_symbol=ticker,
                source_license_note=self.source_license_note,
                is_active=True,
            )

        if not records_by_ticker:
            raise RuntimeError(
                "portfolio_seed provider found no eligible equity rows in portfolio_positions."
            )

        return sorted(
            records_by_ticker.values(),
            key=lambda record: record.ticker,
        )

    def fetch_financials(self, universe: list[UniverseRecord]) -> list[FinancialRecord]:
        return []


def annualized_growth(start_value: float | None, end_value: float | None, years: int) -> float | None:
    if start_value is None or end_value is None:
        return None
    if years <= 0 or start_value <= 0 or end_value <= 0:
        return None
    return (end_value / start_value) ** (1 / years) - 1


def ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


def average(values: Iterable[float | None]) -> float | None:
    clean = [value for value in values if value is not None and np.isfinite(value)]
    if not clean:
        return None
    return float(sum(clean) / len(clean))


def status_threshold(
    actual: float | None,
    threshold: float,
    comparator: str,
    missing_reason: str,
) -> tuple[str, str | None]:
    if actual is None:
        return "missing", missing_reason
    if comparator == ">":
        return ("pass", None) if actual > threshold else ("fail", f"{actual:.2%} <= {threshold:.2%}")
    if comparator == "<":
        return ("pass", None) if actual < threshold else ("fail", f"{actual:.2f} >= {threshold:.2f}")
    if comparator == "<=":
        return ("pass", None) if actual <= threshold else ("fail", f"{actual:.2%} > {threshold:.2%}")
    raise ValueError(f"Comparateur inconnu: {comparator}")


def window_for_horizon(
    records: list[FinancialRecord],
    horizon_years: int,
) -> tuple[FinancialRecord | None, FinancialRecord | None, list[FinancialRecord]]:
    if not records:
        return None, None, []

    sorted_records = sorted(records, key=lambda record: record.fiscal_year)
    end = sorted_records[-1]
    start_candidates = [
        record for record in sorted_records if record.fiscal_year <= end.fiscal_year - horizon_years
    ]
    start = start_candidates[-1] if start_candidates else None

    if horizon_years == 1 and start is None and len(sorted_records) >= 2:
        start = sorted_records[-2]

    if start is None:
        return None, end, [end]

    window = [
        record
        for record in sorted_records
        if start.fiscal_year <= record.fiscal_year <= end.fiscal_year
    ]
    return start, end, window


def margin_values(window: list[FinancialRecord], field: str) -> list[float | None]:
    values: list[float | None] = []
    for record in window:
        numerator = getattr(record, field)
        values.append(ratio(numerator, record.revenue))
    return values


def roic(record: FinancialRecord) -> float | None:
    return ratio(record.operating_income, record.invested_capital)


def roe(record: FinancialRecord) -> float | None:
    return ratio(record.net_income, record.total_equity)


def roce(record: FinancialRecord) -> float | None:
    return ratio(record.operating_income, record.capital_employed)


def net_debt_to_ebitda(record: FinancialRecord) -> float | None:
    if record.net_debt is None or record.ebitda is None:
        return None
    if record.net_debt <= 0 and record.ebitda and record.ebitda > 0:
        return record.net_debt / record.ebitda
    return ratio(record.net_debt, record.ebitda)


def interest_coverage(record: FinancialRecord) -> float | None:
    if record.operating_income is None or record.interest_expense is None:
        return None
    expense = abs(record.interest_expense)
    if expense == 0:
        return None
    return record.operating_income / expense


def debt_to_equity(record: FinancialRecord) -> float | None:
    return ratio(record.total_debt, record.total_equity)


def criterion(
    *,
    horizon_years: int,
    key: str,
    category: str,
    label: str,
    actual: float | None,
    threshold: float | None,
    comparator: str | None,
    status: str | None = None,
    is_eliminating: bool = False,
    reason: str | None = None,
) -> CriterionResult:
    if status is None:
        if threshold is None or comparator is None:
            raise ValueError("threshold/comparator required when status is not provided")
        status, reason = status_threshold(
            actual,
            threshold,
            comparator,
            reason or "donnée ou historique insuffisant",
        )
    return CriterionResult(
        horizon_years=horizon_years,
        criterion_key=key,
        category=category,
        label=label,
        status=status,
        actual=actual,
        threshold=threshold,
        comparator=comparator,
        is_eliminating=is_eliminating,
        reason=reason,
    )


def build_horizon_criteria(
    records: list[FinancialRecord],
    horizon_years: int,
) -> tuple[dict[str, Any], list[CriterionResult]]:
    start, end, window = window_for_horizon(records, horizon_years)
    if end is None:
        return (
            {
                "horizon_years": horizon_years,
                "start_year": None,
                "end_year": None,
                "status": "missing",
                "metrics": {},
            },
            missing_criteria(horizon_years, "aucun historique financier annuel"),
        )

    actual_years = (end.fiscal_year - start.fiscal_year) if start else 0
    has_horizon = start is not None and actual_years > 0
    horizon_status = "complete" if has_horizon and actual_years >= horizon_years else "partial"
    if not has_horizon:
        horizon_status = "missing"

    revenue_cagr = annualized_growth(
        start.revenue if start else None,
        end.revenue,
        actual_years,
    )
    eps_cagr = annualized_growth(
        start.eps_diluted if start else None,
        end.eps_diluted,
        actual_years,
    )
    fcf_margins = margin_values(window, "free_cash_flow")
    gross_margin = average(margin_values(window, "gross_profit"))
    operating_margin = average(margin_values(window, "operating_income"))
    net_margin = average(margin_values(window, "net_income"))
    fcf_margin = average(fcf_margins)
    roic_avg = average([roic(record) for record in window])
    roe_avg = average([roe(record) for record in window])
    roce_avg = average([roce(record) for record in window])
    debt_ebitda_avg = average([net_debt_to_ebitda(record) for record in window])
    interest_coverage_avg = average([interest_coverage(record) for record in window])
    debt_equity_avg = average([debt_to_equity(record) for record in window])
    shares_cagr = annualized_growth(
        start.shares_diluted if start else None,
        end.shares_diluted,
        actual_years,
    )

    metrics = {
        "revenue_cagr": revenue_cagr,
        "eps_cagr": eps_cagr,
        "fcf_margin": fcf_margin,
        "gross_margin": gross_margin,
        "operating_margin": operating_margin,
        "net_margin": net_margin,
        "roic": roic_avg,
        "roe": roe_avg,
        "roce": roce_avg,
        "net_debt_to_ebitda": debt_ebitda_avg,
        "interest_coverage": interest_coverage_avg,
        "debt_to_equity": debt_equity_avg,
        "shares_cagr": shares_cagr,
    }

    criteria: list[CriterionResult] = [
        criterion(
            horizon_years=horizon_years,
            key="revenue_cagr",
            category="growth",
            label="Revenue annualized growth > 10%",
            actual=revenue_cagr,
            threshold=0.10,
            comparator=">",
            reason="CA ou historique de début/fin manquant",
        ),
        criterion(
            horizon_years=horizon_years,
            key="eps_cagr",
            category="growth",
            label="Diluted EPS annualized growth > 12%",
            actual=eps_cagr,
            threshold=0.12,
            comparator=">",
            reason="BPA ou historique de début/fin manquant/non positif",
        ),
        build_fcf_quality_criterion(horizon_years, window),
        criterion(
            horizon_years=horizon_years,
            key="gross_margin",
            category="profitability",
            label="Gross margin > 40%",
            actual=gross_margin,
            threshold=0.40,
            comparator=">",
            reason="marge brute ou CA manquant",
        ),
        criterion(
            horizon_years=horizon_years,
            key="operating_margin",
            category="profitability",
            label="Operating margin > 15%",
            actual=operating_margin,
            threshold=0.15,
            comparator=">",
            reason="résultat opérationnel ou CA manquant",
        ),
        criterion(
            horizon_years=horizon_years,
            key="net_margin",
            category="profitability",
            label="Net margin > 15%",
            actual=net_margin,
            threshold=0.15,
            comparator=">",
            reason="résultat net ou CA manquant",
        ),
        criterion(
            horizon_years=horizon_years,
            key="fcf_margin",
            category="profitability",
            label="FCF margin > 10%",
            actual=fcf_margin,
            threshold=0.10,
            comparator=">",
            reason="FCF ou CA manquant",
        ),
        criterion(
            horizon_years=horizon_years,
            key="roic",
            category="capital",
            label="ROIC > 15%",
            actual=roic_avg,
            threshold=0.15,
            comparator=">",
            is_eliminating=True,
            reason="ROIC indisponible: résultat opérationnel ou capital investi manquant",
        ),
        build_roe_or_roce_criterion(horizon_years, roe_avg, roce_avg),
        criterion(
            horizon_years=horizon_years,
            key="shares_stable_or_down",
            category="capital",
            label="Shares stable or down",
            actual=shares_cagr,
            threshold=0.005,
            comparator="<=",
            reason="actions diluées début/fin manquantes",
        ),
        criterion(
            horizon_years=horizon_years,
            key="net_debt_to_ebitda",
            category="health",
            label="Net debt / EBITDA < 3",
            actual=debt_ebitda_avg,
            threshold=3.0,
            comparator="<",
            reason="dette nette ou EBITDA manquant",
        ),
        build_interest_coverage_criterion(horizon_years, window, interest_coverage_avg),
        criterion(
            horizon_years=horizon_years,
            key="debt_to_equity",
            category="health",
            label="Debt / equity < 0.5",
            actual=debt_equity_avg,
            threshold=0.5,
            comparator="<",
            reason="dette totale ou capitaux propres manquants",
        ),
    ]

    return (
        {
            "horizon_years": horizon_years,
            "start_year": start.fiscal_year if start else None,
            "end_year": end.fiscal_year,
            "status": horizon_status,
            "metrics": metrics,
        },
        criteria,
    )


def missing_criteria(horizon_years: int, reason: str) -> list[CriterionResult]:
    definitions = [
        ("growth", "revenue_cagr", "Revenue annualized growth > 10%", 0.10, ">"),
        ("growth", "eps_cagr", "Diluted EPS annualized growth > 12%", 0.12, ">"),
        ("growth", "fcf_quality", "FCF positive, regular, revenue-consistent", None, None),
        ("profitability", "gross_margin", "Gross margin > 40%", 0.40, ">"),
        ("profitability", "operating_margin", "Operating margin > 15%", 0.15, ">"),
        ("profitability", "net_margin", "Net margin > 15%", 0.15, ">"),
        ("profitability", "fcf_margin", "FCF margin > 10%", 0.10, ">"),
        ("capital", "roic", "ROIC > 15%", 0.15, ">"),
        ("capital", "roe_or_roce", "ROE or ROCE > 15%", 0.15, ">"),
        ("capital", "shares_stable_or_down", "Shares stable or down", 0.005, "<="),
        ("health", "net_debt_to_ebitda", "Net debt / EBITDA < 3", 3.0, "<"),
        ("health", "interest_coverage", "Interest coverage > 10", 10.0, ">"),
        ("health", "debt_to_equity", "Debt / equity < 0.5", 0.5, "<"),
    ]
    return [
        CriterionResult(
            horizon_years=horizon_years,
            criterion_key=key,
            category=category,
            label=label,
            status="missing",
            actual=None,
            threshold=threshold,
            comparator=comparator,
            is_eliminating=key == "roic",
            reason=reason,
        )
        for category, key, label, threshold, comparator in definitions
    ]


def build_fcf_quality_criterion(horizon_years: int, window: list[FinancialRecord]) -> CriterionResult:
    if not window:
        return criterion(
            horizon_years=horizon_years,
            key="fcf_quality",
            category="growth",
            label="FCF positive, regular, revenue-consistent",
            actual=None,
            threshold=None,
            comparator=None,
            status="missing",
            reason="aucun historique FCF",
        )

    fcf_values = [record.free_cash_flow for record in window]
    revenue_values = [record.revenue for record in window]
    if any(value is None for value in fcf_values) or any(value is None for value in revenue_values):
        return criterion(
            horizon_years=horizon_years,
            key="fcf_quality",
            category="growth",
            label="FCF positive, regular, revenue-consistent",
            actual=None,
            threshold=None,
            comparator=None,
            status="missing",
            reason="FCF ou CA manquant sur la fenêtre",
        )

    positive_count = sum(1 for value in fcf_values if value is not None and value > 0)
    positive_ratio = positive_count / len(fcf_values)
    latest = window[-1]
    latest_margin = ratio(latest.free_cash_flow, latest.revenue)
    if latest_margin is None:
        status = "missing"
        reason = "marge FCF latest impossible à calculer"
    elif positive_ratio >= 0.80 and latest_margin > 0:
        status = "pass"
        reason = None
    else:
        status = "fail"
        reason = f"FCF positif {positive_count}/{len(fcf_values)}, marge latest {latest_margin:.2%}"

    return criterion(
        horizon_years=horizon_years,
        key="fcf_quality",
        category="growth",
        label="FCF positive, regular, revenue-consistent",
        actual=positive_ratio,
        threshold=0.80,
        comparator=">=",
        status=status,
        reason=reason,
    )


def build_roe_or_roce_criterion(
    horizon_years: int,
    roe_avg: float | None,
    roce_avg: float | None,
) -> CriterionResult:
    available = [value for value in (roe_avg, roce_avg) if value is not None]
    if not available:
        status = "missing"
        actual = None
        reason = "ROE et ROCE indisponibles"
    else:
        actual = max(available)
        status = "pass" if actual > 0.15 else "fail"
        reason = None if status == "pass" else f"max(ROE, ROCE) {actual:.2%} <= 15.00%"
    return criterion(
        horizon_years=horizon_years,
        key="roe_or_roce",
        category="capital",
        label="ROE or ROCE > 15%",
        actual=actual,
        threshold=0.15,
        comparator=">",
        status=status,
        reason=reason,
    )


def build_interest_coverage_criterion(
    horizon_years: int,
    window: list[FinancialRecord],
    interest_coverage_avg: float | None,
) -> CriterionResult:
    has_debt = any((record.total_debt or 0) > 0 for record in window)
    has_interest = any(
        record.interest_expense is not None and abs(record.interest_expense) > 0
        for record in window
    )
    if not has_debt and not has_interest:
        return criterion(
            horizon_years=horizon_years,
            key="interest_coverage",
            category="health",
            label="Interest coverage > 10",
            actual=None,
            threshold=10.0,
            comparator=">",
            status="not_applicable",
            reason="pas de dette ni charge d'intérêt reportée",
        )
    return criterion(
        horizon_years=horizon_years,
        key="interest_coverage",
        category="health",
        label="Interest coverage > 10",
        actual=interest_coverage_avg,
        threshold=10.0,
        comparator=">",
        reason="résultat opérationnel ou charge d'intérêt manquant",
    )


def category_scores(criteria: list[CriterionResult]) -> dict[str, float]:
    scores: dict[str, float] = {}
    for category in ("growth", "profitability", "capital", "health"):
        category_items = [
            item for item in criteria
            if item.category == category and item.status != "not_applicable"
        ]
        if not category_items:
            scores[category] = 0.0
            continue
        passed = sum(1 for item in category_items if item.status == "pass")
        scores[category] = round((passed / len(category_items)) * 100, 2)
    return scores


def compute_trident_for_instrument(
    instrument_key: str,
    records: list[FinancialRecord],
    as_of_date: date | None = None,
) -> TridentResult:
    as_of = as_of_date or datetime.utcnow().date()
    sorted_records = sorted(records, key=lambda record: record.fiscal_year)
    latest = sorted_records[-1] if sorted_records else None

    horizon_summaries: dict[str, Any] = {}
    all_criteria: list[CriterionResult] = []
    for horizon in HORIZONS:
        summary, criteria = build_horizon_criteria(sorted_records, horizon)
        horizon_summaries[str(horizon)] = summary
        all_criteria.extend(criteria)

    applicable = [item for item in all_criteria if item.status != "not_applicable"]
    observed = [item for item in applicable if item.status in {"pass", "fail"}]
    passed = sum(1 for item in applicable if item.status == "pass")
    failed = [item for item in applicable if item.status == "fail"]
    missing = [item for item in applicable if item.status == "missing"]
    failed_eliminators = [
        item.criterion_key
        for item in failed
        if item.is_eliminating
    ]

    if latest is None:
        overall_state = "NO_DATA"
    elif failed_eliminators or failed:
        overall_state = "FAIL"
    elif missing:
        overall_state = "PARTIAL"
    else:
        overall_state = "PASS"

    denominator = len(applicable)
    score = round((passed / denominator) * 100, 2) if denominator else 0.0
    confidence = round((len(observed) / denominator) * 100, 2) if denominator else 0.0
    scores = category_scores(all_criteria)

    latest_roic = roic(latest) if latest else None
    latest_debt_ebitda = net_debt_to_ebitda(latest) if latest else None

    result_row = {
        "instrument_key": instrument_key,
        "as_of_date": as_of.isoformat(),
        "latest_fiscal_year": latest.fiscal_year if latest else None,
        "overall_state": overall_state,
        "score": score,
        "confidence": confidence,
        "growth_score": scores["growth"],
        "profitability_score": scores["profitability"],
        "capital_score": scores["capital"],
        "health_score": scores["health"],
        "latest_roic": latest_roic,
        "latest_net_debt_to_ebitda": latest_debt_ebitda,
        "failed_eliminators": sorted(set(failed_eliminators)),
        "horizons": horizon_summaries,
        "summary": {
            "criteria_total": len(applicable),
            "criteria_pass": passed,
            "criteria_fail": len(failed),
            "criteria_missing": len(missing),
            "criteria_not_applicable": sum(1 for item in all_criteria if item.status == "not_applicable"),
            "horizons_available": [
                horizon
                for horizon, summary in horizon_summaries.items()
                if summary.get("status") == "complete"
            ],
        },
        "updated_at": datetime.utcnow().isoformat(),
    }

    criterion_rows = [
        {
            "instrument_key": instrument_key,
            "horizon_years": item.horizon_years,
            "criterion_key": item.criterion_key,
            "category": item.category,
            "label": item.label,
            "status": item.status,
            "actual": item.actual,
            "threshold": item.threshold,
            "comparator": item.comparator,
            "is_eliminating": item.is_eliminating,
            "reason": item.reason,
            "updated_at": datetime.utcnow().isoformat(),
        }
        for item in all_criteria
    ]
    return TridentResult(result_row=result_row, criterion_rows=criterion_rows)


def universe_payload(record: UniverseRecord) -> dict[str, Any]:
    return {
        "instrument_key": record.instrument_key,
        "ticker": record.ticker,
        "name": record.name,
        "exchange": record.exchange,
        "country": record.country,
        "sector": record.sector,
        "industry": record.industry,
        "currency": record.currency,
        "isin": record.isin,
        "provider": record.provider,
        "provider_symbol": record.provider_symbol,
        "source_license_note": record.source_license_note,
        "is_active": record.is_active,
        "updated_at": datetime.utcnow().isoformat(),
    }


def financial_payload(record: FinancialRecord) -> dict[str, Any]:
    return {
        "instrument_key": record.instrument_key,
        "fiscal_year": record.fiscal_year,
        "fiscal_period_end": record.fiscal_period_end,
        "currency": record.currency,
        "revenue": record.revenue,
        "eps_diluted": record.eps_diluted,
        "free_cash_flow": record.free_cash_flow,
        "gross_profit": record.gross_profit,
        "operating_income": record.operating_income,
        "net_income": record.net_income,
        "invested_capital": record.invested_capital,
        "total_equity": record.total_equity,
        "capital_employed": record.capital_employed,
        "ebitda": record.ebitda,
        "net_debt": record.net_debt,
        "interest_expense": record.interest_expense,
        "total_debt": record.total_debt,
        "shares_diluted": record.shares_diluted,
        "provider": record.provider,
        "source_url": record.source_url,
        "updated_at": datetime.utcnow().isoformat(),
    }


def upsert_rows(
    supabase: Any,
    table: str,
    rows: list[dict[str, Any]],
    *,
    on_conflict: str,
    chunk_size: int = 500,
) -> int:
    total = 0
    for index in range(0, len(rows), chunk_size):
        batch = rows[index:index + chunk_size]
        if not batch:
            continue
        supabase.table(table).upsert(batch, on_conflict=on_conflict).execute()
        total += len(batch)
    return total


def run_trident_sync(
    supabase: Any,
    provider: StockDataProvider,
    *,
    dry_run: bool = False,
    limit: int | None = None,
) -> dict[str, Any]:
    universe = provider.fetch_universe()
    if limit is not None:
        universe = universe[:limit]
    financials = provider.fetch_financials(universe)
    allowed_keys = {record.instrument_key for record in universe}
    financials = [record for record in financials if record.instrument_key in allowed_keys]

    grouped: dict[str, list[FinancialRecord]] = {record.instrument_key: [] for record in universe}
    for record in financials:
        grouped.setdefault(record.instrument_key, []).append(record)

    result_rows: list[dict[str, Any]] = []
    criterion_rows: list[dict[str, Any]] = []
    for instrument_key, rows in grouped.items():
        computed = compute_trident_for_instrument(instrument_key, rows)
        result_rows.append(computed.result_row)
        criterion_rows.extend(computed.criterion_rows)

    universe_rows = [universe_payload(record) for record in universe]
    financial_rows = [financial_payload(record) for record in financials]

    stats = {
        "provider": provider.provider_name,
        "universe_rows": len(universe_rows),
        "financial_rows": len(financial_rows),
        "result_rows": len(result_rows),
        "criterion_rows": len(criterion_rows),
        "items_total": len(universe_rows),
        "items_success": len(result_rows),
        "items_failed": 0,
    }

    if dry_run:
        stats["dry_run"] = True
        return stats

    upsert_rows(
        supabase,
        "trident_equity_universe",
        universe_rows,
        on_conflict="instrument_key",
    )
    upsert_rows(
        supabase,
        "trident_financial_annual",
        financial_rows,
        on_conflict="instrument_key,fiscal_year",
    )
    upsert_rows(
        supabase,
        "trident_results",
        result_rows,
        on_conflict="instrument_key",
    )
    upsert_rows(
        supabase,
        "trident_criterion_results",
        criterion_rows,
        on_conflict="instrument_key,horizon_years,criterion_key",
    )
    return stats


def get_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} manquant")
    return value


def get_supabase_client() -> Any:
    from supabase import create_client

    return create_client(get_env("SUPABASE_URL"), get_env("SUPABASE_KEY"))


def start_etl_run(supabase: Any, job_name: str) -> str | None:
    try:
        response = (
            supabase
            .table("etl_runs")
            .insert({
                "job_name": job_name,
                "status": "RUNNING",
                "started_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
            })
            .execute()
        )
        if response.data:
            return response.data[0].get("id")
    except Exception as exc:
        print(f"⚠️ Impossible de démarrer etl_runs: {exc}", flush=True)
    return None


def finish_etl_run(
    supabase: Any,
    run_id: str | None,
    status: str,
    duration_sec: float,
    stats: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    if not run_id:
        return
    try:
        payload: dict[str, Any] = {
            "status": status,
            "finished_at": datetime.utcnow().isoformat(),
            "duration_sec": round(duration_sec, 2),
            "updated_at": datetime.utcnow().isoformat(),
        }
        if stats is not None:
            payload["stats"] = stats
        if error:
            payload["error"] = error
        supabase.table("etl_runs").update(payload).eq("id", run_id).execute()
    except Exception as exc:
        print(f"⚠️ Impossible de clôturer etl_runs: {exc}", flush=True)


def build_provider_from_args(args: argparse.Namespace) -> StockDataProvider:
    provider_name = (args.provider or os.environ.get("TRIDENT_PROVIDER") or "csv").lower()
    if provider_name == "portfolio_seed":
        return PortfolioSeedDataProvider(
            get_supabase_client(),
            source_license_note=os.environ.get("TRIDENT_SOURCE_LICENSE_NOTE"),
        )

    if provider_name != "csv":
        raise RuntimeError(
            "Aucun provider fiable/licencié n'est configuré dans ce repo pour "
            f"TRIDENT_PROVIDER={provider_name}. Utiliser provider=csv, "
            "portfolio_seed, ou ajouter une implémentation provider explicite "
            "avec ses droits d'usage."
        )

    universe_csv = args.universe_csv or os.environ.get("TRIDENT_UNIVERSE_CSV")
    financials_csv = args.financials_csv or os.environ.get("TRIDENT_FINANCIALS_CSV")
    if not universe_csv or not financials_csv:
        raise RuntimeError(
            "TRIDENT_UNIVERSE_CSV et TRIDENT_FINANCIALS_CSV sont requis pour le "
            "provider csv. Aucune donnée Trident n'est inventée."
        )
    return CsvStockDataProvider(
        universe_csv=universe_csv,
        financials_csv=financials_csv,
        provider_name=provider_name,
        source_license_note=os.environ.get("TRIDENT_SOURCE_LICENSE_NOTE"),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Trident global equity screener")
    parser.add_argument("--provider", default=None)
    parser.add_argument("--universe-csv", default=None)
    parser.add_argument("--financials-csv", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    provider = build_provider_from_args(args)
    supabase = None if args.dry_run else get_supabase_client()
    run_id = None if args.dry_run else start_etl_run(supabase, TRIDENT_JOB_NAME)
    started = time.time()
    try:
        stats = run_trident_sync(supabase, provider, dry_run=args.dry_run, limit=args.limit)
        normalized_stats = build_etl_stats(
            TRIDENT_JOB_NAME,
            stats,
            items_total=stats.get("items_total"),
            items_success=stats.get("items_success"),
            items_failed=stats.get("items_failed"),
        )
        if not args.dry_run:
            finish_etl_run(
                supabase,
                run_id,
                "SUCCESS",
                time.time() - started,
                stats=normalized_stats,
            )
        print(f"--- TRIDENT FINISHED: {normalized_stats} ---", flush=True)
    except Exception as exc:
        if not args.dry_run:
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
