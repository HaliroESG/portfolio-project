#!/usr/bin/env python3
"""Fail-closed static checks for the default-branch workflow contract."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
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
EXPECTED_ENFORCEMENT_COUNTS = {
    "production-data-remediation.yml": 1,
    "schedule.yml": 6,
    "trident-price-backfill.yml": 1,
    "trident-stock-insights.yml": 1,
    "trident-supabase.yml": 1,
}
TRUST_BOUNDARY_JOBS = {
    "production-data-remediation.yml": {
        "remediate-data": ("Claim one-shot mutation authorization", "Resolve database URL"),
    },
    "schedule.yml": {
        "preflight": ("Claim one-shot mutation authorization", "Preflight schema check"),
        "refresh-core": ("Verify authority before mutable setup", "Refresh core feeds"),
        "refresh-market-history": ("Verify authority before mutable setup", "Refresh historical prices"),
        "refresh-trident": ("Verify authority before mutable setup", "Refresh Trident screener"),
        "refresh-backtest": ("Verify authority before mutable setup", "Refresh production reference backtest"),
        "post-refresh-gate": ("Verify authority before mutable setup", "Post-refresh schema check"),
    },
    "trident-price-backfill.yml": {
        "top-backfill": ("Claim one-shot mutation authorization", "Preflight schema check"),
    },
    "trident-stock-insights.yml": {
        "sync-insights": ("Claim one-shot mutation authorization", "Preflight schema check"),
    },
    "trident-supabase.yml": {
        "mutate-production": ("Claim one-shot mutation authorization", "Pre-migration schema check"),
    },
}
PINNED_ACTIONS = {
    "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-python": "a26af69be951a213d495a4c3e4e4022e16d87065",
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
    "actions/download-artifact": "d3f86a106a0bac45b974a628896c90dbdf5c8093",
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


def require_order(text: str, before: str, after: str, path: str) -> None:
    require(text, before, path)
    require(text, after, path)
    if text.index(before) > text.index(after):
        raise AssertionError(f"{path}: {before!r} must precede {after!r}")


RUBY_YAML_USES_PARSER = r"""
require "json"
require "psych"
document = Psych.safe_load(
  STDIN.read,
  permitted_classes: [],
  permitted_symbols: [],
  aliases: true
)
uses = []
walk = lambda do |node|
  case node
  when Hash
    node.each do |key, value|
      uses << value if key.to_s == "uses"
      walk.call(value)
    end
  when Array
    node.each { |value| walk.call(value) }
  end
end
walk.call(document)
STDOUT.write(JSON.generate(uses))
"""

RUBY_YAML_DOCUMENT_PARSER = r"""
require "json"
require "psych"
document = Psych.safe_load(
  STDIN.read,
  permitted_classes: [],
  permitted_symbols: [],
  aliases: true
)
STDOUT.write(JSON.generate(document))
"""


def _parse_workflow_uses(name: str, text: str) -> list[str]:
    try:
        result = subprocess.run(
            ["ruby", "-e", RUBY_YAML_USES_PARSER],
            input=text,
            text=True,
            capture_output=True,
            check=True,
            timeout=15,
        )
        parsed = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
        raise AssertionError(f"{name}: semantic YAML parsing failed closed") from exc
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise AssertionError(f"{name}: every semantic uses value must be a string")
    return parsed


def _parse_workflow_document(name: str, text: str) -> dict[str, object]:
    try:
        result = subprocess.run(
            ["ruby", "-e", RUBY_YAML_DOCUMENT_PARSER],
            input=text,
            text=True,
            capture_output=True,
            check=True,
            timeout=15,
        )
        parsed = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
        raise AssertionError(f"{name}: semantic YAML document parsing failed closed") from exc
    if not isinstance(parsed, dict):
        raise AssertionError(f"{name}: workflow document must be a mapping")
    return parsed


def _check_trust_boundaries(name: str, text: str) -> None:
    document = _parse_workflow_document(name, text)
    jobs = document.get("jobs")
    if not isinstance(jobs, dict):
        raise AssertionError(f"{name}: jobs must be a mapping")
    preparation = jobs.get("prepare-runtime")
    if not isinstance(preparation, dict):
        raise AssertionError(f"{name}: isolated prepare-runtime job is missing")
    encoded_preparation = json.dumps(preparation, sort_keys=True)
    if "environment" in preparation or "secrets." in encoded_preparation:
        raise AssertionError(
            f"{name}: dependency preparation must not receive Production or secrets"
        )
    if "Build untrusted dependency artifact without secrets" not in encoded_preparation:
        raise AssertionError(f"{name}: dependency preparation contract is missing")
    for job_name, (initial_boundary, provider_step) in TRUST_BOUNDARY_JOBS[name].items():
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            raise AssertionError(f"{name}: missing protected job {job_name}")
        job_env = json.dumps(job.get("env", {}), sort_keys=True)
        if "secrets." in job_env:
            raise AssertionError(f"{name} {job_name}: provider secrets may not be job-scoped")
        steps = job.get("steps")
        if not isinstance(steps, list) or not all(isinstance(step, dict) for step in steps):
            raise AssertionError(f"{name} {job_name}: steps must be mappings")
        names = [step.get("name") for step in steps]
        if initial_boundary not in names or provider_step not in names:
            raise AssertionError(f"{name} {job_name}: trust boundary steps are missing")
        initial_index = names.index(initial_boundary)
        final_name = "Enforce one-shot authorization immediately before provider access"
        if final_name not in names:
            raise AssertionError(f"{name} {job_name}: final authority enforcement is missing")
        final_index = names.index(final_name)
        provider_index = names.index(provider_step)
        dependency_name = "Download prepared dependencies after authority"
        if dependency_name not in names:
            raise AssertionError(
                f"{name} {job_name}: prepared dependencies must be downloaded after authority"
            )
        dependency_index = names.index(dependency_name)
        if not initial_index < final_index < dependency_index < provider_index:
            raise AssertionError(f"{name} {job_name}: authority ordering is unsafe")
        for step in steps[:initial_index]:
            encoded = json.dumps(step, sort_keys=True)
            if "secrets." in encoded:
                raise AssertionError(f"{name} {job_name}: secret is exposed before authority")
            if any(
                fragment in encoded
                for fragment in ("pip install", "npm ci", "actions/setup-python@", "actions/setup-node@")
            ):
                raise AssertionError(f"{name} {job_name}: mutable setup runs before authority")
        for step in steps[:final_index]:
            encoded = json.dumps(step, sort_keys=True)
            secret_names = set(re.findall(r"secrets\.([A-Z0-9_]+)", encoded))
            if secret_names - {"ASTROCYTE_AUTHORIZATION_HMAC_KEY"}:
                raise AssertionError(f"{name} {job_name}: provider secret precedes final authority")
        initial_run = steps[initial_index].get("run", "")
        final_run = steps[final_index].get("run", "")
        if not all(
            isinstance(run, str) and "/usr/bin/python3 -I -S" in run
            for run in (initial_run, final_run)
        ):
            raise AssertionError(f"{name} {job_name}: verifier must use isolated system Python")
        integrity_names = {
            "Record trusted verifier digest before mutable setup",
            "Verify trusted verifier integrity after mutable setup",
        }
        if not integrity_names.issubset(set(names)):
            raise AssertionError(f"{name} {job_name}: verifier integrity checks are missing")


def _check_action_pins(name: str, text: str) -> None:
    for use in _parse_workflow_uses(name, text):
        action, separator, reference = use.rpartition("@")
        if not separator or not action or not reference:
            raise AssertionError(f"{name}: malformed or unpinned action reference {use!r}")
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
    preflight = section(schedule, "  preflight:\n", "\n  refresh-core:")
    require(preflight, "environment: Production", "schedule.yml preflight")
    require_order(
        preflight,
        "Enforce one-shot authorization immediately before provider access",
        "Preflight schema check",
        "schedule.yml preflight",
    )
    schedule_jobs = {
        "refresh-core": ("\n  refresh-market-history:", "Refresh core feeds"),
        "refresh-market-history": ("\n  refresh-trident:", "Refresh historical prices"),
        "refresh-trident": ("\n  refresh-backtest:", "Refresh Trident screener"),
        "refresh-backtest": ("\n  post-refresh-gate:", "Refresh production reference backtest"),
    }
    for job, (end, provider_step) in schedule_jobs.items():
        job_text = section(schedule, f"  {job}:\n", end)
        require(job_text, "environment: Production", f"schedule.yml {job}")
        require_order(
            job_text,
            "Enforce one-shot authorization immediately before provider access",
            provider_step,
            f"schedule.yml {job}",
        )

    for name in MUTATION_WORKFLOWS:
        text = contents[name]
        _check_trust_boundaries(name, text)
        require(text, "actions: read", name)
        require(text, "portfolio-production-mutation", name)
        require(text, "cancel-in-progress: false", name)
        require(text, "authorization_manifest:", name)
        require(text, "authorization_manifest_sha256:", name)
        require(text, "authorization_signature:", name)
        require(text, "authorization_nonce:", name)
        require(text, "authorization_receipt_id:", name)
        require(text, "check_mutation_contract.py", name)
        require(text, "Claim one-shot mutation authorization", name)
        require(text, "--replay-phase claim", name)
        require(text, "Persist one-shot anti-replay marker", name)
        require(text, "retention-days: 30", name)
        require(text, "--replay-phase enforce", name)
        require(text, "ASTROCYTE_AUTHORIZATION_HMAC_KEY", name)
        require(text, "Apply provider kill switches", name)
        require(text, "ASTROCYTE_MUTATION_GATE", name)
        require(text, "ASTROCYTE_SOURCE_RIGHTS_GATE", name)
        enforcement = "Enforce one-shot authorization immediately before provider access"
        if text.count(enforcement) != EXPECTED_ENFORCEMENT_COUNTS[name]:
            raise AssertionError(f"{name}: every mutative job must revalidate authority")
        if text.index(enforcement) > text.index(
            "Apply provider kill switches"
        ):
            raise AssertionError(f"{name}: provider kill switches run before revalidation")
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
    mutate_job = trident[trident.index("  mutate-production:\n") :]
    require_order(
        mutate_job,
        "Enforce one-shot authorization immediately before provider access",
        "Pre-migration schema check",
        "trident-supabase.yml mutate-production",
    )

    require_order(
        contents["production-data-remediation.yml"],
        "Enforce one-shot authorization immediately before provider access",
        "Resolve database URL",
        "production-data-remediation.yml",
    )
    require_order(
        contents["trident-price-backfill.yml"],
        "Enforce one-shot authorization immediately before provider access",
        "Preflight schema check",
        "trident-price-backfill.yml",
    )
    require_order(
        contents["trident-stock-insights.yml"],
        "Enforce one-shot authorization immediately before provider access",
        "Preflight schema check",
        "trident-stock-insights.yml",
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
