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

export interface TridentBundle {
  rows: TridentScreenerRow[]
  criteriaByInstrument: Record<string, TridentCriterionRow[]>
  countries: string[]
  exchanges: string[]
  sectors: string[]
  lastUpdateIso: string | null
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
  if (value === 'PASS' || value === 'FAIL' || value === 'PARTIAL' || value === 'NO_DATA') {
    return value
  }
  return null
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

export async function loadTridentBundle(supabase: SupabaseClient): Promise<TridentBundle> {
  const { data, error } = await supabase
    .from('trident_screener_latest')
    .select(SCREENER_SELECTOR)
    .order('score', { ascending: false, nullsFirst: false })
    .limit(1000)

  if (error) throw error

  const rows = ((data ?? []) as unknown as JsonRecord[])
    .map(parseScreenerRow)
    .filter((row): row is TridentScreenerRow => row !== null)

  const instrumentKeys = rows.map((row) => row.instrument_key)
  let criteria: TridentCriterionRow[] = []
  if (instrumentKeys.length > 0) {
    const { data: criteriaData, error: criteriaError } = await supabase
      .from('trident_criterion_results')
      .select(CRITERIA_SELECTOR)
      .in('instrument_key', instrumentKeys)
      .order('horizon_years', { ascending: true })
      .order('category', { ascending: true })

    if (criteriaError) throw criteriaError
    criteria = ((criteriaData ?? []) as unknown as JsonRecord[])
      .map(parseCriterionRow)
      .filter((row): row is TridentCriterionRow => row !== null)
  }

  const criteriaByInstrument: Record<string, TridentCriterionRow[]> = {}
  criteria.forEach((criterion) => {
    const current = criteriaByInstrument[criterion.instrument_key] ?? []
    current.push(criterion)
    criteriaByInstrument[criterion.instrument_key] = current
  })

  const lastUpdateIso = rows
    .map((row) => row.updated_at)
    .filter((value): value is string => !!value)
    .reduce<string | null>((latest, value) => {
      if (!latest) return value
      return new Date(value) > new Date(latest) ? value : latest
    }, null)

  return {
    rows,
    criteriaByInstrument,
    countries: sortedUnique(rows.map((row) => row.country)),
    exchanges: sortedUnique(rows.map((row) => row.exchange)),
    sectors: sortedUnique(rows.map((row) => row.sector)),
    lastUpdateIso,
  }
}
