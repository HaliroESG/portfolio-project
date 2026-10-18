"use client"

import React, { useMemo } from 'react'
import useSWR from 'swr'
import { supabase } from '../../lib/supabase'
import {
  MACRO_INDICATORS_REFRESH_MS,
  MACRO_INDICATORS_SWR_KEY,
  loadMacroIndicators,
  type MacroIndicatorRow,
} from '../../lib/macroData'

import { AppShell } from '../../components/AppShell'
import { MacroHealth } from '../../components/MacroHealth'
import { DataStateBadge, type DataState } from '../../components/DataStateBadge'
import {
  MACRO_STRATEGY_REFRESH_MS,
  MACRO_STRATEGY_SWR_KEY,
  loadMacroStrategy,
  type MacroStrategySnapshot,
} from '../../lib/macroStrategyData'
import { cn } from '../../lib/utils'
import { MACRO_PROVENANCE_NOTICE, macroHealthState, macroInputState, macroStrategyState, macroTargetUsable, pillarState, type PillarStatus } from '../../lib/macroState'
import { latestSourceTimestamp } from '../../lib/readerState'
import type { MacroSatelliteTargetRow, MacroSeriesLatestRow } from '../../types'

import {
  Activity,
  TrendingUp,
  Droplets,
  ShieldAlert,
  BarChart3,
  Compass,
  LockKeyhole,
} from 'lucide-react'

type MacroIndicator = MacroIndicatorRow

interface PillarIndicator {
  label: string
  value: string
  state: string
  trend?: 'UP' | 'DOWN'
  change?: string
}

interface MacroPillarProps {
  title: string
  subtitle: string
  icon: React.ComponentType<{ size?: number }>
  status: PillarStatus
  indicators: PillarIndicator[]
}

function formatValue(value: number | null, decimals = 2, suffix = ''): string {
  if (value === null || !Number.isFinite(value)) return '--'
  return `${value.toFixed(decimals)}${suffix}`
}

function formatChange(changePct: number | null): { trend?: 'UP' | 'DOWN'; change?: string } {
  if (changePct === null || !Number.isFinite(changePct)) return {}
  return {
    trend: changePct >= 0 ? 'UP' : 'DOWN',
    change: `${changePct >= 0 ? '+' : ''}${(changePct * 100).toFixed(2)}%`
  }
}

function formatPctValue(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value.toFixed(digits)}%`
}

function formatSeriesValue(row: MacroSeriesLatestRow): string {
  if (row.value === null) return '--'
  if (row.series_id === 'PAYEMS') return `${row.value.toFixed(0)}k`
  return row.value.toFixed(row.frequency === 'DAILY' ? 2 : 1)
}

function strategyBadgeState(strategy: MacroStrategySnapshot | undefined, loading: boolean, error: unknown): DataState {
  if (error) return 'ERROR'
  if (loading && !strategy) return 'LOADING'
  if (!strategy || strategy.schemaState === 'SCHEMA_PENDING' || !strategy.regime) return 'NO_DATA'
  const state = macroStrategyState(strategy.regime, loading, error)
  return state === 'READY' ? 'LIVE' : state === 'STALE' ? 'STALE' : 'NO_DATA'
}

function regimeClass(regime: string): string {
  if (regime === 'REFLATION') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
  if (regime === 'GOLDILOCKS') return 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-300'
  if (regime === 'STAGFLATION') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'
  if (regime === 'DEFLATION') return 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/20 dark:text-violet-300'
  return 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
}

function targetStateClass(row: MacroSatelliteTargetRow, usable: boolean): string {
  if (usable) return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
  if (row.data_state === 'BLOCKED_TREND') return 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300'
  if (row.data_state === 'TREND_UNKNOWN') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'
  return 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
}

function reasonPreview(codes: string[]): string {
  if (codes.length === 0) return 'Aucun motif fourni par la source'
  return codes.slice(0, 3).join(' · ')
}

function MacroStrategyPanel({
  strategy,
  loading,
  error,
}: {
  strategy: MacroStrategySnapshot | undefined
  loading: boolean
  error: unknown
}) {
  const badgeState = strategyBadgeState(strategy, loading, error)
  const regime = strategy?.regime ?? null
  const targets = strategy?.targets ?? []
  const series = strategy?.series ?? []
  const missingOrPartial = series.filter((row) => row.data_state !== 'READY')
  const strategyState = macroStrategyState(regime, loading, error)
  const targetsUsable = strategyState === 'READY' && series.length > 0 && missingOrPartial.length === 0

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]/70">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-3">
          <Compass className="h-5 w-5 shrink-0 text-blue-600 dark:text-[#00FF88]" />
          <div className="min-w-0">
            <h2 className="text-sm font-black uppercase tracking-tight text-slate-950 dark:text-white">
              Global Macro Strategy
            </h2>
            <p className="mt-1 text-[10px] font-mono text-slate-500 dark:text-gray-400">
              Modèle source Core 70% / Satellite 30% · consultation historique, non activé
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DataStateBadge state={badgeState} label={strategy?.schemaState === 'SCHEMA_PENDING' ? 'Schema pending' : strategyState} />
          <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
            <LockKeyhole className="h-3 w-3" />
            Read only
          </span>
        </div>
      </div>

      {error ? (
        <div className="p-4 text-sm font-medium text-red-700 dark:text-red-300">
          Macro strategy read failed. Verify the macro strategy migration and read grants.
        </div>
      ) : strategy?.schemaState === 'SCHEMA_PENDING' ? (
        <div className="p-4 text-sm font-medium text-amber-700 dark:text-amber-300">
          Apply the macro strategy migration, then run macro_regime_sync to populate regime and satellite targets.
        </div>
      ) : !regime ? (
        <div className="p-4 text-sm font-medium text-slate-600 dark:text-gray-300">
          No macro regime snapshot is available yet.
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
            <div className={cn('rounded-lg border p-4', regimeClass(strategyState === 'READY' ? regime.regime : 'UNKNOWN'))}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest opacity-70">Diagnostic exploitable</div>
                  <div className="mt-1 text-2xl font-black uppercase tracking-tight">{strategyState === 'READY' ? regime.regime : 'Non exploitable'}</div>
                  <div className="mt-2 text-[10px] font-mono font-bold uppercase">
                    {strategyState} · régime source {regime.regime} · état source {regime.regime_state}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <SignalPill label="Growth" value={strategyState === 'READY' ? regime.growth_signal : '--'} />
                  <SignalPill label="Inflation" value={strategyState === 'READY' ? regime.inflation_signal : '--'} />
                  <SignalPill label="Liquidity" value={strategyState === 'READY' ? regime.liquidity_signal : '--'} />
                </div>
              </div>
              <div className="mt-4 text-[10px] font-mono opacity-80">
                {reasonPreview(regime.reason_codes)}
              </div>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer">Détail source historique — non validé pour décision</summary>
                <p className="mt-2">Date métier déclarée : {regime.as_of_date} · collecte : {regime.updated_at ?? 'inconnue'}</p>
                <p>Signaux source : {regime.growth_signal} / {regime.inflation_signal} / {regime.liquidity_signal} · confiance déclarée : {regime.confidence}%</p>
              </details>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-black/20">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-gray-400">Source state</div>
                  <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">
                    {series.length} séries · {missingOrPartial.length} non-ready selon la source
                  </div>
                </div>
                <span className="rounded border border-slate-300 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:border-white/10 dark:text-gray-300">
                  {regime.as_of_date}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {series.slice(0, 6).map((row) => (
                  <div key={row.series_id} className="rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="truncate text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">{row.series_id}</div>
                    <div className="mt-1 text-xs font-mono font-black text-slate-950 dark:text-white">{formatSeriesValue(row)}</div>
                    <div className="mt-0.5 text-[9px] font-mono text-slate-500">État source : {row.data_state} · observation déclarée {row.as_of_date}</div>
                    <div className="mt-0.5 text-[9px] font-mono text-slate-500">{row.source_provider} · collecte {row.collected_at ?? 'inconnue'}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {!targetsUsable && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">Cibles non exploitables : validité métier du régime et de ses cibles non attestée, même si la source indique READY ou une collecte récente. Aucune consigne d’allocation.</p>}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {targets.map((target) => {
              const usable = targetsUsable && macroTargetUsable(regime, target)
              return (
              <article key={target.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-black/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-slate-950 dark:text-white">{target.bucket_label}</div>
                    <div className="mt-1 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                      Proposition source non validée : {target.instrument_symbol ?? 'instrument non renseigné'} · {target.recommended_envelope}
                    </div>
                  </div>
                  <span className={cn('shrink-0 rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', targetStateClass(target, usable))}>
                    {target.data_state === 'READY' && !usable ? 'NON EXPLOITABLE' : target.data_state}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Metric label="Target" value={usable ? formatPctValue(target.target_weight_pct) : '--'} />
                  <Metric label="Effective" value={usable ? formatPctValue(target.effective_weight_pct) : '--'} />
                </div>
                <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-[10px] font-mono text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300">
                  <div>Date métier source : {target.as_of_date} · collecte {target.updated_at ?? 'inconnue'}</div>
                  <div>Tendance source, non exploitable : {target.trend_ticker ?? 'n/a'} · {target.ma200_status ?? target.trend_state}</div>
                  <div className="mt-1">{reasonPreview(target.reason_codes)}</div>
                </div>
              </article>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function SignalPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[68px] rounded-md border border-current/20 px-2 py-2">
      <div className="text-[8px] font-black uppercase tracking-widest opacity-60">{label}</div>
      <div className="mt-1 text-[11px] font-mono font-black uppercase">{value}</div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">{label}</div>
      <div className="mt-1 text-xs font-mono font-black text-slate-950 dark:text-white">{value}</div>
    </div>
  )
}

function MacroPillar({ title, subtitle, icon: Icon, status, indicators }: MacroPillarProps) {
  const statusColors = {
    red: "border-red-500/50 bg-red-50/50 text-red-700 dark:bg-red-950/20 dark:text-red-500 dark:border-red-500/30",
    amber: "border-amber-500/50 bg-amber-50/50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-500 dark:border-amber-500/30",
    green: "border-green-500/50 bg-green-50/50 text-green-700 dark:bg-green-950/20 dark:text-green-500 dark:border-green-500/30",
    unknown: 'border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300',
    stale: 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-slate-900 dark:text-amber-300',
    error: 'border-red-300 bg-red-50 text-red-700 dark:bg-slate-900 dark:text-red-300',
    loading: 'border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300',
  }

  return (
    <div className={`p-6 rounded-3xl border-2 shadow-xl shadow-slate-200/50 dark:shadow-none transition-all duration-500 ${statusColors[status]}`}>
      <div className="flex justify-between items-start mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-current/10">
            <Icon size={24} />
          </div>
          <div>
            <h3 className="text-xl font-black uppercase tracking-tighter leading-none">{title}</h3>
            <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest mt-1">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="w-3 h-3 rounded-full bg-current animate-pulse shadow-[0_0_12px_currentColor]"></div>
          <span className="text-[9px] font-black mt-2 uppercase tracking-tighter">Status: {status}</span>
        </div>
      </div>
      
      <div className="space-y-3">
        {indicators.map((ind) => (
          <div key={ind.label} className="flex justify-between items-center border-b border-current/10 pb-2 group hover:border-current/30 transition-colors">
            <span className="text-[11px] font-bold opacity-70 uppercase tracking-wider">{ind.label}</span>
            <div className="text-right">
              <div className="font-mono font-black text-sm">{ind.value}</div>
              <div className="text-[9px] font-mono text-slate-500">{ind.state}</div>
              {ind.trend && ind.change && (
                 <div data-macro-pillar-change={ind.label} className={`text-[9px] font-bold ${ind.state !== 'READY' ? 'text-slate-500' : ind.trend === 'UP' ? 'text-green-500' : 'text-red-500'}`}>
                    {ind.change}
                 </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MDSSPage() {
  const { data, error: indicatorsError, isLoading: indicatorsLoading } = useSWR(
    MACRO_INDICATORS_SWR_KEY,
    () => loadMacroIndicators(supabase),
    { refreshInterval: MACRO_INDICATORS_REFRESH_MS, revalidateOnFocus: false }
  )
  const {
    data: strategy,
    error: strategyError,
    isLoading: strategyLoading,
  } = useSWR(
    MACRO_STRATEGY_SWR_KEY,
    () => loadMacroStrategy(supabase),
    { refreshInterval: MACRO_STRATEGY_REFRESH_MS, revalidateOnFocus: false }
  )

  const indicators = useMemo(() => data ?? [], [data])

  const indicatorMap = useMemo(() => {
    const map = new Map<string, MacroIndicator>()
    indicators.forEach((indicator) => map.set(indicator.id, indicator))
    return map
  }, [indicators])

  const { lastSync, lastSyncIso } = useMemo(() => {
    const latest = latestSourceTimestamp([
      ...indicators.map((indicator) => indicator.last_update),
      strategy?.regime?.updated_at,
      ...((strategy?.targets ?? []).map((target) => target.updated_at)),
    ])
    return {
      lastSync: latest ? new Date(latest).toLocaleTimeString('fr-FR') : '',
      lastSyncIso: latest ?? null,
    }
  }, [indicators, strategy])

  const get = (id: string) => indicatorMap.get(id)

  const vix = get('^VIX')?.value ?? null
  const spread = get('SPREAD_10Y_2Y')?.value ?? null
  const misery = get('MISERY_INDEX')?.value ?? null
  const tnx = get('^TNX')?.value ?? null
  const dxy = get('DX-Y.NYB')?.value ?? null
  const move = get('^MOVE')?.value ?? null
  const jpyVol = get('JPY_VOLATILITY')?.value ?? null

  const growthStatus = pillarState([get('SPREAD_10Y_2Y'), get('^VIX')],
    (spread !== null && spread < 0) || (vix !== null && vix >= 22),
    (spread !== null && spread < 0.5) || (vix !== null && vix >= 16), indicatorsLoading, indicatorsError)
  const inflationStatus = pillarState([get('MISERY_INDEX'), get('^TNX')],
    (misery !== null && misery >= 8) || (tnx !== null && tnx >= 4.7),
    (misery !== null && misery >= 6.8) || (tnx !== null && tnx >= 4.1), indicatorsLoading, indicatorsError)
  const liquidityStatus = pillarState([get('DX-Y.NYB'), get('^MOVE'), get('JPY_VOLATILITY')],
    (dxy !== null && dxy >= 105) || (move !== null && move >= 110) || (jpyVol !== null && jpyVol >= 1.8),
    (dxy !== null && dxy >= 102) || (move !== null && move >= 95) || (jpyVol !== null && jpyVol >= 1.3), indicatorsLoading, indicatorsError)
  const macroHealthStatus = macroHealthState(indicators, indicatorsLoading, indicatorsError)
  const crossAssetState = macroInputState(['^VIX', 'SPREAD_10Y_2Y', 'MISERY_INDEX', '^TNX', 'DX-Y.NYB', '^MOVE', 'JPY_VOLATILITY'].map(get), indicatorsLoading, indicatorsError)
  const tacticalReady = crossAssetState === 'READY' && ['NORMAL', 'CAUTION', 'STRESS'].includes(macroHealthStatus)
  const indicatorState = (id: string) => macroInputState([get(id)], indicatorsLoading, indicatorsError)

  const growthIndicators: PillarIndicator[] = [
    {
      label: '10Y-2Y Spread',
      state: indicatorState('SPREAD_10Y_2Y'),
      value: formatValue(spread, 2, '%'),
      ...formatChange(get('SPREAD_10Y_2Y')?.change_pct ?? null),
    },
    {
      label: 'VIX',
      state: indicatorState('^VIX'),
      value: formatValue(vix, 2),
      ...formatChange(get('^VIX')?.change_pct ?? null),
    },
    {
      label: 'Bitcoin Proxy',
      state: indicatorState('BTC-USD'),
      value: formatValue(get('BTC-USD')?.value ?? null, 0),
      ...formatChange(get('BTC-USD')?.change_pct ?? null),
    }
  ]

  const inflationIndicators: PillarIndicator[] = [
    {
      label: 'Misery Index',
      state: indicatorState('MISERY_INDEX'),
      value: formatValue(misery, 1),
      ...formatChange(get('MISERY_INDEX')?.change_pct ?? null),
    },
    {
      label: 'US 10Y Yield',
      state: indicatorState('^TNX'),
      value: formatValue(tnx, 2, '%'),
      ...formatChange(get('^TNX')?.change_pct ?? null),
    },
    {
      label: 'Gold (GC=F)',
      state: indicatorState('GC=F'),
      value: formatValue(get('GC=F')?.value ?? null, 0),
      ...formatChange(get('GC=F')?.change_pct ?? null),
    }
  ]

  const liquidityIndicators: PillarIndicator[] = [
    {
      label: 'DXY Dollar Index',
      state: indicatorState('DX-Y.NYB'),
      value: formatValue(dxy, 2),
      ...formatChange(get('DX-Y.NYB')?.change_pct ?? null),
    },
    {
      label: 'MOVE Index',
      state: indicatorState('^MOVE'),
      value: formatValue(move, 2),
      ...formatChange(get('^MOVE')?.change_pct ?? null),
    },
    {
      label: 'JPY Volatility',
      state: indicatorState('JPY_VOLATILITY'),
      value: formatValue(jpyVol, 2, '%'),
      ...formatChange(get('JPY_VOLATILITY')?.change_pct ?? null),
    }
  ]

  const tacticalSignal =
    !tacticalReady
      ? { title: 'Diagnostic tactique indisponible', message: 'Qualité source ou validité métier non attestée. Aucune conclusion de maintien ou de réduction du risque. Les valeurs collectées restent consultables, y compris celles pouvant provenir d’approximations ou de valeurs de secours.' }
      : macroHealthStatus === 'NORMAL' && [growthStatus, inflationStatus, liquidityStatus].every((state) => state === 'green')
      ? {
          title: 'No Tactical Rebalance Required',
          message: 'Normal volatility regime: keep the current allocation policy and monitor pillar warnings without forcing a tactical move.',
        }
      : growthStatus === 'red' || inflationStatus === 'red' || liquidityStatus === 'red'
        ? {
            title: 'Tactical Risk Reduction Signal',
            message: 'Restrictive conditions detected: reduce directional risk, prefer quality assets and keep a cash buffer.',
          }
        : {
            title: 'Tactical Watchlist',
            message: 'Mixed regime: keep diversification in place and monitor the 10Y-2Y spread, the dollar and volatility before changing allocation.',
          }

  return (
    <AppShell lastSync={lastSync} lastSyncIso={lastSyncIso} className="bg-slate-50 text-slate-900 dark:text-gray-300">
        <main className="space-y-8 p-4 sm:p-6 lg:p-8">
          
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="px-2 py-1 bg-slate-200 text-slate-700 text-[10px] font-black rounded uppercase">{crossAssetState}</div>
                <h1 className="text-4xl font-black tracking-tighter text-slate-950 dark:text-white uppercase leading-none">
                  Macro Decision <span className="text-[#00FF88]">Support System</span>
                </h1>
              </div>
              <p className="text-sm font-mono text-slate-500 dark:text-gray-500 uppercase tracking-widest">
                Multi-Pillar Quantitative Risk Assessment Hub
              </p>
            </div>
            <div className="hidden lg:block text-right">
               <span className="text-[10px] font-black text-slate-400 dark:text-gray-600 uppercase tracking-widest">Engine v1.2.0</span>
               <div className="text-xs font-mono text-slate-500 mt-1">CROSS-ASSET SIGNALS: {crossAssetState}</div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border border-slate-200 dark:border-white/5 p-6 shadow-xl shadow-slate-200/50 dark:shadow-none">
             <div className="flex items-center gap-2 mb-6 px-1">
                <BarChart3 size={16} className="text-[#00FF88]" />
                <h2 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-[0.2em]">Volatility Regime & Tail Risk</h2>
             </div>
             <p className="mb-4 text-xs text-slate-500">{MACRO_PROVENANCE_NOTICE} Le seuil de 72 h qualifie uniquement l’ancienneté de collecte, pas la validité métier.</p>
             <MacroHealth indicators={indicators} loading={indicatorsLoading} error={indicatorsError} />
          </div>

          <MacroStrategyPanel strategy={strategy} loading={strategyLoading} error={strategyError} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <MacroPillar 
              title="Economic Growth" 
              subtitle="Activity & Momentum"
              icon={Activity}
              status={growthStatus}
              indicators={growthIndicators}
            />

            <MacroPillar 
              title="Inflation Hub" 
              subtitle="Purchasing Power"
              icon={TrendingUp}
              status={inflationStatus}
              indicators={inflationIndicators}
            />

            <MacroPillar 
              title="Liquidity" 
              subtitle="Monetary Conditions"
              icon={Droplets}
              status={liquidityStatus}
              indicators={liquidityIndicators}
            />
          </div>

          <div className="p-8 rounded-3xl bg-slate-900 dark:bg-[#0D1117]/80 border border-white/5 flex flex-col items-center justify-center text-center space-y-4 shadow-2xl">
             <div className="p-4 rounded-full bg-white/5 border border-white/10">
                <ShieldAlert className="text-[#00FF88] animate-pulse" size={32} />
             </div>
             <div>
               <h4 className="text-white font-black uppercase tracking-tighter text-xl">{tacticalSignal.title}</h4>
               <p className="text-gray-400 text-sm max-w-lg mt-2 font-medium">
                  {tacticalSignal.message}
               </p>
             </div>
          </div>

        </main>
    </AppShell>
  )
}
