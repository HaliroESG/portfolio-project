// Dans types.ts
export type Period = '1D' | '1W' | '1M' | 'YTD';
export type GeoTimeframe = 'day' | 'month' | 'ytd';

// Data Status Enum
export type DataStatus = 'OK' | 'STALE' | 'LOW_CONFIDENCE' | 'PARTIAL';
export type AssetType = 'Stock' | 'STOCK' | 'ETF' | 'Crypto' | 'CRYPTO' | 'Cash' | 'Forex' | 'Currency';
// Add INSUFFICIENT_HISTORY to distinguish missing historical data from neutral/unknown
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

