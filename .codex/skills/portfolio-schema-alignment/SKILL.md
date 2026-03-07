# portfolio-schema-alignment

Use this skill for cross-stack contract checks in Portfolio Project when schema or payload drift is suspected.

## Trigger this skill when

- SQL migration is added/modified (`backend/sql/*.sql`)
- Supabase drift is reported (missing columns, first 400 on selectors)
- Backend payload fields change (`backend/bridge.py`, ETL outputs)
- Frontend contract alignment is requested (`frontend/types.ts`, Supabase readers)
- Keywords appear: "schema drift", "missing columns", "backend -> Supabase -> frontend", "update types.ts", "compatibilité schéma"

## Inputs to inspect first

- `AGENTS.md`, `frontend/AGENTS.md`, `backend/AGENTS.md`
- `BACKLOG.md` (scope + acceptance)
- `backend/sql/*` migration(s) in scope
- Backend writers in scope (typically `backend/bridge.py`, `backend/technical_state.py`)
- Frontend readers in scope (typically `frontend/lib/portfolioData.ts`, route/components using those reads)
- `frontend/types.ts`

## Workflow

1. Restate contract path and expected impacted tables/fields.
2. Compare migration columns vs backend written payload keys vs frontend selected/read keys.
3. Classify each mismatch as:
   - confirmed drift,
   - backward-compatible difference,
   - inferred risk (needs live verification).
4. Propose the smallest safe correction preserving business semantics and explicit data states.
5. Prefer schema-aware read fallback over broad rewrites when live schema is partially deployed.
6. If contract changed, update `frontend/types.ts` in same slice.
7. Re-run targeted checks (minimum):
   - frontend: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run smoke:supabase` (if relevant)
   - backend: `python3.11 -m pytest -q` (or targeted tests)

## Output format (mandatory)

Return a concise contract report with:

- `Done`
- `Remaining`
- `Blocked`

Include a PASS/FAIL/NOT RUN/BLOCKED table for executed checks.
Do not mark contract alignment done without evidence.
