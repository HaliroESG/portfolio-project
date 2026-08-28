from __future__ import annotations

import os
from typing import Any, Iterable

from supabase import Client, create_client

from supabase_key_guard import require_backend_supabase_key


def create_service_client(env: dict[str, str] | None = None) -> Client:
    values = env or os.environ
    url = values.get("SUPABASE_URL")
    if not url:
        raise RuntimeError("SUPABASE_URL is required")
    return create_client(url, require_backend_supabase_key(values))


def _chunks(rows: list[dict[str, Any]], size: int = 500) -> Iterable[list[dict[str, Any]]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


class FamilyOfficeRepository:
    def __init__(self, client: Client):
        self.client = client

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
        query = self.client.table(table).select(columns)
        for key, value in (filters or {}).items():
            query = query.eq(key, value)
        if order:
            query = query.order(order, desc=descending)
        if limit is not None:
            query = query.limit(limit)
        response = query.execute()
        return list(response.data or [])

    def first(
        self,
        table: str,
        columns: str = "*",
        *,
        filters: dict[str, Any] | None = None,
        order: str | None = None,
        descending: bool = False,
    ) -> dict[str, Any] | None:
        rows = self.select(
            table,
            columns,
            filters=filters,
            order=order,
            descending=descending,
            limit=1,
        )
        return rows[0] if rows else None

    def insert(self, table: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = self.client.table(table).insert(payload).execute()
        rows = list(response.data or [])
        if not rows:
            raise RuntimeError(f"Insert into {table} returned no row")
        return rows[0]

    def insert_many(self, table: str, rows: list[dict[str, Any]]) -> int:
        inserted = 0
        for chunk in _chunks(rows):
            response = self.client.table(table).insert(chunk).execute()
            inserted += len(response.data or [])
        return inserted

    def upsert_many(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> int:
        upserted = 0
        for chunk in _chunks(rows):
            response = self.client.table(table).upsert(chunk, on_conflict=on_conflict).execute()
            upserted += len(response.data or [])
        return upserted

    def update(
        self,
        table: str,
        payload: dict[str, Any],
        *,
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        query = self.client.table(table).update(payload)
        for key, value in filters.items():
            query = query.eq(key, value)
        response = query.execute()
        rows = list(response.data or [])
        if not rows:
            raise RuntimeError(f"Update of {table} matched no row")
        return rows[0]

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

    def audit(
        self,
        *,
        owner_user_id: str,
        command_id: str,
        command_type: str,
        status: str,
        resource_type: str | None = None,
        resource_id: str | None = None,
        before_state: dict[str, Any] | None = None,
        after_state: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        return self.insert(
            "fo_audit_log",
            {
                "owner_user_id": owner_user_id,
                "command_id": command_id,
                "command_type": command_type,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "status": status,
                "before_state": before_state,
                "after_state": after_state,
                "error": error,
            },
        )
