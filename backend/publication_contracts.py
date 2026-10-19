"""L3 publication contracts: deterministic preparation, no I/O or writer.

The synthetic entry point cannot certify live data. TTM requires supplied period
bounds and accounting basis; a provider's 'quarterly' label is not that evidence.
"""
from __future__ import annotations

import calendar
import math
from datetime import date, timedelta
from typing import Any, Mapping, Sequence

from source_contracts import ContractError, MAX_SAFE_NUMBER, SCOPE, _date, _digest, _shape, _time, _token

VERSION = "publication-trace/v1"
METRICS = ("revenue", "ebitda", "operating_income", "net_income", "free_cash_flow")
STATUSES = {"ESTIMATED", "CONFIRMED", "REPORTED", "CANCELLED"}
PROOFS = {"NONE", "AGGREGATOR_RESULT", "OFFICIAL_DOCUMENT", "OFFICIAL_SCHEDULE", "OFFICIAL_CANCELLATION"}
EVENT_FIELDS = {"scope", "provider", "issuer", "event_id", "event_type", "revision_id",
                "supersedes_revision_id", "event_date", "event_time", "status", "proof_kind",
                "source_ref", "observed_at", "fiscal_year", "period_kind", "period_end",
                "filing_date", "amends_event_id", "actual_eps"}


def prepare_publication(raw: Mapping[str, Any], *, now: str) -> dict[str, Any]:
    """One immutable synthetic revision. Dates never cause a status upgrade."""
    _shape(raw, EVENT_FIELDS)
    if raw["scope"] != SCOPE:
        raise ContractError("OFFLINE_SYNTHETIC_ONLY")
    clock = _time(now)
    for field in ("provider", "issuer", "event_id", "revision_id"):
        _token(raw[field])
    for field in ("supersedes_revision_id", "source_ref", "amends_event_id"):
        _token(raw[field], nullable=True)
    if raw["supersedes_revision_id"] == raw["revision_id"]:
        raise ContractError("SELF_REVISION")
    if raw["event_type"] not in {"EARNINGS", "REGULATORY_FILING"} or raw["status"] not in STATUSES or raw["proof_kind"] not in PROOFS:
        raise ContractError("INVALID_EVENT_ENUM")
    dates = {k: _date(raw[k]) if raw[k] is not None else None
             for k in ("event_date", "period_end", "filing_date")}
    stamp = _time(raw["event_time"]) if raw["event_time"] is not None else None
    # Preserve the date at the explicit source offset, not its UTC calendar day.
    if stamp is not None and (dates["event_date"] is None or raw["event_time"][:10] != raw["event_date"]):
        raise ContractError("EVENT_CIVIL_DATE_MISMATCH")
    observed = _time(raw["observed_at"]) if raw["observed_at"] is not None else None
    fiscal_year = raw["fiscal_year"]
    if fiscal_year is not None and (type(fiscal_year) is not int or not 1900 <= fiscal_year <= 9999):
        raise ContractError("INVALID_FISCAL_YEAR")
    if raw["period_kind"] not in {None, "Q1", "Q2", "Q3", "Q4", "H1", "H2", "FY", "INTERIM"}:
        raise ContractError("INVALID_PERIOD_KIND")
    eps = raw["actual_eps"]
    if eps is not None and (type(eps) not in (int, float) or abs(eps) > MAX_SAFE_NUMBER or not math.isfinite(eps)):
        raise ContractError("INVALID_EPS")
    kind, status = raw["proof_kind"], raw["status"]
    evidence = bool(raw["source_ref"] and observed is not None and observed <= clock)
    occurred = dates["event_date"] is not None and dates["event_date"] <= clock.date()
    if occurred and observed is not None:
        occurred = dates["event_date"] <= observed.date()
    if stamp is not None:
        occurred = stamp <= clock and observed is not None and stamp <= observed
    qualified = status == "ESTIMATED"
    if status == "REPORTED":
        qualified = evidence and occurred and (kind == "OFFICIAL_DOCUMENT" or (kind == "AGGREGATOR_RESULT" and eps is not None and raw["event_type"] == "EARNINGS"))
        if raw["event_type"] == "REGULATORY_FILING":
            # A filing occurrence must be backed by that same civil filing date.
            # `occurred` already bounds the event by its observation and clock.
            qualified = qualified and dates["filing_date"] is not None and dates["filing_date"] == dates["event_date"]
    elif status == "CONFIRMED":
        qualified = evidence and kind == "OFFICIAL_SCHEDULE" and dates["event_date"] is not None
    elif status == "CANCELLED":
        qualified = evidence and kind == "OFFICIAL_CANCELLATION"
    reasons = []
    if not qualified:
        reasons.append("STATUS_NOT_ATTESTED")
    if dates["event_date"] is None:
        reasons.append("EVENT_DATE_UNKNOWN")
    if status == "ESTIMATED" and dates["event_date"] is not None and dates["event_date"] < clock.date():
        reasons.append("ESTIMATE_OVERDUE")
    if status == "REPORTED" and qualified and kind == "AGGREGATOR_RESULT":
        reasons.append("NOT_OFFICIAL_CONFIRMATION")
    return {**raw, "version": VERSION, "evaluated_at": now,
            "event_key": "publication:" + _digest([raw[k] for k in ("provider", "issuer", "event_type", "event_id")]),
            "effective_status": status if qualified else "UNKNOWN",
            "proof_state": kind if qualified and status != "ESTIMATED" else "UNATTESTED",
            "event_time_utc": stamp.isoformat() if stamp else None,
            "reason_codes": reasons, "operational_authority": False}


def publication_revisions(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Idempotent replay, never silently overwrite a conflicting revision."""
    if not isinstance(rows, (list, tuple)) or len(rows) > 2000:
        raise ContractError("INVALID_REVISION_ROWS")
    revisions: dict[tuple[str, str], dict[str, Any]] = {}
    clocks = {row.get("evaluated_at") for row in rows}
    if len(clocks) > 1 or (rows and None in clocks):
        raise ContractError("REVISION_EVALUATION_MISMATCH")
    for row in rows:
        if row.get("version") != VERSION or row.get("scope") != SCOPE:
            raise ContractError("INVALID_REVISION_CONTRACT")
        if not EVENT_FIELDS.issubset(row) or prepare_publication({k: row[k] for k in EVENT_FIELDS}, now=row["evaluated_at"]) != row:
            raise ContractError("INVALID_REVISION_CONTRACT")
        key = (row["event_key"], row["revision_id"])
        if key in revisions and revisions[key] != row:
            raise ContractError("REVISION_CONFLICT")
        revisions[key] = dict(row)
    for row in revisions.values():
        previous = row["supersedes_revision_id"]
        seen = {row["revision_id"]}
        while previous is not None:
            if previous in seen or (row["event_key"], previous) not in revisions:
                raise ContractError("INVALID_REVISION_CHAIN")
            seen.add(previous)
            previous = revisions[(row["event_key"], previous)]["supersedes_revision_id"]
    return [revisions[key] for key in sorted(revisions)]


def strict_ttm(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Exactly four explicitly discrete, consecutive, comparable quarters.

    SQL companion consumes the same typed rows. Unknown start, currency, basis,
    scope or definition closes the gate; per-metric missing inputs remain null.
    """
    if not isinstance(rows, (list, tuple)) or len(rows) > 8:
        raise ContractError("INVALID_TTM_ROWS")
    fields = {"instrument_key", "fiscal_year", "period_kind", "period_start", "period_end",
              "currency", "basis", "calendar_basis", "definition", "scope", "source_ref", *METRICS}
    parsed = []
    for row in rows:
        _shape(row, fields)
        for key in ("instrument_key", "definition", "scope", "source_ref"):
            _token(row[key], nullable=True)
        start = _date(row["period_start"]) if row["period_start"] is not None else None
        end = _date(row["period_end"]) if row["period_end"] is not None else None
        if row["currency"] is not None and (not isinstance(row["currency"], str) or len(row["currency"]) != 3 or not row["currency"].isascii() or not row["currency"].isalpha() or row["currency"] != row["currency"].upper()):
            raise ContractError("INVALID_CURRENCY")
        if row["fiscal_year"] is not None and (type(row["fiscal_year"]) is not int or not 1900 <= row["fiscal_year"] <= 9999):
            raise ContractError("INVALID_FISCAL_YEAR")
        for field in METRICS:
            value = row[field]
            if value is not None and (type(value) not in (int, float) or abs(value) > MAX_SAFE_NUMBER or not math.isfinite(value)):
                raise ContractError("INVALID_TTM_VALUE")
        parsed.append((row, start, end))
    valid = len(parsed) == 4
    for key in ("instrument_key", "currency", "basis", "calendar_basis", "definition", "scope"):
        values = {r[key] for r, _, _ in parsed}
        valid &= len(values) == 1 and None not in values
    valid &= all(r["source_ref"] and r["basis"] == "DISCRETE" and r["period_kind"] in {"Q1", "Q2", "Q3", "Q4"} and r["fiscal_year"] is not None and start and end and start <= end for r, start, end in parsed)
    ordered = sorted(parsed, key=lambda item: item[1] or date.min)
    if valid:
        basis = ordered[0][0]["calendar_basis"]
        for r, start, end in ordered:
            days = (end - start).days + 1
            if basis == "CALENDAR":
                valid &= start.day == 1 and end.day == calendar.monthrange(end.year, end.month)[1] and ((end.year - start.year) * 12 + end.month - start.month) == 2
            elif basis == "WEEK_52_53":
                valid &= days in {84, 91, 98}
            else:
                valid = False
        for (a, _, end), (b, start, _) in zip(ordered, ordered[1:]):
            valid &= start == end + timedelta(days=1)
            valid &= b["fiscal_year"] * 4 + int(b["period_kind"][1]) == a["fiscal_year"] * 4 + int(a["period_kind"][1]) + 1
        if basis == "WEEK_52_53":
            valid &= (ordered[-1][2] - ordered[0][1]).days + 1 in {364, 371}
    values = {}
    for field in METRICS:
        total = sum(r[field] for r, _, _ in ordered) if valid and all(r[field] is not None for r, _, _ in ordered) else None
        values[field] = total if total is None or (math.isfinite(total) and abs(total) <= MAX_SAFE_NUMBER) else None
    return {"complete": bool(valid), "currency": ordered[0][0]["currency"] if valid else None,
            "period_start": ordered[0][1].isoformat() if valid else None,
            "period_end": ordered[-1][2].isoformat() if valid else None,
            "reason_codes": (["INCOMPARABLE_QUARTERS"] if not valid else []) + [f"{k.upper()}_UNAVAILABLE" for k, v in values.items() if v is None],
            **values}
