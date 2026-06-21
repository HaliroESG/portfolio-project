// Dans types.ts
export type Period = '1D' | '1W' | '1M' | 'YTD';
export type GeoTimeframe = 'day' | 'month' | 'ytd';

// Data Status Enum
export type DataStatus = 'OK' | 'STALE' | 'LOW_CONFIDENCE' | 'PARTIAL';
export type AssetType = 'Stock' | 'STOCK' | 'ETF' | 'Crypto' | 'CRYPTO' | 'Cash' | 'Forex' | 'Currency';
export type TridentCriterionStatus = 'pass' | 'fail' | 'missing' | 'not_applicable';
export type TridentCategory = 'growth' | 'profitability' | 'capital' | 'health';
export type TridentOverallState = 'QUALIFIED' | 'WATCHLIST' | 'REJECTED' | 'NO_DATA';
export type EquityScreenerValuationTag = 'POTENTIAL_VALUE' | 'FAIR' | 'EXPENSIVE' | 'INSUFFICIENT_DATA';
export type PriceHistoryHorizon = 'YTD' | '5Y' | '10Y' | 'MAX';
export type PriceHistoryCurrencyMode = 'EUR' | 'LOCAL';
export type RegressionScaleMode = 'LOG' | 'LINEAR';
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
  isin?: string | null;
  target_notes?: string | null;
  target_source?: string | null;
  target_source_file?: string | null;
  target_updated_at?: string | null;
  actual_source?: string | null;
  actual_source_accounts?: BrokerPositionSourceAccount[] | null;
  actual_as_of_date?: string | null;
  actual_updated_at?: string | null;
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

export interface AssetPricePoint {
  date: string
  price_eur: number
  price_local: number | null
  local_currency: string | null
  fx_rate_to_eur: number | null
  source: string | null
  updated_at: string | null
}

export interface AssetPriceHistoryResult {
  ticker: string
  source_ticker?: string | null
  requested_tickers?: string[]
  fallback_used?: boolean
  horizon: PriceHistoryHorizon
  requested_start_date: string
  points: AssetPricePoint[]
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
  provider_symbol: string | null
  source_provider: string
  source_index: string | null
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
  criteria_pass_count: number | null
  criteria_fail_count: number | null
  criteria_missing_count: number | null
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

export interface EquityScreenerRow {
  instrument_key: string
  as_of_date: string | null
  ticker: string
  name: string | null
  exchange: string | null
  country: string | null
  sector: string | null
  industry: string | null
  currency: string | null
  provider: string
  provider_symbol: string | null
  source_index: string | null
  themes: string[]
  latest_fiscal_year: number | null
  financial_currency: string | null
  valuation_currency: string | null
  market_cap: number | null
  revenue: number | null
  free_cash_flow: number | null
  fcf_margin: number | null
  fcf_yield: number | null
  revenue_cagr_3y: number | null
  revenue_cagr_5y: number | null
  forecast_revenue_growth: number | null
  trailing_pe: number | null
  forward_pe: number | null
  latest_roic: number | null
  latest_net_debt_to_ebitda: number | null
  target_upside: number | null
  recommendation_key: string | null
  analyst_count: number | null
  trident_score: number | null
  trident_state: TridentOverallState | null
  regression_slope_pct: number | null
  regression_z_score: number | null
  ma200_state: string | null
  momentum_3m_pct: number | null
  momentum_12m_pct: number | null
  price_coverage_pct: number | null
  quality_value_score: number
  valuation_tag: EquityScreenerValuationTag
  score_details: Record<string, unknown>
  data_state: string[]
  updated_at: string | null
}

export interface TridentInsightNewsItem {
  title: string
  url: string
  source: string | null
  published_at: string | null
  impact_level: string | null
  impact_score: number | null
  ticker: string | null
}

export interface TridentStockInsightRow {
  instrument_key: string
  ticker: string
  provider_symbol: string | null
  name: string | null
  business_summary: string | null
  website: string | null
  market_cap: number | null
  trailing_pe: number | null
  forward_pe: number | null
  recommendation_key: string | null
  recommendation_mean: number | null
  target_mean_price: number | null
  target_high_price: number | null
  target_low_price: number | null
  number_of_analyst_opinions: number | null
  latest_price: number | null
  price_currency: string | null
  regression_slope_pct: number | null
  regression_z_score: number | null
  ma200_state: string | null
  momentum_3m_pct: number | null
  momentum_12m_pct: number | null
  trend_state: string | null
  trend_reason_codes: string[]
  price_history_state: string | null
  news_items: TridentInsightNewsItem[]
  ai_trend_summary: string | null
  ai_summary_state: string
  ai_model: string | null
  source_provider: string
  source_url: string | null
  data_state: string[]
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

export interface BrokerPositionSourceAccount {
  broker: string
  account_id: string | null
  envelope: string | null
  as_of_date: string | null
  quantity: number | string | null
}

export interface BrokerPositionSnapshotRunRow {
  id: string
  broker: string
  account_id: string
  portfolio_id: string
  envelope: string | null
  as_of_date: string
  source_file: string | null
  position_count: number
  idempotency_key: string
  report_json: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface BrokerPositionSnapshotItemRow {
  id: number
  run_id: string
  portfolio_id: string
  broker: string
  account_id: string
  envelope: string | null
  as_of_date: string
  symbol: string | null
  isin: string | null
  name: string | null
  currency: string | null
  quantity: number
  average_cost: number | null
  source_row: number | null
  created_at: string
}

export type PortfolioDecisionAction = 'BUY' | 'REDUCE' | 'EXIT' | 'HOLD' | 'UNAVAILABLE'
export type PortfolioDecisionDataState =
  | 'READY'
  | 'TARGET_MISSING'
  | 'TARGET_INVALID'
  | 'QUANTITY_MISSING'
  | 'PRICE_MISSING'
  | 'FX_MISSING'
export type PortfolioDecisionPriceState = 'LIVE' | 'STALE' | 'MISSING'

export interface PortfolioDecisionItemRow {
  portfolio_id: string
  ticker: string
  name: string
  asset_class: string | null
  isin: string | null
  currency: string
  current_quantity: number | null
  current_value_eur: number | null
  current_weight_pct: number | null
  target_weight_pct: number | null
  drift_pct: number | null
  rebalance_amount_eur: number | null
  action: PortfolioDecisionAction
  confidence: number
  reason_codes: string[]
  data_state: PortfolioDecisionDataState
  price_state: PortfolioDecisionPriceState
  market_data_status: string | null
  reconciliation_state: BrokerReconciliationState | null
  trident_provider_symbol: string | null
  trident_score: number | null
  trident_confidence: number | null
  history_coverage_pct: number | null
  target_total_pct: number | null
  total_value_eur: number | null
  updated_at: string | null
}

export type InvestmentSupportType =
  | 'ETF'
  | 'FUND'
  | 'FONDS_EURO'
  | 'SCPI'
  | 'SCI'
  | 'OPCI'
  | 'PRIVATE_ASSET'
  | 'UNKNOWN'
export type SupportMetricsState = 'READY' | 'PARTIAL' | 'METRICS_UNAVAILABLE'
export type SupportSourceQuality = 'COMPLETE' | 'PARTIAL' | 'IDENTIFIER_MISSING'
export type SupportIdentifierState = 'READY' | 'PARTIAL_SOURCE' | 'IDENTIFIER_MISSING' | 'INVALID_IDENTIFIER'

export interface SupportSourceRow {
  id: string
  source_name: string
  source_kind: string
  provider: string | null
  source_quality: SupportSourceQuality
  source_file: string | null
  source_url: string | null
  source_date: string | null
  report_json: Record<string, unknown>
  imported_at: string
  updated_at: string
}

export interface InvestmentSupportRow {
  source_id: string
  isin: string
  name: string
  support_type: InvestmentSupportType
  legal_form: string | null
  manager: string | null
  sri: number | null
  performance_1y_pct: number | null
  performance_5y_pct: number | null
  asset_fee_pct: number | null
  contract_fee_pct: number | null
  total_fee_pct: number | null
  retrocession_pct: number | null
  morningstar_rating: number | null
  quantalys_rating: number | null
  computed_momentum_pct: number | null
  computed_volatility_pct: number | null
  computed_drawdown_pct: number | null
  computed_beta: number | null
  computed_alpha_pct: number | null
  metrics_state: SupportMetricsState
  score: number | null
  score_details: Record<string, unknown>
  page: number | null
  raw_text: string | null
  updated_at: string
}

export interface SupportAvailabilityRow {
  source_id: string
  isin: string
  envelope: string
  available: boolean
  constraints_json: Record<string, unknown>
  updated_at: string
}

export interface SupportSourceLineRow {
  source_id: string
  external_id: string
  isin: string | null
  name: string
  support_type: InvestmentSupportType
  legal_form: string | null
  manager: string | null
  sri: number | null
  performance_1y_pct: number | null
  performance_5y_pct: number | null
  asset_fee_pct: number | null
  contract_fee_pct: number | null
  total_fee_pct: number | null
  retrocession_pct: number | null
  source_quality: SupportSourceQuality
  identifier_state: SupportIdentifierState
  envelope: string
  score: number | null
  score_details: Record<string, unknown>
  page: number | null
  raw_text: string | null
  updated_at: string
}

export type PortfolioScope = 'PERSO' | 'PRO'

export interface TargetModelRow {
  id: string
  portfolio_scope: PortfolioScope
  model_name: string
  source_file: string
  source_kind: string
  as_of_date: string | null
  is_active: boolean
  target_total_pct: number | null
  status: string
  report_json: Record<string, unknown>
  imported_at: string
  updated_at: string
}

export interface TargetBucketRow {
  id: number
  model_id: string
  portfolio_scope: PortfolioScope
  bucket_key: string
  bucket_label: string
  parent_bucket_key: string | null
  target_weight_pct: number
  lower_band_pct: number | null
  upper_band_pct: number | null
  source_sheet: string | null
  source_row: number | null
  updated_at: string
}

export interface TargetEnvelopeLineRow {
  id: number
  model_id: string
  portfolio_scope: PortfolioScope
  envelope: string
  ticker: string | null
  isin: string | null
  instrument: string | null
  asset_class: string | null
  region: string | null
  currency: string | null
  target_weight_pct: number | null
  target_value_eur: number | null
  notes: string | null
  source_sheet: string | null
  source_row: number | null
  updated_at: string
}

export type AllocationAdviceAction = 'BUY' | 'REDUCE' | 'HOLD' | 'UNAVAILABLE'
export type AllocationAdviceExecution = 'NEW_CASH_FIRST' | 'INTERNAL_ARBITRAGE' | 'MONITOR' | 'CURRENT_UNAVAILABLE'

export interface AllocationAdviceRow {
  portfolio_scope: PortfolioScope
  model_id: string
  model_name: string
  source_file: string
  bucket_key: string
  bucket_label: string
  current_value_eur: number | null
  current_weight_pct: number | null
  target_weight_pct: number | null
  drift_pct: number | null
  rebalance_amount_eur: number | null
  action: AllocationAdviceAction
  confidence: number
  reason_codes: string[]
  preferred_execution: AllocationAdviceExecution
  updated_at: string | null
}
