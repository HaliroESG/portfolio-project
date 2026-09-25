from __future__ import annotations

import pytest

from tools import schema_check


def test_allocation_contract_v1_schema_is_critical():
    assert {
        "allocation_contract_version",
        "reserve_floor_eur",
        "reserve_excluded_from_risky_allocation",
    }.issubset(schema_check.CRITICAL_SCHEMA["target_models"])
    assert "target_sleeve_allocations" in schema_check.CRITICAL_SCHEMA
    assert "portfolio_id" in schema_check.CRITICAL_SCHEMA["allocation_advice_items_latest"]
    assert "model_contract_state" in schema_check.CRITICAL_SCHEMA["allocation_advice_items_latest"]
    assert schema_check.CRITICAL_RPCS["apply_target_model_v1"] == [
        "p_model",
        "p_buckets",
        "p_sleeve_allocations",
        "p_envelope_lines",
        "p_audit_holdings",
    ]


def test_run_check_requires_allocation_contract_rpc(monkeypatch):
    monkeypatch.setattr(schema_check, "check_table_exists", lambda *_args: (True, None))
    monkeypatch.setattr(schema_check, "check_column_exists", lambda *_args: (True, None))
    monkeypatch.setattr(
        schema_check,
        "_http_get_openapi",
        lambda *_args: (
            200,
            {
                "paths": {
                    "/rpc/apply_target_model_v1": {
                        "post": {
                            "parameters": [{
                                "schema": {
                                    "properties": {
                                        name: {"type": "object"}
                                        for name in schema_check.CRITICAL_RPCS["apply_target_model_v1"]
                                    }
                                }
                            }]
                        }
                    }
                }
            },
        ),
    )

    report = schema_check.run_check("https://example.supabase.co", "service-role-test-key")

    assert report["pass"] is True
    assert report["rpcs"]["apply_target_model_v1"]["pass"] is True


def test_run_check_fails_when_allocation_contract_rpc_shape_is_incomplete(monkeypatch):
    monkeypatch.setattr(schema_check, "check_table_exists", lambda *_args: (True, None))
    monkeypatch.setattr(schema_check, "check_column_exists", lambda *_args: (True, None))
    monkeypatch.setattr(
        schema_check,
        "_http_get_openapi",
        lambda *_args: (
            200,
            {
                "paths": {
                    "/rpc/apply_target_model_v1": {
                        "post": {"parameters": [{"schema": {"properties": {"p_model": {}}}}]}
                    }
                }
            },
        ),
    )

    report = schema_check.run_check("https://example.supabase.co", "service-role-test-key")

    assert report["pass"] is False
    assert report["rpcs"]["apply_target_model_v1"]["pass"] is False
    assert "missing arguments" in report["rpcs"]["apply_target_model_v1"]["errors"][0]


def _check_document(monkeypatch, document):
    monkeypatch.setattr(schema_check, "_http_get_openapi", lambda *_: (200, document))
    # Any attempt to resolve a remote reference must fail the test.
    monkeypatch.setattr(schema_check, "urlopen", lambda *_: pytest.fail("Unexpected network access"))
    return schema_check.check_rpc_exists(
        "https://invalid.example", "synthetic", "apply_target_model_v1",
        schema_check.CRITICAL_RPCS["apply_target_model_v1"],
    )


def _rpc_document(schema):
    return {"paths": {"/rpc/apply_target_model_v1": {
        "post": {"parameters": [{"in": "body", "name": "args", "schema": schema}]},
    }}}


@pytest.mark.parametrize("shape", ["inline", "ref", "allOf", "named", "parameter_ref"])
def test_rpc_request_arguments_support_local_openapi_shapes(monkeypatch, shape):
    properties = {name: {"type": "object"} for name in schema_check.CRITICAL_RPCS["apply_target_model_v1"]}
    schema = {"properties": properties}
    document = _rpc_document(schema)
    document["definitions"] = {"rpc/args~v1": schema}
    if shape == "ref":
        document["paths"]["/rpc/apply_target_model_v1"]["post"]["parameters"][0]["schema"] = {
            "$ref": "#/definitions/rpc~1args~0v1",
        }
    elif shape == "allOf":
        document["paths"]["/rpc/apply_target_model_v1"]["post"]["parameters"][0]["schema"] = {
            "allOf": [{"$ref": "#/definitions/rpc~1args~0v1"}],
        }
    elif shape == "named":
        document["paths"]["/rpc/apply_target_model_v1"]["post"]["parameters"] = [
            {"in": "query", "name": name, "type": "string"} for name in properties
        ]
    elif shape == "parameter_ref":
        document["parameters"] = {"rpc_args": {"in": "body", "name": "args", "schema": schema}}
        document["paths"]["/rpc/apply_target_model_v1"]["post"]["parameters"] = [{"$ref": "#/parameters/rpc_args"}]
    assert _check_document(monkeypatch, document) == (True, None)


@pytest.mark.parametrize("case", ["missing_ref", "external", "cycle", "allOf_cycle", "absent_argument", "response_only", "get_only"])
def test_rpc_argument_check_fails_closed(monkeypatch, case):
    properties = {name: {} for name in schema_check.CRITICAL_RPCS["apply_target_model_v1"]}
    document = _rpc_document({"$ref": "#/definitions/args"})
    document["definitions"] = {"args": {"properties": properties}}
    post = document["paths"]["/rpc/apply_target_model_v1"]["post"]
    if case == "missing_ref":
        document["definitions"] = {}
    elif case == "external":
        document["definitions"]["args"] = {"$ref": "https://invalid.example/private"}
    elif case == "cycle":
        document["definitions"]["args"] = {"$ref": "#/definitions/args"}
    elif case == "allOf_cycle":
        document["definitions"]["args"] = {"allOf": [{"$ref": "#/definitions/args"}]}
    elif case == "absent_argument":
        del properties["p_model"]
    elif case == "response_only":
        post["parameters"] = []
        post["responses"] = {"200": {"schema": {"properties": properties}}}
    elif case == "get_only":
        path = document["paths"]["/rpc/apply_target_model_v1"]
        path["get"] = path.pop("post")
    ok, error = _check_document(monkeypatch, document)
    assert ok is False
    assert error


@pytest.mark.parametrize("shape", ["inline", "schema_ref", "property_ref", "property_allOf", "allOf_duplicate"])
@pytest.mark.parametrize("read_only", [True, False])
def test_rpc_response_only_properties_are_not_request_arguments(monkeypatch, shape, read_only):
    properties = {name: {} for name in schema_check.CRITICAL_RPCS["apply_target_model_v1"]}
    prop = {"type": "object", "readOnly": read_only}
    properties["p_model"] = prop
    schema = {"properties": properties}
    document = _rpc_document(schema)
    document["definitions"] = {"args": schema, "model": prop}
    if shape == "schema_ref":
        document["paths"]["/rpc/apply_target_model_v1"]["post"]["parameters"][0]["schema"] = {"$ref": "#/definitions/args"}
    elif shape == "property_ref":
        properties["p_model"] = {"$ref": "#/definitions/model"}
    elif shape == "property_allOf":
        properties["p_model"] = {"allOf": [{"$ref": "#/definitions/model"}]}
    elif shape == "allOf_duplicate":
        schema["allOf"] = [{"properties": {"p_model": {"readOnly": False}}}]
    ok, error = _check_document(monkeypatch, document)
    assert ok is (not read_only)
    if read_only:
        assert "p_model" in error


@pytest.mark.parametrize("prop", [
    {"readOnly": "true"},
    {"$ref": "https://invalid.example/property"},
    {"$ref": "#/definitions/model"},
    {"allOf": [{"$ref": "#/definitions/model"}]},
])
def test_rpc_invalid_property_contract_fails_closed(monkeypatch, prop):
    properties = {name: {} for name in schema_check.CRITICAL_RPCS["apply_target_model_v1"]}
    properties["p_model"] = prop
    document = _rpc_document({"properties": properties})
    document["definitions"] = {"model": prop}
    ok, error = _check_document(monkeypatch, document)
    assert ok is False
    assert error
