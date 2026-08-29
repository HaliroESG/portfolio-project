# Production mutation runbook

All Production schema/data workflows are fail-closed. A provider variable is a
kill switch only; ASTROCYTE_MUTATION_GATE=APPROVED and
ASTROCYTE_SOURCE_RIGHTS_GATE=APPROVED never create authority.

## Non-mutating control paths

- Workflow Parity / workflow-contract runs on every pull request and every push
  to main.
- Financial Data Sync / scheduler-heartbeat runs daily at 05:17 UTC.
- The scheduled event checks the exact default-branch SHA and deterministic
  workflow tests only. It receives no provider secret and cannot enter a
  Production mutation job.
- A manual Financial Data Sync run with scope=validate follows the same
  non-mutating heartbeat path.
- Trident Supabase Deploy Gate / validate is the push validation job. Its
  separate mutate-production job can run only from workflow_dispatch with at
  least one explicit mutation input.

## Mutation predicates

Before the first schema/data write, every workflow requires all predicates:

1. the exact canonical manifest has a valid HMAC-SHA256 signature from the
   pinned ASTROCYTE_CONTROL_CENTER_V1 issuer, checked with the protected
   Production secret ASTROCYTE_AUTHORIZATION_HMAC_KEY;
2. issuer and repository match the pinned values;
3. event is exactly workflow_dispatch;
4. ref is exactly refs/heads/main;
5. github.sha matches the manifest run_sha;
6. github.workflow_ref matches the allowlisted workflow file on main;
7. workflow inputs equal their typed, canonical manifest representation;
8. controller_ref is present and normalized;
9. issued_at is not in the future and expiry is after issued_at, in the future,
   and at most 24 hours after issue;
10. canonical manifest SHA-256 matches the supplied hash;
11. target identity is a lowercase SHA-256;
12. restore receipt hash, target, base SHA, freshness, finite RPO/RTO, fingerprint,
    isolation, side-effect, and cleanup predicates pass;
13. nonce and receipt_id match the dispatch inputs and have not been consumed by
    any workflow run;
14. the current run has persisted the single 30-day anti-replay artifact for
    that nonce/receipt_id pair;
15. provider mutation and source-rights kill switches are still open;
16. blocking prechecks pass before any migration or data write.

The full signature, freshness, inputs, target, restore receipt, and current-run
anti-replay predicates are re-evaluated inside each mutative job after its
Production environment gate and immediately before its first provider access.
The verifier is a standalone standard-library script executed with the system
Python in isolated mode (`/usr/bin/python3 -I -S`), so `PYTHONPATH`, user-site
packages, and `sitecustomize` cannot run while the HMAC key is present. Runtime
dependencies are prepared in a separate job that has no Production environment
and no secret. Each protected job starts on a fresh runner, authenticates the
manifest before mutable setup, rechecks the verifier, revalidates authority,
and only then downloads the prepared dependency artifact. Provider secrets are
step-scoped after that final boundary. The initial claim is not sufficient if
authority expires while trusted setup runs.

All write workflows share portfolio-production-mutation with
cancel-in-progress: false. A newer run cannot cancel a mutation already in
progress.

## Authorization manifest

The manifest uses exact fields and contains no secret:

    {
      "schema_version": "astrocyte_mutation_authorization_v2",
      "issuer": "ASTROCYTE_CONTROL_CENTER_V1",
      "repository": "HaliroESG/portfolio-project",
      "workflow": "<allowlisted workflow id>",
      "ref": "refs/heads/main",
      "run_sha": "<exact main sha>",
      "controller_ref": "<normalized controller record>",
      "issued_at": "YYYY-MM-DDTHH:MM:SSZ",
      "expires_at": "YYYY-MM-DDTHH:MM:SSZ",
      "target_sha256": "<approved target identity hash>",
      "restore_receipt_sha256": "<canonical receipt hash>",
      "restore_receipt": {},
      "inputs": {},
      "nonce": "<32-to-64 lowercase hexadecimal characters>",
      "receipt_id": "<16-to-64 lowercase letters, digits, or hyphens>"
    }

Workflow IDs and normalized inputs:

| Workflow ID | Inputs |
| --- | --- |
| financial-data-sync | scope, trident_mode, optional trident_price_start_date |
| production-data-remediation | apply_schema, top_n, start_date, run_full_after_top |
| trident-price-backfill | top_n, start_date, optional end_date, dry_run |
| trident-stock-insights | top_n, optional normalized ticker, force, dry_run |
| trident-supabase | apply_schema, run_trident_etl, with at least one true |

Optional values are JSON null, booleans are JSON booleans, integers have no
leading zero, dates use YYYY-MM-DD, and tickers are uppercase. Hash a prepared
local manifest without dispatching anything:

    python3 .github/scripts/check_mutation_contract.py \
      --workflow <workflow-id> \
      --manifest-file /absolute/path/to/authorization-manifest.json \
      --hash-only

Use the canonical JSON line as authorization_manifest and the following digest
as authorization_manifest_sha256. Recompute both after any field changes. A
protected issuer, independent of the person or process dispatching the workflow,
must then HMAC-sign that exact canonical JSON. Pass the lowercase signature as
authorization_signature and pass the manifest nonce/receipt_id separately as
authorization_nonce and authorization_receipt_id. Never put the HMAC key in the
manifest, a dispatch input, an artifact, or a log.

The claim phase rejects any existing GitHub artifact named from the validated
receipt_id/nonce pair, then uploads one current-run marker. Every mutative job
requires exactly that non-expired marker and verifies its workflow run ID. The
30-day marker retention exceeds the maximum 24-hour authorization lifetime, so
an expired authority cannot become replayable after normal marker cleanup.

This repository does not configure ASTROCYTE_AUTHORIZATION_HMAC_KEY or an
issuer. Until both independent issuance and the protected Production secret are
configured under separate authority, every Production mutation fails closed.
Dry-run modes still read provider data and therefore require the same authentic,
one-shot authority and provider-secret boundary; `dry_run=true` removes writes,
not provider access.

## Migration and postconditions

Compatible SQL files run through psql --single-transaction with
ON_ERROR_STOP=1. Pre- and post-migration schema checks are blocking. If a
precheck fails, no mutation step starts. If a migration statement fails, the
transaction rolls back before later data jobs can run. Data refresh and
freshness checks remain explicit postconditions; a failed postcondition is an
incident, not permission to rerun.

## Rollback

1. Close both provider kill switches and do not cancel the running mutation.
2. Capture the workflow, run ID, exact SHA, manifest hash, receipt hash,
   receipt_id, first failed step, and any completed postconditions without
   exposing secrets or the HMAC key.
3. For a repository-only defect, prepare a separate revert PR. Do not dispatch
   the reverted workflow automatically.
4. For a failed SQL transaction, verify that PostgreSQL rolled it back; do not
   assume partial success.
5. For committed data changes, choose forward repair or restore only under a
   new, explicit rollback/provider authority tied to the same target. Never use
   a stale receipt as rollback authority.
6. Revalidate schema/data postconditions and keep kill switches closed.

GitHub rulesets, required reviewers, environment protections, secret placement,
Supabase plan/retention/PITR, restore execution, activation, and rollback are
provider-side gates. This repository PR neither configures nor proves them.
