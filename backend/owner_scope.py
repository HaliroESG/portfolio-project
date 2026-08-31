from __future__ import annotations

from uuid import UUID


def require_owner_user_id(value: str | None) -> str:
    if value is None or not value.strip():
        raise RuntimeError("owner_user_id is required for a private multi-owner write")
    try:
        return str(UUID(value.strip()))
    except ValueError as exc:
        raise RuntimeError("owner_user_id must be a valid UUID") from exc


def owner_scoped_identifier(owner_user_id: str, *parts: object) -> str:
    owner = require_owner_user_id(owner_user_id)
    normalized_parts = [str(part).strip() for part in parts]
    if any(not part for part in normalized_parts):
        raise RuntimeError("owner-scoped identifier parts must be non-empty")
    return ":".join([owner, *normalized_parts])
