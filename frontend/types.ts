// Dans types.ts
export type Period = '1D' | '1W' | '1M' | 'YTD';
export type GeoTimeframe = 'day' | 'month' | 'ytd';

// Data Status Enum
export type DataStatus = 'OK' | 'STALE' | 'LOW_CONFIDENCE' | 'PARTIAL';
export type AssetType = 'Stock' | 'STOCK' | 'ETF' | 'Crypto' | 'CRYPTO' | 'Cash' | 'Forex' | 'Currency';
export type TrendState = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';

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
