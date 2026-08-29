from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SCRIPTS))

from check_workflow_parity import (  # noqa: E402
    EXPECTED,
    validate_workflow_contract,
)


def workflow_contents() -> dict[str, str]:
    root = ROOT / ".github" / "workflows"
    return {
        name: (root / name).read_text(encoding="utf-8")
        for name in EXPECTED
    }


class WorkflowContractTests(unittest.TestCase):
    def test_repository_workflows_pass(self) -> None:
        validate_workflow_contract(workflow_contents())

    def test_absent_mutation_gate_fails(self) -> None:
        contents = workflow_contents()
        contents["production-data-remediation.yml"] = contents[
            "production-data-remediation.yml"
        ].replace("ASTROCYTE_MUTATION_GATE", "REMOVED_MUTATION_GATE")
        with self.assertRaisesRegex(AssertionError, "ASTROCYTE_MUTATION_GATE"):
            validate_workflow_contract(contents)

    def test_concurrency_key_drift_fails(self) -> None:
        contents = workflow_contents()
        contents["trident-price-backfill.yml"] = contents[
            "trident-price-backfill.yml"
        ].replace("portfolio-production-mutation", "workflow-local-key")
        with self.assertRaisesRegex(AssertionError, "portfolio-production-mutation"):
            validate_workflow_contract(contents)

    def test_failed_precheck_cannot_be_ignored(self) -> None:
        contents = workflow_contents()
        contents["trident-supabase.yml"] = contents["trident-supabase.yml"].replace(
            "      - name: Pre-migration schema check\n",
            "      - name: Pre-migration schema check\n        continue-on-error: true\n",
        )
        with self.assertRaisesRegex(AssertionError, "pre-migration"):
            validate_workflow_contract(contents)

    def test_bootstrap_refusal_is_immutable(self) -> None:
        contents = workflow_contents()
        contents["bootstrap-private-owner.yml"] = contents[
            "bootstrap-private-owner.yml"
        ].replace("exit 2", "exit 0")
        with self.assertRaisesRegex(AssertionError, "unconditional refusal"):
            validate_workflow_contract(contents)


if __name__ == "__main__":
    unittest.main()
