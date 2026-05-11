# Product Backlog - Portfolio Project

Last update: 2026-03-07

## P0 - Data Reliability and Signal Quality

BL-001 — Explicit Technical State Semantics

Priority: P0
Status: BLOCKED (live schema)

Problem

The frontend now implements explicit technical-state semantics (NEUTRAL / UNKNOWN / INSUFFICIENT_HISTORY / NO HISTORY).
However, the live Supabase schema is missing technical indicator columns in market_watch (e.g. macd_line), which blocks full live completeness validation.

Scope
	•	Verify presence of technical columns in market_watch
	•	Apply migration if missing
	•	Re-run Supabase smoke tests
	•	Confirm technical-state completeness in dashboard and asset drawer

Implementation (already in repo)
	•	Technical-state semantics implemented in technical_state.py
	•	Frontend explicit rendering (table + drawer)
	•	No silent placeholders
	•	Compatibility with missing data handled in UI

Validation required
	•	npm run smoke:supabase
	•	Dashboard asset drawer technical-state rendering
	•	Data health panel coverage metrics

Blocking dependency

Apply migration:

backend/sql/20260210_market_watch_phase2_technicals.sql

Acceptance criteria
	•	Supabase smoke test passes
	•	Technical indicators available in market_watch
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


## P2 - Performance and Product Hardening

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
Supabase smoke	FAIL
Backend pytest	PASS
Backend syntax compile	PASS
Runtime smoke routes	PASS
Manual write tests (/targets)	NOT RUN

Blocking error:

column market_watch.macd_line does not exist


⸻

Current Roadmap Status

Item	Status
BL-001	BLOCKED (live schema drift)
BL-008	IN_PROGRESS
BL-009	DONE


⸻

Next Action (P0)

Apply or verify the following migration on the target Supabase environment:

backend/sql/20260210_market_watch_phase2_technicals.sql

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
