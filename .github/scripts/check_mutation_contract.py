#!/usr/bin/env python3
"""Authenticate and consume one-shot authority before a Production mutation."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional


SCHEMA_VERSION = "astrocyte_mutation_authorization_v2"
RECEIPT_SCHEMA_VERSION = "astrocyte_restore_drill_receipt_v1"
TRUSTED_ISSUER = "ASTROCYTE_CONTROL_CENTER_V1"
MAX_AUTHORIZATION_WINDOW = timedelta(hours=24)
MAX_RECEIPT_AGE = timedelta(days=7)
MAX_CLOCK_SKEW = timedelta(minutes=5)
REPLAY_RETENTION_DAYS = 30
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
CONTROLLER_REF_RE = re.compile(r"^[A-Z0-9][A-Z0-9._:/-]{7,127}$")
NONCE_RE = re.compile(r"^[0-9a-f]{32,64}$")
RECEIPT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{15,63}$")
TICKER_RE = re.compile(r"^[A-Z0-9.^:=/-]{1,32}$")
FAMILY_OFFICE_CANDIDATE_SHA = "c01eb33878e4030975144c5b0ae98e9bdf31ea04"
FAMILY_OFFICE_MIGRATION_SHA256 = (
    "5ca9423c2a4eb367d764b3c8830fb6ba2d38bb91f7b70f545576e618928932cf"
)
ALLOWED_CLEANUP = {"DELETED", "PAUSED", "RETAINED_WITH_AUTHORITY"}
REQUIRED_MANIFEST_FIELDS = {
    "schema_version",
    "issuer",
    "repository",
    "workflow",
    "ref",
    "run_sha",
    "controller_ref",
    "issued_at",
    "expires_at",
    "target_sha256",
    "restore_receipt_sha256",
    "restore_receipt",
    "inputs",
    "nonce",
    "receipt_id",
}
REQUIRED_RECEIPT_FIELDS = {
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


class ReceiptError(ValueError):
    """Raised when a restore receipt fails closed."""


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
        raise ReceiptError("value is not strict JSON") from exc


def strict_json_loads(raw: str) -> Any:
    def reject_constant(value: str) -> None:
        raise ReceiptError(f"non-standard JSON constant {value!r} is forbidden")

    try:
        return json.loads(raw, parse_constant=reject_constant)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ReceiptError("value is not valid strict JSON") from exc


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
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
    ):
        raise ReceiptError(f"{field} must be a non-negative number")
    if value > maximum:
        raise ReceiptError(f"{field} exceeds the accepted maximum of {maximum}")


def validate_receipt(
    receipt: object,
    *,
    expected_target_sha256: str,
    expected_base_sha: str,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    if not isinstance(receipt, dict):
        raise ReceiptError("receipt must be a JSON object")
    keys = set(receipt)
    if keys != REQUIRED_RECEIPT_FIELDS:
        raise ReceiptError(
            f"receipt fields mismatch; missing={sorted(REQUIRED_RECEIPT_FIELDS - keys)}, "
            f"unexpected={sorted(keys - REQUIRED_RECEIPT_FIELDS)}"
        )
    if receipt["schema_version"] != RECEIPT_SCHEMA_VERSION:
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


def _optional_date(value: str) -> Optional[str]:
    return None if value == "" else _date(value)


def _enum(*allowed: str) -> Callable[[str], str]:
    def normalize(value: str) -> str:
        if value not in allowed:
            raise ContractError(f"input must be one of {sorted(allowed)}")
        return value

    return normalize


def _optional_ticker(value: str) -> Optional[str]:
    if value == "":
        return None
    if value != value.strip().upper() or not TICKER_RE.fullmatch(value):
        raise ContractError("ticker input is not normalized")
    return value


def _family_office_candidate_sha(value: str) -> str:
    if value != FAMILY_OFFICE_CANDIDATE_SHA:
        raise ContractError("Family Office candidate SHA is not the reviewed PR12 pin")
    return value


def _family_office_migration_sha256(value: str) -> str:
    if value != FAMILY_OFFICE_MIGRATION_SHA256:
        raise ContractError("Family Office migration SHA-256 is not the reviewed PR12 pin")
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
    "family-office-release": {
        "candidate_sha": _family_office_candidate_sha,
        "migration_sha256": _family_office_migration_sha256,
        "mutate_production": _bool,
    },
}

WORKFLOW_FILES = {
    "financial-data-sync": "schedule.yml",
    "production-data-remediation": "production-data-remediation.yml",
    "trident-price-backfill": "trident-price-backfill.yml",
    "trident-stock-insights": "trident-stock-insights.yml",
    "trident-supabase": "trident-supabase.yml",
    "family-office-release": "family-office-release.yml",
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
    if workflow == "trident-supabase" and not (
        normalized["apply_schema"] or normalized["run_trident_etl"]
    ):
        raise ContractError("at least one Supabase mutation must be explicitly selected")
    if workflow == "family-office-release" and not normalized["mutate_production"]:
        raise ContractError("Family Office Production mutation must be explicitly selected")
    return normalized


def manifest_sha256(manifest: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(manifest).encode("utf-8")).hexdigest()


def authorization_signature(manifest: dict[str, Any], secret: str) -> str:
    if len(secret.encode("utf-8")) < 32:
        raise ContractError("authorization HMAC key must contain at least 32 bytes")
    return hmac.new(
        secret.encode("utf-8"),
        canonical_json(manifest).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def validate_contract(
    manifest: object,
    *,
    expected_manifest_sha256: str,
    signature: str,
    hmac_key: str,
    expected_nonce: str,
    expected_receipt_id: str,
    workflow: str,
    repository: str,
    workflow_ref: str,
    event_name: str,
    ref: str,
    run_sha: str,
    raw_inputs: dict[str, str],
    now: Optional[datetime] = None,
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
    if manifest["issuer"] != TRUSTED_ISSUER:
        raise ContractError("authorization issuer is not trusted")
    if not repository or manifest["repository"] != repository:
        raise ContractError("authorization repository does not match github.repository")
    if event_name != "workflow_dispatch":
        raise ContractError("Production mutation requires workflow_dispatch")
    if ref != "refs/heads/main" or manifest["ref"] != ref:
        raise ContractError("Production mutation requires refs/heads/main")
    if not SHA_RE.fullmatch(run_sha) or manifest["run_sha"] != run_sha:
        raise ContractError("authorization run SHA does not match github.sha")
    if manifest["workflow"] != workflow or workflow not in WORKFLOW_SCHEMAS:
        raise ContractError("workflow/action is not authorized")
    expected_workflow_ref = (
        f"{repository}/.github/workflows/{WORKFLOW_FILES[workflow]}@{ref}"
    )
    if workflow_ref != expected_workflow_ref:
        raise ContractError("controller workflow_ref does not match the main workflow")

    controller_ref = manifest["controller_ref"]
    if not isinstance(controller_ref, str) or not CONTROLLER_REF_RE.fullmatch(
        controller_ref
    ):
        raise ContractError("controller_ref is missing or not normalized")
    nonce = manifest["nonce"]
    if (
        not isinstance(nonce, str)
        or not NONCE_RE.fullmatch(nonce)
        or nonce != expected_nonce
    ):
        raise ContractError("authorization nonce is missing, invalid, or mismatched")
    receipt_id = manifest["receipt_id"]
    if (
        not isinstance(receipt_id, str)
        or not RECEIPT_ID_RE.fullmatch(receipt_id)
        or receipt_id != expected_receipt_id
    ):
        raise ContractError("authorization receipt_id is missing, invalid, or mismatched")
    target_sha256 = manifest["target_sha256"]
    if not isinstance(target_sha256, str) or not SHA256_RE.fullmatch(target_sha256):
        raise ContractError("target_sha256 must be a lowercase SHA-256")
    receipt_digest = manifest["restore_receipt_sha256"]
    if not isinstance(receipt_digest, str) or not SHA256_RE.fullmatch(receipt_digest):
        raise ContractError("restore_receipt_sha256 must be a lowercase SHA-256")
    try:
        actual_receipt_digest = receipt_sha256(manifest["restore_receipt"])
    except ReceiptError as exc:
        raise ContractError(str(exc)) from exc
    if not hmac.compare_digest(receipt_digest, actual_receipt_digest):
        raise ContractError("restore receipt hash mismatch")

    current = now or datetime.now(timezone.utc)
    if current.tzinfo != timezone.utc:
        raise ContractError("validator clock must use UTC")
    try:
        issued_at = parse_utc(manifest["issued_at"], "issued_at")
        expires_at = parse_utc(manifest["expires_at"], "expires_at")
    except ReceiptError as exc:
        raise ContractError(str(exc)) from exc
    if issued_at > current + MAX_CLOCK_SKEW:
        raise ContractError("authorization issue time is in the future")
    if expires_at <= current:
        raise ContractError("authorization manifest has expired")
    if expires_at <= issued_at or expires_at > issued_at + MAX_AUTHORIZATION_WINDOW:
        raise ContractError("authorization validity must be within 24 hours of issue")

    normalized_inputs = normalize_inputs(workflow, raw_inputs)
    if manifest["inputs"] != normalized_inputs:
        raise ContractError("authorization inputs do not match normalized run inputs")
    if not SHA256_RE.fullmatch(expected_manifest_sha256):
        raise ContractError("authorization manifest hash is invalid")
    try:
        actual_manifest_digest = manifest_sha256(manifest)
    except ReceiptError as exc:
        raise ContractError(str(exc)) from exc
    if not hmac.compare_digest(actual_manifest_digest, expected_manifest_sha256):
        raise ContractError("authorization manifest hash mismatch")
    if not SHA256_RE.fullmatch(signature):
        raise ContractError("authorization signature must be a lowercase HMAC-SHA256")
    expected_signature = authorization_signature(manifest, hmac_key)
    if not hmac.compare_digest(expected_signature, signature):
        raise ContractError("authorization signature is invalid")

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


def replay_artifact_name(receipt_id: str, nonce: str) -> str:
    if not RECEIPT_ID_RE.fullmatch(receipt_id) or not NONCE_RE.fullmatch(nonce):
        raise ContractError("cannot derive replay key from invalid receipt_id or nonce")
    return f"mutation-replay-{receipt_id}-{nonce}"


def validate_replay_artifacts(
    phase: str,
    artifacts: object,
    *,
    expected_name: str,
    run_id: str,
) -> None:
    if phase not in {"claim", "enforce"}:
        raise ContractError("anti-replay phase must be claim or enforce")
    if not isinstance(artifacts, list):
        raise ContractError("GitHub artifact response is not a list")
    exact: list[dict[str, Any]] = []
    for artifact in artifacts:
        if not isinstance(artifact, dict) or artifact.get("name") != expected_name:
            raise ContractError("GitHub artifact response contains an invalid record")
        exact.append(artifact)
    if phase == "claim":
        if exact:
            raise ContractError("authorization receipt_id and nonce were already consumed")
        return
    if len(exact) != 1:
        raise ContractError("one current-run anti-replay marker is required")
    artifact = exact[0]
    workflow_run = artifact.get("workflow_run")
    if artifact.get("expired") is not False or not isinstance(workflow_run, dict):
        raise ContractError("anti-replay marker is expired or lacks run provenance")
    if not run_id or str(workflow_run.get("id")) != run_id:
        raise ContractError("anti-replay marker belongs to a different workflow run")


def _load_manifest(raw: str) -> dict[str, Any]:
    try:
        value = strict_json_loads(raw)
    except ReceiptError as exc:
        raise ContractError("authorization manifest is not valid strict JSON") from exc
    if not isinstance(value, dict):
        raise ContractError("authorization manifest must be a JSON object")
    return value


def _fetch_replay_artifacts(name: str, *, attempts: int) -> list[dict[str, Any]]:
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    api_url = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
    if not repository or not token:
        raise ContractError("GitHub repository and token are required for anti-replay")
    query = urllib.parse.urlencode({"name": name, "per_page": "100"})
    url = f"{api_url}/repos/{repository}/actions/artifacts?{query}"
    for attempt in range(attempts):
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {token}",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = strict_json_loads(response.read().decode("utf-8"))
        except (OSError, UnicodeError, urllib.error.HTTPError, ReceiptError) as exc:
            raise ContractError("GitHub anti-replay artifact lookup failed") from exc
        artifacts = payload.get("artifacts") if isinstance(payload, dict) else None
        if not isinstance(artifacts, list):
            raise ContractError("GitHub anti-replay artifact response is malformed")
        if artifacts or attempt == attempts - 1:
            return artifacts
        time.sleep(1)
    raise ContractError("GitHub anti-replay artifact lookup exhausted")


def _write_marker(path_value: str, manifest: dict[str, Any], run_id: str) -> None:
    runner_temp = os.environ.get("RUNNER_TEMP", "")
    if not runner_temp or not path_value or not run_id:
        raise ContractError("runner temp, marker path, and run id are required")
    root = Path(runner_temp).resolve()
    path = Path(path_value)
    if path.parent.resolve() != root or path.exists() or path.is_symlink():
        raise ContractError("anti-replay marker path must be a fresh runner-temp file")
    marker = {
        "schema_version": "astrocyte_mutation_replay_marker_v1",
        "issuer": manifest["issuer"],
        "repository": manifest["repository"],
        "workflow": manifest["workflow"],
        "run_sha": manifest["run_sha"],
        "receipt_id": manifest["receipt_id"],
        "nonce": manifest["nonce"],
        "authorization_manifest_sha256": manifest_sha256(manifest),
        "workflow_run_id": run_id,
        "retention_days": REPLAY_RETENTION_DAYS,
    }
    try:
        with path.open("x", encoding="utf-8") as handle:
            handle.write(canonical_json(marker) + "\n")
    except OSError as exc:
        raise ContractError("could not create anti-replay marker") from exc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow", required=True, choices=sorted(WORKFLOW_SCHEMAS))
    parser.add_argument("--input", action="append", default=[])
    parser.add_argument("--manifest-file")
    parser.add_argument("--hash-only", action="store_true")
    parser.add_argument("--replay-phase", choices=("claim", "enforce"))
    parser.add_argument("--marker-file")
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
            signature=os.environ.get("AUTHORIZATION_SIGNATURE", ""),
            hmac_key=os.environ.get("AUTHORIZATION_HMAC_KEY", ""),
            expected_nonce=os.environ.get("AUTHORIZATION_NONCE", ""),
            expected_receipt_id=os.environ.get("AUTHORIZATION_RECEIPT_ID", ""),
            workflow=args.workflow,
            repository=os.environ.get("GITHUB_REPOSITORY", ""),
            workflow_ref=os.environ.get("GITHUB_WORKFLOW_REF", ""),
            event_name=os.environ.get("GITHUB_EVENT_NAME", ""),
            ref=os.environ.get("GITHUB_REF", ""),
            run_sha=os.environ.get("GITHUB_SHA", ""),
            raw_inputs=parse_inputs(args.input),
        )
        if not args.replay_phase:
            raise ContractError("one-shot anti-replay phase is required")
        replay_name = replay_artifact_name(manifest["receipt_id"], manifest["nonce"])
        artifacts = _fetch_replay_artifacts(
            replay_name, attempts=5 if args.replay_phase == "enforce" else 1
        )
        validate_replay_artifacts(
            args.replay_phase,
            artifacts,
            expected_name=replay_name,
            run_id=os.environ.get("GITHUB_RUN_ID", ""),
        )
        if args.replay_phase == "claim":
            if not args.marker_file:
                raise ContractError("claim phase requires a marker file")
            _write_marker(args.marker_file, manifest, os.environ.get("GITHUB_RUN_ID", ""))
        elif args.marker_file:
            raise ContractError("enforce phase must not create a marker file")
    except (ContractError, ReceiptError) as exc:
        parser.error(str(exc))
    print(
        f"mutation contract PASS workflow={args.workflow} "
        f"phase={args.replay_phase} manifest_sha256={digest}"
    )


if __name__ == "__main__":
    main()
