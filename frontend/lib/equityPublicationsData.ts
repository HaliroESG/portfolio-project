import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  EquityAnnualFinancialRow,
  EquityInterimFinancialRow,
  EquityPublicationDashboardRow,
  EquityPublicationDataState,
  EquityReportingEventRow,
  EquityReportingEventStatus,
  EquityReportingEventType,
  EquityReportingMatchConfidence,
  EquityReportingPeriodKind,
} from '../types'
import { publicationDateKey } from './equityPublicationUi'

type JsonRecord = Record<string, unknown>

const PAGE_SIZE = 1000
const DASHBOARD_SELECTOR = [
  'instrument_key',
  'ticker',
  'name',
  'exchange',
  'country',
  'sector',
  'industry',
  'company_currency',
  'provider_symbol',
  'source_index',
  'annual_fiscal_year',
  'annual_period_end',
  'annual_currency',
  'annual_revenue',
  'annual_ebitda',
  'annual_operating_income',
  'annual_net_income',
  'annual_eps_diluted',
  'annual_free_cash_flow',
  'annual_published_on',
  'interim_fiscal_year',
  'interim_period_kind',
  'interim_period_end',
  'interim_currency',
  'interim_revenue',
  'interim_ebitda',
  'interim_operating_income',
  'interim_net_income',
  'interim_eps_diluted',
  'interim_free_cash_flow',
  'interim_data_state',
  'interim_reason_codes',
  'interim_published_on',
  'ttm_currency',
  'ttm_period_end',
  'ttm_revenue',
  'ttm_ebitda',
  'ttm_operating_income',
  'ttm_net_income',
  'ttm_free_cash_flow',
  'ttm_complete',
  'trailing_pe',
  'forward_pe',
  'valuation_as_of',
  'last_event_type',
  'last_event_label',
  'last_event_date',
  'last_event_status',
  'last_event_source_provider',
  'last_event_source_url',
  'next_event_type',
  'next_event_label',
  'next_event_date',
  'next_event_time_utc',
  'next_event_status',
  'next_event_source_provider',
  'next_event_source_url',
  'data_state',
  'reason_codes',
  'updated_at',
].join(',')

const CALENDAR_SELECTOR = [
  'event_key',
  'instrument_key',
  'ticker',
  'name',
  'provider_symbol',
  'source_index',
  'currency',
  'event_type',
  'event_label',
  'event_date',
  'event_time_utc',
  'status',
  'fiscal_year',
  'fiscal_period_end',
  'period_kind',
  'filing_date',
  'match_confidence',
  'source_provider',
  'source_url',
  'metadata',
  'first_seen_at',
  'last_seen_at',
  'updated_at',
].join(',')

export interface EquityPublicationCoverage {
  total: number
  ready: number
  partial: number
  stale: number
  missing: number
  calendar: number
  interim: number
}

export interface EquityPublicationsLastRun {
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  started_at: string | null
  finished_at: string | null
  stats: Record<string, unknown>
  error: string | null
}

export interface EquityPublicationsBundle {
  status: 'READY' | 'SCHEMA_PENDING'
  rows: EquityPublicationDashboardRow[]
  events: EquityReportingEventRow[]
  coverage: Record<string, EquityPublicationCoverage>
  lastUpdateIso: string | null
  lastBackendRun: EquityPublicationsLastRun | null
  message?: string
}

export interface EquityPublicationHistory {
  annual: EquityAnnualFinancialRow[]
  interim: EquityInterimFinancialRow[]
  events: EquityReportingEventRow[]
}

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
  return value === true
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readRecord(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord
  return {}
}

function readDataState(value: unknown): EquityPublicationDataState {
  if (value === 'READY' || value === 'PARTIAL' || value === 'STALE' || value === 'MISSING') {
    return value
  }
  return 'MISSING'
}

function readNullableDataState(value: unknown): EquityPublicationDataState | null {
  return value === null || value === undefined ? null : readDataState(value)
}

function readPeriodKind(value: unknown): EquityReportingPeriodKind | null {
  if (
    value === 'Q1' ||
    value === 'Q2' ||
    value === 'Q3' ||
    value === 'Q4' ||
    value === 'H1' ||
    value === 'H2' ||
    value === 'FY' ||
    value === 'INTERIM'
  ) {
    return value
  }
  return null
}

function readEventType(value: unknown): EquityReportingEventType | null {
  if (value === 'EARNINGS' || value === 'REGULATORY_FILING') return value
  return null
}

function readEventStatus(value: unknown): EquityReportingEventStatus | null {
  if (value === 'ESTIMATED' || value === 'CONFIRMED' || value === 'REPORTED' || value === 'CANCELLED') {
    return value
  }
  return null
}

function readMatchConfidence(value: unknown): EquityReportingMatchConfidence {
  if (value === 'HIGH' || value === 'INFERRED' || value === 'UNKNOWN') return value
  return 'UNKNOWN'
}

function parseDashboardRow(raw: JsonRecord): EquityPublicationDashboardRow | null {
  const instrumentKey = readString(raw.instrument_key)
  const ticker = readString(raw.ticker)
  const providerSymbol = readString(raw.provider_symbol)
  const sourceIndex = readString(raw.source_index)
  if (!instrumentKey || !ticker || !providerSymbol || !sourceIndex) return null
  return {
    instrument_key: instrumentKey,
    ticker,
    name: readString(raw.name),
    exchange: readString(raw.exchange),
    country: readString(raw.country),
    sector: readString(raw.sector),
    industry: readString(raw.industry),
    company_currency: readString(raw.company_currency),
    provider_symbol: providerSymbol,
    source_index: sourceIndex,
    annual_fiscal_year: readNumber(raw.annual_fiscal_year),
    annual_period_end: readString(raw.annual_period_end),
    annual_currency: readString(raw.annual_currency),
    annual_revenue: readNumber(raw.annual_revenue),
    annual_ebitda: readNumber(raw.annual_ebitda),
    annual_operating_income: readNumber(raw.annual_operating_income),
    annual_net_income: readNumber(raw.annual_net_income),
    annual_eps_diluted: readNumber(raw.annual_eps_diluted),
    annual_free_cash_flow: readNumber(raw.annual_free_cash_flow),
    annual_published_on: readString(raw.annual_published_on),
    interim_fiscal_year: readNumber(raw.interim_fiscal_year),
    interim_period_kind: readPeriodKind(raw.interim_period_kind),
    interim_period_end: readString(raw.interim_period_end),
    interim_currency: readString(raw.interim_currency),
    interim_revenue: readNumber(raw.interim_revenue),
    interim_ebitda: readNumber(raw.interim_ebitda),
    interim_operating_income: readNumber(raw.interim_operating_income),
    interim_net_income: readNumber(raw.interim_net_income),
    interim_eps_diluted: readNumber(raw.interim_eps_diluted),
    interim_free_cash_flow: readNumber(raw.interim_free_cash_flow),
    interim_data_state: readNullableDataState(raw.interim_data_state),
    interim_reason_codes: readStringArray(raw.interim_reason_codes),
    interim_published_on: readString(raw.interim_published_on),
    ttm_currency: readString(raw.ttm_currency),
    ttm_period_end: readString(raw.ttm_period_end),
    ttm_revenue: readNumber(raw.ttm_revenue),
    ttm_ebitda: readNumber(raw.ttm_ebitda),
    ttm_operating_income: readNumber(raw.ttm_operating_income),
    ttm_net_income: readNumber(raw.ttm_net_income),
    ttm_free_cash_flow: readNumber(raw.ttm_free_cash_flow),
    ttm_complete: readBoolean(raw.ttm_complete),
    trailing_pe: readNumber(raw.trailing_pe),
    forward_pe: readNumber(raw.forward_pe),
    valuation_as_of: readString(raw.valuation_as_of),
    last_event_type: readEventType(raw.last_event_type),
    last_event_label: readString(raw.last_event_label),
    last_event_date: readString(raw.last_event_date),
    last_event_status: readEventStatus(raw.last_event_status),
    last_event_source_provider: readString(raw.last_event_source_provider),
    last_event_source_url: readString(raw.last_event_source_url),
    next_event_type: readEventType(raw.next_event_type),
    next_event_label: readString(raw.next_event_label),
    next_event_date: readString(raw.next_event_date),
    next_event_time_utc: readString(raw.next_event_time_utc),
    next_event_status: readEventStatus(raw.next_event_status),
    next_event_source_provider: readString(raw.next_event_source_provider),
    next_event_source_url: readString(raw.next_event_source_url),
    data_state: readDataState(raw.data_state),
    reason_codes: readStringArray(raw.reason_codes),
    updated_at: readString(raw.updated_at),
  }
}

function parseEventRow(raw: JsonRecord): EquityReportingEventRow | null {
  const eventKey = readString(raw.event_key)
  const instrumentKey = readString(raw.instrument_key)
  const ticker = readString(raw.ticker)
  const providerSymbol = readString(raw.provider_symbol)
  const sourceIndex = readString(raw.source_index)
  const eventType = readEventType(raw.event_type)
  const eventDate = readString(raw.event_date)
  const status = readEventStatus(raw.status)
  const sourceProvider = readString(raw.source_provider)
  if (
    !eventKey ||
    !instrumentKey ||
    !ticker ||
    !providerSymbol ||
    !sourceIndex ||
    !eventType ||
    !eventDate ||
    !status ||
    !sourceProvider
  ) {
    return null
  }
  return {
    event_key: eventKey,
    instrument_key: instrumentKey,
    ticker,
    name: readString(raw.name),
    provider_symbol: providerSymbol,
    source_index: sourceIndex,
    currency: readString(raw.currency),
    event_type: eventType,
    event_label: readString(raw.event_label),
    event_date: eventDate,
    event_time_utc: readString(raw.event_time_utc),
    status,
    fiscal_year: readNumber(raw.fiscal_year),
    fiscal_period_end: readString(raw.fiscal_period_end),
    period_kind: readPeriodKind(raw.period_kind),
    filing_date: readString(raw.filing_date),
    match_confidence: readMatchConfidence(raw.match_confidence),
    source_provider: sourceProvider,
    source_url: readString(raw.source_url),
    metadata: readRecord(raw.metadata),
    first_seen_at: readString(raw.first_seen_at),
    last_seen_at: readString(raw.last_seen_at),
    updated_at: readString(raw.updated_at),
  }
}

function parseAnnualRow(raw: JsonRecord): EquityAnnualFinancialRow | null {
  const instrumentKey = readString(raw.instrument_key)
  const fiscalYear = readNumber(raw.fiscal_year)
  const provider = readString(raw.provider)
  if (!instrumentKey || fiscalYear === null || !provider) return null
  return {
    instrument_key: instrumentKey,
    fiscal_year: fiscalYear,
    fiscal_period_end: readString(raw.fiscal_period_end),
    currency: readString(raw.currency),
    revenue: readNumber(raw.revenue),
    ebitda: readNumber(raw.ebitda),
    operating_income: readNumber(raw.operating_income),
    net_income: readNumber(raw.net_income),
    eps_diluted: readNumber(raw.eps_diluted),
    free_cash_flow: readNumber(raw.free_cash_flow),
    provider,
    source_url: readString(raw.source_url),
    updated_at: readString(raw.updated_at),
  }
}

function parseInterimRow(raw: JsonRecord): EquityInterimFinancialRow | null {
  const instrumentKey = readString(raw.instrument_key)
  const fiscalPeriodEnd = readString(raw.fiscal_period_end)
  const fiscalYear = readNumber(raw.fiscal_year)
  const periodKind = readPeriodKind(raw.period_kind)
  const sourceProvider = readString(raw.source_provider)
  if (
    !instrumentKey ||
    !fiscalPeriodEnd ||
    fiscalYear === null ||
    !periodKind ||
    periodKind === 'FY' ||
    !sourceProvider
  ) {
    return null
  }
  return {
    instrument_key: instrumentKey,
    fiscal_period_end: fiscalPeriodEnd,
    fiscal_year: fiscalYear,
    period_kind: periodKind,
    period_months: readNumber(raw.period_months),
    currency: readString(raw.currency),
    revenue: readNumber(raw.revenue),
    ebitda: readNumber(raw.ebitda),
    operating_income: readNumber(raw.operating_income),
    net_income: readNumber(raw.net_income),
    eps_diluted: readNumber(raw.eps_diluted),
    operating_cash_flow: readNumber(raw.operating_cash_flow),
    capital_expenditure: readNumber(raw.capital_expenditure),
    free_cash_flow: readNumber(raw.free_cash_flow),
    data_state: readDataState(raw.data_state),
    reason_codes: readStringArray(raw.reason_codes),
    source_provider: sourceProvider,
    source_url: readString(raw.source_url),
    collected_at: readString(raw.collected_at),
    updated_at: readString(raw.updated_at),
  }
}

function isSchemaPending(error: { message?: string } | null | undefined): boolean {
  const message = error?.message ?? ''
  return /could not find the table|relation .* does not exist|schema cache|PGRST205/i.test(message)
}

async function loadPagedRows(
  supabase: SupabaseClient,
  table: string,
  selector: string
): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(selector)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as unknown as JsonRecord[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

function coverageFor(
  rows: EquityPublicationDashboardRow[],
  events: EquityReportingEventRow[]
): Record<string, EquityPublicationCoverage> {
  const indexes = ['Tous', 'CAC 40', 'S&P 500']
  return Object.fromEntries(
    indexes.map((index) => {
      const scopedRows = index === 'Tous' ? rows : rows.filter((row) => row.source_index === index)
      const scopedEvents = index === 'Tous' ? events : events.filter((event) => event.source_index === index)
      return [
        index,
        {
          total: scopedRows.length,
          ready: scopedRows.filter((row) => row.data_state === 'READY').length,
          partial: scopedRows.filter((row) => row.data_state === 'PARTIAL').length,
          stale: scopedRows.filter((row) => row.data_state === 'STALE').length,
          missing: scopedRows.filter((row) => row.data_state === 'MISSING').length,
          calendar: new Set(scopedEvents.map((event) => event.instrument_key)).size,
          interim: scopedRows.filter((row) => row.interim_period_end !== null).length,
        },
      ]
    })
  )
}

function newestTimestamp(values: Array<string | null>): string | null {
  return values.reduce<string | null>((latest, value) => {
    if (!value) return latest
    if (!latest) return value
    return Date.parse(value) > Date.parse(latest) ? value : latest
  }, null)
}

function parseLastRun(raw: JsonRecord | null): EquityPublicationsLastRun | null {
  if (!raw) return null
  const status = readString(raw.status)
  if (status !== 'RUNNING' && status !== 'SUCCESS' && status !== 'FAILED') return null
  return {
    status,
    started_at: readString(raw.started_at),
    finished_at: readString(raw.finished_at),
    stats: readRecord(raw.stats),
    error: readString(raw.error),
  }
}

export async function loadEquityPublicationsBundle(
  supabase: SupabaseClient
): Promise<EquityPublicationsBundle> {
  const today = new Date()
  const start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
  const end = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate())
  try {
    const [dashboardRaw, eventsResponse, runResponse] = await Promise.all([
      loadPagedRows(supabase, 'equity_publication_dashboard_latest', DASHBOARD_SELECTOR),
      supabase
        .from('equity_reporting_calendar')
        .select(CALENDAR_SELECTOR)
        .gte('event_date', publicationDateKey(start))
        .lte('event_date', publicationDateKey(end))
        .order('event_date', { ascending: true })
        .range(0, 4999),
      supabase
        .from('etl_runs')
        .select('status,started_at,finished_at,stats,error')
        .eq('job_name', 'equity_publications_sync')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (eventsResponse.error) throw eventsResponse.error
    if (runResponse.error) throw runResponse.error
    const rows = dashboardRaw
      .map(parseDashboardRow)
      .filter((row): row is EquityPublicationDashboardRow => row !== null)
      .sort((left, right) => left.ticker.localeCompare(right.ticker, 'en'))
    const events = ((eventsResponse.data ?? []) as unknown as JsonRecord[])
      .map(parseEventRow)
      .filter((row): row is EquityReportingEventRow => row !== null)
    return {
      status: 'READY',
      rows,
      events,
      coverage: coverageFor(rows, events),
      lastUpdateIso: newestTimestamp(rows.map((row) => row.updated_at)),
      lastBackendRun: parseLastRun((runResponse.data ?? null) as JsonRecord | null),
    }
  } catch (error) {
    if (isSchemaPending(error as { message?: string })) {
      return {
        status: 'SCHEMA_PENDING',
        rows: [],
        events: [],
        coverage: coverageFor([], []),
        lastUpdateIso: null,
        lastBackendRun: null,
        message: 'Le contrat Supabase des publications doit être déployé.',
      }
    }
    throw error
  }
}

export async function loadEquityPublicationHistory(
  supabase: SupabaseClient,
  instrumentKey: string
): Promise<EquityPublicationHistory> {
  const [annualResponse, interimResponse, eventsResponse] = await Promise.all([
    supabase
      .from('trident_financial_annual')
      .select('instrument_key,fiscal_year,fiscal_period_end,currency,revenue,ebitda,operating_income,net_income,eps_diluted,free_cash_flow,provider,source_url,updated_at')
      .eq('instrument_key', instrumentKey)
      .order('fiscal_year', { ascending: false })
      .limit(5),
    supabase
      .from('equity_financial_interim')
      .select('instrument_key,fiscal_period_end,fiscal_year,period_kind,period_months,currency,revenue,ebitda,operating_income,net_income,eps_diluted,operating_cash_flow,capital_expenditure,free_cash_flow,data_state,reason_codes,source_provider,source_url,collected_at,updated_at')
      .eq('instrument_key', instrumentKey)
      .order('fiscal_period_end', { ascending: false })
      .limit(8),
    supabase
      .from('equity_reporting_calendar')
      .select(CALENDAR_SELECTOR)
      .eq('instrument_key', instrumentKey)
      .order('event_date', { ascending: false })
      .limit(24),
  ])
  if (annualResponse.error) throw annualResponse.error
  if (interimResponse.error) throw interimResponse.error
  if (eventsResponse.error) throw eventsResponse.error
  return {
    annual: ((annualResponse.data ?? []) as unknown as JsonRecord[])
      .map(parseAnnualRow)
      .filter((row): row is EquityAnnualFinancialRow => row !== null),
    interim: ((interimResponse.data ?? []) as unknown as JsonRecord[])
      .map(parseInterimRow)
      .filter((row): row is EquityInterimFinancialRow => row !== null),
    events: ((eventsResponse.data ?? []) as unknown as JsonRecord[])
      .map(parseEventRow)
      .filter((row): row is EquityReportingEventRow => row !== null),
  }
}
