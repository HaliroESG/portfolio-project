# Security inventory

## Exact scan

- Scan: `c8be56b6-1fbf-4cbe-87ac-9e23f05defac`
- Range: `3828d6d7851958f6e832896ce908c60097f67f90..ccfc0960812ce90deccfc01434da457e1e6934ce`
- Snapshot: `codex-security-snapshot/v1:sha256:77e468bd572d4bd67ef65f90bc3a4ae1e51e0cfd9ac42a331e574d3fc8daa328`
- Findings JSON SHA-256: `075d9bda07a989d83d089f363a0feb0b3935972d1e60ce3b79e44011fe3c42e2`
- Coverage JSON SHA-256: `3dd924b3cd0d4d917849710fd1376dcff939af006b5aac92524238e07d6faa06`
- Result: zero reportable findings.

The native compact inventory unexpectedly returned no rows for this non-empty diff. Under the strict-solo authority, all 11 exact changed paths were therefore reviewed manually. The canonical scan honestly records coverage as partial and preserves that gap for the independent reviewer.

## Supplemental CI-correction scan

- Scan: `75c4d2cc-61a4-45e7-9fcf-349570f9a09a`
- Range: `c07a45ff4fd003329e2d6b673644a67da065701d..bc1d9f6eacbbe28dccd4b4bb19fe0987ed7ac91b`
- Paths: `.github/workflows/workflow-parity.yml` and `.github/scripts/check_workflow_parity.py`
- Result: zero reportable findings.

The full-history checkout remains pinned, read-only, secret-free, and outside the Production environment. Fetched Git objects are not executed by this correction; Family Office materialization still requires the exact commit, blob SHA-1, and content SHA-256. The native inventory again returned zero rows, so both paths were manually reviewed and the limitation was preserved.

## Reviewed surfaces

1. Candidate provenance: exact commit, path safety, Git blob SHA-1, content SHA-256, and fresh temporary materialization.
2. Local PostgreSQL boundary: private `/tmp` directory, Unix socket only, no TCP listen address, argv-only subprocesses, bounded timeouts, synthetic rows, checked shutdown and deletion.
3. Tenant isolation: owner A/B reads, rejected authenticated writes, composite constraints, RLS/grants/views, unsafe rollback refusal, and safe rollback.
4. Receipt boundary: closed field inventory, strict JSON, `LOCAL_ISOLATED_DATABASE` constant, matching fingerprints, and explicit Production-validator rejection.
5. Workflow trust: pull-request jobs have no secrets or Production environment; actions are SHA-pinned.
6. Production refusal: manual default-false dispatch, `refs/heads/main` binding, existing issuer/HMAC and anti-replay contract, recent `ISOLATED_PROJECT` receipt, two gates, protected environment, then HTTP 503 with no provider command.
7. Logs/artifacts: hashes, timestamps, bounded metrics and booleans only; no credentials, URLs, provider identifiers, or business row values.

## Dependency observation

`npm ci` reported eight existing audit entries (1 low, 1 moderate, 6 high). This branch changes no frontend dependency or lockfile; no broad dependency remediation was attempted in this bounded release-gate change.

## Configuration not inspected or changed

GitHub Production environment policy, secrets, variables, Supabase, Vercel, and all provider/runtime configuration were outside authority. Absence of `ASTROCYTE_AUTHORIZATION_HMAC_KEY`, the independent issuer, or Production gates remains fail-closed and was not filled with invented values.
