# Portfolio Project

Portfolio Project is a monorepo for a portfolio intelligence product with a strict data pipeline:

`backend ETL/scripts -> Supabase -> frontend reads`

The frontend does not compute canonical market data by itself. Backend jobs populate Supabase tables, and the frontend renders typed Supabase reads.

## Product Purpose

The product provides:
- Private Family Office overview (NAV, cash, performance, risk and operations inbox)
- Append-only transaction ledger, Fortuneo/IBKR imports and broker reconciliation
- Declarative assets/liabilities, TWR/XIRR, risk snapshots and immutable monthly closes
- Decision journal and authenticated draft-order/report exports
- Portfolio dashboard (asset matrix, detail drawer, governance, data health)
- Geographic exposure and performance views
- FX pages with data-state handling (live/stale/cached)
- Macro and MDSS monitoring views
- Backtest and portfolio comparison flows
- Trident equity screener (backend-computed criteria, Supabase read model, frontend display)
- Open equity screener for country/sector/theme valuation screening, including ESN / IT provider presets
- CAC 40 / S&P 500 publications table and earnings calendar with explicit free-source coverage

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
- Core libs: `yfinance`, `pandas`, `numpy`, `lxml`, `supabase`, `feedparser`, `requests`, `scipy`, `statsmodels`
- Test framework: `pytest`

### Data Platform
- Supabase (source of truth for frontend reads)

## Environment Variables

### Frontend (`frontend/.env.local`)
Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `NEXT_PUBLIC_COMMAND_API_URL`
- `NEXT_PUBLIC_FAMILY_OFFICE_ENVIRONMENT` (`production` keeps commands fail-closed with HTTP 503)

Used by:
- app runtime (`frontend/lib/supabase.ts`)
- smoke check (`frontend/scripts/smoke-supabase.mjs`)
- production smoke (`frontend/scripts/smoke-production.mjs`, with `PRODUCTION_APP_URL`)

### Backend (shell/CI environment)
Common required for most scripts:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or `SUPABASE_KEY` (backend/service role credential)
- `SUPABASE_DB_URL` (optional; required only for GitHub Actions SQL migration application with `psql`)
- `FAMILY_OFFICE_ENVIRONMENT` (`production` keeps every `/v1/*` business route on HTTP 503)

Additional for specific jobs:
- `GSPREAD_SERVICE_ACCOUNT` (required by `backend/bridge.py`)
- `GSHEET_NAME` (required by `backend/bridge.py`)
- `MARKETAUX_API_KEY` (optional for `backend/news_sync.py`; script degrades if missing)
- `TRIDENT_PROVIDER` (optional, defaults to `global_yahoo`; also supports `csv` and `portfolio_seed`)
- `TRIDENT_INDEXES` (optional comma-separated index keys for `global_yahoo`; defaults to S&P 500, EURO STOXX 50, KOSPI 200, FTSE 100, DAX, CAC 40, S&P/TSX 60, S&P/ASX 200, Hang Seng)
- `TRIDENT_PER_INDEX_LIMIT` (optional balanced cap per index for staged backfills)
- `TRIDENT_YAHOO_SLEEP_SEC` (optional throttle between Yahoo Finance statement requests)
- `TRIDENT_UNIVERSE_CSV` (required only by the CSV provider)
- `TRIDENT_FINANCIALS_CSV` (required only by the CSV provider)
- `TRIDENT_SOURCE_LICENSE_NOTE` (optional note stored with imported universe rows)
- `EQUITY_PUBLICATIONS_SLEEP_SEC` (optional Yahoo request throttle)
- `SEC_USER_AGENT` (optional contact user-agent enabling official SEC EDGAR filing enrichment)

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
python3.11 scripts/sync_trident_screener.py --dry-run --limit 25
python3.11 scripts/sync_equity_screener.py --dry-run --limit 25
python3.11 scripts/sync_equity_publications.py --mode daily
python3.11 scripts/sync_macro_regime.py --dry-run
python3.11 scripts/sync_family_office.py
```

Authenticated command API:
```bash
cd backend
uvicorn api:app --host 0.0.0.0 --port 8000
```

Owner bootstrap and the daily/monthly operating procedure are documented in `docs/family-office-operations.md`.

Production refresh orchestrator:
```bash
python3.11 scripts/run_data_refresh.py --scope all --output refresh-report.json
python3.11 scripts/check_refresh_freshness.py --scope all --output refresh-freshness-report.json
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
- Open equity screener tables/view: `backend/sql/20260528_equity_screener.sql`
- Equity publications and calendar: `backend/sql/20260727_equity_publications.sql`
- Macro strategy read models: `backend/sql/20260705_macro_strategy_pilotage.sql`
- Family Office archive, canonical register, security, truthful overview and database hygiene: `backend/sql/20260713_01_family_office_archive_reset.sql` through `backend/sql/20260713_06_remove_duplicate_news_index.sql`

Apply migrations through Supabase SQL tooling/MCP or the guarded GitHub workflow.
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
- Family Office runbook: `docs/family-office-operations.md`
- CI schedule: `.github/workflows/schedule.yml`
  - Weekday core/history/backtest run (`37 22 * * 1-5`, UTC)
  - Weekly full Trident run (`17 7 * * 0`, UTC)
  - Manual `workflow_dispatch` supports `all`, `core`, `history`, `trident`, `backtest`, and `validate`
  - Post-refresh gates run schema parity, `etl_runs` freshness, and anon Supabase smoke with Trident rows required
- Production app smoke: `.github/workflows/production-app-smoke.yml` validates Supabase anon reads and the deployed Vercel app, including `/screener`, when `PRODUCTION_APP_URL` is configured. If Vercel Deployment Protection is enabled, also set `VERCEL_PROTECTION_BYPASS` so Playwright can set the bypass cookie before loading routes.
- Codex long-running task guidance: `docs/codex_goal_best_practices.md`

## Known Limitations / Current Roadmap Highlights

From current backlog state (`BACKLOG.md`):
- BL-008 (frontend data-fetching optimization) is in progress.
- Data health observability and technical signal completeness have recent upgrades; continue validating on live data quality and load.
- If Supabase migrations are not applied in target environments, runtime fallbacks may still degrade UX (for example missing `market_watch` technical columns or governance target column naming drift such as `target_percent` vs `target_weight_pct`).
- Trident now includes an explicit `global_yahoo` provider. It seeds a broad market universe from public index constituent tables and computes criteria from annual statements fetched through `yfinance`; unavailable fields remain `missing` instead of being invented. CSV ingestion remains available for licensed/user-supplied sources.
- The open screener is derived from Trident and stock insights. Forward revenue growth remains `FORECAST_UNAVAILABLE` until a licensed consensus/fundamentals provider writes that field.

For active implementation priorities, use `BACKLOG.md` as source of truth.
