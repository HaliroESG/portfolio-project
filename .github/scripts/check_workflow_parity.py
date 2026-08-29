#!/usr/bin/env python3
"""Fail-closed static checks for the default-branch workflow contract."""

from __future__ import annotations

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
    for name, text in contents.items():
        require(text, "permissions:\n  contents: read", name)

    remediation_on = section(
        contents["production-data-remediation.yml"], "on:\n", "\npermissions:"
    )
    forbid(remediation_on, "\n  push:", "production-data-remediation.yml")
    require(remediation_on, "default: false", "production-data-remediation.yml")
    require(
        contents["production-data-remediation.yml"],
        "ASTROCYTE_MUTATION_GATE",
        "production-data-remediation.yml",
    )
    require(
        contents["production-data-remediation.yml"],
        "ASTROCYTE_SOURCE_RIGHTS_GATE",
        "production-data-remediation.yml",
    )
    require(
        contents["production-data-remediation.yml"],
        "environment: Production",
        "production-data-remediation.yml",
    )
    require(
        contents["production-data-remediation.yml"],
        "authorization_ref:",
        "production-data-remediation.yml",
    )

    schedule_on = section(contents["schedule.yml"], "on:\n", "\npermissions:")
    forbid(schedule_on, "\n  schedule:", "schedule.yml")
    require(schedule_on, "default: validate", "schedule.yml")
    require(contents["schedule.yml"], "ASTROCYTE_SOURCE_RIGHTS_GATE", "schedule.yml")
    require(contents["schedule.yml"], "ASTROCYTE_MUTATION_GATE", "schedule.yml")
    require(contents["schedule.yml"], "authorization_ref:", "schedule.yml")

    for name in ("trident-price-backfill.yml", "trident-stock-insights.yml"):
        dry_run_input = section(contents[name], "      dry_run:", "\npermissions:")
        require(dry_run_input, "default: true", name)
        require(contents[name], "ASTROCYTE_SOURCE_RIGHTS_GATE", name)
        require(contents[name], "ASTROCYTE_MUTATION_GATE", name)
        require(contents[name], "environment: Production", name)
        require(contents[name], "authorization_ref:", name)

    trident_on = section(contents["trident-supabase.yml"], "on:\n", "\npermissions:")
    if trident_on.count("default: false") < 2:
        raise AssertionError(
            "trident-supabase.yml: mutation inputs must default to false"
        )
    require(
        contents["trident-supabase.yml"],
        "ASTROCYTE_MUTATION_GATE",
        "trident-supabase.yml",
    )
    require(
        contents["trident-supabase.yml"],
        "ASTROCYTE_SOURCE_RIGHTS_GATE",
        "trident-supabase.yml",
    )
    require(
        contents["trident-supabase.yml"],
        "authorization_ref:",
        "trident-supabase.yml",
    )
    require(
        contents["bootstrap-private-owner.yml"],
        "BOOTSTRAP_DISABLED_PENDING_SEPARATE_AUTHORITY",
        "bootstrap-private-owner.yml",
    )

    print(f"workflow parity PASS: {len(actual)} workflow files")


if __name__ == "__main__":
    main()
