# Portfolio Project

Portfolio Project is a monorepo for a portfolio intelligence product with a strict data pipeline:

`backend ETL/scripts -> Supabase -> frontend reads`

The frontend does not compute canonical market data by itself. Backend jobs populate Supabase tables, and the frontend renders typed Supabase reads.

## Product Purpose

The product provides:
- Portfolio dashboard (asset matrix, detail drawer, governance, data health)
- Geographic exposure and performance views
- FX pages with data-state handling (live/stale/cached)
- Macro and MDSS monitoring views
- Backtest and portfolio comparison flows
- Trident equity screener (backend-computed criteria, Supabase read model, frontend display)

## Monorepo Structure

- `frontend/`: Next.js app (TypeScript strict, Tailwind, Shadcn-style components)
- `backend/`: Python ETL and data sync scripts
- `backend/sql/`: SQL migrations and schema evolution scripts
- `.github/workflows/schedule.yml`: scheduled backend sync workflow
- `VERCEL_SETUP.md`: frontend deployment notes for Vercel
- `BACKLOG.md`: product backlog and delivery status

## Architecture and Data Flow

1. Backend scripts fetch/compute data (Yahoo, FRED, RSS/API, portfolio inputs).
2. Backend writes normalized records to Supabase tables (`market_watch`, `currencies`, `portfolio_positions`, `valuation_snapshots`, `etl_runs`, etc.).
3. Frontend reads Supabase (client-side) and renders typed views.

Rule: if backend contracts or Supabase-facing shapes change, update frontend readers and `frontend/types.ts` in the same change.

## Tech Stack

### Frontend
- Next.js `16.1.3`
- React `19`
- TypeScript (strict)
- Tailwind CSS
- SWR for shared fetch/revalidation in key flows
- Supabase JS client

### Backend
- Python `3.11`
- Core libs: `yfinance`, `pandas`, `numpy`, `supabase`, `feedparser`, `requests`, `scipy`, `statsmodels`
- Test framework: `pytest`

### Data Platform
- Supabase (source of truth for frontend reads)

## Environment Variables

### Frontend (`frontend/.env.local`)
Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Used by:
- app runtime (`frontend/lib/supabase.ts`)
- smoke check (`frontend/scripts/smoke-supabase.mjs`)

### Backend (shell/CI environment)
Common required for most scripts:
- `SUPABASE_URL`
- `SUPABASE_KEY` (service role key in CI)
- `SUPABASE_DB_URL` (optional; required only for GitHub Actions SQL migration application with `psql`)

Additional for specific jobs:
- `GSPREAD_SERVICE_ACCOUNT` (required by `backend/bridge.py`)
- `GSHEET_NAME` (required by `backend/bridge.py`)
- `MARKETAUX_API_KEY` (optional for `backend/news_sync.py`; script degrades if missing)
- `TRIDENT_PROVIDER` (optional, currently `csv`; no unlicensed global provider is bundled)
- `TRIDENT_UNIVERSE_CSV` (required by `backend/scripts/sync_trident_screener.py` for CSV provider)
- `TRIDENT_FINANCIALS_CSV` (required by `backend/scripts/sync_trident_screener.py` for CSV provider)
- `TRIDENT_SOURCE_LICENSE_NOTE` (optional note stored with imported universe rows)

Note: backend scripts expect env vars to be present in process environment. They do not centrally bootstrap `.env` loading.

## Local Setup

## 1) Clone and install frontend
```bash
cd frontend
npm install
```

## 2) Install backend dependencies
```bash
cd backend
python3.11 -m pip install -r requirements.txt
```

## 3) Configure environment
- Create `frontend/.env.local` with frontend Supabase vars.
- Export backend env vars in your shell before running ETL scripts.

## Running the Frontend

```bash
cd frontend
npm run dev
```

Useful scripts:
- `npm run lint`
- `npm run build`
- `npm run smoke:supabase` (requires frontend Supabase env vars)

## Running Backend ETL / Sync Flows

Run from `backend/` unless specified.

Primary sync jobs:
```bash
python3.11 bridge.py
python3.11 macro_sync.py
python3.11 news_sync.py
python3.11 historical_prices_sync.py
python3.11 scripts/sync_trident_screener.py --dry-run
```

Historical prices helper script:
```bash
python3.11 scripts/sync_historical_prices.py --dry-run
```

Backtest runner (minimum required args):
```bash
python3.11 scripts/run_backtest.py --run-name "local-test" --start-date 2020-01-01
```

## SQL Migrations

Migrations are stored in:
- `backend/sql/`

Examples:
- technical fields on `market_watch`
- `portfolio_positions` model
- `etl_runs` observability table
- historical price storage tables
- Trident screener tables/view: `backend/sql/20260524_trident_screener.sql`

Current repo does not include an automated migration runner. Apply migrations through Supabase SQL tooling/process.
The workflow `.github/workflows/trident-supabase.yml` can run validations with `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`.
It can apply additive SQL migrations only when a repository secret named `SUPABASE_DB_URL` is configured.

## Contract and Type Alignment Rule

This project is strict about cross-layer contracts:
- Backend output shape changes must be reflected in Supabase schema and frontend readers.
- Update `frontend/types.ts` when backend/Supabase-facing structures change.
- Do not merge backend schema/output changes without verifying frontend typed reads and UI states.

## Recommended Local Validation

Frontend:
```bash
cd frontend
npm run lint
npm run build
npm run smoke:supabase
node scripts/validate-critical-flows.mjs
```

Backend:
```bash
cd backend
python3.11 -m pytest -q
```

If you changed only a subset of backend logic, still run at least targeted tests plus a syntax check:
```bash
cd backend
python3.11 -m py_compile bridge.py technical_state.py etl_stats.py
```

## Deployment and Operations Notes

- Frontend deployment notes: `VERCEL_SETUP.md`
- CI schedule: `.github/workflows/schedule.yml`
  - Daily scheduled run (`0 8 * * *`, UTC)
  - Runs backend sync jobs (`bridge.py`, `macro_sync.py`, `news_sync.py`)
- Codex long-running task guidance: `docs/codex_goal_best_practices.md`

## Known Limitations / Current Roadmap Highlights

From current backlog state (`BACKLOG.md`):
- BL-008 (frontend data-fetching optimization) is in progress.
- Data health observability and technical signal completeness have recent upgrades; continue validating on live data quality and load.
- If Supabase migrations are not applied in target environments, runtime fallbacks may still degrade UX (for example missing `market_watch` technical columns or governance target column naming drift such as `target_percent` vs `target_weight_pct`).
- Trident does not ship a bundled licensed global market-data provider. The current provider abstraction ingests user-supplied CSV universe and annual financials, stores provider/license notes, and marks unavailable fields as missing instead of inventing data.

For active implementation priorities, use `BACKLOG.md` as source of truth.
