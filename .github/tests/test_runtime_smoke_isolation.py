from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/frontend-runtime-smoke.yml'
RUNNER = ROOT / '.github/scripts/run-offline-browser-smoke.sh'


def validate_workflow(text):
    offline, real = text.split('  smoke-offline:', 1)[1].split('  smoke-real:', 1)
    assert "github.event_name != 'workflow_dispatch' || !inputs.allow_real_runtime" in offline
    assert "github.event_name == 'workflow_dispatch' && inputs.allow_real_runtime" in real
    assert 'default: false' in text.split('  pull_request:', 1)[0]
    assert 'secrets.' not in offline
    assert 'persist-credentials: false' in offline
    assert 'NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321' in offline
    assert 'NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-placeholder-anon-key' in offline
    assert 'sudo env -i' in offline
    assert 'unshare --net bash .github/scripts/run-offline-browser-smoke.sh' in offline
    assert 'test_runtime_smoke_isolation.py' in offline
    assert offline.index('Reject runtime environment files') < offline.index('run: npm ci')
    assert 'secrets.SUPABASE_URL' in real and 'secrets.SUPABASE_ANON_KEY' in real
    assert 'npm run smoke:browser' in real
    assert '  pull_request:' in text and '  push:' in text


class WorkflowTests(unittest.TestCase):
    def test_isolated_automatic_and_opt_in_real(self):
        validate_workflow(WORKFLOW.read_text())

    def test_boundary_regressions_rejected(self):
        text = WORKFLOW.read_text()
        for old, new in [
            ('sudo env -i', 'sudo env'),
            ('unshare --net bash', 'bash'),
            ('default: false', 'default: true'),
            ("github.event_name == 'workflow_dispatch' && inputs.allow_real_runtime", 'true'),
            ('NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321', 'NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}'),
        ]:
            with self.subTest(old=old), self.assertRaises(AssertionError):
                validate_workflow(text.replace(old, new))


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.script = self.root / '.github/scripts/run-offline-browser-smoke.sh'
        self.script.parent.mkdir(parents=True)
        shutil.copyfile(RUNNER, self.script)
        (self.root / 'frontend/.next').mkdir(parents=True)
        (self.root / 'frontend/.next/BUILD_ID').write_text('offline-test')
        binpath = self.root / 'bin'
        binpath.mkdir()
        commands = {
            'uname': 'echo "${TEST_OS:-Linux}"',
            'ip': 'if [ "$1" = -o ]; then printf "1: lo: <LOOPBACK>\\n"; if [ "${TEST_EXTERNAL:-0}" = 1 ]; then printf "2: eth0: <UP>\\n"; fi; fi',
            'curl': 'for n in 1 2 3 4 5; do test -f "$TEST_ROOT/server.pid" && exit 0; /bin/sleep 0.1; done; exit 1',
            'node': '''if [ "$1" = node_modules/next/dist/bin/next ]; then
  echo $$ > "$TEST_ROOT/server.pid"
  exec /bin/sleep 60
fi
printf '%s' "$BASE_URL" > "$TEST_ROOT/browser-url"
exit "${TEST_BROWSER_EXIT:-0}"''',
        }
        for name, code in commands.items():
            p = binpath / name
            p.write_text('#!/bin/sh\n' + code + '\n')
            p.chmod(0o700)
        self.env = {'PATH': str(binpath) + ':/usr/bin:/bin', 'TEST_ROOT': str(self.root),
                    'NEXT_PUBLIC_SUPABASE_URL': 'http://127.0.0.1:54321',
                    'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'ci-placeholder-anon-key'}

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, extra=None):
        return subprocess.run(['/bin/bash', str(self.script)], env={**self.env, **(extra or {})},
                              capture_output=True, text=True, timeout=8)

    def test_success_and_browser_failure_stop_child(self):
        for code in [0, 9]:
            with self.subTest(code=code):
                result = self.run_script({'TEST_BROWSER_EXIT': str(code)})
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertEqual((self.root / 'browser-url').read_text(), 'http://127.0.0.1:3001')
                pid = int((self.root / 'server.pid').read_text())
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)

    def test_nonisolated_and_real_provider_configuration_rejected(self):
        for extra in [{'TEST_OS': 'Darwin'}, {'TEST_EXTERNAL': '1'},
                      {'NEXT_PUBLIC_SUPABASE_URL': 'https://provider.invalid'},
                      {'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'not-placeholder'}]:
            with self.subTest(extra=extra):
                self.assertNotEqual(self.run_script(extra).returncode, 0)
                self.assertFalse((self.root / 'server.pid').exists())

    def test_dotenv_and_absent_build_rejected(self):
        for name in ['.env', '.env.local', '.env.production', '.env.production.local']:
            p = self.root / 'frontend' / name
            p.write_text('SYNTHETIC=never-load')
            self.assertNotEqual(self.run_script().returncode, 0)
            p.unlink()
        (self.root / 'frontend/.next/BUILD_ID').unlink()
        self.assertNotEqual(self.run_script().returncode, 0)
        self.assertFalse((self.root / 'server.pid').exists())


if __name__ == '__main__':
    unittest.main()
