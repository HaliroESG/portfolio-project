import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AssetPriceHistoryResult,
  AssetPricePoint,
  PriceHistoryCurrencyMode,
  PriceHistoryHorizon,
} from '../types'

export const PRICE_HISTORY_PAGE_SIZE = 1000

export interface DisplayPricePoint {
  date: string
  price: number
  source: string | null
  updated_at: string | null
}

interface HistoricalPriceRow {
  date: string | null
  adj_close: number | string | null
  adj_close_local: number | string | null
  local_currency: string | null
  fx_rate_to_eur: number | string | null
  source: string | null
  updated_at: string | null
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function getPriceHistoryStartDate(
  horizon: PriceHistoryHorizon,
  now = new Date(),
): string {
  if (horizon === 'MAX') {
    return '1999-01-01'
  }

  const year = now.getUTCFullYear()
  if (horizon === 'YTD') {
    return `${year}-01-01`
  }

  const years = horizon === '5Y' ? 5 : 10
  const start = new Date(Date.UTC(year - years, now.getUTCMonth(), now.getUTCDate()))
  return start.toISOString().slice(0, 10)
}

export function parseAssetPriceHistoryRow(row: HistoricalPriceRow): AssetPricePoint | null {
  if (!row.date) return null
  const priceEur = toNumber(row.adj_close)
  if (priceEur === null || priceEur <= 0) return null

  return {
    date: row.date,
    price_eur: priceEur,
    price_local: toNumber(row.adj_close_local),
    local_currency: row.local_currency ?? null,
    fx_rate_to_eur: toNumber(row.fx_rate_to_eur),
    source: row.source ?? null,
    updated_at: row.updated_at ?? null,
  }
}

export function buildDisplayPriceSeries(
  points: AssetPricePoint[],
  mode: PriceHistoryCurrencyMode,
): DisplayPricePoint[] {
  return points
    .map((point) => {
      const price = mode === 'LOCAL' ? point.price_local : point.price_eur
      if (price === null || price <= 0 || !Number.isFinite(price)) return null
      return {
        date: point.date,
        price,
        source: point.source,
        updated_at: point.updated_at,
      }
    })
    .filter((point): point is DisplayPricePoint => point !== null)
}

export async function loadAssetPriceHistory(
  supabase: SupabaseClient,
  ticker: string,
  horizon: PriceHistoryHorizon,
): Promise<AssetPriceHistoryResult> {
  const normalizedTicker = ticker.trim().toUpperCase()
  const requestedStartDate = getPriceHistoryStartDate(horizon)
  const rows: HistoricalPriceRow[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('historical_prices')
      .select('date,adj_close,adj_close_local,local_currency,fx_rate_to_eur,source,updated_at')
      .eq('ticker', normalizedTicker)
      .gte('date', requestedStartDate)
      .order('date', { ascending: true })
      .range(offset, offset + PRICE_HISTORY_PAGE_SIZE - 1)

    if (error) {
      throw new Error(error.message)
    }

    const batch = (data ?? []) as HistoricalPriceRow[]
    rows.push(...batch)

    if (batch.length < PRICE_HISTORY_PAGE_SIZE) {
      break
    }
    offset += PRICE_HISTORY_PAGE_SIZE
  }

  return {
    ticker: normalizedTicker,
    horizon,
    requested_start_date: requestedStartDate,
    points: rows
      .map(parseAssetPriceHistoryRow)
      .filter((point): point is AssetPricePoint => point !== null),
  }
}
