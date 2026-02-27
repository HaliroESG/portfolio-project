# No Schema Drift Rule (Frontend ↔ Supabase)

If a PR changes backend payload/schema or Supabase migration:

## Mandatory checklist
- [ ] Migration file added/applied (`backend/sql/...`) when schema changes
- [ ] `frontend/types.ts` updated to match read model
- [ ] Frontend projections updated (no `select('*')`)
- [ ] Contract check passes: `npm run contract-check`
- [ ] Build + lint pass

## CI policy

### Frontend contract check (blocking)
- Workflow: `.github/workflows/ci.yml`
- Trigger: `pull_request` + `push` on `main`
- Gate: `npm run contract-check`

### Schema parity check (progressive rollout)

#### Week 1 (observe-only)
- Workflow: `.github/workflows/schedule.yml` → `schema-parity-check`
- `continue-on-error: true`
- Publishes JSON artifact (`schema-check-report`)
- Goal: collect drift data without blocking deploys

#### Week 2 (enforced on main)
- Same workflow, job: `schema-parity-check-enforced`
- Activated by repository variable: `SCHEMA_CHECK_ENFORCE=true`
- Blocking on `main` (no `continue-on-error`)
- Fails fast with clear message when required secrets are missing:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY` (mapped to `SUPABASE_SERVICE_ROLE_KEY` in job env)

## Policy
- No silent fallback-only schema changes.
- Prefer explicit data states (`UNKNOWN`, `INSUFFICIENT_HISTORY`) over hidden null behavior.
- If schema changes: migration + types + contract checks are mandatory in same PR window.
