#!/usr/bin/env python3
"""Strict validator for non-promotable local Family Office restore receipts."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "astrocyte_family_office_local_restore_receipt_v1"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
HASH_FIELDS = {
    "candidate_manifest_sha256",
    "migration_sha256",
    "backup_sha256",
    "source_fingerprint_sha256",
    "restored_fingerprint_sha256",
}
BOOL_TRUE_FIELDS = {
    "read_isolation",
    "write_isolation",
    "composite_constraints",
    "rls_grants_views",
    "rollback_verified",
    "unsafe_rollback_refused",
}
REQUIRED_FIELDS = {
    "schema_version",
    "status",
    "started_at",
    "completed_at",
    "release_gate_sha",
    "candidate_sha",
    *HASH_FIELDS,
    "restore_mode",
    "postgres_major",
    "rpo_seconds",
    "rto_seconds",
    "owner_identity_count",
    *BOOL_TRUE_FIELDS,
    "outbound_side_effects",
    "cleanup_status",
}


class LocalReceiptError(ValueError):
    """Raised when a local receipt is incomplete or overclaims capability."""


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise LocalReceiptError("receipt is not strict JSON") from exc


def strict_json_loads(raw: str) -> Any:
    def reject_constant(value: str) -> None:
        raise LocalReceiptError(f"non-standard JSON constant {value!r} is forbidden")

    try:
        return json.loads(raw, parse_constant=reject_constant)
    except json.JSONDecodeError as exc:
        raise LocalReceiptError("receipt is not valid JSON") from exc


def _utc(value: object, field: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise LocalReceiptError(f"{field} must be an RFC3339 UTC timestamp")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise LocalReceiptError(f"{field} is not a valid timestamp") from exc
    if parsed.tzinfo != timezone.utc:
        raise LocalReceiptError(f"{field} must use UTC")
    return parsed


def validate_local_receipt(
    receipt: object,
    *,
    expected_candidate_sha: str | None = None,
) -> dict[str, Any]:
    if not isinstance(receipt, dict):
        raise LocalReceiptError("receipt must be an object")
    fields = set(receipt)
    if fields != REQUIRED_FIELDS:
        raise LocalReceiptError(
            f"receipt fields mismatch; missing={sorted(REQUIRED_FIELDS - fields)}, "
            f"unexpected={sorted(fields - REQUIRED_FIELDS)}"
        )
    if receipt["schema_version"] != SCHEMA_VERSION:
        raise LocalReceiptError("unsupported local receipt schema")
    if receipt["status"] != "PASS":
        raise LocalReceiptError("local restore status must be PASS")
    if receipt["restore_mode"] != "LOCAL_ISOLATED_DATABASE":
        raise LocalReceiptError("local receipt cannot claim provider-native restoration")
    if receipt["cleanup_status"] != "DELETED":
        raise LocalReceiptError("isolated local databases must be deleted")
    if receipt["outbound_side_effects"] is not False:
        raise LocalReceiptError("local drill must have zero outbound side effects")
    if receipt["owner_identity_count"] != 2:
        raise LocalReceiptError("local drill must test exactly two synthetic identities")
    if not isinstance(receipt["postgres_major"], int) or receipt["postgres_major"] < 15:
        raise LocalReceiptError("PostgreSQL 15+ is required")
    for field in ("rpo_seconds", "rto_seconds"):
        value = receipt[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise LocalReceiptError(f"{field} must be numeric")
        if not math.isfinite(value) or value < 0:
            raise LocalReceiptError(f"{field} must be finite and non-negative")
    for field in BOOL_TRUE_FIELDS:
        if receipt[field] is not True:
            raise LocalReceiptError(f"{field} must be true")
    for field in HASH_FIELDS:
        if not isinstance(receipt[field], str) or not SHA256_RE.fullmatch(receipt[field]):
            raise LocalReceiptError(f"{field} must be a lowercase SHA-256")
    for field in ("release_gate_sha", "candidate_sha"):
        if not isinstance(receipt[field], str) or not SHA_RE.fullmatch(receipt[field]):
            raise LocalReceiptError(f"{field} must be a lowercase Git SHA")
    if expected_candidate_sha and receipt["candidate_sha"] != expected_candidate_sha:
        raise LocalReceiptError("candidate SHA does not match the pinned candidate")
    started = _utc(receipt["started_at"], "started_at")
    completed = _utc(receipt["completed_at"], "completed_at")
    if completed < started:
        raise LocalReceiptError("completion precedes start")
    if receipt["source_fingerprint_sha256"] != receipt["restored_fingerprint_sha256"]:
        raise LocalReceiptError("logical restore fingerprint mismatch")
    return receipt


def receipt_sha256(receipt: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(receipt).encode("utf-8")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt-file", required=True)
    parser.add_argument("--expected-candidate-sha")
    args = parser.parse_args()
    path = Path(args.receipt_file)
    try:
        if path.is_symlink() or not path.is_file():
            raise LocalReceiptError("receipt must be a regular non-symlink file")
        receipt = strict_json_loads(path.read_text(encoding="utf-8"))
        validated = validate_local_receipt(
            receipt,
            expected_candidate_sha=args.expected_candidate_sha,
        )
    except LocalReceiptError as exc:
        parser.error(str(exc))
    print(f"local Family Office receipt PASS sha256={receipt_sha256(validated)}")


if __name__ == "__main__":
    main()
