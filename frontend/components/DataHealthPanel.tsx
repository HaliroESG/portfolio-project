"use client"

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { Clock, Activity, Database } from 'lucide-react'

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

function computeStatus(ts: string | null): { status: HealthItem['status']; ageMinutes: number | null } {
  if (!ts) return { status: 'MISSING', ageMinutes: null }
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return { status: 'MISSING', ageMinutes: null }
  const ageMs = Date.now() - date.getTime()
  const ageMinutes = Math.max(0, Math.round(ageMs / 60000))
  if (ageMinutes <= 60) return { status: 'LIVE', ageMinutes }
  if (ageMinutes <= 240) return { status: 'STALE', ageMinutes }
  return { status: 'MISSING', ageMinutes }
}

export function DataHealthPanel() {
  const [items, setItems] = useState<HealthItem[]>([])
  const [etlRuns, setEtlRuns] = useState<EtlRun[]>([])

  useEffect(() => {
    async function fetchFreshness() {
      const configs = [
        { id: 'market', label: 'Market Watch', table: 'market_watch', field: 'last_update' },
        { id: 'valuations', label: 'Valuation Snapshots', table: 'valuation_snapshots', field: 'created_at' },
        { id: 'news', label: 'News Feed', table: 'news_feed', field: 'published_at' },
        { id: 'macro', label: 'Macro Indicators', table: 'macro_indicators', field: 'last_update' },
      ] as const

      const results: HealthItem[] = []

      await Promise.all(
        configs.map(async (cfg) => {
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
            const { status, ageMinutes } = computeStatus(ts)
            results.push({ id: cfg.id, label: cfg.label, timestamp: ts, status, ageMinutes })
          } catch (e) {
            results.push({ id: cfg.id, label: cfg.label, timestamp: null, status: 'MISSING', ageMinutes: null })
            console.error('Data health fetch error', cfg.id, e)
          }
        })
      )

      setItems(results)

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
        setEtlRuns(Array.from(latestByJob.values()))
      } catch (e) {
        console.error('ETL run fetch error', e)
        setEtlRuns([])
      }
    }

    fetchFreshness()
    const interval = setInterval(fetchFreshness, 180000) // 3 minutes
    return () => clearInterval(interval)
  }, [])

  const liveCount = useMemo(() => items.filter((i) => i.status === 'LIVE').length, [items])

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
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
