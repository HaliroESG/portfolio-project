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

1. event is exactly workflow_dispatch;
2. ref is exactly refs/heads/main;
3. github.sha matches the manifest run_sha;
4. github.workflow_ref matches the allowlisted workflow file on main;
5. workflow inputs equal their typed, canonical manifest representation;
6. controller_ref is present and normalized;
7. manifest expiry is in the future and no more than 24 hours away;
8. canonical manifest SHA-256 matches the supplied hash;
9. target identity is a lowercase SHA-256;
10. restore receipt hash, target, base SHA, freshness, RPO/RTO, fingerprint,
    isolation, side-effect, and cleanup predicates pass;
11. provider mutation and source-rights kill switches are still open;
12. blocking prechecks pass before any migration or data write.

All write workflows share portfolio-production-mutation with
cancel-in-progress: false. A newer run cannot cancel a mutation already in
progress.

## Authorization manifest

The manifest uses exact fields and contains no secret:

    {
      "schema_version": "astrocyte_mutation_authorization_v1",
      "workflow": "<allowlisted workflow id>",
      "ref": "refs/heads/main",
      "run_sha": "<exact main sha>",
      "controller_ref": "<normalized controller record>",
      "expires_at": "YYYY-MM-DDTHH:MM:SSZ",
      "target_sha256": "<approved target identity hash>",
      "restore_receipt_sha256": "<canonical receipt hash>",
      "restore_receipt": {},
      "inputs": {}
    }

Workflow IDs and normalized inputs:

| Workflow ID | Inputs |
| --- | --- |
| financial-data-sync | scope, trident_mode, optional trident_price_start_date |
| production-data-remediation | apply_schema, top_n, start_date, run_full_after_top |
| trident-price-backfill | top_n, start_date, optional end_date, dry_run=false |
| trident-stock-insights | top_n, optional normalized ticker, force, dry_run=false |
| trident-supabase | apply_schema, run_trident_etl, with at least one true |

Optional values are JSON null, booleans are JSON booleans, integers have no
leading zero, dates use YYYY-MM-DD, and tickers are uppercase. Hash a prepared
local manifest without dispatching anything:

    python3 .github/scripts/check_mutation_contract.py \
      --workflow <workflow-id> \
      --manifest-file /absolute/path/to/authorization-manifest.json \
      --hash-only

Use the canonical JSON line as authorization_manifest and the following digest
as authorization_manifest_sha256. Recompute both after any field changes.

## Migration and postconditions

Compatible SQL files run through psql --single-transaction with
ON_ERROR_STOP=1. Pre- and post-migration schema checks are blocking. If a
precheck fails, no mutation step starts. If a migration statement fails, the
transaction rolls back before later data jobs can run. Data refresh and
freshness checks remain explicit postconditions; a failed postcondition is an
incident, not permission to rerun.

## Rollback

1. Close both provider kill switches and do not cancel the running mutation.
2. Capture the workflow, run ID, exact SHA, manifest hash, receipt hash, first
   failed step, and any completed postconditions without exposing secrets.
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
