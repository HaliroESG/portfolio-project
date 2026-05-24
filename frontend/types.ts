// Dans types.ts
export type Period = '1D' | '1W' | '1M' | 'YTD';
export type GeoTimeframe = 'day' | 'month' | 'ytd';

// Data Status Enum
export type DataStatus = 'OK' | 'STALE' | 'LOW_CONFIDENCE' | 'PARTIAL';
export type AssetType = 'Stock' | 'STOCK' | 'ETF' | 'Crypto' | 'CRYPTO' | 'Cash' | 'Forex' | 'Currency';
export type TridentCriterionStatus = 'pass' | 'fail' | 'missing' | 'not_applicable';
export type TridentCategory = 'growth' | 'profitability' | 'capital' | 'health';
export type TridentOverallState = 'PASS' | 'FAIL' | 'PARTIAL' | 'NO_DATA';
// TrendState semantics:
// - NEUTRAL: rule-based neutral (indicators available but not aligned bullish/bearish)
// - UNKNOWN: indicators expected but missing/incoherent (data gap)
// - INSUFFICIENT_HISTORY: not enough lookback to compute indicators
export type TrendState = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN' | 'INSUFFICIENT_HISTORY';

export interface PerformanceData {
  value: number // Percentage
  currencyImpact: number // Percentage impact of FX
}

export interface Asset {
  id: string;
  name: string;
  ticker: string;
  price: number;
  currency: string;
  type: AssetType;
  constituents?: Record<string, number>; 
  data_status?: DataStatus;
  last_update?: string;
  pe_ratio?: number | null;
  market_cap?: number | null;
  asset_class?: string | null;
  quantity?: number | null;
  quantity_buy?: number | null;
  quantity_current?: number | null;
  pru?: number | null;
  target_weight_pct?: number | null;
  market_value_eur?: number | null;
  invested_value_eur?: number | null;
  pnl_eur?: number | null;
  pnl_pct?: number | null;
  portfolio_ids?: string[];
  portfolio_names?: string[];
  technical?: {
    ma200_value?: number | null;
    ma200_status?: 'above' | 'below' | null;
    trend_slope?: number | null;
    volatility_30d?: number | null;
    rsi_14?: number | null;
    macd_line?: number | null;
    macd_signal?: number | null;
    macd_hist?: number | null;
    momentum_20?: number | null;
    trend_state?: TrendState | null;
    trend_changed?: boolean | null;
  };
  performance: {
    day: PerformanceData;
    week: PerformanceData;
    month: PerformanceData;
    ytd: PerformanceData;
  };
}

// Garde tes autres exports (Period, CurrencyPair...)

export interface PortfolioOption {
  id: string
  name: string
}

export interface MarketRegion {
  id: string
  name: string
  code: string
  value: number // Valeur normalisée pour l'affichage (0-100)
  performance: number 
  exposure: number 
  coordinates: [number, number] 
}

export interface CountryPerformance {
  code: string
  name: string
  avgPerformance: number
  performanceDay: number
  performanceMonth: number
  performanceYtd: number
  assetCount: number
  totalExposure: number
  exposurePct: number
  coordinates: [number, number]
}

export interface CurrencyPair {
  id: string;        // ex: 'USD'
  symbol: string;    // ex: '$'
  rate_to_eur: number | null;
}

export type BacktestRole = 'target' | 'current' | 'preset' | 'baseline'
export type RebalanceFrequency =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'

export interface BacktestRun {
  id: string
  name: string
  created_at: string
  base_currency: string
  start_date: string
  end_date: string
  rebalance_freq: RebalanceFrequency
  fee_bps: number
  inflation_adjusted: boolean
  config_json: Record<string, unknown>
}

export interface BacktestPortfolio {
  run_id: string
  portfolio_key: string
  portfolio_id: string | null
  preset_key: string | null
  label: string
  role: BacktestRole
  weights_json: Record<string, number>
  start_date_effective: string | null
  created_at: string
}

export interface BacktestResult {
  run_id: string
  portfolio_key: string
  date: string
  nav: number
  drawdown: number | null
  returns_daily: number | null
}

export interface BacktestKpi {
  run_id: string
  portfolio_key: string
  cagr: number | null
  vol: number | null
  sharpe: number | null
  sortino: number | null
  max_drawdown: number | null
  calmar: number | null
  worst_year: number | null
  best_year: number | null
}

export interface CompareSelection {
  runId: string
  portfolios: { key: string; role: string }[]
}

export interface TridentScreenerRow {
  instrument_key: string
  ticker: string
  name: string | null
  exchange: string | null
  country: string | null
  sector: string | null
  industry: string | null
  currency: string | null
  provider: string
  source_license_note: string | null
  is_active: boolean
  as_of_date: string | null
  latest_fiscal_year: number | null
  overall_state: TridentOverallState | null
  score: number | null
  confidence: number | null
  growth_score: number | null
  profitability_score: number | null
  capital_score: number | null
  health_score: number | null
  latest_roic: number | null
  latest_net_debt_to_ebitda: number | null
  failed_eliminators: string[]
  horizons: Record<string, TridentHorizonSummary>
  summary: Record<string, unknown>
  updated_at: string | null
}

export interface TridentHorizonSummary {
  horizon_years: number
  start_year: number | null
  end_year: number | null
  status: 'complete' | 'partial' | 'missing'
  metrics: Record<string, number | null>
}

export interface TridentCriterionRow {
  instrument_key: string
  horizon_years: 1 | 3 | 5 | 10
  criterion_key: string
  category: TridentCategory
  label: string
  status: TridentCriterionStatus
  actual: number | null
  threshold: number | null
  comparator: string | null
  is_eliminating: boolean
  reason: string | null
  updated_at: string | null
}

// Supabase row contracts (frontend read models)
export interface NewsFeedRow {
  id: string
  url: string
  title: string
  source: string
  category?: string | null
  impact_level: string
  impact_score: number
  impact_explanation?: string | null
  ticker?: string | null
  published_at: string
}

export interface MacroIndicatorRow {
  id: string
  name: string
  value: number | null
  change_pct: number | null
  last_update?: string | null
  threshold_amber: number
  threshold_red: number
  direction: 'UP' | 'DOWN'
  pillar: string
}

export interface GovernanceTargetRow {
  id: string
  portfolio_id: string
  asset_class: string
  target_pct: number
  tolerance_band: number
}

export type BrokerTransactionSide =
  | 'BUY'
  | 'SELL'
  | 'DIVIDEND'
  | 'FEE'
  | 'TAX'
  | 'INTEREST'
  | 'TRANSFER'

export interface BrokerTransactionRow {
  id: number
  broker: string
  account_id: string
  external_txn_id: string
  idempotency_key: string
  trade_date: string
  settlement_date: string | null
  symbol: string | null
  isin: string | null
  side: BrokerTransactionSide
  quantity: number
  price: number | null
  gross_amount: number
  fees: number
  taxes: number
  net_amount: number
  currency: string
  envelope: string | null
  raw_type: string | null
  source_file: string | null
  created_at: string
  updated_at: string
}

export type BrokerReconciliationState =
  | 'MATCH'
  | 'MISMATCH_QTY'
  | 'MISMATCH_COST'
  | 'MISSING_IN_LEDGER'
  | 'LEDGER_ONLY'
  | 'NOT_CHECKED'

export type BrokerReconciliationRunStatus = 'MATCH' | 'MISMATCH' | 'NOT_CHECKED'

export interface BrokerReconciliationRunRow {
  id: string
  broker: string
  account_id: string
  reconciliation_date: string
  source_file: string | null
  positions_file: string | null
  mode: 'broker_snapshot' | 'ledger_rollup'
  status: BrokerReconciliationRunStatus
  parsed_count: number
  position_count: number
  state_counts: Record<string, number>
  report_json: Record<string, unknown>
  idempotency_key: string
  created_at: string
  updated_at: string
}

export interface BrokerReconciliationItemRow {
  id: number
  run_id: string
  instrument_key: string
  symbol: string | null
  isin: string | null
  currency: string | null
  state: BrokerReconciliationState
  ledger_quantity: number | null
  broker_quantity: number | null
  quantity_delta: number | null
  ledger_average_cost: number | null
  broker_average_cost: number | null
  transaction_count: number | null
  created_at: string
}
