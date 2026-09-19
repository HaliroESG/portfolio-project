# Family Office release gate

This gate prepares the Family Office owner-isolation release sequence without
contacting Supabase, Vercel, a runtime endpoint, or any other provider. It is a
repository and local-PostgreSQL qualification only. It does not activate PR12,
apply a remote migration, or establish Production readiness.

## Pinned candidate contract

`.github/family-office-candidate-v1.json` pins the independently reviewed PR12
candidate commit `c01eb33878e4030975144c5b0ae98e9bdf31ea04`. Every consumed SQL
or test fixture is bound by its repository path, Git blob SHA-1 and SHA-256.
The local runner reads each blob from Git and rejects any missing commit, path,
blob or digest mismatch. It does not carry a second editable copy of the
migration.

The pinned migration SHA-256 is
`5ca9423c2a4eb367d764b3c8830fb6ba2d38bb91f7b70f545576e618928932cf`.

## Local drill

PostgreSQL 15 or newer server and client tools are required. The default macOS
location is detected, or `FAMILY_OFFICE_PG_BIN` can name a local PostgreSQL bin
directory. No database URL, password, Supabase key or runtime secret is used.

```bash
python3.11 .github/scripts/family_office_release_gate.py --preflight
python3.11 .github/scripts/family_office_release_gate.py \
  --run \
  --receipt-file /tmp/family-office-local-restore-receipt.json
python3.11 .github/scripts/verify_family_office_local_receipt.py \
  --receipt-file /tmp/family-office-local-restore-receipt.json \
  --expected-candidate-sha c01eb33878e4030975144c5b0ae98e9bdf31ea04
```

If PostgreSQL 15+ is unavailable, preflight exits non-zero with a bounded
`BLOCKED` diagnostic. The runner never falls back to a provider connection.

The drill creates an ephemeral cluster in a private temporary directory and
listens only on a Unix socket. It then:

1. builds a synthetic pre-migration Family Office database;
2. creates a logical `pg_dump` backup, hashes it and measures RPO;
3. restores into an isolated database, compares schema, data and count
   fingerprints, and measures RTO through fingerprint validation;
4. materializes and applies the exact PR12 preflight and migration;
5. runs two-owner A/B isolation tests for reads, writes, composite foreign keys,
   RLS, grants and security-invoker views;
6. proves that rollback refuses a live two-owner graph, then proves the guarded
   rollback on a separately restored one-owner isolate;
7. stops PostgreSQL and deletes the cluster, databases and logical dump before
   writing a PASS receipt.

Only synthetic identities and rows are used. The receipt contains timestamps,
hashes, PostgreSQL major version, RPO/RTO measurements and boolean results; it
contains no row values, URL, project identifier or secret.

## Receipt boundary

The schema is
`docs/schemas/astrocyte_family_office_local_restore_receipt_v1.schema.json`.
The only accepted restore mode is `LOCAL_ISOLATED_DATABASE` and cleanup must be
`DELETED`. Unit tests pass the local receipt to the existing Production restore
validator and require rejection.

Production continues to require the separate
`astrocyte_restore_drill_receipt_v1` contract with a recent
`restore_mode=ISOLATED_PROJECT`. A successful local drill must never be
described as Supabase backup/PITR, a provider-native restore, staging evidence,
or Production evidence.

## GitHub workflow stages

`.github/workflows/family-office-release.yml` has three explicit jobs:

- `validate`: secret-free compilation and contract checks;
- `prepare`: provider-free local PostgreSQL drill and sanitized artifact upload;
- `mutate-production`: manual-only, default off, protected by the Production
  environment, the existing independent-issuer HMAC authorization and
  anti-replay contract, an embedded recent `ISOLATED_PROJECT` receipt, and the
  general plus Family Office kill switches.

The Production job currently ends with
`FAMILY_OFFICE_PRODUCTION_HTTP_503` and exit 78. It contains no provider
credential and no provider mutation command. `ASTROCYTE_AUTHORIZATION_HMAC_KEY`,
the independent issuer and Production gates are referenced as prerequisites;
this repository change does not create or configure them.

## PR14 governance release hold

PR14 was squash-merged as `a3d07b1d9184a0a7f4ee4f750d2e43b5f8a3bd2f`
before its independent review completed. That later review returned
`FAIL / FIX_FIRST`. `.github/family-office-release-hold-v1.json` binds the hold
to the exact merged head and tree plus the sealed review and handoff hashes.

The `mutate-production` job checks this hold immediately after the trusted
checkout and before any HMAC, anti-replay or provider prerequisite. Active hold
enforcement exits 78 with `FAMILY_OFFICE_PRODUCTION_HTTP_503`. The mutation
authorization verifier also checks the same hold before parsing an authorization
manifest. Clearing or weakening the hold requires a separate reviewed change,
a fresh independent review and explicit controller authority; this PR does not
provide such clearance.

## Required PR contexts and independent review

`.github/required-pr-governance-v1.json` records the desired main-protection
contract without claiming that GitHub has been configured. Family Office
validate/prepare and Trident validate run on every PR with stable names. Family
Office prepare uses an unconditional job entry and fails if validate was not
successful, so the required context cannot disappear or become a skipped
downstream success after an upstream failure.

When the controller activates the contract, every context must be bound to the
GitHub Actions source app rather than accepted by name alone. The numeric app ID
is deliberately not guessed in this repository and must be resolved from the
repository's authenticated check metadata at activation time.

The review workflow is intentionally based on `pull_request_target`, an explicit
`workflow_dispatch`, and the trusted default-branch verifier. It never checks
out or executes PR code. The normal path reads native GitHub review metadata and
accepts only a current exact-head `APPROVED` review from a human repository
owner/member/collaborator who is not the PR author. Current exact-head change
requests block; bots, outsiders, self-review, stale commits, labels and review
body text never grant authority.

For this mono-user repository, the alternate path is an explicit repository-owner
dispatch bound to an open, ready, same-repository PR targeting `main`. The
dispatching owner must also be the PR author and must provide the exact
head SHA, a `SHIP` verdict, the SHA-256 of the corresponding Codex review receipt,
and the exact confirmation `ACCEPT_CODEX_SHIP_FOR_EXACT_HEAD`. The trusted
default-branch verifier binds the actor to the repository owner and re-fetches PR identity before
posting the stable `ASTROCYTE Independent Review` commit status. No label,
comment, branch content, bot, or automatic event can activate this exception.
Both paths upload a sanitized canonical receipt whose SHA-256 is included in the
status description.

There is an unavoidable bootstrap boundary: GitHub executes both trusted paths
from the default branch. The workflow introducing the mono-user exception cannot
attest its own PR and therefore requires one explicit repository-owner override.
After that one-time merge, exact-head owner dispatches are fail-closed and
auditable. The versioned contract requires the six GitHub Actions contexts and
zero native approving reviews; it does not modify branch protection itself.

## Governance-branch Preview boundary

Vercel created two automatic Preview deployments when this governance branch
was first published: one for `frontend` and one for `quant-terminal-ui`. They
were Git-integration side effects, not agent-requested deployments, and they do
not constitute Production evidence.

The root and `frontend` `vercel.json` files now set
`git.deploymentEnabled["codex/*governance*"]` to `false`. The duplicate static
configuration deliberately covers both possible Vercel project roots. It is
branch-bounded: unspecified branches retain Vercel's default deployment
behavior, so this control does not disable or promote `main`, Production, or
ordinary product Preview deployments. Its effectiveness must be verified from
GitHub/Vercel deployment metadata on the next governance-branch commit.
