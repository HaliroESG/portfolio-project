"""L3 synthetic contracts, with real offline PostgreSQL SQL/Python parity."""
import copy
import json
import os
import re
import subprocess
import tempfile
from datetime import date, timedelta
from pathlib import Path

import pytest

from publication_contracts import METRICS, prepare_publication, publication_revisions, strict_ttm
from source_contracts import ContractError

FIXTURES = json.loads((Path(__file__).parent / "fixtures/publication_contracts_v1.json").read_text())


def ttm_case(case):
    rows = copy.deepcopy(FIXTURES["ttm_base"])
    if "row" in case:
        rows[case["row"]].update(case["patch"])
    if case.get("duplicate"):
        rows[1] = copy.deepcopy(rows[0])
    if "revenues" in case:
        for row, value in zip(rows, case["revenues"]):
            row["revenue"] = value
    if "weekly" in case:
        start = date(2025, 9, 28)
        for i, row in enumerate(rows):
            days = (13 if i < 3 else case["weekly"] - 39) * 7
            row.update(period_start=start.isoformat(), period_end=(start + timedelta(days=days - 1)).isoformat(), calendar_basis="WEEK_52_53")
            start += timedelta(days=days)
    if case.get("reverse"):
        rows.reverse()
    return rows[:case.get("take", 4)]


@pytest.mark.parametrize("case", FIXTURES["event_cases"], ids=lambda c: c["id"])
def test_event_proof_not_calendar_age(case):
    result = prepare_publication({**FIXTURES["event_base"], **case["patch"]}, now=FIXTURES["now"])
    assert result["effective_status"] == case["expected"]["status"]
    assert result["reason_codes"] == case["expected"]["reasons"]
    assert result["operational_authority"] is False


@pytest.mark.parametrize("patch", [{"scope": "LIVE"}, {"event_date": "2026-02-30"},
    {"event_time": "2026-10-17T20:00:00"}, {"event_time": "2026-10-18T00:00:00Z"},
    {"actual_eps": float("nan")}, {"fiscal_year": True}, {"status": "SUCCESS"}])
def test_invalid_event_never_qualifies(patch):
    with pytest.raises(ContractError):
        prepare_publication({**FIXTURES["event_base"], **patch}, now=FIXTURES["now"])


def test_reschedule_cancel_and_amendment_keep_history():
    def event(**patch):
        return prepare_publication({**FIXTURES["event_base"], **patch}, now=FIXTURES["now"])
    first = event()
    second = event(revision_id="revision-2", supersedes_revision_id="revision-1", event_date="2026-10-21")
    third = event(revision_id="revision-3", supersedes_revision_id="revision-2", status="CANCELLED", proof_kind="OFFICIAL_CANCELLATION", source_ref="cancel", observed_at="2026-10-18T09:00:00Z")
    amendment = event(event_id="filing-amendment", event_type="REGULATORY_FILING", amends_event_id="filing-original")
    result = publication_revisions([third, first, second, first, amendment])
    assert len(result) == 4
    assert first["event_key"] == second["event_key"] == third["event_key"]
    assert amendment["event_key"] != first["event_key"]
    with pytest.raises(ContractError, match="REVISION_CONFLICT"):
        publication_revisions([first, event(event_date="2026-10-20")])
    with pytest.raises(ContractError, match="INVALID_REVISION_CHAIN"):
        publication_revisions([third])
    with pytest.raises(ContractError, match="REVISION_EVALUATION_MISMATCH"):
        publication_revisions([first, prepare_publication(FIXTURES["event_base"], now="2026-10-19T12:00:00Z")])
    for patch in ({"operational_authority": True}, {"effective_status": "REPORTED"}, {"event_key": "forged"}):
        with pytest.raises(ContractError, match="INVALID_REVISION_CONTRACT"):
            publication_revisions([{**first, **patch}])


@pytest.mark.parametrize("case", FIXTURES["ttm_cases"], ids=lambda c: c["id"])
def test_strict_ttm(case):
    result = strict_ttm(ttm_case(case))
    assert result["complete"] == case["complete"]
    if not case["complete"]:
        assert all(result[k] is None for k in METRICS)
    else:
        for key in case.get("null_metrics", []):
            assert result[key] is None
        assert result["free_cash_flow"] == -20
        if "expected_revenue" in case:
            assert result["revenue"] == case["expected_revenue"]


@pytest.mark.parametrize("value", [True, "3", float("inf"), float("nan"), 9007199254740992, 10 ** 400])
def test_invalid_numeric_ttm(value):
    rows = copy.deepcopy(FIXTURES["ttm_base"])
    rows[0]["revenue"] = value
    with pytest.raises(ContractError):
        strict_ttm(rows)


@pytest.mark.parametrize("field", ["period_start", "period_end"])
@pytest.mark.parametrize("value", FIXTURES["ttm_invalid_dates"])
def test_invalid_civil_dates_never_coerce(field, value):
    rows = copy.deepcopy(FIXTURES["ttm_base"])
    rows[0][field] = value
    with pytest.raises(ContractError, match="INVALID_DATE"):
        strict_ttm(rows)


def test_postgresql_single_user_same_fixtures():
    # Single-user mode has NO server socket, credentials, service or network.
    pg = Path("/opt/homebrew/opt/postgresql@15/bin")
    if not (pg / "postgres").exists():
        pytest.skip("PostgreSQL 15 binaries unavailable; SQL parity NOT VERIFIED")
    sql = (Path(__file__).parents[1] / "sql/contracts/publication_ttm_v1.sql").read_text()
    sql = " ".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))
    queries = []
    for case in FIXTURES["ttm_cases"]:
        literal = json.dumps(ttm_case(case), allow_nan=False).replace("'", "''")
        queries.append(sql.replace("/*INPUT_JSON*/", "'" + literal + "'::jsonb"))
    malformed = []
    malformed_patches = [{"revenue": "1"}, {"fiscal_year": "2026"}, {"unexpected": 1}, {"scope": " "}]
    malformed_patches.extend({field: value} for field in ("period_start", "period_end")
                             for value in FIXTURES["ttm_invalid_dates"])
    for patch in malformed_patches:
        rows = copy.deepcopy(FIXTURES["ttm_base"])
        rows[0].update(patch)
        with pytest.raises(ContractError):
            strict_ttm(rows)
        malformed.append(rows)
        queries.append(sql.replace("/*INPUT_JSON*/", "'" + json.dumps(rows).replace("'", "''") + "'::jsonb"))
    env = {"PATH": os.defpath, "LANG": "C", "LC_ALL": "C"}
    with tempfile.TemporaryDirectory(prefix="astrocyte-l3-pg-", dir="/tmp") as folder:
        data = str(Path(folder) / "data")
        init = subprocess.run([str(pg / "initdb"), "-D", data, "--no-locale", "--encoding=UTF8", "-A", "trust"], env=env, text=True, capture_output=True, timeout=30)
        assert init.returncode == 0, init.stderr
        run = subprocess.run([str(pg / "postgres"), "--single", "-D", data, "postgres"], input="\n".join(queries) + "\n", env=env, text=True, capture_output=True, timeout=30)
        assert run.returncode == 0, run.stderr
        assert "ERROR:" not in run.stderr and "FATAL:" not in run.stderr, run.stderr
        outputs = [json.loads(m) for m in re.findall(r'row_to_json = "(.*)"', run.stdout)]
        assert len(outputs) == len(queries), run.stdout[:2000]
        for case, actual in zip(FIXTURES["ttm_cases"], outputs):
            assert actual == strict_ttm(ttm_case(case)), case["id"]
        for result in outputs[len(FIXTURES["ttm_cases"]):]:
            assert result["complete"] is False
            assert all(result[k] is None for k in METRICS)
