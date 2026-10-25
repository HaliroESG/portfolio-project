"""Mounted API routes with synthetic identity/repositories, never remote clients."""
from __future__ import annotations

import copy
import io

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

import api
from test_security_golden import MemoryRepository


@pytest.fixture
def local_api(monkeypatch):
    repository = MemoryRepository()
    identity = {"user_id": "owner-a"}
    previous = dict(api.app.dependency_overrides)
    api.app.dependency_overrides[api._repository] = lambda: repository
    api.app.dependency_overrides[api.authenticated_owner] = lambda: api.AuthenticatedOwner(**identity)

    def remote_forbidden(*args, **kwargs):
        raise AssertionError("Real authentication/provider client forbidden")

    monkeypatch.setattr(api.requests, "get", remote_forbidden)
    monkeypatch.setattr(api, "create_service_client", remote_forbidden)
    try:
        with TestClient(api.app) as client:
            yield client, repository, identity
    finally:
        api.app.dependency_overrides.clear()
        api.app.dependency_overrides.update(previous)


@pytest.mark.parametrize("method,path,payload", [
    ("POST", "/v1/bootstrap", {"portfolio_name": "Synthetic portfolio"}),
    ("PATCH", "/v1/decisions/decision-a", {"status": "EXECUTED"}),
    ("POST", "/v1/monthly-closes", {"portfolio_id": "portfolio-a", "period_end": "2026-06-30", "finalize": True}),
])
def test_unconfigured_commands_remain_http_503(local_api, monkeypatch, method, path, payload):
    client, repository, _ = local_api
    del api.app.dependency_overrides[api.authenticated_owner]
    for key in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_KEY"):
        monkeypatch.delenv(key, raising=False)
    before = copy.deepcopy(repository.tables)
    response = client.request(method, path, json=payload, headers={"Authorization": "Bearer synthetic", "Idempotency-Key": "fi00-offline-lock"})
    assert response.status_code == 503
    assert response.json() == {"detail": "Command API is not configured"}
    assert repository.tables == before


@pytest.mark.parametrize("field", ["risk_context", "source_snapshot"])
def test_legacy_execution_route_cannot_bypass_guard(local_api, field):
    client, repository, _ = local_api
    decision = {"id": "decision-a", "owner_user_id": "owner-a", "portfolio_id": "portfolio-a", "status": "EXPORTED", field: {"twr_ytd": 9876.54}}
    repository.tables["fo_decisions"] = [decision]
    before = copy.deepcopy(decision)
    response = client.patch("/v1/decisions/decision-a", json={"status": "EXECUTED"}, headers={"Idempotency-Key": "fi00-legacy-route-" + field})
    assert response.status_code == 400
    assert "CALCULATION_NOT_QUALIFIED" in response.text
    assert repository.tables["fo_decisions"] == [before]
    assert repository.tables.get("fo_order_drafts", []) == []


@pytest.mark.parametrize("format", ["csv", "pdf"])
def test_archived_export_routes_protect_values_without_mutation(local_api, format):
    client, repository, identity = local_api
    repository.tables["fo_monthly_closes"] = [{
        "id": "close-a", "owner_user_id": "owner-a", "portfolio_id": "portfolio-a",
        "period_end": "2026-06-30", "status": "CLOSED", "nav_eur": 1000,
        "coverage_pct": 100, "checks_json": {}, "report_json": {
            "performance": [{"performance_date": "2026-06-30", "nav_eur": 1000, "twr_ytd": 9876.54}],
            "risk": {"volatility_30d_pct": 9876.54, "details": {"leak": 9876.54}},
        },
    }]
    before = copy.deepcopy(repository.tables)
    response = client.get("/v1/monthly-closes/close-a/export", params={"format": format})
    assert response.status_code == 200
    body = response.text if format == "csv" else "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(response.content)).pages)
    assert "9876" not in body.replace(" ", "").replace(",", "")
    assert ("CALCULATION_NOT_QUALIFIED" in body) if format == "csv" else ("NON QUALIFIE" in body)
    assert repository.tables == before
    identity["user_id"] = "owner-b"
    response = client.get("/v1/monthly-closes/close-a/export", params={"format": format})
    assert response.status_code == 404
    assert repository.tables == before
