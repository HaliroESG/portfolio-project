#!/usr/bin/env python3
"""Validate and enforce the repository-native PR14 Family Office release hold."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
HOLD_FILE = ROOT / ".github" / "family-office-release-hold-v1.json"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
EXPECTED_SUBJECT = {
    "pr": 14,
    "head_sha": "bd1bd27330031fa990993f8537865c2e2e3bfb43",
    "tree_sha": "074b71dffbc508bb32efb6699c663006d9bbbd00",
    "merge_sha": "a3d07b1d9184a0a7f4ee4f750d2e43b5f8a3bd2f",
}
EXPECTED_REVIEW = {
    "verdict": "FAIL",
    "ship": "FIX_FIRST",
    "review_sha256": "2100a8a73ce9bade8e2c69d2880731853ae85286a8d52847f159c16a17b8abdd",
    "handoff_sha256": "9c960380525f963ee5c507f507ebebb5e814579c1a95bcce0a51cf2c1d15850a",
    "producer_packet_sha256": "2c834ae47e9946ae39237f22a0ce12a45ce2b987bfa82d015b3fa46858a745cd",
}
EXPECTED_CLEARANCE = {
    "requires_fresh_independent_review": True,
    "requires_exact_head_context": "ASTROCYTE Independent Review",
    "requires_controller_authority": True,
    "requires_separate_reviewed_change": True,
}
REQUIRED_FIELDS = {
    "schema_version",
    "status",
    "scope",
    "reason",
    "subject",
    "independent_review",
    "mutation_allowed",
    "provider_actions_allowed",
    "clearance_contract",
}


class ReleaseHoldError(ValueError):
    """Raised when the release-hold contract is malformed or inactive."""


class ReleaseHoldActive(ReleaseHoldError):
    """Raised whenever a Family Office release mutation is attempted."""


def _strict_json(raw: str) -> Any:
    def reject_constant(value: str) -> None:
        raise ReleaseHoldError(f"non-standard JSON constant {value!r} is forbidden")

    try:
        return json.loads(raw, parse_constant=reject_constant)
    except json.JSONDecodeError as exc:
        raise ReleaseHoldError("release hold is not valid strict JSON") from exc


def validate_release_hold(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ReleaseHoldError("release hold must be an object")
    if set(value) != REQUIRED_FIELDS:
        raise ReleaseHoldError("release hold fields changed")
    if value["schema_version"] != "astrocyte_family_office_release_hold_v1":
        raise ReleaseHoldError("release hold schema changed")
    if value["status"] != "ACTIVE":
        raise ReleaseHoldError("Family Office release hold must remain ACTIVE")
    if value["scope"] != "FAMILY_OFFICE_RELEASE_MUTATION":
        raise ReleaseHoldError("release hold scope changed")
    if value["reason"] != "PR14_INDEPENDENT_REVIEW_FIX_FIRST":
        raise ReleaseHoldError("release hold reason changed")
    if value["subject"] != EXPECTED_SUBJECT:
        raise ReleaseHoldError("release hold subject is not the exact merged PR14 tree")
    if value["independent_review"] != EXPECTED_REVIEW:
        raise ReleaseHoldError("release hold review binding changed")
    if value["mutation_allowed"] is not False:
        raise ReleaseHoldError("Family Office release mutation must remain forbidden")
    if value["provider_actions_allowed"] is not False:
        raise ReleaseHoldError("provider actions must remain forbidden")
    if value["clearance_contract"] != EXPECTED_CLEARANCE:
        raise ReleaseHoldError("release hold clearance contract changed")
    for field in ("head_sha", "tree_sha", "merge_sha"):
        if not SHA_RE.fullmatch(value["subject"][field]):
            raise ReleaseHoldError(f"{field} must be an exact Git SHA")
    for field in ("review_sha256", "handoff_sha256", "producer_packet_sha256"):
        if not SHA256_RE.fullmatch(value["independent_review"][field]):
            raise ReleaseHoldError(f"{field} must be a SHA-256")
    return value


def load_release_hold(path: Path = HOLD_FILE) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise ReleaseHoldError("release hold must be a regular non-symlink file")
    return validate_release_hold(_strict_json(path.read_text(encoding="utf-8")))


def enforce_family_office_release_hold(path: Path = HOLD_FILE) -> None:
    hold = load_release_hold(path)
    raise ReleaseHoldActive(
        "FAMILY_OFFICE_PRODUCTION_HTTP_503: active PR14 FIX_FIRST release hold "
        f"blocks {hold['scope']}"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--validate", action="store_true")
    mode.add_argument("--enforce-mutation", action="store_true")
    args = parser.parse_args()
    try:
        hold = load_release_hold()
        if args.enforce_mutation:
            enforce_family_office_release_hold()
    except ReleaseHoldActive as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 78
    except ReleaseHoldError as exc:
        print(f"release hold validation failed: {exc}", file=sys.stderr)
        return 2
    print(
        "Family Office release hold PASS "
        f"status={hold['status']} mutation_allowed=false provider_actions_allowed=false"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
