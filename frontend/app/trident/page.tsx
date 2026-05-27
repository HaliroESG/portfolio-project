"use client"

import dynamic from 'next/dynamic'
import React, { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronsUpDown,
  Clock3,
  CircleHelp,
  MinusCircle,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { TridentCompanyInsight } from '../../components/TridentCompanyInsight'
import { supabase } from '../../lib/supabase'
import { loadTridentInsightCoverage } from '../../lib/tridentInsights'
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

type SortKey = 'company' | 'market' | 'sector' | 'score' | 'growth' | 'profitability' | 'roic' | 'debt' | 'state'
type SortDirection = 'asc' | 'desc'
type SortConfig = { key: SortKey; direction: SortDirection }
type ScoreFilter = 'ALL' | '80' | '60' | '40'
type Horizon = 1 | 3 | 5 | 10

const TridentRegressionChart = dynamic(
  () => import('../../components/TridentRegressionChart').then((mod) => mod.TridentRegressionChart),
  {
    ssr: false,
    loading: () => (
      <div className="mt-4 h-[270px] rounded-lg border border-slate-200 bg-slate-50 p-3 text-[10px] font-mono text-slate-500 dark:border-white/10 dark:bg-black/20 dark:text-gray-400">
        Loading regression chart.
      </div>
    ),
  }
)

const HORIZONS: Horizon[] = [1, 3, 5, 10]
const EMPTY_ROWS: TridentScreenerRow[] = []
const TRIDENT_PAGE_SIZE = 100
const CATEGORIES: Array<{ key: TridentCategory; label: string }> = [
  { key: 'growth', label: 'Growth' },
  { key: 'profitability', label: 'Profitability' },
  { key: 'capital', label: 'Capital' },
  { key: 'health', label: 'Health' },
]
const DEFAULT_SORT_DIRECTIONS: Record<SortKey, SortDirection> = {
  company: 'asc',
  market: 'asc',
  sector: 'asc',
  score: 'desc',
  growth: 'desc',
  profitability: 'desc',
  roic: 'desc',
  debt: 'asc',
  state: 'asc',
}
const STATE_SORT_RANK: Record<TridentOverallState, number> = {
  QUALIFIED: 0,
  WATCHLIST: 1,
  REJECTED: 2,
  NO_DATA: 3,
}

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

function compareText(left: string | null | undefined, right: string | null | undefined, direction: SortDirection = 'asc'): number {
  const leftValue = left?.trim() || ''
  const rightValue = right?.trim() || ''
  if (!leftValue && !rightValue) return 0
  if (!leftValue) return 1
  if (!rightValue) return -1
  const multiplier = direction === 'asc' ? 1 : -1
  return leftValue.localeCompare(rightValue, 'en', { sensitivity: 'base' }) * multiplier
}

function compareNumber(left: number | null | undefined, right: number | null | undefined, direction: SortDirection): number {
  const leftMissing = left === null || left === undefined || Number.isNaN(left)
  const rightMissing = right === null || right === undefined || Number.isNaN(right)
  if (leftMissing && rightMissing) return 0
  if (leftMissing) return 1
  if (rightMissing) return -1
  const multiplier = direction === 'asc' ? 1 : -1
  return (left - right) * multiplier
}

function compareTridentRows(left: TridentScreenerRow, right: TridentScreenerRow, sortConfig: SortConfig): number {
  const direction = sortConfig.direction
  let result = 0

  if (sortConfig.key === 'company') {
    result = compareText(left.name ?? left.ticker, right.name ?? right.ticker, direction)
  }
  if (sortConfig.key === 'market') {
    result = compareText(left.country, right.country, direction) || compareText(left.exchange, right.exchange, direction)
  }
  if (sortConfig.key === 'sector') {
    result = compareText(left.sector, right.sector, direction) || compareText(left.industry, right.industry, direction)
  }
  if (sortConfig.key === 'score') result = compareNumber(left.score, right.score, direction)
  if (sortConfig.key === 'growth') result = compareNumber(left.growth_score, right.growth_score, direction)
  if (sortConfig.key === 'profitability') result = compareNumber(left.profitability_score, right.profitability_score, direction)
  if (sortConfig.key === 'roic') result = compareNumber(left.latest_roic, right.latest_roic, direction)
  if (sortConfig.key === 'debt') result = compareNumber(left.latest_net_debt_to_ebitda, right.latest_net_debt_to_ebitda, direction)
  if (sortConfig.key === 'state') {
    const leftRank = left.overall_state ? STATE_SORT_RANK[left.overall_state] : 4
    const rightRank = right.overall_state ? STATE_SORT_RANK[right.overall_state] : 4
    result = (leftRank - rightRank) * (direction === 'asc' ? 1 : -1)
  }

  if (result === 0) {
    result = compareText(left.name ?? left.ticker, right.name ?? right.ticker)
  }

  return result
}

function sortIcon(active: boolean, direction: SortDirection) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-50" />
  return direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

function SortableHeader({
  label,
  sortKey,
  sortConfig,
  align = 'left',
  className,
  onSort,
}: {
  label: string
  sortKey: SortKey
  sortConfig: SortConfig
  align?: 'left' | 'right' | 'center'
  className?: string
  onSort: (sortKey: SortKey) => void
}) {
  const active = sortConfig.key === sortKey

  return (
    <th
      aria-sort={active ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('p-0', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'flex w-full items-center gap-1.5 px-3 py-3 transition-colors hover:bg-slate-200/70 dark:hover:bg-white/5',
          align === 'right' && 'justify-end text-right',
          align === 'center' && 'justify-center text-center',
          align === 'left' && 'justify-start text-left',
          active && 'text-blue-700 dark:text-[#00FF88]'
        )}
      >
        <span>{label}</span>
        {sortIcon(active, sortConfig.direction)}
      </button>
    </th>
  )
}

function PaginationBar({
  page,
  totalPages,
  start,
  end,
  total,
  onPrevious,
  onNext,
}: {
  page: number
  totalPages: number
  start: number
  end: number
  total: number
  onPrevious: () => void
  onNext: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-mono text-slate-500 dark:border-white/10 dark:bg-[#080A0F] dark:text-gray-400">
      <span>
        Rows {start}-{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrevious}
          disabled={page <= 1}
          className="rounded border border-slate-200 px-2 py-1 font-black uppercase tracking-wider text-slate-600 transition enabled:hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-gray-300 dark:enabled:hover:bg-white/10"
        >
          Prev
        </button>
        <span className="font-black text-slate-700 dark:text-gray-200">
          {page}/{totalPages}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= totalPages}
          className="rounded border border-slate-200 px-2 py-1 font-black uppercase tracking-wider text-slate-600 transition enabled:hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-gray-300 dark:enabled:hover:bg-white/10"
        >
          Next
        </button>
      </div>
    </div>
  )
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
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'score', direction: 'desc' })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [horizon, setHorizon] = useState<Horizon>(3)
  const [page, setPage] = useState(1)
  const [detailWidth, setDetailWidth] = usePersistedPanelWidth(TRIDENT_DETAIL_WIDTH)

  const { data, isLoading, error } = useSWR(
    'trident-screener-v1',
    () => loadTridentBundle(supabase),
    swrOptions(SWR_REFRESH.SLOW)
  )
  const { data: insightCoverage } = useSWR(
    'trident-stock-insight-coverage-v1',
    () => loadTridentInsightCoverage(supabase),
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
        return compareTridentRows(left, right, sortConfig)
      })
  }, [country, exchange, rows, scoreFilter, search, sector, sortConfig, state])

  const selectedRow = useMemo(() => {
    return filteredRows.find((row) => row.instrument_key === selectedKey) ?? filteredRows[0] ?? null
  }, [filteredRows, selectedKey])
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / TRIDENT_PAGE_SIZE))
  const boundedPage = Math.min(page, totalPages)
  const pageStartIndex = (boundedPage - 1) * TRIDENT_PAGE_SIZE
  const pageRows = useMemo(() => {
    return filteredRows.slice(pageStartIndex, pageStartIndex + TRIDENT_PAGE_SIZE)
  }, [filteredRows, pageStartIndex])
  const visibleStart = filteredRows.length === 0 ? 0 : pageStartIndex + 1
  const visibleEnd = Math.min(pageStartIndex + TRIDENT_PAGE_SIZE, filteredRows.length)

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
  const insightCoverageLabel = useMemo(() => {
    if (!insightCoverage) return 'Insights checking'
    if (insightCoverage.status === 'SCHEMA_PENDING') return 'Insights schema pending'
    const total = rows.length || 0
    const generated = insightCoverage.generatedCount
    const denominator = total > 0 ? total.toString() : '--'
    const aiLabel = insightCoverage.aiReadyCount > 0 ? ` · ${insightCoverage.aiReadyCount} AI` : ''
    return `Insights ${generated}/${denominator} generated · ${insightCoverage.freshCount} fresh${aiLabel}`
  }, [insightCoverage, rows.length])
  const insightCoverageTone =
    !insightCoverage || insightCoverage.status === 'SCHEMA_PENDING'
      ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
      : insightCoverage.generatedCount > 0
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
      : 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'

  const handleSort = (nextSortKey: SortKey) => {
    if (selectedRow && selectedRow.instrument_key !== selectedKey) {
      setSelectedKey(selectedRow.instrument_key)
    }
    setPage(1)

    setSortConfig((current) => {
      if (current.key === nextSortKey) {
        return { key: nextSortKey, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { key: nextSortKey, direction: DEFAULT_SORT_DIRECTIONS[nextSortKey] }
    })
  }

  const resetPageWith = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setPage(1)
  }

  const goToPreviousPage = () => setPage((current) => Math.max(1, current - 1))
  const goToNextPage = () => setPage((current) => Math.min(totalPages, current + 1))

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
    <AppShell lastSync={lastSync} lastSyncIso={data?.lastUpdateIso ?? null} coveragePct={coveragePct}>
        <main className="flex min-h-[calc(100vh-4rem)] flex-col gap-4 p-3 sm:p-5">
          <section className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-sm font-black uppercase tracking-[0.24em] text-slate-900 dark:text-white">
                Trident Screener
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-slate-500 dark:text-gray-500">
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

            <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest">
              <span className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                Backend computed
              </span>
              <span className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                Missing != Fail
              </span>
              <span className={cn('rounded border px-3 py-1.5', insightCoverageTone)}>
                {insightCoverageLabel}
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

          <section className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-[#0D1117]">
            <div className="relative min-w-full flex-1 sm:min-w-[240px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
                placeholder="Search name or ticker"
                className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold outline-none transition focus:border-slate-400 dark:border-white/10 dark:bg-black/20 dark:text-white"
              />
            </div>

            <FilterSelect label="Country" value={country} options={data?.countries ?? []} onChange={resetPageWith(setCountry)} />
            <FilterSelect label="Exchange" value={exchange} options={data?.exchanges ?? []} onChange={resetPageWith(setExchange)} />
            <FilterSelect label="Sector" value={sector} options={data?.sectors ?? []} onChange={resetPageWith(setSector)} />
            <select
              value={state}
              onChange={(event) => {
                setState(event.target.value as 'ALL' | TridentOverallState)
                setPage(1)
              }}
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
              onChange={(event) => {
                setScoreFilter(event.target.value as ScoreFilter)
                setPage(1)
              }}
              className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-black uppercase outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
            >
              <option value="ALL">Any score</option>
              <option value="80">Score &gt;= 80</option>
              <option value="60">Score &gt;= 60</option>
              <option value="40">Score &gt;= 40</option>
            </select>
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
              className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-visible 2xl:grid-cols-[minmax(680px,1fr)_14px_minmax(var(--trident-detail-min),var(--trident-detail-width))] 2xl:gap-0 2xl:overflow-hidden"
              style={{
                '--trident-detail-width': `${detailWidth}px`,
                '--trident-detail-min': `${TRIDENT_DETAIL_WIDTH.min}px`,
              } as React.CSSProperties}
            >
              <div className="h-[560px] min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117] 2xl:h-[calc(100vh-260px)] 2xl:rounded-r-none">
                <div className="flex h-full min-h-0 flex-col">
                  <PaginationBar
                    page={boundedPage}
                    totalPages={totalPages}
                    start={visibleStart}
                    end={visibleEnd}
                    total={filteredRows.length}
                    onPrevious={goToPreviousPage}
                    onNext={goToNextPage}
                  />
                <div className="block min-h-0 flex-1 overflow-auto p-2 md:hidden">
                  <div className="space-y-2">
                    {pageRows.map((row) => {
                      const isSelected = row.instrument_key === selectedRow?.instrument_key
                      const failTotal = row.criteria_fail_count ?? summaryNumber(row, 'criteria_fail')
                      const missingTotal = row.criteria_missing_count ?? summaryNumber(row, 'criteria_missing')
                      return (
                        <button
                          key={row.instrument_key}
                          type="button"
                          data-trident-row="true"
                          onClick={() => setSelectedKey(row.instrument_key)}
                          className={cn(
                            'w-full rounded-lg border p-3 text-left transition-colors',
                            isSelected
                              ? 'border-[#00FF88]/40 bg-[#00FF88]/10'
                              : 'border-slate-200 bg-slate-50 hover:bg-white dark:border-white/10 dark:bg-black/20 dark:hover:bg-white/5'
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black text-slate-950 dark:text-white">{row.name ?? row.ticker}</div>
                              <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-mono text-slate-500">
                                <span>{row.ticker}</span>
                                <span>{row.country ?? '--'}</span>
                                <span>{row.currency ?? '--'}</span>
                              </div>
                            </div>
                            <span
                              title={stateHelp(row.overall_state)}
                              className={cn('shrink-0 rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', stateBadgeClass(row.overall_state))}
                            >
                              {stateLabel(row.overall_state)}
                            </span>
                          </div>
                          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                            <MetricTile label="Score" value={formatScore(row.score)} />
                            <MetricTile label="Growth" value={formatScore(row.growth_score)} />
                            <MetricTile label="ROIC" value={formatPct(row.latest_roic)} />
                            <MetricTile label="Debt" value={formatRatio(row.latest_net_debt_to_ebitda)} />
                          </div>
                          {(failTotal > 0 || missingTotal > 0) && (
                            <div className="mt-2 text-[10px] font-mono text-slate-500">
                              Fail {failTotal} · Missing {missingTotal}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="hidden min-h-0 flex-1 overflow-auto md:block">
                  <table className="min-w-[1180px] w-full border-collapse text-left">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:bg-[#101722] dark:text-gray-400">
                      <tr>
                        <SortableHeader label="Company" sortKey="company" sortConfig={sortConfig} className="sticky left-0 z-20 w-[280px] bg-slate-100 dark:bg-[#101722]" onSort={handleSort} />
                        <SortableHeader label="Market" sortKey="market" sortConfig={sortConfig} onSort={handleSort} />
                        <SortableHeader label="Sector" sortKey="sector" sortConfig={sortConfig} onSort={handleSort} />
                        <SortableHeader label="Score" sortKey="score" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="Growth" sortKey="growth" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="Profit" sortKey="profitability" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="ROIC" sortKey="roic" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="Debt" sortKey="debt" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="State" sortKey="state" sortConfig={sortConfig} align="center" onSort={handleSort} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {pageRows.map((row) => {
                        const isSelected = row.instrument_key === selectedRow?.instrument_key
                        const failTotal = row.criteria_fail_count ?? summaryNumber(row, 'criteria_fail')
                        const missingTotal = row.criteria_missing_count ?? summaryNumber(row, 'criteria_missing')
                        return (
                          <tr
                            key={row.instrument_key}
                            data-trident-row="true"
                            onClick={() => setSelectedKey(row.instrument_key)}
                            className={cn(
                              'cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-white/5',
                              isSelected && 'bg-blue-50 dark:bg-[#00FF88]/10'
                            )}
                          >
                            <td className={cn('sticky left-0 z-[1] px-3 py-3', isSelected ? 'bg-blue-50 dark:bg-[#142217]' : 'bg-white dark:bg-[#0D1117]')}>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-black text-slate-950 dark:text-white">{row.name ?? row.ticker}</div>
                                <div className="mt-0.5 flex items-center gap-2 text-[10px] font-mono text-slate-500">
                                  <span>{row.ticker}</span>
                                  {row.provider_symbol && row.provider_symbol !== row.ticker && <span>via {row.provider_symbol}</span>}
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
              </div>

              <button
                type="button"
                aria-label="Resize Trident detail separator"
                title="Drag to resize detail panel"
                onPointerDown={handleDetailResizePointerDown}
                onKeyDown={handleDetailResizeKeyDown}
                className="group hidden min-h-0 cursor-ew-resize items-center justify-center border-y border-slate-200 bg-slate-100/60 transition-colors hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/10 dark:bg-[#080A0F] dark:hover:bg-white/5 dark:focus-visible:ring-[#00FF88] 2xl:flex"
              >
                <span className="h-20 w-1 rounded-full bg-slate-300 transition-colors group-hover:bg-slate-500 group-focus-visible:bg-blue-500 dark:bg-white/20 dark:group-hover:bg-[#00FF88] dark:group-focus-visible:bg-[#00FF88]" />
              </button>

              <aside className="relative h-[70vh] min-h-[520px] overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117] 2xl:h-[calc(100vh-260px)] 2xl:min-h-0 2xl:rounded-l-none">
                {selectedRow && (
                  <div className="flex h-full flex-col">
                    <div className="border-b border-slate-200 p-4 dark:border-white/10">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-lg font-black text-slate-950 dark:text-white">{selectedRow.name ?? selectedRow.ticker}</div>
                          <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-slate-500">
                            <span>{selectedRow.ticker}</span>
                            {selectedRow.provider_symbol && selectedRow.provider_symbol !== selectedRow.ticker && <span>via {selectedRow.provider_symbol}</span>}
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

                      <TridentCompanyInsight
                        instrumentKey={selectedRow.instrument_key}
                        ticker={selectedRow.ticker}
                        providerSymbol={selectedRow.provider_symbol}
                      />

                      <TridentRegressionChart
                        ticker={selectedRow.ticker}
                        instrumentKey={selectedRow.instrument_key}
                        providerSymbol={selectedRow.provider_symbol}
                        assetCurrency={selectedRow.currency}
                      />
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
    </AppShell>
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
      className="h-9 min-w-[120px] flex-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-black uppercase outline-none dark:border-white/10 dark:bg-black/20 dark:text-white sm:max-w-[170px] sm:flex-none"
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
