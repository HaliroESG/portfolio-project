"""L0 logical source contract. Pure, offline-only; not a Supabase row or writer.

No provider/client/environment imports. Policy dates and clock are injected.
VALIDATED describes the synthetic contract, never rights or operational authority.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import date, datetime, timezone
from typing import Any, Mapping, Sequence


VERSION = "source-observation/v1"
SCOPE = "OFFLINE_SYNTHETIC"
MAX_SAFE_NUMBER = 2 ** 53 - 1  # Shared with JavaScript Number.MAX_SAFE_INTEGER.
DOMAINS = {"FX", "MACRO", "PUBLICATION"}
FREQUENCIES = {"DAILY", "MONTHLY", "QUARTERLY", "ANNUAL", "EVENT"}
UNITS = {"EUR_PER_UNIT", "PERCENT", "PERCENTAGE_POINTS", "BASIS_POINTS",
         "INDEX_POINTS", "RATIO", "CURRENCY"}
NATURES = {"OBSERVED", "DERIVED", "ESTIMATED", "UNKNOWN"}
USAGES = {"COLLECT", "STORE", "REPLAY", "DISPLAY"}
ERRORS = {"NETWORK_ERROR", "TIMEOUT", "RATE_LIMITED", "SCHEMA_CHANGED"}
TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:=\-]{0,127}\Z")
STAMP = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\Z"
)


class ContractError(ValueError):
    """Fixed reason codes only: never echo raw payloads, URLs or exceptions."""


def _shape(value: Any, fields: set[str]) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) != fields:
        raise ContractError("INVALID_SHAPE")
    return value


def _token(value: Any, *, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not TOKEN.fullmatch(value):
        raise ContractError("INVALID_REFERENCE")
    return value


def _choice(value: Any, choices: set[str]) -> str:
    if not isinstance(value, str) or value not in choices:
        raise ContractError("INVALID_ENUM")
    return value


def _date(value: Any) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ContractError("INVALID_DATE")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ContractError("INVALID_DATE") from None


def _time(value: Any) -> datetime:
    if (not isinstance(value, str) or not STAMP.fullmatch(value)
            or value.endswith("-00:00")):
        raise ContractError("INVALID_TIMESTAMP")
    # ISO offsets outside 23:59 must not be normalized by datetime.
    if not value.endswith("Z") and (int(value[-5:-3]) > 23 or int(value[-2:]) > 59):
        raise ContractError("INVALID_TIMESTAMP")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, OverflowError):
        raise ContractError("INVALID_TIMESTAMP") from None


def _iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _digest(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def normalize_observation(
    raw: Mapping[str, Any], *, now: str, policy: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize one synthetic observation; no inference from collection time.

    The optional fixture policy supplies a dated source-date floor, not a universal
    TTL or a computed exchange calendar. No policy (or an inapplicable one) is UNKNOWN.
    """
    _shape(raw, {"scope", "domain", "key", "value", "unit", "currency",
                 "observed", "collected_at", "run_id", "frequency", "period",
                 "source", "nature", "formula_ref", "input_refs", "rights_ref"})
    if raw["scope"] != SCOPE:
        raise ContractError("OFFLINE_SYNTHETIC_ONLY")
    clock, collected = _time(now), _time(raw["collected_at"])
    domain = _choice(raw["domain"], DOMAINS)
    key = _token(raw["key"])
    frequency = _choice(raw["frequency"], FREQUENCIES)
    nature = _choice(raw["nature"], NATURES)
    value = raw["value"]
    if value is not None:
        if type(value) not in (int, float):
            raise ContractError("INVALID_VALUE")
        # Check Python integers BEFORE float coercion can lose their identity.
        if type(value) is int and abs(value) > MAX_SAFE_NUMBER:
            raise ContractError("UNSAFE_NUMBER")
        try:
            value = float(value)
        except (ValueError, OverflowError):
            raise ContractError("INVALID_VALUE") from None
        if not math.isfinite(value):
            raise ContractError("INVALID_VALUE")
        # Also reject already-rounded, integer-valued floats outside the safe range.
        if abs(value) > MAX_SAFE_NUMBER:
            raise ContractError("UNSAFE_NUMBER")
        if domain == "FX" and value <= 0:
            raise ContractError("INVALID_FX_RATE")
    unit = _choice(raw["unit"], UNITS) if raw["unit"] is not None else None
    currency = raw["currency"]
    if currency is not None and (not isinstance(currency, str)
                                 or not re.fullmatch(r"[A-Z]{3}", currency)):
        raise ContractError("INVALID_CURRENCY")
    if domain == "FX" and unit not in (None, "EUR_PER_UNIT"):
        raise ContractError("INVALID_FX_UNIT")
    if currency is not None and unit != "CURRENCY":
        raise ContractError("UNEXPECTED_CURRENCY")

    reasons: list[str] = []
    unknown = False
    partial = False

    observed = raw["observed"]
    observed_date = None
    observed_at = None
    precision = "UNKNOWN"
    if observed is None:
        reasons.append("OBSERVATION_MISSING")
        unknown = True
    else:
        _shape(observed, {"precision", "value"})
        precision = _choice(observed["precision"], {"DATE", "TIMESTAMP"})
        if precision == "DATE":
            observed_date = _date(observed["value"])
        else:
            observed_at = _time(observed["value"])
            observed_date = observed_at.date()
        if (observed_at is not None and observed_at > clock) or observed_date > clock.date():
            reasons.append("OBSERVATION_FUTURE")
            unknown = True
        if (observed_at is not None and observed_at > collected) or observed_date > collected.date():
            reasons.append("OBSERVATION_AFTER_COLLECTION")
            unknown = True
    if collected > clock:
        reasons.append("COLLECTION_FUTURE")
        unknown = True
    if unit is None or (unit == "CURRENCY" and currency is None):
        reasons.append("UNIT_INCOMPLETE")
        partial = True
    if nature == "UNKNOWN":
        reasons.append("NATURE_UNKNOWN")
        unknown = True
    elif nature == "ESTIMATED":
        reasons.append("ESTIMATED_NOT_OBSERVED")
        partial = True

    period = None
    if raw["period"] is not None:
        _shape(raw["period"], {"start", "end"})
        start, end = _date(raw["period"]["start"]), _date(raw["period"]["end"])
        if start > end:
            raise ContractError("INVALID_PERIOD")
        period = {"start": start.isoformat(), "end": end.isoformat()}
        if observed_date is not None and end > observed_date:
            reasons.append("PERIOD_AFTER_OBSERVATION")
            unknown = True
    elif frequency in {"MONTHLY", "QUARTERLY", "ANNUAL"}:
        reasons.append("PERIOD_MISSING")
        partial = True

    _shape(raw["source"], {"provider", "native_id", "evidence_ref", "adapter_version"})
    source = {k: _token(v, nullable=True) for k, v in raw["source"].items()}
    if any(v is None for v in source.values()):
        reasons.append("PROVENANCE_INCOMPLETE")
        partial = True
    formula = _token(raw["formula_ref"], nullable=True)
    refs = raw["input_refs"]
    if not isinstance(refs, list) or len(refs) > 32:
        raise ContractError("INVALID_INPUT_REFS")
    refs = [_token(v) for v in refs]
    if len(set(refs)) != len(refs):
        raise ContractError("DUPLICATE_INPUT_REFS")
    if nature == "DERIVED" and (not formula or not refs):
        reasons.append("DERIVATION_INCOMPLETE")
        partial = True
    if nature != "DERIVED" and (formula is not None or refs):
        raise ContractError("UNEXPECTED_DERIVATION")

    floor = None
    policy_ref = None
    calendar_ref = None
    if policy is not None:
        _shape(policy, {"id", "version", "domain", "key", "provider", "frequency",
                        "evaluated_on", "not_before", "calendar_ref"})
        policy_ref = {"id": _token(policy["id"]), "version": _token(policy["version"])}
        calendar_ref = _token(policy["calendar_ref"], nullable=True)
        if domain == "FX" and calendar_ref is None:
            reasons.append("CALENDAR_REFERENCE_MISSING")
            unknown = True
        _choice(policy["domain"], DOMAINS)
        _choice(policy["frequency"], FREQUENCIES)
        _token(policy["key"])
        _token(policy["provider"])
        evaluated_on = _date(policy["evaluated_on"])
        proposed_floor = _date(policy["not_before"])
        if proposed_floor > evaluated_on:
            raise ContractError("INVALID_POLICY_FLOOR")
        matches = (policy["domain"] == domain and policy["key"] == key
                   and policy["provider"] == source["provider"]
                   and policy["frequency"] == frequency
                   and evaluated_on == clock.date())
        if matches:
            floor = proposed_floor
        else:
            reasons.append("POLICY_NOT_APPLICABLE")
            unknown = True
    else:
        reasons.append("FRESHNESS_POLICY_MISSING")
        unknown = True
    stale = observed_date is not None and floor is not None and observed_date < floor
    if stale:
        reasons.append("OBSERVATION_STALE")
    if value is None:
        reasons.append("VALUE_MISSING")
    quality = ("MISSING" if value is None else "UNKNOWN" if unknown else
               "STALE" if stale else "PARTIAL" if partial else "VALIDATED")
    identity = {
        "domain": domain, "key": key, "provider": source["provider"],
        "native_id": source["native_id"], "observed_date": (
            observed_date.isoformat() if observed_date else None),
        "observed_at": _iso(observed_at) if observed_at else None,
        "precision": precision, "frequency": frequency, "period": period,
    }
    revision = {"identity": identity, "value": value, "unit": unit, "currency": currency,
                "source": source, "nature": nature, "formula_ref": formula,
                "input_refs": refs}
    return {
        "contract_version": VERSION, "scope": SCOPE,
        "observation_id": _digest(identity), "revision_id": _digest(revision),
        "identity": identity, "value": value, "unit": unit, "currency": currency,
        "collected_at": _iso(collected), "run_id": _token(raw["run_id"]),
        "source": source, "nature": nature, "formula_ref": formula, "input_refs": refs,
        "rights_ref": _token(raw["rights_ref"], nullable=True),
        "quality": quality, "reason_codes": reasons,
        "freshness": {
            "basis": "SOURCE_DATE_FLOOR_V1", "policy": policy_ref,
            "calendar_ref": calendar_ref,
            "evaluated_at": _iso(clock),
            "source_age_calendar_days": (
                (clock.date() - observed_date).days if observed_date else None),
            "collection_age_seconds": (clock - collected).total_seconds(),
        },
        "operational_authority": False,
    }


def assess_rights(
    decision: Mapping[str, Any] | None, *, provider: str, usage: str, now: str,
) -> dict[str, Any]:
    """Evaluate a supplied fixture decision for ONE usage, never grant authority."""
    _token(provider)
    _choice(usage, USAGES)
    clock = _time(now)
    ref = None
    reason = "RIGHTS_MISSING"
    admissible = False
    if decision is not None:
        _shape(decision, {"scope", "ref", "provider", "status", "usages",
                          "valid_from", "valid_until"})
        if decision["scope"] != SCOPE:
            raise ContractError("OFFLINE_SYNTHETIC_ONLY")
        ref = _token(decision["ref"])
        _token(decision["provider"])
        status = _choice(decision["status"], {"APPROVED", "UNVERIFIED", "DENIED"})
        usages = decision["usages"]
        if not isinstance(usages, list) or len(usages) > len(USAGES):
            raise ContractError("INVALID_USAGES")
        for item in usages:
            _choice(item, USAGES)
        if len(set(usages)) != len(usages):
            raise ContractError("INVALID_USAGES")
        start, end = _time(decision["valid_from"]), _time(decision["valid_until"])
        if end <= start:
            raise ContractError("INVALID_RIGHTS_WINDOW")
        if status != "APPROVED":
            reason = "RIGHTS_" + status
        elif provider != decision["provider"]:
            reason = "RIGHTS_PROVIDER_MISMATCH"
        elif not start <= clock < end:
            reason = "RIGHTS_OUTSIDE_WINDOW"
        elif usage not in usages:
            reason = "RIGHTS_USAGE_NOT_GRANTED"
        else:
            admissible, reason = True, "FIXTURE_RIGHTS_ADMISSIBLE"
    return {"scope": SCOPE, "usage": usage, "decision_ref": ref,
            "admissible": admissible, "reason_code": reason,
            "operational_authority": False}


def _replay_order_error(current: Mapping[str, Any], previous: Mapping[str, Any]) -> str | None:
    """Compare normalized source chronology, never collection time or midnight.

    Equal slots may be revisions; unequal overlapping periods need future domain
    rules. This current-point rehearsal does not select historical corrections.
    """
    current_id, previous_id = current["identity"], previous["identity"]
    current_date, previous_date = current_id["observed_date"], previous_id["observed_date"]
    if current_date is None or previous_date is None:
        return "OBSERVATION_ORDER_UNKNOWN"
    if current_id["precision"] == previous_id["precision"] == "TIMESTAMP":
        if _time(current_id["observed_at"]) < _time(previous_id["observed_at"]):
            return "OBSERVATION_REGRESSION"
    elif current_date < previous_date:
        return "OBSERVATION_REGRESSION"
    elif current_date == previous_date and current_id["precision"] != previous_id["precision"]:
        return "OBSERVATION_ORDER_UNKNOWN"

    current_period, previous_period = current_id["period"], previous_id["period"]
    if current_period != previous_period:
        if current_period is None or previous_period is None:
            return "PERIOD_ORDER_UNKNOWN"
        if current_period["end"] < previous_period["start"]:
            return "PERIOD_REGRESSION"
        # Bounds are inclusive: a shared endpoint is still an overlap.
        if current_period["start"] <= previous_period["end"]:
            return "PERIOD_ORDER_UNKNOWN"
    return None


def replay_fixture(
    attempts: Sequence[Mapping[str, Any]], *, now: str, max_attempts: int,
    policy: Mapping[str, Any] | None = None,
    previous: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Bounded replay of already supplied outcomes, NOT a provider retry executor.

    No callables, client, URL, sleep or real exception text is accepted. Failed
    attempts never replace the previous observation or its collection timestamp.
    """
    if type(max_attempts) is not int or not 1 <= max_attempts <= 5:
        raise ContractError("INVALID_ATTEMPT_BUDGET")
    if not isinstance(attempts, (list, tuple)) or len(attempts) > 32:
        raise ContractError("INVALID_ATTEMPTS")
    _time(now)
    last_known = (normalize_observation(previous, now=now, policy=policy)
                  if previous is not None else None)
    if last_known is not None and (
        last_known["quality"] not in {"VALIDATED", "STALE"}
        or set(last_known["reason_codes"]) - {"OBSERVATION_STALE"}
    ):
        raise ContractError("INVALID_LAST_KNOWN")
    count = 0
    reasons: list[str] = []
    current = None
    status = "EXHAUSTED"
    for attempt in attempts[:max_attempts]:
        _shape(attempt, {"outcome", "observation"})
        outcome = _choice(attempt["outcome"], ERRORS | {"SUCCESS"})
        count += 1
        if outcome == "SUCCESS":
            try:
                current = normalize_observation(attempt["observation"], now=now, policy=policy)
            except ContractError:
                reasons.append("CONTRACT_INVALID")
                status = "FAILED"
            else:
                status = "PREPARED"
                if last_known is not None and (
                    any(current["identity"][key] != last_known["identity"][key]
                        for key in ("domain", "key", "provider", "native_id", "frequency"))
                    or current["unit"] != last_known["unit"]
                    or current["currency"] != last_known["currency"]
                ):
                    current = None
                    status = "FAILED"
                    reasons.append("OBSERVATION_IDENTITY_MISMATCH")
                elif last_known is not None:
                    order_error = _replay_order_error(current, last_known)
                    if order_error is not None:
                        current = None
                        status = "FAILED"
                        reasons.append(order_error)
            break
        if attempt["observation"] is not None:
            raise ContractError("ERROR_WITH_OBSERVATION")
        reasons.append(outcome)
        if outcome == "SCHEMA_CHANGED":
            status = "FAILED"
            break
    if status == "EXHAUSTED":
        reasons.append("ATTEMPT_BUDGET_EXHAUSTED" if count == max_attempts
                       else "FIXTURE_OUTCOMES_EXHAUSTED")
    return {"scope": SCOPE, "status": status, "attempt_count": count,
            "reason_codes": reasons, "current": current, "last_known": last_known,
            "operational_authority": False}
