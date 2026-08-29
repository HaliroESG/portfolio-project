"use client"

import { useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { Activity, AlertTriangle, ChevronDown, Clock, Database, Minus, TrendingDown, TrendingUp, X } from 'lucide-react'
import { resolveFreshness } from '../lib/dataFreshness'
import { isSelectorSchemaError } from '../lib/supabaseSelectorErrors'
import { useOwnerBoundState } from '../lib/useOwnerBoundState'
import { useOwnerScopedSWR } from '../lib/useOwnerScopedSWR'
import { swrOptions, SWR_REFRESH } from '../lib/swrConfig'
import { useDataHealthOwnerReader } from '../lib/dataHealthOwnerReader'

interface HealthItem {
  id: string
  label: string
  timestamp: string | null
  status: 'LIVE' | 'STALE' | 'MISSING'
  ageMinutes: number | null
}

type MetricTone = 'GOOD' | 'WARN' | 'BAD' | 'NEUTRAL'

interface QualityMetric {
  id: string
  label: string
  value: string
  hint: string
  tone: MetricTone
}

interface EtlRun {
  job_name: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  started_at: string
  finished_at?: string | null
  duration_sec?: number | null
  stats?: Record<string, unknown> | null
  error?: string | null
}

type EtlQualityState = 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN'
type TrendDirection = 'UP' | 'FLAT' | 'DOWN' | 'NONE'
type TrendBasis = 'success_rate' | 'coverage' | 'status'

interface EtlRunMetrics {
  coveragePct: number | null
  itemsTotal: number | null
  itemsSuccess: number | null
  itemsFailed: number | null
  successRatePct: number | null
  failRatePct: number | null
  technicalReady: number | null
  technicalBackfilled: number | null
}

interface EtlTrendPoint {
  timestamp: string
  score: number | null
}

interface EtlJobView {
  run: EtlRun
  metrics: EtlRunMetrics
  qualityState: EtlQualityState
  qualityReason: string
  trendDirection: TrendDirection
  trendDelta: number | null
  trendBasis: TrendBasis
  trendPoints: EtlTrendPoint[]
}

type JsonRecord = Record<string, unknown>

const FRESHNESS_SOURCES = [
  { id: 'market', label: 'Market Watch', table: 'market_watch', field: 'last_update', staleAfterMinutes: 36 * 60, marketAware: true },
  { id: 'valuations', label: 'Valuation Snapshots', table: 'valuation_snapshots', field: 'created_at', staleAfterMinutes: 7 * 24 * 60, marketAware: false },
  { id: 'news', label: 'News Feed', table: 'news_feed', field: 'published_at', staleAfterMinutes: 48 * 60, marketAware: false },
  { id: 'macro', label: 'Macro Indicators', table: 'macro_indicators', field: 'last_update', staleAfterMinutes: 36 * 60, marketAware: true },
  { id: 'macro-series', label: 'Macro Series', table: 'macro_series_latest', field: 'updated_at', staleAfterMinutes: 36 * 60, marketAware: false },
  { id: 'macro-regime', label: 'Macro Regime', table: 'macro_regime_snapshots', field: 'updated_at', staleAfterMinutes: 36 * 60, marketAware: false },
  { id: 'macro-targets', label: 'Macro Targets', table: 'macro_satellite_targets_latest', field: 'updated_at', staleAfterMinutes: 36 * 60, marketAware: false },
  { id: 'trident-insights', label: 'Trident Insights', table: 'trident_stock_insights', field: 'updated_at', staleAfterMinutes: 24 * 60, marketAware: false },
  { id: 'equity-publications', label: 'Equity Publications', table: 'equity_publication_dashboard_latest', field: 'updated_at', staleAfterMinutes: 36 * 60, marketAware: false },
] as const

const ETL_HISTORY_LIMIT = 120
const ETL_TREND_POINTS = 8
const GITHUB_ACTIONS_URL = 'https://github.com/HaliroESG/portfolio-project/actions'
const VERCEL_DASHBOARD_URL = 'https://vercel.com/dashboard'

const ETL_QUALITY_THRESHOLDS = {
  failRateWarnPct: 5,
  failRateCriticalPct: 15,
  coverageWarnPct: 85,
  coverageCriticalPct: 70,
} as const

let QUALITY_MARKET_WATCH_SELECTOR_CACHE: string | null = null
const QUALITY_MARKET_WATCH_BAD_SELECTORS = new Set<string>()
const MARKET_WATCH_TECHNICAL_COLUMNS = [
  'macd_line',
  'macd_signal',
  'macd_hist',
  'rsi_14',
  'momentum_20',
  'trend_state',
  'trend_changed',
] as const
let MARKET_WATCH_TECHNICAL_SCHEMA_AVAILABLE: boolean | null = null

function computeStatus(
  ts: string | null,
  staleAfterMinutes = 60,
  marketAware = false
): { status: HealthItem['status']; ageMinutes: number | null } {
  const freshness = resolveFreshness(ts, staleAfterMinutes, { marketAware })
  return { status: freshness.state, ageMinutes: freshness.ageMinutes }
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error ?? '')
}

function isMissingSchemaError(error: unknown): boolean {
  const message = errorMessage(error)
  return /could not find the table|schema cache|relation .* does not exist|PGRST205/i.test(message)
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'n/a'
  return `${value.toFixed(1)}%`
}

function toneForHighIsGood(value: number | null, goodAt: number, warnAt: number): MetricTone {
  if (value === null) return 'NEUTRAL'
  if (value >= goodAt) return 'GOOD'
  if (value >= warnAt) return 'WARN'
  return 'BAD'
}

function toneForLowIsGood(value: number | null, goodAtOrBelow: number, warnAtOrBelow: number): MetricTone {
  if (value === null) return 'NEUTRAL'
  if (value <= goodAtOrBelow) return 'GOOD'
  if (value <= warnAtOrBelow) return 'WARN'
  return 'BAD'
}

function toneClasses(tone: MetricTone): string {
  if (tone === 'GOOD') return 'border-green-400/50 bg-green-50 dark:bg-green-950/20'
  if (tone === 'WARN') return 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/20'
  if (tone === 'BAD') return 'border-red-400/60 bg-red-50 dark:bg-red-950/20'
  return 'border-slate-300/60 bg-slate-50 dark:bg-slate-900/40'
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function extractEtlMetrics(run: EtlRun): EtlRunMetrics {
  const itemsTotalRaw = readNumber(run.stats?.items_total) ?? readNumber(run.stats?.assets_total)
  const itemsSuccessRaw =
    readNumber(run.stats?.items_success) ??
    readNumber(run.stats?.tickers_ok) ??
    readNumber(run.stats?.updated)
  const itemsFailedRaw =
    readNumber(run.stats?.items_failed) ??
    readNumber(run.stats?.tickers_failed) ??
    readNumber(run.stats?.failed)

  const itemsTotal =
    itemsTotalRaw !== null
      ? itemsTotalRaw
      : itemsSuccessRaw !== null && itemsFailedRaw !== null
      ? itemsSuccessRaw + itemsFailedRaw
      : null
  const itemsSuccess =
    itemsSuccessRaw !== null
      ? itemsSuccessRaw
      : itemsTotal !== null && itemsFailedRaw !== null
      ? Math.max(itemsTotal - itemsFailedRaw, 0)
      : null
  const itemsFailed =
    itemsFailedRaw !== null
      ? itemsFailedRaw
      : itemsTotal !== null && itemsSuccessRaw !== null
      ? Math.max(itemsTotal - itemsSuccessRaw, 0)
      : null

  const successRatePct =
    itemsTotal !== null && itemsTotal > 0 && itemsSuccess !== null ? clampPct((itemsSuccess / itemsTotal) * 100) : null
  const failRatePct =
    itemsTotal !== null && itemsTotal > 0 && itemsFailed !== null ? clampPct((itemsFailed / itemsTotal) * 100) : null

  return {
    coveragePct: readNumber(run.stats?.coverage_pct),
    itemsTotal,
    itemsSuccess,
    itemsFailed,
    successRatePct,
    failRatePct,
    technicalReady: readNumber(run.stats?.technical_ready),
    technicalBackfilled: readNumber(run.stats?.technical_backfilled),
  }
}

function classifyEtlQuality(run: EtlRun, metrics: EtlRunMetrics): { state: EtlQualityState; reason: string } {
  if (run.status === 'FAILED') {
    return { state: 'CRITICAL', reason: 'Run failed.' }
  }
  if (run.status === 'RUNNING') {
    return { state: 'WARNING', reason: 'Run in progress.' }
  }

  let state: EtlQualityState = 'OK'
  const reasons: string[] = []

  if (metrics.failRatePct !== null) {
    if (metrics.failRatePct >= ETL_QUALITY_THRESHOLDS.failRateCriticalPct) {
      state = 'CRITICAL'
      reasons.push(`Fail rate ${metrics.failRatePct.toFixed(1)}% >= ${ETL_QUALITY_THRESHOLDS.failRateCriticalPct}%.`)
    } else if (metrics.failRatePct >= ETL_QUALITY_THRESHOLDS.failRateWarnPct) {
      state = 'WARNING'
      reasons.push(`Fail rate ${metrics.failRatePct.toFixed(1)}% >= ${ETL_QUALITY_THRESHOLDS.failRateWarnPct}%.`)
    }
  }

  if (metrics.coveragePct !== null) {
    if (metrics.coveragePct < ETL_QUALITY_THRESHOLDS.coverageCriticalPct) {
      state = 'CRITICAL'
      reasons.push(`Coverage ${metrics.coveragePct.toFixed(1)}% < ${ETL_QUALITY_THRESHOLDS.coverageCriticalPct}%.`)
    } else if (metrics.coveragePct < ETL_QUALITY_THRESHOLDS.coverageWarnPct) {
      if (state !== 'CRITICAL') state = 'WARNING'
      reasons.push(`Coverage ${metrics.coveragePct.toFixed(1)}% < ${ETL_QUALITY_THRESHOLDS.coverageWarnPct}%.`)
    }
  }

  if (reasons.length === 0) {
    if (metrics.successRatePct !== null || metrics.coveragePct !== null) {
      return { state, reason: 'Within configured thresholds.' }
    }
    return { state: 'UNKNOWN', reason: 'No canonical quality ratios available.' }
  }

  return { state, reason: reasons.join(' ') }
}

function scoreRunForTrend(run: EtlRun, metrics: EtlRunMetrics): { score: number | null; basis: TrendBasis } {
  if (run.status === 'FAILED') return { score: 0, basis: 'status' }
  if (metrics.successRatePct !== null) return { score: metrics.successRatePct, basis: 'success_rate' }
  if (metrics.coveragePct !== null) return { score: metrics.coveragePct, basis: 'coverage' }
  if (run.status === 'SUCCESS') return { score: 100, basis: 'status' }
  return { score: null, basis: 'status' }
}

function resolveTrendBasis(runs: EtlRun[]): TrendBasis {
  if (runs.some((run) => extractEtlMetrics(run).successRatePct !== null)) return 'success_rate'
  if (runs.some((run) => extractEtlMetrics(run).coveragePct !== null)) return 'coverage'
  return 'status'
}

function buildTrendForRuns(runs: EtlRun[]): {
  points: EtlTrendPoint[]
  direction: TrendDirection
  delta: number | null
  basis: TrendBasis
} {
  const recent = runs.slice(0, ETL_TREND_POINTS).reverse()
  const basis = resolveTrendBasis(recent)
  const points = recent.map((run) => {
    const metrics = extractEtlMetrics(run)
    const scored = scoreRunForTrend(run, metrics)
    return { timestamp: run.started_at, score: scored.score }
  })

  const validScores = points
    .map((point) => point.score)
    .filter((score): score is number => score !== null)

  if (validScores.length < 4) {
    return { points, direction: 'NONE', delta: null, basis }
  }

  const half = Math.floor(validScores.length / 2)
  const olderAvg = mean(validScores.slice(0, half))
  const newerAvg = mean(validScores.slice(half))
  if (olderAvg === null || newerAvg === null) {
    return { points, direction: 'NONE', delta: null, basis }
  }

  const delta = newerAvg - olderAvg
  if (delta > 2) return { points, direction: 'UP', delta, basis }
  if (delta < -2) return { points, direction: 'DOWN', delta, basis }
  return { points, direction: 'FLAT', delta, basis }
}

function buildEtlJobViews(runs: EtlRun[]): EtlJobView[] {
  const byJob = new Map<string, EtlRun[]>()

  runs.forEach((run) => {
    const existing = byJob.get(run.job_name) ?? []
    existing.push(run)
    byJob.set(run.job_name, existing)
  })

  const severityRank: Record<EtlQualityState, number> = {
    CRITICAL: 0,
    WARNING: 1,
    UNKNOWN: 2,
    OK: 3,
  }

  return Array.from(byJob.entries())
    .map(([jobName, jobRuns]) => {
      const latest = jobRuns[0]
      const metrics = extractEtlMetrics(latest)
      const quality = classifyEtlQuality(latest, metrics)
      const trend = buildTrendForRuns(jobRuns)
      return {
        run: { ...latest, job_name: jobName },
        metrics,
        qualityState: quality.state,
        qualityReason: quality.reason,
        trendDirection: trend.direction,
        trendDelta: trend.delta,
        trendBasis: trend.basis,
        trendPoints: trend.points,
      } as EtlJobView
    })
    .sort((left, right) => {
      const leftRank = severityRank[left.qualityState]
      const rightRank = severityRank[right.qualityState]
      if (leftRank !== rightRank) return leftRank - rightRank
      return left.run.job_name.localeCompare(right.run.job_name, 'en', { sensitivity: 'base' })
    })
}

function qualityStateStyles(state: EtlQualityState): string {
  if (state === 'OK') return 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-300'
  if (state === 'WARNING') return 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300'
  if (state === 'CRITICAL') return 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-300'
  return 'bg-slate-200 text-slate-600 border-slate-300 dark:bg-slate-800/60 dark:text-gray-300'
}

function qualityCardStyles(state: EtlQualityState): string {
  if (state === 'OK') return 'border-green-400/50 bg-green-50 dark:bg-green-950/20'
  if (state === 'WARNING') return 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/20'
  if (state === 'CRITICAL') return 'border-red-400/60 bg-red-50 dark:bg-red-950/20'
  return 'border-slate-300/60 bg-slate-50 dark:bg-slate-900/40'
}

function trendBasisLabel(basis: TrendBasis): string {
  if (basis === 'success_rate') return 'success rate'
  if (basis === 'coverage') return 'coverage'
  return 'status score'
}

function trendDirectionLabel(direction: TrendDirection): string {
  if (direction === 'UP') return 'improving'
  if (direction === 'DOWN') return 'degrading'
  if (direction === 'FLAT') return 'stable'
  return 'insufficient history'
}

async function fetchFreshnessItems(): Promise<HealthItem[]> {
  const items = await Promise.all(
    FRESHNESS_SOURCES.map(async (source) => {
      try {
        const { data, error } = await supabase
          .from(source.table)
          .select(source.field)
          .order(source.field, { ascending: false })
          .limit(1)
          .maybeSingle()

        if (error) throw error

        const row = (data ?? null) as JsonRecord | null
        const timestamp = readString(row?.[source.field])
        const { status, ageMinutes } = computeStatus(
          timestamp,
          source.staleAfterMinutes,
          Boolean(source.marketAware)
        )
        return {
          id: source.id,
          label: source.label,
          timestamp,
          status,
          ageMinutes,
        }
      } catch (error) {
        if (
          !(
            (source.id === 'trident-insights' || source.id === 'equity-publications' || source.id.startsWith('macro-')) &&
            isMissingSchemaError(error)
          )
        ) {
          console.error('Data health fetch error', source.id, error)
        }
        const fallbackItem: HealthItem = {
          id: source.id,
          label: source.label,
          timestamp: null,
          status: 'MISSING',
          ageMinutes: null,
        }
        return fallbackItem
      }
    })
  )

  return items
}

async function fetchRecentEtlRuns(): Promise<EtlRun[]> {
  try {
    const { data, error } = await supabase
      .from('etl_runs')
      .select('job_name,status,started_at,finished_at,duration_sec,stats,error')
      .order('started_at', { ascending: false })
      .limit(ETL_HISTORY_LIMIT)

    if (error) throw error
    return (data ?? []) as EtlRun[]
  } catch (error) {
    console.error('ETL run fetch error', error)
    return []
  }
}

async function detectMarketWatchTechnicalSchema(): Promise<boolean> {
  if (MARKET_WATCH_TECHNICAL_SCHEMA_AVAILABLE !== null) {
    return MARKET_WATCH_TECHNICAL_SCHEMA_AVAILABLE
  }

  try {
    const selector = MARKET_WATCH_TECHNICAL_COLUMNS.join(',')
    const { error } = await supabase.from('market_watch').select(selector).limit(1)
    MARKET_WATCH_TECHNICAL_SCHEMA_AVAILABLE = !error
    return MARKET_WATCH_TECHNICAL_SCHEMA_AVAILABLE
  } catch {
    MARKET_WATCH_TECHNICAL_SCHEMA_AVAILABLE = false
    return false
  }
}

async function fetchQualityMetrics(valuationCoveragePct: number | null): Promise<QualityMetric[]> {
  let marketRows: JsonRecord[] = []
  const technicalColumnsAvailable = await detectMarketWatchTechnicalSchema()
  const selectors = [
    'ticker,last_price,data_status,last_update,rsi_14,macd_line,macd_signal,momentum_20',
    'ticker,last_price,data_status,last_update',
  ]
  const cachedSelector = QUALITY_MARKET_WATCH_SELECTOR_CACHE
  const orderedSelectors = (cachedSelector
    ? [cachedSelector, ...selectors.filter((selector) => selector !== cachedSelector)]
    : technicalColumnsAvailable
    ? selectors
    : [selectors[1]]).filter((selector) => !QUALITY_MARKET_WATCH_BAD_SELECTORS.has(selector))

  for (const selector of orderedSelectors) {
    const { data, error } = await supabase.from('market_watch').select(selector).limit(600)
    if (error) {
      if (isSelectorSchemaError(error)) {
        QUALITY_MARKET_WATCH_BAD_SELECTORS.add(selector)
      }
      continue
    }
    marketRows = (data ?? []) as unknown as JsonRecord[]
    QUALITY_MARKET_WATCH_SELECTOR_CACHE = selector
    break
  }

  const totalAssets = marketRows.length
  let pricedAssets = 0
  let nonOkAssets = 0
  let technicalReadyAssets = 0

  marketRows.forEach((row) => {
    const price = readNumber(row.last_price)
    if (price !== null && price > 0) {
      pricedAssets += 1
    }

    const status = readString(row.data_status)
    if (status && status !== 'OK') {
      nonOkAssets += 1
    }

    if (technicalColumnsAvailable) {
      const rsi = readNumber(row.rsi_14)
      const macdLine = readNumber(row.macd_line)
      const macdSignal = readNumber(row.macd_signal)
      const momentum = readNumber(row.momentum_20)
      if (rsi !== null && macdLine !== null && macdSignal !== null && momentum !== null) {
        technicalReadyAssets += 1
      }
    }
  })

  const pricedPct = totalAssets > 0 ? (pricedAssets / totalAssets) * 100 : null
  const nonOkPct = totalAssets > 0 ? (nonOkAssets / totalAssets) * 100 : null
  const technicalPct =
    technicalColumnsAvailable && totalAssets > 0 ? (technicalReadyAssets / totalAssets) * 100 : null

  const metrics: QualityMetric[] = [
    {
      id: 'priced-assets',
      label: 'Priced Assets',
      value: totalAssets > 0 ? `${pricedAssets}/${totalAssets} (${formatPercent(pricedPct)})` : 'n/a',
      hint: 'Assets with positive market price in market_watch.',
      tone: toneForHighIsGood(pricedPct, 95, 85),
    },
    {
      id: 'technical-coverage',
      label: 'Technical Coverage',
      value:
        technicalPct !== null && totalAssets > 0
          ? `${technicalReadyAssets}/${totalAssets} (${formatPercent(technicalPct)})`
          : 'n/a',
      hint: technicalColumnsAvailable
        ? 'Assets with RSI, MACD line/signal, and Momentum available.'
        : 'Technical columns unavailable in current schema.',
      tone: toneForHighIsGood(technicalPct, 80, 60),
    },
    {
      id: 'non-ok-status',
      label: 'Non-OK Data',
      value: totalAssets > 0 ? `${nonOkAssets}/${totalAssets} (${formatPercent(nonOkPct)})` : 'n/a',
      hint: 'Assets flagged STALE, LOW_CONFIDENCE, or PARTIAL.',
      tone: toneForLowIsGood(nonOkPct, 5, 15),
    },
    {
      id: 'valuation-coverage',
      label: 'Valuation Coverage',
      value: formatPercent(valuationCoveragePct),
      hint: 'Latest valuation_snapshots.coverage_pct.',
      tone: toneForHighIsGood(valuationCoveragePct, 95, 85),
    },
  ]

  try {
    const [regimeResult, targetsResult, seriesResult] = await Promise.all([
      supabase
        .from('macro_regime_snapshots')
        .select('regime,regime_state,confidence,updated_at')
        .order('as_of_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('macro_satellite_targets_latest')
        .select('bucket_key,data_state,is_blocked', { count: 'exact' }),
      supabase
        .from('macro_series_latest')
        .select('series_id,data_state', { count: 'exact' }),
    ])
    const macroError = regimeResult.error ?? targetsResult.error ?? seriesResult.error
    if (macroError) throw macroError
    const regimeRow = (regimeResult.data ?? null) as JsonRecord | null
    const targetRows = (targetsResult.data ?? []) as unknown as JsonRecord[]
    const seriesRows = (seriesResult.data ?? []) as unknown as JsonRecord[]
    const confidence = readNumber(regimeRow?.confidence)
    const blockedTargets = targetRows.filter((row) => row.is_blocked === true).length
    const nonReadySeries = seriesRows.filter((row) => readString(row.data_state) !== 'READY').length
    metrics.push({
      id: 'macro-regime',
      label: 'Macro Regime',
      value: regimeRow
        ? `${readString(regimeRow.regime) ?? 'UNKNOWN'} · ${confidence !== null ? `${confidence}%` : 'n/a'}`
        : 'sync pending',
      hint: `${targetRows.length} satellite targets, ${blockedTargets} trend-blocked, ${nonReadySeries} non-ready series.`,
      tone:
        !regimeRow
          ? 'WARN'
          : readString(regimeRow.regime_state) === 'READY'
          ? toneForHighIsGood(confidence, 70, 50)
          : 'WARN',
    })
  } catch {
    metrics.push({
      id: 'macro-regime',
      label: 'Macro Regime',
      value: 'schema pending',
      hint: 'macro_series_latest, macro_regime_snapshots, or macro_satellite_targets_latest is not readable yet.',
      tone: 'BAD',
    })
  }

  try {
    const { data, error } = await supabase
      .from('equity_publication_dashboard_latest')
      .select('instrument_key,source_index,data_state,interim_period_end,next_event_date')
      .limit(1000)
    if (error) throw error
    const rows = (data ?? []) as unknown as JsonRecord[]
    const ready = rows.filter((row) => readString(row.data_state) === 'READY').length
    const interim = rows.filter((row) => readString(row.interim_period_end) !== null).length
    const calendar = rows.filter((row) => readString(row.next_event_date) !== null).length
    const readyPct = rows.length > 0 ? (ready / rows.length) * 100 : null
    metrics.push({
      id: 'equity-publications',
      label: 'Equity Publications',
      value: rows.length > 0 ? `${ready}/${rows.length} ready` : 'sync pending',
      hint: `${interim} interim histories and ${calendar} upcoming publication dates across CAC 40 / S&P 500.`,
      tone: rows.length > 0 ? toneForHighIsGood(readyPct, 75, 50) : 'WARN',
    })
  } catch {
    metrics.push({
      id: 'equity-publications',
      label: 'Equity Publications',
      value: 'schema pending',
      hint: 'equity_publication_dashboard_latest is not readable yet.',
      tone: 'BAD',
    })
  }

  try {
    const freshCutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [totalResult, freshResult, aiResult] = await Promise.all([
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

    const insightError = totalResult.error ?? freshResult.error ?? aiResult.error
    if (insightError) throw insightError

    const totalInsights = totalResult.count ?? 0
    const freshInsights = freshResult.count ?? 0
    const aiReadyInsights = aiResult.count ?? 0
    const freshPct = totalInsights > 0 ? (freshInsights / totalInsights) * 100 : null
    metrics.push({
      id: 'trident-insights',
      label: 'Trident Insights',
      value:
        totalInsights > 0
          ? `${freshInsights}/${totalInsights} fresh · ${aiReadyInsights} AI`
          : 'sync pending',
      hint: 'Generated company profile, analyst consensus, trend facts, and AI trend brief rows.',
      tone: totalInsights > 0 ? toneForHighIsGood(freshPct, 80, 50) : 'WARN',
    })
  } catch {
    metrics.push({
      id: 'trident-insights',
      label: 'Trident Insights',
      value: 'schema pending',
      hint: 'trident_stock_insights is not available to the frontend yet.',
      tone: 'BAD',
    })
  }

  try {
    const { data, error } = await supabase
      .from('etl_runs')
      .select('status,finished_at,stats')
      .eq('job_name', 'equity_screener_sync')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    const row = (data ?? null) as Pick<EtlRun, 'status' | 'finished_at' | 'stats'> | null
    const stats = row?.stats ?? null
    const totalRows = readNumber(stats?.items_total)
    const financialsCoveragePct = readNumber(stats?.financials_coverage_pct)
    const insightsCoveragePct = readNumber(stats?.insights_coverage_pct)
    const priceHistoryCoveragePct = readNumber(stats?.price_history_coverage_pct)
    const fxCoveragePct = readNumber(stats?.fx_coverage_pct)
    const duplicateGroups = readNumber(stats?.duplicate_groups)
    const unresolvedDuplicateGroups = readNumber(stats?.unresolved_duplicate_groups) ?? duplicateGroups
    const duplicatesSuppressed = readNumber(stats?.duplicates_suppressed)
    const staleRows = readNumber(stats?.stale_row_count)
    const qualityGateFailureValue = stats?.quality_gate_failures
    const qualityGateFailures = Array.isArray(qualityGateFailureValue)
      ? qualityGateFailureValue.length
      : readNumber(qualityGateFailureValue)
    const qualityGateWarningValue = stats?.quality_gate_warnings
    const qualityGateWarnings = Array.isArray(qualityGateWarningValue)
      ? qualityGateWarningValue.length
      : readNumber(qualityGateWarningValue)

    metrics.push(
      {
        id: 'screener-financials',
        label: 'Screener Financials',
        value: totalRows !== null ? `${formatPercent(financialsCoveragePct)} of ${Math.round(totalRows)}` : formatPercent(financialsCoveragePct),
        hint: 'Open screener rows with usable financial statement metrics. Threshold v1: >= 90%.',
        tone: toneForHighIsGood(financialsCoveragePct, 90, 80),
      },
      {
        id: 'screener-insights',
        label: 'Screener Insights',
        value: formatPercent(insightsCoveragePct),
        hint: 'Open screener rows enriched by trident_stock_insights. Warning threshold v1: >= 90%.',
        tone: toneForHighIsGood(insightsCoveragePct, 90, 80),
      },
      {
        id: 'screener-price-history',
        label: 'Price History',
        value: formatPercent(priceHistoryCoveragePct),
        hint: 'Active universe rows with price history available for regression. Warning threshold v1: >= 95%.',
        tone: toneForHighIsGood(priceHistoryCoveragePct, 95, 85),
      },
      {
        id: 'screener-fx',
        label: 'FX Coverage',
        value: formatPercent(fxCoveragePct),
        hint: 'Rows with market cap USD conversion available through currencies.rate_to_eur. Warning threshold v1: >= 95%.',
        tone: toneForHighIsGood(fxCoveragePct, 95, 85),
      },
      {
        id: 'screener-duplicates',
        label: 'Unresolved Duplicates',
        value:
          unresolvedDuplicateGroups !== null
            ? `${Math.round(unresolvedDuplicateGroups)} groups`
            : 'n/a',
        hint: `Duplicate source groups suppressed: ${
          duplicatesSuppressed !== null ? Math.round(duplicatesSuppressed) : 'n/a'
        }. Stale rows: ${staleRows !== null ? Math.round(staleRows) : 'n/a'}.`,
        tone: toneForLowIsGood(unresolvedDuplicateGroups, 0, 2),
      },
      {
        id: 'screener-quality-gate',
        label: 'Screener Gate',
        value: row?.status
          ? `${row.status}${qualityGateFailures ? ` · ${qualityGateFailures} failures` : ''}${qualityGateWarnings ? ` · ${qualityGateWarnings} warnings` : ''}`
          : 'sync pending',
        hint: 'Critical checks: zero unresolved canonical duplicates and financials >= 90%. Warnings track insights >= 90%, price history >= 95%, and FX >= 95%.',
        tone:
          row?.status === 'FAILED' || (qualityGateFailures !== null && qualityGateFailures > 0)
            ? 'BAD'
            : qualityGateWarnings !== null && qualityGateWarnings > 0
            ? 'WARN'
            : row?.status === 'SUCCESS'
            ? 'GOOD'
            : 'WARN',
      },
    )
  } catch {
    metrics.push({
      id: 'screener-quality-gate',
      label: 'Screener Gate',
      value: 'schema pending',
      hint: 'Latest equity_screener_sync stats are not available to the frontend yet.',
      tone: 'BAD',
    })
  }

  return metrics
}

function shortError(error: string | null | undefined): string {
  if (!error) return 'No error details.'
  return error.length > 140 ? `${error.slice(0, 140)}...` : error
}

function operationActionForRun(run: EtlRun): string {
  const jobName = run.job_name.toLowerCase()
  if (jobName.includes('equity_publications')) {
    return 'Run equity_publications_sync daily for dates and weekly in full mode for interim financials.'
  }
  if (jobName.includes('macro_regime')) {
    return 'Run macro_regime_sync after macro indicators and market_watch technicals are fresh.'
  }
  if (jobName.includes('historical_prices_trident')) {
    return 'Run Financial Data Sync with scope=trident, trident_mode=full, and a backend service_role key.'
  }
  if (jobName.includes('trident_stock_insights')) {
    return 'Run Trident Stock Insights Sync with top_n=200 after the Supabase schema is applied.'
  }
  if (jobName.includes('macro')) {
    return 'Run the macro refresh and verify macro_indicators freshness after completion.'
  }
  if (jobName.includes('bridge')) {
    return 'Run bridge_sync after market history is available, then verify technical coverage.'
  }
  if (jobName.includes('news')) {
    return 'Run news_sync and verify macro/high-impact news is available.'
  }
  return 'Open the latest GitHub Actions run, fix the failing step, then rerun the data refresh.'
}

function operationAction(view: EtlJobView): string {
  if (view.run.status === 'FAILED' || view.qualityState === 'CRITICAL') {
    return operationActionForRun(view.run)
  }
  if (view.metrics.technicalReady !== null && view.metrics.technicalReady === 0) {
    return 'Backfill market_watch technical indicators or mark the rows explicitly non-calculable.'
  }
  if (view.metrics.coveragePct !== null && view.metrics.coveragePct < ETL_QUALITY_THRESHOLDS.coverageWarnPct) {
    return 'Increase provider coverage, then rerun the same job and compare the coverage trend.'
  }
  return 'Monitor the next scheduled refresh.'
}

export function DataHealthPanel() {
  const {
    ownerUserId,
    ownerError,
    valuationCoveragePct,
    valuationError,
    valuationLoading,
  } = useDataHealthOwnerReader()
  const [expanded, setExpanded] = useOwnerBoundState(ownerUserId, false)

  const { data, error: healthError } = useOwnerScopedSWR(
    valuationLoading ? null : ownerUserId,
    'data-health-panel',
    [valuationCoveragePct],
    async () => {
      const [freshnessItems, recentEtlRuns, metrics] = await Promise.all([
        fetchFreshnessItems(),
        fetchRecentEtlRuns(),
        fetchQualityMetrics(valuationCoveragePct),
      ])
      return {
        items: freshnessItems,
        etlJobViews: buildEtlJobViews(recentEtlRuns),
        qualityMetrics: metrics,
      }
    },
    swrOptions(SWR_REFRESH.MEDIUM),
  )
  const items = useMemo(() => data?.items ?? [], [data?.items])
  const etlJobViews = useMemo(() => data?.etlJobViews ?? [], [data?.etlJobViews])
  const qualityMetrics = useMemo(() => data?.qualityMetrics ?? [], [data?.qualityMetrics])

  const liveCount = useMemo(() => items.filter((i) => i.status === 'LIVE').length, [items])
  const staleCount = useMemo(() => items.filter((i) => i.status === 'STALE').length, [items])
  const missingCount = useMemo(() => items.filter((i) => i.status === 'MISSING').length, [items])
  const criticalEtlCount = useMemo(
    () => etlJobViews.filter((view) => view.qualityState === 'CRITICAL' || view.run.status === 'FAILED').length,
    [etlJobViews]
  )
  const latestFailedRun = useMemo(
    () =>
      etlJobViews
        .map((view) => view.run)
        .filter((run) => run.status === 'FAILED')
        .sort((left, right) => new Date(right.started_at).getTime() - new Date(left.started_at).getTime())[0] ?? null,
    [etlJobViews]
  )
  const collapsedSummary = useMemo(() => {
    if (items.length === 0 && etlJobViews.length === 0) return 'Loading health summary. Details stay collapsed by default.'
    const issueCount = staleCount + missingCount + criticalEtlCount
    if (issueCount === 0) return 'Summary only. Expand for source freshness, quality signals, and ETL runs.'
    return `Summary only. ${issueCount} issue${issueCount > 1 ? 's' : ''} visible in the detailed drilldown.`
  }, [criticalEtlCount, etlJobViews.length, items.length, missingCount, staleCount])

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white/80 p-3 shadow-sm dark:border-white/10 dark:bg-[#0D1117]/70">
      {(ownerError || valuationError || healthError) && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
          Data health is unavailable for the current owner.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-600 dark:text-[#00FF88]" />
            <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-gray-400">Data Operations</h3>
          </div>
          {!expanded && (
            <p className="mt-1 text-[10px] font-mono text-slate-500 dark:text-gray-500">
              {collapsedSummary}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:border-white/10 dark:text-gray-300">
            <Activity className="w-3 h-3" />
            {liveCount}/{items.length || FRESHNESS_SOURCES.length} live
          </span>
          {staleCount > 0 && (
            <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              {staleCount} stale
            </span>
          )}
          {missingCount > 0 && (
            <span className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-gray-300">
              {missingCount} missing
            </span>
          )}
          {criticalEtlCount > 0 && (
            <span className="rounded border border-red-300 bg-red-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
              {criticalEtlCount} ETL critical
            </span>
          )}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600 transition hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
          >
            {expanded ? 'Hide details' : 'Show details'}
            <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
      </div>

      {!expanded && latestFailedRun && (
        <div className="mt-3 rounded-lg border border-red-400/60 bg-red-50 px-3 py-2 text-[11px] font-mono text-red-700 dark:bg-red-950/20 dark:text-red-300">
          <div>Latest ETL failure: {latestFailedRun.job_name} - {shortError(latestFailedRun.error)}</div>
          <div className="mt-1">Action: {operationActionForRun(latestFailedRun)}</div>
        </div>
      )}

      {expanded && (
        <div className="fixed inset-0 z-[80] bg-black/50 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label="Data operations details">
          <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#080A0F]">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/10">
              <div className="flex min-w-0 items-center gap-2">
                <Database className="h-4 w-4 shrink-0 text-blue-600 dark:text-[#00FF88]" />
                <div className="min-w-0">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-700 dark:text-gray-300">Data Operations Details</div>
                  <div className="truncate text-[10px] font-mono text-slate-500 dark:text-gray-500">
                    {liveCount}/{items.length || FRESHNESS_SOURCES.length} live · {criticalEtlCount} ETL critical
                  </div>
                </div>
              </div>
              <div className="ml-auto hidden items-center gap-2 sm:flex">
                <a
                  href={GITHUB_ACTIONS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600 transition hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
                >
                  Actions
                </a>
                <a
                  href={VERCEL_DASHBOARD_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600 transition hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
                >
                  Vercel
                </a>
              </div>
              <button
                type="button"
                aria-label="Close data health details"
                onClick={() => setExpanded(false)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'p-3 rounded-2xl border flex flex-col gap-1 transition-colors',
              item.status === 'LIVE'
                ? 'border-green-400/50 bg-green-50 dark:bg-green-950/20'
                : item.status === 'STALE'
                ? 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/20'
                : 'border-slate-300/60 bg-slate-50 dark:bg-slate-900/40'
            )}
          >
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-gray-300">{item.label}</div>
            <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-slate-700 dark:text-gray-200">
              <Clock className="w-3 h-3" />
              {item.ageMinutes !== null ? `${item.ageMinutes}m ago` : 'N/A'}
            </div>
            <span
              className={cn(
                'self-start px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border',
                item.status === 'LIVE'
                  ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-300'
                  : item.status === 'STALE'
                  ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300'
                  : 'bg-slate-200 text-slate-600 border-slate-300 dark:bg-slate-800/60 dark:text-gray-300'
              )}
            >
              {item.status}
            </span>
          </div>
        ))}
      </div>

      {qualityMetrics.length > 0 && (
        <div className="mt-4 border-t border-slate-200 dark:border-white/5 pt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-gray-400">
              Quality Signals
            </span>
            <span className="text-[9px] font-mono text-slate-500 dark:text-gray-400">sampled from live tables</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {qualityMetrics.map((metric) => (
              <div key={metric.id} className={cn('p-3 rounded-2xl border flex flex-col gap-1', toneClasses(metric.tone))}>
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-gray-300">{metric.label}</div>
                <div className="text-[12px] font-mono font-bold text-slate-700 dark:text-gray-100">{metric.value}</div>
                <div className="text-[9px] text-slate-500 dark:text-gray-400">{metric.hint}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {etlJobViews.length > 0 && (
        <div className="mt-4 border-t border-slate-200 dark:border-white/5 pt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-gray-400">ETL Runs</span>
            <span className="text-[9px] font-mono text-slate-500 dark:text-gray-400">latest per job + recent trend</span>
          </div>
          {latestFailedRun && (
            <div className="mb-3 rounded-xl border border-red-400/60 bg-red-50 dark:bg-red-950/20 p-3">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-red-700 dark:text-red-300">
                <AlertTriangle className="w-3 h-3" />
                Latest Failure: {latestFailedRun.job_name}
              </div>
              <div className="mt-1 text-[10px] font-mono text-red-700/90 dark:text-red-300/90">
                {shortError(latestFailedRun.error)}
              </div>
              <div className="mt-2 text-[10px] font-mono font-bold text-red-700/90 dark:text-red-300/90">
                Action: {operationActionForRun(latestFailedRun)}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {etlJobViews.map((view) => {
              const run = view.run
              const timeRef = run.finished_at || run.started_at
              const { ageMinutes } = computeStatus(timeRef)
              const duration = run.duration_sec ? `${Math.round(run.duration_sec)}s` : 'n/a'
              const coverage = view.metrics.coveragePct !== null ? `${view.metrics.coveragePct.toFixed(1)}%` : null
              const successRate =
                view.metrics.successRatePct !== null ? `${view.metrics.successRatePct.toFixed(1)}%` : null
              const failRate = view.metrics.failRatePct !== null ? `${view.metrics.failRatePct.toFixed(1)}%` : null
              const trendDeltaValue =
                view.trendDelta !== null ? `${view.trendDelta >= 0 ? '+' : ''}${view.trendDelta.toFixed(1)} pts` : null

              return (
                <div
                  key={run.job_name}
                  className={cn('p-3 rounded-2xl border transition-colors flex flex-col gap-1', qualityCardStyles(view.qualityState))}
                >
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-gray-300">{run.job_name}</div>
                  <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-slate-700 dark:text-gray-200">
                    <Clock className="w-3 h-3" />
                    {ageMinutes !== null ? `${ageMinutes}m ago` : 'N/A'} · {duration}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('self-start px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border', qualityStateStyles(view.qualityState))}>
                      {view.qualityState}
                    </span>
                    <span
                      className={cn(
                        'self-start px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border',
                        run.status === 'SUCCESS'
                          ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-300'
                          : run.status === 'FAILED'
                          ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-300'
                          : 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300'
                      )}
                    >
                      {run.status}
                    </span>
                  </div>
                  {(
                    coverage ||
                    successRate ||
                    failRate ||
                    view.metrics.itemsTotal !== null ||
                    view.metrics.itemsSuccess !== null ||
                    view.metrics.itemsFailed !== null ||
                    view.metrics.technicalReady !== null ||
                    view.metrics.technicalBackfilled !== null
                  ) && (
                    <div className="text-[9px] font-mono text-slate-500 dark:text-gray-400">
                      {view.metrics.itemsTotal !== null ? `items ${Math.round(view.metrics.itemsTotal)}` : 'items n/a'}
                      {view.metrics.itemsSuccess !== null ? ` · ok ${Math.round(view.metrics.itemsSuccess)}` : ''}
                      {view.metrics.itemsFailed !== null ? ` · fail ${Math.round(view.metrics.itemsFailed)}` : ''}
                      {successRate ? ` · success ${successRate}` : ''}
                      {failRate ? ` · fail-rate ${failRate}` : ''}
                      {view.metrics.technicalReady !== null ? ` · tech ${Math.round(view.metrics.technicalReady)}` : ''}
                      {view.metrics.technicalBackfilled !== null ? ` · backfill ${Math.round(view.metrics.technicalBackfilled)}` : ''}
                      {coverage ? ` · coverage ${coverage}` : ''}
                    </div>
                  )}
                  <div className="text-[9px] text-slate-600 dark:text-gray-300">{view.qualityReason}</div>
                  <div className="text-[9px] font-mono font-bold text-slate-600 dark:text-gray-300">
                    Action: {operationAction(view)}
                  </div>
                  <div className="mt-1">
                    <div className="flex items-end gap-1 h-8">
                      {view.trendPoints.map((point, index) => (
                        <div
                          key={`${run.job_name}-${point.timestamp}-${index}`}
                          className={cn(
                            'w-2 rounded-sm',
                            point.score === null
                              ? 'bg-slate-300 dark:bg-slate-700'
                              : view.qualityState === 'CRITICAL'
                              ? 'bg-red-400/80'
                              : view.qualityState === 'WARNING'
                              ? 'bg-amber-400/80'
                              : 'bg-green-400/80'
                          )}
                          style={{ height: `${point.score === null ? 20 : Math.max(15, Math.round(clampPct(point.score)))}%` }}
                          title={point.score === null ? 'n/a' : `${point.score.toFixed(1)}%`}
                        />
                      ))}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[9px] font-mono text-slate-500 dark:text-gray-400">
                      {view.trendDirection === 'UP' ? (
                        <TrendingUp className="w-3 h-3 text-green-500 dark:text-green-400" />
                      ) : view.trendDirection === 'DOWN' ? (
                        <TrendingDown className="w-3 h-3 text-red-500 dark:text-red-400" />
                      ) : (
                        <Minus className="w-3 h-3 text-slate-500 dark:text-gray-500" />
                      )}
                      <span>
                        trend {trendDirectionLabel(view.trendDirection)} ({trendBasisLabel(view.trendBasis)}
                        {trendDeltaValue ? ` · ${trendDeltaValue}` : ''})
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
