# PGA-004-CORRECTION-V5 — audit delta

## Scope and lineage

- Exact upstream base: `3828d6d7851958f6e832896ce908c60097f67f90` (`origin/main`, PR13).
- V4 candidate before this stage: `29ce45049ce352f1b295e48f9306a3aa6f3a2396`.
- V5 code candidate: `a496b33d538b61a31b6591bf1f633c73cc0cc10f`.
- V5 code tree: `932b3d6e02d0064af47f119cc0db102e9e4a051f`.
- Rebase result: no-op; the branch already had the exact requested merge base and produced no conflict.
- Delivery: targeted `--force-with-lease` from the exact V4 remote head to the V5 code candidate.

The sealed V4 independent review was read-only and reported `PASS`, `SHIP_FOR_REBASE_STAGE_ONLY`, with no P0-P3 findings. Its announced hashes were verified before modification: `review.md` `a6f3a131a09df72567a940b07c4bb9d64f2f1bf786c739dc9015d0af2bcc56e4`, `handoff.yaml` `e4a8beb0b12e41b47837730d9745e709150b355be7438e3c85321e39c2b38191`, `evidence.yaml` `94de5465b37b5c591209131ee1b0d4715f3a99e1afacac0fb185cd6205475a6f`, and `SHA256SUMS` `9d2fc3e63c669b8fdedd1291350ff996f1cd63a204e668e3ae18f68d68252a35`.

## V5-only delta

No production implementation changed. V5 changes only the regression proof:

- `frontend/scripts/test-owner-surface-transition.cjs` mounts each of the five production readers, transitions the authenticated tree A to B without unmounting, and exercises both a late A success and a late A error.
- It asserts that no A row, filter, error, owner marker or cache result remains rendered or is re-injected after B loads.
- `frontend/scripts/validate-critical-flows.mjs` now requires both late-outcome scenarios so the static critical-flow contract matches the executable proof.

## Preserved controls

- 27 canonical composed-owner FKs plus 22 direct owner-profile FKs; the 49 total is not mislabeled as composed.
- 13 legacy composed-owner FKs plus 16 direct owner-profile FKs across 16 private legacy tables.
- Owner-scoped writers, conflict identities, RLS/grants/views, contaminated-graph preflight and atomic rollback.
- Deterministic Production HTTP 503 before auth or network work.
- PR13 workflow hardening; `prepare-runtime` and `mutate-production` remained skipped.

## Explicit unknowns

Provider schema contents, deployed configuration, Production data distribution and migration lock duration remain unverified. No Supabase/Vercel runtime, provider UI/URL or Production data/configuration was accessed, and no migration or command was applied.
