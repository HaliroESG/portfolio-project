# Product Backlog - Portfolio Project

Last update: 2026-02-10

## P0 - Data Reliability and Signal Quality

### BL-001 - Technical indicators completeness (asset-level)
- Status: IN_PROGRESS
- Problem:
  - In asset drawer, RSI/MACD/Momentum can be missing (`--`) for multiple assets.
  - Trend column is often `NEUTRAL`, reducing actionability.
- Scope:
  - Backfill technical columns for all assets from backend sync.
  - Add explicit state for missing history (`UNKNOWN` / `INSUFFICIENT_HISTORY`) instead of silent `--`.
  - Distinguish "Neutral by rule" vs "Neutral by missing data".
- Deliverable:
  - Reliable values in table + drawer for most tracked assets.
  - Clear UX for unavailable indicators.
- Progress (2026-02-10):
  - `UNKNOWN` state added when MACD/RSI/Momentum are unavailable.
  - Drawer and table now explicitly show insufficient history instead of silent placeholders.
  - Remaining: historical backfill strategy to reduce missing values.

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

## P2 - Performance and Product Hardening

### BL-008 - Frontend data fetching optimization
- Status: TODO
- Scope:
  - Reduce duplicated polling and redundant `select('*')`.
  - Move to shared cache strategy (example: SWR/React Query).
- Deliverable:
  - Lower API load, faster route transitions, more stable UI state.

### BL-009 - Data health observability
- Status: TODO
- Scope:
  - Add data health panel: freshness, null rate, coverage.
  - Add backend run status/error tracking for ETL jobs.
- Deliverable:
  - Faster diagnosis when data is stale or missing.

## Notes

- Current technical signal stack:
  - MACD (12,26,9)
  - RSI(14) with bullish threshold 60
  - Momentum(20)
- Supabase migration available for new technical fields:
  - `backend/sql/20260210_market_watch_phase2_technicals.sql`
