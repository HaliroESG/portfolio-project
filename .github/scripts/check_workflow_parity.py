#!/usr/bin/env python3
"""Fail-closed static checks for the default-branch workflow contract."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"

EXPECTED = {
    "bootstrap-private-owner.yml",
    "ci.yml",
    "frontend-runtime-smoke.yml",
    "production-app-smoke.yml",
    "production-data-remediation.yml",
    "schedule.yml",
    "trident-price-backfill.yml",
    "trident-stock-insights.yml",
    "trident-supabase.yml",
    "workflow-parity.yml",
}
MUTATION_WORKFLOWS = {
    "production-data-remediation.yml",
    "schedule.yml",
    "trident-price-backfill.yml",
    "trident-stock-insights.yml",
    "trident-supabase.yml",
}
MIGRATION_WORKFLOWS = {
    "production-data-remediation.yml",
    "trident-supabase.yml",
}
PINNED_ACTIONS = {
    "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-python": "a26af69be951a213d495a4c3e4e4022e16d87065",
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
}
BOOTSTRAP_SHA256 = "77c9966f7a0d40efa2abd56cac0801a11437a34efec35145a69e1bb35729ae0d"


def section(text: str, start: str, end: str) -> str:
    try:
        start_index = text.index(start)
        end_index = text.index(end, start_index)
    except ValueError as exc:
        raise AssertionError(f"missing section marker: {exc}") from exc
    return text[start_index:end_index]


def require(text: str, fragment: str, path: str) -> None:
    if fragment not in text:
        raise AssertionError(f"{path}: missing required contract fragment {fragment!r}")


def forbid(text: str, fragment: str, path: str) -> None:
    if fragment in text:
        raise AssertionError(f"{path}: forbidden contract fragment {fragment!r}")


def _check_action_pins(name: str, text: str) -> None:
    for action, reference in re.findall(
        r"^\s*uses:\s*([^@\s]+)@([^\s#]+)", text, re.MULTILINE
    ):
        expected = PINNED_ACTIONS.get(action)
        if expected is None:
            raise AssertionError(f"{name}: unreviewed third-party action {action!r}")
        if reference != expected:
            raise AssertionError(
                f"{name}: {action} must be pinned to reviewed SHA {expected}"
            )


def validate_workflow_contract(contents: dict[str, str]) -> None:
    if set(contents) != EXPECTED:
        raise AssertionError("workflow inventory mismatch")
    for name, text in contents.items():
        require(text, "permissions:\n  contents: read", name)

    bootstrap = contents["bootstrap-private-owner.yml"]
    digest = hashlib.sha256(bootstrap.encode("utf-8")).hexdigest()
    if digest != BOOTSTRAP_SHA256:
        raise AssertionError("bootstrap-private-owner.yml: unconditional refusal changed")
    require(
        bootstrap,
        "BOOTSTRAP_DISABLED_PENDING_SEPARATE_AUTHORITY",
        "bootstrap-private-owner.yml",
    )

    parity_on = section(contents["workflow-parity.yml"], "on:\n", "\npermissions:")
    require(parity_on, "pull_request:", "workflow-parity.yml")
    require(parity_on, "push:", "workflow-parity.yml")
    forbid(parity_on, "paths:", "workflow-parity.yml")
    require(
        contents["workflow-parity.yml"], "workflow-contract:", "workflow-parity.yml"
    )
    require(
        contents["workflow-parity.yml"],
        "python3 -m unittest discover -s .github/tests -p 'test_*.py'",
        "workflow-parity.yml",
    )
    _check_action_pins("workflow-parity.yml", contents["workflow-parity.yml"])

    schedule_on = section(contents["schedule.yml"], "on:\n", "\npermissions:")
    require(schedule_on, "schedule:", "schedule.yml")
    require(schedule_on, "cron:", "schedule.yml")
    require(schedule_on, "default: validate", "schedule.yml")
    schedule = contents["schedule.yml"]
    require(schedule, "scheduler-heartbeat:", "schedule.yml")
    require(schedule, "github.event_name == 'schedule'", "schedule.yml")
    require(schedule, "python3 .github/scripts/check_workflow_parity.py", "schedule.yml")
    require(schedule, "github.event_name == 'workflow_dispatch'", "schedule.yml")
    heartbeat = section(schedule, "  scheduler-heartbeat:\n", "\n  preflight:")
    forbid(heartbeat, "secrets.", "schedule.yml scheduler heartbeat")
    forbid(heartbeat, "vars.", "schedule.yml scheduler heartbeat")
    forbid(heartbeat, "environment: Production", "schedule.yml scheduler heartbeat")
    require(
        schedule,
        "  preflight:\n    if: ${{ github.event_name == 'workflow_dispatch' && inputs.scope != 'validate' }}",
        "schedule.yml",
    )

    for name in MUTATION_WORKFLOWS:
        text = contents[name]
        require(text, "portfolio-production-mutation", name)
        require(text, "cancel-in-progress: false", name)
        require(text, "authorization_manifest:", name)
        require(text, "authorization_manifest_sha256:", name)
        require(text, "check_mutation_contract.py", name)
        require(text, "Verify immutable mutation authorization", name)
        require(text, "Apply provider kill switches", name)
        require(text, "ASTROCYTE_MUTATION_GATE", name)
        require(text, "ASTROCYTE_SOURCE_RIGHTS_GATE", name)
        if text.index("Verify immutable mutation authorization") > text.index(
            "Apply provider kill switches"
        ):
            raise AssertionError(f"{name}: provider kill switches run before authority")
        _check_action_pins(name, text)

    for name in MIGRATION_WORKFLOWS:
        text = contents[name]
        require(text, "--single-transaction", name)
        if re.search(
            r"name: Pre-migration schema check\n(?:\s+[^\n]+\n){0,3}\s+continue-on-error:",
            text,
        ):
            raise AssertionError(f"{name}: pre-migration check may not continue on error")
        if re.search(
            r"name: Post-migration schema check\n(?:\s+[^\n]+\n){0,3}\s+continue-on-error:",
            text,
        ):
            raise AssertionError(f"{name}: post-migration check may not continue on error")

    trident = contents["trident-supabase.yml"]
    validate_job = section(trident, "  validate:\n", "\n  mutate-production:")
    forbid(
        validate_job,
        "environment: Production",
        "trident-supabase.yml validate job",
    )
    require(trident, "  mutate-production:", "trident-supabase.yml")
    require(trident, "environment: Production", "trident-supabase.yml")
    require(
        trident,
        "github.event_name == 'workflow_dispatch'",
        "trident-supabase.yml",
    )

    remediation_on = section(
        contents["production-data-remediation.yml"], "on:\n", "\npermissions:"
    )
    forbid(remediation_on, "\n  push:", "production-data-remediation.yml")
    forbid(
        contents["production-data-remediation.yml"],
        "cancel-in-progress: true",
        "production-data-remediation.yml",
    )


def main() -> None:
    actual = {path.name for path in WORKFLOWS.glob("*.yml")}
    if actual != EXPECTED:
        missing = sorted(EXPECTED - actual)
        unexpected = sorted(actual - EXPECTED)
        raise AssertionError(
            f"workflow inventory mismatch; missing={missing}, unexpected={unexpected}"
        )
    contents = {
        name: (WORKFLOWS / name).read_text(encoding="utf-8") for name in EXPECTED
    }
    validate_workflow_contract(contents)
    print(f"workflow parity PASS: {len(actual)} workflow files")


if __name__ == "__main__":
    main()
