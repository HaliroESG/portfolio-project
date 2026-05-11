# Backend AGENTS (Python ETL)

Applies to `backend/`.
Read root `AGENTS.md` first for global invariants.

## Stack and Runtime

- Python 3.11 scripts.
- Dependencies are managed in `backend/requirements.txt`.
- Backend writes to Supabase using privileged backend credentials.

## Coding Rules

- Follow PEP 8 and keep functions focused.
- Use explicit typing and validation when helpful for payload integrity.
- Keep transformations deterministic and easy to audit.
- Prefer clear small helpers over monolithic blocks.

## Supabase and Environment Rules

- Backend must use service-role style credentials (`SUPABASE_URL`, `SUPABASE_KEY` in this repo conventions).
- Never use frontend anon key patterns in backend scripts.
- Fail clearly when required env vars are missing.
- Keep upserts/updates idempotent (safe to rerun).

## Reliability and Error Handling

- Wrap external I/O and Supabase operations in `try/except`.
- Log enough context to diagnose row-level failures.
- Continue processing where safe; avoid crashing whole jobs on one bad record.
- Preserve explicit quality/status fields rather than masking uncertainty.

## Cross-Layer Contract Rules

- Any payload/schema change that affects Supabase read models must be reviewed against frontend.
- Align contract changes with `frontend/types.ts` and frontend parsers in the same delivery wave.
- Do not introduce backend contract drift from existing frontend semantics without explicit scope.

## Change Discipline

- Do not refactor ETL broadly unless required by accepted scope.
- Keep migrations and payload changes minimal, coherent, and backward-aware when possible.
- When schema may be partially deployed, prefer compatibility-safe write/read behavior.

## Backend Validation

Run from `backend/`:

```bash
python3.11 -m pytest -q
python3.11 -m py_compile bridge.py technical_state.py etl_stats.py
```

Run targeted script checks for changed jobs as needed (for example `bridge.py`, `macro_sync.py`, `news_sync.py`).
