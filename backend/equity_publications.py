from __future__ import annotations

import csv
import os
import re
import time
from dataclasses import asdict, dataclass, replace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from etl_stats import build_etl_stats
from trident_screener import normalize_currency, safe_float, statement_value


JOB_NAME = "equity_publications_sync"
TARGET_INDEXES = ("CAC 40", "S&P 500")
INDEX_KEY_BY_NAME = {"CAC 40": "cac_40", "S&P 500": "sp500"}
INDEX_NAME_BY_KEY = {value: key for key, value in INDEX_KEY_BY_NAME.items()}
INDEX_SOURCE_URLS = {
    "cac_40": "https://en.wikipedia.org/wiki/CAC_40",
    "sp500": "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
}
YAHOO_SOURCE_PROVIDER = "yfinance_yahoo"
SEC_SOURCE_PROVIDER = "sec_edgar"
FINANCIAL_PERIOD_KINDS = {"Q1", "Q2", "Q3", "Q4", "H1", "H2", "INTERIM"}
EVENT_PERIOD_KINDS = FINANCIAL_PERIOD_KINDS | {"FY"}
EVENT_STATUSES = {"ESTIMATED", "CONFIRMED", "REPORTED", "CANCELLED"}
EVENT_TYPES = {"EARNINGS", "REGULATORY_FILING"}


@dataclass(frozen=True)
class PublicationUniverseRecord:
    instrument_key: str
    ticker: str
    name: str | None
    provider_symbol: str
    source_index: str
    currency: str | None
    country: str | None
    fiscal_year_end_month: int = 12
    annual_periods: tuple[tuple[int, date], ...] = ()


@dataclass(frozen=True)
class InterimFinancialRecord:
    instrument_key: str
    fiscal_period_end: date
    fiscal_year: int
    period_kind: str
    period_months: int | None
    currency: str | None
    revenue: float | None
    ebitda: float | None
    operating_income: float | None
    net_income: float | None
    eps_diluted: float | None
    operating_cash_flow: float | None
    capital_expenditure: float | None
    free_cash_flow: float | None
    data_state: str
    reason_codes: tuple[str, ...]
    source_provider: str
    source_url: str | None


@dataclass(frozen=True)
class ReportingEventRecord:
    event_key: str
    instrument_key: str
    event_type: str
    event_label: str | None
    event_date: date
    event_time_utc: datetime | None
    status: str
    fiscal_year: int | None
    fiscal_period_end: date | None
    period_kind: str | None
    filing_date: date | None
    match_confidence: str
    source_provider: str
    source_url: str | None
    metadata: Mapping[str, Any]


@dataclass(frozen=True)
class SymbolReportingResult:
    financials: tuple[InterimFinancialRecord, ...]
    events: tuple[ReportingEventRecord, ...]
    reason_codes: tuple[str, ...]


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = clean_text(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        text = clean_text(value)
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def infer_fiscal_period(period_end: date, fiscal_year_end_month: int) -> tuple[int, str]:
    month = min(12, max(1, fiscal_year_end_month))
    months_to_year_end = (month - period_end.month) % 12
    fiscal_year = period_end.year + (1 if period_end.month > month else 0)
    quarter_by_distance = {9: "Q1", 6: "Q2", 3: "Q3", 0: "Q4"}
    closest = min(quarter_by_distance, key=lambda item: abs(item - months_to_year_end))
    if abs(closest - months_to_year_end) > 1:
        return fiscal_year, "INTERIM"
    return fiscal_year, quarter_by_distance[closest]


def _column_date(column: Any) -> date | None:
    if hasattr(column, "to_pydatetime"):
        try:
            return column.to_pydatetime().date()
        except Exception:
            pass
    return parse_date(column)


def _statement_columns(*frames: Any, limit: int = 8) -> list[Any]:
    by_date: dict[date, Any] = {}
    for frame in frames:
        if frame is None or getattr(frame, "empty", True):
            continue
        for column in frame.columns:
            parsed = _column_date(column)
            if parsed and parsed not in by_date:
                by_date[parsed] = column
    return [by_date[key] for key in sorted(by_date, reverse=True)[:limit]]


def _financial_state(values: Mapping[str, float | None], reason_codes: list[str]) -> str:
    required_available = sum(
        values.get(name) is not None
        for name in ("revenue", "ebitda", "operating_income", "net_income", "free_cash_flow")
    )
    if values.get("revenue") is None:
        reason_codes.append("REVENUE_UNAVAILABLE")
    if values.get("ebitda") is None:
        reason_codes.append("EBITDA_UNAVAILABLE")
    if values.get("free_cash_flow") is None:
        reason_codes.append("FCF_UNAVAILABLE")
    return "READY" if values.get("revenue") is not None and required_available >= 3 else "PARTIAL"


def normalize_interim_financials(
    record: PublicationUniverseRecord,
    income: Any,
    cashflow: Any,
    *,
    max_periods: int = 8,
) -> list[InterimFinancialRecord]:
    columns = _statement_columns(income, cashflow, limit=max_periods)
    normalized: list[InterimFinancialRecord] = []
    for column in sorted(columns, key=lambda item: _column_date(item) or date.min):
        period_end = _column_date(column)
        if period_end is None:
            continue
        fiscal_year, period_kind = infer_fiscal_period(
            period_end,
            record.fiscal_year_end_month,
        )
        operating_cash_flow = statement_value(
            cashflow,
            column,
            ("Operating Cash Flow", "Total Cash From Operating Activities"),
        )
        capital_expenditure = statement_value(
            cashflow,
            column,
            ("Capital Expenditure", "Capital Expenditures"),
        )
        free_cash_flow = statement_value(cashflow, column, ("Free Cash Flow",))
        reason_codes: list[str] = []
        if (
            free_cash_flow is None
            and operating_cash_flow is not None
            and capital_expenditure is not None
        ):
            free_cash_flow = operating_cash_flow + capital_expenditure
            reason_codes.append("FCF_DERIVED")

        values = {
            "revenue": statement_value(
                income,
                column,
                ("Total Revenue", "Operating Revenue"),
            ),
            "ebitda": statement_value(
                income,
                column,
                ("EBITDA", "Normalized EBITDA"),
            ),
            "operating_income": statement_value(
                income,
                column,
                ("Operating Income", "EBIT"),
            ),
            "net_income": statement_value(
                income,
                column,
                ("Net Income", "Net Income Common Stockholders"),
            ),
            "free_cash_flow": free_cash_flow,
        }
        if not any(value is not None for value in values.values()):
            continue
        data_state = _financial_state(values, reason_codes)
        normalized.append(
            InterimFinancialRecord(
                instrument_key=record.instrument_key,
                fiscal_period_end=period_end,
                fiscal_year=fiscal_year,
                period_kind=period_kind,
                period_months=3,
                currency=normalize_currency(record.currency),
                revenue=values["revenue"],
                ebitda=values["ebitda"],
                operating_income=values["operating_income"],
                net_income=values["net_income"],
                eps_diluted=statement_value(
                    income,
                    column,
                    ("Diluted EPS", "Basic EPS"),
                ),
                operating_cash_flow=operating_cash_flow,
                capital_expenditure=capital_expenditure,
                free_cash_flow=free_cash_flow,
                data_state=data_state,
                reason_codes=tuple(dict.fromkeys(reason_codes)),
                source_provider=YAHOO_SOURCE_PROVIDER,
                source_url=(
                    f"https://finance.yahoo.com/quote/"
                    f"{record.provider_symbol}/financials"
                ),
            )
        )
    return normalized


_EVENT_PERIOD_RE = re.compile(r"\b(Q[1-4])\s+(\d{4})\b", re.IGNORECASE)


def parse_event_period(label: str | None) -> tuple[int | None, str | None]:
    if not label:
        return None, None
    match = _EVENT_PERIOD_RE.search(label)
    if not match:
        return None, None
    return int(match.group(2)), match.group(1).upper()


def reporting_event_key(
    instrument_key: str,
    event_type: str,
    source_provider: str,
    event_date: date,
    *,
    fiscal_year: int | None = None,
    period_kind: str | None = None,
) -> str:
    if fiscal_year is not None and period_kind:
        slot = f"{period_kind.lower()}-{fiscal_year}"
    else:
        slot = event_date.isoformat()
    return (
        f"{source_provider}:{instrument_key}:{event_type}:{slot}"
        .strip()
        .lower()
        .replace(" ", "_")
    )


def _event_status(
    event_date: date,
    today: date,
    *,
    actual_value: float | None = None,
) -> str:
    if actual_value is not None or event_date < today:
        return "REPORTED"
    return "ESTIMATED"


def normalize_earnings_frame(
    record: PublicationUniverseRecord,
    frame: Any,
    *,
    today: date,
) -> list[ReportingEventRecord]:
    if frame is None or getattr(frame, "empty", True):
        return []
    events: list[ReportingEventRecord] = []
    for raw_time, row in frame.iterrows():
        event_time = parse_datetime(raw_time)
        event_date = parse_date(raw_time)
        if event_date is None:
            continue
        actual_eps = safe_float(row.get("Reported EPS"))
        status = _event_status(event_date, today, actual_value=actual_eps)
        events.append(
            ReportingEventRecord(
                event_key=reporting_event_key(
                    record.instrument_key,
                    "EARNINGS",
                    YAHOO_SOURCE_PROVIDER,
                    event_date,
                ),
                instrument_key=record.instrument_key,
                event_type="EARNINGS",
                event_label="Publication de résultats",
                event_date=event_date,
                event_time_utc=event_time,
                status=status,
                fiscal_year=None,
                fiscal_period_end=None,
                period_kind=None,
                filing_date=None,
                match_confidence="UNKNOWN",
                source_provider=YAHOO_SOURCE_PROVIDER,
                source_url=(
                    f"https://finance.yahoo.com/quote/"
                    f"{record.provider_symbol}/calendar"
                ),
                metadata={
                    "eps_estimate": safe_float(row.get("EPS Estimate")),
                    "eps_actual": actual_eps,
                    "surprise_pct": safe_float(row.get("Surprise(%)")),
                },
            )
        )
    return events


def normalize_calendar_frame(
    records_by_symbol: Mapping[str, PublicationUniverseRecord],
    frame: Any,
    *,
    today: date,
) -> list[ReportingEventRecord]:
    if frame is None or getattr(frame, "empty", True):
        return []
    events: list[ReportingEventRecord] = []
    for raw_symbol, row in frame.iterrows():
        symbol = str(raw_symbol).strip().upper()
        record = records_by_symbol.get(symbol)
        if record is None:
            continue
        raw_time = row.get("Event Start Date")
        event_time = parse_datetime(raw_time)
        event_date = parse_date(raw_time)
        if event_date is None:
            continue
        label = clean_text(row.get("Event Name")) or "Publication de résultats"
        fiscal_year, period_kind = parse_event_period(label)
        actual_eps = safe_float(row.get("Reported EPS"))
        events.append(
            ReportingEventRecord(
                event_key=reporting_event_key(
                    record.instrument_key,
                    "EARNINGS",
                    YAHOO_SOURCE_PROVIDER,
                    event_date,
                    fiscal_year=fiscal_year,
                    period_kind=period_kind,
                ),
                instrument_key=record.instrument_key,
                event_type="EARNINGS",
                event_label=label,
                event_date=event_date,
                event_time_utc=event_time,
                status=_event_status(
                    event_date,
                    today,
                    actual_value=actual_eps,
                ),
                fiscal_year=fiscal_year,
                fiscal_period_end=None,
                period_kind=period_kind,
                filing_date=None,
                match_confidence="INFERRED" if period_kind else "UNKNOWN",
                source_provider=YAHOO_SOURCE_PROVIDER,
                source_url=(
                    f"https://finance.yahoo.com/quote/"
                    f"{record.provider_symbol}/calendar"
                ),
                metadata={
                    "timing": clean_text(row.get("Timing")),
                    "eps_estimate": safe_float(row.get("EPS Estimate")),
                    "eps_actual": actual_eps,
                    "surprise_pct": safe_float(row.get("Surprise(%)")),
                },
            )
        )
    return events


def merge_reporting_events(
    events: Iterable[ReportingEventRecord],
) -> list[ReportingEventRecord]:
    by_occurrence: dict[
        tuple[str, str, date, str],
        ReportingEventRecord,
    ] = {}
    for event in events:
        occurrence = (
            event.instrument_key,
            event.event_type,
            event.event_date,
            event.source_provider,
        )
        existing = by_occurrence.get(occurrence)
        if existing is None:
            by_occurrence[occurrence] = event
            continue
        metadata = {**existing.metadata, **event.metadata}
        event_has_slot = event.fiscal_year is not None and event.period_kind is not None
        existing_has_slot = (
            existing.fiscal_year is not None and existing.period_kind is not None
        )
        preferred = event if event_has_slot or not existing_has_slot else existing
        secondary = existing if preferred is event else event
        by_occurrence[occurrence] = replace(
            preferred,
            event_time_utc=preferred.event_time_utc or secondary.event_time_utc,
            fiscal_year=preferred.fiscal_year or secondary.fiscal_year,
            fiscal_period_end=(
                preferred.fiscal_period_end or secondary.fiscal_period_end
            ),
            period_kind=preferred.period_kind or secondary.period_kind,
            match_confidence=(
                preferred.match_confidence
                if preferred.match_confidence != "UNKNOWN"
                else secondary.match_confidence
            ),
            metadata=metadata,
        )
    return sorted(
        by_occurrence.values(),
        key=lambda item: (item.event_date, item.event_key),
    )


def match_events_to_periods(
    events: Sequence[ReportingEventRecord],
    financials: Sequence[InterimFinancialRecord],
    annual_periods: Sequence[tuple[int, date]],
) -> list[ReportingEventRecord]:
    candidates: list[tuple[date, int, str]] = [
        (row.fiscal_period_end, row.fiscal_year, row.period_kind)
        for row in financials
    ]
    candidates.extend((period_end, fiscal_year, "FY") for fiscal_year, period_end in annual_periods)
    candidates.sort(reverse=True)
    used_periods: set[date] = set()
    matched: list[ReportingEventRecord] = []
    for event in sorted(events, key=lambda item: item.event_date):
        if event.fiscal_period_end is not None or event.status != "REPORTED":
            matched.append(event)
            continue
        available = [
            candidate
            for candidate in candidates
            if candidate[0] not in used_periods
            and candidate[0] <= event.event_date
            and 0 <= (event.event_date - candidate[0]).days <= 180
        ]
        if not available:
            matched.append(event)
            continue
        period_end, fiscal_year, period_kind = max(available)
        used_periods.add(period_end)
        matched.append(
            replace(
                event,
                event_key=reporting_event_key(
                    event.instrument_key,
                    event.event_type,
                    event.source_provider,
                    event.event_date,
                    fiscal_year=fiscal_year,
                    period_kind=period_kind,
                ),
                fiscal_year=fiscal_year,
                fiscal_period_end=period_end,
                period_kind=period_kind,
                match_confidence="INFERRED",
            )
        )
    return merge_reporting_events(matched)


def build_ttm_summary(
    financials: Sequence[InterimFinancialRecord],
) -> dict[str, Any] | None:
    quarterly = sorted(
        (row for row in financials if row.period_months == 3),
        key=lambda row: row.fiscal_period_end,
        reverse=True,
    )[:4]
    if len(quarterly) != 4:
        return None
    span_days = (quarterly[0].fiscal_period_end - quarterly[-1].fiscal_period_end).days
    currencies = {row.currency for row in quarterly if row.currency}
    if not 240 <= span_days <= 400 or len(currencies) != 1:
        return None

    def total(field: str) -> float | None:
        values = [getattr(row, field) for row in quarterly]
        if any(value is None for value in values):
            return None
        return sum(value for value in values if value is not None)

    return {
        "currency": next(iter(currencies)),
        "period_end": quarterly[0].fiscal_period_end.isoformat(),
        "revenue": total("revenue"),
        "ebitda": total("ebitda"),
        "operating_income": total("operating_income"),
        "net_income": total("net_income"),
        "free_cash_flow": total("free_cash_flow"),
    }


def _quarterly_frame(ticker: Any, attribute: str, method_name: str) -> Any | None:
    try:
        frame = getattr(ticker, attribute, None)
    except Exception:
        frame = None
    if frame is None or getattr(frame, "empty", True):
        try:
            frame = getattr(ticker, method_name)(freq="quarterly")
        except Exception:
            frame = None
    return None if frame is None or getattr(frame, "empty", True) else frame


class YahooReportingProvider:
    def __init__(
        self,
        *,
        max_periods: int = 8,
        earnings_history_limit: int = 16,
        sleep_seconds: float = 0.1,
    ) -> None:
        self.max_periods = max_periods
        self.earnings_history_limit = earnings_history_limit
        self.sleep_seconds = sleep_seconds

    @staticmethod
    def _yfinance() -> Any:
        try:
            import yfinance as yf
        except ImportError as exc:
            raise RuntimeError("equity publications require yfinance") from exc
        return yf

    def fetch_symbol(
        self,
        record: PublicationUniverseRecord,
        *,
        today: date,
    ) -> SymbolReportingResult:
        yf = self._yfinance()
        ticker = yf.Ticker(record.provider_symbol)
        income = _quarterly_frame(
            ticker,
            "quarterly_income_stmt",
            "get_income_stmt",
        )
        cashflow = _quarterly_frame(
            ticker,
            "quarterly_cashflow",
            "get_cash_flow",
        )
        financials = normalize_interim_financials(
            record,
            income,
            cashflow,
            max_periods=self.max_periods,
        )
        reason_codes: list[str] = []
        if not financials:
            reason_codes.append("INTERIM_UNAVAILABLE")

        earnings_frame = None
        try:
            earnings_frame = ticker.get_earnings_dates(
                limit=self.earnings_history_limit,
            )
        except Exception:
            reason_codes.append("EARNINGS_HISTORY_UNAVAILABLE")
        events = normalize_earnings_frame(record, earnings_frame, today=today)
        if not events:
            reason_codes.append("CALENDAR_UNAVAILABLE")
        events = match_events_to_periods(
            events,
            financials,
            record.annual_periods,
        )
        return SymbolReportingResult(
            financials=tuple(financials),
            events=tuple(events),
            reason_codes=tuple(dict.fromkeys(reason_codes)),
        )

    def fetch_global_calendar(
        self,
        records: Sequence[PublicationUniverseRecord],
        *,
        start: date,
        end: date,
        today: date,
        page_size: int = 100,
        max_rows: int = 5000,
    ) -> list[ReportingEventRecord]:
        yf = self._yfinance()
        records_by_symbol = {
            record.provider_symbol.upper(): record for record in records
        }
        calendar = yf.Calendars(start=start, end=end)
        events: list[ReportingEventRecord] = []
        for offset in range(0, max_rows, page_size):
            frame = calendar.get_earnings_calendar(
                filter_most_active=False,
                start=start,
                end=end,
                limit=page_size,
                offset=offset,
                force=offset > 0,
            )
            if frame is None or getattr(frame, "empty", True):
                break
            events.extend(
                normalize_calendar_frame(
                    records_by_symbol,
                    frame,
                    today=today,
                )
            )
            if len(frame.index) < page_size:
                break
        return merge_reporting_events(events)


def normalize_sec_submissions(
    record: PublicationUniverseRecord,
    payload: Mapping[str, Any],
) -> list[ReportingEventRecord]:
    recent = payload.get("filings", {}).get("recent", {})
    if not isinstance(recent, Mapping):
        return []
    forms = list(recent.get("form", []))
    filing_dates = list(recent.get("filingDate", []))
    report_dates = list(recent.get("reportDate", []))
    accessions = list(recent.get("accessionNumber", []))
    primary_documents = list(recent.get("primaryDocument", []))
    cik = str(payload.get("cik") or "").zfill(10)
    events: list[ReportingEventRecord] = []
    for index, form in enumerate(forms):
        if form not in {"10-Q", "10-K"}:
            continue
        filing_date = parse_date(filing_dates[index] if index < len(filing_dates) else None)
        report_date = parse_date(report_dates[index] if index < len(report_dates) else None)
        if filing_date is None:
            continue
        accession = clean_text(accessions[index] if index < len(accessions) else None)
        document = clean_text(
            primary_documents[index] if index < len(primary_documents) else None
        )
        compact_accession = (accession or "").replace("-", "")
        source_url = None
        if cik and compact_accession and document:
            source_url = (
                "https://www.sec.gov/Archives/edgar/data/"
                f"{int(cik)}/{compact_accession}/{document}"
            )
        period_kind = "FY" if form == "10-K" else None
        fiscal_year = report_date.year if report_date else filing_date.year
        events.append(
            ReportingEventRecord(
                event_key=reporting_event_key(
                    record.instrument_key,
                    "REGULATORY_FILING",
                    SEC_SOURCE_PROVIDER,
                    filing_date,
                    fiscal_year=fiscal_year,
                    period_kind=period_kind or form,
                ),
                instrument_key=record.instrument_key,
                event_type="REGULATORY_FILING",
                event_label=f"Dépôt {form}",
                event_date=filing_date,
                event_time_utc=None,
                status="REPORTED",
                fiscal_year=fiscal_year,
                fiscal_period_end=report_date,
                period_kind=period_kind,
                filing_date=filing_date,
                match_confidence="HIGH" if report_date else "UNKNOWN",
                source_provider=SEC_SOURCE_PROVIDER,
                source_url=source_url,
                metadata={"form": form, "accession_number": accession},
            )
        )
    return events


class SecEdgarProvider:
    company_tickers_url = "https://www.sec.gov/files/company_tickers.json"

    def __init__(
        self,
        user_agent: str,
        *,
        request_timeout_sec: float = 30.0,
        sleep_seconds: float = 0.12,
    ) -> None:
        if not user_agent.strip():
            raise ValueError("SEC user agent is required")
        self.headers = {
            "User-Agent": user_agent,
            "Accept-Encoding": "gzip, deflate",
        }
        self.request_timeout_sec = request_timeout_sec
        self.sleep_seconds = sleep_seconds

    def _get_json(self, url: str) -> Mapping[str, Any]:
        import requests

        response = requests.get(
            url,
            headers=self.headers,
            timeout=self.request_timeout_sec,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, Mapping):
            raise RuntimeError(f"Unexpected SEC response from {url}")
        return payload

    def ticker_cik_map(self) -> dict[str, str]:
        payload = self._get_json(self.company_tickers_url)
        mapping: dict[str, str] = {}
        for row in payload.values():
            if not isinstance(row, Mapping):
                continue
            ticker = clean_text(row.get("ticker"))
            cik = clean_text(row.get("cik_str"))
            if ticker and cik:
                mapping[ticker.upper()] = cik.zfill(10)
        return mapping

    def fetch_events(
        self,
        records: Sequence[PublicationUniverseRecord],
    ) -> tuple[list[ReportingEventRecord], dict[str, str]]:
        cik_by_ticker = self.ticker_cik_map()
        events: list[ReportingEventRecord] = []
        errors: dict[str, str] = {}
        us_records = [record for record in records if record.source_index == "S&P 500"]
        for index, record in enumerate(us_records):
            ticker = record.provider_symbol.upper().replace("-", ".")
            cik = cik_by_ticker.get(ticker) or cik_by_ticker.get(
                record.ticker.upper().replace("-", ".")
            )
            if not cik:
                errors[record.instrument_key] = "SEC_CIK_UNAVAILABLE"
                continue
            try:
                payload = self._get_json(
                    f"https://data.sec.gov/submissions/CIK{cik}.json"
                )
                events.extend(normalize_sec_submissions(record, payload))
            except Exception as exc:
                errors[record.instrument_key] = str(exc)
            if self.sleep_seconds > 0 and index < len(us_records) - 1:
                time.sleep(self.sleep_seconds)
        return events, errors


def read_event_overrides(
    path: str | Path,
    records: Sequence[PublicationUniverseRecord],
) -> list[ReportingEventRecord]:
    records_by_key = {record.instrument_key: record for record in records}
    records_by_symbol = {
        record.provider_symbol.upper(): record for record in records
    }
    events: list[ReportingEventRecord] = []
    with Path(path).open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            record = records_by_key.get(clean_text(row.get("instrument_key")) or "")
            if record is None:
                symbol = (clean_text(row.get("provider_symbol")) or "").upper()
                record = records_by_symbol.get(symbol)
            event_date = parse_date(row.get("event_date"))
            if record is None or event_date is None:
                continue
            event_type = (clean_text(row.get("event_type")) or "EARNINGS").upper()
            status = (clean_text(row.get("status")) or "CONFIRMED").upper()
            period_kind = (clean_text(row.get("period_kind")) or "").upper() or None
            fiscal_year_raw = clean_text(row.get("fiscal_year"))
            fiscal_year = int(fiscal_year_raw) if fiscal_year_raw and fiscal_year_raw.isdigit() else None
            if event_type not in EVENT_TYPES or status not in EVENT_STATUSES:
                continue
            if period_kind not in EVENT_PERIOD_KINDS:
                period_kind = None
            source_provider = clean_text(row.get("source_provider")) or "manual_official"
            events.append(
                ReportingEventRecord(
                    event_key=reporting_event_key(
                        record.instrument_key,
                        event_type,
                        source_provider,
                        event_date,
                        fiscal_year=fiscal_year,
                        period_kind=period_kind,
                    ),
                    instrument_key=record.instrument_key,
                    event_type=event_type,
                    event_label=clean_text(row.get("event_label")),
                    event_date=event_date,
                    event_time_utc=parse_datetime(row.get("event_time_utc")),
                    status=status,
                    fiscal_year=fiscal_year,
                    fiscal_period_end=parse_date(row.get("fiscal_period_end")),
                    period_kind=period_kind,
                    filing_date=parse_date(row.get("filing_date")),
                    match_confidence="HIGH",
                    source_provider=source_provider,
                    source_url=clean_text(row.get("source_url")),
                    metadata={"override": True},
                )
            )
    return events


def _fetch_paginated(
    query_factory: Any,
    *,
    page_size: int = 1000,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for offset in range(0, 100_000, page_size):
        response = query_factory().range(offset, offset + page_size - 1).execute()
        page = list(response.data or [])
        rows.extend(page)
        if len(page) < page_size:
            break
    return rows


def normalize_index_keys(indexes: Sequence[str]) -> tuple[str, ...]:
    keys: list[str] = []
    for value in indexes:
        normalized = value.strip()
        key = INDEX_KEY_BY_NAME.get(normalized, normalized.lower())
        if key not in INDEX_NAME_BY_KEY:
            raise ValueError(f"Unsupported publication index: {value}")
        if key not in keys:
            keys.append(key)
    return tuple(keys)


def refresh_index_memberships(
    supabase: Any,
    *,
    indexes: Sequence[str] = TARGET_INDEXES,
    dry_run: bool = False,
) -> list[dict[str, Any]]:
    from trident_screener import GlobalYahooDataProvider

    index_keys = normalize_index_keys(indexes)
    provider = GlobalYahooDataProvider(
        indexes=index_keys,
        include_curated_it_services=False,
        sleep_seconds=0,
    )
    universe = provider.fetch_universe()
    now_iso = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "index_key": INDEX_KEY_BY_NAME[record.source_index or ""],
            "index_name": record.source_index,
            "instrument_key": record.instrument_key,
            "provider_symbol": record.provider_symbol,
            "is_active": True,
            "source_provider": record.provider,
            "source_url": INDEX_SOURCE_URLS[
                INDEX_KEY_BY_NAME[record.source_index or ""]
            ],
            "as_of_date": date.today().isoformat(),
            "updated_at": now_iso,
        }
        for record in universe
        if record.source_index in INDEX_KEY_BY_NAME
    ]
    existing_keys: set[str] = set()
    requested_keys = [row["instrument_key"] for row in rows]
    for start in range(0, len(requested_keys), 200):
        keys = requested_keys[start : start + 200]
        response = (
            supabase.table("trident_equity_universe")
            .select("instrument_key")
            .in_("instrument_key", keys)
            .execute()
        )
        existing_keys.update(
            item["instrument_key"] for item in (response.data or [])
        )
    rows = [row for row in rows if row["instrument_key"] in existing_keys]
    if dry_run:
        return rows
    (
        supabase.table("equity_index_memberships")
        .update({"is_active": False, "updated_at": now_iso})
        .in_("index_key", list(index_keys))
        .execute()
    )
    upsert_rows(
        supabase,
        "equity_index_memberships",
        rows,
        on_conflict="index_key,instrument_key",
    )
    return rows


def fetch_universe(
    supabase: Any,
    *,
    indexes: Sequence[str] = TARGET_INDEXES,
    symbols: Sequence[str] = (),
    limit: int | None = None,
) -> list[PublicationUniverseRecord]:
    index_keys = normalize_index_keys(indexes)

    def membership_query() -> Any:
        query = (
            supabase.table("equity_index_memberships")
            .select("index_key,index_name,instrument_key,provider_symbol")
            .eq("is_active", True)
            .in_("index_key", list(index_keys))
            .order("index_name")
            .order("provider_symbol")
        )
        if symbols:
            query = query.in_(
                "provider_symbol",
                [symbol.upper() for symbol in symbols],
            )
        return query

    membership_rows = _fetch_paginated(membership_query)
    if limit is not None:
        membership_rows = membership_rows[: max(0, limit)]
    instrument_keys = list(
        dict.fromkeys(row["instrument_key"] for row in membership_rows)
    )
    universe_rows: list[dict[str, Any]] = []
    for start in range(0, len(instrument_keys), 200):
        keys = instrument_keys[start : start + 200]
        if not keys:
            continue
        response = (
            supabase.table("trident_equity_universe")
            .select(
                "instrument_key,ticker,name,provider_symbol,currency,"
                "country,is_active"
            )
            .in_("instrument_key", keys)
            .eq("is_active", True)
            .execute()
        )
        universe_rows.extend(response.data or [])
    universe_by_key = {
        row["instrument_key"]: row for row in universe_rows
    }
    annual_rows: list[dict[str, Any]] = []
    for start in range(0, len(instrument_keys), 200):
        keys = instrument_keys[start : start + 200]
        if not keys:
            continue
        response = (
            supabase.table("trident_financial_annual")
            .select("instrument_key,fiscal_year,fiscal_period_end")
            .in_("instrument_key", keys)
            .order("fiscal_year", desc=True)
            .execute()
        )
        annual_rows.extend(response.data or [])

    annual_by_instrument: dict[str, list[tuple[int, date]]] = {}
    for row in annual_rows:
        period_end = parse_date(row.get("fiscal_period_end"))
        fiscal_year = row.get("fiscal_year")
        if period_end is None or not isinstance(fiscal_year, int):
            continue
        annual_by_instrument.setdefault(row["instrument_key"], []).append(
            (fiscal_year, period_end)
        )

    records: list[PublicationUniverseRecord] = []
    for membership in membership_rows:
        row = universe_by_key.get(membership["instrument_key"])
        if row is None:
            continue
        periods = sorted(
            annual_by_instrument.get(row["instrument_key"], []),
            reverse=True,
        )
        fiscal_year_end_month = periods[0][1].month if periods else 12
        records.append(
            PublicationUniverseRecord(
                instrument_key=row["instrument_key"],
                ticker=row["ticker"],
                name=row.get("name"),
                provider_symbol=row["provider_symbol"],
                source_index=membership["index_name"],
                currency=row.get("currency"),
                country=row.get("country"),
                fiscal_year_end_month=fiscal_year_end_month,
                annual_periods=tuple(periods[:5]),
            )
        )
    return records


def financial_payload(record: InterimFinancialRecord, now_iso: str) -> dict[str, Any]:
    payload = asdict(record)
    payload["fiscal_period_end"] = record.fiscal_period_end.isoformat()
    payload["reason_codes"] = list(record.reason_codes)
    payload["collected_at"] = now_iso
    payload["updated_at"] = now_iso
    return payload


def event_payload(record: ReportingEventRecord, now_iso: str) -> dict[str, Any]:
    payload = asdict(record)
    payload["event_date"] = record.event_date.isoformat()
    payload["event_time_utc"] = (
        record.event_time_utc.isoformat() if record.event_time_utc else None
    )
    payload["fiscal_period_end"] = (
        record.fiscal_period_end.isoformat()
        if record.fiscal_period_end
        else None
    )
    payload["filing_date"] = (
        record.filing_date.isoformat() if record.filing_date else None
    )
    payload["last_seen_at"] = now_iso
    payload["updated_at"] = now_iso
    return payload


def upsert_rows(
    supabase: Any,
    table: str,
    rows: Sequence[dict[str, Any]],
    *,
    on_conflict: str,
    batch_size: int = 200,
    dry_run: bool = False,
) -> int:
    if dry_run:
        return len(rows)
    for start in range(0, len(rows), batch_size):
        batch = list(rows[start : start + batch_size])
        if batch:
            (
                supabase.table(table)
                .upsert(batch, on_conflict=on_conflict)
                .execute()
            )
    return len(rows)


def _start_etl_run(supabase: Any, now_iso: str) -> str | None:
    try:
        response = (
            supabase.table("etl_runs")
            .insert(
                {
                    "job_name": JOB_NAME,
                    "status": "RUNNING",
                    "started_at": now_iso,
                    "updated_at": now_iso,
                }
            )
            .execute()
        )
        return response.data[0].get("id") if response.data else None
    except Exception as exc:
        print(f"Warning: unable to start etl_runs: {exc}", flush=True)
        return None


def _finish_etl_run(
    supabase: Any,
    run_id: str | None,
    *,
    status: str,
    stats: Mapping[str, Any] | None = None,
    error: str | None = None,
) -> None:
    if not run_id:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    payload: dict[str, Any] = {
        "status": status,
        "finished_at": now_iso,
        "updated_at": now_iso,
    }
    if stats is not None:
        payload["stats"] = dict(stats)
    if error:
        payload["error"] = error
    try:
        (
            supabase.table("etl_runs")
            .update(payload)
            .eq("id", run_id)
            .execute()
        )
    except Exception as exc:
        print(f"Warning: unable to finish etl_runs: {exc}", flush=True)


def run_equity_publications_sync(
    supabase: Any,
    *,
    mode: str = "daily",
    indexes: Sequence[str] = TARGET_INDEXES,
    symbols: Sequence[str] = (),
    limit: int | None = None,
    max_periods: int = 8,
    sleep_seconds: float = 0.1,
    event_overrides_csv: str | Path | None = None,
    sec_user_agent: str | None = None,
    dry_run: bool = False,
    today: date | None = None,
) -> dict[str, Any]:
    if mode not in {"daily", "full"}:
        raise ValueError("mode must be daily or full")
    current_date = today or date.today()
    now_iso = datetime.now(timezone.utc).isoformat()
    run_id = None if dry_run else _start_etl_run(supabase, now_iso)
    try:
        membership_rows: list[dict[str, Any]] = []
        if mode == "full":
            membership_rows = refresh_index_memberships(
                supabase,
                indexes=indexes,
                dry_run=dry_run,
            )
        universe = fetch_universe(
            supabase,
            indexes=indexes,
            symbols=symbols,
            limit=limit,
        )
        if not universe:
            raise RuntimeError("No CAC 40 or S&P 500 universe rows are available")

        provider = YahooReportingProvider(
            max_periods=max_periods,
            sleep_seconds=sleep_seconds,
        )
        calendar_start = current_date - timedelta(days=7)
        calendar_end = current_date + timedelta(days=90)
        global_events = provider.fetch_global_calendar(
            universe,
            start=calendar_start,
            end=calendar_end,
            today=current_date,
        )

        due_keys = {
            event.instrument_key
            for event in global_events
            if calendar_start <= event.event_date <= current_date
        }
        symbol_targets = (
            universe
            if mode == "full"
            else [record for record in universe if record.instrument_key in due_keys]
        )

        all_financials: list[InterimFinancialRecord] = []
        all_events: list[ReportingEventRecord] = list(global_events)
        symbol_errors: dict[str, str] = {}
        symbol_states: dict[str, list[str]] = {}
        for index, record in enumerate(symbol_targets):
            try:
                result = provider.fetch_symbol(record, today=current_date)
                all_financials.extend(result.financials)
                all_events.extend(result.events)
                if result.reason_codes:
                    symbol_states[record.instrument_key] = list(result.reason_codes)
            except Exception as exc:
                symbol_errors[record.instrument_key] = str(exc)
                print(
                    f"Warning: reporting data unavailable for "
                    f"{record.provider_symbol}: {exc}",
                    flush=True,
                )
            if sleep_seconds > 0 and index < len(symbol_targets) - 1:
                time.sleep(sleep_seconds)

        sec_errors: dict[str, str] = {}
        if mode == "full" and sec_user_agent:
            sec_events, sec_errors = SecEdgarProvider(
                sec_user_agent,
                sleep_seconds=max(sleep_seconds, 0.11),
            ).fetch_events(universe)
            all_events.extend(sec_events)

        if event_overrides_csv:
            all_events.extend(read_event_overrides(event_overrides_csv, universe))

        all_events = merge_reporting_events(all_events)
        financial_rows = [
            financial_payload(record, now_iso) for record in all_financials
        ]
        event_rows = [event_payload(record, now_iso) for record in all_events]
        financial_upserts = upsert_rows(
            supabase,
            "equity_financial_interim",
            financial_rows,
            on_conflict="instrument_key,fiscal_period_end,period_kind",
            dry_run=dry_run,
        )
        event_upserts = upsert_rows(
            supabase,
            "equity_reporting_events",
            event_rows,
            on_conflict="event_key",
            dry_run=dry_run,
        )

        financial_instruments = {
            record.instrument_key for record in all_financials
        }
        calendar_instruments = {record.instrument_key for record in all_events}
        complete_ttm = sum(
            build_ttm_summary(
                [
                    financial
                    for financial in all_financials
                    if financial.instrument_key == record.instrument_key
                ]
            )
            is not None
            for record in symbol_targets
        )
        success_keys = {
            record.instrument_key
            for record in universe
            if record.instrument_key in calendar_instruments
            or record.instrument_key in financial_instruments
        }
        coverage_pct = (
            (len(success_keys) / len(universe)) * 100 if universe else 0.0
        )
        stats = build_etl_stats(
            JOB_NAME,
            {
                "mode": mode,
                "indexes": list(indexes),
                "universe_count": len(universe),
                "membership_rows": len(membership_rows),
                "symbol_refresh_count": len(symbol_targets),
                "financial_rows": len(financial_rows),
                "financial_instruments": len(financial_instruments),
                "event_rows": len(event_rows),
                "calendar_instruments": len(calendar_instruments),
                "ttm_complete_instruments": complete_ttm,
                "symbol_states": symbol_states,
                "symbol_errors": symbol_errors,
                "sec_errors": sec_errors,
                "sec_state": (
                    "READY"
                    if mode == "full" and sec_user_agent and not sec_errors
                    else "PARTIAL"
                    if mode == "full" and sec_user_agent
                    else "NOT_CONFIGURED"
                ),
                "financial_upserts": financial_upserts,
                "event_upserts": event_upserts,
            },
            items_total=len(universe),
            items_success=len(success_keys),
            items_failed=max(len(universe) - len(success_keys), 0),
            coverage_pct=coverage_pct,
        )
        _finish_etl_run(
            supabase,
            run_id,
            status="SUCCESS",
            stats=stats,
        )
        return stats
    except Exception as exc:
        _finish_etl_run(
            supabase,
            run_id,
            status="FAILED",
            error=str(exc),
        )
        raise


def configured_event_overrides() -> str | None:
    path = os.environ.get("EQUITY_PUBLICATIONS_OVERRIDES_CSV")
    return path if path and Path(path).exists() else None
