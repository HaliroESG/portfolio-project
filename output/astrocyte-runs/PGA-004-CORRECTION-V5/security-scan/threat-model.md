# PGA-004 PR12 V5 security threat model

## Summary

Portfolio Project moves privileged Python ETL and command payloads through Supabase/PostgreSQL into a Next.js frontend. The reviewed PR changes the Family Office data contract from an effectively single-owner model to explicit owner-scoped writes, composed database relationships and RLS-backed reads. The V5-only code change adds mounted regression coverage for stale asynchronous successes and failures after an authenticated owner transition, plus a static contract assertion for both paths.

## Assets

- Confidential owner-specific portfolios, positions, valuations, governance targets, orders, transactions and reconciliation data.
- Authenticated owner identity and the invariant that a child row cannot reference another owner's parent.
- Service-role credentials used only by privileged backend or gated CI steps.
- Integrity of migration preflight, rollback and workflow authorization gates.
- Fail-closed Production command behavior.

## Trust boundaries

- Browser session to Supabase owner-scoped reads and caches.
- Owner A to owner B within one mounted browser tree while A completes late.
- Backend inputs to privileged Supabase writes.
- Existing rows to migration preflight and DDL.
- Pull-request validation to provider mutation jobs and secrets.
- HTTP callers to Production-disabled business commands.

## Attacker capabilities

- A normal authenticated owner controls its own session, filters and ordinary inputs.
- A stale A request may resolve successfully or fail after the tree transitions to B.
- Synthetic contaminated fixtures can contain NULL, unknown or cross-owner relationships.
- Pull-request code can influence tests and workflows but has no provider or Production authority.

## Security objectives

- Private reads, cache keys, results and state remain bound to the current/requested owner.
- Late A success and error outcomes never render or re-inject under B.
- Private writes require a valid explicit owner and owner-scoped identity/conflict targets.
- Constraints/RLS block cross-owner relationships and disclosure; preflight rejects contamination before migration.
- Production commands return HTTP 503 before auth or network activity.
- Secrets and mutation capabilities stay unavailable without explicit authorization.

## Assumptions and unknowns

- Provider schema, data, deployed configuration and migration lock duration are intentionally unverified.
- Local PostgreSQL 15 synthetic fixtures do not attest Production contents.
- The scan is parent-only because the task mandates a solo route.
