#!/usr/bin/env python3
"""Validate immutable authorization before any Production mutation."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from verify_backup_restore_receipt import (
    ReceiptError,
    canonical_json,
    parse_utc,
    receipt_sha256,
    validate_receipt,
)


SCHEMA_VERSION = "astrocyte_mutation_authorization_v1"
MAX_AUTHORIZATION_WINDOW = timedelta(hours=24)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
CONTROLLER_REF_RE = re.compile(r"^[A-Z0-9][A-Z0-9._:/-]{7,127}$")
TICKER_RE = re.compile(r"^[A-Z0-9.^:=/-]{1,32}$")
REQUIRED_MANIFEST_FIELDS = {
    "schema_version",
    "workflow",
    "ref",
    "run_sha",
    "controller_ref",
    "expires_at",
    "target_sha256",
    "restore_receipt_sha256",
    "restore_receipt",
    "inputs",
}


class ContractError(ValueError):
    """Raised when mutation authorization fails closed."""


def _bool(value: str) -> bool:
    if value not in {"true", "false"}:
        raise ContractError("boolean inputs must be exactly true or false")
    return value == "true"


def _integer(value: str, minimum: int = 1, maximum: int = 5000) -> int:
    if not re.fullmatch(r"0|[1-9][0-9]*", value):
        raise ContractError("integer inputs must use canonical decimal form")
    parsed = int(value)
    if not minimum <= parsed <= maximum:
        raise ContractError(f"integer input must be between {minimum} and {maximum}")
    return parsed


def _date(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ContractError("date inputs must use YYYY-MM-DD") from exc
    if parsed.isoformat() != value:
        raise ContractError("date inputs must use canonical YYYY-MM-DD")
    return value


def _optional_date(value: str) -> str | None:
    return None if value == "" else _date(value)


def _enum(*allowed: str) -> Callable[[str], str]:
    def normalize(value: str) -> str:
        if value not in allowed:
            raise ContractError(f"input must be one of {sorted(allowed)}")
        return value

    return normalize


def _optional_ticker(value: str) -> str | None:
    if value == "":
        return None
    if value != value.strip().upper() or not TICKER_RE.fullmatch(value):
        raise ContractError("ticker input is not normalized")
    return value


WORKFLOW_SCHEMAS: dict[str, dict[str, Callable[[str], Any]]] = {
    "financial-data-sync": {
        "scope": _enum("all", "core", "history", "trident", "backtest"),
        "trident_mode": _enum("daily", "full"),
        "trident_price_start_date": _optional_date,
    },
    "production-data-remediation": {
        "apply_schema": _bool,
        "top_n": _integer,
        "start_date": _date,
        "run_full_after_top": _bool,
    },
    "trident-price-backfill": {
        "top_n": _integer,
        "start_date": _date,
        "end_date": _optional_date,
        "dry_run": _bool,
    },
    "trident-stock-insights": {
        "top_n": _integer,
        "ticker": _optional_ticker,
        "force": _bool,
        "dry_run": _bool,
    },
    "trident-supabase": {
        "apply_schema": _bool,
        "run_trident_etl": _bool,
    },
}


def parse_inputs(items: list[str]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for item in items:
        key, separator, value = item.partition("=")
        if not separator or not key or key in parsed:
            raise ContractError("inputs must be unique key=value pairs")
        parsed[key] = value
    return parsed


def normalize_inputs(workflow: str, raw: dict[str, str]) -> dict[str, Any]:
    schema = WORKFLOW_SCHEMAS.get(workflow)
    if schema is None:
        raise ContractError("workflow is not authorized for Production mutation")
    if set(raw) != set(schema):
        raise ContractError(
            f"input fields mismatch; missing={sorted(set(schema) - set(raw))}, "
            f"unexpected={sorted(set(raw) - set(schema))}"
        )
    normalized = {name: schema[name](raw[name]) for name in sorted(schema)}
    if workflow == "financial-data-sync" and normalized["scope"] == "validate":
        raise ContractError("validate is not a mutating scope")
    if workflow == "trident-supabase" and not (
        normalized["apply_schema"] or normalized["run_trident_etl"]
    ):
        raise ContractError("at least one Supabase mutation must be explicitly selected")
    if workflow in {"trident-price-backfill", "trident-stock-insights"} and normalized[
        "dry_run"
    ]:
        raise ContractError("dry-run does not consume Production mutation authority")
    return normalized


def manifest_sha256(manifest: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(manifest).encode("utf-8")).hexdigest()


def validate_contract(
    manifest: object,
    *,
    expected_manifest_sha256: str,
    workflow: str,
    repository: str,
    workflow_ref: str,
    event_name: str,
    ref: str,
    run_sha: str,
    raw_inputs: dict[str, str],
    now: datetime | None = None,
) -> dict[str, Any]:
    if not isinstance(manifest, dict):
        raise ContractError("authorization manifest must be a JSON object")
    keys = set(manifest)
    if keys != REQUIRED_MANIFEST_FIELDS:
        raise ContractError(
            f"manifest fields mismatch; missing={sorted(REQUIRED_MANIFEST_FIELDS - keys)}, "
            f"unexpected={sorted(keys - REQUIRED_MANIFEST_FIELDS)}"
        )
    if manifest["schema_version"] != SCHEMA_VERSION:
        raise ContractError("unsupported authorization manifest schema")
    if event_name != "workflow_dispatch":
        raise ContractError("Production mutation requires workflow_dispatch")
    if ref != "refs/heads/main" or manifest["ref"] != ref:
        raise ContractError("Production mutation requires refs/heads/main")
    if not SHA_RE.fullmatch(run_sha) or manifest["run_sha"] != run_sha:
        raise ContractError("authorization run SHA does not match github.sha")
    if manifest["workflow"] != workflow or workflow not in WORKFLOW_SCHEMAS:
        raise ContractError("workflow/action is not authorized")
    expected_workflow_ref = (
        f"{repository}/.github/workflows/"
        f"{workflow.replace('financial-data-sync', 'schedule')}.yml@{ref}"
    )
    if workflow_ref != expected_workflow_ref:
        raise ContractError("controller workflow_ref does not match the main workflow")

    controller_ref = manifest["controller_ref"]
    if not isinstance(controller_ref, str) or not CONTROLLER_REF_RE.fullmatch(
        controller_ref
    ):
        raise ContractError("controller_ref is missing or not normalized")
    target_sha256 = manifest["target_sha256"]
    if not isinstance(target_sha256, str) or not SHA256_RE.fullmatch(target_sha256):
        raise ContractError("target_sha256 must be a lowercase SHA-256")
    receipt_digest = manifest["restore_receipt_sha256"]
    if not isinstance(receipt_digest, str) or not SHA256_RE.fullmatch(receipt_digest):
        raise ContractError("restore_receipt_sha256 must be a lowercase SHA-256")
    if not hmac.compare_digest(receipt_digest, receipt_sha256(manifest["restore_receipt"])):
        raise ContractError("restore receipt hash mismatch")

    current = now or datetime.now(timezone.utc)
    expires_at = parse_utc(manifest["expires_at"], "expires_at")
    if expires_at <= current:
        raise ContractError("authorization manifest has expired")
    if expires_at > current + MAX_AUTHORIZATION_WINDOW:
        raise ContractError("authorization manifest exceeds the 24-hour run window")

    normalized_inputs = normalize_inputs(workflow, raw_inputs)
    if manifest["inputs"] != normalized_inputs:
        raise ContractError("authorization inputs do not match normalized run inputs")
    if not SHA256_RE.fullmatch(expected_manifest_sha256):
        raise ContractError("authorization manifest hash is invalid")
    if not hmac.compare_digest(
        manifest_sha256(manifest), expected_manifest_sha256
    ):
        raise ContractError("authorization manifest hash mismatch")

    try:
        validate_receipt(
            manifest["restore_receipt"],
            expected_target_sha256=target_sha256,
            expected_base_sha=run_sha,
            now=current,
        )
    except ReceiptError as exc:
        raise ContractError(str(exc)) from exc
    return manifest


def _load_manifest(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ContractError("authorization manifest is not valid JSON") from exc
    if not isinstance(value, dict):
        raise ContractError("authorization manifest must be a JSON object")
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow", required=True, choices=sorted(WORKFLOW_SCHEMAS))
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--manifest-file")
    parser.add_argument("--hash-only", action="store_true")
    args = parser.parse_args()

    try:
        raw_manifest = os.environ.get("AUTHORIZATION_MANIFEST", "")
        if args.manifest_file:
            path = Path(args.manifest_file)
            if path.is_symlink() or not path.is_file():
                raise ContractError("manifest file must be a regular non-symlink file")
            raw_manifest = path.read_text(encoding="utf-8")
        manifest = _load_manifest(raw_manifest)
        digest = manifest_sha256(manifest)
        if args.hash_only:
            print(canonical_json(manifest))
            print(digest)
            return
        validate_contract(
            manifest,
            expected_manifest_sha256=os.environ.get(
                "AUTHORIZATION_MANIFEST_SHA256", ""
            ),
            workflow=args.workflow,
            repository=os.environ.get("GITHUB_REPOSITORY", ""),
            workflow_ref=os.environ.get("GITHUB_WORKFLOW_REF", ""),
            event_name=os.environ.get("GITHUB_EVENT_NAME", ""),
            ref=os.environ.get("GITHUB_REF", ""),
            run_sha=os.environ.get("GITHUB_SHA", ""),
            raw_inputs=parse_inputs(args.input),
        )
    except (ContractError, ReceiptError) as exc:
        parser.error(str(exc))
    print(
        f"mutation contract PASS workflow={args.workflow} "
        f"manifest_sha256={digest}"
    )


if __name__ == "__main__":
    main()
