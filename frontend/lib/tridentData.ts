import type { SupabaseClient } from '@supabase/supabase-js'
import {
  TridentCategory,
  TridentCriterionRow,
  TridentCriterionStatus,
  TridentHorizonSummary,
  TridentOverallState,
  TridentScreenerRow,
} from '../types'

type JsonRecord = Record<string, unknown>
const SCREENER_PAGE_SIZE = 1000

export interface TridentLastRun {
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  started_at: string | null
  finished_at: string | null
  duration_sec: number | null
  error: string | null
  stats: JsonRecord
}

export interface TridentBundle {
  rows: TridentScreenerRow[]
  countries: string[]
  exchanges: string[]
  sectors: string[]
  lastUpdateIso: string | null
  lastBackendRun: TridentLastRun | null
  sourceCounts: {
    universe: number
    financials: number
    results: number
    criteria: number
  }
}

const SCREENER_SELECTOR = [
  'instrument_key',
  'ticker',
  'name',
  'exchange',
  'country',
  'sector',
  'industry',
  'currency',
  'provider',
  'source_provider',
  'source_index',
  'source_license_note',
  'is_active',
  'as_of_date',
  'latest_fiscal_year',
  'overall_state',
  'score',
  'confidence',
  'growth_score',
  'profitability_score',
  'capital_score',
  'health_score',
  'latest_roic',
  'latest_net_debt_to_ebitda',
  'failed_eliminators',
  'criteria_pass_count',
  'criteria_fail_count',
  'criteria_missing_count',
  'horizons',
  'summary',
  'updated_at',
].join(',')

const CRITERIA_SELECTOR = [
  'instrument_key',
  'horizon_years',
  'criterion_key',
  'category',
  'label',
  'status',
  'actual',
  'threshold',
  'comparator',
  'is_eliminating',
  'reason',
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

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return false
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function readJsonRecord(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord
  }
  return {}
}

function parseOverallState(value: unknown): TridentOverallState | null {
  if (value === 'QUALIFIED' || value === 'WATCHLIST' || value === 'REJECTED' || value === 'NO_DATA') {
    return value
  }
  return null
}

function parseLastRun(raw: JsonRecord | null): TridentLastRun | null {
  if (!raw) return null
  const status = readString(raw.status)
  if (status !== 'RUNNING' && status !== 'SUCCESS' && status !== 'FAILED') return null
  return {
    status,
    started_at: readString(raw.started_at),
    finished_at: readString(raw.finished_at),
    duration_sec: readNumber(raw.duration_sec),
    error: readString(raw.error),
    stats: readJsonRecord(raw.stats),
  }
}

function parseStatus(value: unknown): TridentCriterionStatus {
  if (value === 'pass' || value === 'fail' || value === 'missing' || value === 'not_applicable') {
    return value
  }
  return 'missing'
}

function parseCategory(value: unknown): TridentCategory {
  if (value === 'growth' || value === 'profitability' || value === 'capital' || value === 'health') {
    return value
  }
  return 'growth'
}

function parseHorizonSummary(value: unknown): TridentHorizonSummary {
  const record = readJsonRecord(value)
  const statusValue = readString(record.status)
  const status =
    statusValue === 'complete' || statusValue === 'partial' || statusValue === 'missing'
      ? statusValue
      : 'missing'
  const metricsRaw = readJsonRecord(record.metrics)
  const metrics: Record<string, number | null> = {}
  Object.entries(metricsRaw).forEach(([key, metricValue]) => {
    metrics[key] = readNumber(metricValue)
  })

  return {
    horizon_years: readNumber(record.horizon_years) ?? 0,
    start_year: readNumber(record.start_year),
    end_year: readNumber(record.end_year),
    status,
    metrics,
  }
}

function parseHorizons(value: unknown): Record<string, TridentHorizonSummary> {
  const record = readJsonRecord(value)
  const horizons: Record<string, TridentHorizonSummary> = {}
  Object.entries(record).forEach(([key, summary]) => {
    horizons[key] = parseHorizonSummary(summary)
  })
  return horizons
}

function parseScreenerRow(raw: JsonRecord): TridentScreenerRow | null {
  const instrumentKey = readString(raw.instrument_key)
  const ticker = readString(raw.ticker)
  const provider = readString(raw.provider)
  if (!instrumentKey || !ticker || !provider) return null

  return {
    instrument_key: instrumentKey,
    ticker,
    name: readString(raw.name),
    exchange: readString(raw.exchange),
    country: readString(raw.country),
    sector: readString(raw.sector),
    industry: readString(raw.industry),
    currency: readString(raw.currency),
    provider,
    source_provider: readString(raw.source_provider) ?? provider,
    source_index: readString(raw.source_index),
    source_license_note: readString(raw.source_license_note),
    is_active: readBoolean(raw.is_active),
    as_of_date: readString(raw.as_of_date),
    latest_fiscal_year: readNumber(raw.latest_fiscal_year),
    overall_state: parseOverallState(raw.overall_state),
    score: readNumber(raw.score),
    confidence: readNumber(raw.confidence),
    growth_score: readNumber(raw.growth_score),
    profitability_score: readNumber(raw.profitability_score),
    capital_score: readNumber(raw.capital_score),
    health_score: readNumber(raw.health_score),
    latest_roic: readNumber(raw.latest_roic),
    latest_net_debt_to_ebitda: readNumber(raw.latest_net_debt_to_ebitda),
    failed_eliminators: readStringArray(raw.failed_eliminators),
    criteria_pass_count: readNumber(raw.criteria_pass_count),
    criteria_fail_count: readNumber(raw.criteria_fail_count),
    criteria_missing_count: readNumber(raw.criteria_missing_count),
    horizons: parseHorizons(raw.horizons),
    summary: readJsonRecord(raw.summary),
    updated_at: readString(raw.updated_at),
  }
}

function parseCriterionRow(raw: JsonRecord): TridentCriterionRow | null {
  const instrumentKey = readString(raw.instrument_key)
  const criterionKey = readString(raw.criterion_key)
  const label = readString(raw.label)
  const horizonYears = readNumber(raw.horizon_years)
  if (!instrumentKey || !criterionKey || !label) return null
  if (horizonYears !== 1 && horizonYears !== 3 && horizonYears !== 5 && horizonYears !== 10) return null

  return {
    instrument_key: instrumentKey,
    horizon_years: horizonYears,
    criterion_key: criterionKey,
    category: parseCategory(raw.category),
    label,
    status: parseStatus(raw.status),
    actual: readNumber(raw.actual),
    threshold: readNumber(raw.threshold),
    comparator: readString(raw.comparator),
    is_eliminating: readBoolean(raw.is_eliminating),
    reason: readString(raw.reason),
    updated_at: readString(raw.updated_at),
  }
}

function sortedUnique(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value))).sort((left, right) =>
    left.localeCompare(right, 'en', { sensitivity: 'base' })
  )
}

async function loadAllScreenerRows(supabase: SupabaseClient): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = []
  for (let offset = 0; ; offset += SCREENER_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('trident_screener_latest')
      .select(SCREENER_SELECTOR)
      .order('score', { ascending: false, nullsFirst: false })
      .range(offset, offset + SCREENER_PAGE_SIZE - 1)

    if (error) throw error
    const page = (data ?? []) as unknown as JsonRecord[]
    rows.push(...page)
    if (page.length < SCREENER_PAGE_SIZE) break
  }
  return rows
}

export async function loadTridentCriteria(
  supabase: SupabaseClient,
  instrumentKey: string,
  horizon: 1 | 3 | 5 | 10
): Promise<TridentCriterionRow[]> {
  const { data, error } = await supabase
    .from('trident_criterion_results')
    .select(CRITERIA_SELECTOR)
    .eq('instrument_key', instrumentKey)
    .eq('horizon_years', horizon)
    .order('category', { ascending: true })
    .order('criterion_key', { ascending: true })

  if (error) throw error
  return ((data ?? []) as unknown as JsonRecord[])
    .map(parseCriterionRow)
    .filter((row): row is TridentCriterionRow => row !== null)
}

export async function loadTridentBundle(supabase: SupabaseClient): Promise<TridentBundle> {
  const [screenerRows, universeCount, financialsCount, resultsCount, criteriaCount, latestRunResponse] = await Promise.all([
    loadAllScreenerRows(supabase),
    supabase.from('trident_equity_universe').select('*', { count: 'exact', head: true }),
    supabase.from('trident_financial_annual').select('*', { count: 'exact', head: true }),
    supabase.from('trident_results').select('*', { count: 'exact', head: true }),
    supabase.from('trident_criterion_results').select('*', { count: 'exact', head: true }),
    supabase
      .from('etl_runs')
      .select('status,started_at,finished_at,duration_sec,stats,error')
      .eq('job_name', 'trident_screener_sync')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (latestRunResponse.error) throw latestRunResponse.error

  const rows = screenerRows
    .map(parseScreenerRow)
    .filter((row): row is TridentScreenerRow => row !== null)

  const lastUpdateIso = rows
    .map((row) => row.updated_at)
    .filter((value): value is string => !!value)
    .reduce<string | null>((latest, value) => {
      if (!latest) return value
      return new Date(value) > new Date(latest) ? value : latest
    }, null)

  return {
    rows,
    countries: sortedUnique(rows.map((row) => row.country)),
    exchanges: sortedUnique(rows.map((row) => row.exchange)),
    sectors: sortedUnique(rows.map((row) => row.sector)),
    lastUpdateIso: latestRunResponse.data?.finished_at ? readString(latestRunResponse.data.finished_at) : lastUpdateIso,
    lastBackendRun: parseLastRun((latestRunResponse.data ?? null) as unknown as JsonRecord | null),
    sourceCounts: {
      universe: universeCount.count ?? 0,
      financials: financialsCount.count ?? 0,
      results: resultsCount.count ?? 0,
      criteria: criteriaCount.count ?? 0,
    },
  }
}
