# PGA-004-CORRECTION-V3 — audit delta

## Bound candidate and upstream evidence

- Draft PR: `#12`; base and merge-base: `3828d6d7851958f6e832896ce908c60097f67f90`.
- Previous PR head: `6cb735e0ef551053b50fc1318ebbde029575a444`.
- V3 corrected code commit: `31d0561f44234f5a48af3284a441e567ae6ed2d4`.
- V3 corrected code tree: `ef05b0b2c0416ffbf610f706188688e8fe4a877c`.
- The sealed review `review.md` matches the announced SHA-256: `446d75ed6da72d5cb5a7029b64d939021ea4910931a6a50737262164483237e5`.
- The observed `handoff.yaml` SHA-256 is `82c2895c6fe6172bcbda2fbb721a4aa96c2770ca8ceddd1d8f8a76d1251b1e4d`, not the announced `34745c945d0a7d97e6dbb5e57efc32110aea704f05d8113a25f545a709d20e97`.
- The observed `SHA256SUMS` SHA-256 is `abb9eddbc9e7fcc95e029367e631036f154c81e077cf267235cbff9048773115`, not the announced `a9556c906f81fe20cc17a31060021e5fac3257d05d6552b38c62d0a66e2c58d4`; its internal checks pass.
- The mismatch remains visible. The owner explicitly instructed this lease to proceed despite `blocker_count=1`; no missing finding was inferred from the mismatched files.

## P1-01 — private readers and live A to B transition

`useOwnerIdentity` is now the common session identity source. `useOwnerScopedSWR` puts `ownerUserId` in every affected request key, captures the requested owner in each result and exposes the result only while it matches the current owner. `useOwnerBoundState` makes owner-local selectors and expanded/filter state synchronously evaluate to their defaults on an owner change, without waiting for an effect.

The following surfaces use that contract end to end:

1. `/targets`: explicit owner predicates and owner assertions for portfolios, positions, broker snapshot runs, target models, target buckets and target envelope lines.
2. `/arbitrage`: owner-scoped portfolio root selection and owner-keyed RLS-backed decision, allocation, macro and execution reads.
3. `GovernanceWidget`: explicit owner predicates and assertions on portfolios and governance targets.
4. `DataHealthPanel`: explicit owner predicate and assertion on valuation snapshots; all returned state is bound to the requested owner.
5. `/geo` through `portfolioData`: explicit owner predicates and assertions on portfolios and positions; the former shared-market fallback can no longer synthesize private holdings.

The mounted React transition test keeps each surface mounted, renders owner A state, transitions to B, verifies synchronous private-state clearing, resolves B, then resolves the delayed A request and proves that A is neither rendered nor re-injected. The pre-existing mounted `OrdersPanel` transition proof remains green.

## P2-01 — active writers

`sync_transactions.py`, `sync_reconciliation.py` and `import_target_model.py` require an explicit valid owner UUID for every write. Transaction and reconciliation idempotency identifiers are owner-namespaced and use owner-composite conflict targets. Reconciliation replacement deletes by both owner and run. Target model identifiers are owner-namespaced; the owner is propagated into model and child payloads, composite conflicts, and owner-filtered replacement deletes.

Dry runs remain owner-independent because they do not write. Apply mode has no implicit environment or singleton owner fallback: missing or invalid ownership fails closed before any client write. `frontend/types.ts` already carried the non-null owner fields for these contracts from V2 and was rechecked; no new shape drift was introduced.

The PostgreSQL 15.19 harness invokes the real three writer functions through a psql-backed Supabase-shaped adapter. Synthetic owners A and B write identical external identifiers, replay A, and retain two distinct owners across transactions, reconciliation items, target models and target buckets.

## P2-02 — read-only preflight

The repository preflight runs inside `begin transaction read only` and reports exploitable counts for:

- NULL and unknown owners across all 16 private legacy tables;
- the exact 27 canonical child-parent edges;
- the exact 13 legacy child-parent edges;
- per-edge cross-owner rows plus a deterministic summary.

The harness proves that a contaminated canonical graph is refused before migration with `canonical_edges_checked=27 canonical_cross_owner=1`. A separate fully owner-columned legacy graph is refused with `legacy_edges_checked=13 legacy_cross_owner=1 null_owner=1 unknown_owner=1`. The attempted migration of the contaminated canonical graph also rolls back atomically.

## Preserved controls and uncertainty

The exact V2 counts remain 27 canonical owner-composite FKs plus 22 direct owner-profile FKs, and 13 legacy owner-composite FKs plus 16 direct owner-profile FKs. The 16 private legacy tables retain RLS and authenticated read-only grants. The Production HTTP 503 business-command guard, OrdersPanel transition controls, workflow hardening and rollback guard were not relaxed and their full test suites remain green.

No Supabase schema/data/config was read, no remote migration was applied, no Production command ran and no runtime was opened. Provider schema compatibility, real provider contamination, lock duration and authenticated browser behavior therefore remain `UNKNOWN` pending a separately authorized environment-specific preflight and independent review.
