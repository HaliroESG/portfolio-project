from __future__ import annotations

import base64
import json
from typing import Mapping


BACKEND_KEY_ENV_NAMES = (
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_KEY",
)


class SupabaseBackendKeyError(RuntimeError):
    pass


def _decode_jwt_payload(value: str) -> dict | None:
    parts = value.split(".")
    if len(parts) != 3:
        return None
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def classify_supabase_key(value: str | None) -> str:
    if not value:
        return "missing"
    if value.startswith("sb_secret_"):
        return "secret"
    if value.startswith("sb_publishable_"):
        return "publishable"
    payload = _decode_jwt_payload(value)
    if payload:
        role = payload.get("role")
        return str(role) if role else "jwt_unknown"
    return "unknown"


def resolve_backend_supabase_key(env: Mapping[str, str]) -> tuple[str, str]:
    for name in BACKEND_KEY_ENV_NAMES:
        value = env.get(name)
        if value:
            return name, value
    raise SupabaseBackendKeyError(
        "Missing Supabase backend key. Configure SUPABASE_SECRET_KEY, "
        "SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SERVICE_KEY, or SUPABASE_KEY."
    )


def require_backend_supabase_key(env: Mapping[str, str]) -> str:
    name, value = resolve_backend_supabase_key(env)
    key_type = classify_supabase_key(value)
    if key_type in {"secret", "service_role"}:
        return value
    if key_type in {"anon", "authenticated", "publishable"}:
        raise SupabaseBackendKeyError(
            f"{name} is a public/low-privilege Supabase key ({key_type}). "
            "Backend ETL writes require a secret key or legacy service_role key."
        )
    raise SupabaseBackendKeyError(
        f"{name} is not recognizable as a Supabase backend key. "
        "Use an sb_secret_... key or legacy JWT service_role key."
    )
