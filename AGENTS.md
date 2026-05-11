# Portfolio Project - Global AGENTS

This file defines monorepo-wide invariants.
Directory-specific rules live in:
- `frontend/AGENTS.md`
- `backend/AGENTS.md`

## Monorepo and Data Flow

- Structure:
  - `backend/` = Python ETL/sync scripts
  - `frontend/` = Next.js 16 + TypeScript strict UI
- Architecture is strict and must stay explicit:
  - `backend -> Supabase -> frontend`
- Supabase is the source of truth for frontend runtime reads.

## Contract and Type Alignment (Mandatory)

- Any backend payload, SQL schema, or Supabase-facing shape change must be reviewed against frontend readers.
- If a backend/Supabase contract changes, update `frontend/types.ts` in the same change set.
- Do not merge partial contract updates (backend-only or frontend-only drift).

## Delivery and Change Discipline

- Before coding, state expected impact on:
  - backend writes
  - Supabase schema/data
  - frontend typed reads and UI states
- Keep edits minimal and coherent. Avoid broad rewrites unless unavoidable.
- Keep uncertainty explicit (no silent fallback that hides business state).
- Use `BACKLOG.md` as product source of truth for scope and acceptance.

## Validation Policy

- Prefer acceptance-criteria-driven validation over assumptions.
- Minimum checks before concluding a task:
  - Frontend (from `frontend/`):
    - `npm run lint`
    - `npx tsc --noEmit`
    - `npm run build`
    - `npm run smoke:supabase` (when Supabase reads/contracts are involved)
  - Backend (from `backend/`):
    - `python3.11 -m pytest -q`
    - targeted syntax/import check when needed (`python3.11 -m py_compile ...`)
- Report results honestly as `PASS` / `FAIL` / `NOT RUN` / `BLOCKED`.

## Instruction Sources

- Primary instruction layer for Codex is AGENTS hierarchy (`/AGENTS.md`, `/frontend/AGENTS.md`, `/backend/AGENTS.md`).
- Legacy `.mdc` files under `.cursor/rules/` are secondary reference docs, not the primary instruction source.
