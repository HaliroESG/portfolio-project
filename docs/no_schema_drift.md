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
- Commands:
  - `npm ci` (frontend)
  - `npm run contract-check` (blocking gate)

### Schema parity check (two rollout versions)

#### Version A — non-bloquant (Week 1)
- Workflow: `.github/workflows/schedule.yml` → `schema-parity-check`
- `continue-on-error: true`
- Runs only when secrets are present (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`)
- If secrets missing: **skip propre** (no failure)
- Uploads artifact: `schema-check-report`

#### Version B — bloquant (Week 2 on main)
- Same workflow, job: `schema-parity-check-enforced`
- Enabled via repo variable: `SCHEMA_CHECK_ENFORCE=true`
- Runs on `main`
- Blocking when executed (no `continue-on-error`)
- If secrets missing: **skip propre** (no failure)
- Uploads artifact: `schema-check-report-enforced`

## Policy
- No silent fallback-only schema changes.
- Prefer explicit data states (`UNKNOWN`, `INSUFFICIENT_HISTORY`) over hidden null behavior.
- If schema changes: migration + types + contract checks are mandatory in same PR window.
