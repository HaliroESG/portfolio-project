# PGA-004-CORRECTION-V4 — audit delta

## Bound candidate and sealed review

- Draft PR: `#12`; branch: `codex/portfolio-astrocyte-pga-004-correction-v1`.
- Base and merge-base: `3828d6d7851958f6e832896ce908c60097f67f90`.
- Previous V3 artifact head: `f1685b122a8829a3018cfc2bd78fdd640fe9eb12`.
- V4 code commit: `9677c2fd4de916c04146fd067a7c8145c8e31c82`.
- V4 code tree: `2c4c60b544be31f1ad3464a5a00f364db6b69561`.
- Sealed V3 review hashes were reproduced exactly before modification: `review.md` `8ac993465f78b2cf764cd987d707c2f3510e2455831239f8b79f16d2abfd90e2`, `handoff.yaml` `19b50140174dbda3af9adabad5ba70767260d03f1e3302d1fd46bd09d4f148da`, `SHA256SUMS` `6aabd314f6fa3055284959661745df7419a374e2636602afeee26eed26f5f7ce`; the internal manifest check passed.

## P2-01 — real mounted production-reader proof

The generic five-label `SurfaceProbe` was removed. Five owner readers are now explicit product compositions and are imported by the corresponding production surface:

1. `useTargetsOwnerReader` is called by `/targets` and executes the production portfolios and portfolio-positions Supabase reads.
2. `useArbitrageOwnerReader` is called by `/arbitrage` and executes the production portfolios and decision-view reads.
3. `useGovernanceOwnerReader` is called by `GovernanceWidget` and executes the production portfolios and governance-target reads.
4. `useDataHealthOwnerReader` is called by `DataHealthPanel` and executes its private valuation-snapshot read.
5. `usePortfolioAggregationOwnerReader` is called by `/geo` and executes the production `loadPortfolioAggregation` path through portfolios, positions, market data and currencies.

`useOwnerIdentity` accepts an injectable auth-capable client while retaining the existing production Supabase client as its default. Each reader likewise defaults to the production client; injection is used only to run the same loader code against a deterministic local mock.

`test-owner-surface-transition.cjs` imports all five production readers and mounts each under React and SWR. For every reader it:

- authenticates A and waits until A-private output is rendered;
- changes an owner-bound filter where the product exposes one;
- starts a second real reader request for A and keeps its private-table query unresolved;
- changes the authenticated session to B without updating or unmounting the React tree;
- checks the immediate render contains no A row, A filter or A error;
- waits for B-private output;
- resolves the old A query and proves B remains rendered and A is not re-injected.

The five cases are explicit and separately named. Shared test orchestration does not replace their product loaders or ownership logic.

## Preserved controls and uncertainty

No backend payload, SQL schema or frontend Supabase shape changed. The V3 PostgreSQL migration, preflight, writers, RLS, grants, views, 27+22 and 13+16 counts, rollback controls, OrdersPanel transition proof and Production HTTP 503 guard were not altered and their complete validation remains green.

No Supabase or Vercel API/runtime was opened directly, no remote migration was applied, no Production command ran and no spend was authorized. Automatic Preview statuses produced by the branch push were observed only through GitHub's PR check rollup. Real provider schema compatibility and authenticated browser behavior remain `UNKNOWN_NOT_READ` / `NOT_RUN_NO_AUTHORIZED_NON_PRODUCTION_TARGET`.
