"""L0 acceptance scenarios T00-01..06; only synthetic, preloaded inputs."""
import ast
from copy import deepcopy
import importlib
import json
import os
from pathlib import Path
import socket
import sys
import types

import pytest

import source_contracts as contracts


FIXTURE = Path(__file__).parent / "fixtures" / "source_contracts_v1.json"
DATA = json.loads(FIXTURE.read_text())
NOW = DATA["now"]
BASE = DATA["cases"][0]["input"]
POLICY = DATA["cases"][0]["policy"]


@pytest.fixture(autouse=True)
def refuse_network(monkeypatch):
    # Also protects this module under plain pytest, without the optional plugin.
    def denied(*_args, **_kwargs):
        raise RuntimeError("OFFLINE_NETWORK_DENIED")
    monkeypatch.setattr(socket.socket, "connect", denied)
    monkeypatch.setattr(socket.socket, "sendto", denied)
    monkeypatch.setattr(socket, "getaddrinfo", denied)


def normalize(raw=None, **kwargs):
    return contracts.normalize_observation(
        BASE if raw is None else raw, now=kwargs.get("now", NOW),
        policy=kwargs.get("policy", POLICY),
    )


def test_t00_01_import_without_environment_or_clients(monkeypatch):
    def forbidden(*_args, **_kwargs):
        raise AssertionError("FORBIDDEN_ENVIRONMENT_OR_CLIENT")
    monkeypatch.setattr(os, "getenv", forbidden)
    monkeypatch.setattr(type(os.environ), "__getitem__", forbidden)
    monkeypatch.setattr(type(os.environ), "__iter__", forbidden)
    fake = types.ModuleType("supabase")
    fake.create_client = forbidden
    monkeypatch.setitem(sys.modules, "supabase", fake)
    importlib.reload(contracts)
    assert normalize()["quality"] == "VALIDATED"
    tree = ast.parse(Path(contracts.__file__).read_text())
    imports = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(n.name.split(".")[0] for n in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.add(node.module.split(".")[0])
    assert imports <= {"__future__", "hashlib", "json", "math", "re", "datetime", "typing"}


def test_t00_01_network_tripwire():
    # Per-test tripwire; the optional plugin also protects initial collection.
    with socket.socket() as sock, pytest.raises(RuntimeError, match="OFFLINE_NETWORK_DENIED"):
        sock.connect(("127.0.0.1", 9))


def test_t00_02_zero_database_mutations(monkeypatch):
    calls = []

    class DeniedClient:
        def __getattr__(self, action):
            calls.append(action)
            raise AssertionError("REAL_CLIENT_FORBIDDEN")

    client = DeniedClient()
    fake = types.ModuleType("supabase")

    def create_client(*_args, **_kwargs):
        calls.append("create_client")
        return client

    fake.create_client = create_client
    monkeypatch.setitem(sys.modules, "supabase", fake)
    importlib.reload(contracts)
    for case in DATA["cases"]:
        result = contracts.replay_fixture(
            [{"outcome": "SUCCESS", "observation": case["input"]}],
            now=NOW, max_attempts=1, policy=case["policy"],
        )
        assert result["status"] == "PREPARED"
        assert result["operational_authority"] is False
    assert calls == []  # No client, etl_runs, target, insert/update/upsert/delete/rpc.
    for mutation in ("insert", "update", "upsert", "delete", "rpc"):
        with pytest.raises(AssertionError):
            getattr(client, mutation)


def decision(**kwargs):
    return {
        "scope": "OFFLINE_SYNTHETIC", "ref": "fixture:rights-1",
        "provider": "fixture-source", "status": "APPROVED", "usages": ["COLLECT"],
        "valid_from": "2026-10-01T00:00:00Z", "valid_until": "2026-11-01T00:00:00Z",
        **kwargs,
    }


@pytest.mark.parametrize("record,usage,reason,admissible", [
    (None, "COLLECT", "RIGHTS_MISSING", False),
    (decision(status="UNVERIFIED"), "COLLECT", "RIGHTS_UNVERIFIED", False),
    (decision(status="DENIED"), "COLLECT", "RIGHTS_DENIED", False),
    (decision(valid_until=NOW), "COLLECT", "RIGHTS_OUTSIDE_WINDOW", False),
    (decision(valid_from="2026-10-19T00:00:00Z"), "COLLECT", "RIGHTS_OUTSIDE_WINDOW", False),
    (decision(provider="other-source"), "COLLECT", "RIGHTS_PROVIDER_MISMATCH", False),
    (decision(), "STORE", "RIGHTS_USAGE_NOT_GRANTED", False),
    (decision(), "DISPLAY", "RIGHTS_USAGE_NOT_GRANTED", False),
    (decision(), "REPLAY", "RIGHTS_USAGE_NOT_GRANTED", False),
    (decision(), "COLLECT", "FIXTURE_RIGHTS_ADMISSIBLE", True),
])
def test_t00_03_usage_specific_rights(record, usage, reason, admissible):
    result = contracts.assess_rights(record, provider="fixture-source", usage=usage, now=NOW)
    assert result["admissible"] is admissible
    assert result["reason_code"] == reason
    assert result["operational_authority"] is False


@pytest.mark.parametrize("case", DATA["cases"], ids=lambda case: case["id"])
def test_t00_04_dates_units_states(case):
    out = contracts.normalize_observation(case["input"], now=NOW, policy=case["policy"])
    expected = case["expected"]
    assert out["quality"] == expected["quality"]
    assert out["reason_codes"] == expected["reason_codes"]
    assert out["identity"]["observed_date"] == expected["observed_date"]
    assert out["identity"]["observed_at"] == expected["observed_at"]
    assert out["value"] == case["input"]["value"]
    assert out["operational_authority"] is False
    assert out["freshness"]["collection_age_seconds"] == 7200
    assert out["freshness"]["source_age_calendar_days"] == (
        None if expected["observed_date"] is None
        else (contracts._date("2026-10-18") - contracts._date(expected["observed_date"])).days
    )


@pytest.mark.parametrize("value", [True, False, "", "0.91", float("nan"),
                                   float("inf"), -float("inf"), 10 ** 400, 0, -1])
def test_t00_04_invalid_fx_values(value):
    with pytest.raises(contracts.ContractError):
        normalize({**BASE, "value": value})


@pytest.mark.parametrize("value", ["2026-02-30", "20261018", "2026-1-01", "tomorrow"])
def test_t00_04_invalid_civil_dates(value):
    with pytest.raises(contracts.ContractError, match="INVALID_DATE"):
        normalize({**BASE, "observed": {"precision": "DATE", "value": value}})


@pytest.mark.parametrize("value", ["2026-10-18", "2026-10-18T10:00:00",
                                   "2026-02-30T10:00:00Z", "2026-10-18T24:00:00Z",
                                   "2026-10-18T10:00:00+00:99",
                                   "2026-10-18T10:00:00-00:00"])
def test_t00_04_invalid_collection_timestamp(value):
    with pytest.raises(contracts.ContractError, match="INVALID_TIMESTAMP"):
        normalize({**BASE, "collected_at": value})


def test_t00_04_incomplete_derivation_provenance_and_policy():
    derived = {**BASE, "nature": "DERIVED"}
    assert normalize(derived)["quality"] == "PARTIAL"
    derived.update(formula_ref="fixture:formula-v1", input_refs=["fixture:input-1"])
    assert normalize(derived)["quality"] == "VALIDATED"
    assert normalize({**BASE, "unit": None})["quality"] == "PARTIAL"
    raw = deepcopy(BASE)
    raw["source"]["evidence_ref"] = None
    assert normalize(raw)["quality"] == "PARTIAL"
    assert normalize(policy={**POLICY, "provider": "other"})["quality"] == "UNKNOWN"
    assert normalize(policy={**POLICY, "calendar_ref": None})["quality"] == "UNKNOWN"
    assert normalize(policy={**POLICY, "evaluated_on": "2026-10-17"})["quality"] == "UNKNOWN"
    assert normalize({**BASE, "collected_at": "2026-10-19T00:00:00Z"})["quality"] == "UNKNOWN"
    assert normalize({**BASE, "nature": "UNKNOWN"})["quality"] == "UNKNOWN"
    monthly = {**BASE, "frequency": "MONTHLY"}
    assert normalize(monthly, policy={**POLICY, "frequency": "MONTHLY"})["quality"] == "PARTIAL"


def test_t00_04_no_collection_based_rejuvenation():
    old = deepcopy(BASE)
    old["observed"]["value"] = "2026-09-01"
    old["collected_at"] = NOW
    out = normalize(old)
    assert out["quality"] == "STALE"
    assert out["freshness"]["source_age_calendar_days"] == 47
    assert out["freshness"]["collection_age_seconds"] == 0
    assert out["identity"]["precision"] == "DATE"
    assert out["identity"]["observed_at"] is None


def test_t00_05_deterministic_non_mutating_replay_and_revisions(capsys):
    raw, policy = deepcopy(BASE), deepcopy(POLICY)
    before = json.dumps([raw, policy], sort_keys=True)
    first, second = normalize(raw, policy=policy), normalize(raw, policy=policy)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert json.dumps([raw, policy], sort_keys=True) == before
    recollected = normalize({**raw, "collected_at": NOW, "run_id": "fixture:run-2"})
    assert recollected["observation_id"] == first["observation_id"]
    assert recollected["revision_id"] == first["revision_id"]
    revised = normalize({**raw, "value": 0.92})
    assert revised["observation_id"] == first["observation_id"]
    assert revised["revision_id"] != first["revision_id"]
    assert capsys.readouterr() == ("", "")


@pytest.mark.parametrize("field,value", [
    ("scope", "PRODUCTION"), ("source", {"token": "SYNTHETIC_DO_NOT_LOG"}),
    ("run_id", "https://example.invalid/?token=SYNTHETIC_DO_NOT_LOG"),
    ("formula_ref", "SYNTHETIC_DO_NOT_LOG\nPRIVATE"),
])
def test_t00_05_sanitized_errors_and_closed_scope(field, value):
    with pytest.raises(contracts.ContractError) as error:
        normalize({**BASE, field: value})
    assert "SYNTHETIC_DO_NOT_LOG" not in str(error.value)
    with pytest.raises(contracts.ContractError, match="INVALID_SHAPE"):
        normalize({**BASE, "secret": "SYNTHETIC_DO_NOT_LOG"})


def test_t00_06_bounded_failures_preserve_dated_last_known():
    previous = deepcopy(BASE)
    previous["observed"]["value"] = "2026-10-01"
    previous["collected_at"] = "2026-10-02T00:00:00Z"
    steps = [{"outcome": kind, "observation": None}
             for kind in ("NETWORK_ERROR", "TIMEOUT", "RATE_LIMITED")]
    steps.append({"outcome": "SUCCESS", "observation": BASE})
    result = contracts.replay_fixture(steps, now=NOW, max_attempts=3,
                                      policy=POLICY, previous=previous)
    assert result["attempt_count"] == 3
    assert result["status"] == "EXHAUSTED"
    assert result["reason_codes"] == [
        "NETWORK_ERROR", "TIMEOUT", "RATE_LIMITED", "ATTEMPT_BUDGET_EXHAUSTED"]
    assert result["current"] is None
    assert result["last_known"]["collected_at"] == previous["collected_at"]
    assert result["last_known"]["identity"]["observed_date"] == "2026-10-01"
    assert result["last_known"]["quality"] == "STALE"


def test_t00_06_stop_success_schema_failure_and_invalid_payload():
    success = {"outcome": "SUCCESS", "observation": BASE}
    schema = {"outcome": "SCHEMA_CHANGED", "observation": None}
    assert contracts.replay_fixture([success, schema], now=NOW, max_attempts=2,
                                    policy=POLICY)["attempt_count"] == 1
    assert contracts.replay_fixture([schema, success], now=NOW, max_attempts=2,
                                    policy=POLICY)["status"] == "FAILED"
    result = contracts.replay_fixture([{"outcome": "SUCCESS", "observation": {}}],
                                      now=NOW, max_attempts=1, policy=POLICY)
    assert result["reason_codes"] == ["CONTRACT_INVALID"]
    assert result["status"] == "FAILED"
    assert contracts.replay_fixture([], now=NOW, max_attempts=1)["reason_codes"] == [
        "FIXTURE_OUTCOMES_EXHAUSTED"]


@pytest.mark.parametrize("budget", [0, -1, 6, True, 1.5, None])
def test_t00_06_invalid_retry_budget(budget):
    with pytest.raises(contracts.ContractError, match="INVALID_ATTEMPT_BUDGET"):
        contracts.replay_fixture([], now=NOW, max_attempts=budget)


def test_t00_06_no_real_provider_or_arbitrary_error():
    with pytest.raises(contracts.ContractError):
        contracts.replay_fixture(lambda: BASE, now=NOW, max_attempts=1)
    with pytest.raises(contracts.ContractError, match="INVALID_ENUM"):
        contracts.replay_fixture([{"outcome": "SECRET_ERROR_TEXT", "observation": None}],
                                  now=NOW, max_attempts=1)


@pytest.mark.parametrize("patch,policy_patch,code", [
    ({"domain": "UNKNOWN"}, {}, "INVALID_ENUM"),
    ({"unit": "PERCENT"}, {}, "INVALID_FX_UNIT"),
    ({"currency": "EUR"}, {}, "UNEXPECTED_CURRENCY"),
    ({"formula_ref": "fixture:unexpected"}, {}, "UNEXPECTED_DERIVATION"),
    ({"input_refs": ["fixture:a", "fixture:a"]}, {}, "DUPLICATE_INPUT_REFS"),
    ({"period": {"start": "2026-10-16", "end": "2026-10-01"}}, {}, "INVALID_PERIOD"),
    ({}, {"not_before": "2026-10-19"}, "INVALID_POLICY_FLOOR"),
])
def test_closed_contract_rejects_invalid_metadata(patch, policy_patch, code):
    with pytest.raises(contracts.ContractError, match=code):
        normalize({**BASE, **patch}, policy={**POLICY, **policy_patch})


def test_publication_period_and_currency_are_not_inferred():
    raw = deepcopy(DATA["cases"][7]["input"])
    policy = DATA["cases"][7]["policy"]
    assert normalize({**raw, "currency": None}, policy=policy)["quality"] == "PARTIAL"
    raw["period"]["end"] = "2026-12-31"
    assert normalize(raw, policy=policy)["quality"] == "UNKNOWN"


def test_t00_06_incomplete_or_unknown_previous_is_not_last_valid():
    raw = deepcopy(BASE)
    raw["observed"]["value"] = "2026-10-01"
    raw["source"]["evidence_ref"] = None
    for previous in ({}, raw, {**BASE, "observed": None}):
        with pytest.raises(contracts.ContractError):
            contracts.replay_fixture([], now=NOW, max_attempts=1,
                                     policy=POLICY, previous=previous)


def test_t00_03_malformed_rights_never_admissible():
    for record in (
        decision(scope="PRODUCTION"),
        decision(valid_until="not-a-date"),
        decision(valid_from="2026-11-01T00:00:00Z"),
        decision(usages=["COLLECT", "COLLECT"]),
    ):
        with pytest.raises(contracts.ContractError):
            contracts.assess_rights(record, provider="fixture-source", usage="COLLECT", now=NOW)


def test_t00_06_previous_cannot_belong_to_another_series():
    result = contracts.replay_fixture(
        [{"outcome": "SUCCESS", "observation": {**BASE, "key": "JPY:EUR"}}],
        now=NOW, max_attempts=1, policy=POLICY, previous=BASE,
    )
    assert result["status"] == "FAILED"
    assert result["reason_codes"] == ["OBSERVATION_IDENTITY_MISMATCH"]
    assert result["current"] is None
    assert result["last_known"]["identity"]["key"] == "USD:EUR"


def test_t00_06_recovery_is_deterministic_and_retains_previous_dates():
    steps = [{"outcome": "TIMEOUT", "observation": None},
             {"outcome": "SUCCESS", "observation": BASE}]
    args = {"now": NOW, "max_attempts": 2, "policy": POLICY, "previous": BASE}
    first = contracts.replay_fixture(steps, **args)
    assert first == contracts.replay_fixture(steps, **args)
    assert first["attempt_count"] == 2
    assert first["status"] == "PREPARED"
    assert first["reason_codes"] == ["TIMEOUT"]
    assert first["current"]["observation_id"] == first["last_known"]["observation_id"]
    assert first["last_known"]["collected_at"] == BASE["collected_at"]


def test_r1_precision_collision_probe():
    # Original P1: these distinct integers collapsed to one value/revision.
    for value in (9007199254740992, 9007199254740993):
        with pytest.raises(contracts.ContractError, match="UNSAFE_NUMBER"):
            normalize({**BASE, "value": value})


def test_r1_chronology_regression_probe():
    # Original P2: a stale older response was PREPARED with no replay reason.
    old = deepcopy(BASE)
    old["observed"]["value"] = "2026-10-01"
    old["collected_at"] = "2026-10-02T00:00:00Z"
    result = contracts.replay_fixture(
        [{"outcome": "SUCCESS", "observation": old}], now=NOW,
        max_attempts=1, policy=POLICY, previous=BASE,
    )
    assert result["status"] == "FAILED"
    assert result["reason_codes"] == ["OBSERVATION_REGRESSION"]
    assert result["current"] is None
    assert result["last_known"] == normalize(BASE)


@pytest.mark.parametrize("domain", ["FX", "MACRO", "PUBLICATION"])
@pytest.mark.parametrize("value", [
    2 ** 53, 2 ** 53 + 1, -(2 ** 53), -(2 ** 53 + 1),
    float(2 ** 53), -float(2 ** 53), 10 ** 400,
])
def test_r1_unsafe_numbers_rejected_in_every_domain(domain, value):
    raw = {**BASE, "domain": domain, "value": value}
    with pytest.raises(contracts.ContractError, match="^UNSAFE_NUMBER$"):
        normalize(raw, policy={**POLICY, "domain": domain})


@pytest.mark.parametrize("value", [
    -(2 ** 53 - 1), -(2 ** 53 - 2), 0, 2 ** 53 - 2, 2 ** 53 - 1,
    float(2 ** 53 - 1), -float(2 ** 53 - 1), 0.125, -0.125, 5e-324,
])
def test_r1_safe_numeric_domain_remains_exact_for_supplied_values(value):
    raw = {**BASE, "domain": "MACRO", "unit": "RATIO", "value": value}
    out = normalize(raw, policy={**POLICY, "domain": "MACRO"})
    assert out["quality"] == "VALIDATED"
    assert out["value"] == value
    assert json.loads(json.dumps(out, allow_nan=False))["value"] == value
    assert out["operational_authority"] is False


def test_r1_safe_adjacent_integers_have_distinct_revisions():
    values = [2 ** 53 - 2, 2 ** 53 - 1]
    outputs = [normalize({**BASE, "value": value}) for value in values]
    assert outputs[0]["observation_id"] == outputs[1]["observation_id"]
    assert outputs[0]["revision_id"] != outputs[1]["revision_id"]
    assert outputs[0]["value"] != outputs[1]["value"]


def test_r1_unsafe_replay_does_not_replace_last_known():
    result = contracts.replay_fixture(
        [{"outcome": "SUCCESS", "observation": {**BASE, "value": 2 ** 53 + 1}}],
        now=NOW, max_attempts=1, policy=POLICY, previous=BASE,
    )
    assert result["status"] == "FAILED"
    assert result["reason_codes"] == ["CONTRACT_INVALID"]
    assert result["current"] is None
    assert result["last_known"] == normalize(BASE)


@pytest.mark.parametrize("previous_precision,previous_value,precision,value,reason", [
    ("DATE", "2026-10-16", "DATE", "2026-10-15", "OBSERVATION_REGRESSION"),
    ("DATE", "2026-10-16", "DATE", "2026-10-16", None),
    ("DATE", "2026-10-16", "DATE", "2026-10-17", None),
    ("TIMESTAMP", "2026-10-16T12:00:00Z", "TIMESTAMP", "2026-10-16T11:59:59Z",
     "OBSERVATION_REGRESSION"),
    ("TIMESTAMP", "2026-10-16T12:00:00Z", "TIMESTAMP", "2026-10-16T14:00:00+02:00", None),
    ("TIMESTAMP", "2026-10-16T12:00:00Z", "TIMESTAMP", "2026-10-16T12:00:00.000001Z", None),
    ("TIMESTAMP", "2026-10-16T23:30:00Z", "TIMESTAMP", "2026-10-17T00:30:00+02:00",
     "OBSERVATION_REGRESSION"),
    ("DATE", "2026-10-16", "TIMESTAMP", "2026-10-16T12:00:00Z", "OBSERVATION_ORDER_UNKNOWN"),
    ("TIMESTAMP", "2026-10-16T12:00:00Z", "DATE", "2026-10-16", "OBSERVATION_ORDER_UNKNOWN"),
    ("DATE", "2026-10-16", "TIMESTAMP", "2026-10-17T00:00:00Z", None),
    ("TIMESTAMP", "2026-10-16T23:59:59Z", "DATE", "2026-10-17", None),
    ("DATE", "2026-10-16", "TIMESTAMP", "2026-10-15T23:59:59Z", "OBSERVATION_REGRESSION"),
    ("TIMESTAMP", "2026-10-16T00:00:00Z", "DATE", "2026-10-15", "OBSERVATION_REGRESSION"),
    ("DATE", "2026-10-16", None, None, "OBSERVATION_ORDER_UNKNOWN"),
])
def test_r1_replay_observation_order(previous_precision, previous_value, precision, value, reason):
    previous = {**BASE, "observed": {"precision": previous_precision, "value": previous_value}}
    raw = {**BASE, "value": 0.92, "collected_at": NOW,
           "observed": {"precision": precision, "value": value} if precision else None}
    before = json.dumps([previous, raw], sort_keys=True)
    attempts = [{"outcome": "TIMEOUT", "observation": None},
                {"outcome": "SUCCESS", "observation": raw}]
    args = {"now": NOW, "max_attempts": 2, "policy": POLICY, "previous": previous}
    result = contracts.replay_fixture(attempts, **args)
    assert result == contracts.replay_fixture(attempts, **args)
    assert result["status"] == ("FAILED" if reason else "PREPARED")
    assert result["reason_codes"] == ["TIMEOUT"] + ([reason] if reason else [])
    assert result["current"] == (None if reason else normalize(raw))
    assert result["last_known"] == normalize(previous)
    assert result["attempt_count"] == 2
    assert result["operational_authority"] is False
    assert json.dumps([previous, raw], sort_keys=True) == before


@pytest.mark.parametrize("period,reason", [
    ({"start": "2026-04-01", "end": "2026-06-30"}, "PERIOD_REGRESSION"),
    ({"start": "2026-07-01", "end": "2026-07-31"}, None),
    ({"start": "2026-08-01", "end": "2026-08-31"}, None),
    ({"start": "2026-07-31", "end": "2026-08-31"}, "PERIOD_ORDER_UNKNOWN"),
    ({"start": "2026-07-01", "end": "2026-08-31"}, "PERIOD_ORDER_UNKNOWN"),
    ({"start": "2026-07-02", "end": "2026-07-30"}, "PERIOD_ORDER_UNKNOWN"),
    (None, "PERIOD_ORDER_UNKNOWN"),
])
def test_r1_replay_periods_do_not_hide_historical_or_ambiguous_points(period, reason):
    previous = {**BASE, "domain": "MACRO", "unit": "RATIO", "frequency": "MONTHLY",
                "period": {"start": "2026-07-01", "end": "2026-07-31"}}
    raw = {**previous, "period": period, "observed": {"precision": "DATE", "value": "2026-10-17"},
           "collected_at": NOW, "value": 0.92}
    policy = {**POLICY, "domain": "MACRO", "frequency": "MONTHLY"}
    result = contracts.replay_fixture(
        [{"outcome": "SUCCESS", "observation": raw}], now=NOW,
        max_attempts=1, policy=policy, previous=previous,
    )
    assert result["status"] == ("FAILED" if reason else "PREPARED")
    assert result["reason_codes"] == ([reason] if reason else [])
    assert result["current"] == (None if reason else normalize(raw, policy=policy))
    assert result["last_known"] == normalize(previous, policy=policy)


def test_r1_period_appearing_on_unperiodized_series_is_not_inferred():
    raw = {**BASE, "period": {"start": "2026-10-15", "end": "2026-10-16"}}
    result = contracts.replay_fixture(
        [{"outcome": "SUCCESS", "observation": raw}], now=NOW,
        max_attempts=1, policy=POLICY, previous=BASE,
    )
    assert result["status"] == "FAILED"
    assert result["reason_codes"] == ["PERIOD_ORDER_UNKNOWN"]
    assert result["current"] is None
    assert result["last_known"] == normalize(BASE)


def test_r1_no_previous_still_prepares_stale_data_without_upgrading_quality():
    raw = {**BASE, "observed": {"precision": "DATE", "value": "2026-10-01"}}
    result = contracts.replay_fixture(
        [{"outcome": "SUCCESS", "observation": raw}],
        now=NOW, max_attempts=1, policy=POLICY,
    )
    assert result["status"] == "PREPARED"
    assert result["current"]["quality"] == "STALE"
    assert result["current"]["reason_codes"] == ["OBSERVATION_STALE"]
    assert result["last_known"] is None
