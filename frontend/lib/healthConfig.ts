import { SWR_REFRESH } from './swrConfig'

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export const HEALTH_CONFIG = {
  refreshIntervalMs: envNumber('NEXT_PUBLIC_HEALTH_REFRESH_MS', SWR_REFRESH.MEDIUM),
  freshnessSlaMinutes: {
    market_watch: envNumber('NEXT_PUBLIC_HEALTH_SLA_MARKET_MIN', 60),
    valuation_snapshots: envNumber('NEXT_PUBLIC_HEALTH_SLA_VALUATION_MIN', 360),
    news_feed: envNumber('NEXT_PUBLIC_HEALTH_SLA_NEWS_MIN', 180),
    macro_indicators: envNumber('NEXT_PUBLIC_HEALTH_SLA_MACRO_MIN', 120),
  },
  nullRateWarnPct: {
    last_price: envNumber('NEXT_PUBLIC_HEALTH_NULL_WARN_LAST_PRICE', 5),
    data_status: envNumber('NEXT_PUBLIC_HEALTH_NULL_WARN_DATA_STATUS', 2),
    rsi_14: envNumber('NEXT_PUBLIC_HEALTH_NULL_WARN_RSI14', 35),
    macd_line: envNumber('NEXT_PUBLIC_HEALTH_NULL_WARN_MACD', 35),
    momentum_20: envNumber('NEXT_PUBLIC_HEALTH_NULL_WARN_MOMENTUM20', 35),
  },
}
