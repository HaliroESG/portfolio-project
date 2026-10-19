"""L2 macro preparation: pure, synthetic and deliberately disconnected from writers.

Dates, publication expectations and source-unit conventions are supplied, never
inferred from a recent collection or a ticker. No regime/target imports or I/O.
"""
from __future__ import annotations

import calendar
import csv
import io
import math
import re
import statistics
from collections import defaultdict
from datetime import date
from typing import Any, Mapping, Sequence

from source_contracts import (
    ContractError, MAX_SAFE_NUMBER, SCOPE, _date, _digest, _shape, _time,
    _token, normalize_observation,
)

VERSION = "macro-trace/v1"
# L0 reference tokens exclude '^'. Preserve the original provider identifier
# beside the reversible, explicit logical encoding; never guess another series.
NATIVE_REFERENCE_TOKENS = {symbol: "yahoo-index:" + symbol[1:]
                           for symbol in ("^VIX", "^MOVE", "^TNX", "^FVX")}
# Candidate conventions, NOT evidence of provider rights or current payload units.
# A raw observation still has to declare its unit and a complete source binding.
SERIES = {
    "VIX": ("YAHOO", "^VIX", "INDEX_POINTS", "DAILY", "macro_sync"),
    "MOVE": ("YAHOO", "^MOVE", "INDEX_POINTS", "DAILY", "macro_sync"),
    "DXY": ("YAHOO", "DX-Y.NYB", "INDEX_POINTS", "DAILY", "macro_sync"),
    "US10Y": ("YAHOO", "^TNX", "PERCENT", "DAILY", "macro_sync"),
    "CPIAUCSL": ("FRED", "CPIAUCSL", "INDEX_POINTS", "MONTHLY", "fred_observations"),
    "CPILFESL": ("FRED", "CPILFESL", "INDEX_POINTS", "MONTHLY", "fred_observations"),
    "UNRATE": ("FRED", "UNRATE", "PERCENT", "MONTHLY", "fred_observations"),
    "SPREAD_10Y_2Y": ("FRED", "T10Y2Y", "PERCENTAGE_POINTS", "DAILY", "fred_observations"),
    "T10YIE": ("FRED", "T10YIE", "PERCENT", "DAILY", "fred_observations"),
    "HY_OAS": ("FRED", "BAMLH0A0HYM2", "PERCENTAGE_POINTS", "DAILY", "fred_observations"),
    "JPYUSD": ("YAHOO", "JPYUSD=X", "RATIO", "DAILY", "macro_sync"),
}
UNSUPPORTED = {
    "PMI_MANUFACTURING": "PMI_SOURCE_USAGE_PERIOD_UNVERIFIED",
    "PAYEMS": "THOUSANDS_PERSONS_UNIT_NOT_IN_L0_V1",
}
DERIVED = {
    "MISERY_INDEX": ("INDEX_POINTS", "MONTHLY"),
    "JPY_VOLATILITY": ("PERCENT", "DAILY"),
}
CONVERSIONS = {
    ("RATIO", "PERCENT"): (100.0, "ratio-to-percent/v1"),
    ("BASIS_POINTS", "PERCENT"): (0.01, "basis-points-to-percent/v1"),
    ("BASIS_POINTS", "PERCENTAGE_POINTS"): (0.01, "basis-points-to-percentage-points/v1"),
}
MAX_ROWS = 2000
# CSV feeds include long daily histories; this parser limit is independent of
# the deliberately bounded set accepted for an offline preparation request.
MAX_CSV_ROWS = 50_000
# Explicit ASCII decimal/scientific grammar: float() also accepts underscores,
# Unicode digits and whitespace, which must not silently qualify source tokens.
FRED_NUMBER = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")


def macro_owner(provider: str, native_id: str) -> str | None:
    """One logical producer per native series; no writer or registration."""
    return next((s[4] for s in SERIES.values() if s[:2] == (provider, native_id)), None)


def parse_fred_csv(text: str, series_id: str) -> dict[str, Any]:
    """Parse preloaded text. A FRED period label is NOT a publication date.

    Preserve missing observations, duplicates and invalid-row diagnostics. Unknown
    headers are schema failures, including an empty HTTP-success response.
    """
    _token(series_id)
    if not isinstance(text, str) or len(text) > 2_000_000:
        raise ContractError("INVALID_CSV_INPUT")
    rows, reasons = [], set()
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        # Header parsing can raise csv.Error too; it shares the fail-closed path.
        headers = reader.fieldnames
        date_column = next((k for k in ("DATE", "observation_date") if headers and k in headers), None)
        if not date_column or headers != [date_column, series_id]:
            return {"status": "SCHEMA_CHANGED", "rows": [], "reason_codes": ["SCHEMA_CHANGED"]}
        for index, raw in enumerate(reader):
            if index >= MAX_CSV_ROWS:
                raise ContractError("ROW_LIMIT")
            if set(raw) != {date_column, series_id} or raw[series_id] is None:
                return {"status": "SCHEMA_CHANGED", "rows": [], "reason_codes": ["SCHEMA_CHANGED"]}
            try:
                period_date = _date(raw[date_column])
            except ContractError:
                reasons.add("INVALID_PERIOD_DATE")
                continue
            value = None
            if raw[series_id] in ("", "."):
                reasons.add("VALUE_MISSING")
            elif not FRED_NUMBER.fullmatch(raw[series_id]):
                reasons.add("INVALID_VALUE")
            else:
                try:
                    value = float(raw[series_id])
                except (TypeError, ValueError):
                    reasons.add("INVALID_VALUE")
                if value is not None and (not math.isfinite(value) or abs(value) > MAX_SAFE_NUMBER):
                    reasons.add("INVALID_VALUE")
                    value = None
            rows.append({"period_date": period_date.isoformat(), "value": value})
    except csv.Error:
        return {"status": "SCHEMA_CHANGED", "rows": [], "reason_codes": ["SCHEMA_CHANGED"]}
    rows.sort(key=lambda row: (row["period_date"], str(row["value"])))
    if len({r["period_date"] for r in rows}) != len(rows):
        reasons.add("DUPLICATE_PERIOD")
    if not rows:
        reasons.add("EMPTY_SERIES")
    return {"status": "PARTIAL" if rows and reasons else "PARSED" if rows else "MISSING",
            "rows": rows, "reason_codes": sorted(reasons)}


def _period(value: Mapping[str, str], frequency: str) -> dict[str, str]:
    _shape(value, {"start", "end"})
    start, end = _date(value["start"]), _date(value["end"])
    if frequency == "MONTHLY":
        valid = start.day == 1 and end == date(start.year, start.month, calendar.monthrange(start.year, start.month)[1])
    else:
        valid = start == end
    if not valid:
        raise ContractError("INVALID_MACRO_PERIOD")
    return dict(value)


def _policy(policy: Mapping[str, Any] | None, series_id: str, frequency: str,
            provider: str, now: str) -> tuple[dict[str, Any] | None, list[str]]:
    if policy is None:
        return None, ["CADENCE_POLICY_MISSING"]
    _shape(policy, {"scope", "id", "version", "series_id", "frequency", "evaluated_on",
                    "expected_period", "publication_due_at", "calendar_ref"})
    if policy["scope"] != SCOPE:
        raise ContractError("OFFLINE_SYNTHETIC_ONLY")
    _token(policy["id"])
    _token(policy["version"])
    _token(policy["calendar_ref"])
    expected = _period(policy["expected_period"], frequency)
    clock, due = _time(now), _time(policy["publication_due_at"])
    if (_date(policy["evaluated_on"]) != clock.date() or policy["series_id"] != series_id
            or policy["frequency"] != frequency):
        return None, ["CADENCE_POLICY_NOT_APPLICABLE"]
    if due > clock or _date(expected["end"]) > due.date():
        return None, ["EXPECTED_PUBLICATION_NOT_DUE"]
    return {"id": policy["id"], "version": policy["version"], "domain": "MACRO",
            "key": series_id, "provider": provider, "frequency": frequency,
            "evaluated_on": policy["evaluated_on"], "not_before": expected["end"],
            "calendar_ref": policy["calendar_ref"]}, []


def _empty(series_id: str, now: str, policy: Mapping[str, Any] | None) -> dict[str, Any]:
    _time(now)
    if series_id in SERIES:
        _, _, unit, frequency, owner = SERIES[series_id]
    elif series_id in DERIVED:
        unit, frequency = DERIVED[series_id]
        owner = "macro_derived"
    elif series_id in UNSUPPORTED:
        unit, frequency, owner = None, "MONTHLY", None
    else:
        raise ContractError("UNKNOWN_MACRO_SERIES")
    return {"contract_version": VERSION, "scope": SCOPE, "series_id": series_id,
            "canonical_unit": unit, "frequency": frequency, "logical_owner": owner,
            "evaluated_at": now, "cadence_policy": dict(policy) if policy else None,
            "status": "MISSING", "value": None, "reason_codes": [], "current": None,
            "observations": [], "inputs": [], "formula_ref": None, "parameters": {},
            "operational_authority": False, "tactical_usable": False}


def _entry(raw: Mapping[str, Any], producer: str, series_id: str,
           now: str, policy: Mapping[str, Any] | None) -> dict[str, Any]:
    provider, native, unit, frequency, owner = SERIES[series_id]
    reasons = []
    # L0 validates the closed raw shape and primitive values before we inspect it.
    if not isinstance(raw, Mapping):
        raise ContractError("INVALID_SHAPE")
    native_id = raw.get("source", {}).get("native_id") if isinstance(raw.get("source"), Mapping) else None
    normalized_raw = raw
    if isinstance(native_id, str) and native_id in NATIVE_REFERENCE_TOKENS:
        normalized_raw = {**raw, "source": {**raw["source"], "native_id": NATIVE_REFERENCE_TOKENS[native_id]}}
    obs = normalize_observation(normalized_raw, now=now, policy=policy)
    if raw["domain"] != "MACRO" or raw["key"] != series_id or raw["frequency"] != frequency:
        raise ContractError("MACRO_BINDING_MISMATCH")
    if producer != owner:
        reasons.append("PRODUCER_NOT_OWNER")
    if obs["source"]["provider"] != provider or native_id != native:
        reasons.append("SOURCE_SERIES_MISMATCH")
    if obs["nature"] != "OBSERVED":
        reasons.append("EXPECTED_SOURCE_OBSERVATION")
    period = obs["identity"]["period"]
    if frequency == "MONTHLY" and period is not None:
        _period(period, frequency)
    elif frequency == "DAILY" and period is not None:
        if _period(period, frequency)["start"] != obs["identity"]["observed_date"]:
            raise ContractError("DAILY_PERIOD_MISMATCH")
    conversion, canonical = None, None
    if obs["unit"] == unit:
        factor, conversion = 1.0, "identity/v1"
    else:
        factor, conversion = CONVERSIONS.get((obs["unit"], unit), (None, None))
    if factor is None:
        reasons.append("UNIT_CONVENTION_UNVERIFIED")
    elif obs["value"] is not None:
        canonical = obs["value"] * factor
        if not math.isfinite(canonical) or abs(canonical) > MAX_SAFE_NUMBER:
            reasons.append("UNSAFE_CONVERTED_VALUE")
            canonical = None
    if canonical is not None and series_id in {"CPIAUCSL", "CPILFESL", "JPYUSD"} and canonical <= 0:
        reasons.append("NON_POSITIVE_INPUT")
        canonical = None
    return {"producer": _token(producer), "provider_native_id": native_id,
            "observation": obs, "canonical_value": canonical,
            "conversion_ref": conversion, "reason_codes": reasons}


def _slot(entry: Mapping[str, Any]) -> str:
    identity = entry["observation"]["identity"]
    return (identity["period"] or {}).get("start") or identity["observed_date"] or ""


def _signature(entry: Mapping[str, Any]) -> str:
    obs = entry["observation"]
    return _digest([obs["revision_id"], obs["rights_ref"], entry["producer"],
                    entry["provider_native_id"], entry["conversion_ref"], entry["reason_codes"]])


def prepare_macro_series(rows: Sequence[Mapping[str, Any]], *, series_id: str,
                         now: str, policy: Mapping[str, Any] | None = None) -> dict[str, Any]:
    result = _empty(series_id, now, policy)
    if not isinstance(rows, list) or len(rows) > MAX_ROWS:
        raise ContractError("INVALID_MACRO_ROWS")
    if series_id in UNSUPPORTED:
        result["reason_codes"] = [UNSUPPORTED[series_id]]
        return result  # No proxy, even if a caller supplies one.
    if series_id not in SERIES:
        raise ContractError("DERIVATION_REQUIRED")
    provider, _, _, frequency, _ = SERIES[series_id]
    normalized_policy, policy_reasons = _policy(policy, series_id, frequency, provider, now)
    entries = []
    for raw in rows:
        _shape(raw, {"producer", "observation"})
        entries.append(_entry(raw["observation"], raw["producer"], series_id, now, normalized_policy))
    # Replay chooses the earliest collection for the SAME evidence only.
    by_evidence = {}
    for entry in sorted(entries, key=lambda e: (_time(e["observation"]["collected_at"]), e["observation"]["run_id"])):
        by_evidence.setdefault((_slot(entry), _signature(entry)), entry)
    entries = sorted(by_evidence.values(), key=lambda e: (_slot(e), _signature(e)))
    result["observations"] = entries
    if not entries:
        result["reason_codes"] = ["SERIES_MISSING", *policy_reasons]
        return result
    periods = defaultdict(set)
    for entry in entries:
        periods[_slot(entry)].add(_signature(entry))
    current = entries[-1]
    result["current"] = current
    reasons = set(policy_reasons + current["reason_codes"] + current["observation"]["reason_codes"])
    if any(len(versions) > 1 for versions in periods.values()):
        result["status"] = "CONFLICT"
        reasons.add("DUPLICATE_OR_REVISED_PERIOD_CONFLICT")
    elif any(entry["reason_codes"] for entry in entries):
        result["status"] = "UNKNOWN"
        reasons.update(code for entry in entries for code in entry["reason_codes"])
    else:
        result["status"] = current["observation"]["quality"]
        if policy_reasons and result["status"] != "MISSING":
            result["status"] = "UNKNOWN"
        if normalized_policy is not None and _slot(current):
            expected = policy["expected_period"]["start"]
            if _slot(current) < expected:
                reasons.add("EXPECTED_PERIOD_MISSING")
                if result["status"] == "VALIDATED":
                    result["status"] = "STALE"
            elif _slot(current) > expected:
                reasons.add("PERIOD_AFTER_EXPECTED")
                result["status"] = "UNKNOWN"
    # Unknown/future/unit-conflicting values remain in audit entries, not the
    # certified value slot. Stale/partial values stay consultable and labelled.
    if result["status"] in {"VALIDATED", "STALE", "PARTIAL"}:
        result["value"] = current["canonical_value"]
    result["reason_codes"] = sorted(reasons)
    return result


def _month_shift(value: date, count: int) -> date:
    index = value.year * 12 + value.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def _derivation_inputs(traces: list[dict[str, Any]]) -> list[str]:
    reasons = []
    for trace in traces:
        if trace["status"] != "VALIDATED":
            reasons.extend(["INPUT_NOT_VALIDATED", *trace["reason_codes"]])
        for entry in trace["observations"]:
            observation = entry["observation"]
            reasons.extend(entry["reason_codes"])
            # Historical points may be stale relative to TODAY. That alone is
            # legitimate input history, unlike future/missing/partial evidence.
            reasons.extend(r for r in observation["reason_codes"] if r != "OBSERVATION_STALE")
        if len({e["observation"]["source"]["adapter_version"] for e in trace["observations"]}) > 1:
            reasons.append("INPUT_METHOD_MISMATCH")
    return sorted(set(reasons))


def _derived_result(series_id: str, inputs: list[dict[str, Any]], *, value: float | None,
                    period: dict[str, str] | None, formula: str, parameters: dict[str, Any],
                    reasons: list[str], now: str, policy: Mapping[str, Any] | None) -> dict[str, Any]:
    result = _empty(series_id, now, policy)
    result.update(inputs=inputs, formula_ref=formula, parameters=parameters)
    normalized_policy, policy_reasons = _policy(policy, series_id, result["frequency"], "DERIVED", now)
    reasons = sorted(set(reasons + policy_reasons))
    if reasons or value is None or not inputs:
        result["reason_codes"] = reasons or ["INPUT_MISSING"]
        return result
    observations = [e["observation"] for e in inputs]
    observed = max(o["identity"]["observed_date"] for o in observations)
    collected = max(observations, key=lambda o: _time(o["collected_at"]))["collected_at"]
    raw = {"scope": SCOPE, "domain": "MACRO", "key": series_id, "value": value,
           "unit": result["canonical_unit"], "currency": None,
           "observed": {"precision": "DATE", "value": observed}, "collected_at": collected,
           "run_id": "offline-derivation", "frequency": result["frequency"], "period": period,
           "source": {"provider": "DERIVED", "native_id": series_id,
                      "evidence_ref": formula, "adapter_version": "macro-trace-v1"},
           "nature": "DERIVED", "formula_ref": formula,
           "input_refs": [_signature(e) for e in inputs], "rights_ref": None}
    obs = normalize_observation(raw, now=now, policy=normalized_policy)
    entry = {"producer": "macro_derived", "provider_native_id": series_id,
             "observation": obs, "canonical_value": obs["value"],
             "conversion_ref": "identity/v1", "reason_codes": []}
    result.update(current=entry, observations=[entry], status=obs["quality"],
                  value=obs["value"] if obs["quality"] in {"VALIDATED", "STALE", "PARTIAL"} else None,
                  reason_codes=obs["reason_codes"])
    # The date of release cannot qualify a different reporting period.
    derived_period = period or {"start": observed, "end": observed}
    if policy and derived_period != policy["expected_period"]:
        result.update(status="UNKNOWN", value=None, reason_codes=["DERIVED_PERIOD_MISMATCH"])
    return result


def derive_misery(cpi: list[dict[str, Any]], unrate: list[dict[str, Any]], *, now: str,
                  policies: Mapping[str, Any]) -> dict[str, Any]:
    """Exact 13 calendar months (12-month change) plus same-month unemployment."""
    traces = [prepare_macro_series(rows, series_id=key, now=now, policy=policies.get(key))
              for key, rows in (("CPIAUCSL", cpi), ("UNRATE", unrate))]
    reasons = _derivation_inputs(traces)
    current_cpi, current_unrate = (trace["current"] for trace in traces)
    inputs, period, value = [], None, None
    if current_cpi and current_unrate and _slot(current_cpi) and _slot(current_unrate):
        period = current_cpi["observation"]["identity"]["period"]
        if _slot(current_cpi) != _slot(current_unrate):
            reasons.append("PERIOD_MISMATCH")
        anchor = _date(_slot(current_cpi))
        required = [_month_shift(anchor, -n).isoformat() for n in range(12, -1, -1)]
        by_period = {_slot(e): e for e in traces[0]["observations"]}
        if any(key not in by_period for key in required):
            reasons.append("CPI_CALENDAR_GAP")
        else:
            inputs = [by_period[key] for key in required] + [current_unrate]
            values = [entry["canonical_value"] for entry in inputs]
            if any(v is None for v in values):
                reasons.append("INPUT_MISSING")
            elif not reasons:
                value = (values[12] / values[0] - 1) * 100 + values[13]
    else:
        reasons.append("INPUT_MISSING")
    return _derived_result("MISERY_INDEX", inputs, value=value, period=period,
                           formula="misery-cpi-yoy-unrate-v1",
                           parameters={"calendar_months": 12, "cpi_observations": 13},
                           reasons=reasons, now=now, policy=policies.get("MISERY_INDEX"))


def derive_jpy_realized_volatility(rows: list[dict[str, Any]], *, now: str,
                                   policy: Mapping[str, Any] | None,
                                   result_policy: Mapping[str, Any] | None,
                                   sessions: list[str], calendar_ref: str) -> dict[str, Any]:
    """5 dated prices -> 4 log returns; sample std (ddof=1) * sqrt(252)*100."""
    _token(calendar_ref)
    if (not isinstance(sessions, list) or len(sessions) != 5
            or sessions != sorted(set(sessions))):
        raise ContractError("INVALID_VOLATILITY_SESSIONS")
    for session in sessions:
        _date(session)
    trace = prepare_macro_series(rows, series_id="JPYUSD", now=now, policy=policy)
    reasons = _derivation_inputs([trace])
    if not policy or calendar_ref != policy["calendar_ref"] or sessions[-1] != policy["expected_period"]["end"]:
        reasons.append("VOLATILITY_CALENDAR_MISMATCH")
    by_date = {_slot(e): e for e in trace["observations"]}
    inputs = [by_date[s] for s in sessions if s in by_date]
    value = None
    if len(inputs) != 5:
        reasons.append("VOLATILITY_SESSION_GAP")
    elif len({e["observation"]["source"]["adapter_version"] for e in inputs}) != 1:
        reasons.append("VOLATILITY_METHOD_MISMATCH")
    elif not reasons:
        prices = [e["canonical_value"] for e in inputs]
        # Difference of logs avoids ratio overflow/underflow for finite inputs.
        returns = [math.log(b) - math.log(a) for a, b in zip(prices, prices[1:])]
        value = statistics.stdev(returns) * math.sqrt(252) * 100
    return _derived_result("JPY_VOLATILITY", inputs, value=value, period=None,
                           formula="jpyusd-realized-log-sample-vol-v1",
                           parameters={"prices": 5, "returns": 4, "ddof": 1, "annualization": 252,
                                       "calendar_ref": calendar_ref, "sessions": sessions,
                                       "kind": "REALIZED_NOT_IMPLIED"},
                           reasons=reasons, now=now, policy=result_policy)
