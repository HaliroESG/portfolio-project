import type { SupabaseClient } from '@supabase/supabase-js'
import type { EquityScreenerRow, EquityScreenerValuationTag, TridentOverallState } from '../types'

type JsonRecord = Record<string, unknown>

const PAGE_SIZE = 1000

export interface EquityScreenerLastRun {
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  started_at: string | null
  finished_at: string | null
  duration_sec: number | null
  error: string | null
  stats: JsonRecord
}

export interface EquityScreenerBundle {
  status: 'READY' | 'SCHEMA_PENDING'
  rows: EquityScreenerRow[]
  countries: string[]
  sectors: string[]
  themes: string[]
  valuationTags: EquityScreenerValuationTag[]
  lastUpdateIso: string | null
  lastBackendRun: EquityScreenerLastRun | null
  rowCount: number
  message?: string
}

const SELECTOR = [
  'instrument_key',
  'as_of_date',
  'ticker',
  'name',
  'exchange',
  'country',
  'sector',
  'industry',
  'currency',
  'provider',
  'provider_symbol',
  'source_index',
  'themes',
  'latest_fiscal_year',
  'financial_currency',
  'valuation_currency',
  'market_cap',
  'revenue',
  'free_cash_flow',
  'fcf_margin',
  'fcf_yield',
  'revenue_cagr_3y',
  'revenue_cagr_5y',
  'forecast_revenue_growth',
  'trailing_pe',
  'forward_pe',
  'latest_roic',
  'latest_net_debt_to_ebitda',
  'target_upside',
  'recommendation_key',
  'analyst_count',
  'trident_score',
  'trident_state',
  'regression_slope_pct',
  'regression_z_score',
  'ma200_state',
  'momentum_3m_pct',
  'momentum_12m_pct',
  'price_coverage_pct',
  'quality_value_score',
  'valuation_tag',
  'score_details',
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
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord
  return {}
}

function parseTridentState(value: unknown): TridentOverallState | null {
  if (value === 'QUALIFIED' || value === 'WATCHLIST' || value === 'REJECTED' || value === 'NO_DATA') return value
  return null
}

function parseValuationTag(value: unknown): EquityScreenerValuationTag {
  if (
    value === 'POTENTIAL_VALUE' ||
    value === 'FAIR' ||
    value === 'EXPENSIVE' ||
    value === 'INSUFFICIENT_DATA'
  ) {
    return value
  }
  return 'INSUFFICIENT_DATA'
}

function parseRun(raw: JsonRecord | null): EquityScreenerLastRun | null {
  if (!raw) return null
  const status = readString(raw.status)
  if (status !== 'RUNNING' && status !== 'SUCCESS' && status !== 'FAILED') return null
  return {
    status,
    started_at: readString(raw.started_at),
    finished_at: readString(raw.finished_at),
    duration_sec: readNumber(raw.duration_sec),
    error: readString(raw.error),
    stats: readRecord(raw.stats),
  }
}

function parseRow(raw: JsonRecord): EquityScreenerRow | null {
  const instrumentKey = readString(raw.instrument_key)
  const ticker = readString(raw.ticker)
  const provider = readString(raw.provider)
  if (!instrumentKey || !ticker || !provider) return null
  return {
    instrument_key: instrumentKey,
    as_of_date: readString(raw.as_of_date),
    ticker,
    name: readString(raw.name),
    exchange: readString(raw.exchange),
    country: readString(raw.country),
    sector: readString(raw.sector),
    industry: readString(raw.industry),
    currency: readString(raw.currency),
    provider,
    provider_symbol: readString(raw.provider_symbol),
    source_index: readString(raw.source_index),
    themes: readStringArray(raw.themes),
    latest_fiscal_year: readNumber(raw.latest_fiscal_year),
    financial_currency: readString(raw.financial_currency),
    valuation_currency: readString(raw.valuation_currency),
    market_cap: readNumber(raw.market_cap),
    revenue: readNumber(raw.revenue),
    free_cash_flow: readNumber(raw.free_cash_flow),
    fcf_margin: readNumber(raw.fcf_margin),
    fcf_yield: readNumber(raw.fcf_yield),
    revenue_cagr_3y: readNumber(raw.revenue_cagr_3y),
    revenue_cagr_5y: readNumber(raw.revenue_cagr_5y),
    forecast_revenue_growth: readNumber(raw.forecast_revenue_growth),
    trailing_pe: readNumber(raw.trailing_pe),
    forward_pe: readNumber(raw.forward_pe),
    latest_roic: readNumber(raw.latest_roic),
    latest_net_debt_to_ebitda: readNumber(raw.latest_net_debt_to_ebitda),
    target_upside: readNumber(raw.target_upside),
    recommendation_key: readString(raw.recommendation_key),
    analyst_count: readNumber(raw.analyst_count),
    trident_score: readNumber(raw.trident_score),
    trident_state: parseTridentState(raw.trident_state),
    regression_slope_pct: readNumber(raw.regression_slope_pct),
    regression_z_score: readNumber(raw.regression_z_score),
    ma200_state: readString(raw.ma200_state),
    momentum_3m_pct: readNumber(raw.momentum_3m_pct),
    momentum_12m_pct: readNumber(raw.momentum_12m_pct),
    price_coverage_pct: readNumber(raw.price_coverage_pct),
    quality_value_score: readNumber(raw.quality_value_score) ?? 0,
    valuation_tag: parseValuationTag(raw.valuation_tag),
    score_details: readRecord(raw.score_details),
    data_state: readStringArray(raw.data_state),
    updated_at: readString(raw.updated_at),
  }
}

function sortedUnique(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value))).sort((left, right) =>
    left.localeCompare(right, 'en', { sensitivity: 'base' })
  )
}

function isSchemaPending(error: { message?: string } | null | undefined): boolean {
  const message = error?.message ?? ''
  return /could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /column .* does not exist/i.test(message) ||
    /could not find .* column/i.test(message)
}

async function loadAllRows(supabase: SupabaseClient): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('equity_screener_latest')
      .select(SELECTOR)
      .order('quality_value_score', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as unknown as JsonRecord[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

export async function loadEquityScreenerBundle(supabase: SupabaseClient): Promise<EquityScreenerBundle> {
  try {
    const [rawRows, countResponse, latestRunResponse] = await Promise.all([
      loadAllRows(supabase),
      supabase.from('equity_screener_results').select('instrument_key', { count: 'exact', head: true }),
      supabase
        .from('etl_runs')
        .select('status,started_at,finished_at,duration_sec,stats,error')
        .eq('job_name', 'equity_screener_sync')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (countResponse.error) throw countResponse.error
    if (latestRunResponse.error) throw latestRunResponse.error

    const rows = rawRows.map(parseRow).filter((row): row is EquityScreenerRow => row !== null)
    const lastUpdateIso = rows
      .map((row) => row.updated_at)
      .filter((value): value is string => !!value)
      .reduce<string | null>((latest, value) => {
        if (!latest) return value
        return new Date(value) > new Date(latest) ? value : latest
      }, null)

    return {
      status: 'READY',
      rows,
      countries: sortedUnique(rows.map((row) => row.country)),
      sectors: sortedUnique(rows.map((row) => row.sector)),
      themes: sortedUnique(rows.flatMap((row) => row.themes)),
      valuationTags: Array.from(new Set(rows.map((row) => row.valuation_tag))).sort(),
      lastUpdateIso: latestRunResponse.data?.finished_at ? readString(latestRunResponse.data.finished_at) : lastUpdateIso,
      lastBackendRun: parseRun((latestRunResponse.data ?? null) as unknown as JsonRecord | null),
      rowCount: countResponse.count ?? rows.length,
    }
  } catch (error) {
    if (isSchemaPending(error as { message?: string })) {
      return {
        status: 'SCHEMA_PENDING',
        rows: [],
        countries: [],
        sectors: [],
        themes: [],
        valuationTags: [],
        lastUpdateIso: null,
        lastBackendRun: null,
        rowCount: 0,
        message: 'Apply backend/sql/20260528_equity_screener.sql and run sync_equity_screener.py.',
      }
    }
    throw error
  }
}
