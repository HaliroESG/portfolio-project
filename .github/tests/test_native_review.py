from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_independent_review as policy
import verify_native_review as gate


class NativeReviewTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 26, 8, 0, tzinfo=timezone.utc)
        self.repo = "owner/repo"
        self.head, self.base = "a" * 40, "b" * 40
        self.pr = {"number": 23, "state": "open", "draft": False,
                   "user": {"login": "owner"},
                   "head": {"sha": self.head, "repo": {"full_name": self.repo}},
                   "base": {"sha": self.base, "ref": "main",
                            "repo": {"full_name": self.repo, "id": 42}}}
        self.event = {"pull_request": copy.deepcopy(self.pr)}
        self.run = {"id": 7, "workflow_id": 9, "path": gate.WORKFLOW,
                    "repository": {"id": 42, "full_name": self.repo},
                    "head_branch": "main", "head_sha": self.base, "event": "workflow_dispatch",
                    "actor": {"login": "owner"}, "triggering_actor": {"login": "owner"},
                    "status": "completed", "conclusion": "success", "run_attempt": 1,
                    "created_at": "2026-09-26T07:55:00Z"}
        self.receipt = policy.evaluate_owner_codex_ship(
            self.pr, repository=self.repo, pull_request=23, head_sha=self.head,
            actor="owner", codex_review_sha256="c" * 64, codex_verdict="SHIP",
            confirmation=policy.OWNER_CONFIRMATION)
        self.name = f"astrocyte-owner-codex-ship-23-{self.head}"
        self.meta = {"id": 11, "name": self.name, "expired": False,
                     "created_at": "2026-09-26T07:56:00Z",
                     "workflow_run": {"id": 7, "head_sha": self.base, "head_branch": "main",
                                      "repository_id": 42, "head_repository_id": 42}}
        self.archive = self.pack(json.dumps(self.receipt))
        self.meta.update(size_in_bytes=len(self.archive),
                         digest="sha256:" + hashlib.sha256(self.archive).hexdigest())
        root = f"repos/{self.repo}"
        self.responses = {
            f"{root}/pulls/23": self.pr,
            f"{root}/git/ref/heads/main": {"object": {"sha": self.base}},
            f"{root}/pulls/23/reviews?per_page=100&page=1": [],
            f"{root}/actions/workflows/independent-review-gate.yml":
                {"id": 9, "path": gate.WORKFLOW, "state": "active"},
            f"{root}/actions/workflows/9/runs?event=workflow_dispatch&branch=main&per_page=50":
                {"workflow_runs": [{"id": 7}]},
            f"{root}/actions/runs/7/artifacts?per_page=100":
                {"total_count": 1, "artifacts": [self.meta]},
            f"{root}/actions/runs/7": self.run,
            f"{root}/actions/artifacts/11/zip": self.archive,
        }

    @staticmethod
    def pack(body, name=gate.RECEIPT):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr(name, body)
        return buffer.getvalue()

    def get(self, path, *, binary=False):
        result = self.responses[path]
        self.assertEqual(binary, isinstance(result, bytes))
        return result

    def verify(self):
        return gate.verify(policy, self.event, self.repo, get=self.get, now=self.now)

    def test_valid_authenticated_owner_receipt(self):
        self.assertEqual(self.verify(), self.receipt)

    def test_run_provenance_mutations_fail(self):
        mutations = {
            "workflow_id": 10, "path": "untrusted.yml", "repository": {"id": 43},
            "head_sha": "d" * 40, "head_branch": "feature", "event": "push",
            "actor": {"login": "stranger"}, "triggering_actor": {"login": "stranger"},
            "status": "in_progress", "conclusion": "failure", "run_attempt": 2,
            "created_at": "2026-09-24T07:55:00Z", "id": "7",
        }
        for key, value in mutations.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                run = {**self.run, key: value}
                gate.verify_run(run, self.repo, 42, self.base, 9, self.now)

    def test_artifact_provenance_mutations_fail(self):
        mutations = {
            "expired": True, "name": "different", "digest": "sha256:" + "0" * 64,
            "size_in_bytes": gate.MAX_BYTES + 1, "created_at": "2026-09-24T07:55:00Z",
        }
        for key, value in mutations.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                gate.verify_artifact({**self.meta, key: value}, self.archive, self.run, 42, self.name, self.now)
        for key in ("id", "head_sha", "head_branch", "repository_id", "head_repository_id"):
            meta = copy.deepcopy(self.meta)
            meta["workflow_run"][key] = "wrong"
            with self.subTest(binding=key), self.assertRaises(ValueError):
                gate.verify_artifact(meta, self.archive, self.run, 42, self.name, self.now)

    def test_untrusted_receipt_fields_fail(self):
        for field, value in {"head_sha": "d" * 40, "status": "FAIL", "pull_request": 24,
                             "schema_version": "wrong", "extra": "unexpected"}.items():
            with self.subTest(field=field), self.assertRaises(ValueError):
                gate.verify_receipt({**self.receipt, field: value}, policy, self.pr, self.repo, "owner")
        for field in ("actor", "authority", "codex_verdict", "codex_review_sha256", "confirmation"):
            receipt = copy.deepcopy(self.receipt)
            receipt["owner_attestation"][field] = "wrong"
            with self.subTest(attestation=field), self.assertRaises(ValueError):
                gate.verify_receipt(receipt, policy, self.pr, self.repo, "owner")

    def test_zip_bombs_paths_and_duplicate_json_fail(self):
        samples = [(gate.RECEIPT, "x" * (gate.MAX_BYTES + 1)),
                   ("../" + gate.RECEIPT, "{}"), (gate.RECEIPT, '{"a":1,"a":2}'),
                   (gate.RECEIPT, '{"a":NaN}')]
        for name, body in samples:
            archive = self.pack(body, name)
            meta = {**self.meta, "digest": "sha256:" + hashlib.sha256(archive).hexdigest()}
            with self.subTest(name=name, length=len(body)), self.assertRaises(ValueError):
                gate.verify_artifact(meta, archive, self.run, 42, self.name, self.now)

    def test_stale_event_and_current_main_fail(self):
        self.event["pull_request"]["head"]["sha"] = "d" * 40
        with self.assertRaisesRegex(ValueError, "stale"):
            self.verify()
        self.event = {"pull_request": copy.deepcopy(self.pr)}
        self.responses[f"repos/{self.repo}/git/ref/heads/main"]["object"]["sha"] = "e" * 40
        with self.assertRaisesRegex(ValueError, "base changed"):
            self.verify()

    def test_draft_closed_fork_and_different_author_fail(self):
        for key, value in (("draft", True), ("state", "closed"), ("user", {"login": "stranger"})):
            original = self.pr[key]
            self.pr[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.verify()
            self.pr[key] = original
        self.pr["head"]["repo"]["full_name"] = "attacker/fork"
        with self.assertRaises(ValueError):
            self.verify()

    def test_missing_ambiguous_and_paginated_artifacts_fail(self):
        artifacts = self.responses[f"repos/{self.repo}/actions/runs/7/artifacts?per_page=100"]
        artifacts["artifacts"] = []
        with self.assertRaisesRegex(ValueError, "no authenticated"):
            self.verify()
        artifacts["artifacts"] = [self.meta, self.meta]
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            self.verify()
        artifacts["total_count"] = 101
        with self.assertRaisesRegex(ValueError, "pagination"):
            self.verify()

    def test_future_and_expired_dates_fail(self):
        for now in (self.now - timedelta(hours=1), self.now + timedelta(days=2)):
            with self.assertRaises(ValueError):
                gate.fresh(self.run["created_at"], now)

    def test_human_review_pass_and_changes_requested_blocks_owner(self):
        review = {"id": 1, "user": {"login": "reviewer", "type": "User"},
                  "state": "APPROVED", "commit_id": self.head, "author_association": "COLLABORATOR",
                  "submitted_at": "2026-09-26T07:58:00Z"}
        self.responses[f"repos/{self.repo}/pulls/23/reviews?per_page=100&page=1"] = [review]
        self.assertEqual(self.verify()["reason"], "CURRENT_EXACT_HEAD_INDEPENDENT_APPROVAL")
        review["state"] = "CHANGES_REQUESTED"
        with self.assertRaisesRegex(ValueError, "requests changes"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
