from __future__ import annotations

import copy
import os
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / ".github" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from check_family_office_release_hold import (  # noqa: E402
    HOLD_FILE,
    ReleaseHoldActive,
    ReleaseHoldError,
    enforce_family_office_release_hold,
    load_release_hold,
    validate_release_hold,
)
from check_independent_review import (  # noqa: E402
    CONTEXT,
    evaluate_reviews,
    receipt_sha256,
)
from check_workflow_parity import (  # noqa: E402
    EXPECTED,
    EXPECTED_REQUIRED_CHECKS,
    validate_required_pr_governance,
    validate_workflow_contract,
)


HEAD = "b" * 40
AUTHOR = "candidate-author"


def workflow_contents() -> dict[str, str]:
    root = ROOT / ".github" / "workflows"
    return {name: (root / name).read_text(encoding="utf-8") for name in EXPECTED}


def review(
    review_id: int,
    login: str,
    state: str = "APPROVED",
    *,
    commit_id: str = HEAD,
    association: str = "MEMBER",
    user_type: str = "User",
) -> dict[str, object]:
    return {
        "id": review_id,
        "state": state,
        "commit_id": commit_id,
        "author_association": association,
        "submitted_at": f"2026-08-31T08:{review_id:02d}:00Z",
        "body": "untrusted label/comment text is deliberately ignored",
        "user": {"login": login, "type": user_type},
    }


def verdict(reviews: list[dict[str, object]]) -> dict[str, object]:
    return evaluate_reviews(
        reviews,
        repository="HaliroESG/portfolio-project",
        pull_request=15,
        head_sha=HEAD,
        pull_request_author=AUTHOR,
    )


class ReleaseHoldTests(unittest.TestCase):
    def test_exact_repository_hold_is_active_and_blocks_mutation(self) -> None:
        hold = load_release_hold()
        self.assertEqual(hold["status"], "ACTIVE")
        self.assertFalse(hold["mutation_allowed"])
        with self.assertRaisesRegex(ReleaseHoldActive, "HTTP_503"):
            enforce_family_office_release_hold()

    def test_hold_binding_and_clearance_cannot_be_weakened(self) -> None:
        original = load_release_hold()
        mutations = {
            "head": lambda value: value["subject"].update(head_sha="f" * 40),
            "tree": lambda value: value["subject"].update(tree_sha="f" * 40),
            "merge": lambda value: value["subject"].update(merge_sha="f" * 40),
            "review": lambda value: value["independent_review"].update(
                review_sha256="f" * 64
            ),
            "inactive": lambda value: value.update(status="CLEARED"),
            "mutation": lambda value: value.update(mutation_allowed=True),
            "provider": lambda value: value.update(provider_actions_allowed=True),
            "controller": lambda value: value["clearance_contract"].update(
                requires_controller_authority=False
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                changed = copy.deepcopy(original)
                mutate(changed)
                with self.assertRaises(ReleaseHoldError):
                    validate_release_hold(changed)

    def test_hold_cli_refuses_with_exit_78(self) -> None:
        validate = subprocess.run(
            [sys.executable, str(SCRIPTS / "check_family_office_release_hold.py"), "--validate"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
            timeout=15,
        )
        self.assertEqual(validate.returncode, 0, validate.stderr)
        enforce = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "check_family_office_release_hold.py"),
                "--enforce-mutation",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
            timeout=15,
        )
        self.assertEqual(enforce.returncode, 78)
        self.assertIn("FAMILY_OFFICE_PRODUCTION_HTTP_503", enforce.stderr)

    def test_mutation_contract_checks_hold_before_authorization_manifest(self) -> None:
        environment = os.environ.copy()
        environment["AUTHORIZATION_MANIFEST"] = "{}"
        result = subprocess.run(
            [
                "/usr/bin/python3",
                "-I",
                "-S",
                str(SCRIPTS / "check_mutation_contract.py"),
                "--workflow",
                "family-office-release",
                "--replay-phase",
                "claim",
            ],
            cwd=ROOT,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
            timeout=15,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FAMILY_OFFICE_PRODUCTION_HTTP_503", result.stderr)
        self.assertNotIn("manifest must", result.stderr)

    def test_hold_file_is_regular(self) -> None:
        self.assertTrue(HOLD_FILE.is_file())
        self.assertFalse(HOLD_FILE.is_symlink())


class IndependentReviewTests(unittest.TestCase):
    def test_current_exact_head_human_member_approval_passes(self) -> None:
        receipt = verdict([review(1, "independent-reviewer")])
        self.assertEqual(receipt["status"], "PASS")
        self.assertEqual(receipt["review"]["commit_id"], HEAD)
        self.assertEqual(len(receipt_sha256(receipt)), 64)
        self.assertFalse(receipt["labels_or_comments_trusted"])
        self.assertFalse(receipt["auto_approval"])

    def test_stale_self_bot_and_untrusted_approvals_fail(self) -> None:
        cases = {
            "stale": [review(1, "reviewer", commit_id="a" * 40)],
            "self": [review(1, AUTHOR)],
            "bot": [review(1, "review-bot", user_type="Bot")],
            "outsider": [review(1, "outside-user", association="NONE")],
            "comment_only": [review(1, "reviewer", state="DISMISSED")],
        }
        for label, reviews in cases.items():
            with self.subTest(label=label):
                self.assertEqual(verdict(reviews)["status"], "FAIL")

    def test_current_changes_requested_blocks_other_approval(self) -> None:
        receipt = verdict(
            [
                review(1, "approver"),
                review(2, "blocking-reviewer", state="CHANGES_REQUESTED"),
            ]
        )
        self.assertEqual(receipt["status"], "FAIL")
        self.assertEqual(receipt["reason"], "CURRENT_EXACT_HEAD_CHANGES_REQUESTED")

    def test_later_approval_replaces_same_reviewer_changes_request(self) -> None:
        receipt = verdict(
            [
                review(1, "reviewer", state="CHANGES_REQUESTED"),
                review(2, "reviewer", state="APPROVED"),
            ]
        )
        self.assertEqual(receipt["status"], "PASS")
        self.assertEqual(receipt["review"]["id"], 2)

    def test_required_context_contract_is_exact_and_not_activated(self) -> None:
        validate_required_pr_governance()
        self.assertEqual(CONTEXT, EXPECTED_REQUIRED_CHECKS[-1])


class WorkflowGovernanceTests(unittest.TestCase):
    def test_repository_workflows_satisfy_governance_contract(self) -> None:
        validate_workflow_contract(workflow_contents())

    def test_family_office_pr_path_filter_is_rejected(self) -> None:
        contents = workflow_contents()
        contents["family-office-release.yml"] = contents["family-office-release.yml"].replace(
            "  pull_request:\n  push:\n",
            "  pull_request:\n    paths:\n      - 'backend/**'\n  push:\n",
            1,
        )
        with self.assertRaisesRegex(AssertionError, "paths"):
            validate_workflow_contract(contents)

    def test_family_prepare_cannot_skip_after_validate_failure(self) -> None:
        contents = workflow_contents()
        contents["family-office-release.yml"] = contents["family-office-release.yml"].replace(
            "    if: ${{ always() }}\n", "", 1
        )
        with self.assertRaisesRegex(AssertionError, "always"):
            validate_workflow_contract(contents)

    def test_release_hold_must_precede_authorization(self) -> None:
        contents = workflow_contents()
        contents["family-office-release.yml"] = contents["family-office-release.yml"].replace(
            "      - name: Enforce active PR14 release hold before authorization\n"
            "        run: /usr/bin/python3 -I -S .github/scripts/check_family_office_release_hold.py --enforce-mutation\n",
            "",
            1,
        )
        with self.assertRaisesRegex(AssertionError, "release hold"):
            validate_workflow_contract(contents)

    def test_independent_gate_cannot_checkout_pr_head_or_use_secrets(self) -> None:
        contents = workflow_contents()
        contents["independent-review-gate.yml"] = contents[
            "independent-review-gate.yml"
        ].replace(
            "ref: ${{ github.event.repository.default_branch }}",
            "ref: ${{ github.event.pull_request.head.sha }}",
            1,
        )
        with self.assertRaises(AssertionError):
            validate_workflow_contract(contents)

        contents = workflow_contents()
        contents["independent-review-gate.yml"] += (
            "\n# forbidden secrets.FORGED_REVIEW_APPROVAL\n"
        )
        with self.assertRaisesRegex(AssertionError, "secrets"):
            validate_workflow_contract(contents)

    def test_dedicated_context_names_cannot_drift(self) -> None:
        mutations = {
            "family_validate": (
                "family-office-release.yml",
                "name: Family Office / validate",
                "name: validate",
            ),
            "family_prepare": (
                "family-office-release.yml",
                "name: Family Office / prepare",
                "name: prepare",
            ),
            "trident_validate": (
                "trident-supabase.yml",
                "name: Trident / validate",
                "name: validate",
            ),
        }
        for label, (name, before, after) in mutations.items():
            with self.subTest(label=label):
                contents = workflow_contents()
                contents[name] = contents[name].replace(before, after, 1)
                with self.assertRaises(AssertionError):
                    validate_workflow_contract(contents)

    def test_scheduler_heartbeat_cannot_use_shallow_pinned_history(self) -> None:
        contents = workflow_contents()
        contents["schedule.yml"] = contents["schedule.yml"].replace(
            "          fetch-depth: 0\n", "          fetch-depth: 1\n", 1
        )
        with self.assertRaisesRegex(AssertionError, "pinned candidate history"):
            validate_workflow_contract(contents)


if __name__ == "__main__":
    unittest.main()
