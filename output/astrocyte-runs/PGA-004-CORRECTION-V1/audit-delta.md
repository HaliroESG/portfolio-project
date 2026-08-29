# PGA-004-CORRECTION-V1 — Audit delta

Observed at: `2026-08-29T11:02:27Z`

## Sealed predecessor

The four upstream files were read without modification and reproduced exactly:

| File | SHA-256 |
|---|---|
| `test-plan.md` | `930db6c86d15ce4c30cf857d1cfdf03e25eaf7cfa9c4ac7480d5adf1721002c1` |
| `evidence.yaml` | `715419800efde8df3edea71c1fdc2a825266da27e773520c7fc347923f118fa0` |
| `findings.md` | `4739a4e914128af16bae44f7468d850ec0f820de53ee036a3aa3ef0e346ec224` |
| `handoff.yaml` | `0a35c6e4d43c0e84a4aedf6df3544a09a1c7ad6dbd94043f9ae52352602cc884` |

Source root: `/Users/oliviersoudee/.codex/worktrees/4525/Portfolio-Project/output/astrocyte-runs/PGA-004-ISOLATION-V1/`.

## Finding dispositions

| Upstream finding | Corrective delta | Result |
|---|---|---|
| F-001 singleton owner trigger | Removed only the singleton predicate; the unexposed active allowlist remains mandatory for every `auth.users` insert. | CLOSED_LOCAL |
| F-002 cross-owner foreign keys | Added owner-composite candidate keys and 29 owner-composite child-parent foreign keys across the canonical private graph. | CLOSED_LOCAL |
| F-003 no isolated runtime | Used a disposable PostgreSQL 15.19 cluster for exact migrations, roles, RLS, views and A/B fixtures. No Supabase/PostgREST/browser target existed. | PARTIAL: PostgreSQL PASS; runtime BLOCKED |
| F-004 configuration-dependent Production commands | Added backend middleware and frontend preflight that return HTTP 503 whenever an explicit runtime environment is Production, before auth/config/network/business logic. | CLOSED_LOCAL |
| F-005 service-layer-only A/B tests | Retained API tests and added exact PostgreSQL/RLS/constraint tests plus frontend owner-contamination and owner-scoped-cache tests. | CLOSED_LOCAL; remote browser runtime remains NOT RUN |

## Contract delta

- Backend writes: payload shapes remain owner-scoped; business commands are unavailable on all `/v1/*` routes when `FAMILY_OFFICE_ENVIRONMENT`, `APP_ENV`, `ENVIRONMENT`, or `VERCEL_ENV` resolves to Production.
- Supabase schema: one additive migration changes no business column type. It permits multiple allowlisted profiles, replaces private parent-ID foreign keys with owner-composite foreign keys, and revokes authenticated access to legacy operational tables that lack an owner identity.
- Frontend typed reads: `FamilyOfficePerformanceRow` now includes the existing `owner_user_id` database column. Every private bundle row is checked against the authenticated owner, secondary Admin/Orders reads are checked, and SWR keys are owner-specific.
- Shared reference data: market/research reference-table policies remain shared for registered owners. No second architecture or tenant abstraction was introduced.

## Explicit residual boundaries

- No Production or staging data/configuration was read or written.
- No Supabase migration was applied.
- No authenticated PostgREST or browser A/B runtime was available; that gate is `BLOCKED`, not a pass.
- The draft PR is not approved for ready or merge. An independent exact review of the final PR head is mandatory.
