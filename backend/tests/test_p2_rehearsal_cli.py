"""Regression: an unavailable qualified PostgreSQL runtime is a reported skip."""
import json
from pathlib import Path
import subprocess
import sys


def test_p2_cli_without_postgresql_reports_skips():
    script = Path(__file__).resolve().parents[1] / "manual/target-model-v1/p2/candidate/test_executor.py"
    result = subprocess.run(
        [sys.executable, "-B", str(script)],
        cwd=script.parent,
        env={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["status"] == "SKIPPED"
    assert report["tests"] == report["skipped"] == 11
    assert report["executed_tests"] == 0
    assert report["errors"] == report["failures"] == 0
    assert report["server_stopped"] is True
    assert report["cluster"] == ""
    assert report["source_access"] is False
