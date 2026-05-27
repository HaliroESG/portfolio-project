import type { SupabaseClient } from '@supabase/supabase-js'
import type { TridentInsightNewsItem, TridentStockInsightRow } from '../types'

type JsonRecord = Record<string, unknown>

export type TridentInsightLoadStatus = 'READY' | 'SYNC_PENDING' | 'SCHEMA_PENDING'

export interface TridentInsightLoadResult {
  status: TridentInsightLoadStatus
  insight: TridentStockInsightRow | null
  message?: string
}

export interface TridentInsightCoverageResult {
  status: 'READY' | 'SCHEMA_PENDING'
  generatedCount: number
  freshCount: number
  aiReadyCount: number
  message?: string
}

const INSIGHT_SELECTOR = [
  'instrument_key',
  'ticker',
  'provider_symbol',
  'name',
  'business_summary',
  'website',
  'market_cap',
  'trailing_pe',
  'forward_pe',
  'recommendation_key',
  'recommendation_mean',
  'target_mean_price',
  'target_high_price',
  'target_low_price',
  'number_of_analyst_opinions',
  'latest_price',
  'price_currency',
  'regression_slope_pct',
  'regression_z_score',
  'ma200_state',
  'momentum_3m_pct',
  'momentum_12m_pct',
  'trend_state',
  'trend_reason_codes',
  'price_history_state',
  'news_items',
  'ai_trend_summary',
  'ai_summary_state',
  'ai_model',
  'source_provider',
  'source_url',
  'data_state',
  'updated_at',
].join(',')

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readRecord(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord
  }
  return {}
}

function parseNewsItems(value: unknown): TridentInsightNewsItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const record = readRecord(item)
      const title = readString(record.title)
      const url = readString(record.url)
      if (!title || !url) return null
      return {
        title,
        url,
        source: readString(record.source),
        published_at: readString(record.published_at),
        impact_level: readString(record.impact_level),
        impact_score: readNumber(record.impact_score),
        ticker: readString(record.ticker),
      }
    })
    .filter((item): item is TridentInsightNewsItem => item !== null)
}

function isMissingRelationOrColumn(message: string): boolean {
  return /could not find the table/i.test(message)
    || /relation .* does not exist/i.test(message)
    || /column .* does not exist/i.test(message)
    || /could not find .* column/i.test(message)
}

function parseInsightRow(raw: JsonRecord): TridentStockInsightRow | null {
  const instrumentKey = readString(raw.instrument_key)
  const ticker = readString(raw.ticker)
  if (!instrumentKey || !ticker) return null

  return {
    instrument_key: instrumentKey,
    ticker,
    provider_symbol: readString(raw.provider_symbol),
    name: readString(raw.name),
    business_summary: readString(raw.business_summary),
    website: readString(raw.website),
    market_cap: readNumber(raw.market_cap),
    trailing_pe: readNumber(raw.trailing_pe),
    forward_pe: readNumber(raw.forward_pe),
    recommendation_key: readString(raw.recommendation_key),
    recommendation_mean: readNumber(raw.recommendation_mean),
    target_mean_price: readNumber(raw.target_mean_price),
    target_high_price: readNumber(raw.target_high_price),
    target_low_price: readNumber(raw.target_low_price),
    number_of_analyst_opinions: readNumber(raw.number_of_analyst_opinions),
    latest_price: readNumber(raw.latest_price),
    price_currency: readString(raw.price_currency),
    regression_slope_pct: readNumber(raw.regression_slope_pct),
    regression_z_score: readNumber(raw.regression_z_score),
    ma200_state: readString(raw.ma200_state),
    momentum_3m_pct: readNumber(raw.momentum_3m_pct),
    momentum_12m_pct: readNumber(raw.momentum_12m_pct),
    trend_state: readString(raw.trend_state),
    trend_reason_codes: readStringArray(raw.trend_reason_codes),
    price_history_state: readString(raw.price_history_state),
    news_items: parseNewsItems(raw.news_items),
    ai_trend_summary: readString(raw.ai_trend_summary),
    ai_summary_state: readString(raw.ai_summary_state) ?? 'AI_SUMMARY_UNAVAILABLE',
    ai_model: readString(raw.ai_model),
    source_provider: readString(raw.source_provider) ?? 'unknown',
    source_url: readString(raw.source_url),
    data_state: readStringArray(raw.data_state),
    updated_at: readString(raw.updated_at),
  }
}

export async function loadTridentStockInsight(
  supabase: SupabaseClient,
  instrumentKey: string,
): Promise<TridentInsightLoadResult> {
  const { data, error } = await supabase
    .from('trident_stock_insights')
    .select(INSIGHT_SELECTOR)
    .eq('instrument_key', instrumentKey)
    .maybeSingle()

  if (error) {
    if (isMissingRelationOrColumn(error.message)) {
      return {
        status: 'SCHEMA_PENDING',
        insight: null,
        message: 'Insights schema pending. Apply the Supabase deploy gate before running the stock insight sync.',
      }
    }
    throw error
  }

  if (!data) {
    return {
      status: 'SYNC_PENDING',
      insight: null,
      message: 'Insights sync pending for this instrument. Run the Trident Stock Insights workflow to generate profile, consensus, trend facts, and news context.',
    }
  }

  return {
    status: 'READY',
    insight: parseInsightRow(data as unknown as JsonRecord),
  }
}

function isSchemaPending(error: { message?: string } | null): boolean {
  return Boolean(error?.message && isMissingRelationOrColumn(error.message))
}

export async function loadTridentInsightCoverage(
  supabase: SupabaseClient,
): Promise<TridentInsightCoverageResult> {
  const freshCutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [generated, fresh, aiReady] = await Promise.all([
    supabase.from('trident_stock_insights').select('instrument_key', { count: 'exact', head: true }),
    supabase
      .from('trident_stock_insights')
      .select('instrument_key', { count: 'exact', head: true })
      .gte('updated_at', freshCutoffIso),
    supabase
      .from('trident_stock_insights')
      .select('instrument_key', { count: 'exact', head: true })
      .not('ai_trend_summary', 'is', null),
  ])

  const schemaPending = [generated.error, fresh.error, aiReady.error].some(isSchemaPending)
  if (schemaPending) {
    return {
      status: 'SCHEMA_PENDING',
      generatedCount: 0,
      freshCount: 0,
      aiReadyCount: 0,
      message: 'Insights schema pending.',
    }
  }

  const error = generated.error ?? fresh.error ?? aiReady.error
  if (error) throw error

  return {
    status: 'READY',
    generatedCount: generated.count ?? 0,
    freshCount: fresh.count ?? 0,
    aiReadyCount: aiReady.count ?? 0,
  }
}
