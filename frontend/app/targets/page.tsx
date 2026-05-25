"use client"

import React, { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Database, FileSpreadsheet, LockKeyhole, Target } from 'lucide-react'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'

interface PortfolioRow {
  id: string
  name: string | null
}

interface PositionRow {
  portfolio_id: string
  ticker: string
  name: string | null
  instrument_type: string | null
  currency: string | null
  quantity_current: number | string | null
  pru: number | string | null
  target_weight_pct: number | string | null
  target_source: string | null
  target_source_file: string | null
  target_updated_at: string | null
  actual_source: string | null
  actual_source_accounts: unknown
  actual_as_of_date: string | null
  actual_updated_at: string | null
  updated_at: string | null
}

interface ActualSourceAccount {
  broker?: string | null
  account_id?: string | null
  envelope?: string | null
  as_of_date?: string | null
  quantity?: number | string | null
}

interface BrokerSnapshotRunRow {
  broker: string
  account_id: string
  portfolio_id: string
  envelope: string | null
  as_of_date: string
  source_file: string | null
  position_count: number | string | null
  created_at: string | null
  updated_at: string | null
}

interface BrokerSnapshotRunResult {
  rows: BrokerSnapshotRunRow[]
  error: string | null
}

interface MarketRow {
  ticker: string
  last_price: number | string | null
  currency: string | null
  data_status: string | null
  last_update: string | null
}

interface CurrencyRow {
  id: string
  rate_to_eur: number | string | null
}

type DriftPriority = 'ACTION' | 'WATCH' | 'OK' | 'UNAVAILABLE'
type PriceSource = 'market' | 'pru' | 'missing'
type FreshnessState = 'FRESH' | 'STALE' | 'MISSING'

interface PositionView extends PositionRow {
  displayCurrency: string
  quantity: number | null
  lastPrice: number | null
  fxRateToEur: number | null
  currentValueEur: number | null
  currentWeightPct: number | null
  targetPct: number | null
  driftPct: number | null
  rebalanceAmountEur: number | null
  priority: DriftPriority
  dataState: string
  sourceAccounts: ActualSourceAccount[]
  sourceLabel: string
  actualFreshness: FreshnessState
}

function readNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function formatPortfolioName(portfolio: PortfolioRow): string {
  if (portfolio.name && portfolio.name.trim()) return portfolio.name
  return `Portfolio ${portfolio.id.slice(0, 6)}`
}

function formatPercent(value: number | null, digits = 2): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value.toFixed(digits)}%`
}

function formatSignedPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} pts`
}

function formatEur(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value)
}

function formatSignedEur(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value >= 0 ? '+' : ''}${formatEur(value)}`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function parseSourceAccounts(value: unknown): ActualSourceAccount[] {
  if (Array.isArray(value)) return value as ActualSourceAccount[]
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed as ActualSourceAccount[] : []
    } catch {
      return []
    }
  }
  return []
}

function resolveFreshnessDate(value: string | null | undefined, staleAfterDays = 3): FreshnessState {
  if (!value) return 'MISSING'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'MISSING'
  const ageDays = (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)
  return ageDays > staleAfterDays ? 'STALE' : 'FRESH'
}

function sourceLabel(source: string | null, accounts: ActualSourceAccount[]): string {
  if (source !== 'broker_snapshot') return 'manual / unknown'
  const brokers = Array.from(new Set(accounts.map((account) => account.broker?.toUpperCase()).filter(Boolean)))
  if (brokers.length === 0) return 'broker snapshot'
  return brokers.join(' + ')
}

function freshnessClass(state: FreshnessState): string {
  if (state === 'FRESH') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
  if (state === 'STALE') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'
  return 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
}

function resolvePriority(currentValueEur: number | null, driftPct: number | null): DriftPriority {
  if (currentValueEur === null || driftPct === null) return 'UNAVAILABLE'
  const absoluteDrift = Math.abs(driftPct)
  if (absoluteDrift >= 3) return 'ACTION'
  if (absoluteDrift >= 1) return 'WATCH'
  return 'OK'
}

function priorityClass(priority: DriftPriority): string {
  if (priority === 'ACTION') return 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300'
  if (priority === 'WATCH') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'
  if (priority === 'OK') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
  return 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
}

function resolveDataState(
  position: PositionRow,
  market: MarketRow | null,
  priceSource: PriceSource,
  fxRateToEur: number | null
): string {
  if (priceSource === 'missing') return 'price unavailable'
  if (fxRateToEur === null) return 'fx unavailable'
  if (priceSource === 'pru') return 'priced from pru'
  if (market?.data_status && market.data_status !== 'OK') return market.data_status.toLowerCase()
  if (!position.target_weight_pct && position.target_weight_pct !== 0) return 'target missing'
  return 'ok'
}

export default function TargetsPage() {
  const [selectedPortfolioIdOverride, setSelectedPortfolioIdOverride] = useState<string>('')

  const { data: portfolios } = useSWR('portfolios', async () => {
    const { data, error } = await supabase.from('portfolios').select('id,name')
    if (error) throw error
    return (data ?? []) as PortfolioRow[]
  })

  const selectedPortfolioId = selectedPortfolioIdOverride || portfolios?.[0]?.id || ''

  const { data: positions } = useSWR(
    selectedPortfolioId ? ['positions', selectedPortfolioId] : null,
    async () => {
      const extendedSelector = [
        'portfolio_id',
        'ticker',
        'name',
        'instrument_type',
        'currency',
        'quantity_current',
        'pru',
        'target_weight_pct',
        'target_source',
        'target_source_file',
        'target_updated_at',
        'actual_source',
        'actual_source_accounts',
        'actual_as_of_date',
        'actual_updated_at',
        'updated_at',
      ].join(',')
      const legacySelector = [
        'portfolio_id',
        'ticker',
        'name',
        'instrument_type',
        'currency',
        'quantity_current',
        'pru',
        'target_weight_pct',
        'updated_at',
      ].join(',')
      const { data, error } = await supabase
        .from('portfolio_positions')
        .select(extendedSelector)
        .eq('portfolio_id', selectedPortfolioId)
        .order('ticker', { ascending: true })
      if (error) {
        const fallback = await supabase
          .from('portfolio_positions')
          .select(legacySelector)
          .eq('portfolio_id', selectedPortfolioId)
          .order('ticker', { ascending: true })
        if (fallback.error) throw error
        return (fallback.data ?? []) as unknown as PositionRow[]
      }
      return (data ?? []) as unknown as PositionRow[]
    }
  )

  const { data: brokerSnapshotRuns } = useSWR(
    selectedPortfolioId ? ['broker-position-snapshot-runs', selectedPortfolioId] : null,
    async (): Promise<BrokerSnapshotRunResult> => {
      const { data, error } = await supabase
        .from('broker_position_snapshot_runs')
        .select('broker,account_id,portfolio_id,envelope,as_of_date,source_file,position_count,created_at,updated_at')
        .eq('portfolio_id', selectedPortfolioId)
        .order('as_of_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(12)
      if (error) return { rows: [], error: error.message }
      return { rows: (data ?? []) as BrokerSnapshotRunRow[], error: null }
    }
  )

  const { data: marketRows } = useSWR('targets-market-watch', async () => {
    const { data, error } = await supabase
      .from('market_watch')
      .select('ticker,last_price,currency,data_status,last_update')
      .limit(1000)
    if (error) throw error
    return (data ?? []) as MarketRow[]
  })

  const { data: currencies } = useSWR('targets-currencies', async () => {
    const { data, error } = await supabase.from('currencies').select('id,rate_to_eur')
    if (error) throw error
    return (data ?? []) as CurrencyRow[]
  })

  const marketByTicker = useMemo(() => {
    const map = new Map<string, MarketRow>()
    ;(marketRows ?? []).forEach((row) => {
      map.set(row.ticker.toUpperCase(), row)
    })
    return map
  }, [marketRows])

  const fxRates = useMemo(() => {
    const map = new Map<string, number>()
    map.set('EUR', 1)
    ;(currencies ?? []).forEach((row) => {
      const rate = readNumber(row.rate_to_eur)
      if (rate !== null && rate > 0) {
        map.set(row.id.toUpperCase(), rate)
      }
    })
    return map
  }, [currencies])

  const positionViews = useMemo(() => {
    const baseRows = (positions ?? []).map((position) => {
      const market = marketByTicker.get(position.ticker.toUpperCase()) ?? null
      const displayCurrency = (position.currency ?? market?.currency ?? 'EUR').toUpperCase()
      const quantity = readNumber(position.quantity_current)
      const marketPrice = readNumber(market?.last_price)
      const pruPrice = readNumber(position.pru)
      const priceSource: PriceSource = marketPrice !== null ? 'market' : pruPrice !== null ? 'pru' : 'missing'
      const lastPrice = marketPrice ?? pruPrice
      const fxRateToEur = fxRates.get(displayCurrency) ?? null
      const targetPct = readNumber(position.target_weight_pct)
      const sourceAccounts = parseSourceAccounts(position.actual_source_accounts)
      const actualFreshness = resolveFreshnessDate(position.actual_as_of_date)
      const currentValueEur =
        quantity !== null && lastPrice !== null && fxRateToEur !== null
          ? quantity * lastPrice * fxRateToEur
          : null

      return {
        ...position,
        displayCurrency,
        quantity,
        lastPrice,
        fxRateToEur,
        targetPct,
        currentValueEur,
        currentWeightPct: null,
        driftPct: null,
        rebalanceAmountEur: null,
        priority: 'UNAVAILABLE' as DriftPriority,
        dataState: resolveDataState(position, market, priceSource, fxRateToEur),
        sourceAccounts,
        sourceLabel: sourceLabel(position.actual_source, sourceAccounts),
        actualFreshness,
      }
    })

    const totalValueEur = baseRows.reduce((sum, row) => sum + (row.currentValueEur ?? 0), 0)

    return baseRows.map((row) => {
      const currentWeightPct =
        totalValueEur > 0 && row.currentValueEur !== null ? (row.currentValueEur / totalValueEur) * 100 : null
      const driftPct =
        currentWeightPct !== null && row.targetPct !== null ? currentWeightPct - row.targetPct : null
      const rebalanceAmountEur =
        totalValueEur > 0 && row.currentValueEur !== null && row.targetPct !== null
          ? (row.targetPct / 100) * totalValueEur - row.currentValueEur
          : null

      return {
        ...row,
        currentWeightPct,
        driftPct,
        rebalanceAmountEur,
        priority: resolvePriority(row.currentValueEur, driftPct),
      }
    })
  }, [fxRates, marketByTicker, positions])

  const grouped = useMemo(() => {
    const groups = new Map<string, PositionView[]>()
    positionViews.forEach((row) => {
      const key = row.instrument_type?.toUpperCase() || 'UNCLASSIFIED'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)?.push(row)
    })
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'en'))
  }, [positionViews])

  const targetStats = useMemo(() => {
    const configured = positionViews.filter((row) => row.targetPct !== null)
    const totalTarget = configured.reduce((sum, row) => sum + (row.targetPct ?? 0), 0)
    const portfolioValueEur = positionViews.reduce((sum, row) => sum + (row.currentValueEur ?? 0), 0)
    const actionCount = positionViews.filter((row) => row.priority === 'ACTION').length
    const maxDrift = positionViews.reduce((max, row) => Math.max(max, Math.abs(row.driftPct ?? 0)), 0)
    const brokerFed = positionViews.filter((row) => row.actual_source === 'broker_snapshot').length
    const staleActual = positionViews.filter((row) => row.actual_source === 'broker_snapshot' && row.actualFreshness === 'STALE').length
    const latestTargetUpdate =
      positionViews
        .map((row) => row.target_updated_at)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
    const latestTargetFile =
      positionViews.find((row) => row.target_updated_at === latestTargetUpdate)?.target_source_file ?? null

    return {
      positions: positionViews.length,
      configured: configured.length,
      missing: positionViews.length - configured.length,
      totalTarget,
      portfolioValueEur,
      actionCount,
      maxDrift,
      brokerFed,
      staleActual,
      latestTargetUpdate,
      latestTargetFile,
      ready: positionViews.length > 0 && positionViews.length === configured.length && Math.abs(totalTarget - 100) <= 0.05,
    }
  }, [positionViews])

  const snapshotStats = useMemo(() => {
    const rows = brokerSnapshotRuns?.rows ?? []
    const sourceKeys = new Set(rows.map((row) => `${row.broker}:${row.account_id}:${row.envelope ?? ''}`))
    const latestAsOf =
      rows
        .map((row) => row.as_of_date)
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
    const latestFreshness = resolveFreshnessDate(latestAsOf)
    return {
      rows,
      error: brokerSnapshotRuns?.error ?? null,
      sourceCount: sourceKeys.size,
      latestAsOf,
      latestFreshness,
      latestFile: rows.find((row) => row.as_of_date === latestAsOf)?.source_file ?? null,
    }
  }, [brokerSnapshotRuns])

  const { lastSync, lastSyncIso } = useMemo(() => {
    if (!positions || positions.length === 0) return { lastSync: '', lastSyncIso: null as string | null }
    const latest = positions
      .map((position) => position.updated_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]

    return {
      lastSync: latest ? new Date(latest).toLocaleTimeString('fr-FR') : '',
      lastSyncIso: latest ?? null,
    }
  }, [positions])

  return (
    <AppShell lastSync={lastSync} lastSyncIso={lastSyncIso} className="bg-slate-50">
      <main className="p-3 sm:p-6 lg:p-10">
        <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Target className="h-5 w-5 shrink-0 text-[#00FF88]" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-black uppercase tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                  Portfolio Drift
                </h1>
                <p className="mt-1 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                  Current weight vs target allocation, read from Supabase.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <div className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-200/70 px-3 py-2 dark:bg-white/10">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400">Portfolio</span>
                <select
                  value={selectedPortfolioId}
                  onChange={(event) => setSelectedPortfolioIdOverride(event.target.value)}
                  className="max-w-[180px] bg-transparent text-[10px] font-black text-slate-900 outline-none dark:text-white"
                >
                  {(portfolios ?? []).map((portfolio) => (
                    <option key={portfolio.id} value={portfolio.id}>
                      {formatPortfolioName(portfolio)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-gray-400">
                <LockKeyhole size={12} />
                Read only
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            {[
              ['Portfolio value', formatEur(targetStats.portfolioValueEur || null)],
              ['Positions', targetStats.positions.toString()],
              ['Configured', targetStats.configured.toString()],
              ['Missing targets', targetStats.missing.toString()],
              ['Max drift', formatPercent(targetStats.maxDrift, 2)],
              ['Actions', targetStats.actionCount.toString()],
              ['Broker-fed', targetStats.brokerFed.toString()],
              ['Stale actuals', targetStats.staleActual.toString()],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white/80 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">{label}</div>
                <div className="mt-1 text-sm font-mono font-black text-slate-950 dark:text-white">{value}</div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-amber-300/70 bg-amber-50 px-4 py-3 text-xs font-mono text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/20 dark:text-amber-300">
            Targets stay read-only in the frontend. Allocation updates must come from a backend/service-role workflow or a future auth-gated route.
          </div>

          <section className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-white/10 dark:bg-[#0D1117]/70">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Database className="h-4 w-4 shrink-0 text-[#00FF88]" />
                <div className="min-w-0">
                  <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-700 dark:text-gray-300">Data Operations</h2>
                  <p className="mt-1 truncate text-[10px] font-mono text-slate-500 dark:text-gray-500">
                    Target Excel and latest broker snapshots feeding the consolidated current portfolio.
                  </p>
                </div>
              </div>
              {snapshotStats.error && (
                <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                  snapshot schema unavailable
                </span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OperationMetric
                icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
                label="Target Excel"
                value={formatDate(targetStats.latestTargetUpdate)}
                detail={targetStats.latestTargetFile ?? 'No target import source'}
              />
              <OperationMetric
                icon={<Database className="h-3.5 w-3.5" />}
                label="Broker snapshots"
                value={snapshotStats.sourceCount > 0 ? `${snapshotStats.sourceCount} source${snapshotStats.sourceCount > 1 ? 's' : ''}` : '0 source'}
                detail={snapshotStats.latestAsOf ? `Latest ${formatDate(snapshotStats.latestAsOf)}${snapshotStats.latestFile ? ` · ${snapshotStats.latestFile}` : ''}` : 'No broker snapshot run'}
              />
              <OperationMetric
                label="Consolidation"
                value={`${targetStats.brokerFed}/${targetStats.positions}`}
                detail="Positions fed by official broker snapshots"
              />
              <OperationMetric
                label="Blocking states"
                value={snapshotStats.error ? 'Schema' : targetStats.staleActual > 0 ? `${targetStats.staleActual} stale` : targetStats.missing > 0 ? `${targetStats.missing} missing target` : 'Clear'}
                detail={snapshotStats.error ?? 'Freshness and target completeness checks'}
                tone={snapshotStats.error || targetStats.staleActual > 0 || targetStats.missing > 0 ? 'warn' : 'ok'}
              />
            </div>
          </section>

          <div className="space-y-5">
            {grouped.length === 0 && (
              <EmptyState
                title="No portfolio positions"
                message="No positions are available for this portfolio. Target validation starts once Supabase returns portfolio_positions rows."
              />
            )}

            {grouped.map(([group, rows]) => (
              <section key={group} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]/70">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
                  <h2 className="text-sm font-black uppercase tracking-tight text-slate-950 dark:text-white">{group}</h2>
                  <span className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                    {rows.length} positions - {rows.filter((row) => row.targetPct === null).length} missing
                  </span>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-white/10 md:hidden">
                  {rows.map((row) => (
                    <button
                      key={row.ticker}
                      type="button"
                      className="block w-full bg-white p-4 text-left dark:bg-transparent"
                      aria-label={`${row.ticker} drift details`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-950 dark:text-white">{row.name || row.ticker}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                            <span>{row.ticker}</span>
                            <span>{row.displayCurrency}</span>
                            <span>{row.sourceLabel}</span>
                            <span>{row.dataState}</span>
                          </div>
                        </div>
                        <span className={cn('shrink-0 rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', priorityClass(row.priority))}>
                          {row.priority}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Metric label="Value" value={formatEur(row.currentValueEur)} />
                        <Metric label="Current" value={formatPercent(row.currentWeightPct)} />
                        <Metric label="Target" value={formatPercent(row.targetPct)} />
                        <Metric label="Drift" value={formatSignedPercent(row.driftPct)} />
                        <Metric label="Snapshot" value={formatDate(row.actual_as_of_date)} />
                      </div>
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-mono font-bold text-slate-700 dark:border-white/10 dark:bg-black/20 dark:text-gray-200">
                        Rebalance: {formatSignedEur(row.rebalanceAmountEur)}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="hidden md:block">
                  <div className="overflow-x-auto">
                    <table className="min-w-[1200px] w-full">
                      <thead className="bg-slate-50 dark:bg-[#080A0F]">
                        <tr>
                          {['Asset', 'Ticker', 'Currency', 'Source', 'Qty', 'Value', 'Current %', 'Target %', 'Drift', 'Rebalance', 'State'].map((header) => (
                            <th
                              key={header}
                              className={cn(
                                'border-b border-slate-200 p-3 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:border-white/5 dark:text-gray-500',
                                ['Qty', 'Value', 'Current %', 'Target %', 'Drift', 'Rebalance'].includes(header) ? 'text-right' : 'text-left'
                              )}
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                        {rows.map((row) => (
                          <tr key={row.ticker} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-white/5">
                            <td className="p-3 text-sm font-black text-slate-950 dark:text-white">{row.name || row.ticker}</td>
                            <td className="p-3 text-sm font-mono font-bold text-slate-500 dark:text-gray-400">{row.ticker}</td>
                            <td className="p-3 text-sm font-mono text-slate-500 dark:text-gray-400">{row.displayCurrency}</td>
                            <td className="p-3">
                              <div className="flex flex-col items-start gap-1">
                                <span className="text-[10px] font-mono font-bold uppercase text-slate-600 dark:text-gray-300">{row.sourceLabel}</span>
                                <span className={cn('rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', freshnessClass(row.actualFreshness))}>
                                  {row.actualFreshness === 'MISSING' ? 'NO SNAPSHOT' : `${row.actualFreshness} ${formatDate(row.actual_as_of_date)}`}
                                </span>
                              </div>
                            </td>
                            <td className="p-3 text-right text-sm font-mono text-slate-500 dark:text-gray-400">{row.quantity?.toLocaleString('fr-FR') ?? '--'}</td>
                            <td className="p-3 text-right text-sm font-mono font-bold text-slate-700 dark:text-gray-200">{formatEur(row.currentValueEur)}</td>
                            <td className="p-3 text-right text-sm font-mono text-slate-700 dark:text-gray-200">{formatPercent(row.currentWeightPct)}</td>
                            <td className="p-3 text-right text-sm font-mono text-slate-700 dark:text-gray-200">{formatPercent(row.targetPct)}</td>
                            <td className="p-3 text-right text-sm font-mono font-bold text-slate-700 dark:text-gray-200">{formatSignedPercent(row.driftPct)}</td>
                            <td className="p-3 text-right text-sm font-mono font-bold text-slate-700 dark:text-gray-200">{formatSignedEur(row.rebalanceAmountEur)}</td>
                            <td className="p-3">
                              <div className="flex flex-col items-start gap-1">
                                <span className={cn('rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', priorityClass(row.priority))}>
                                  {row.priority}
                                </span>
                                <span className="text-[9px] font-mono text-slate-500 dark:text-gray-500">{row.dataState}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
    </AppShell>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-black/20">
      <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">{label}</div>
      <div className="mt-1 text-xs font-mono font-black text-slate-950 dark:text-white">{value}</div>
    </div>
  )
}

function OperationMetric({
  icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon?: React.ReactNode
  label: string
  value: string
  detail: string
  tone?: 'neutral' | 'ok' | 'warn'
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-3',
        tone === 'ok'
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20'
          : tone === 'warn'
          ? 'border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20'
          : 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-black/20'
      )}
    >
      <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-mono font-black text-slate-950 dark:text-white">{value}</div>
      <div className="mt-1 line-clamp-2 text-[10px] font-mono text-slate-500 dark:text-gray-400">{detail}</div>
    </div>
  )
}
