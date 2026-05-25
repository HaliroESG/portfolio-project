# Product Backlog - Portfolio Project

Last update: 2026-05-25

## P0 - Data Reliability and Signal Quality

BL-001 — Explicit Technical State Semantics

Priority: P0
Status: ACTIVE (schema verified, signal completeness incomplete)

Problem

The frontend implements explicit technical-state semantics (NEUTRAL / UNKNOWN / INSUFFICIENT_HISTORY / NO HISTORY).
The live Supabase schema now exposes the technical indicator columns in `market_watch`, but the latest smoke sample still has null RSI/MACD/momentum values and Data Health reports technical coverage at 0/39.

Scope
	•	Verify presence of technical columns in market_watch
	•	Apply migration only if a target environment is still missing the columns
	•	Re-run Supabase smoke tests
	•	Confirm technical-state completeness/backfill in dashboard and asset drawer

Implementation (already in repo)
	•	Technical-state semantics implemented in technical_state.py
	•	Frontend explicit rendering (table + drawer)
	•	No silent placeholders
	•	Compatibility with missing data handled in UI

Validation required
	•	npm run smoke:supabase
	•	Dashboard asset drawer technical-state rendering
	•	Data health panel coverage metrics

Current dependency

Backfill or repair technical indicator generation for `market_watch`; the schema migration is no longer the observed blocker on the current environment.

Acceptance criteria
	•	Supabase smoke test passes
	•	Technical indicators available and populated in market_watch
	•	Frontend technical-state semantics render correctly
	•	No runtime 400 errors on technical selectors


### BL-002 - FX page data pipeline consistency
- Status: DONE (phase 1)
- Problem:
  - FX page can show "No currency data available" while currencies widget has values.
- Scope:
  - Validate `currencies` table refresh and read logic on `/currencies`.
  - Add fallback to last known values.
  - Add data freshness badge/state on FX page.
- Deliverable:
  - FX page always explains data state and avoids empty unexplained screen.
- Implemented:
  - `/fx` now has data-state badge (`Live` / `Stale` / `Cached` / `No feed`).
  - fallback to inferred market-watch FX rates + local cached snapshot.
  - explicit market note when running from cache.

### BL-003 - Single source of truth (remove mock/runtime divergence)
- Status: DONE (dashboard scope)
- Problem:
  - Some areas can diverge between mock data and Supabase-backed data.
- Scope:
  - Ensure production routes use Supabase data only.
  - Keep mock data only for local demo/dev fallback.
- Deliverable:
  - Coherent values across dashboard, map, and detail panels.
- Implemented:
  - Dashboard map now uses aggregated Supabase data.
  - Dashboard currencies widget now reads live Supabase feed (no mock injection).

## P1 - Portfolio Model and Governance

### BL-004 - Portfolio definition (positions and target)
- Status: DONE (phase 1)
- User need:
  - Define portfolio composition with:
    - instrument (ETF/value)
    - PRU (average cost)
    - quantity at buy / current quantity
    - target portfolio allocation
- Scope:
  - Add or validate data model for positions and target allocations.
  - Expose these fields in UI (portfolio matrix + governance views).
- Deliverable:
  - Portfolio can be read as investment book, not only market snapshot.
- Implemented:
  - Added model support for `PRU`, `quantity_buy`, `quantity_current`, `target_weight_pct`.
  - Added dedicated “Portfolio Definition” block in asset drawer.
  - Added migration: `backend/sql/20260210_portfolio_positions_phase3.sql`.

### BL-005 - Multi-portfolio aggregation
- Status: DONE (phase 1)
- User need:
  - Aggregate multiple portfolios containing same or different instruments.
- Scope:
  - Add `portfolio_id` aware aggregation and filters (single/all portfolios).
  - Correctly merge duplicated tickers across portfolios (weighted metrics).
- Deliverable:
  - Unified consolidated view + drilldown per portfolio.
- Implemented:
  - Portfolio selector on dashboard and geographic page (`All + per portfolio`).
  - Consolidation logic for duplicated tickers across portfolios (quantities + PRU/target weighted).
  - Backend sync now upserts `portfolio_positions` when schema is present.

## P1 - Geographic Allocation and Performance

### BL-006 - Geographic allocation by real portfolio weights
- Status: DONE
- User need:
  - Map must represent geographic allocation in portfolio weight (intention initiale).
- Scope:
  - Compute country exposure using position value weights.
  - Normalize and display real `% weight` on map and side panel.
- Deliverable:
  - Map is a true allocation tool, not only ticker-origin proxy.
- Implemented:
  - Geographic exposure now computed from position value weights and geo coverage.
  - Side panel now displays real country weight percentages.

### BL-007 - Map performance timeframe selector (Daily/Monthly/YTD)
- Status: DONE
- User need:
  - View map performance by daily, monthly, and YTD.
- Scope:
  - Add timeframe switch on map page.
  - Render performance in bubbles/tooltip/legend per country.
  - Keep color scale and legends consistent by selected timeframe.
- Deliverable:
  - Geographic performance can be analyzed by horizon in one view.
- Implemented:
  - Added timeframe selector (`Daily`, `Monthly`, `YTD`) on `/geo`.
  - Map and side panel values are recalculated by selected horizon.
  - Added bubble overlay to visualize exposure + timeframe performance.

BL-008 — Frontend Data Fetch Optimization

Priority: P1
Status: IN_PROGRESS

Problem

Certain frontend reads triggered redundant Supabase queries and fallback selector retries under schema drift.

Scope

Reduce redundant queries and stabilize selector fallbacks.

Implemented
	•	FX page narrowed market_watch read fields
	•	Selector fallback helper introduced
	•	Selector cache added
	•	Shared fetcher optimization in portfolioData.ts
	•	Technical selector probe caching in DataHealthPanel

Impact
	•	Reduced Supabase read failures
	•	Reduced repeated fallback queries
	•	Improved runtime stability under schema drift

Remaining

Optional improvement:
	•	eliminate first-attempt fallback 400s on portfolio/data-health selectors

Acceptance criteria
	•	No redundant fallback queries during repeated reads
	•	Stable FX / dashboard / geo loads
	•	No user-visible errors under schema drift

BL-009 — ETL Health Observability (Phase 2)

Priority: P1
Status: DONE

Problem

ETL health previously exposed raw metrics without actionable interpretation.

Scope

Expose explicit ETL quality classification and historical trends.

Implemented
	•	Threshold-based ETL status classification
	•	Historical ETL quality trend extraction
	•	DataHealthPanel UI integration
	•	Compatibility with canonical and legacy stats payloads

Behavior

Each ETL job now classified as:

OK
WARNING
CRITICAL
UNKNOWN

Trend direction derived from etl_runs history.

Validation
	•	DataHealthPanel displays ETL status badges
	•	Trend sparkline renders correctly
	•	Legacy stats payload compatibility maintained

BL-010 — Trident Global Equity Screener

Priority: P1
Status: IMPLEMENTED (global provider + deploy validation required)

Problem

Need a backend-computed global equity screener based on the Trident method without frontend-only business logic or invented financial data.

Scope
	•	Add Supabase contracts for equity universe, annual financials, Trident results, and per-criterion status.
	•	Add idempotent Python ETL with provider abstraction.
	•	Render dense `/trident` screener with search, filters, sorting, and criterion/horizon detail.
	•	Keep pass/fail/missing/not_applicable explicit.

Implementation
	•	Migration: `backend/sql/20260524_trident_screener.sql`
	•	ETL: `backend/scripts/sync_trident_screener.py`
	•	Frontend route: `frontend/app/trident/page.tsx`
	•	Runtime reader: `frontend/lib/tridentData.ts`

Provider note

Default provider is now `global_yahoo`: it seeds a broad world equity universe from public index constituent tables (S&P 500, EURO STOXX 50, KOSPI 200, FTSE 100, DAX, CAC 40, S&P/TSX 60, S&P/ASX 200, Hang Seng) and pulls annual financial statements via `yfinance`. CSV ingestion remains available for licensed/user-supplied sources. Missing provider fields remain missing.

Acceptance criteria
	•	Backend tests cover complete data, partial data, Trident pass, ROIC eliminator fail, and debt fail.
	•	Supabase smoke validates Trident tables/view after migration.
	•	Frontend build and TypeScript compile pass.


## P2 - Performance and Product Hardening

BL-011 — Trident DOM Scalability

Priority: P1
Status: IMPLEMENTED (pagination)

Problem

`/trident` contains 1270 screener rows. Rendering all rows and mobile cards at once creates a heavy DOM and makes mobile interaction sluggish.

Implemented
	•	Local pagination with default page size 100
	•	Existing filters, sorting, row selection, and detail panel preserved
	•	Runtime DOM marker added for browser budget checks
	•	Regression chart lazy-loaded in the detail panel

Acceptance criteria
	•	Trident renders a bounded row DOM instead of the full universe
	•	Sorting and filters reset to the first page
	•	Selected row detail remains stable after sorting/filtering

BL-012 — Portfolio Drift Workflow

Priority: P1
Status: IMPLEMENTED (read-only UI + backend update workflow)

Problem

Targets showed target weights but did not expose current allocation drift, rebalance amount, or mobile-friendly review.

Implemented
	•	`/targets` renamed around Portfolio Drift semantics
	•	Current value, current weight, target weight, drift, and rebalance amount displayed
	•	Mobile card layout replaces the overflowing table
	•	Backend/service-role script added for target allocation updates

Acceptance criteria
	•	Frontend remains read-only
	•	No public write path is added
	•	Mobile width 390px has no horizontal overflow

BL-013 — Runtime QA and CI Guardrails

Priority: P2
Status: IMPLEMENTED (static budgets + browser smoke workflow)

Problem

Build and type checks passed, but runtime regressions like mobile overflow, framework overlays, and excessive Trident DOM could still slip through.

Implemented
	•	`npm run perf:budget`
	•	`npm run smoke:browser`
	•	GitHub Actions workflow `Frontend Runtime Smoke`
	•	Ops playbook updated for data incidents and Vercel failures

Acceptance criteria
	•	CI catches overlay, blank page, horizontal overflow, and Trident row DOM budget failures when Supabase runtime secrets are available
	•	Static budgets run even when browser smoke is skipped

## Notes

- Current technical signal stack:
  - MACD (12,26,9)
  - RSI(14) with bullish threshold 60
  - Momentum(20)
- Supabase migration available for new technical fields:
  - `backend/sql/20260210_market_watch_phase2_technicals.sql`

Documentation Alignment

README

Status: DONE

Root README rewritten to document:
	•	architecture flow
	•	operational validation commands
	•	roadmap wave state
	•	runtime validation checklist

Stack documentation mismatch

Observed:

AGENTS.md / docs mention Next.js 14
Actual runtime: Next.js 16.1.3

Action

Update documentation to avoid stack drift.

Status: DONE (2026-03-07)

⸻

Validation Matrix (Latest Run)

Check	Status
Frontend lint	PASS
TypeScript compile	PASS
Frontend build	PASS
Critical flow validator	PASS
Supabase smoke	PASS
Backend pytest	PASS
Backend syntax compile	PASS
Runtime smoke routes	PASS
Manual write tests (/targets)	NOT RUN

Current blocking issue:

`historical_prices_trident_sync` latest ETL run fails with a row-level security write error on `historical_prices`. The fix must keep writes on backend secret/service credentials and must not add public INSERT/UPSERT policies for `anon`.


⸻

Current Roadmap Status

Item	Status
BL-001	BLOCKED (live schema drift)
BL-008	IN_PROGRESS
BL-009	DONE


⸻

Next Action (P0)

Verify the scheduler/backend secret used for Trident historical price sync, rerun the sync, then backfill technical indicators for `market_watch`.

Then re-run:

npm run smoke:supabase
npm run build
node scripts/validate-critical-flows.mjs

Followed by runtime smoke on:

/dashboard
/fx
/geo
/targets
asset drawer
data health panel


⸻


## P0/P1 - New Strategic Wave (2026-05-11)

### BL-010 - Broker ledger foundation (Fortuneo + IBKR)
- Priority: P0
- Status: TODO
- Scope:
  - canonical transaction schema in Supabase
  - Fortuneo CSV ingestion v1
  - IBKR Flex/API export ingestion v1
  - daily reconciliation states (`MATCH`, `MISMATCH_QTY`, `MISMATCH_COST`, `MISSING_IN_LEDGER`)

### BL-011 - Portfolio performance analytics upgrade
- Priority: P1
- Status: TODO
- Scope:
  - TWR / XIRR / benchmark-relative metrics
  - attribution (asset/sector/geo/currency)
  - risk metrics materialization (volatility, drawdown, Sharpe/Sortino)

### BL-012 - Rebalance & arbitration assistant
- Priority: P1
- Status: TODO
- Scope:
  - rule engine (bands, cash-first, min ticket, fee-aware)
  - recommendation states (`BUY`, `HOLD`, `REDUCE`, `EXIT`)
  - simulation and post-trade reconciliation

Reference architecture and full roadmap: `docs/roadmap_portfolio_intelligence.md`.

## 2026-05-25 - Portfolio File Workflow And Arbitrage MVP

Status: IMPLEMENTED IN CODE, SCHEMA DEPLOY PENDING

Scope delivered:
- Trident regression now supports `provider_symbol` as an explicit frontend contract and falls back from `ticker` to `provider_symbol` for historical price reads.
- Supabase smoke reports top Trident scored symbols without historical price coverage; current live check still reports 19/20 missing because `historical_prices_trident_sync` remains failed.
- Target Excel import script added for service-role backend workflows; accepted columns: `portfolio_id`, `ticker` or resolvable `isin`, `name`, `asset_class`, `currency`, `target_weight_pct`, `notes`.
- Broker CSV import is hardened to reject public Supabase keys; broker reconciliation RLS grants remain read-only for frontend state.
- Additive SQL read model `portfolio_decision_items_latest` added for arbitration decisions.
- New `/arbitrage` route added with action, data issue, asset class and currency filters.

Deployment note:
- Apply `backend/sql/20260511_broker_transactions.sql`, `backend/sql/20260524_trident_screener.sql`, and `backend/sql/20260525_portfolio_decision_items.sql` before expecting `/arbitrage` to show decision rows.
- Rerun `historical_prices_trident_sync` with backend service-role credentials after schema deployment.
