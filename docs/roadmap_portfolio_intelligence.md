# Portfolio Intelligence Roadmap (Fortuneo + IBKR)

Last update: 2026-05-11
Owner: Product/Engineering

## 1) Current System Assessment

The current platform already provides a strong base:
- strict pipeline `backend -> Supabase -> frontend`
- portfolio aggregation and governance fields (`pru`, quantities, targets)
- geographic and macro views
- backtest runtime + data-health semantics

Main gap to close for full portfolio management:
1. market regime & trend intelligence is still mostly indicator-level (no unified decision layer)
2. performance analytics are dashboard-centric (need investor-grade attribution/tax-lot aware metrics)
3. arbitrage/rebalancing is informational (need rule engine + broker-execution workflow)
4. broker integration is manual/indirect (no dedicated Fortuneo/IBKR ingestion contracts yet)

## 2) Target Product Capabilities

### A. Identify the market and trends
- Multi-horizon regime model (risk-on/risk-off/neutral) at:
  - global level
  - asset-class level
  - portfolio holding level
- Trend confidence score combining:
  - technicals (MACD/RSI/momentum)
  - macro factors (rates, inflation, credit, FX)
  - volatility and breadth signals
- Explainability panel: “why this signal” + data quality confidence.

### B. Calculate portfolio performance
- Time-weighted return (TWR), money-weighted return (XIRR), and benchmark-relative alpha.
- Attribution by:
  - asset
  - sector
  - geography
  - currency effect
- Risk metrics:
  - volatility, max drawdown, Sharpe/Sortino, tracking error
- Portfolio diagnostics:
  - concentration, overlap, drift vs target, cash drag.

### C. Arbitrage portfolio (invest/hold/sell)
- Rule-based rebalancing engine:
  - threshold bands (e.g. ±5%)
  - cash-first rebalancing before sell-down
  - minimum ticket / fee-aware constraints
- Recommendation actions:
  - BUY / HOLD / REDUCE / EXIT with confidence and rationale
- Execution workflow:
  - draft orders
  - pre-trade risk checks
  - post-trade reconciliation.

## 3) System Architecture (Target)

## 3.1 Layers
1. **Ingestion adapters (backend)**
   - `broker_ingest/fortuneo`
   - `broker_ingest/ibkr`
   - parse statements/exports/API payloads into canonical transaction schema
2. **Normalization + ledger (backend + Supabase)**
   - immutable transaction ledger
   - position lots + realized/unrealized P&L
3. **Analytics engines (backend)**
   - market regime service
   - performance attribution service
   - rebalancing recommendation service
4. **Read models (Supabase views/tables)**
   - optimized tables for frontend consumption
5. **Frontend intelligence UX**
   - trend cockpit
   - performance lab
   - rebalance assistant

## 3.2 Canonical Data Domains
- `transactions` (broker source of truth)
- `positions_lots`
- `positions_snapshot`
- `benchmarks_prices`
- `portfolio_perf_daily`
- `portfolio_risk_daily`
- `rebalance_recommendations`
- `execution_events`

## 3.3 Contract Principles
- no frontend-only computed canonical values
- every read model has explicit data-state (`LIVE`, `STALE`, `PARTIAL`, `UNKNOWN`)
- contract changes must be mirrored in `frontend/types.ts` in same delivery wave

## 4) Broker Strategy (Fortuneo + IBKR)

### Fortuneo
- Primary approach: statement/CSV ingestion connector
- Secondary approach: mailbox/PDF ingestion (if legally/compliantly acceptable)
- Required outputs:
  - transaction date, ISIN/ticker, quantity, gross/net, fees, taxes, currency, account envelope (PEA/CTO)

### IBKR
- Preferred: Flex Query / API export ingestion
- Normalize to canonical transaction schema with explicit mapping table
- Add idempotency key `(broker, account_id, external_txn_id)` to prevent duplicates

### Reconciliation
- Daily reconciliation between broker positions and internal computed positions
- state: `MATCH`, `MISMATCH_QTY`, `MISMATCH_COST`, `MISSING_IN_LEDGER`

## 5) Delivery Roadmap

## Phase 0 — Stabilization (2 weeks)
- unblock existing schema drift and ensure smoke stability
- lock contract-checks in CI

Exit criteria:
- supabase smoke green
- no schema-drift runtime errors on key pages

## Phase 1 — Broker Ledger Foundation (3–4 weeks)
- create canonical `transactions` + `positions_lots`
- Fortuneo CSV connector v1
- IBKR Flex connector v1
- reconciliation dashboard (basic)

Exit criteria:
- at least 95% of imported lines classified and ingested
- deterministic rerun without duplicates

## Phase 2 — Performance & Attribution (3 weeks)
- TWR/XIRR, benchmark comparison, daily attribution pipeline
- risk metrics daily materialization

Exit criteria:
- performance parity checks vs broker statement on sample portfolios
- UI exposes attribution with explicit confidence states

## Phase 3 — Market Regime Intelligence (3 weeks)
- regime model service with confidence bands
- explainability payloads + trend score panel

Exit criteria:
- regime state available at global/portfolio/asset levels
- documented methodology and calibration tests

## Phase 4 — Rebalance Assistant (4 weeks)
- policy engine (bands, cash-first, min order, fees)
- recommendation table + simulation endpoint
- pre-trade checks and post-trade reconciliation workflow

Exit criteria:
- recommendations reproducible and explainable
- simulation-to-execution drift monitored

## Phase 5 — Production Hardening (2 weeks)
- observability SLOs, alerting, data quality monitors
- security and secrets hardening
- runbooks and incident playbooks

## 6) Testing Strategy

### Backend
- unit tests for parsers, normalizers, lot accounting, returns
- integration tests on synthetic broker files
- property-based tests for idempotency and rounding tolerance

### Data/Supabase
- migration tests
- contract snapshot tests for read models
- reconciliation golden datasets

### Frontend
- typed contract tests (`frontend/types.ts` + parser checks)
- smoke pages for trend/performance/rebalance flows
- explicit state rendering tests (loading/empty/error/stale)

## 7) KPI and Success Metrics
- ingestion success rate per broker
- reconciliation match rate
- recommendation acceptance rate
- performance computation delta vs broker statement
- data freshness SLA by domain

## 8) Risks and Mitigations
- Broker format instability -> adapter versioning + schema registry
- Tax/fee complexity -> envelope-aware accounting rules
- Overfitting trend model -> out-of-sample validation and feature governance
- User trust in recommendations -> full explainability + confidence tiers
