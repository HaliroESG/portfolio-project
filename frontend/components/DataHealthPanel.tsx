"use client"

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { Activity, AlertTriangle, Clock, Database } from 'lucide-react'

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

type JsonRecord = Record<string, unknown>

const FRESHNESS_SOURCES = [
  { id: 'market', label: 'Market Watch', table: 'market_watch', field: 'last_update' },
  { id: 'valuations', label: 'Valuation Snapshots', table: 'valuation_snapshots', field: 'created_at' },
  { id: 'news', label: 'News Feed', table: 'news_feed', field: 'published_at' },
  { id: 'macro', label: 'Macro Indicators', table: 'macro_indicators', field: 'last_update' },
] as const

function computeStatus(ts: string | null): { status: HealthItem['status']; ageMinutes: number | null } {
  if (!ts) return { status: 'MISSING', ageMinutes: null }
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return { status: 'MISSING', ageMinutes: null }
  const ageMs = Date.now() - date.getTime()
  const ageMinutes = Math.max(0, Math.round(ageMs / 60000))
  if (ageMinutes <= 60) return { status: 'LIVE', ageMinutes }
  return { status: 'STALE', ageMinutes }
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
        const { status, ageMinutes } = computeStatus(timestamp)
        return {
          id: source.id,
          label: source.label,
          timestamp,
          status,
          ageMinutes,
        }
      } catch (error) {
        console.error('Data health fetch error', source.id, error)
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

async function fetchLatestEtlRuns(): Promise<EtlRun[]> {
  try {
    const { data, error } = await supabase
      .from('etl_runs')
      .select('job_name,status,started_at,finished_at,duration_sec,stats,error')
      .order('started_at', { ascending: false })
      .limit(20)

    if (error) throw error

    const latestByJob = new Map<string, EtlRun>()
    ;(data ?? []).forEach((row) => {
      const run = row as EtlRun
      if (!latestByJob.has(run.job_name)) {
        latestByJob.set(run.job_name, run)
      }
    })

    return Array.from(latestByJob.values())
  } catch (error) {
    console.error('ETL run fetch error', error)
    return []
  }
}

async function fetchQualityMetrics(): Promise<QualityMetric[]> {
  let marketRows: JsonRecord[] = []
  let technicalColumnsAvailable = false
  const selectors = [
    'ticker,last_price,data_status,last_update,rsi_14,macd_line,macd_signal,momentum_20',
    'ticker,last_price,data_status,last_update',
  ]

  for (const selector of selectors) {
    const { data, error } = await supabase.from('market_watch').select(selector).limit(600)
    if (error) continue
    marketRows = (data ?? []) as unknown as JsonRecord[]
    technicalColumnsAvailable = selector.includes('rsi_14')
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

  let valuationCoveragePct: number | null = null
  try {
    const { data, error } = await supabase
      .from('valuation_snapshots')
      .select('coverage_pct,created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!error) {
      const row = (data ?? null) as JsonRecord | null
      valuationCoveragePct = readNumber(row?.coverage_pct)
    }
  } catch {
    valuationCoveragePct = null
  }

  return [
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
}

function shortError(error: string | null | undefined): string {
  if (!error) return 'No error details.'
  return error.length > 140 ? `${error.slice(0, 140)}...` : error
}

export function DataHealthPanel() {
  const [items, setItems] = useState<HealthItem[]>([])
  const [etlRuns, setEtlRuns] = useState<EtlRun[]>([])
  const [qualityMetrics, setQualityMetrics] = useState<QualityMetric[]>([])

  useEffect(() => {
    async function fetchHealthData() {
      const [freshnessItems, latestEtlRuns, metrics] = await Promise.all([
        fetchFreshnessItems(),
        fetchLatestEtlRuns(),
        fetchQualityMetrics(),
      ])

      setItems(freshnessItems)
      setEtlRuns(latestEtlRuns)
      setQualityMetrics(metrics)
    }

    fetchHealthData()
    const interval = setInterval(fetchHealthData, 180000) // 3 minutes
    return () => clearInterval(interval)
  }, [])

  const liveCount = useMemo(() => items.filter((i) => i.status === 'LIVE').length, [items])
  const latestFailedRun = useMemo(() => etlRuns.find((run) => run.status === 'FAILED') ?? null, [etlRuns])

  return (
    <div className="w-full bg-white dark:bg-[#0D1117]/50 border-2 border-slate-200 dark:border-white/5 rounded-3xl shadow-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-600 dark:text-[#00FF88]" />
          <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-gray-400">Data Health</h3>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-black text-slate-600 dark:text-gray-400">
          <Activity className="w-3 h-3" />
          {liveCount}/{items.length || 4} live
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

      {etlRuns.length > 0 && (
        <div className="mt-4 border-t border-slate-200 dark:border-white/5 pt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-gray-400">ETL Runs</span>
            <span className="text-[9px] font-mono text-slate-500 dark:text-gray-400">latest per job</span>
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
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {etlRuns.map((run) => {
              const timeRef = run.finished_at || run.started_at
              const { ageMinutes } = computeStatus(timeRef)
              const duration = run.duration_sec ? `${Math.round(run.duration_sec)}s` : 'n/a'
              const coveragePct = readNumber(run.stats?.coverage_pct)
              const coverage = coveragePct !== null ? `${coveragePct.toFixed(1)}%` : null
              const itemsTotal = readNumber(run.stats?.items_total) ?? readNumber(run.stats?.assets_total)
              const itemsSuccess =
                readNumber(run.stats?.items_success) ??
                readNumber(run.stats?.tickers_ok) ??
                readNumber(run.stats?.updated)
              const itemsFailed =
                readNumber(run.stats?.items_failed) ??
                readNumber(run.stats?.tickers_failed) ??
                readNumber(run.stats?.failed)
              const technicalReady = readNumber(run.stats?.technical_ready)
              const technicalBackfilled = readNumber(run.stats?.technical_backfilled)

              return (
                <div
                  key={run.job_name}
                  className={cn(
                    'p-3 rounded-2xl border transition-colors flex flex-col gap-1',
                    run.status === 'SUCCESS'
                      ? 'border-green-400/50 bg-green-50 dark:bg-green-950/20'
                      : run.status === 'FAILED'
                      ? 'border-red-400/60 bg-red-50 dark:bg-red-950/20'
                      : 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/20'
                  )}
                >
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-gray-300">{run.job_name}</div>
                  <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-slate-700 dark:text-gray-200">
                    <Clock className="w-3 h-3" />
                    {ageMinutes !== null ? `${ageMinutes}m ago` : 'N/A'} · {duration}
                  </div>
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
                  {(
                    coverage ||
                    itemsTotal !== null ||
                    itemsSuccess !== null ||
                    itemsFailed !== null ||
                    technicalReady !== null ||
                    technicalBackfilled !== null
                  ) && (
                    <div className="text-[9px] font-mono text-slate-500 dark:text-gray-400">
                      {itemsTotal !== null ? `items ${Math.round(itemsTotal)}` : 'items n/a'}
                      {itemsSuccess !== null ? ` · ok ${Math.round(itemsSuccess)}` : ''}
                      {itemsFailed !== null ? ` · fail ${Math.round(itemsFailed)}` : ''}
                      {technicalReady !== null ? ` · tech ${Math.round(technicalReady)}` : ''}
                      {technicalBackfilled !== null ? ` · backfill ${Math.round(technicalBackfilled)}` : ''}
                      {coverage ? ` · coverage ${coverage}` : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
