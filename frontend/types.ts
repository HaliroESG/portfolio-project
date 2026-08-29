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
  market_cap_usd: number | null
  market_cap_fx_rate: number | null
  market_cap_fx_as_of: string | null
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

export type EquityPublicationDataState = 'READY' | 'PARTIAL' | 'STALE' | 'MISSING'
export type EquityReportingEventType = 'EARNINGS' | 'REGULATORY_FILING'
export type EquityReportingEventStatus = 'ESTIMATED' | 'CONFIRMED' | 'REPORTED' | 'CANCELLED'
export type EquityReportingMatchConfidence = 'HIGH' | 'INFERRED' | 'UNKNOWN'
export type EquityReportingPeriodKind =
  | 'Q1'
  | 'Q2'
  | 'Q3'
  | 'Q4'
  | 'H1'
  | 'H2'
  | 'FY'
  | 'INTERIM'

export interface EquityPublicationDashboardRow {
  instrument_key: string
  ticker: string
  name: string | null
  exchange: string | null
  country: string | null
  sector: string | null
  industry: string | null
  company_currency: string | null
  provider_symbol: string
  source_index: string
  annual_fiscal_year: number | null
  annual_period_end: string | null
  annual_currency: string | null
  annual_revenue: number | null
  annual_ebitda: number | null
  annual_operating_income: number | null
  annual_net_income: number | null
  annual_eps_diluted: number | null
  annual_free_cash_flow: number | null
  annual_published_on: string | null
  interim_fiscal_year: number | null
  interim_period_kind: EquityReportingPeriodKind | null
  interim_period_end: string | null
  interim_currency: string | null
  interim_revenue: number | null
  interim_ebitda: number | null
  interim_operating_income: number | null
  interim_net_income: number | null
  interim_eps_diluted: number | null
  interim_free_cash_flow: number | null
  interim_data_state: EquityPublicationDataState | null
  interim_reason_codes: string[]
  interim_published_on: string | null
  ttm_currency: string | null
  ttm_period_end: string | null
  ttm_revenue: number | null
  ttm_ebitda: number | null
  ttm_operating_income: number | null
  ttm_net_income: number | null
  ttm_free_cash_flow: number | null
  ttm_complete: boolean
  trailing_pe: number | null
  forward_pe: number | null
  valuation_as_of: string | null
  last_event_type: EquityReportingEventType | null
  last_event_label: string | null
  last_event_date: string | null
  last_event_status: EquityReportingEventStatus | null
  last_event_source_provider: string | null
  last_event_source_url: string | null
  next_event_type: EquityReportingEventType | null
  next_event_label: string | null
  next_event_date: string | null
  next_event_time_utc: string | null
  next_event_status: EquityReportingEventStatus | null
  next_event_source_provider: string | null
  next_event_source_url: string | null
  data_state: EquityPublicationDataState
  reason_codes: string[]
  updated_at: string | null
}

export interface EquityReportingEventRow {
  event_key: string
  instrument_key: string
  ticker: string
  name: string | null
  provider_symbol: string
  source_index: string
  currency: string | null
  event_type: EquityReportingEventType
  event_label: string | null
  event_date: string
  event_time_utc: string | null
  status: EquityReportingEventStatus
  fiscal_year: number | null
  fiscal_period_end: string | null
  period_kind: EquityReportingPeriodKind | null
  filing_date: string | null
  match_confidence: EquityReportingMatchConfidence
  source_provider: string
  source_url: string | null
  metadata: Record<string, unknown>
  first_seen_at: string | null
  last_seen_at: string | null
  updated_at: string | null
}

export interface EquityInterimFinancialRow {
  instrument_key: string
  fiscal_period_end: string
  fiscal_year: number
  period_kind: Exclude<EquityReportingPeriodKind, 'FY'>
  period_months: number | null
  currency: string | null
  revenue: number | null
  ebitda: number | null
  operating_income: number | null
  net_income: number | null
  eps_diluted: number | null
  operating_cash_flow: number | null
  capital_expenditure: number | null
  free_cash_flow: number | null
  data_state: EquityPublicationDataState
  reason_codes: string[]
  source_provider: string
  source_url: string | null
  collected_at: string | null
  updated_at: string | null
}

export interface EquityAnnualFinancialRow {
  instrument_key: string
  fiscal_year: number
  fiscal_period_end: string | null
  currency: string | null
  revenue: number | null
  ebitda: number | null
  operating_income: number | null
  net_income: number | null
  eps_diluted: number | null
  free_cash_flow: number | null
  provider: string
  source_url: string | null
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

export type MacroSeriesDataState = 'READY' | 'PARTIAL' | 'STALE' | 'UNKNOWN' | 'MISSING'
export type MacroRegime = 'REFLATION' | 'GOLDILOCKS' | 'STAGFLATION' | 'DEFLATION' | 'UNKNOWN'
export type MacroRegimeState = 'READY' | 'PARTIAL' | 'STALE' | 'UNKNOWN'
export type MacroSignalDirection = 'UP' | 'DOWN' | 'UNKNOWN'
export type MacroLiquiditySignal = 'LOOSE' | 'NEUTRAL' | 'TIGHT' | 'UNKNOWN'
export type MacroSatelliteTargetState =
  | 'READY'
  | 'BLOCKED_TREND'
  | 'TREND_UNKNOWN'
  | 'REGIME_UNKNOWN'
  | 'REGIME_PARTIAL'
  | 'UNKNOWN'
export type MacroRecommendedEnvelope = 'CTO' | 'PEA' | 'PER' | 'CASH'
export type MacroAllocationAction = 'BUY' | 'REDUCE' | 'HOLD' | 'UNAVAILABLE'

export interface MacroSeriesLatestRow {
  series_id: string
  as_of_date: string
  name: string
  value: number | null
  previous_value: number | null
  change_abs: number | null
  change_pct: number | null
  frequency: string
  source_provider: string
  source_url: string | null
  data_state: MacroSeriesDataState
  reason_codes: string[]
  collected_at: string | null
  updated_at: string | null
}

export interface MacroRegimeSnapshotRow {
  id: string
  as_of_date: string
  regime: MacroRegime
  regime_state: MacroRegimeState
  confidence: number
  growth_signal: MacroSignalDirection
  inflation_signal: MacroSignalDirection
  liquidity_signal: MacroLiquiditySignal
  growth_score: number | null
  inflation_score: number | null
  liquidity_score: number | null
  evidence: Record<string, unknown>
  reason_codes: string[]
  created_at: string | null
  updated_at: string | null
}

export interface MacroSatelliteTargetRow {
  id: string
  snapshot_id: string
  as_of_date: string
  regime: MacroRegime
  regime_state: MacroRegimeState
  regime_confidence: number
  bucket_key: string
  bucket_label: string
  instrument_symbol: string | null
  instrument_name: string | null
  target_weight_pct: number
  effective_weight_pct: number
  satellite_weight_pct: number
  recommended_envelope: MacroRecommendedEnvelope
  trend_ticker: string | null
  trend_state: string
  ma200_status: 'above' | 'below' | null
  data_state: MacroSatelliteTargetState
  is_blocked: boolean
  reason_codes: string[]
  updated_at: string | null
}

export interface MacroAllocationAdviceRow {
  portfolio_id: string
  snapshot_id: string
  as_of_date: string
  regime: MacroRegime
  regime_state: MacroRegimeState
  bucket_key: string
  bucket_label: string
  instrument_symbol: string | null
  instrument_name: string | null
  recommended_envelope: MacroRecommendedEnvelope
  model_target_weight_pct: number
  target_weight_pct: number
  current_value_eur: number | null
  current_weight_pct: number | null
  drift_pct: number | null
  rebalance_amount_eur: number | null
  action: MacroAllocationAction
  confidence: number
  data_state: MacroSatelliteTargetState
  reason_codes: string[]
  trend_ticker: string | null
  trend_state: string
  ma200_status: 'above' | 'below' | null
  is_blocked: boolean
  total_value_eur: number | null
  updated_at: string | null
}

export interface GovernanceTargetRow {
  id: string
  owner_user_id: string
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
  owner_user_id: string
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
  owner_user_id: string
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
  owner_user_id: string
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
  owner_user_id: string
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
  owner_user_id: string
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
  owner_user_id: string
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

export type FamilyOfficeDataState = 'READY' | 'PARTIAL' | 'STALE' | 'MISSING' | 'UNRECONCILED'
export type FamilyOfficeEnvelope = 'PEA' | 'CTO' | 'PER' | 'AV' | 'CASH' | 'OTHER'
export type FamilyOfficeSeverity = 'INFO' | 'WARNING' | 'CRITICAL'
export type FamilyOfficeDecisionStatus = 'DRAFT' | 'VALIDATED' | 'EXPORTED' | 'EXECUTED' | 'RECONCILED' | 'CANCELLED'

export interface FamilyOfficeOwnerProfileRow {
  user_id: string
  email: string
  display_name: string | null
  base_currency: string
  created_at: string
  updated_at: string
}

export interface FamilyOfficePortfolioRow {
  id: string
  owner_user_id: string
  legal_entity_id: string
  name: string
  portfolio_type: 'PERSONAL' | 'PROFESSIONAL'
  base_currency: string
  benchmark_symbol: string | null
  status: 'ACTIVE' | 'CLOSED'
  created_at: string
  updated_at: string
}

export interface FamilyOfficeInstitutionRow {
  id: string
  owner_user_id: string
  name: string
  institution_type: 'BROKER' | 'BANK' | 'INSURER' | 'CUSTODIAN' | 'OTHER'
  country_code: string | null
  created_at: string
}

export interface FamilyOfficeAccountRow {
  id: string
  owner_user_id: string
  portfolio_id: string
  institution_id: string
  external_account_id: string
  name: string
  envelope: FamilyOfficeEnvelope
  base_currency: string
  status: 'ACTIVE' | 'CLOSED'
  opened_on: string | null
  closed_on: string | null
  created_at: string
  updated_at: string
}

export interface FamilyOfficeOverviewRow {
  owner_user_id: string
  portfolio_id: string
  portfolio_name: string
  portfolio_type: 'PERSONAL' | 'PROFESSIONAL'
  base_currency: string
  benchmark_symbol: string | null
  liquid_assets_eur: number
  cash_eur: number
  manual_assets_eur: number
  liabilities_eur: number
  net_asset_value_eur: number | null
  twr_mtd: number | null
  twr_ytd: number | null
  xirr_since_inception: number | null
  coverage_pct: number | null
  performance_state: FamilyOfficeDataState | null
  volatility_30d_pct: number | null
  max_drawdown_ytd_pct: number | null
  largest_position_pct: number | null
  open_exception_count: number
  updated_at: string
}

export interface FamilyOfficePositionRow {
  id: string
  owner_user_id: string
  portfolio_id: string
  account_id: string
  instrument_id: string
  instrument_key: string
  isin: string | null
  ticker: string | null
  name: string
  instrument_type: string
  currency: string
  snapshot_date: string
  quantity: number
  average_cost: number | null
  cost_basis_eur: number | null
  price_local: number | null
  fx_rate_to_eur: number | null
  market_value_eur: number | null
  unrealized_pnl_eur: number | null
  data_state: FamilyOfficeDataState
  price_as_of: string | null
  fx_as_of: string | null
  reconciliation_state: 'MATCH' | 'MISMATCH' | 'NOT_CHECKED'
  calculated_at: string
}

export interface FamilyOfficeCashRow {
  id: string
  owner_user_id: string
  portfolio_id: string
  account_id: string
  balance_date: string
  currency: string
  balance_local: number
  fx_rate_to_eur: number | null
  balance_eur: number | null
  data_state: FamilyOfficeDataState
  calculated_at: string
}

export interface FamilyOfficeManualHoldingRow {
  owner_user_id: string
  portfolio_id: string
  holding_id: string
  holding_kind: 'ASSET' | 'LIABILITY'
  asset_type: string
  name: string
  currency: string
  valuation_frequency: string
  next_valuation_date: string | null
  status: 'ACTIVE' | 'CLOSED'
  valuation_date: string | null
  value_local: number | null
  fx_rate_to_eur: number | null
  value_eur: number | null
  source: string | null
  confidence: 'VERIFIED' | 'DECLARED' | 'ESTIMATED' | null
  created_at: string | null
}

export interface FamilyOfficeOperationRow {
  id: string
  owner_user_id: string
  portfolio_id: string | null
  account_id: string | null
  exception_type: string
  severity: FamilyOfficeSeverity
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'IGNORED'
  title: string
  details: Record<string, unknown>
  source_ref: string | null
  detected_at: string
  resolved_at: string | null
}

export interface FamilyOfficePerformanceRow {
  owner_user_id: string
  portfolio_id: string
  performance_date: string
  nav_eur: number | null
  external_flow_eur: number
  twr_daily: number | null
  twr_mtd: number | null
  twr_ytd: number | null
  twr_since_inception: number | null
  xirr_since_inception: number | null
  benchmark_daily: number | null
  benchmark_ytd: number | null
  coverage_pct: number | null
  data_state: FamilyOfficeDataState
  calculated_at: string
}

export interface FamilyOfficeDecisionRow {
  id: string
  owner_user_id: string
  portfolio_id: string
  title: string
  rationale: string
  status: FamilyOfficeDecisionStatus
  macro_context: Record<string, unknown>
  risk_context: Record<string, unknown>
  source_snapshot: Record<string, unknown>
  created_at: string
  validated_at: string | null
  executed_at: string | null
  reconciled_at: string | null
  updated_at: string
}

export interface FamilyOfficeOrderDraftRow {
  id: string
  owner_user_id: string
  decision_id: string
  account_id: string
  status: string
  estimated_gross_eur: number | null
}

export interface FamilyOfficeMonthlyCloseRow {
  id: string
  owner_user_id: string
  portfolio_id: string
  period_end: string
  status: 'DRAFT' | 'BLOCKED' | 'CLOSED'
  nav_eur: number | null
  coverage_pct: number | null
  open_exception_count: number
  reconciliation_state: 'MATCH' | 'MISMATCH' | 'NOT_CHECKED'
  checks_json: Record<string, boolean>
  report_json: Record<string, unknown>
  closed_at: string | null
  created_at: string
}
