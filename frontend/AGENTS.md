# Frontend AGENTS (Next.js 16 + TypeScript)

Applies to `frontend/`.
Read root `AGENTS.md` first for global invariants.

## Stack and Scope

- Next.js App Router (`app/`) on Next 16.
- TypeScript strict is mandatory.
- Tailwind + Shadcn-style components.
- Frontend reads Supabase; it does not define canonical market truth.

## Type Safety Rules

- Avoid `any` unless strictly unavoidable and justified inline.
- Reuse shared domain types from `frontend/types.ts`.
- Keep Supabase response parsing explicit (`string | null`, `number | null`, etc.).
- If backend/Supabase contract changes, align `frontend/types.ts` and impacted readers in the same change.

## Component and Routing Rules

- Use `"use client"` only for components needing hooks, browser APIs, or user interactions.
- Keep server/client boundaries clear in App Router.
- Co-locate UI logic in components and parsing/data logic in `lib/` utilities.
- Preserve existing route semantics and user-facing product behavior unless task scope requires change.

## UI and State Semantics

- Always render explicit async/data states:
  - loading
  - empty
  - error
  - stale/cached/unknown when relevant
- Do not hide uncertainty with silent placeholders when business states are known.
- Keep contrast and readability aligned with existing financial UI patterns.

## Supabase Read Patterns

- Prefer narrow selectors over broad `select('*')`, unless schema probing is intentional.
- Handle query errors explicitly.
- For schema drift-sensitive reads:
  - use selector fallback ordering
  - cache working selector/probe when appropriate
  - keep business state explicit (`UNKNOWN`, `INSUFFICIENT_HISTORY`, etc.)
- Do not introduce frontend-only contract inventions that diverge from Supabase.

## Change Discipline

- Avoid broad rewrites of fetch/data layers for small backlog slices.
- Keep changes localized and production-oriented.
- Add minimal comments only where logic is non-obvious.

## Frontend Validation

Run from `frontend/`:

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run smoke:supabase
node scripts/validate-critical-flows.mjs
```

If a route/UI flow changed, run targeted runtime smoke on impacted pages and verify console errors.
