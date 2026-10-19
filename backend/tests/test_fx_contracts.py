"""L1 fixtures only. No provider, database or environment dependency."""
import ast
from copy import deepcopy
import importlib
import json
import os
from pathlib import Path
import socket

import pytest

import fx_contracts as fx
from source_contracts import ContractError


DATA = json.loads((Path(__file__).parent / "fixtures" / "fx_contracts_v1.json").read_text())
BASE = DATA["cases"][0]


def prepare(case=BASE, **kwargs):
    return fx.prepare_fx_series(case["rows"], currency=case["currency"], now=DATA["now"],
                                calendar=kwargs.get("calendar", case["calendar"]))


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    def deny(*_args, **_kwargs):
        raise AssertionError("OFFLINE_NETWORK_DENIED")
    monkeypatch.setattr(socket.socket, "connect", deny)
    monkeypatch.setattr(socket.socket, "sendto", deny)
    monkeypatch.setattr(socket, "getaddrinfo", deny)


@pytest.mark.parametrize("case", DATA["cases"], ids=lambda case: case["id"])
def test_fx_acceptance(case):
    result = prepare(case)
    expected = case["expected"]
    assert result["scope"] == "OFFLINE_SYNTHETIC"
    assert result["operational_authority"] is False
    assert result["status"] == expected["status"]
    if expected["change"] is None:
        assert result["change_pct"] is None
    else:
        assert result["change_pct"] == pytest.approx(expected["change"])
    assert (result["current"]["session_age"] if result["current"] else None) == expected["age"]
    if "rate" in expected:
        assert result["current"]["observation"]["value"] == expected["rate"]
    if "inverse" in expected:
        assert result["inverse_change_pct"] == pytest.approx(expected["inverse"])
        assert result["inverse_change_pct"] != -result["change_pct"]
    if "comparison_reason" in expected:
        assert expected["comparison_reason"] in result["comparison_reason_codes"]
    assert len(result["observations"]) == len(case["rows"])
    assert prepare({**case, "rows": list(reversed(case["rows"]))}) == result


def test_pure_import_and_replay_no_environment(monkeypatch):
    def deny(*_args, **_kwargs):
        raise AssertionError("ENVIRONMENT_FORBIDDEN")
    monkeypatch.setattr(os, "getenv", deny)
    monkeypatch.setattr(type(os.environ), "__getitem__", deny)
    importlib.reload(fx)
    assert prepare()["status"] == "VALIDATED"
    tree = ast.parse(Path(fx.__file__).read_text())
    imports = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(n.name.split(".")[0] for n in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.add(node.module.split(".")[0])
    assert imports == {"__future__", "typing", "source_contracts"}


@pytest.mark.parametrize("ticker", ["MSFT", "USD", "BTC-USD", "USD=X", "AAAEUR=X", "EUREUR=X", "EURUSD=X", "USDEUR", "USDEUR=X "])
def test_explicit_pilot_identity(ticker):
    case = deepcopy(BASE)
    case["rows"][0]["ticker"] = ticker
    with pytest.raises(ContractError, match="FX_PAIR_MISMATCH"):
        prepare(case)


@pytest.mark.parametrize("currency", ["EUR", "CAD", "USD/EUR", "usd", None, True])
def test_outside_pilot(currency):
    with pytest.raises(ContractError, match="FX_OUTSIDE_PILOT"):
        prepare({**BASE, "currency": currency})


@pytest.mark.parametrize("value", [0, -1, "", "0.99", True, float("nan"), float("inf"), 2**53, 10**400])
def test_invalid_values_never_normalized(value):
    case = deepcopy(BASE)
    case["rows"][0]["observation"]["value"] = value
    with pytest.raises(ContractError):
        prepare(case)


@pytest.mark.parametrize("key,value", [("domain", "MACRO"), ("key", "FX:GBP:EUR"), ("frequency", "EVENT"),
                                      ("period", {"start": "2026-10-01", "end": "2026-10-15"})])
def test_l0_identity_cannot_drift(key, value):
    case = deepcopy(BASE)
    case["rows"][0]["observation"][key] = value
    with pytest.raises(ContractError, match="FX_IDENTITY_MISMATCH"):
        prepare(case)


@pytest.mark.parametrize("field,value", [("scope", "LIVE"), ("date_basis", "LOCAL"), ("version", None),
    ("sessions", []), ("sessions", ["2026-10-16", "2026-10-15"]),
    ("sessions", ["2026-10-16", "2026-10-16"]), ("sessions", ["2026-02-30"]),
    ("expected_session", "2026-10-15"), ("evaluated_on", "2026-10-17")])
def test_calendar_must_be_explicit_versioned_and_ordered(field, value):
    calendar = {**BASE["calendar"], field: value}
    with pytest.raises(ContractError):
        prepare(calendar=calendar)


def test_calendar_provider_mismatch_stays_unknown():
    out = prepare(calendar={**BASE["calendar"], "provider": "fixture-other"})
    assert out["status"] == "UNKNOWN"
    assert out["current"]["session_age"] is None
    assert out["change_pct"] is None


def test_collection_never_becomes_market_date():
    result = prepare()
    observation = result["current"]["observation"]
    assert observation["identity"]["observed_date"] == "2026-10-16"
    assert observation["collected_at"] == "2026-10-18T10:00:00Z"
    assert result["current"]["session_age"] == 0
    assert observation["freshness"]["source_age_calendar_days"] == 2
    case = deepcopy(BASE)
    for row in case["rows"]:
        row["observation"]["observed"] = None
    assert prepare(case)["change_pct"] is None


def test_duplicate_replay_keeps_earliest_collection():
    case = next(case for case in DATA["cases"] if case["id"] == "idempotent_duplicate")
    assert prepare(case)["current"]["observation"]["collected_at"] == "2026-10-18T10:00:00Z"


def test_unrepresentable_ratio_cannot_escape():
    case = deepcopy(BASE)
    case["rows"][0]["observation"]["value"] = 5e-324
    result = prepare(case)
    assert result["change_pct"] is None
    assert result["inverse_change_pct"] is None
    assert "UNREPRESENTABLE_VARIATION" in result["comparison_reason_codes"]


def test_conflicting_provenance_is_not_merged():
    case = deepcopy(BASE)
    same = deepcopy(case["rows"][-1])
    same["observation"]["source"]["provider"] = "fixture-other"
    case["rows"].append(same)
    result = prepare(case)
    assert result["status"] == "CONFLICT"
    assert result["change_pct"] is None
    assert len(result["conflicts"][0]["revision_ids"]) == 2


@pytest.mark.parametrize("refs", [("rights-A", "rights-B"), (None, "rights-B")])
@pytest.mark.parametrize("row_index", [0, 1])
def test_rights_divergence_conflicts_on_any_session(refs, row_index):
    case = deepcopy(BASE)
    original = case["rows"][row_index]
    original["observation"]["rights_ref"] = refs[0]
    duplicate = deepcopy(original)
    duplicate["observation"]["rights_ref"] = refs[1]
    case["rows"].append(duplicate)
    result = prepare(case)
    assert result["status"] == "CONFLICT"
    assert result["change_pct"] is None
    assert result["inverse_change_pct"] is None
    assert result["operational_authority"] is False
    assert "CONFLICTING_DAILY_OBSERVATIONS" in result["reason_codes"]
    conflict = result["conflicts"][0]
    day = original["observation"]["observed"]["value"]
    assert conflict["observed_date"] == day
    # L0 revision identity is deliberately unchanged; L1 also checks rights_ref.
    assert len(conflict["revision_ids"]) == 1
    assert len(result["observations"]) == len(case["rows"])
    assert {entry["observation"]["rights_ref"] for entry in result["observations"]
            if entry["observation"]["identity"]["observed_date"] == day} == set(refs)
    assert prepare({**case, "rows": list(reversed(case["rows"]))}) == result


@pytest.mark.parametrize("rights_ref", [None, "rights-A"])
def test_identical_rights_replay_retains_earliest_collection(rights_ref):
    case = deepcopy(BASE)
    replay = deepcopy(case["rows"][-1])
    replay["observation"]["collected_at"] = "2026-10-18T11:00:00Z"
    replay["observation"]["run_id"] = "fixture:replay"
    case["rows"].append(replay)
    for row in case["rows"]:
        row["observation"]["rights_ref"] = rights_ref
    result = prepare(case)
    assert result["status"] == "VALIDATED"
    assert result["conflicts"] == []
    assert result["current"]["observation"]["collected_at"] == "2026-10-18T10:00:00Z"
    assert result["current"]["observation"]["rights_ref"] == rights_ref
    assert result["change_pct"] == pytest.approx(0.1)
    assert result["inverse_change_pct"] == pytest.approx(-1 / 11)
    assert prepare({**case, "rows": list(reversed(case["rows"]))}) == result


def test_input_is_immutable():
    case = deepcopy(BASE)
    before = deepcopy(case)
    prepare(case)
    assert case == before
