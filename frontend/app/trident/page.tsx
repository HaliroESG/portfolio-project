"use client"

import React, { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CircleHelp,
  MinusCircle,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react'
import { Header } from '../../components/Header'
import { Sidebar } from '../../components/Sidebar'
import { EmptyState } from '../../components/EmptyState'
import { TridentRegressionChart } from '../../components/TridentRegressionChart'
import { supabase } from '../../lib/supabase'
import { loadTridentBundle, loadTridentCriteria } from '../../lib/tridentData'
import { swrOptions, SWR_REFRESH } from '../../lib/swrConfig'
import { cn } from '../../lib/utils'
import { TRIDENT_DETAIL_WIDTH } from '../../lib/panelWidth'
import { usePersistedPanelWidth } from '../../lib/usePersistedPanelWidth'
import {
  TridentCategory,
  TridentCriterionRow,
  TridentCriterionStatus,
  TridentOverallState,
  TridentScreenerRow,
} from '../../types'

type SortKey = 'score' | 'growth' | 'profitability' | 'roic' | 'debt'
type ScoreFilter = 'ALL' | '80' | '60' | '40'
type Horizon = 1 | 3 | 5 | 10

const HORIZONS: Horizon[] = [1, 3, 5, 10]
const EMPTY_ROWS: TridentScreenerRow[] = []
const CATEGORIES: Array<{ key: TridentCategory; label: string }> = [
  { key: 'growth', label: 'Growth' },
  { key: 'profitability', label: 'Profitability' },
  { key: 'capital', label: 'Capital' },
  { key: 'health', label: 'Health' },
]

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return `${(value * 100).toFixed(1)}%`
}

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return value.toFixed(0)
}

function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return value.toFixed(2)
}

function formatCriterionValue(row: TridentCriterionRow): string {
  if (row.actual === null) return '--'
  if (
    row.criterion_key.includes('margin') ||
    row.criterion_key.includes('cagr') ||
    row.criterion_key.includes('roic') ||
    row.criterion_key.includes('roe') ||
    row.criterion_key.includes('roce') ||
    row.criterion_key.includes('shares') ||
    row.criterion_key === 'fcf_quality'
  ) {
    return formatPct(row.actual)
  }
  return formatRatio(row.actual)
}

function stateBadgeClass(state: TridentOverallState | null): string {
  if (state === 'QUALIFIED') return 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800'
  if (state === 'REJECTED') return 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800'
  if (state === 'WATCHLIST') return 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800'
  return 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/60 dark:text-gray-300 dark:border-slate-700'
}

function stateLabel(state: TridentOverallState | null): string {
  if (state === 'QUALIFIED') return 'Qualified'
  if (state === 'WATCHLIST') return 'Watchlist'
  if (state === 'REJECTED') return 'Rejected'
  return 'No data'
}

function stateHelp(state: TridentOverallState | null): string {
  if (state === 'QUALIFIED') return 'Score >= 75, confidence >= 70, no missing criterion, no failed eliminator.'
  if (state === 'WATCHLIST') return 'No failed eliminator, but score or confidence is below qualified threshold.'
  if (state === 'REJECTED') return 'At least one eliminating criterion failed.'
  return 'No usable annual financial history.'
}

function criterionBadge(status: TridentCriterionStatus) {
  if (status === 'pass') {
    return {
      Icon: CheckCircle2,
      label: 'Pass',
      className: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800',
    }
  }
  if (status === 'fail') {
    return {
      Icon: XCircle,
      label: 'Fail',
      className: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800',
    }
  }
  if (status === 'not_applicable') {
    return {
      Icon: MinusCircle,
      label: 'N/A',
      className: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/60 dark:text-gray-300 dark:border-slate-700',
    }
  }
  return {
    Icon: CircleHelp,
    label: 'Missing',
    className: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800',
  }
}

function scoreForSort(row: TridentScreenerRow, sortKey: SortKey): number {
  if (sortKey === 'growth') return row.growth_score ?? -1
  if (sortKey === 'profitability') return row.profitability_score ?? -1
  if (sortKey === 'roic') return row.latest_roic ?? -1
  if (sortKey === 'debt') return row.latest_net_debt_to_ebitda ?? Number.POSITIVE_INFINITY
  return row.score ?? -1
}

function summaryNumber(row: TridentScreenerRow, key: string): number {
  const value = row.summary[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function lastSyncLabel(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString('fr-FR')
}

function isStaleRun(value: string | null | undefined): boolean {
  if (!value) return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false
  return Date.now() - parsed.getTime() > 48 * 60 * 60 * 1000
}

export default function TridentPage() {
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('ALL')
  const [exchange, setExchange] = useState('ALL')
  const [sector, setSector] = useState('ALL')
  const [state, setState] = useState<'ALL' | TridentOverallState>('ALL')
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('ALL')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [horizon, setHorizon] = useState<Horizon>(3)
  const [detailWidth, setDetailWidth] = usePersistedPanelWidth(TRIDENT_DETAIL_WIDTH)

  const { data, isLoading, error } = useSWR(
    'trident-screener-v1',
    () => loadTridentBundle(supabase),
    swrOptions(SWR_REFRESH.SLOW)
  )

  const rows = data?.rows ?? EMPTY_ROWS
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const minimumScore = scoreFilter === 'ALL' ? null : Number(scoreFilter)

    return rows
      .filter((row) => {
        if (query) {
          const haystack = `${row.ticker} ${row.name ?? ''}`.toLowerCase()
          if (!haystack.includes(query)) return false
        }
        if (country !== 'ALL' && row.country !== country) return false
        if (exchange !== 'ALL' && row.exchange !== exchange) return false
        if (sector !== 'ALL' && row.sector !== sector) return false
        if (state !== 'ALL' && row.overall_state !== state) return false
        if (minimumScore !== null && (row.score ?? 0) < minimumScore) return false
        return true
      })
      .sort((left, right) => {
        const leftValue = scoreForSort(left, sortKey)
        const rightValue = scoreForSort(right, sortKey)
        if (sortKey === 'debt') return leftValue - rightValue
        return rightValue - leftValue
      })
  }, [country, exchange, rows, scoreFilter, search, sector, sortKey, state])

  const selectedRow = useMemo(() => {
    return filteredRows.find((row) => row.instrument_key === selectedKey) ?? filteredRows[0] ?? null
  }, [filteredRows, selectedKey])

  const {
    data: horizonCriteria = [],
    isLoading: isCriteriaLoading,
    error: criteriaError,
  } = useSWR(
    selectedRow ? ['trident-criteria-v2', selectedRow.instrument_key, horizon] : null,
    () => {
      if (!selectedRow) return Promise.resolve([])
      return loadTridentCriteria(supabase, selectedRow.instrument_key, horizon)
    },
    swrOptions(SWR_REFRESH.SLOW)
  )
  const horizonSummary = selectedRow?.horizons[String(horizon)] ?? null
  const qualifiedCount = rows.filter((row) => row.overall_state === 'QUALIFIED').length
  const watchlistCount = rows.filter((row) => row.overall_state === 'WATCHLIST').length
  const rejectedCount = rows.filter((row) => row.overall_state === 'REJECTED').length
  const lastSync = lastSyncLabel(data?.lastUpdateIso)
  const sourceCounts = data?.sourceCounts
  const hasUniverseOnlyRows = rows.length > 0 && sourceCounts?.financials === 0
  const lastRunStats = data?.lastBackendRun?.stats ?? {}
  const coveragePct = typeof lastRunStats.coverage_pct === 'number' ? lastRunStats.coverage_pct : null
  const staleRun = isStaleRun(data?.lastBackendRun?.finished_at ?? data?.lastUpdateIso)

  const handleDetailResizePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = detailWidth
    const onMove = (moveEvent: PointerEvent) => {
      setDetailWidth(startWidth - (moveEvent.clientX - startX))
    }
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
  }

  const handleDetailResizeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setDetailWidth(detailWidth + 20)
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setDetailWidth(detailWidth - 20)
    }
  }

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-[#080A0F] text-slate-950 dark:text-gray-200 transition-colors duration-500">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Header lastSync={lastSync} lastSyncIso={data?.lastUpdateIso ?? null} coveragePct={coveragePct} />
        <main className="flex-1 min-h-0 p-5 flex flex-col gap-4 overflow-hidden">
          <section className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-sm font-black uppercase tracking-[0.24em] text-slate-900 dark:text-white">
                Trident Screener
              </h1>
              <div className="mt-1 flex items-center gap-3 text-[10px] font-mono text-slate-500 dark:text-gray-500">
                <span>{rows.length} instruments</span>
                <span>{qualifiedCount} qualified</span>
                <span>{watchlistCount} watchlist</span>
                <span>{rejectedCount} rejected</span>
                {sourceCounts && (
                  <span>
                    source {sourceCounts.universe} universe / {sourceCounts.financials} financial rows
                  </span>
                )}
                {data?.lastBackendRun && (
                  <span>
                    run {data.lastBackendRun.status.toLowerCase()} / {coveragePct ?? '--'}% covered
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
              <span className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                Backend computed
              </span>
              <span className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                Missing != Fail
              </span>
              {hasUniverseOnlyRows && (
                <span className="rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                  Universe only
                </span>
              )}
              {staleRun && (
                <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  <Clock3 className="h-3 w-3" />
                  Stale &gt; 48h
                </span>
              )}
            </div>
          </section>

          <section className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-[#0D1117]">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or ticker"
                className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold outline-none transition focus:border-slate-400 dark:border-white/10 dark:bg-black/20 dark:text-white"
              />
            </div>

            <FilterSelect label="Country" value={country} options={data?.countries ?? []} onChange={setCountry} />
            <FilterSelect label="Exchange" value={exchange} options={data?.exchanges ?? []} onChange={setExchange} />
            <FilterSelect label="Sector" value={sector} options={data?.sectors ?? []} onChange={setSector} />
            <select
              value={state}
              onChange={(event) => setState(event.target.value as 'ALL' | TridentOverallState)}
              className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-black uppercase outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
            >
              <option value="ALL">All states</option>
              <option value="QUALIFIED">Qualified</option>
              <option value="WATCHLIST">Watchlist</option>
              <option value="REJECTED">Rejected</option>
              <option value="NO_DATA">No data</option>
            </select>
            <select
              value={scoreFilter}
              onChange={(event) => setScoreFilter(event.target.value as ScoreFilter)}
              className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-black uppercase outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
            >
              <option value="ALL">Any score</option>
              <option value="80">Score &gt;= 80</option>
              <option value="60">Score &gt;= 60</option>
              <option value="40">Score &gt;= 40</option>
            </select>
            <div className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 dark:border-white/10 dark:bg-black/20">
              <SlidersHorizontal className="h-4 w-4 text-slate-500" />
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className="bg-transparent text-xs font-black uppercase outline-none dark:text-white"
              >
                <option value="score">Score</option>
                <option value="growth">Growth</option>
                <option value="profitability">Profitability</option>
                <option value="roic">ROIC</option>
                <option value="debt">Debt</option>
              </select>
            </div>
          </section>

          {hasUniverseOnlyRows && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
              Trident has a market universe, but annual financial statements are not loaded yet. Rows stay NO_DATA until the backend sync writes provider financials.
            </div>
          )}

          {error ? (
            <EmptyState
              tone="error"
              className="flex-1"
              title="Trident schema unreadable"
              message="The Trident tables or view are unavailable to the frontend. Apply the Supabase migration and verify anon SELECT grants before using this screen."
            />
          ) : isLoading ? (
            <EmptyState tone="loading" className="flex-1" title="Loading Trident screener" message="Reading backend-computed Trident rows from Supabase." />
          ) : rows.length === 0 && sourceCounts?.universe === 0 ? (
            <EmptyState
              tone="warning"
              className="flex-1"
              title="Trident provider not configured"
              message="The Trident schema is available, but the equity universe is empty. Run the backend Trident sync with the global_yahoo provider or configure CSV inputs."
            />
          ) : rows.length === 0 && sourceCounts && sourceCounts.universe > 0 && sourceCounts.results === 0 ? (
            <EmptyState
              tone="warning"
              className="flex-1"
              title="No Trident results computed"
              message="The equity universe exists, but no result rows were written. Run the backend Trident computation and verify its etl_runs status."
            />
          ) : filteredRows.length === 0 ? (
            <EmptyState
              tone="neutral"
              className="flex-1"
              title="No rows match these filters"
              message="The screener has backend-computed rows, but the current search, state, score, or market filters exclude all of them."
            />
          ) : (
            <section
              className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-auto xl:grid-cols-[minmax(560px,1fr)_14px_minmax(var(--trident-detail-min),var(--trident-detail-width))] xl:gap-0 xl:overflow-hidden"
              style={{
                '--trident-detail-width': `${detailWidth}px`,
                '--trident-detail-min': `${TRIDENT_DETAIL_WIDTH.min}px`,
              } as React.CSSProperties}
            >
              <div className="min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117] xl:rounded-r-none">
                <div className="h-full overflow-auto">
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:bg-[#101722] dark:text-gray-400">
                      <tr>
                        <th className="w-[250px] px-3 py-3">Company</th>
                        <th className="px-3 py-3">Market</th>
                        <th className="px-3 py-3">Sector</th>
                        <th className="px-3 py-3 text-right">Score</th>
                        <th className="px-3 py-3 text-right">Growth</th>
                        <th className="px-3 py-3 text-right">Profit</th>
                        <th className="px-3 py-3 text-right">ROIC</th>
                        <th className="px-3 py-3 text-right">Debt</th>
                        <th className="px-3 py-3 text-center">State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {filteredRows.map((row) => {
                        const isSelected = row.instrument_key === selectedRow?.instrument_key
                        const failTotal = row.criteria_fail_count ?? summaryNumber(row, 'criteria_fail')
                        const missingTotal = row.criteria_missing_count ?? summaryNumber(row, 'criteria_missing')
                        return (
                          <tr
                            key={row.instrument_key}
                            onClick={() => setSelectedKey(row.instrument_key)}
                            className={cn(
                              'cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-white/5',
                              isSelected && 'bg-blue-50 dark:bg-[#00FF88]/10'
                            )}
                          >
                            <td className="px-3 py-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-black text-slate-950 dark:text-white">{row.name ?? row.ticker}</div>
                                <div className="mt-0.5 flex items-center gap-2 text-[10px] font-mono text-slate-500">
                                  <span>{row.ticker}</span>
                                  <span>{row.currency ?? '--'}</span>
                                  <span>{row.latest_fiscal_year ?? '--'}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs font-bold text-slate-600 dark:text-gray-300">
                              <div>{row.country ?? '--'}</div>
                              <div className="text-[10px] font-mono text-slate-500">{row.exchange ?? '--'}</div>
                            </td>
                            <td className="max-w-[170px] px-3 py-3 text-xs font-bold text-slate-600 dark:text-gray-300">
                              <div className="truncate">{row.sector ?? '--'}</div>
                              <div className="truncate text-[10px] font-mono text-slate-500">{row.industry ?? '--'}</div>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div className="text-sm font-black tabular-nums">{formatScore(row.score)}</div>
                              <div className="text-[10px] font-mono text-slate-500">{formatScore(row.confidence)} conf</div>
                            </td>
                            <td className="px-3 py-3 text-right text-xs font-mono font-black">{formatScore(row.growth_score)}</td>
                            <td className="px-3 py-3 text-right text-xs font-mono font-black">{formatScore(row.profitability_score)}</td>
                            <td className="px-3 py-3 text-right text-xs font-mono font-black">{formatPct(row.latest_roic)}</td>
                            <td className="px-3 py-3 text-right text-xs font-mono font-black">{formatRatio(row.latest_net_debt_to_ebitda)}</td>
                            <td className="px-3 py-3 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <span
                                  title={stateHelp(row.overall_state)}
                                  className={cn('rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', stateBadgeClass(row.overall_state))}
                                >
                                  {stateLabel(row.overall_state)}
                                </span>
                                {(failTotal > 0 || missingTotal > 0) && (
                                  <span className="text-[9px] font-mono text-slate-500">
                                    F{failTotal} M{missingTotal}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                type="button"
                aria-label="Resize Trident detail separator"
                title="Drag to resize detail panel"
                onPointerDown={handleDetailResizePointerDown}
                onKeyDown={handleDetailResizeKeyDown}
                className="group hidden min-h-0 cursor-ew-resize items-center justify-center border-y border-slate-200 bg-slate-100/60 transition-colors hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/10 dark:bg-[#080A0F] dark:hover:bg-white/5 dark:focus-visible:ring-[#00FF88] xl:flex"
              >
                <span className="h-20 w-1 rounded-full bg-slate-300 transition-colors group-hover:bg-slate-500 group-focus-visible:bg-blue-500 dark:bg-white/20 dark:group-hover:bg-[#00FF88] dark:group-focus-visible:bg-[#00FF88]" />
              </button>

              <aside className="relative min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117] xl:rounded-l-none">
                {selectedRow && (
                  <div className="flex h-full flex-col">
                    <div className="border-b border-slate-200 p-4 dark:border-white/10">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-lg font-black text-slate-950 dark:text-white">{selectedRow.name ?? selectedRow.ticker}</div>
                          <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-slate-500">
                            <span>{selectedRow.ticker}</span>
                            <span>{selectedRow.exchange ?? '--'}</span>
                            <span>{selectedRow.country ?? '--'}</span>
                          </div>
                        </div>
                        <span
                          title={stateHelp(selectedRow.overall_state)}
                          className={cn('rounded border px-2 py-1 text-[10px] font-black uppercase tracking-wider', stateBadgeClass(selectedRow.overall_state))}
                        >
                          {stateLabel(selectedRow.overall_state)}
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-4 gap-2">
                        <MetricTile label="Score" value={formatScore(selectedRow.score)} />
                        <MetricTile label="Conf" value={formatScore(selectedRow.confidence)} />
                        <MetricTile label="ROIC" value={formatPct(selectedRow.latest_roic)} />
                        <MetricTile label="Debt" value={formatRatio(selectedRow.latest_net_debt_to_ebitda)} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <MetricTile label="Pass" value={formatScore(selectedRow.criteria_pass_count ?? summaryNumber(selectedRow, 'criteria_pass'))} />
                        <MetricTile label="Fail" value={formatScore(selectedRow.criteria_fail_count ?? summaryNumber(selectedRow, 'criteria_fail'))} />
                        <MetricTile label="Missing" value={formatScore(selectedRow.criteria_missing_count ?? summaryNumber(selectedRow, 'criteria_missing'))} />
                      </div>

                      {selectedRow.failed_eliminators.length > 0 && (
                        <div className="mt-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
                          <ShieldAlert className="h-4 w-4" />
                          Eliminator: {selectedRow.failed_eliminators.join(', ')}
                        </div>
                      )}

                      <TridentRegressionChart ticker={selectedRow.ticker} assetCurrency={selectedRow.currency} />
                    </div>

                    <div className="border-b border-slate-200 p-3 dark:border-white/10">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          {HORIZONS.map((value) => (
                            <button
                              key={value}
                              onClick={() => setHorizon(value)}
                              className={cn(
                                'h-8 min-w-10 rounded-md border px-2 text-[10px] font-black uppercase tracking-wider transition-colors',
                                horizon === value
                                  ? 'border-slate-950 bg-slate-950 text-white dark:border-[#00FF88] dark:bg-[#00FF88] dark:text-black'
                                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:bg-black/20 dark:text-gray-300 dark:hover:bg-white/5'
                              )}
                            >
                              {value}Y
                            </button>
                          ))}
                        </div>
                        <div className="text-right text-[10px] font-mono text-slate-500">
                          <div>{horizonSummary?.status ?? 'missing'}</div>
                          <div>
                            {horizonSummary?.start_year ?? '--'}-{horizonSummary?.end_year ?? '--'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-auto p-4">
                      {criteriaError ? (
                        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
                          Criteria unavailable for {selectedRow.ticker}.
                        </div>
                      ) : isCriteriaLoading ? (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-600 dark:border-white/10 dark:bg-black/20 dark:text-gray-300">
                          Loading {horizon}Y criteria.
                        </div>
                      ) : horizonCriteria.length === 0 ? (
                        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                          No {horizon}Y criteria rows returned for {selectedRow.ticker}.
                        </div>
                      ) : (
                        CATEGORIES.map((category) => {
                          const rowsForCategory = horizonCriteria.filter((row) => row.category === category.key)
                          if (rowsForCategory.length === 0) return null
                          return (
                            <section key={category.key} className="mb-5 last:mb-0">
                              <h2 className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                                {category.label}
                              </h2>
                              <div className="divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-white/5 dark:border-white/10">
                                {rowsForCategory.map((criterionRow) => {
                                  const badge = criterionBadge(criterionRow.status)
                                  return (
                                    <div key={`${criterionRow.horizon_years}-${criterionRow.criterion_key}`} className="p-3">
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="text-xs font-black text-slate-900 dark:text-white">
                                            {criterionRow.label}
                                          </div>
                                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-500">
                                            <span>Actual {formatCriterionValue(criterionRow)}</span>
                                            <span>
                                              Threshold {criterionRow.comparator ?? ''}{' '}
                                              {criterionRow.threshold !== null && criterionRow.criterion_key !== 'net_debt_to_ebitda' && criterionRow.criterion_key !== 'interest_coverage' && criterionRow.criterion_key !== 'debt_to_equity'
                                                ? formatPct(criterionRow.threshold)
                                                : formatRatio(criterionRow.threshold)}
                                            </span>
                                          </div>
                                        </div>
                                        <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', badge.className)}>
                                          <badge.Icon className="h-3 w-3" />
                                          {badge.label}
                                        </span>
                                      </div>
                                      {criterionRow.reason && (
                                        <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-gray-400">
                                          <AlertTriangle className="h-3 w-3" />
                                          {criterionRow.reason}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </section>
                          )
                        })
                      )}
                    </div>

                    <div className="border-t border-slate-200 p-3 text-[10px] font-mono text-slate-500 dark:border-white/10">
                      Provider {selectedRow.source_provider}. Index {selectedRow.source_index ?? '--'}. {selectedRow.source_license_note ?? 'No license note supplied.'}
                    </div>
                  </div>
                )}
              </aside>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 max-w-[160px] rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-black uppercase outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
    >
      <option value="ALL">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 dark:border-white/10 dark:bg-black/20">
      <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black tabular-nums text-slate-950 dark:text-white">{value}</div>
    </div>
  )
}
