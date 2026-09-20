#!/usr/bin/env python3
"""Emit a fail-closed exact-head review status from authenticated evidence."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


CONTEXT = "ASTROCYTE Independent Review"
SCHEMA_VERSION = "astrocyte_independent_review_receipt_v1"
OWNER_SCHEMA_VERSION = "astrocyte_owner_codex_ship_receipt_v1"
TRUSTED_ASSOCIATIONS = {"COLLABORATOR", "MEMBER", "OWNER"}
DECISIVE_STATES = {"APPROVED", "CHANGES_REQUESTED", "DISMISSED"}
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
OWNER_CONFIRMATION = "ACCEPT_CODEX_SHIP_FOR_EXACT_HEAD"


class IndependentReviewError(ValueError):
    """Raised when native review evidence cannot be evaluated safely."""


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise IndependentReviewError("review receipt is not strict JSON") from exc


def receipt_sha256(receipt: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(receipt).encode("utf-8")).hexdigest()


def _review_order(review: dict[str, Any]) -> tuple[str, int]:
    submitted_at = review.get("submitted_at")
    review_id = review.get("id")
    if not isinstance(submitted_at, str) or not submitted_at.endswith("Z"):
        raise IndependentReviewError("review submitted_at is invalid")
    if not isinstance(review_id, int) or review_id <= 0:
        raise IndependentReviewError("review id is invalid")
    return submitted_at, review_id


def evaluate_reviews(
    reviews: object,
    *,
    repository: str,
    pull_request: int,
    head_sha: str,
    pull_request_author: str,
) -> dict[str, Any]:
    if not isinstance(reviews, list):
        raise IndependentReviewError("GitHub reviews response must be a list")
    if not REPOSITORY_RE.fullmatch(repository):
        raise IndependentReviewError("repository is invalid")
    if not isinstance(pull_request, int) or pull_request <= 0:
        raise IndependentReviewError("pull request number is invalid")
    if not SHA_RE.fullmatch(head_sha):
        raise IndependentReviewError("pull request head is not an exact Git SHA")
    if not pull_request_author:
        raise IndependentReviewError("pull request author is missing")

    current_by_reviewer: dict[str, dict[str, Any]] = {}
    for review in reviews:
        if not isinstance(review, dict):
            raise IndependentReviewError("review record must be an object")
        state = review.get("state")
        commit_id = review.get("commit_id")
        association = review.get("author_association")
        user = review.get("user")
        if state not in DECISIVE_STATES or commit_id != head_sha:
            continue
        if not isinstance(user, dict):
            raise IndependentReviewError("review user is missing")
        login = user.get("login")
        user_type = user.get("type")
        if not isinstance(login, str) or not login:
            raise IndependentReviewError("reviewer login is invalid")
        if user_type != "User" or association not in TRUSTED_ASSOCIATIONS:
            continue
        if login.casefold() == pull_request_author.casefold():
            continue
        key = login.casefold()
        previous = current_by_reviewer.get(key)
        if previous is None or _review_order(review) > _review_order(previous):
            current_by_reviewer[key] = review

    blocking = sorted(
        review["user"]["login"]
        for review in current_by_reviewer.values()
        if review["state"] == "CHANGES_REQUESTED"
    )
    approvals = [
        review
        for review in current_by_reviewer.values()
        if review["state"] == "APPROVED"
    ]
    base_receipt: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "context": CONTEXT,
        "repository": repository,
        "pull_request": pull_request,
        "head_sha": head_sha,
        "pull_request_author": pull_request_author,
        "labels_or_comments_trusted": False,
        "auto_approval": False,
    }
    if blocking:
        return {
            **base_receipt,
            "status": "FAIL",
            "reason": "CURRENT_EXACT_HEAD_CHANGES_REQUESTED",
            "blocking_reviewers": blocking,
        }
    if not approvals:
        return {
            **base_receipt,
            "status": "FAIL",
            "reason": "NO_CURRENT_EXACT_HEAD_INDEPENDENT_APPROVAL",
            "blocking_reviewers": [],
        }

    selected = max(approvals, key=_review_order)
    return {
        **base_receipt,
        "status": "PASS",
        "reason": "CURRENT_EXACT_HEAD_INDEPENDENT_APPROVAL",
        "blocking_reviewers": [],
        "review": {
            "id": selected["id"],
            "reviewer": selected["user"]["login"],
            "association": selected["author_association"],
            "commit_id": selected["commit_id"],
            "submitted_at": selected["submitted_at"],
        },
    }


def evaluate_owner_codex_ship(
    pull_request_payload: object,
    *,
    repository: str,
    pull_request: int,
    head_sha: str,
    actor: str,
    codex_review_sha256: str,
    codex_verdict: str,
    confirmation: str,
) -> dict[str, Any]:
    """Validate a narrow, owner-dispatched mono-user Codex SHIP exception."""
    if not REPOSITORY_RE.fullmatch(repository):
        raise IndependentReviewError("repository is invalid")
    if not isinstance(pull_request, int) or pull_request <= 0:
        raise IndependentReviewError("pull request number is invalid")
    if not SHA_RE.fullmatch(head_sha):
        raise IndependentReviewError("pull request head is not an exact Git SHA")
    if not isinstance(actor, str) or not actor:
        raise IndependentReviewError("workflow actor is missing")
    if not SHA256_RE.fullmatch(codex_review_sha256):
        raise IndependentReviewError("Codex review digest is invalid")
    if codex_verdict != "SHIP":
        raise IndependentReviewError("Codex verdict must be SHIP")
    if confirmation != OWNER_CONFIRMATION:
        raise IndependentReviewError("owner confirmation is invalid")
    repository_owner = repository.split("/", 1)[0]
    if actor.casefold() != repository_owner.casefold():
        raise IndependentReviewError("workflow actor is not the repository owner")
    if not isinstance(pull_request_payload, dict):
        raise IndependentReviewError("pull request response is malformed")
    try:
        actual_number = pull_request_payload["number"]
        state = pull_request_payload["state"]
        draft = pull_request_payload["draft"]
        author = pull_request_payload["user"]["login"]
        actual_head_sha = pull_request_payload["head"]["sha"]
        head_repository = pull_request_payload["head"]["repo"]["full_name"]
        base_ref = pull_request_payload["base"]["ref"]
        base_repository = pull_request_payload["base"]["repo"]["full_name"]
    except (KeyError, TypeError) as exc:
        raise IndependentReviewError("pull request identity is incomplete") from exc
    identity_values = (author, actual_head_sha, head_repository, base_ref, base_repository)
    if not all(isinstance(value, str) and value for value in identity_values):
        raise IndependentReviewError("pull request identity is malformed")
    if actual_number != pull_request:
        raise IndependentReviewError("pull request number does not match")
    if state != "open" or draft is not False:
        raise IndependentReviewError("pull request must be open and ready for review")
    if actual_head_sha != head_sha:
        raise IndependentReviewError("Codex SHIP attestation is stale")
    if base_ref != "main" or base_repository.casefold() != repository.casefold():
        raise IndependentReviewError("pull request must target repository main")
    if head_repository.casefold() != repository.casefold():
        raise IndependentReviewError("fork pull requests cannot use the mono-user exception")
    if author.casefold() != actor.casefold():
        raise IndependentReviewError("mono-user exception actor must be the pull request author")
    return {
        "schema_version": OWNER_SCHEMA_VERSION,
        "context": CONTEXT,
        "repository": repository,
        "pull_request": pull_request,
        "head_sha": head_sha,
        "pull_request_author": author,
        "status": "PASS",
        "reason": "OWNER_ACCEPTED_CODEX_SHIP_FOR_EXACT_HEAD",
        "mode": "OWNER_WORKFLOW_DISPATCH",
        "labels_or_comments_trusted": False,
        "auto_approval": False,
        "owner_attestation": {
            "actor": actor,
            "authority": "repository_owner",
            "codex_verdict": codex_verdict,
            "codex_review_sha256": codex_review_sha256,
            "confirmation": confirmation,
        },
    }


def _request_json(
    url: str,
    *,
    token: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> Any:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username:
        raise IndependentReviewError("GitHub API URL must be trusted HTTPS")
    data = canonical_json(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        method=method,
        data=data,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, urllib.error.HTTPError) as exc:
        raise IndependentReviewError("GitHub review API request failed") from exc


def _fetch_reviews(api_url: str, repository: str, pull_request: int, token: str) -> list[Any]:
    reviews: list[Any] = []
    for page in range(1, 11):
        url = (
            f"{api_url.rstrip('/')}/repos/{repository}/pulls/{pull_request}/reviews"
            f"?per_page=100&page={page}"
        )
        batch = _request_json(url, token=token)
        if not isinstance(batch, list):
            raise IndependentReviewError("GitHub reviews response is malformed")
        reviews.extend(batch)
        if len(batch) < 100:
            return reviews
    raise IndependentReviewError("GitHub review pagination exceeds the fail-closed bound")


def _positive_int(value: str, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise IndependentReviewError(f"{label} is invalid") from exc
    if parsed <= 0 or str(parsed) != value:
        raise IndependentReviewError(f"{label} is invalid")
    return parsed


def _evaluate_owner_dispatch(
    api_url: str,
    repository: str,
    token: str,
) -> dict[str, Any]:
    pull_request = _positive_int(
        os.environ.get("OWNER_REVIEW_PULL_REQUEST", ""),
        "pull request number",
    )
    head_sha = os.environ.get("OWNER_REVIEW_HEAD_SHA", "")
    actor = os.environ.get("GITHUB_ACTOR", "")
    codex_review_sha256 = os.environ.get("OWNER_REVIEW_CODEX_SHA256", "")
    codex_verdict = os.environ.get("OWNER_REVIEW_CODEX_VERDICT", "")
    confirmation = os.environ.get("OWNER_REVIEW_CONFIRMATION", "")
    if not SHA_RE.fullmatch(head_sha):
        raise IndependentReviewError("pull request head is not an exact Git SHA")
    if not actor:
        raise IndependentReviewError("workflow actor is missing")
    if not SHA256_RE.fullmatch(codex_review_sha256):
        raise IndependentReviewError("Codex review digest is invalid")
    if codex_verdict != "SHIP":
        raise IndependentReviewError("Codex verdict must be SHIP")
    if confirmation != OWNER_CONFIRMATION:
        raise IndependentReviewError("owner confirmation is invalid")
    pull_request_payload = _request_json(
        f"{api_url.rstrip('/')}/repos/{repository}/pulls/{pull_request}",
        token=token,
    )
    return evaluate_owner_codex_ship(
        pull_request_payload,
        repository=repository,
        pull_request=pull_request,
        head_sha=head_sha,
        actor=actor,
        codex_review_sha256=codex_review_sha256,
        codex_verdict=codex_verdict,
        confirmation=confirmation,
    )


def check_run_payload(head_sha: str, receipt: dict[str, Any]) -> dict[str, Any]:
    if not SHA_RE.fullmatch(head_sha):
        raise IndependentReviewError("check run head is not an exact Git SHA")
    digest = receipt_sha256(receipt)
    conclusion = "success" if receipt.get("status") == "PASS" else "failure"
    reason = receipt.get("reason")
    if not isinstance(reason, str) or not reason:
        raise IndependentReviewError("review receipt reason is missing")
    summary = f"{receipt.get('status')} {reason} receipt={digest[:16]}"
    return {
        "name": CONTEXT,
        "head_sha": head_sha,
        "status": "completed",
        "conclusion": conclusion,
        "output": {
            "title": f"ASTROCYTE review gate: {conclusion}",
            "summary": summary,
        },
    }


def _post_check_run(
    api_url: str,
    repository: str,
    head_sha: str,
    token: str,
    receipt: dict[str, Any],
) -> None:
    _request_json(
        f"{api_url.rstrip('/')}/repos/{repository}/check-runs",
        token=token,
        method="POST",
        payload=check_run_payload(head_sha, receipt),
    )


def _load_event(path: Path) -> tuple[int, str, str]:
    if path.is_symlink() or not path.is_file():
        raise IndependentReviewError("GitHub event must be a regular non-symlink file")
    try:
        event = json.loads(path.read_text(encoding="utf-8"))
        pull_request = event["pull_request"]
        number = pull_request["number"]
        head_sha = pull_request["head"]["sha"]
        author = pull_request["user"]["login"]
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise IndependentReviewError("GitHub event lacks pull request identity") from exc
    return number, head_sha, author


def _write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    runner_temp = os.environ.get("RUNNER_TEMP")
    if runner_temp and path.resolve().parent != Path(runner_temp).resolve():
        raise IndependentReviewError("receipt must stay inside RUNNER_TEMP")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(receipt, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    event_path = Path(os.environ.get("GITHUB_EVENT_PATH", ""))
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    api_url = os.environ.get("GITHUB_API_URL", "https://api.github.com")
    token = os.environ.get("GITHUB_TOKEN", "")
    runner_temp = Path(os.environ.get("RUNNER_TEMP", "/tmp"))
    receipt_path = runner_temp / "astrocyte-independent-review-receipt.json"
    if not token:
        print("independent review gate failed: GitHub token is missing", file=sys.stderr)
        return 2
    try:
        if os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
            receipt = _evaluate_owner_dispatch(api_url, repository, token)
            head_sha = receipt["head_sha"]
        else:
            pull_request, head_sha, author = _load_event(event_path)
            reviews = _fetch_reviews(api_url, repository, pull_request, token)
            receipt = evaluate_reviews(
                reviews,
                repository=repository,
                pull_request=pull_request,
                head_sha=head_sha,
                pull_request_author=author,
            )
        _write_receipt(receipt_path, receipt)
        _post_check_run(api_url, repository, head_sha, token, receipt)
    except IndependentReviewError as exc:
        print(f"independent review gate failed closed: {exc}", file=sys.stderr)
        return 2
    digest = receipt_sha256(receipt)
    print(
        f"independent review {receipt['status']} head_sha={receipt['head_sha']} "
        f"receipt_sha256={digest}"
    )
    return 0 if receipt["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
