# No Schema Drift Rule (Frontend ↔ Supabase)

If a PR changes backend payload/schema or Supabase migration:

## Mandatory checklist
- [ ] Migration file added/applied (`backend/sql/...`) when schema changes
- [ ] `frontend/types.ts` updated to match read model
- [ ] Frontend projections updated (no `select('*')`)
- [ ] Contract check passes: `npm run contract-check`
- [ ] Build + lint pass

## Policy
- No silent fallback-only schema changes.
- Prefer explicit data states (`UNKNOWN`, `INSUFFICIENT_HISTORY`) over hidden null behavior.
