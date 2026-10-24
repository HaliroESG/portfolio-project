from __future__ import annotations

from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import test_native_review as fixtures

policy = fixtures.policy
native = fixtures.gate


class LegacyReviewBridgeTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.NativeReviewTests()
        self.fixture.setUp()
        self.calls = []
        self.posts = []

    def run_gate(self, *, dispatch=False, unavailable=False):
        f = self.fixture

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return f.now

        def get(path, *, binary=False):
            self.calls.append(path)
            if unavailable:
                raise native.GateError('offline simulated API failure')
            return f.get(path, binary=binary)

        def request(url, *, token, method='GET', payload=None):
            self.assertEqual(token, 'offline-test')
            if method == 'GET' and url.endswith('/pulls/23'):
                return f.pr
            self.assertEqual(method, 'POST')
            self.assertEqual(url, 'https://api.github.com/repos/owner/repo/check-runs')
            self.posts.append(payload)
            return {'id': 1}

        with tempfile.TemporaryDirectory() as folder:
            event = Path(folder) / 'event.json'
            event.write_text(json.dumps(f.event))
            env = {'GITHUB_TOKEN': 'offline-test', 'GH_TOKEN': 'offline-test',
                   'GITHUB_REPOSITORY': f.repo, 'GITHUB_EVENT_PATH': str(event),
                   'GITHUB_EVENT_NAME': 'workflow_dispatch' if dispatch else 'pull_request_review',
                   'GITHUB_ACTOR': 'owner', 'RUNNER_TEMP': folder,
                   'OWNER_REVIEW_PULL_REQUEST': '23', 'OWNER_REVIEW_HEAD_SHA': f.head,
                   'OWNER_REVIEW_CODEX_SHA256': 'c' * 64, 'OWNER_REVIEW_CODEX_VERDICT': 'SHIP',
                   'OWNER_REVIEW_CONFIRMATION': policy.OWNER_CONFIRMATION}
            with mock.patch.dict(os.environ, env, clear=True), \
                 mock.patch.object(native, 'api', side_effect=get), \
                 mock.patch.object(native, 'datetime', Clock), \
                 mock.patch.object(policy, '_request_json', side_effect=request), \
                 mock.patch.object(policy, '_fetch_reviews', return_value=f.responses[f'repos/{f.repo}/pulls/23/reviews?per_page=100&page=1']), \
                 mock.patch('subprocess.run', side_effect=AssertionError('unexpected network/subprocess')):
                code = policy.main()
            receipt = json.loads((Path(folder) / 'astrocyte-independent-review-receipt.json').read_text())
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.posts[0]['head_sha'], f.event['pull_request']['head']['sha'])
        return code, receipt

    def assert_closed(self, **kwargs):
        code, receipt = self.run_gate(**kwargs)
        self.assertEqual(code, 1)
        self.assertEqual(receipt['status'], 'FAIL')
        self.assertEqual(self.posts[0]['conclusion'], 'failure')

    def test_comment_after_owner_ship_retains_authenticated_success(self):
        code, receipt = self.run_gate()
        self.assertEqual(code, 0)
        self.assertEqual(receipt, self.fixture.receipt)
        self.assertEqual(self.posts[0]['conclusion'], 'success')
        self.assertTrue(any('/artifacts/11/zip' in p for p in self.calls))

    def test_human_approval_still_passes_without_owner_artifact(self):
        f = self.fixture
        f.responses[f'repos/{f.repo}/pulls/23/reviews?per_page=100&page=1'] = [
            {'id': 1, 'user': {'login': 'reviewer', 'type': 'User'}, 'state': 'APPROVED',
             'commit_id': f.head, 'author_association': 'COLLABORATOR',
             'submitted_at': '2026-09-26T07:58:00Z'}]
        code, receipt = self.run_gate()
        self.assertEqual(code, 0)
        self.assertEqual(receipt['reason'], 'CURRENT_EXACT_HEAD_INDEPENDENT_APPROVAL')
        self.assertFalse(any('/artifacts' in p for p in self.calls))

    def test_changes_requested_blocks_owner_ship(self):
        f = self.fixture
        f.responses[f'repos/{f.repo}/pulls/23/reviews?per_page=100&page=1'] = [
            {'id': 1, 'user': {'login': 'reviewer', 'type': 'User'}, 'state': 'CHANGES_REQUESTED',
             'commit_id': f.head, 'author_association': 'COLLABORATOR',
             'submitted_at': '2026-09-26T07:58:00Z'}]
        self.assert_closed()

    def test_missing_receipt_fails(self):
        f = self.fixture
        f.responses[f'repos/{f.repo}/actions/runs/7/artifacts?per_page=100']['artifacts'] = []
        self.assert_closed()

    def test_tampered_digest_fails(self):
        self.fixture.meta['digest'] = 'sha256:' + '0' * 64
        self.assert_closed()

    def test_expired_or_future_receipt_fails(self):
        for date in ['2026-09-24T07:55:00Z', '2026-09-27T07:55:00Z']:
            with self.subTest(date=date):
                self.setUp()
                self.fixture.run['created_at'] = date
                self.assert_closed()

    def test_wrong_actor_fails(self):
        self.fixture.run['actor'] = {'login': 'stranger'}
        self.assert_closed()

    def test_event_head_changed_fails(self):
        self.fixture.event['pull_request']['head']['sha'] = 'd' * 40
        self.assert_closed()

    def test_main_changed_fails(self):
        f = self.fixture
        f.responses[f'repos/{f.repo}/git/ref/heads/main']['object']['sha'] = 'e' * 40
        self.assert_closed()

    def test_wrong_receipt_pr_or_sha_fails(self):
        for key, value in [('pull_request', 24), ('head_sha', 'd' * 40)]:
            with self.subTest(key=key):
                self.setUp()
                f = self.fixture
                receipt = {**f.receipt, key: value}
                archive = f.pack(json.dumps(receipt))
                f.meta['digest'] = 'sha256:' + hashlib.sha256(archive).hexdigest()
                f.meta['size_in_bytes'] = len(archive)
                f.responses[f'repos/{f.repo}/actions/artifacts/11/zip'] = archive
                self.assert_closed()

    def test_ambiguous_artifacts_fail(self):
        f = self.fixture
        f.responses[f'repos/{f.repo}/actions/runs/7/artifacts?per_page=100']['artifacts'] = [f.meta, f.meta]
        self.assert_closed()

    def test_duplicate_json_fails(self):
        f = self.fixture
        archive = f.pack('{"status":"PASS","status":"FAIL"}')
        f.meta.update(digest='sha256:' + hashlib.sha256(archive).hexdigest(), size_in_bytes=len(archive))
        f.responses[f'repos/{f.repo}/actions/artifacts/11/zip'] = archive
        self.assert_closed()

    def test_api_failure_publishes_failure_not_previous_success(self):
        self.assert_closed(unavailable=True)

    def test_owner_dispatch_stays_separate_and_does_not_read_its_own_artifact(self):
        code, receipt = self.run_gate(dispatch=True)
        self.assertEqual(code, 0)
        self.assertEqual(receipt, self.fixture.receipt)
        self.assertEqual(self.calls, [])

    def test_workflow_adds_only_read_actions_permission_to_automatic_job(self):
        text = (Path(__file__).resolve().parents[1] / 'workflows/independent-review-gate.yml').read_text()
        automatic, owner = text.split('  exact-head-independent-review:', 1)[1].split('  exact-head-owner-codex-ship:', 1)
        self.assertIn('    permissions:\n      contents: read\n      checks: write\n      pull-requests: read\n      actions: read\n', automatic)
        self.assertIn('GH_TOKEN: ${{ github.token }}', automatic)
        self.assertNotIn('actions: write', text)
        self.assertNotIn('actions: read', owner)
        self.assertNotIn('secrets.', text)
        self.assertIn('ref: ${{ github.event.repository.default_branch }}', automatic)
        self.assertIn('persist-credentials: false', automatic)


if __name__ == '__main__':
    unittest.main()
