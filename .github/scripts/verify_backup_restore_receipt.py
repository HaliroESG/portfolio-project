#!/usr/bin/env python3
"""Validate a sanitized restore-drill receipt before Production mutation."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "astrocyte_restore_drill_receipt_v1"
MAX_RECEIPT_AGE = timedelta(days=7)
MAX_CLOCK_SKEW = timedelta(minutes=5)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
REQUIRED_FIELDS = {
    "schema_version",
    "status",
    "completed_at",
    "expires_at",
    "target_sha256",
    "base_sha",
    "restore_mode",
    "fingerprint_match",
    "outbound_side_effects",
    "rpo_seconds",
    "rto_seconds",
    "cleanup_status",
}
ALLOWED_CLEANUP = {"DELETED", "PAUSED", "RETAINED_WITH_AUTHORITY"}


class ReceiptError(ValueError):
    """Raised when a restore receipt fails closed."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def receipt_sha256(receipt: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(receipt).encode("utf-8")).hexdigest()


def parse_utc(value: object, field: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ReceiptError(f"{field} must be an RFC3339 UTC timestamp ending in Z")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ReceiptError(f"{field} is not a valid RFC3339 timestamp") from exc
    if parsed.tzinfo != timezone.utc:
        raise ReceiptError(f"{field} must use UTC")
    return parsed


def _bounded_number(receipt: dict[str, Any], field: str, maximum: int) -> None:
    value = receipt[field]
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        raise ReceiptError(f"{field} must be a non-negative number")
    if value > maximum:
        raise ReceiptError(f"{field} exceeds the accepted maximum of {maximum}")


def validate_receipt(
    receipt: object,
    *,
    expected_target_sha256: str,
    expected_base_sha: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    if not isinstance(receipt, dict):
        raise ReceiptError("receipt must be a JSON object")
    keys = set(receipt)
    if keys != REQUIRED_FIELDS:
        raise ReceiptError(
            f"receipt fields mismatch; missing={sorted(REQUIRED_FIELDS - keys)}, "
            f"unexpected={sorted(keys - REQUIRED_FIELDS)}"
        )
    if receipt["schema_version"] != SCHEMA_VERSION:
        raise ReceiptError("unsupported restore receipt schema")
    if receipt["status"] != "PASS":
        raise ReceiptError("restore drill status must be PASS")
    if receipt["restore_mode"] != "ISOLATED_PROJECT":
        raise ReceiptError("restore drill must use an isolated project")
    if receipt["fingerprint_match"] is not True:
        raise ReceiptError("restore fingerprint must match")
    if receipt["outbound_side_effects"] is not False:
        raise ReceiptError("restore drill must attest zero outbound side effects")
    if receipt["cleanup_status"] not in ALLOWED_CLEANUP:
        raise ReceiptError("restore drill cleanup status is not accepted")

    target = receipt["target_sha256"]
    base_sha = receipt["base_sha"]
    if not isinstance(target, str) or not SHA256_RE.fullmatch(target):
        raise ReceiptError("target_sha256 must be a lowercase SHA-256")
    if not isinstance(base_sha, str) or not SHA_RE.fullmatch(base_sha):
        raise ReceiptError("base_sha must be a lowercase Git SHA")
    if not SHA256_RE.fullmatch(expected_target_sha256):
        raise ReceiptError("expected target hash is invalid")
    if not SHA_RE.fullmatch(expected_base_sha):
        raise ReceiptError("expected base SHA is invalid")
    if not hmac.compare_digest(target, expected_target_sha256):
        raise ReceiptError("restore receipt target does not match the authorized target")
    if not hmac.compare_digest(base_sha, expected_base_sha):
        raise ReceiptError("restore receipt base SHA does not match the run SHA")

    completed_at = parse_utc(receipt["completed_at"], "completed_at")
    expires_at = parse_utc(receipt["expires_at"], "expires_at")
    current = now or datetime.now(timezone.utc)
    if current.tzinfo != timezone.utc:
        raise ReceiptError("validator clock must use UTC")
    if completed_at > current + MAX_CLOCK_SKEW:
        raise ReceiptError("restore receipt completion time is in the future")
    if current - completed_at > MAX_RECEIPT_AGE:
        raise ReceiptError("restore receipt is stale")
    if expires_at <= current:
        raise ReceiptError("restore receipt has expired")
    if expires_at > completed_at + MAX_RECEIPT_AGE:
        raise ReceiptError("restore receipt validity exceeds seven days")

    _bounded_number(receipt, "rpo_seconds", 120)
    _bounded_number(receipt, "rto_seconds", 7200)
    return receipt


def _load_receipt(args: argparse.Namespace) -> dict[str, Any]:
    raw = args.receipt_json
    if args.receipt_file:
        path = Path(args.receipt_file)
        if path.is_symlink() or not path.is_file():
            raise ReceiptError("receipt file must be a regular non-symlink file")
        raw = path.read_text(encoding="utf-8")
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ReceiptError("receipt is not valid JSON") from exc
    if not isinstance(value, dict):
        raise ReceiptError("receipt must be a JSON object")
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--receipt-json")
    source.add_argument("--receipt-file")
    parser.add_argument("--expected-target-sha256", required=True)
    parser.add_argument("--expected-base-sha", required=True)
    parser.add_argument("--expected-receipt-sha256")
    args = parser.parse_args()

    try:
        receipt = _load_receipt(args)
        validate_receipt(
            receipt,
            expected_target_sha256=args.expected_target_sha256,
            expected_base_sha=args.expected_base_sha,
        )
        digest = receipt_sha256(receipt)
        if args.expected_receipt_sha256 and not hmac.compare_digest(
            digest, args.expected_receipt_sha256
        ):
            raise ReceiptError("restore receipt hash mismatch")
    except ReceiptError as exc:
        parser.error(str(exc))
    print(f"restore receipt PASS sha256={digest}")


if __name__ == "__main__":
    main()
