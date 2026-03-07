# portfolio-validation-matrix

Use this skill to produce sign-off-grade validation for roadmap waves in Portfolio Project.

## Trigger this skill when

- User asks for "validation wave", "readiness check", "sign-off", "smoke tests"
- PASS/FAIL/NOT RUN/BLOCKED reporting is explicitly required
- A backlog item status needs proof before moving to DONE

## Inputs to inspect first

- `AGENTS.md`, `frontend/AGENTS.md`, `backend/AGENTS.md`
- `BACKLOG.md` acceptance criteria for targeted items
- `README.md` validation commands
- Relevant changed files/routes for the current wave

## Standard validation matrix

Run the strongest feasible checks and classify honestly:

- Frontend type/build:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`
- Frontend data smoke:
  - `npm run smoke:supabase`
  - `node scripts/validate-critical-flows.mjs`
- Backend:
  - `python3.11 -m pytest -q`
  - targeted `python3.11 -m py_compile ...` when relevant
- Runtime critical routes (when requested):
  - `/`, `/fx`, `/geo`, `/targets`, `/mdss` (+ other scoped routes)

## Workflow

1. Build matrix from requested scope + backlog acceptance criteria.
2. Execute checks in priority order (fast static checks first, then smoke/runtime).
3. Capture short proof per check (key output line/error).
4. If blocked, state exact blocker and dependency (for example missing migration on target Supabase).
5. Do not declare DONE without test evidence.

## Output format (mandatory)

Return:

- `Done`
- `Remaining`
- `Risks / Notes`

Plus a table: `PASS | FAIL | NOT RUN | BLOCKED` with one short proof line per item.
