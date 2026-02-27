# Supabase Schema Parity Runbook

Goal: keep Supabase **live schema** aligned with repository migrations and detect drift early.

## Scope (PR-2A)

Critical parity targets:

1. `backend/sql/20260210_market_watch_phase2_technicals.sql`
   - `market_watch`: `macd_line`, `macd_signal`, `macd_hist`, `rsi_14`, `momentum_20`, `trend_state`, `trend_changed`
2. `backend/sql/20260216_etl_runs.sql`
   - table `etl_runs` + expected core columns (`job_name`, `status`, `started_at`, `finished_at`, `duration_sec`, `stats`, `error`, `updated_at`)

## Migration order to apply

1. `backend/sql/20260210_market_watch_phase2_technicals.sql`
2. `backend/sql/20260216_etl_runs.sql`

Optional in same change window:
- `backend/sql/20260210_portfolio_positions_phase3.sql`

## SQL checks (manual quick verification)

```sql
select n.nspname as schema_name, c.relname as object_name, c.relkind,
       case c.relkind when 'r' then 'table' when 'v' then 'view' when 'm' then 'materialized_view' else c.relkind::text end as object_type,
       c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('market_watch','etl_runs')
order by c.relname;

select table_name, ordinal_position, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('market_watch','etl_runs')
order by table_name, ordinal_position;
```

## Automated check (read-only)

Script: `backend/tools/schema_check.py`

Env vars:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (preferred)
  - fallback: `SUPABASE_KEY`

Usage:

```bash
cd backend
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
python3 tools/schema_check.py --pretty --output schema-check.json
```

Output JSON includes per table: `exists`, `missing_columns`, `errors`, `pass`.

## What to do if mismatch is detected

1. Confirm target project (`SUPABASE_URL`) is the intended instance.
2. Re-run missing migration(s) from `backend/sql/` in SQL Editor.
3. Re-run `schema_check.py` and confirm `pass: true`.
4. If object is a view (`relkind='v'`), inspect view definition and align source table/query.
5. If permissions/RLS errors appear, verify service role key usage.

## CI recommendation (non-blocking)

A non-blocking workflow job runs `backend/tools/schema_check.py` and uploads JSON artifact.
