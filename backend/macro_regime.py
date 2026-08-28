from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Callable, Iterable, Mapping


FRED_BASE_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
DEFAULT_CORE_WEIGHT_PCT = 70.0
DEFAULT_SATELLITE_WEIGHT_PCT = 30.0


@dataclass(frozen=True)
class SeriesDefinition:
    series_id: str
    name: str
    frequency: str
    stale_after_days: int
    source_provider: str = "FRED"

    @property
    def source_url(self) -> str:
        return f"https://fred.stlouisfed.org/series/{self.series_id}"


@dataclass(frozen=True)
class SeriesPoint:
    series_id: str
    name: str
    as_of_date: date
    value: float | None
    previous_value: float | None
    change_abs: float | None
    change_pct: float | None
    frequency: str
    source_provider: str
    source_url: str
    data_state: str
    reason_codes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class SignalAssessment:
    signal: str
    score: float | None
    confidence: int
    reason_codes: list[str]
    evidence: dict[str, Any]
    data_state: str


@dataclass(frozen=True)
class RegimeSnapshot:
    as_of_date: date
    regime: str
    regime_state: str
    confidence: int
    growth_signal: str
    inflation_signal: str
    liquidity_signal: str
    growth_score: float | None
    inflation_score: float | None
    liquidity_score: float | None
    evidence: dict[str, Any]
    reason_codes: list[str]


@dataclass(frozen=True)
class SatelliteTarget:
    as_of_date: date
    regime: str
    bucket_key: str
    bucket_label: str
    instrument_symbol: str | None
    instrument_name: str | None
    target_weight_pct: float
    effective_weight_pct: float
    satellite_weight_pct: float
    recommended_envelope: str
    trend_ticker: str | None
    trend_state: str
    ma200_status: str | None
    data_state: str
    is_blocked: bool
    reason_codes: list[str]


FRED_SERIES: tuple[SeriesDefinition, ...] = (
    SeriesDefinition("CPIAUCSL", "Headline CPI", "MONTHLY", 75),
    SeriesDefinition("CPILFESL", "Core CPI", "MONTHLY", 75),
    SeriesDefinition("PAYEMS", "US Nonfarm Payrolls", "MONTHLY", 75),
    SeriesDefinition("UNRATE", "US Unemployment Rate", "MONTHLY", 75),
    SeriesDefinition("T10Y2Y", "US 10Y-2Y Treasury Spread", "DAILY", 10),
    SeriesDefinition("T10YIE", "US 10Y Breakeven Inflation", "DAILY", 10),
    SeriesDefinition("BAMLH0A0HYM2", "US High Yield OAS", "DAILY", 10),
)

TARGETS_BY_REGIME: dict[str, tuple[dict[str, Any], ...]] = {
    "REFLATION": (
        {
            "bucket_key": "copper",
            "bucket_label": "Copper",
            "instrument_symbol": "CPER",
            "instrument_name": "Copper exposure proxy",
            "target_weight_pct": 10.0,
            "trend_ticker": "CPER",
        },
        {
            "bucket_key": "energy",
            "bucket_label": "Energy",
            "instrument_symbol": "XLE",
            "instrument_name": "Energy equities proxy",
            "target_weight_pct": 10.0,
            "trend_ticker": "XLE",
        },
        {
            "bucket_key": "emerging_equities",
            "bucket_label": "Emerging equities",
            "instrument_symbol": "EEM",
            "instrument_name": "Emerging markets proxy",
            "target_weight_pct": 10.0,
            "trend_ticker": "EEM",
        },
    ),
    "GOLDILOCKS": (
        {
            "bucket_key": "technology",
            "bucket_label": "Technology equities",
            "instrument_symbol": "QQQ",
            "instrument_name": "Technology growth proxy",
            "target_weight_pct": 18.0,
            "trend_ticker": "QQQ",
        },
        {
            "bucket_key": "high_yield",
            "bucket_label": "High yield credit",
            "instrument_symbol": "HYG",
            "instrument_name": "High yield bond proxy",
            "target_weight_pct": 12.0,
            "trend_ticker": "HYG",
        },
    ),
    "STAGFLATION": (
        {
            "bucket_key": "gold",
            "bucket_label": "Physical gold",
            "instrument_symbol": "GLD",
            "instrument_name": "Gold proxy",
            "target_weight_pct": 12.0,
            "trend_ticker": "GLD",
        },
        {
            "bucket_key": "commodities",
            "bucket_label": "Broad commodities",
            "instrument_symbol": "DBC",
            "instrument_name": "Broad commodity proxy",
            "target_weight_pct": 10.0,
            "trend_ticker": "DBC",
        },
        {
            "bucket_key": "cash",
            "bucket_label": "Cash buffer",
            "instrument_symbol": "CASH",
            "instrument_name": "Liquidity reserve",
            "target_weight_pct": 8.0,
            "trend_ticker": None,
        },
    ),
    "DEFLATION": (
        {
            "bucket_key": "long_treasury",
            "bucket_label": "Long US Treasuries",
            "instrument_symbol": "TLT",
            "instrument_name": "20Y+ US Treasury proxy",
            "target_weight_pct": 20.0,
            "trend_ticker": "TLT",
        },
        {
            "bucket_key": "cash",
            "bucket_label": "Cash buffer",
            "instrument_symbol": "CASH",
            "instrument_name": "Liquidity reserve",
            "target_weight_pct": 10.0,
            "trend_ticker": None,
        },
    ),
    "UNKNOWN": (
        {
            "bucket_key": "cash",
            "bucket_label": "Cash buffer",
            "instrument_symbol": "CASH",
            "instrument_name": "Liquidity reserve",
            "target_weight_pct": 30.0,
            "trend_ticker": None,
        },
    ),
}


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _clamp_confidence(value: float) -> int:
    return int(max(0, min(100, round(value))))


def _unique_codes(codes: Iterable[str | None]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for code in codes:
        if not code or code in seen:
            continue
        seen.add(code)
        result.append(code)
    return result


def fred_csv_url(series_id: str) -> str:
    return f"{FRED_BASE_URL}?id={series_id}"


def fetch_fred_series(
    series_id: str,
    *,
    http_get: Callable[..., Any] | None = None,
    timeout: int = 20,
) -> list[tuple[date, float]]:
    if http_get is None:
        import requests

        http_get = requests.get
    response = http_get(fred_csv_url(series_id), timeout=timeout)
    response.raise_for_status()
    reader = csv.DictReader(io.StringIO(response.text))
    rows: list[tuple[date, float]] = []
    for raw in reader:
        raw_date = raw.get("DATE")
        raw_value = raw.get(series_id)
        if not raw_date or raw_value in {None, "", "."}:
            continue
        value = _safe_float(raw_value)
        if value is None:
            continue
        try:
            parsed_date = date.fromisoformat(raw_date)
        except ValueError:
            continue
        rows.append((parsed_date, value))
    return sorted(rows, key=lambda item: item[0])


def build_latest_series_point(
    definition: SeriesDefinition,
    rows: list[tuple[date, float]],
    *,
    today: date | None = None,
    reason_codes: list[str] | None = None,
) -> SeriesPoint:
    as_of_today = today or _today_utc()
    codes = list(reason_codes or [])
    if not rows:
        return SeriesPoint(
            series_id=definition.series_id,
            name=definition.name,
            as_of_date=as_of_today,
            value=None,
            previous_value=None,
            change_abs=None,
            change_pct=None,
            frequency=definition.frequency,
            source_provider=definition.source_provider,
            source_url=definition.source_url,
            data_state="MISSING",
            reason_codes=_unique_codes([*codes, "series_missing"]),
        )

    latest_date, latest_value = rows[-1]
    previous_value = rows[-2][1] if len(rows) >= 2 else None
    change_abs = latest_value - previous_value if previous_value is not None else None
    change_pct = (
        (latest_value / previous_value) - 1
        if previous_value not in {None, 0}
        else None
    )
    age_days = (as_of_today - latest_date).days
    data_state = "STALE" if age_days > definition.stale_after_days else "READY"
    if data_state == "STALE":
        codes.append("series_stale")

    return SeriesPoint(
        series_id=definition.series_id,
        name=definition.name,
        as_of_date=latest_date,
        value=latest_value,
        previous_value=previous_value,
        change_abs=change_abs,
        change_pct=change_pct,
        frequency=definition.frequency,
        source_provider=definition.source_provider,
        source_url=definition.source_url,
        data_state=data_state,
        reason_codes=_unique_codes(codes),
    )


def _value_at_offset(rows: list[tuple[date, float]], offset: int) -> float | None:
    if len(rows) < abs(offset):
        return None
    try:
        return rows[offset][1]
    except IndexError:
        return None


def _yoy_at(rows: list[tuple[date, float]], latest_index: int) -> float | None:
    comparison_index = latest_index - 12
    if abs(latest_index) > len(rows) or abs(comparison_index) > len(rows):
        return None
    try:
        current = rows[latest_index][1]
        previous = rows[comparison_index][1]
    except IndexError:
        return None
    if previous == 0:
        return None
    return ((current / previous) - 1) * 100


def _latest(rows: list[tuple[date, float]]) -> float | None:
    return rows[-1][1] if rows else None


def assess_growth(series_history: Mapping[str, list[tuple[date, float]]]) -> SignalAssessment:
    reasons: list[str] = []
    evidence: dict[str, Any] = {}
    score = 0.0
    inputs = 0

    payems = series_history.get("PAYEMS", [])
    if len(payems) >= 4:
        payroll_3m_delta = payems[-1][1] - payems[-4][1]
        payroll_3m_avg = payroll_3m_delta / 3
        evidence["payroll_3m_avg_change_thousands"] = round(payroll_3m_avg, 2)
        inputs += 1
        if payroll_3m_avg >= 100:
            score += 1.0
            reasons.append("payroll_growth_positive")
        elif payroll_3m_avg <= 0:
            score -= 1.0
            reasons.append("payroll_growth_negative")
        else:
            score += 0.25
            reasons.append("payroll_growth_soft")
    else:
        reasons.append("payroll_history_missing")

    unrate = series_history.get("UNRATE", [])
    if len(unrate) >= 4:
        unrate_3m_delta = unrate[-1][1] - unrate[-4][1]
        evidence["unemployment_3m_delta_pct"] = round(unrate_3m_delta, 2)
        inputs += 1
        if unrate_3m_delta <= 0.1:
            score += 1.0
            reasons.append("unemployment_stable_or_improving")
        elif unrate_3m_delta >= 0.3:
            score -= 1.0
            reasons.append("unemployment_deteriorating")
        else:
            reasons.append("unemployment_mixed")
    else:
        reasons.append("unemployment_history_missing")

    pmi = series_history.get("PMI_MANUFACTURING", [])
    if len(pmi) >= 2:
        pmi_value = pmi[-1][1]
        pmi_change = pmi[-1][1] - pmi[-2][1]
        evidence["pmi_manufacturing"] = round(pmi_value, 2)
        evidence["pmi_manufacturing_change"] = round(pmi_change, 2)
        inputs += 2
        if pmi_value >= 50 and pmi_change >= 0:
            score += 2.0
            reasons.append("pmi_expansion_accelerating")
        elif pmi_value < 50 or pmi_change < 0:
            score -= 2.0
            reasons.append("pmi_contracting_or_decelerating")
    else:
        reasons.append("pmi_missing_growth_proxy")

    if inputs == 0:
        return SignalAssessment("UNKNOWN", None, 0, _unique_codes(reasons), evidence, "UNKNOWN")

    signal = "UP" if score >= 0 else "DOWN"
    confidence = 80
    if "pmi_missing_growth_proxy" in reasons:
        confidence -= 20
    if inputs < 2:
        confidence -= 20
    return SignalAssessment(signal, score, _clamp_confidence(confidence), _unique_codes(reasons), evidence, "PARTIAL" if "pmi_missing_growth_proxy" in reasons else "READY")


def assess_inflation(series_history: Mapping[str, list[tuple[date, float]]]) -> SignalAssessment:
    reasons: list[str] = []
    evidence: dict[str, Any] = {}
    score = 0.0

    core = series_history.get("CPILFESL", [])
    if len(core) < 16:
        return SignalAssessment("UNKNOWN", None, 0, ["core_cpi_history_missing"], evidence, "UNKNOWN")

    core_yoy = _yoy_at(core, -1)
    core_yoy_3m_ago = _yoy_at(core, -4)
    if core_yoy is None or core_yoy_3m_ago is None:
        return SignalAssessment("UNKNOWN", None, 0, ["core_cpi_yoy_unavailable"], evidence, "UNKNOWN")

    core_yoy_delta_3m = core_yoy - core_yoy_3m_ago
    evidence["core_cpi_yoy_pct"] = round(core_yoy, 2)
    evidence["core_cpi_yoy_3m_delta_pct"] = round(core_yoy_delta_3m, 2)
    if core_yoy_delta_3m >= 0.05:
        score += 1.0
        reasons.append("core_cpi_accelerating")
    elif core_yoy_delta_3m <= -0.05:
        score -= 1.0
        reasons.append("core_cpi_decelerating")
    else:
        reasons.append("core_cpi_flat")

    breakeven = _latest(series_history.get("T10YIE", []))
    if breakeven is not None:
        gap = core_yoy - breakeven
        evidence["core_vs_10y_breakeven_gap_pct"] = round(gap, 2)
        if gap >= 0.75:
            score += 1.0
            reasons.append("core_above_market_inflation_expectations")
        elif gap <= 0.25:
            score -= 1.0
            reasons.append("core_near_or_below_market_inflation_expectations")
        else:
            reasons.append("core_expectation_gap_mixed")
    else:
        reasons.append("breakeven_missing")

    headline = series_history.get("CPIAUCSL", [])
    headline_yoy = _yoy_at(headline, -1) if len(headline) >= 13 else None
    if headline_yoy is not None:
        evidence["headline_cpi_yoy_pct"] = round(headline_yoy, 2)
    else:
        reasons.append("headline_cpi_yoy_missing")

    signal = "UP" if score > 0 else "DOWN"
    confidence = 80
    if "breakeven_missing" in reasons:
        confidence -= 15
    if "headline_cpi_yoy_missing" in reasons:
        confidence -= 5
    return SignalAssessment(signal, score, _clamp_confidence(confidence), _unique_codes(reasons), evidence, "READY" if confidence >= 70 else "PARTIAL")


def assess_liquidity(series_history: Mapping[str, list[tuple[date, float]]]) -> SignalAssessment:
    reasons: list[str] = []
    evidence: dict[str, Any] = {}
    curve = _latest(series_history.get("T10Y2Y", []))
    high_yield_oas = _latest(series_history.get("BAMLH0A0HYM2", []))

    if curve is None and high_yield_oas is None:
        return SignalAssessment("UNKNOWN", None, 0, ["liquidity_series_missing"], evidence, "UNKNOWN")

    score = 0.0
    if curve is not None:
        evidence["t10y2y_pct"] = round(curve, 2)
        if curve < 0:
            score -= 1.0
            reasons.append("yield_curve_inverted")
        elif curve >= 0.5:
            score += 1.0
            reasons.append("yield_curve_positive")
        else:
            reasons.append("yield_curve_flat")
    else:
        reasons.append("yield_curve_missing")

    if high_yield_oas is not None:
        evidence["high_yield_oas_pct"] = round(high_yield_oas, 2)
        if high_yield_oas >= 4.5:
            score -= 1.0
            reasons.append("credit_spreads_wide")
        elif high_yield_oas < 3.5:
            score += 1.0
            reasons.append("credit_spreads_contained")
        else:
            reasons.append("credit_spreads_neutral")
    else:
        reasons.append("credit_spreads_missing")

    if score <= -1:
        signal = "TIGHT"
    elif score >= 1:
        signal = "LOOSE"
    else:
        signal = "NEUTRAL"

    confidence = 75
    if "yield_curve_missing" in reasons:
        confidence -= 15
    if "credit_spreads_missing" in reasons:
        confidence -= 15
    return SignalAssessment(signal, score, _clamp_confidence(confidence), _unique_codes(reasons), evidence, "READY" if confidence >= 65 else "PARTIAL")


def classify_regime(
    series_history: Mapping[str, list[tuple[date, float]]],
    *,
    as_of_date: date | None = None,
) -> RegimeSnapshot:
    growth = assess_growth(series_history)
    inflation = assess_inflation(series_history)
    liquidity = assess_liquidity(series_history)

    if growth.signal == "UNKNOWN" or inflation.signal == "UNKNOWN":
        regime = "UNKNOWN"
        regime_state = "UNKNOWN"
    elif growth.signal == "UP" and inflation.signal == "UP":
        regime = "REFLATION"
        regime_state = "READY"
    elif growth.signal == "UP" and inflation.signal == "DOWN":
        regime = "GOLDILOCKS"
        regime_state = "READY"
    elif growth.signal == "DOWN" and inflation.signal == "UP":
        regime = "STAGFLATION"
        regime_state = "READY"
    else:
        regime = "DEFLATION"
        regime_state = "READY"

    reasons = _unique_codes([
        *[f"growth:{code}" for code in growth.reason_codes],
        *[f"inflation:{code}" for code in inflation.reason_codes],
        *[f"liquidity:{code}" for code in liquidity.reason_codes],
    ])
    if regime != "UNKNOWN" and (growth.data_state == "PARTIAL" or inflation.data_state == "PARTIAL"):
        regime_state = "PARTIAL"
        reasons.append("regime_partial_inputs")

    confidence = min(growth.confidence, inflation.confidence)
    if liquidity.signal == "TIGHT":
        confidence -= 15
        reasons.append("liquidity_risk_cap")
    elif liquidity.signal == "UNKNOWN":
        confidence -= 10
    elif liquidity.signal == "NEUTRAL":
        confidence -= 5
    if regime == "UNKNOWN":
        confidence = 0

    evidence = {
        "growth": growth.evidence,
        "inflation": inflation.evidence,
        "liquidity": liquidity.evidence,
        "weights": {
            "core_pct": DEFAULT_CORE_WEIGHT_PCT,
            "satellite_pct": DEFAULT_SATELLITE_WEIGHT_PCT,
        },
    }
    return RegimeSnapshot(
        as_of_date=as_of_date or _today_utc(),
        regime=regime,
        regime_state=regime_state,
        confidence=_clamp_confidence(confidence),
        growth_signal=growth.signal,
        inflation_signal=inflation.signal,
        liquidity_signal=liquidity.signal,
        growth_score=growth.score,
        inflation_score=inflation.score,
        liquidity_score=liquidity.score,
        evidence=evidence,
        reason_codes=_unique_codes(reasons),
    )


def _normalize_market_trends(rows: Iterable[Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    trends: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        ticker = str(row.get("ticker") or "").strip().upper()
        if ticker:
            trends[ticker] = row
    return trends


def build_satellite_targets(
    snapshot: RegimeSnapshot,
    market_trend_rows: Iterable[Mapping[str, Any]],
    *,
    satellite_weight_pct: float = DEFAULT_SATELLITE_WEIGHT_PCT,
) -> list[SatelliteTarget]:
    trend_by_ticker = _normalize_market_trends(market_trend_rows)
    raw_targets = list(TARGETS_BY_REGIME.get(snapshot.regime, TARGETS_BY_REGIME["UNKNOWN"]))
    targets: list[SatelliteTarget] = []
    blocked_weight = 0.0

    for raw in raw_targets:
        target_weight = float(raw["target_weight_pct"])
        trend_ticker = raw.get("trend_ticker")
        reasons: list[str] = []
        state = "READY"
        trend_state = "NOT_APPLICABLE"
        ma200_status = None
        is_blocked = False
        effective_weight = target_weight

        if snapshot.regime_state == "UNKNOWN" or snapshot.regime == "UNKNOWN":
            state = "REGIME_UNKNOWN"
            reasons.append("regime_unknown")
        elif snapshot.regime_state == "PARTIAL":
            state = "REGIME_PARTIAL"
            reasons.append("regime_partial_inputs")

        if trend_ticker and state != "REGIME_UNKNOWN":
            trend_row = trend_by_ticker.get(str(trend_ticker).upper())
            if not trend_row:
                state = "TREND_UNKNOWN"
                trend_state = "UNKNOWN"
                reasons.append("trend_row_missing")
            else:
                raw_trend = str(trend_row.get("trend_state") or "UNKNOWN").strip().upper()
                if raw_trend in {"BULLISH", "BEARISH", "NEUTRAL", "UNKNOWN", "INSUFFICIENT_HISTORY"}:
                    trend_state = raw_trend
                else:
                    trend_state = "UNKNOWN"
                raw_ma200 = trend_row.get("ma200_status")
                ma200_status = raw_ma200 if raw_ma200 in {"above", "below"} else None
                if ma200_status == "below":
                    state = "BLOCKED_TREND"
                    is_blocked = True
                    effective_weight = 0.0
                    blocked_weight += target_weight
                    reasons.append("trend_below_ma200")
                elif ma200_status != "above":
                    state = "TREND_UNKNOWN"
                    reasons.append("ma200_unknown")

        targets.append(
            SatelliteTarget(
                as_of_date=snapshot.as_of_date,
                regime=snapshot.regime,
                bucket_key=str(raw["bucket_key"]),
                bucket_label=str(raw["bucket_label"]),
                instrument_symbol=raw.get("instrument_symbol"),
                instrument_name=raw.get("instrument_name"),
                target_weight_pct=target_weight,
                effective_weight_pct=effective_weight,
                satellite_weight_pct=satellite_weight_pct,
                recommended_envelope="CASH" if raw["bucket_key"] == "cash" else "CTO",
                trend_ticker=trend_ticker,
                trend_state=trend_state,
                ma200_status=ma200_status,
                data_state=state,
                is_blocked=is_blocked,
                reason_codes=_unique_codes(reasons),
            )
        )

    if blocked_weight > 0:
        cash_index = next((index for index, target in enumerate(targets) if target.bucket_key == "cash"), None)
        if cash_index is None:
            targets.append(
                SatelliteTarget(
                    as_of_date=snapshot.as_of_date,
                    regime=snapshot.regime,
                    bucket_key="cash",
                    bucket_label="Cash buffer",
                    instrument_symbol="CASH",
                    instrument_name="Liquidity reserve",
                    target_weight_pct=0.0,
                    effective_weight_pct=blocked_weight,
                    satellite_weight_pct=satellite_weight_pct,
                    recommended_envelope="CASH",
                    trend_ticker=None,
                    trend_state="NOT_APPLICABLE",
                    ma200_status=None,
                    data_state="READY" if snapshot.regime_state != "UNKNOWN" else "REGIME_UNKNOWN",
                    is_blocked=False,
                    reason_codes=["trend_block_reallocation"],
                )
            )
        else:
            cash = targets[cash_index]
            targets[cash_index] = SatelliteTarget(
                **{
                    **cash.__dict__,
                    "effective_weight_pct": cash.effective_weight_pct + blocked_weight,
                    "reason_codes": _unique_codes([*cash.reason_codes, "trend_block_reallocation"]),
                }
            )

    return targets


def series_point_payload(point: SeriesPoint, *, now: datetime | None = None) -> dict[str, Any]:
    timestamp = (now or datetime.now(timezone.utc)).isoformat()
    return {
        "series_id": point.series_id,
        "as_of_date": point.as_of_date.isoformat(),
        "name": point.name,
        "value": point.value,
        "previous_value": point.previous_value,
        "change_abs": point.change_abs,
        "change_pct": point.change_pct,
        "frequency": point.frequency,
        "source_provider": point.source_provider,
        "source_url": point.source_url,
        "data_state": point.data_state,
        "reason_codes": point.reason_codes,
        "collected_at": timestamp,
        "updated_at": timestamp,
    }


def regime_snapshot_payload(snapshot: RegimeSnapshot, *, now: datetime | None = None) -> dict[str, Any]:
    timestamp = (now or datetime.now(timezone.utc)).isoformat()
    return {
        "as_of_date": snapshot.as_of_date.isoformat(),
        "regime": snapshot.regime,
        "regime_state": snapshot.regime_state,
        "confidence": snapshot.confidence,
        "growth_signal": snapshot.growth_signal,
        "inflation_signal": snapshot.inflation_signal,
        "liquidity_signal": snapshot.liquidity_signal,
        "growth_score": snapshot.growth_score,
        "inflation_score": snapshot.inflation_score,
        "liquidity_score": snapshot.liquidity_score,
        "evidence": snapshot.evidence,
        "reason_codes": snapshot.reason_codes,
        "updated_at": timestamp,
    }


def satellite_target_payload(
    target: SatelliteTarget,
    *,
    snapshot_id: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    timestamp = (now or datetime.now(timezone.utc)).isoformat()
    return {
        "snapshot_id": snapshot_id,
        "as_of_date": target.as_of_date.isoformat(),
        "regime": target.regime,
        "bucket_key": target.bucket_key,
        "bucket_label": target.bucket_label,
        "instrument_symbol": target.instrument_symbol,
        "instrument_name": target.instrument_name,
        "target_weight_pct": target.target_weight_pct,
        "effective_weight_pct": target.effective_weight_pct,
        "satellite_weight_pct": target.satellite_weight_pct,
        "recommended_envelope": target.recommended_envelope,
        "trend_ticker": target.trend_ticker,
        "trend_state": target.trend_state,
        "ma200_status": target.ma200_status,
        "data_state": target.data_state,
        "is_blocked": target.is_blocked,
        "reason_codes": target.reason_codes,
        "updated_at": timestamp,
    }


def fetch_market_trend_rows(supabase) -> list[dict[str, Any]]:
    try:
        response = (
            supabase
            .table("market_watch")
            .select("ticker,ma200_status,trend_state,last_update,data_status")
            .execute()
        )
    except Exception as exc:
        print(f"Warning: market_watch trend rows unavailable: {exc}", flush=True)
        return []
    return list(response.data or [])


def run_macro_regime_sync(
    supabase,
    *,
    today: date | None = None,
    http_get: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    run_date = today or _today_utc()
    histories: dict[str, list[tuple[date, float]]] = {}
    points: list[SeriesPoint] = []

    for definition in FRED_SERIES:
        reason_codes: list[str] = []
        try:
            rows = fetch_fred_series(definition.series_id, http_get=http_get)
        except Exception as exc:
            print(f"Warning: FRED fetch failed for {definition.series_id}: {exc}", flush=True)
            rows = []
            reason_codes.append("fetch_failed")
        histories[definition.series_id] = rows
        points.append(
            build_latest_series_point(
                definition,
                rows,
                today=run_date,
                reason_codes=reason_codes,
            )
        )

    point_payloads = [series_point_payload(point) for point in points]
    if point_payloads:
        supabase.table("macro_series_points").upsert(
            point_payloads,
            on_conflict="series_id,as_of_date",
        ).execute()

    snapshot = classify_regime(histories, as_of_date=run_date)
    snapshot_response = (
        supabase
        .table("macro_regime_snapshots")
        .upsert(regime_snapshot_payload(snapshot), on_conflict="as_of_date")
        .execute()
    )
    snapshot_rows = snapshot_response.data or []
    snapshot_id = snapshot_rows[0].get("id") if snapshot_rows else None
    if not snapshot_id:
        lookup = (
            supabase
            .table("macro_regime_snapshots")
            .select("id")
            .eq("as_of_date", snapshot.as_of_date.isoformat())
            .limit(1)
            .execute()
        )
        snapshot_id = (lookup.data or [{}])[0].get("id")
    if not snapshot_id:
        raise RuntimeError("macro_regime_snapshots upsert did not return a snapshot id")

    trend_rows = fetch_market_trend_rows(supabase)
    targets = build_satellite_targets(snapshot, trend_rows)
    supabase.table("macro_satellite_targets").delete().eq("snapshot_id", snapshot_id).execute()
    target_payloads = [
        satellite_target_payload(target, snapshot_id=str(snapshot_id))
        for target in targets
    ]
    if target_payloads:
        supabase.table("macro_satellite_targets").insert(target_payloads).execute()

    missing = sum(1 for point in points if point.data_state in {"MISSING", "UNKNOWN"})
    stale = sum(1 for point in points if point.data_state == "STALE")
    ready = sum(1 for point in points if point.data_state == "READY")
    blocked = sum(1 for target in targets if target.is_blocked)
    return {
        "series_total": len(points),
        "series_ready": ready,
        "series_missing": missing,
        "series_stale": stale,
        "regime": snapshot.regime,
        "regime_state": snapshot.regime_state,
        "confidence": snapshot.confidence,
        "target_rows": len(targets),
        "blocked_targets": blocked,
        "snapshot_id": str(snapshot_id),
        "items_total": len(points) + len(targets) + 1,
        "items_success": ready + len(targets) + 1,
        "items_failed": missing,
        "coverage_pct": ((ready / len(points)) * 100) if points else 0,
    }
