"""Offline L2 acceptance, including hostile data and legacy integration guards."""
import ast
from copy import deepcopy
from datetime import date, timedelta
import importlib
import itertools
import json
import math
from pathlib import Path
from types import SimpleNamespace

import pytest

from macro_contracts import (
    ContractError, SERIES, derive_jpy_realized_volatility, derive_misery,
    macro_owner, parse_fred_csv, prepare_macro_series,
)

FIXTURE = json.loads((Path(__file__).parent / "fixtures/macro_contracts_v1.json").read_text())
NOW = FIXTURE["now"]
CASES = FIXTURE["cases"]


def evaluate(case):
    if case["kind"] == "series":
        return prepare_macro_series(case["rows"], series_id=case["series_id"], now=NOW, policy=case["policy"])
    if case["kind"] == "misery":
        return derive_misery(case["cpi"], case["unrate"], now=NOW, policies=case["policies"])
    return derive_jpy_realized_volatility(case["rows"], now=NOW, policy=case["policy"],
                                         result_policy=case["result_policy"], sessions=case["sessions"],
                                         calendar_ref=case["calendar_ref"])


def fixture(name):
    return deepcopy(next(c for c in CASES if c["id"] == name))


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_shared_fixture(case):
    before = deepcopy(case)
    actual = evaluate(case)
    assert case == before
    assert actual == evaluate(case)
    assert actual["status"] == case["expected"]["status"]
    value = case["expected"]["value"]
    assert actual["value"] == (pytest.approx(value, abs=1e-10) if value is not None else None)
    if "reason" in case["expected"]:
        assert case["expected"]["reason"] in actual["reason_codes"]
    assert actual["operational_authority"] is False
    assert actual["tactical_usable"] is False
    json.dumps(actual, allow_nan=False)


@pytest.mark.parametrize("name", ["competing-producers", "conflicting-rights", "revised-period", "identical-replay"])
def test_order_invariance_and_no_last_write_wins(name):
    case = fixture(name)
    expected = evaluate(case)
    for permutation in itertools.permutations(case["rows"]):
        assert evaluate({**case, "rows": list(permutation)}) == expected
    if name == "identical-replay":
        assert len(expected["observations"]) == 1
        assert expected["current"]["observation"]["collected_at"] == "2026-10-18T10:00:00Z"


def test_encoded_reference_cannot_impersonate_the_native_provider_id():
    case = fixture("daily-index")
    forged = deepcopy(case["rows"][0])
    forged["observation"]["source"]["native_id"] = "yahoo-index:VIX"
    case["rows"].append(forged)
    expected = evaluate(case)
    assert expected["status"] == "CONFLICT"
    assert expected["value"] is None
    assert len(expected["observations"]) == 2
    for permutation in itertools.permutations(case["rows"]):
        assert evaluate({**case, "rows": list(permutation)}) == expected


@pytest.mark.parametrize("value", [True, "", "NaN", float("nan"), float("inf"), -float("inf"), 2**54])
def test_non_numbers_and_unsafe_numbers_never_qualify(value):
    case = fixture("daily-index")
    case["rows"][0]["observation"]["value"] = value
    with pytest.raises(ContractError):
        evaluate(case)


@pytest.mark.parametrize("field,value", [("domain", "FX"), ("key", "MOVE"), ("frequency", "MONTHLY"), ("scope", "LIVE")])
def test_closed_bindings(field, value):
    case = fixture("daily-index")
    case["rows"][0]["observation"][field] = value
    with pytest.raises(ContractError):
        evaluate(case)


@pytest.mark.parametrize("field", ["producer", "provider", "native_id", "adapter_version", "evidence_ref"])
def test_provenance_missing_or_wrong_is_not_qualified(field):
    case = fixture("daily-index")
    if field == "producer":
        case["rows"][0][field] = "bridge"
    else:
        case["rows"][0]["observation"]["source"][field] = None
    assert evaluate(case)["status"] != "VALIDATED"
    assert evaluate(case)["tactical_usable"] is False


@pytest.mark.parametrize("patch,reason", [
    ({"evaluated_on": "2026-10-17"}, "CADENCE_POLICY_NOT_APPLICABLE"),
    ({"series_id": "MOVE"}, "CADENCE_POLICY_NOT_APPLICABLE"),
    ({"frequency": "MONTHLY"}, "CADENCE_POLICY_NOT_APPLICABLE"),
    ({"publication_due_at": "2026-10-19T18:00:00Z"}, "EXPECTED_PUBLICATION_NOT_DUE"),
])
def test_cadence_is_explicit_and_dated(patch, reason):
    case = fixture("daily-index")
    case["policy"].update(patch)
    assert evaluate(case)["status"] == "UNKNOWN"
    assert reason in evaluate(case)["reason_codes"]


@pytest.mark.parametrize("mutation", ["gap", "missing", "method", "future", "revision", "unit", "no-period"])
def test_misery_refuses_unsafe_history(mutation):
    case = fixture("misery-exact-months")
    if mutation == "gap":
        case["cpi"].pop(4)
    elif mutation == "revision":
        changed = deepcopy(case["cpi"][2])
        changed["observation"]["value"] += 1
        case["cpi"].append(changed)
    elif mutation == "method":
        case["cpi"][2]["observation"]["source"]["adapter_version"] = "other-method"
    elif mutation == "future":
        case["cpi"][2]["observation"]["observed"]["value"] = "2026-10-20"
    elif mutation == "unit":
        case["cpi"][2]["observation"]["unit"] = "RATIO"
    elif mutation == "no-period":
        case["cpi"][2]["observation"]["period"] = None
    else:
        case["cpi"][2]["observation"]["value"] = None
    assert evaluate(case)["value"] is None


def test_misery_lineage_and_reporting_period_are_preserved():
    actual = evaluate(fixture("misery-exact-months"))
    assert len(actual["inputs"]) == 14
    assert len(actual["current"]["observation"]["input_refs"]) == 14
    assert actual["current"]["observation"]["identity"]["period"] == {"start": "2026-09-01", "end": "2026-09-30"}
    assert actual["current"]["observation"]["identity"]["observed_date"] == "2026-10-15"
    assert actual["current"]["observation"]["nature"] == "DERIVED"
    assert actual["current"]["observation"]["rights_ref"] is None
    assert actual["formula_ref"] == "misery-cpi-yoy-unrate-v1"


@pytest.mark.parametrize("value", [0, -1, None])
def test_volatility_cannot_log_nonpositive_or_missing_prices(value):
    case = fixture("jpy-realized")
    case["rows"][1]["observation"]["value"] = value
    assert evaluate(case)["value"] is None


def test_jpy_is_realized_and_parameters_are_auditable():
    actual = evaluate(fixture("jpy-realized"))
    assert actual["parameters"]["kind"] == "REALIZED_NOT_IMPLIED"
    assert actual["parameters"]["ddof"] == 1
    assert actual["parameters"]["prices"] == 5
    assert actual["parameters"]["returns"] == 4
    assert actual["parameters"]["annualization"] == 252
    assert len(actual["current"]["observation"]["input_refs"]) == 5
    case = fixture("jpy-realized")
    case["calendar_ref"] = "other-calendar"
    assert evaluate(case)["value"] is None


def test_volatility_extreme_positive_prices_do_not_overflow_intermediate_ratios():
    case = fixture("jpy-realized")
    for row, value in zip(case["rows"], [1e-300, 1e10, 1e-300, 1e10, 1e-300]):
        row["observation"]["value"] = value
    actual = evaluate(case)
    assert actual["status"] == "VALIDATED"
    assert math.isfinite(actual["value"])
    assert actual["tactical_usable"] is False


@pytest.mark.parametrize("header", ["DATE", "observation_date"])
def test_fred_headers_explicitly_supported_without_fabricating_release_date(header):
    parsed = parse_fred_csv(f"{header},CPIAUCSL\n2026-09-01,306\n", "CPIAUCSL")
    assert parsed == {"status": "PARSED", "rows": [{"period_date": "2026-09-01", "value": 306}], "reason_codes": []}
    assert "observed_date" not in parsed["rows"][0]


@pytest.mark.parametrize("text", ["", "X,VIX\n2026-10-16,20\n", "DATE,VIX,unexpected\n2026-10-16,20,1\n",
                                      "DATE,observation_date,VIX\n2026-10-16,2026-10-16,20\n",
                                      "DATE,VIX\n2026-10-16,20,extra\n"])
def test_csv_schema_changes_fail_closed(text):
    assert parse_fred_csv(text, "VIX")["status"] == "SCHEMA_CHANGED"


MALFORMED_FRED_CSV = [
    'DATE,T10Y2Y\n2026-10-16,"-0.3\n',
    'DATE,"T10Y2Y\n',
    '"DATE,T10Y2Y\n2026-10-16,-0.3\n',
    'DATE,"T10Y2Y"x\n2026-10-16,-0.3\n',
    'DATE,T10Y2Y\n2026-10-16,"-0.3"x\n',
    'DATE,T10Y2Y\n2026-10-15,-0.2\n2026-10-16,"-0.3\n',
]
INVALID_FRED_NUMBERS = [
    "1_2", "1_000.5", "1e1_0", "١٢", "１２", " 12", "12 ", "\t12",
    "12\u00a0", "1,2", "0x10", "1.2.3", "--1", "+", "1e", "1e+", '1"2',
    "1\x002", "1\n2", "1\r2", "NaN", "inf", "-Infinity",
]


@pytest.mark.parametrize("text", MALFORMED_FRED_CSV)
def test_malformed_csv_syntax_rejects_the_whole_response(text):
    assert parse_fred_csv(text, "T10Y2Y") == {
        "status": "SCHEMA_CHANGED", "rows": [], "reason_codes": ["SCHEMA_CHANGED"],
    }


@pytest.mark.parametrize("value", INVALID_FRED_NUMBERS)
def test_csv_number_grammar_rejects_coercion_and_preserves_the_hole(value):
    # Quote/escape the field so the numeric grammar is tested independently of CSV syntax.
    encoded = '"' + value.replace('"', '""') + '"'
    parsed = parse_fred_csv(
        f"DATE,T10Y2Y\n2026-10-15,-0.3\n2026-10-16,{encoded}\n", "T10Y2Y",
    )
    assert parsed == {
        "status": "PARTIAL",
        "rows": [{"period_date": "2026-10-15", "value": -0.3},
                 {"period_date": "2026-10-16", "value": None}],
        "reason_codes": ["INVALID_VALUE"],
    }


@pytest.mark.parametrize("value,expected", [
    ("0", 0), ("-0", 0), ("12", 12), ("+12", 12), ("0012", 12),
    ("-0.3", -0.3), (".5", 0.5), ("1.", 1), ("1.25e2", 125),
    ("-3E-1", -0.3), ("2e+1", 20),
])
@pytest.mark.parametrize("quoted", [False, True])
def test_csv_explicit_ascii_decimal_grammar_accepts_valid_numbers(value, expected, quoted):
    field = f'"{value}"' if quoted else value
    assert parse_fred_csv(
        f'"observation_date","T10Y2Y"\r\n"2026-10-16",{field}\r\n', "T10Y2Y",
    ) == {"status": "PARSED", "rows": [{"period_date": "2026-10-16", "value": expected}],
          "reason_codes": []}


@pytest.mark.parametrize("adapter", ["regime", "bridge"])
@pytest.mark.parametrize("text", MALFORMED_FRED_CSV + [
    "DATE,T10Y2Y\n2026-10-16,1_2\n",
    "DATE,T10Y2Y\n2026-10-15,-0.3\n2026-10-16,١٢\n",
])
def test_legacy_consumers_refuse_malformed_fred_response_without_real_io(adapter, text):
    calls = []

    def fake_get(*args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(text=text, raise_for_status=lambda: None)

    if adapter == "regime":
        from macro_regime import fetch_fred_series
        fetch = lambda: fetch_fred_series("T10Y2Y", http_get=fake_get)
    else:
        import pandas as pd
        function = function_from_script(
            Path(__file__).parents[1] / "bridge.py", "fetch_fred_series",
            {"requests": SimpleNamespace(get=fake_get), "pd": pd,
             "parse_fred_csv": parse_fred_csv},
        )
        fetch = lambda: function("T10Y2Y")
    with pytest.raises(ValueError, match="^FRED_(SCHEMA_CHANGED|PARTIAL)$"):
        fetch()
    assert len(calls) == 1


@pytest.mark.parametrize("value", [".", "", "NaN", "inf", "-Infinity", "unparseable", "9007199254740992"])
def test_csv_missing_and_nonfinite_retained_as_explicit_holes(value):
    parsed = parse_fred_csv(f"DATE,VIX\n2026-10-16,{value}\n", "VIX")
    assert parsed["status"] == "PARTIAL"
    assert parsed["rows"][0]["value"] is None
    assert parsed["reason_codes"]


def test_csv_duplicates_and_invalid_dates_are_not_silent_success():
    parsed = parse_fred_csv("DATE,VIX\n2026-10-16,20\n2026-10-16,21\nnot-a-date,4\n", "VIX")
    assert parsed["status"] == "PARTIAL"
    assert parsed["reason_codes"] == ["DUPLICATE_PERIOD", "INVALID_PERIOD_DATE"]


def test_csv_accepts_long_daily_history_but_counts_invalid_rows_in_its_bound():
    from macro_contracts import MAX_CSV_ROWS
    start = date(2000, 1, 1)
    text = "DATE,T10Y2Y\n" + "".join(f"{start + timedelta(days=n)},1.2\n" for n in range(2501))
    parsed = parse_fred_csv(text, "T10Y2Y")
    assert parsed["status"] == "PARSED"
    assert len(parsed["rows"]) == 2501
    with pytest.raises(ContractError, match="ROW_LIMIT"):
        parse_fred_csv("DATE,T10Y2Y\n" + "bad-date,1\n" * (MAX_CSV_ROWS + 1), "T10Y2Y")


def test_legacy_fred_adapter_uses_strict_parser_and_no_real_http():
    from macro_regime import fetch_fred_series
    def response(text):
        return lambda *a, **k: SimpleNamespace(text=text, raise_for_status=lambda: None)
    assert fetch_fred_series("T10Y2Y", http_get=response("observation_date,T10Y2Y\n2026-10-16,-0.3\n")) == [(date(2026, 10, 16), -0.3)]
    for text in ["unexpected\n", "DATE,T10Y2Y\n2026-10-16,.\n", "DATE,T10Y2Y\n2026-10-16,inf\n"]:
        with pytest.raises(ValueError, match="FRED_"):
            fetch_fred_series("T10Y2Y", http_get=response(text))


def function_from_script(path, name, context):
    """Extract ONLY the target definition; never import privileged scripts."""
    tree = ast.parse(path.read_text())
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), context)
    return context[name]


def test_bridge_no_longer_has_overlapping_or_fallback_macro_writes():
    path = Path(__file__).parents[1] / "bridge.py"
    tree = ast.parse(path.read_text())
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "update_macro_hub")
    constants = {n.value for n in ast.walk(function) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    assert not {"^VIX", "^TNX", "^FVX", "SPREAD_10Y_2Y", "MISERY_INDEX", "JPY_VOLATILITY"} & constants
    assert {"GC=F", "EURUSD=X", "BTC-USD"} <= constants
    assert not any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "fetch_fred_series" for n in ast.walk(function))


def test_macro_ownership_is_unique():
    assert macro_owner("YAHOO", "^VIX") == "macro_sync"
    assert macro_owner("YAHOO", "^TNX") == "macro_sync"
    assert macro_owner("FRED", "T10Y2Y") == "fred_observations"
    assert macro_owner("YAHOO", "^FVX") is None
    keys = [(v[0], v[1]) for v in SERIES.values()]
    assert len(keys) == len(set(keys))


@pytest.mark.parametrize("confirmed", [False, True])
def test_legacy_update_counts_confirmed_rows_not_transport_success(confirmed):
    import pandas as pd
    calls = []
    class FakeClient:
        def table(self, name):
            assert name == "macro_indicators"  # No regime, target, run or other access.
            return self
        def update(self, payload):
            calls.append(payload)
            return self
        def eq(self, key, value):
            self.ticker = value
            return self
        def execute(self):
            return SimpleNamespace(data=[{"id": self.ticker}] if confirmed else [])
    context = {"macro_owner": macro_owner, "yf": SimpleNamespace(download=lambda *a, **k: pd.DataFrame({"Close": [10, 11]})),
               "datetime": importlib.import_module("datetime").datetime, "supabase": FakeClient()}
    sync = function_from_script(Path(__file__).parents[1] / "macro_sync.py", "sync_macro", context)
    result = sync()
    assert result == ({"updated": 4, "failed": 0} if confirmed else {"updated": 0, "failed": 4})
    assert len(calls) == 4


def test_preparation_has_no_io_or_tactical_import_and_no_writer_argument():
    import macro_contracts
    tree = ast.parse(Path(macro_contracts.__file__).read_text())
    imported = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
    imported.update(a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names)
    assert imported <= {"__future__", "calendar", "csv", "io", "math", "re", "statistics", "collections", "datetime", "typing", "source_contracts"}
    assert "supabase" not in prepare_macro_series.__code__.co_varnames
    for case in CASES:
        result = evaluate(case)
        assert not {"regime", "targets", "action", "snapshot"} & result.keys()


def test_macro_module_import_has_no_implicit_clock_or_environment(monkeypatch):
    import os
    import socket
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: pytest.fail("NETWORK"))
    monkeypatch.setattr(os, "getenv", lambda *a, **k: pytest.fail("ENVIRONMENT"))
    import macro_contracts
    importlib.reload(macro_contracts)
    assert evaluate(fixture("daily-index"))["value"] == 20
