# Post-deploy checklist (UI + Supabase)

## CI/order of verification
- [ ] `npm run contract-check` (frontend contract)
- [ ] `npm run smoke:supabase` (anon read smoke)
- [ ] `python backend/tools/schema_check.py --pretty --output schema-check.json` (service-role parity)
- [ ] Review CI artifacts (`schema-check-report`, `anon-supabase-smoke-report`)

## UI checks
- [ ] `/` shows explicit state badge/message (Loading/No data/Stale/Error/OK)
- [ ] `/geo` shows explicit state message and no blank map silence
- [ ] `/fx` shows explicit state + fallback note when stale/cached
- [ ] Asset drawer shows explicit technical state (`Insufficient history` when applicable)
- [ ] DataHealthPanel shows freshness state for market/valuations/news/macro and ETL runs

## Supabase checks
- [ ] `market_watch` has expected technical columns
- [ ] `etl_runs` receives rows after ETL execution
- [ ] Latest `valuation_snapshots.created_at` is recent
- [ ] No RLS/read errors in frontend console

## Build/test checks
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test:frontend`
- [ ] `python3 -m pytest -q backend/tests/test_state_helpers.py`
