"use client"

import { useMemo } from 'react'
import useSWR from 'swr'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { Clock, Activity, Database } from 'lucide-react'
import { stateFromTimestamp, stateLabel as dataStateLabel, UnifiedDataState } from '../lib/dataStates'
import { swrOptions } from '../lib/swrConfig'
import { HEALTH_CONFIG } from '../lib/healthConfig'

interface HealthItem {
  id: string
  label: string
  timestamp: string | null
  status: 'LIVE' | 'STALE' | 'MISSING'
  ageMinutes: number | null
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

function computeStatus(ts: string | null, staleAfterMinutes = 60): { status: HealthItem['status']; ageMinutes: number | null } {
  if (!ts) return { status: 'MISSING', ageMinutes: null }
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return { status: 'MISSING', ageMinutes: null }
  const ageMs = Date.now() - date.getTime()
  const ageMinutes = Math.max(0, Math.round(ageMs / 60000))
  const state = stateFromTimestamp(ts, staleAfterMinutes)
  if (state === 'OK') return { status: 'LIVE', ageMinutes }
  if (state === 'STALE') return { status: 'STALE', ageMinutes }
  return { status: 'MISSING', ageMinutes }
}

function pct(value: number, total: number): number {
  if (!total || total <= 0) return 0
  return (value / total) * 100
}

export function DataHealthPanel() {
  const { data, isLoading } = useSWR(
    'health-panel:v2',
    async () => {
      const freshnessConfigs = [
        { id: 'market', label: 'Market Watch', table: 'market_watch', field: 'last_update', staleAfterMinutes: HEALTH_CONFIG.freshnessSlaMinutes.market_watch },
        { id: 'valuations', label: 'Valuation Snapshots', table: 'valuation_snapshots', field: 'created_at', staleAfterMinutes: HEALTH_CONFIG.freshnessSlaMinutes.valuation_snapshots },
        { id: 'news', label: 'News Feed', table: 'news_feed', field: 'published_at', staleAfterMinutes: HEALTH_CONFIG.freshnessSlaMinutes.news_feed },
        { id: 'macro', label: 'Macro Indicators', table: 'macro_indicators', field: 'last_update', staleAfterMinutes: HEALTH_CONFIG.freshnessSlaMinutes.macro_indicators },
      ] as const

      const freshness = await Promise.all(
        freshnessConfigs.map(async (cfg) => {
          try {
            const { data, error } = await supabase
              .from(cfg.table)
              .select(cfg.field)
              .order(cfg.field, { ascending: false })
              .limit(1)
              .maybeSingle()
            if (error) throw error
            const rawTs = data?.[cfg.field as keyof typeof data]
            const ts = typeof rawTs === 'string' ? rawTs : null
            const { status, ageMinutes } = computeStatus(ts, cfg.staleAfterMinutes)
            return { id: cfg.id, label: cfg.label, timestamp: ts, status, ageMinutes }
          } catch {
            return { id: cfg.id, label: cfg.label, timestamp: null, status: 'MISSING' as const, ageMinutes: null }
          }
        })
      )

      const [{ data: etlRows }, { data: mwRows }, { data: coverageRows }] = await Promise.all([
        supabase
          .from('etl_runs')
          .select('job_name,status,started_at,finished_at,duration_sec,stats,error')
          .order('started_at', { ascending: false })
          .limit(20),
        supabase
          .from('market_watch')
          .select('ticker,last_price,data_status,rsi_14,macd_line,momentum_20,last_update')
          .limit(500),
        supabase
          .from('valuation_snapshots')
          .select('coverage_pct,created_at')
          .order('created_at', { ascending: false })
          .limit(7),
      ])

      const latestByJob = new Map<string, EtlRun>()
      ;((etlRows ?? []) as EtlRun[]).forEach((row) => {
        if (!latestByJob.has(row.job_name)) latestByJob.set(row.job_name, row)
      })

      const market = (mwRows ?? []) as Array<{
        ticker: string | null
        last_price: number | null
        data_status: string | null
        rsi_14: number | null
        macd_line: number | null
        momentum_20: number | null
        last_update: string | null
      }>
      const total = market.length
      const nullRate = {
        last_price: pct(market.filter((r) => r.last_price === null).length, total),
        data_status: pct(market.filter((r) => r.data_status === null).length, total),
        rsi_14: pct(market.filter((r) => r.rsi_14 === null).length, total),
        macd_line: pct(market.filter((r) => r.macd_line === null).length, total),
        momentum_20: pct(market.filter((r) => r.momentum_20 === null).length, total),
      }

      const coverageSeries = ((coverageRows ?? []) as Array<{ coverage_pct: number | null; created_at: string }>).filter(
        (x) => typeof x.coverage_pct === 'number'
      )
      const latestCoverage = coverageSeries[0]?.coverage_pct ?? null
      const oldestCoverage = coverageSeries[coverageSeries.length - 1]?.coverage_pct ?? null
      const coverageTrend =
        latestCoverage !== null && oldestCoverage !== null ? Number((latestCoverage - oldestCoverage).toFixed(2)) : null

      return {
        freshness,
        etlRuns: Array.from(latestByJob.values()),
        nullRate,
        coverage: {
          latest: latestCoverage,
          trendDelta: coverageTrend,
          points: coverageSeries.length,
        },
      }
    },
    swrOptions(HEALTH_CONFIG.refreshIntervalMs)
  )

  const items = useMemo(() => data?.freshness ?? [], [data])
  const etlRuns = useMemo(() => data?.etlRuns ?? [], [data])
  const liveCount = useMemo(() => items.filter((i) => i.status === 'LIVE').length, [items])
  const panelState: UnifiedDataState = isLoading ? 'LOADING' : items.length === 0 ? 'EMPTY' : 'OK'

  return (
    <div className="w-full bg-white dark:bg-[#0D1117]/50 border-2 border-slate-200 dark:border-white/5 rounded-3xl shadow-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-600 dark:text-[#00FF88]" />
          <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-gray-400">Data Health</h3>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-black text-slate-600 dark:text-gray-400">
          <Activity className="w-3 h-3" />
          {liveCount}/{items.length || 4} live · {dataStateLabel(panelState)}
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

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded-2xl border border-slate-300/60 bg-slate-50 dark:bg-slate-900/40">
          <div className="text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-gray-300 mb-1">Null-rate (market_watch)</div>
          <div className="text-[11px] font-mono text-slate-600 dark:text-gray-300 space-y-1">
            <div>last_price: {data?.nullRate.last_price?.toFixed(1) ?? '0.0'}% {(data?.nullRate.last_price ?? 0) >= HEALTH_CONFIG.nullRateWarnPct.last_price ? '⚠️' : ''}</div>
            <div>data_status: {data?.nullRate.data_status?.toFixed(1) ?? '0.0'}% {(data?.nullRate.data_status ?? 0) >= HEALTH_CONFIG.nullRateWarnPct.data_status ? '⚠️' : ''}</div>
            <div>rsi_14: {data?.nullRate.rsi_14?.toFixed(1) ?? '0.0'}% {(data?.nullRate.rsi_14 ?? 0) >= HEALTH_CONFIG.nullRateWarnPct.rsi_14 ? '⚠️' : ''}</div>
            <div>macd_line: {data?.nullRate.macd_line?.toFixed(1) ?? '0.0'}% {(data?.nullRate.macd_line ?? 0) >= HEALTH_CONFIG.nullRateWarnPct.macd_line ? '⚠️' : ''}</div>
            <div>momentum_20: {data?.nullRate.momentum_20?.toFixed(1) ?? '0.0'}% {(data?.nullRate.momentum_20 ?? 0) >= HEALTH_CONFIG.nullRateWarnPct.momentum_20 ? '⚠️' : ''}</div>
          </div>
        </div>

        <div className="p-3 rounded-2xl border border-slate-300/60 bg-slate-50 dark:bg-slate-900/40">
          <div className="text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-gray-300 mb-1">Coverage SLA</div>
          <div className="text-[11px] font-mono text-slate-600 dark:text-gray-300 space-y-1">
            <div>latest coverage: {data?.coverage.latest !== null && data?.coverage.latest !== undefined ? `${data.coverage.latest.toFixed(2)}%` : 'N/A'}</div>
            <div>trend (last {data?.coverage.points ?? 0} pts): {data?.coverage.trendDelta !== null && data?.coverage.trendDelta !== undefined ? `${data.coverage.trendDelta >= 0 ? '+' : ''}${data.coverage.trendDelta.toFixed(2)} pts` : 'N/A'}</div>
          </div>
        </div>
      </div>

      {etlRuns.length > 0 && (
        <div className="mt-4 border-t border-slate-200 dark:border-white/5 pt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-gray-400">ETL Runs</span>
            <span className="text-[9px] font-mono text-slate-500 dark:text-gray-400">latest per job</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {etlRuns.map((run) => {
              const timeRef = run.finished_at || run.started_at
              const { ageMinutes } = computeStatus(timeRef)
              const duration = run.duration_sec ? `${Math.round(run.duration_sec)}s` : 'n/a'
              const coverage = typeof run.stats?.coverage_pct === 'number' ? `${run.stats.coverage_pct.toFixed(1)}%` : null
              const assetsTotal = typeof run.stats?.assets_total === 'number' ? run.stats.assets_total : null

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
                  {(coverage || assetsTotal !== null) && (
                    <div className="text-[9px] font-mono text-slate-500 dark:text-gray-400">
                      {assetsTotal !== null ? `assets ${assetsTotal}` : 'assets n/a'}
                      {coverage ? ` · coverage ${coverage}` : ''}
                    </div>
                  )}
                  {run.error && <div className="text-[9px] font-mono text-red-500 dark:text-red-400 truncate">{run.error}</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
