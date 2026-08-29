from __future__ import annotations

import copy
import os
import subprocess
import sys
import tempfile
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

    def test_escaped_uses_cannot_bypass_action_pin(self) -> None:
        contents = workflow_contents()
        contents["workflow-parity.yml"] = contents["workflow-parity.yml"].replace(
            "uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
            'uses: "actions/checkout\\x40v4"',
            1,
        )
        with self.assertRaisesRegex(AssertionError, "pinned to reviewed SHA"):
            validate_workflow_contract(contents)

    def test_sitecustomize_and_pre_auth_dependency_are_rejected(self) -> None:
        verifier = SCRIPTS / "check_mutation_contract.py"
        system_python = Path("/usr/bin/python3")
        self.assertTrue(system_python.is_file(), "system Python bootstrap is unavailable")
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary = Path(temporary_directory)
            marker = temporary / "sitecustomize-observation.txt"
            (temporary / "sitecustomize.py").write_text(
                "import os\n"
                "from pathlib import Path\n"
                "Path(os.environ['SITECUSTOMIZE_MARKER']).write_text("
                "str(bool(os.environ.get('AUTHORIZATION_HMAC_KEY'))))\n",
                encoding="utf-8",
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "PYTHONPATH": str(temporary),
                    "SITECUSTOMIZE_MARKER": str(marker),
                    "AUTHORIZATION_MANIFEST": "{}",
                    "AUTHORIZATION_HMAC_KEY": "sentinel-not-a-real-secret",
                }
            )
            result = subprocess.run(
                [
                    str(system_python),
                    "-I",
                    "-S",
                    str(verifier),
                    "--workflow",
                    "trident-supabase",
                    "--replay-phase",
                    "claim",
                ],
                cwd=ROOT,
                env=environment,
                text=True,
                capture_output=True,
                timeout=15,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(marker.exists(), "isolated verifier loaded sitecustomize")

        contents = workflow_contents()
        contents["production-data-remediation.yml"] = contents[
            "production-data-remediation.yml"
        ].replace(
            "      - name: Claim one-shot mutation authorization\n",
            "      - name: Install attacker dependency\n"
            "        run: pip install attacker-controlled-package\n\n"
            "      - name: Claim one-shot mutation authorization\n",
            1,
        )
        with self.assertRaisesRegex(AssertionError, "mutable setup runs before authority"):
            validate_workflow_contract(contents)


if __name__ == "__main__":
    unittest.main()
