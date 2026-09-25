export interface ScreenerDefinition {
  label: string
  short: string
  detail: string
  source: string
}

export const SCREENER_DEFINITIONS = {
  company: {
    label: 'Company',
    short: 'Listed company and canonical ticker.',
    detail: 'Company identity from the Trident universe, including country, exchange, provider symbol, and latest fiscal year when available.',
    source: 'trident_equity_universe',
  },
  theme: {
    label: 'Theme',
    short: 'Backend theme tags used by presets.',
    detail: 'Themes are assigned from sector, industry, curated names, and provider metadata. Examples: IT_SERVICES, SOFTWARE, SEMICONDUCTOR.',
    source: 'equity_screener_results.themes',
  },
  score: {
    label: 'Score',
    short: 'Quality value score, 0 to 100.',
    detail: 'Score = valuation 20 pts, FCF 25 pts, quality 20 pts, growth 15 pts, health 20 pts. Missing inputs score 0 for their subcomponent, but remain visible in data states.',
    source: 'backend/equity_screener.py quality_value_score',
  },
  marketCap: {
    label: 'Mkt Cap',
    short: 'Market capitalization normalized to USD.',
    detail: 'Primary value is market_cap_usd. The original provider market cap and valuation currency are preserved below it. FX uses currencies.rate_to_eur with EUR as pivot.',
    source: 'trident_stock_insights.market_cap + currencies.rate_to_eur',
  },
  pe: {
    label: 'PE',
    short: 'Best positive PE available.',
    detail: 'The screener displays the lower positive value between forward PE and trailing PE. Detail cards keep both source multiples visible.',
    source: 'trident_stock_insights.forward_pe / trailing_pe',
  },
  fcfYield: {
    label: 'FCF Yield',
    short: 'Free cash flow divided by market cap.',
    detail: 'Computed only when financial statement currency matches valuation currency. Otherwise FCF_YIELD_UNAVAILABLE and CURRENCY_MISMATCH stay visible.',
    source: 'trident_financial_annual.free_cash_flow / trident_stock_insights.market_cap',
  },
  fcfMargin: {
    label: 'FCF Margin',
    short: 'Free cash flow divided by revenue.',
    detail: 'Latest fiscal-year free cash flow divided by latest fiscal-year revenue.',
    source: 'trident_financial_annual',
  },
  growth: {
    label: 'Rev 3Y',
    short: 'Annualized 3-year revenue growth.',
    detail: 'CAGR from the latest fiscal year to the closest fiscal year at least three years earlier.',
    source: 'trident_financial_annual.revenue',
  },
  target: {
    label: 'Target',
    short: 'Analyst target upside.',
    detail: 'Target upside = target_mean_price / latest_price - 1. Missing analyst targets remain blank.',
    source: 'trident_stock_insights.target_mean_price',
  },
  trident: {
    label: 'Trident',
    short: 'Existing Trident quality score.',
    detail: 'Backend-computed Trident score based on the historical quality/rentability rules from the Trident screener.',
    source: 'trident_results.score',
  },
  tag: {
    label: 'Tag',
    short: 'Valuation classification.',
    detail: 'POTENTIAL_VALUE, FAIR, EXPENSIVE, or INSUFFICIENT_DATA based on score, PE, FCF yield, FCF margin, and revenue growth.',
    source: 'backend/equity_screener.py valuation_tag',
  },
  dataStates: {
    label: 'Data states',
    short: 'Explicit missing or degraded data flags.',
    detail: 'States such as FORECAST_UNAVAILABLE, FX_RATE_UNAVAILABLE, PRICE_HISTORY_SHORT, or MARKET_CAP_USD_UNAVAILABLE explain why a metric is blank or partial.',
    source: 'equity_screener_results.data_state',
  },
} satisfies Record<string, ScreenerDefinition>

export const SCREENER_DEFINITION_ORDER = [
  'score',
  'marketCap',
  'pe',
  'fcfYield',
  'fcfMargin',
  'growth',
  'target',
  'trident',
  'tag',
  'dataStates',
] as const
