# Product Backlog - Portfolio Project

Last update: 2026-07-13

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

BL-014 — Open Equity Screener

Priority: P1
Status: IMPLEMENTED IN CODE (schema deploy + production smoke required)

Problem

Need an open, Zonebourse-style screener to explore global equities by sector/theme/country and valuation metrics, especially ESN / IT providers that may be good businesses but discounted.

Implemented
	•	Additive Supabase read model `equity_screener_results` and `equity_screener_latest`.
	•	Idempotent backend sync `scripts/sync_equity_screener.py` derived from Trident universe, annual financials, Trident scores, and stock insights.
	•	Explicit data states for unavailable forecast, valuation, FCF, currency mismatch, and missing insights.
	•	New `/screener` frontend route with ESN/value, FCF compounder, and quality-value presets.
	•	Global sample backend tests covering US, France, India, and Japan rows.
	•	Production smoke workflow for Supabase anon contract plus Vercel browser runtime.

Acceptance criteria
	•	Backend tests validate IT-services classification, value tagging, missing forecast state, and currency mismatch handling.
	•	Supabase smoke validates `equity_screener_latest`; production smoke can require non-empty rows.
	•	Frontend lint, TypeScript, build, browser smoke, and production smoke pass.

BL-015 — Equity Publications and Earnings Calendar

Priority: P1
Status: IMPLEMENTED AND BACKFILLED IN SUPABASE

Problem

Need a decision-ready view of published fundamentals and upcoming reporting dates by company and index, starting with CAC 40 and S&P 500, without a paid market-data subscription.

Implemented
	•	Additive contracts `equity_financial_interim`, `equity_reporting_events`, event revision audit, `equity_publication_dashboard_latest`, and `equity_reporting_calendar`.
	•	Backend-only idempotent `equity_publications_sync` using Yahoo Finance for best-effort interim statements/calendar and optional SEC EDGAR enrichment for official S&P 500 filing dates.
	•	Explicit `READY`, `PARTIAL`, `STALE`, and `MISSING` states; missing CAC 40 quarterly values remain null.
	•	Stable fiscal event keys, publication-date revisions, FCF derivation lineage, and complete-four-quarter gating for TTM.
	•	New `/publications` research route with shared company/index filters, dense FY/interim/valuation table, monthly calendar, pagination, mobile agenda, and on-demand history drawer.
	•	Data Health, schema smoke, refresh freshness, runtime budget, and backend/frontend regression coverage.

Acceptance criteria
	•	All active CAC 40 and S&P 500 universe rows remain visible even when interim data is unavailable.
	•	Publication period, announcement date, SEC filing date, ingestion date, and PE valuation timestamp remain distinct.
	•	No missing metric is zero-filled and no TTM is shown without four sequential comparable quarters.
	•	Daily refresh updates the 90-day calendar; weekly full refresh updates up to eight interim periods.
	•	Supabase exposes no `anon` access or authenticated writes for publication contracts.

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

Broker snapshot schema deployment is now the next blocker for the portfolio-file workflow: apply the pending additive Supabase SQL with a database URL, then run the target Excel and broker position snapshot imports with backend service-role credentials. Do not add public INSERT/UPSERT policies for `anon`.


⸻

Current Roadmap Status

Item	Status
BL-001	ACTIVE (technical completeness incomplete)
BL-008	IN_PROGRESS
BL-009	DONE


⸻

Next Action (P0)

Apply the pending Supabase schema, import the target Excel in dry-run then apply mode, import the latest Fortuneo/Linxea/IBKR position snapshots in dry-run then apply mode, then backfill technical indicators for `market_watch`.

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
- Supabase smoke reports top Trident scored symbols without historical price coverage; top-score coverage has been restored after remediation and remains a regression guard.
- Target Excel import script added for service-role backend workflows; accepted columns: `portfolio_id`, `ticker` or resolvable `isin`, `name`, `asset_class`, `currency`, `target_weight_pct`, `notes`.
- Target imports now stamp `target_source`, `target_source_file`, and `target_updated_at` while preserving `quantity_current` and `pru`.
- Broker position snapshot import added for Fortuneo `.xls`, Linxea PER `.xlsx`, IBKR PortfolioAnalyst CSV, and generic/manual canonical CSV exports; latest snapshots are persisted and consolidated into `portfolio_positions` as the official current portfolio view.
- Broker CSV import is hardened to reject public Supabase keys; broker reconciliation RLS grants remain read-only for frontend state.
- Additive SQL read model `portfolio_decision_items_latest` added for arbitration decisions.
- New `/arbitrage` route added with action, data issue, asset class and currency filters.
- `/targets` now shows target vs consolidated actual with broker source, snapshot freshness, and a Data Operations summary for target Excel and broker snapshot runs.

Deployment note:
- Apply `backend/sql/20260511_broker_transactions.sql`, `backend/sql/20260525_broker_position_snapshots.sql`, `backend/sql/20260524_trident_screener.sql`, and `backend/sql/20260525_portfolio_decision_items.sql` before expecting `/targets` broker freshness and `/arbitrage` to show decision rows.
- Run GitHub Actions `Trident Supabase Deploy Gate` with `apply_schema=true`.
- Run GitHub Actions `Trident Price Backfill` with `top_n=50`, `start_date=1999-01-01`.
- Rerun `Financial Data Sync` with `scope=trident`, `trident_mode=full`, `trident_price_start_date=1999-01-01`.

Admin CLI:
- Dry-run target: `python backend/scripts/import_target_allocations_excel.py --file target.xlsx --dry-run`
- Apply target: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python backend/scripts/import_target_allocations_excel.py --file target.xlsx --apply`
- Dry-run actual snapshot: `python backend/scripts/import_broker_positions.py --broker fortuneo|linxea|ibkr|manual --account-id ... --portfolio-id ... --positions-file positions.csv --dry-run`
- Apply actual snapshot: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python backend/scripts/import_broker_positions.py --broker ibkr --account-id ... --portfolio-id ... --positions-file positions.csv --as-of-date 2026-05-25 --apply`

## 2026-05-26 - Supports Catalogue And Two-Level Target Models

Status: IMPLEMENTED IN CODE, SCHEMA DEPLOY PENDING

Scope delivered:
- Additive SQL migration `backend/sql/20260526_supports_targets_advice.sql` adds support catalogue tables, target model tables, audit holdings, and `allocation_advice_items_latest`.
- Backend CLI `import_support_universe.py` now imports three source qualities:
  - `lucya-cardif`: complete ISIN-based catalogue with strict ISIN checksum validation.
  - `linxea-funds`: source rows without ISIN, kept as `IDENTIFIER_MISSING` for manual mapping.
  - `fortuneo-av`: partial visible source, kept as `PARTIAL_SOURCE` / `PARTIAL`.
- V2 web imports added:
  - `linxea-web`: public Linxea web tables with ISIN, stored as `PARTIAL` because public pages are not always the full contract universe.
  - `fortuneo-av-web`: official Fortuneo Vie `PERFSUPPORT` public PDF URL, stored as a complete source for the contract.
  - `source_url` is persisted on `support_sources` for web provenance.
- Additive table `support_source_rows` stores support lines that cannot safely enter `investment_supports`, so partial PDFs are visible without corrupting identifier-based matching.
- Backend CLI `import_target_model.py` imports the PERSO workbook as strategic buckets + envelope execution lines and imports the PRO workbook using `Calcul_allocation_cible` as authority.
- `/supports` added as a read-only catalogue screen with filters for type, envelope, source quality, metrics state, score, fees, SRI and performance.
- `/targets` enriched with Target Studio for PERSO/PRO strategic buckets and envelope-level execution targets.
- `/arbitrage` enriched with bucket-level allocation advice using the default flux-first policy and an execution-universe summary by envelope/source.

Deployment note:
- Apply `backend/sql/20260526_supports_targets_advice.sql` after the previously pending broker/decision migrations.
- Dry-run Lucya/Cardif supports: `python backend/scripts/import_support_universe.py --source lucya-cardif --file Liste_Supports_Lucya_Cardif_collectif_precontractuel_2026_03_16_VF_REDUIT_NB.pdf --source-date 2026-03-16 --dry-run`
- Dry-run Linxea source rows: `python backend/scripts/import_support_universe.py --source linxea-funds --file linxea-fonds.pdf --source-date 2026-05-26 --dry-run`
- Dry-run Fortuneo AV source rows: `python backend/scripts/import_support_universe.py --source fortuneo-av --file "Fortuneo AV.pdf" --source-date 2026-05-26 --dry-run`
- Dry-run Linxea web: `python backend/scripts/import_support_universe.py --source linxea-web --source-date 2026-05-26 --dry-run`
- Dry-run Fortuneo web: `python backend/scripts/import_support_universe.py --source fortuneo-av-web --source-date 2026-05-26 --dry-run`
- Apply supports: same commands with `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... --apply`.
- Dry-run targets: `python backend/scripts/import_target_model.py --kind perso --file Portefeuille_Perso_MultiEnveloppes_v4.xlsx --dry-run` and `python backend/scripts/import_target_model.py --kind pro --file Portefeuille_PRO_v3.xlsx --dry-run`
- Apply targets: same commands with `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... --apply`.

Dry-run reference on user PDFs:
- Lucya/Cardif: 2333 strict ISIN accepted, 0 rejected after checksum validation.
- Linxea funds: 576 extracted source rows, 576 `IDENTIFIER_MISSING`, PDF label says 588 results.
- Fortuneo AV: 7 ISIN rows accepted, source marked `PARTIAL`.
- Linxea web default: public labelled-fund tables accepted when ISIN is present, source marked `PARTIAL`.
- Fortuneo web default: official `PERFSUPPORT` PDF accepted as a fuller contract source.

## 2026-07-13 - Private Family Office Operating System

Status: IMPLEMENTED IN CODE AND SUPABASE SCHEMA; OWNER BOOTSTRAP AND LIVE BROKER ACCEPTANCE PENDING

Delivered:
- Magic-link authentication with an unexposed allowlist and private Next.js proxy. The PGA-004 repository candidate supports multiple isolated owner profiles; its migration/runtime activation remains unverified and unapplied.
- RLS on every public table, zero `anon` table grants, read-only owner-scoped authenticated access and backend-only writes.
- Archived legacy operational rows before resetting the old portfolio register; market/research/history data preserved.
- Canonical entities, portfolios, institutions, accounts, instruments, immutable ledger, import runs, positions, cash, reconciliations, manual assets/passives, performance, risk, IPS, decisions, order drafts, monthly closes and audit log.
- Fortuneo and IBKR transaction import with filename/hash lineage, retry-safe idempotence, duplicate protection, ISIN resolution and optional broker-position reconciliation.
- EUR valuation with dated price/FX semantics, explicit incomplete EUR cost basis, TWR/XIRR and concentration/drawdown/cash/FX metrics.
- Truthful consolidated NAV: missing components produce `NULL`; they are never treated as zero.
- Family Office Overview, Portfolios, Operations, Decisions and Administration screens, with Research retained as a separate domain.
- Frozen period-end monthly close and authenticated CSV/PDF exports; a closed report is immutable in Postgres.
- FastAPI command boundary, Dockerfile, CI contract checks, private Supabase smoke and operating runbook.

Live Supabase verification:
- 31 `fo_*` objects and 66 Family Office policies.
- 0 public tables without RLS.
- 0 table grants to `anon`.
- 0 authenticated write grants.
- 177 legacy operational rows archived.
- 979,126 historical prices and 70,460 Trident criteria preserved after reset.

Acceptance still required before financial reliance:
- Bootstrap the real owner email and complete the magic-link flow.
- Import one verified Fortuneo statement and one verified IBKR statement.
- Compare quantities, cash, PRU, NAV, monthly TWR and XIRR to broker statements using documented tolerances.
- Resolve the Supabase `402 exceed_db_size_quota` Data API restriction even though measured Postgres size is below the Free-plan database limit.
- Run authenticated desktop/mobile browser smoke after the owner session exists.
- Apply and validate the PGA-004 owner-isolation migration only in a separately authorized environment after its preflight passes; no provider application is established by the repository candidate.

Deferred scope:
- Tax lots and realized-tax reporting by PEA/PER/CTO/AV.
- Automated broker APIs and broker order transmission.
- Benchmark attribution, factor/correlation stress testing, cash planning and document vault.
- Adviser/accountant delegation and role-based sharing. Independent allowlisted owners are a separate isolation contract and do not grant cross-owner collaboration.
