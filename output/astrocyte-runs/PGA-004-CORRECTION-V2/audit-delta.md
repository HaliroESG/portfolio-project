# PGA-004-CORRECTION-V2 — audit delta

## Bound candidate

- Upstream review verdict: `FAIL`.
- Upstream `review.md`: `7fd2eb6653f0a713f74bf0214e140cade94c02be4a19b51a2068098494a51d2f`.
- Upstream `handoff.yaml`: `ff5e982c73d2f4c9f766a8140a1a0923c8b8c234fadfca220bb0afaf21233b49`.
- Required base and merge-base: `3828d6d7851958f6e832896ce908c60097f67f90`.
- Corrected code commit: `3b1d9d75cca4e8880809f047ef5313b5edb0e96c`.
- Corrected code tree: `f1055ea7745b22487e1b183be199704d377d0115`.
- PR: `#12`, still draft and not merged.

## P1-01 — legacy readers and ownership classification

All 16 tables identified by the review are private operational data. None is reclassified as shared reference data:

1. `portfolios`
2. `portfolio_positions`
3. `valuation_snapshots`
4. `governance_targets`
5. `decision_journal`
6. `target_portfolios`
7. `target_envelope_weights`
8. `broker_transactions`
9. `broker_reconciliation_runs`
10. `broker_reconciliation_items`
11. `broker_position_snapshot_runs`
12. `broker_position_snapshot_items`
13. `target_models`
14. `target_buckets`
15. `target_envelope_lines`
16. `target_model_audit_holdings`

The migration adds non-null `owner_user_id`, a direct owner-profile FK, RLS, an `auth.uid() = owner_user_id` read policy and authenticated read-only grants to each present table. Existing unowned rows are assigned only when exactly one owner profile makes attribution deterministic; otherwise the transaction aborts. Thirteen known legacy child-parent edges receive owner-composite FKs. Legacy child writes may derive ownership from their parent. Ambiguous root writes fail closed after several owners exist.

The still-active frontend readers in `/targets`, `/arbitrage`, `GovernanceWidget`, `DataHealthPanel`, `portfolioData` and the local smoke now request `owner_user_id`; `frontend/types.ts` carries the changed owner-scoped shapes. Shared market/research tables remain under the separate registered-owner reference policy.

## P1-02 — reproducible PostgreSQL proof

`backend/tests/sql/run_pga004_pg15.sh` is a repository-relative, autonomous harness. It creates and destroys exact-prefix temporary PostgreSQL clusters and databases. Its synthetic fixture contains all 16 legacy tables and all 13 known legacy child-parent edges.

The harness proves separately:

- clean canonical graph: 27 owner-composite FKs plus 22 direct owner-profile FKs;
- complete 16-table legacy graph: A/B RLS on every table, 13 legacy composite edges, 16 direct legacy owner-profile FKs, security-invoker view isolation and negative cross-owner inserts;
- guarded post-commit rollback in the single-owner state;
- contaminated canonical graph: migration failure and atomic restoration of the original index, FK and singleton guard.

No artifact calls the 49 canonical owner-related FKs “composite”. No count of 29 is claimed.

## P2 — in-place session transition and explicit failures

`useFamilyOfficeBundle` wraps each SWR result with the owner identity captured by its key and exposes data only when that identity still matches the current session. This prevents all five canonical Family Office pages from rendering the prior owner's bundle during A→B transition.

`OrdersPanel` additionally:

- filters the Supabase query by the current owner;
- clears visible rows immediately when the owner prop changes;
- suppresses late responses issued for the prior owner;
- runs the existing contamination assertion before committing rows;
- renders query failures explicitly.

Administration now renders owner-profile read failures explicitly. Owner-local command feedback and selectors are reset on identity changes in Overview, Portfolios, Operations, Decisions and Administration.

`frontend/scripts/test-owner-transition.mjs` mounts the React hook, loads A, transitions the still-mounted tree to B, and proves both immediate A removal and suppression of a delayed A response.

## Reversibility and uncertainty

The repository now includes a read-only preflight and a guarded post-commit rollback. The rollback refuses to collapse a database with more than one owner. No provider schema was inspected, no migration was applied and no runtime was opened. Therefore actual provider row counts, data types, lock duration, contamination and activation remain `UNKNOWN` until a separately authorized preflight and independent review.
