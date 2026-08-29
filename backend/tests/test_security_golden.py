from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import api
from equity_screener import build_screener_rows, deduplicate_screener_rows
from family_office.commands import (
    CommandReplayBlockedError,
    command_scope,
    execute_audited_command,
    prepare_monthly_close,
)


class MemoryRepository:
    def __init__(self) -> None:
        self.sequence = 0
        self.tables: dict[str, list[dict[str, Any]]] = {
            "fo_owner_profiles": [
                {"user_id": "owner-a", "email": "owner-a@example.invalid"},
                {"user_id": "owner-b", "email": "owner-b@example.invalid"},
            ],
            "fo_portfolios": [
                {"id": "portfolio-a", "owner_user_id": "owner-a", "name": "A"},
                {"id": "portfolio-a2", "owner_user_id": "owner-a", "name": "A2"},
                {"id": "portfolio-b", "owner_user_id": "owner-b", "name": "B"},
            ],
            "fo_manual_holdings": [],
            "fo_audit_log": [],
            "fo_monthly_closes": [
                {
                    "id": "close-b",
                    "owner_user_id": "owner-b",
                    "portfolio_id": "portfolio-b",
                    "period_end": "2026-07-31",
                    "status": "CLOSED",
                }
            ],
        }

    def select(
        self,
        table: str,
        columns: str = "*",
        *,
        filters: dict[str, Any] | None = None,
        order: str | None = None,
        descending: bool = False,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        del columns
        rows = [
            dict(row)
            for row in self.tables.get(table, [])
            if all(row.get(key) == value for key, value in (filters or {}).items())
        ]
        if order:
            rows.sort(key=lambda row: row.get(order) or "", reverse=descending)
        return rows[:limit] if limit is not None else rows

    def first(self, table: str, columns: str = "*", **kwargs: Any) -> dict[str, Any] | None:
        rows = self.select(table, columns, limit=1, **kwargs)
        return rows[0] if rows else None

    def insert(self, table: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.sequence += 1
        row = {"id": f"generated-{self.sequence}", **payload}
        self.tables.setdefault(table, []).append(row)
        return dict(row)

    def insert_many(self, table: str, rows: list[dict[str, Any]]) -> int:
        for row in rows:
            self.insert(table, row)
        return len(rows)

    def update(
        self,
        table: str,
        payload: dict[str, Any],
        *,
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        for row in self.tables.get(table, []):
            if all(row.get(key) == value for key, value in filters.items()):
                row.update(payload)
                return dict(row)
        raise RuntimeError(f"Update of {table} matched no row")

    def upsert_many(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> int:
        keys = on_conflict.split(",")
        for payload in rows:
            filters = {key: payload[key] for key in keys}
            existing = self.first(table, filters=filters)
            if existing is None:
                self.insert(table, payload)
            else:
                self.update(table, payload, filters={"id": existing["id"]})
        return len(rows)

    def require_owner(self, user_id: str) -> dict[str, Any]:
        owner = self.first("fo_owner_profiles", filters={"user_id": user_id})
        if owner is None:
            raise PermissionError("Authenticated user is not the portfolio owner")
        return owner

    def existing_command(self, owner_user_id: str, command_id: str) -> dict[str, Any] | None:
        return self.first(
            "fo_audit_log",
            filters={
                "owner_user_id": owner_user_id,
                "command_id": command_id,
                "status": "COMPLETED",
            },
        )

    def existing_audit(
        self, owner_user_id: str, command_id: str, status: str
    ) -> dict[str, Any] | None:
        return self.first(
            "fo_audit_log",
            filters={
                "owner_user_id": owner_user_id,
                "command_id": command_id,
                "status": status,
            },
        )

    def audit(self, **payload: Any) -> dict[str, Any]:
        return self.insert("fo_audit_log", payload)


@pytest.fixture
def command_client() -> Iterator[tuple[TestClient, MemoryRepository, dict[str, str]]]:
    repository = MemoryRepository()
    identity = {"user_id": "owner-a"}
    api.app.dependency_overrides[api._repository] = lambda: repository
    api.app.dependency_overrides[api.authenticated_owner] = lambda: api.AuthenticatedOwner(
        user_id=identity["user_id"]
    )
    try:
        with TestClient(api.app) as client:
            yield client, repository, identity
    finally:
        api.app.dependency_overrides.clear()


def _holding_payload(portfolio_id: str, name: str = "Golden holding") -> dict[str, Any]:
    return {
        "portfolio_id": portfolio_id,
        "holding_kind": "ASSET",
        "asset_type": "OTHER",
        "name": name,
        "currency": "EUR",
        "valuation_frequency": "ANNUAL",
    }


def test_identity_requires_a_valid_registered_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    repository = MemoryRepository()
    monkeypatch.setenv("SUPABASE_URL", "https://supabase.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key")

    class Response:
        status_code = 200

        @staticmethod
        def json() -> dict[str, str]:
            return {"id": "owner-a", "email": "owner-a@example.invalid"}

    monkeypatch.setattr(api.requests, "get", lambda *args, **kwargs: Response())

    owner = api.authenticated_owner("Bearer valid-token", repository)  # type: ignore[arg-type]
    assert owner.user_id == "owner-a"

    with pytest.raises(HTTPException) as missing:
        api.authenticated_owner(None, repository)  # type: ignore[arg-type]
    assert missing.value.status_code == 401

    repository.tables["fo_owner_profiles"] = []
    with pytest.raises(HTTPException) as unregistered:
        api.authenticated_owner("Bearer valid-token", repository)  # type: ignore[arg-type]
    assert unregistered.value.status_code == 403


def test_every_business_route_is_503_in_production_even_when_configured(
    command_client: tuple[TestClient, MemoryRepository, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, repository, _ = command_client
    monkeypatch.setenv("FAMILY_OFFICE_ENVIRONMENT", "Production")
    monkeypatch.setenv("SUPABASE_URL", "https://configured-but-unused.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "configured-but-unused")

    business_routes = [
        route
        for route in api.app.routes
        if getattr(route, "path", "").startswith("/v1/")
    ]
    assert business_routes
    for route in business_routes:
        method = sorted(route.methods & {"GET", "POST", "PATCH"})[0]
        path = (
            route.path.replace("{holding_id}", "holding-b")
            .replace("{decision_id}", "decision-b")
            .replace("{order_id}", "order-b")
            .replace("{close_id}", "close-b")
            .replace("{exception_id}", "exception-b")
        )
        response = client.request(method, path)
        assert response.status_code == 503, (method, path, response.text)
        assert response.json() == {
            "detail": "Business commands are disabled in Production"
        }

    assert repository.tables["fo_manual_holdings"] == []
    assert repository.tables["fo_audit_log"] == []


def test_production_guard_has_priority_over_all_command_configuration() -> None:
    assert api._production_commands_disabled(
        {
            "FAMILY_OFFICE_ENVIRONMENT": "production",
            "SUPABASE_URL": "https://configured.invalid",
            "SUPABASE_SERVICE_ROLE_KEY": "configured",
        }
    )
    assert not api._production_commands_disabled(
        {"FAMILY_OFFICE_ENVIRONMENT": "preview"}
    )


def test_cross_owner_command_refuses_before_audit_or_insert(
    command_client: tuple[TestClient, MemoryRepository, dict[str, str]],
) -> None:
    client, repository, _ = command_client

    response = client.post(
        "/v1/manual-holdings",
        headers={"Idempotency-Key": "golden-cross-owner-0001"},
        json=_holding_payload("portfolio-b"),
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Unknown portfolio"}
    assert repository.tables["fo_manual_holdings"] == []
    assert repository.tables["fo_audit_log"] == []


def test_owner_command_is_idempotent_request_bound_and_user_isolated(
    command_client: tuple[TestClient, MemoryRepository, dict[str, str]],
) -> None:
    client, repository, identity = command_client
    headers = {"Idempotency-Key": "golden-owner-replay-0001"}
    payload = _holding_payload("portfolio-a")

    first = client.post("/v1/manual-holdings", headers=headers, json=payload)
    replay = client.post("/v1/manual-holdings", headers=headers, json=payload)

    assert first.status_code == 200
    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert len(repository.tables["fo_manual_holdings"]) == 1
    assert [row["status"] for row in repository.tables["fo_audit_log"]] == [
        "ACCEPTED",
        "COMPLETED",
    ]

    changed_target = client.post(
        "/v1/manual-holdings",
        headers=headers,
        json=_holding_payload("portfolio-a2"),
    )
    assert changed_target.status_code == 400
    assert changed_target.json() == {
        "detail": "Idempotency-Key does not match the original command request"
    }
    assert len(repository.tables["fo_manual_holdings"]) == 1

    identity["user_id"] = "owner-b"
    other_owner = client.post(
        "/v1/manual-holdings",
        headers=headers,
        json=_holding_payload("portfolio-b"),
    )
    assert other_owner.status_code == 200
    assert len(repository.tables["fo_manual_holdings"]) == 2
    assert {row["owner_user_id"] for row in repository.tables["fo_audit_log"]} == {
        "owner-a",
        "owner-b",
    }


def test_completed_audit_failure_blocks_retry_without_second_business_effect(
    command_client: tuple[TestClient, MemoryRepository, dict[str, str]],
) -> None:
    client, repository, _ = command_client
    original_audit = repository.audit
    completion_writes = 0

    def fail_completed_audit(**payload: Any) -> dict[str, Any]:
        nonlocal completion_writes
        if payload["status"] == "COMPLETED":
            completion_writes += 1
            raise RuntimeError("simulated COMPLETED audit failure")
        return original_audit(**payload)

    repository.audit = fail_completed_audit  # type: ignore[method-assign]
    headers = {"Idempotency-Key": "golden-indeterminate-retry-0001"}
    payload = _holding_payload("portfolio-a")

    with pytest.raises(RuntimeError, match="simulated COMPLETED audit failure"):
        client.post("/v1/manual-holdings", headers=headers, json=payload)

    retry = client.post("/v1/manual-holdings", headers=headers, json=payload)

    assert retry.status_code == 409
    assert retry.json()["command_state"] == "INDETERMINATE"
    assert len(repository.tables["fo_manual_holdings"]) == 1
    assert completion_writes == 1
    assert [row["status"] for row in repository.tables["fo_audit_log"]] == [
        "ACCEPTED",
        "FAILED",
    ]


def test_atomic_accepted_claim_loser_never_executes_operation() -> None:
    repository = MemoryRepository()
    operation_calls = 0
    original_audit = repository.audit

    def lose_claim_after_concurrent_insert(**payload: Any) -> dict[str, Any]:
        if payload["status"] == "ACCEPTED":
            original_audit(**payload)
            raise RuntimeError("simulated unique claim conflict")
        return original_audit(**payload)

    def operation() -> dict[str, Any]:
        nonlocal operation_calls
        operation_calls += 1
        return {"resource_type": "probe", "resource_id": "unexpected"}

    repository.audit = lose_claim_after_concurrent_insert  # type: ignore[method-assign]

    with pytest.raises(CommandReplayBlockedError) as blocked:
        execute_audited_command(
            repository,  # type: ignore[arg-type]
            owner_user_id="owner-a",
            command_id="golden-atomic-claim-0001",
            command_type="PROBE",
            scope=command_scope({"portfolio_id": "portfolio-a"}),
            authorize=lambda: None,
            operation=operation,
        )

    assert blocked.value.command_state == "IN_PROGRESS_OR_INDETERMINATE"
    assert operation_calls == 0


def test_foreign_closed_monthly_close_cannot_bypass_owner_check() -> None:
    repository = MemoryRepository()

    with pytest.raises(ValueError, match="Unknown portfolio"):
        prepare_monthly_close(
            repository,  # type: ignore[arg-type]
            owner_user_id="owner-a",
            portfolio_id="portfolio-b",
            period_end=date(2026, 7, 31),
            finalize=True,
        )

    assert repository.tables["fo_monthly_closes"] == [
        {
            "id": "close-b",
            "owner_user_id": "owner-b",
            "portfolio_id": "portfolio-b",
            "period_end": "2026-07-31",
            "status": "CLOSED",
        }
    ]


def test_legacy_unscoped_audit_cannot_replay_tainted_state() -> None:
    repository = MemoryRepository()
    repository.tables["fo_audit_log"] = [
        {
            "id": "legacy-audit",
            "owner_user_id": "owner-a",
            "command_id": "legacy-replay-0001",
            "command_type": "CREATE_MANUAL_HOLDING",
            "status": "COMPLETED",
            "after_state": {
                "resource_type": "manual_holding",
                "holding": {"portfolio_id": "portfolio-b"},
            },
        }
    ]

    with pytest.raises(
        ValueError, match="Idempotency-Key does not match the original command request"
    ):
        execute_audited_command(
            repository,  # type: ignore[arg-type]
            owner_user_id="owner-a",
            command_id="legacy-replay-0001",
            command_type="CREATE_MANUAL_HOLDING",
            scope=command_scope(_holding_payload("portfolio-a")),
            authorize=lambda: repository.first(
                "fo_portfolios",
                filters={"id": "portfolio-a", "owner_user_id": "owner-a"},
            ),
            operation=lambda: pytest.fail("a replay must not execute the operation"),
        )

    assert len(repository.tables["fo_audit_log"]) == 1


def test_quality_score_qa_and_duplicate_ranking_are_deterministic() -> None:
    universe = [
        {
            "instrument_key": "golden:alpha",
            "ticker": "ALPHA",
            "name": "Alpha Software",
            "sector": "Technology",
            "industry": "Software",
            "currency": "USD",
            "provider": "golden",
            "is_active": True,
        }
    ]
    financials = [
        {
            "instrument_key": "golden:alpha",
            "fiscal_year": year,
            "currency": "USD",
            "revenue": revenue,
            "free_cash_flow": revenue * 0.15,
        }
        for year, revenue in ((2022, 100.0), (2023, 110.0), (2024, 121.0), (2025, 133.1))
    ]
    trident = [
        {
            "instrument_key": "golden:alpha",
            "score": 80,
            "overall_state": "QUALIFIED",
            "latest_roic": 0.2,
            "latest_net_debt_to_ebitda": 1.0,
        }
    ]
    insights = [
        {
            "instrument_key": "golden:alpha",
            "market_cap": 1_000.0,
            "price_currency": "USD",
            "trailing_pe": 15,
            "forward_pe": 14,
        }
    ]

    first = build_screener_rows(
        universe,
        financials,
        trident,
        insights,
        as_of_date=date(2026, 8, 29),
    )[0]
    second = build_screener_rows(
        universe,
        list(reversed(financials)),
        trident,
        insights,
        as_of_date=date(2026, 8, 29),
    )[0]
    projection = (
        "as_of_date",
        "quality_value_score",
        "valuation_tag",
        "themes",
        "data_state",
        "score_details",
    )
    assert {key: first[key] for key in projection} == {
        key: second[key] for key in projection
    }
    assert first["as_of_date"] == "2026-08-29"
    assert first["quality_value_score"] == 75.0
    assert first["data_state"] == ["FORECAST_UNAVAILABLE", "PRICE_HISTORY_UNAVAILABLE"]

    tied = [
        {
            "instrument_key": key,
            "ticker": "TIE",
            "name": "Same",
            "provider": "golden",
            "source_index": "golden",
            "market_cap": 1,
            "quality_value_score": 50,
            "data_state": ["FORECAST_UNAVAILABLE"],
        }
        for key in ("golden:a", "golden:b")
    ]
    forward, _ = deduplicate_screener_rows(tied)
    reverse, _ = deduplicate_screener_rows(list(reversed(tied)))
    assert forward[0]["instrument_key"] == reverse[0]["instrument_key"] == "golden:b"
