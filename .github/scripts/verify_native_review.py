#!/usr/bin/env python3
"""Read-only bridge from trusted owner receipts to a PR-native required job.

The dispatch workflow stays on protected main and mints the owner attestation.
This unprivileged PR job verifies its immutable artifact; it never approves a
review, posts a check/status, executes artifact code or edits a protection.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile


WORKFLOW = ".github/workflows/independent-review-gate.yml"
RECEIPT = "astrocyte-independent-review-receipt.json"
MAX_BYTES = 131072
MAX_AGE = timedelta(hours=24)


class GateError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "duplicate JSON key")
            result[key] = value
        return result

    def invalid_constant(_):
        raise GateError("non-finite JSON value")

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant)


def fresh(value, now):
    require(isinstance(value, str) and value.endswith("Z"), "invalid timestamp")
    timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(timedelta(0) <= now - timestamp <= MAX_AGE, "receipt expired or future-dated")


def api(path, *, binary=False):
    # Only constant-origin, repo-relative GETs; no artifact-controlled URL.
    result = subprocess.run(["gh", "api", path], capture_output=True, timeout=45)
    require(result.returncode == 0, "authenticated GitHub GET failed")
    if binary:
        require(len(result.stdout) <= MAX_BYTES, "artifact download too large")
        return result.stdout
    return strict_json(result.stdout)


def verify_run(run, repository, repository_id, base_sha, workflow_id, now):
    require(type(run.get("id")) is int and run["id"] > 0, "invalid run ID")
    require(run.get("workflow_id") == workflow_id and run.get("path") == WORKFLOW,
            "unexpected attestation workflow")
    require(run.get("repository", {}).get("id") == repository_id and
            run.get("repository", {}).get("full_name") == repository,
            "unexpected attestation repository")
    require(run.get("event") == "workflow_dispatch" and run.get("head_branch") == "main"
            and run.get("head_sha") == base_sha, "attestation is not from trusted current main")
    owner = repository.split("/")[0].casefold()
    for field in ("actor", "triggering_actor"):
        require(run.get(field, {}).get("login", "").casefold() == owner,
                "attestation actor is not repository owner")
    require(run.get("status") == "completed" and run.get("conclusion") == "success"
            and run.get("run_attempt") == 1, "attestation run is not a successful first attempt")
    fresh(run.get("created_at"), now)


def verify_artifact(meta, archive, run, repository_id, expected_name, now):
    require(meta.get("name") == expected_name and meta.get("expired") is False,
            "wrong or expired artifact")
    size = meta.get("size_in_bytes")
    require(type(size) is int and 0 < size <= MAX_BYTES and len(archive) <= MAX_BYTES,
            "artifact size outside limit")
    binding = meta.get("workflow_run", {})
    require(binding.get("id") == run["id"] and binding.get("head_sha") == run["head_sha"]
            and binding.get("head_branch") == "main"
            and binding.get("repository_id") == repository_id
            and binding.get("head_repository_id") == repository_id, "artifact provenance mismatch")
    require(meta.get("digest") == "sha256:" + hashlib.sha256(archive).hexdigest(),
            "artifact digest mismatch")
    fresh(meta.get("created_at"), now)
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        entries = bundle.infolist()
        require(len(entries) == 1 and entries[0].filename == RECEIPT,
                "unexpected artifact members")
        require(0 < entries[0].file_size <= MAX_BYTES, "receipt too large")
        return strict_json(bundle.read(entries[0]))


def verify_receipt(receipt, policy, pr, repository, actor):
    require(isinstance(receipt, dict), "receipt must be an object")
    attestation = receipt.get("owner_attestation", {})
    require(isinstance(attestation, dict), "invalid attestation")
    expected = policy.evaluate_owner_codex_ship(
        pr, repository=repository, pull_request=pr["number"], head_sha=pr["head"]["sha"],
        actor=actor, codex_review_sha256=attestation.get("codex_review_sha256", ""),
        codex_verdict=attestation.get("codex_verdict", ""),
        confirmation=attestation.get("confirmation", ""),
    )
    require(receipt == expected, "owner receipt does not exactly match trusted policy and current PR")
    return expected


def verify(policy, event, repository, get=api, now=None):
    now = now or datetime.now(timezone.utc)
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository) is not None,
            "invalid repository")
    event_pr = event["pull_request"]
    number = event_pr["number"]
    require(type(number) is int and number > 0, "invalid PR number")
    root = f"repos/{repository}"
    pr = get(f"{root}/pulls/{number}")
    require(pr["state"] == "open" and pr["draft"] is False, "PR must be open and Ready")
    require(pr["head"]["sha"] == event_pr["head"]["sha"], "event head is stale")
    require(pr["base"]["ref"] == "main" and pr["base"]["repo"]["full_name"] == repository
            and pr["head"]["repo"]["full_name"] == repository, "PR repository/ref mismatch")
    base_sha = pr["base"]["sha"]
    require(base_sha == event_pr["base"]["sha"] == get(f"{root}/git/ref/heads/main")["object"]["sha"],
            "trusted base changed; rerun on current base")
    repository_id = pr["base"]["repo"]["id"]
    reviews = []
    for page in range(1, 11):
        batch = get(f"{root}/pulls/{number}/reviews?per_page=100&page={page}")
        require(isinstance(batch, list), "invalid review response")
        reviews.extend(batch)
        if len(batch) < 100:
            break
    else:
        raise GateError("review pagination exceeds bound")
    human = policy.evaluate_reviews(reviews, repository=repository, pull_request=number,
                                    head_sha=pr["head"]["sha"], pull_request_author=pr["user"]["login"])
    require(not human.get("blocking_reviewers"), "current independent review requests changes")
    if human["status"] == "PASS":
        return human
    workflow = get(f"{root}/actions/workflows/independent-review-gate.yml")
    require(workflow["path"] == WORKFLOW and workflow["state"] == "active", "invalid trusted workflow")
    name = f"astrocyte-owner-codex-ship-{number}-{pr['head']['sha']}"
    runs = get(f"{root}/actions/workflows/{workflow['id']}/runs?event=workflow_dispatch&branch=main&per_page=50")["workflow_runs"]
    require(isinstance(runs, list), "invalid workflow runs response")
    for summary in runs:
        # Locate the exact artifact name; unrelated PR attestations cannot satisfy this gate.
        run_id = summary["id"]
        require(type(run_id) is int and run_id > 0, "invalid run ID")
        artifacts = get(f"{root}/actions/runs/{run_id}/artifacts?per_page=100")
        require(artifacts["total_count"] <= 100, "artifact pagination exceeds bound")
        matches = [a for a in artifacts["artifacts"] if a.get("name") == name]
        if not matches:
            continue
        require(len(matches) == 1, "ambiguous attestation artifacts")
        run = get(f"{root}/actions/runs/{run_id}")
        verify_run(run, repository, repository_id, base_sha, workflow["id"], now)
        meta = matches[0]
        artifact_id = meta["id"]
        require(type(artifact_id) is int and artifact_id > 0, "invalid artifact ID")
        archive = get(f"{root}/actions/artifacts/{artifact_id}/zip", binary=True)
        receipt = verify_artifact(meta, archive, run, repository_id, name, now)
        return verify_receipt(receipt, policy, pr, repository, run["actor"]["login"])
    raise GateError("no authenticated owner attestation for this exact head; dispatch owner workflow then rerun this PR job")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--trusted-verifier", type=Path, required=True)
    args = parser.parse_args()
    try:
        require(os.environ.get("GITHUB_EVENT_NAME") in {"pull_request", "pull_request_review"},
                "native gate requires an eligible PR event")
        spec = importlib.util.spec_from_file_location("trusted_review_policy", args.trusted_verifier)
        require(spec is not None and spec.loader is not None, "trusted policy unavailable")
        policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        event = strict_json(Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())
        receipt = verify(policy, event, os.environ["GITHUB_REPOSITORY"])
        print(f"PASS {receipt['reason']} head={receipt['head_sha']} receipt={policy.receipt_sha256(receipt)}")
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        print(f"FAIL_CLOSED {type(error).__name__}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
