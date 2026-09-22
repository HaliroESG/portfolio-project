from __future__ import annotations

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
