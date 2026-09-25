# Security inventory

## Durable diff scan

- Scan ID: `90745dec-1315-4340-9362-469e61c695b5`
- Snapshot: `codex-security-snapshot/v1:sha256:8f2c021dae9a119300389e06392da0140a5cb3f4bce5f64461249ca84981c0b1`
- Report SHA-256: `cae8348749d4a6b653a1d8b9e1f0395343ccf562c804c88fb0a252f52523a71d`
- Manifest SHA-256: `dcab0b92e6cad4e70df14023606102316dac0c2eb1e29b179cceceafde7a3190`
- Findings SHA-256: `a43c4409a79b3c895ef31ed4e465a438e849bcf55e9aa6c9f3ff6bbb35a7af80`
- Coverage SHA-256: `b6b63e03784bfed72dc8ebf87645ef4b1b7359aacb0d0ba94aee9bd75b4b5a27`
- Result: complete manual coverage of 13 paths; zero reportable findings.

The native workbench inventory and terminal generator returned zero rows because the plugin excludes `.github/**` and `docs/**`. Git authoritatively showed 13 changed/untracked files. They were manually inventoried and reviewed sequentially under the same scan. The workbench also warns that the tree changed while the scan ran: that change was the security-discovered fix replacing a global sibling import that failed under Production's Python `-I -S` mode. The exact correction code commit `333e24a0f01deaf811031afc5a3318c1a8df382e` was then revalidated by 55 workflow tests, isolated-mode reproduction, parity, py_compile, and diff review. This delta statement is the exact-code supplement; the earlier snapshot report is not presented alone as final-head proof.

## Reviewed paths and surfaces

1. `.github/workflows/independent-review-gate.yml` and `.github/scripts/check_independent_review.py`: privileged trigger, permissions, trusted checkout, exact-head native review selection, human/association/self checks, current changes-requested blocking, bounded API/pagination, sanitized canonical receipt, status digest, and failure paths.
2. `.github/family-office-release-hold-v1.json`, its verifier, Family Office workflow, and mutation verifier integration: exact bindings, strict ACTIVE hold, no provider allowance, HTTP 503 ordering, isolated Python compatibility, and empty child environment.
3. Required governance JSON, Family Office/Trident workflows, parity checker, and adversarial tests: all-PR availability, stable names, non-skipped prepare failure, source-app binding contract, no secret use in privileged review workflow, and action SHA pins.
4. Scheduled workflow: full Git history for tests that materialize the pinned PR12 commit; no secrets or Production environment in the scheduler heartbeat.
5. BACKLOG, release documentation, and receipts: no overclaim of branch protection, review, provider restoration, runtime proof, or Production readiness.

## Sensitive-value inventory

- New privileged workflow receives only `${{ github.token }}` at one evaluation step; it is never serialized, printed, or uploaded.
- No HMAC value, provider credential, authorization manifest, project identifier, URL, business row, or secret value is added to logs or receipts.
- Existing secret references in mutation workflows remain step-scoped and unchanged except for the earlier hold refusal.

## Exclusions

No provider/runtime/deployment/Preview/branch-protection configuration was inspected or changed. TAC advisory status was `unknown`; this did not authorize or block the scan.

## Post-review bootstrap delta

The statement above describes scan `90745dec-1315-4340-9362-469e61c695b5` at
its original immutable scope. A later controller-authorized correction adds
branch-bounded Vercel Git configuration and updates documentary evidence after
two automatic Previews were observed. That delta is not covered by the original
scan and requires a new exact-head security review before merge.
