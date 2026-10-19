"""L1 FX preparation, strictly pure and synthetic. No live writer is connected.

The caller supplies observations, clock and a versioned session calendar. Dates
are source dates in UTC, never inferred from a collection timestamp. The calendar
is evidence supplied by the caller, not an inferred weekend/holiday schedule.
"""
from __future__ import annotations

from typing import Any, Mapping, Sequence

import source_contracts as sc


VERSION = "fx-trace/v1"
PILOT = {"USD": "USDEUR=X", "CHF": "CHFEUR=X", "GBP": "GBPEUR=X", "JPY": "JPYEUR=X"}


def _calendar(raw: Mapping[str, Any] | None, now: str) -> dict[str, Any] | None:
    if raw is None:
        return None
    sc._shape(raw, {"scope", "id", "version", "provider", "close_convention",
                    "date_basis", "evaluated_on", "expected_session", "sessions"})
    if raw["scope"] != sc.SCOPE or raw["date_basis"] != "UTC_SOURCE_DATE":
        raise sc.ContractError("INVALID_FX_CALENDAR_SCOPE")
    for key in ("id", "version", "provider", "close_convention"):
        sc._token(raw[key])
    evaluated = sc._date(raw["evaluated_on"])
    expected = sc._date(raw["expected_session"])
    sessions = raw["sessions"]
    if not isinstance(sessions, list) or not 1 <= len(sessions) <= 4000:
        raise sc.ContractError("INVALID_FX_SESSIONS")
    dates = [sc._date(day) for day in sessions]
    if (dates != sorted(set(dates)) or dates[-1] != expected
            or expected > evaluated or evaluated != sc._time(now).date()):
        raise sc.ContractError("INVALID_FX_CALENDAR_ORDER")
    return dict(raw)


def prepare_fx_series(
    rows: Sequence[Mapping[str, Any]], *, currency: str, now: str,
    calendar: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Prepare one EUR-per-unit reference, preserving every normalized input.

    Daily variation requires adjacent known sessions and identical source/method.
    Any conflicting daily identity blocks the series; no arbitrary winner. Exact
    replays are idempotent and retain the earliest collection, not a refreshed TTL.
    This output is a logical fixture contract, NOT a Supabase table payload.
    """
    if not isinstance(currency, str) or currency not in PILOT:
        raise sc.ContractError("FX_OUTSIDE_PILOT")
    sc._time(now)
    if not isinstance(rows, (list, tuple)) or len(rows) > 512:
        raise sc.ContractError("INVALID_FX_SERIES")
    cal = _calendar(calendar, now)
    observations: list[dict[str, Any]] = []
    groups: dict[str | None, list[dict[str, Any]]] = {}
    reasons: set[str] = set()
    for row in rows:
        sc._shape(row, {"ticker", "close_convention", "observation"})
        close = sc._token(row["close_convention"], nullable=True)
        if row["ticker"] != PILOT[currency]:
            raise sc.ContractError("FX_PAIR_MISMATCH")
        raw = row["observation"]
        # First validate the complete L0 shape and numeric/date boundaries.
        base = sc.normalize_observation(raw, now=now)
        if (base["identity"]["domain"] != "FX"
                or base["identity"]["key"] != f"FX:{currency}:EUR"
                or base["identity"]["frequency"] != "DAILY"
                or base["identity"]["period"] is not None
                or base["source"]["native_id"] not in (None, PILOT[currency])):
            raise sc.ContractError("FX_IDENTITY_MISMATCH")
        matches = bool(cal and cal["provider"] == base["source"]["provider"]
                       and cal["close_convention"] == close)
        policy = None if not matches else {
            "id": cal["id"], "version": cal["version"], "domain": "FX",
            "key": f"FX:{currency}:EUR", "provider": cal["provider"],
            "frequency": "DAILY", "evaluated_on": cal["evaluated_on"],
            "not_before": cal["expected_session"], "calendar_ref": cal["id"],
        }
        observation = sc.normalize_observation(raw, now=now, policy=policy)
        day = observation["identity"]["observed_date"]
        age = None
        if matches and day in cal["sessions"]:
            age = len(cal["sessions"]) - 1 - cal["sessions"].index(day)
        entry = {"observation": observation, "close_convention": close, "session_age": age}
        observations.append(entry)
        groups.setdefault(day, []).append(entry)

    # A date with different values, source, method, precision or rights reference
    # is ambiguous even when a later collection claims to be a revision. Revisions
    # require explicit reconciliation outside L1; never apply last-write-wins here.
    conflicts = []
    deduped = []
    for day, group in sorted(groups.items(), key=lambda item: item[0] or ""):
        revisions = {(item["observation"]["revision_id"], item["close_convention"],
                      item["observation"]["rights_ref"]) for item in group}
        if len(revisions) > 1:
            conflicts.append({"observed_date": day,
                              "revision_ids": sorted({item[0] for item in revisions})})
        deduped.append(min(group, key=lambda item: (
            item["observation"]["collected_at"], item["observation"]["revision_id"],
            item["close_convention"] or "", item["observation"]["run_id"],
            item["observation"]["rights_ref"] or "")))

    current = deduped[-1] if deduped else None
    previous = deduped[-2] if len(deduped) > 1 else None
    status = "MISSING" if current is None else current["observation"]["quality"]
    if current:
        reasons.update(current["observation"]["reason_codes"])
        if current["close_convention"] is None:
            reasons.add("CLOSE_CONVENTION_MISSING")
        if current["session_age"] is None:
            reasons.add("SESSION_AGE_UNKNOWN")
        if current["observation"]["nature"] != "OBSERVED":
            reasons.add("FX_NOT_OBSERVED")
        if any("COLLECTION_FUTURE" in item["observation"]["reason_codes"] for item in observations):
            reasons.add("COLLECTION_FUTURE")
        if None in groups:
            reasons.add("UNDATED_OBSERVATION")
        if reasons - {"OBSERVATION_STALE", "VALUE_MISSING"} and status != "MISSING":
            status = "UNKNOWN"
    else:
        reasons.add("NO_OBSERVATIONS")
    if not cal:
        reasons.add("SESSION_CALENDAR_MISSING")
    if conflicts:
        status = "CONFLICT"
        reasons.add("CONFLICTING_DAILY_OBSERVATIONS")

    change = inverse_change = None
    comparison_reasons: set[str] = set()
    if status != "VALIDATED" or current is None or current["session_age"] != 0:
        comparison_reasons.add("CURRENT_NOT_VERIFIED")
    if previous is None:
        comparison_reasons.add("PREVIOUS_OBSERVATION_MISSING")
    elif current:
        cur, prev = current["observation"], previous["observation"]
        if previous["session_age"] != 1:
            comparison_reasons.add("NON_ADJACENT_OR_UNKNOWN_SESSION")
        if (prev["quality"] not in {"VALIDATED", "STALE"}
                or set(prev["reason_codes"]) - {"OBSERVATION_STALE"}
                or prev["nature"] != "OBSERVED"):
            comparison_reasons.add("PREVIOUS_NOT_VERIFIED")
        if any(cur["source"][key] != prev["source"][key]
               for key in ("provider", "native_id", "adapter_version")):
            comparison_reasons.add("SOURCE_MISMATCH")
        if (cur["unit"] != prev["unit"] or current["close_convention"] != previous["close_convention"]
                or cur["identity"]["precision"] != prev["identity"]["precision"]
                or (cur["identity"]["precision"] == "TIMESTAMP" and
                    cur["identity"]["observed_at"][10:] != prev["identity"]["observed_at"][10:])):
            comparison_reasons.add("METHOD_OR_PRECISION_MISMATCH")
        if not comparison_reasons:
            change = cur["value"] / prev["value"] - 1
            inverse_change = prev["value"] / cur["value"] - 1
            # Very small finite inputs can still overflow a ratio in binary64.
            if not all(-1 < value <= sc.MAX_SAFE_NUMBER for value in (change, inverse_change)):
                change = inverse_change = None
                comparison_reasons.add("UNREPRESENTABLE_VARIATION")

    return {
        "contract_version": VERSION, "scope": sc.SCOPE, "operational_authority": False,
        "currency": currency, "quote": "EUR", "unit": "EUR_PER_UNIT", "ticker": PILOT[currency],
        "evaluated_at": sc._iso(sc._time(now)), "calendar": cal, "status": status,
        "current": current, "previous": previous,
        "change_pct": change, "inverse_change_pct": inverse_change,
        "reason_codes": sorted(reasons), "comparison_reason_codes": sorted(comparison_reasons),
        "conflicts": conflicts,
        "observations": sorted(observations, key=lambda item: (
            item["observation"]["identity"]["observed_date"] or "",
            item["observation"]["revision_id"], item["observation"]["collected_at"],
            item["close_convention"] or "", item["observation"]["run_id"],
            item["observation"]["rights_ref"] or "")),
    }
