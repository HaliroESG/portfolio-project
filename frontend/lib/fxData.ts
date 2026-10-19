import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrencyRateRow, FxPairRow } from '../types'
import { finiteNumber, observationState, sourceTimestamp, type ObservationState } from './readerState'
import { isSelectorSchemaError } from './supabaseSelectorErrors'

export const FX_PAIRS_SWR_KEY = 'fx-pairs-v2'
export const FX_RATES_SWR_KEY = 'fx-rates-v3'
export const FX_CACHE_KEY = 'fx_currency_rates_v2'

// Explicit ISO currency pairs only: never infer FX from an equity's currency or name.
const CURRENCIES = new Set('EUR USD GBP CHF JPY CAD AUD NZD SEK NOK DKK HKD SGD CNY CNH INR KRW BRL MXN ZAR PLN CZK HUF TRY ILS AED SAR THB TWD IDR MYR PHP CLP COP ISK RON BGN'.split(' '))

export function parseFxPair(raw: Record<string, unknown>): FxPairRow | null {
  if (typeof raw.ticker !== 'string') return null
  const ticker = raw.ticker.trim().toUpperCase()
  const match = /^([A-Z]{3})([A-Z]{3})=X$/.exec(ticker)
  if (!match || !CURRENCIES.has(match[1]) || !CURRENCIES.has(match[2]) || match[1] === match[2]) return null
  const price = finiteNumber(raw.last_price)
  const change = finiteNumber(raw.perf_day_local)
  return {
    ticker, base: match[1], quote: match[2], name: `${match[1]} / ${match[2]}`,
    last_price: price !== null && price > 0 ? price : null,
    perf_day_local: change !== null && change > -1 ? change : null,
    last_update: sourceTimestamp(raw.last_update),
    data_status: raw.data_status === 'OK' || raw.data_status === 'STALE' || raw.data_status === 'LOW_CONFIDENCE' || raw.data_status === 'PARTIAL' ? raw.data_status : null,
  }
}

export function parseCurrencyRate(raw: Record<string, unknown>): CurrencyRateRow | null {
  if (typeof raw.id !== 'string') return null
  const id = raw.id.trim().toUpperCase()
  if (!CURRENCIES.has(id)) return null
  const rate = finiteNumber(raw.rate_to_eur)
  return {
    id, symbol: typeof raw.symbol === 'string' ? raw.symbol : id,
    rate_to_eur: rate !== null && rate > 0 && rate <= Number.MAX_SAFE_INTEGER ? rate : null,
    last_update: sourceTimestamp(raw.last_update),
  }
}

export async function loadFxPairs(supabase: SupabaseClient): Promise<FxPairRow[]> {
  const { data, error } = await supabase.from('market_watch')
    .select('ticker,name,currency,last_price,perf_day_local,last_update,data_status')
    .like('ticker', '%=X').order('ticker', { ascending: true })
  if (error) throw new Error('FX pair read failed')
  const pairs = ((data ?? []) as Record<string, unknown>[]).map(parseFxPair).filter((row): row is FxPairRow => row !== null)
  if (new Set(pairs.map(row => row.ticker)).size !== pairs.length) throw new Error('Duplicate FX pair identity')
  return pairs
}

export async function loadCurrencyRates(supabase: SupabaseClient): Promise<CurrencyRateRow[]> {
  for (const selector of ['id,symbol,rate_to_eur,last_update', 'id,symbol,rate_to_eur']) {
    const { data, error } = await supabase.from('currencies').select(selector).order('id', { ascending: true })
    if (error) {
      if (selector.includes('last_update') && isSelectorSchemaError(error)) continue
      throw new Error('Currency rate read failed')
    }
    const rates = ((data ?? []) as unknown as Record<string, unknown>[]).map(parseCurrencyRate).filter((row): row is CurrencyRateRow => row !== null)
    if (new Set(rates.map(row => row.id)).size !== rates.length) throw new Error('Duplicate currency identity')
    return rates
  }
  throw new Error('Currency rate read failed')
}

export function currencyCollectionState(rate: CurrencyRateRow, now = Date.now()): Exclude<ObservationState, 'READY'> | 'COLLECTED' {
  const state = observationState(rate.rate_to_eur, rate.last_update, now)
  return state === 'READY' ? 'COLLECTED' : state
}

// last_update is a collection timestamp. Preserve the backend's price status;
// even SOURCE_OK is a source assertion, not an independently dated market quote.
export function fxPairState(pair: FxPairRow, now = Date.now()): Exclude<ObservationState, 'READY'> | 'SOURCE_OK' | 'LOW_CONFIDENCE' | 'PARTIAL' {
  const collected = observationState(pair.last_price, pair.last_update, now)
  if (collected === 'MISSING') return 'MISSING'
  if (pair.data_status === 'STALE') return 'STALE'
  if (pair.data_status === 'LOW_CONFIDENCE' || pair.data_status === 'PARTIAL') return pair.data_status
  if (pair.data_status !== 'OK') return 'UNKNOWN'
  return collected === 'READY' ? 'SOURCE_OK' : collected
}

export function parseFxCache(raw: string | null): CurrencyRateRow[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null')
    const rates = Array.isArray(parsed) ? parsed.filter((row) => row && typeof row === 'object')
      .map(parseCurrencyRate).filter((row): row is CurrencyRateRow => row !== null) : []
    return new Set(rates.map(row => row.id)).size === rates.length ? rates : []
  } catch { return [] }
}
