"use client"

import dynamic from 'next/dynamic'
import React, { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Clock3,
  DatabaseZap,
  Filter,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { loadEquityScreenerBundle } from '../../lib/equityScreenerData'
import { supabase } from '../../lib/supabase'
import { swrOptions, SWR_REFRESH } from '../../lib/swrConfig'
import { cn } from '../../lib/utils'
import type { EquityScreenerRow, EquityScreenerValuationTag } from '../../types'

type SortKey =
  | 'company'
  | 'score'
  | 'marketCap'
  | 'pe'
  | 'fcfYield'
  | 'fcfMargin'
  | 'growth'
  | 'target'
  | 'trident'
type SortDirection = 'asc' | 'desc'
type SortConfig = { key: SortKey; direction: SortDirection }
type Preset = 'ALL' | 'ESN_UNIVERSE' | 'IT_SERVICES_VALUE' | 'FCF_COMPOUNDERS' | 'QUALITY_VALUE'

const EMPTY_ROWS: EquityScreenerRow[] = []
const PAGE_SIZE = 100
const FORECAST_UNAVAILABLE_STATE = 'FORECAST_UNAVAILABLE'
const TridentRegressionChart = dynamic(
  () => import('../../components/TridentRegressionChart').then((mod) => mod.TridentRegressionChart),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] font-mono text-slate-500 dark:border-white/10 dark:bg-black/20 dark:text-gray-400">
        Loading regression chart.
      </div>
    ),
  }
)
const DEFAULT_SORT: Record<SortKey, SortDirection> = {
  company: 'asc',
  score: 'desc',
  marketCap: 'desc',
  pe: 'asc',
  fcfYield: 'desc',
  fcfMargin: 'desc',
  growth: 'desc',
  target: 'desc',
  trident: 'desc',
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return `${(value * 100).toFixed(1)}%`
}

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return value.toFixed(0)
}

function formatMultiple(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return `${value.toFixed(1)}x`
}

function formatMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  const abs = Math.abs(value)
  const unit = abs >= 1_000_000_000_000 ? 'T' : abs >= 1_000_000_000 ? 'B' : abs >= 1_000_000 ? 'M' : ''
  const divisor = unit === 'T' ? 1_000_000_000_000 : unit === 'B' ? 1_000_000_000 : unit === 'M' ? 1_000_000 : 1
  const prefix = currency ? `${currency} ` : ''
  return `${prefix}${(value / divisor).toFixed(unit ? 1 : 0)}${unit}`
}

function tagLabel(tag: EquityScreenerValuationTag): string {
  if (tag === 'POTENTIAL_VALUE') return 'Potential value'
  if (tag === 'EXPENSIVE') return 'Expensive'
  if (tag === 'FAIR') return 'Fair'
  return 'Insufficient'
}

function tagClass(tag: EquityScreenerValuationTag): string {
  if (tag === 'POTENTIAL_VALUE') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
  if (tag === 'EXPENSIVE') return 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300'
  if (tag === 'FAIR') return 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-300'
  return 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
}

function compareText(left: string | null | undefined, right: string | null | undefined, direction: SortDirection = 'asc'): number {
  const leftValue = left?.trim() || ''
  const rightValue = right?.trim() || ''
  if (!leftValue && !rightValue) return 0
  if (!leftValue) return 1
  if (!rightValue) return -1
  return leftValue.localeCompare(rightValue, 'en', { sensitivity: 'base' }) * (direction === 'asc' ? 1 : -1)
}

function compareNumber(left: number | null | undefined, right: number | null | undefined, direction: SortDirection): number {
  const leftMissing = left === null || left === undefined || Number.isNaN(left)
  const rightMissing = right === null || right === undefined || Number.isNaN(right)
  if (leftMissing && rightMissing) return 0
  if (leftMissing) return 1
  if (rightMissing) return -1
  return (left - right) * (direction === 'asc' ? 1 : -1)
}

function bestPe(row: EquityScreenerRow): number | null {
  const values = [row.forward_pe, row.trailing_pe].filter((value): value is number => value !== null && value !== undefined && value > 0)
  return values.length ? Math.min(...values) : null
}

function compareRows(left: EquityScreenerRow, right: EquityScreenerRow, sort: SortConfig): number {
  const direction = sort.direction
  let result = 0
  if (sort.key === 'company') result = compareText(left.name ?? left.ticker, right.name ?? right.ticker, direction)
  if (sort.key === 'score') result = compareNumber(left.quality_value_score, right.quality_value_score, direction)
  if (sort.key === 'marketCap') result = compareNumber(left.market_cap, right.market_cap, direction)
  if (sort.key === 'pe') result = compareNumber(bestPe(left), bestPe(right), direction)
  if (sort.key === 'fcfYield') result = compareNumber(left.fcf_yield, right.fcf_yield, direction)
  if (sort.key === 'fcfMargin') result = compareNumber(left.fcf_margin, right.fcf_margin, direction)
  if (sort.key === 'growth') result = compareNumber(left.revenue_cagr_3y, right.revenue_cagr_3y, direction)
  if (sort.key === 'target') result = compareNumber(left.target_upside, right.target_upside, direction)
  if (sort.key === 'trident') result = compareNumber(left.trident_score, right.trident_score, direction)
  return result || compareText(left.name ?? left.ticker, right.name ?? right.ticker)
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
  onSort,
}: {
  label: string
  sortKey: SortKey
  sortConfig: SortConfig
  align?: 'left' | 'right' | 'center'
  onSort: (sortKey: SortKey) => void
}) {
  const active = sortConfig.key === sortKey
  return (
    <th aria-sort={active ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'} className="p-0">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'flex w-full items-center gap-1.5 px-3 py-3 transition-colors hover:bg-slate-200/70 dark:hover:bg-white/5',
          align === 'right' && 'justify-end text-right',
          align === 'center' && 'justify-center text-center',
          active && 'text-blue-700 dark:text-[#00FF88]'
        )}
      >
        <span>{label}</span>
        {sortIcon(active, sortConfig.direction)}
      </button>
    </th>
  )
}

function SelectFilter({
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
    <label className="flex items-center gap-2">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 max-w-[180px] rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-black uppercase outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
      >
        <option value="ALL">{label}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function lastSyncLabel(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString('fr-FR')
}

function isStale(value: string | null | undefined): boolean {
  if (!value) return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false
  return Date.now() - parsed.getTime() > 8 * 24 * 60 * 60 * 1000
}

function ScoreBreakdown({ row }: { row: EquityScreenerRow }) {
  const entries = [
    { label: 'Valuation', value: row.score_details.valuation_points },
    { label: 'FCF', value: row.score_details.fcf_points },
    { label: 'Quality', value: row.score_details.quality_points },
    { label: 'Growth', value: row.score_details.growth_points },
    { label: 'Health', value: row.score_details.health_points },
  ]
  return (
    <div className="grid grid-cols-5 gap-2">
      {entries.map(({ label, value }) => (
        <div key={label} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-center dark:border-white/10 dark:bg-black/20">
          <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div>
          <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">{typeof value === 'number' ? value : '--'}</div>
        </div>
      ))}
    </div>
  )
}

export default function ScreenerPage() {
  const [search, setSearch] = useState('')
  const [preset, setPreset] = useState<Preset>('ESN_UNIVERSE')
  const [country, setCountry] = useState('ALL')
  const [sector, setSector] = useState('ALL')
  const [theme, setTheme] = useState('ALL')
  const [tag, setTag] = useState('ALL')
  const [minimumScore, setMinimumScore] = useState('ALL')
  const [maximumPe, setMaximumPe] = useState('ALL')
  const [minimumFcfYield, setMinimumFcfYield] = useState('ALL')
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'score', direction: 'desc' })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const { data, isLoading, error } = useSWR(
    'equity-screener-v1',
    () => loadEquityScreenerBundle(supabase),
    swrOptions(SWR_REFRESH.SLOW)
  )

  const rows = data?.rows ?? EMPTY_ROWS
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const minScore = minimumScore === 'ALL' ? null : Number(minimumScore)
    const maxPe = maximumPe === 'ALL' ? null : Number(maximumPe)
    const minFcf = minimumFcfYield === 'ALL' ? null : Number(minimumFcfYield) / 100

    return rows
      .filter((row) => {
        if (query) {
          const haystack = `${row.ticker} ${row.name ?? ''} ${row.industry ?? ''}`.toLowerCase()
          if (!haystack.includes(query)) return false
        }
        if (preset === 'ESN_UNIVERSE' && !row.themes.includes('IT_SERVICES')) return false
        if (preset === 'IT_SERVICES_VALUE' && (!row.themes.includes('IT_SERVICES') || row.valuation_tag !== 'POTENTIAL_VALUE')) return false
        if (preset === 'FCF_COMPOUNDERS' && ((row.fcf_yield ?? 0) < 0.03 || (row.revenue_cagr_3y ?? 0) < 0.03)) return false
        if (preset === 'QUALITY_VALUE' && (row.quality_value_score < 55 || row.valuation_tag === 'EXPENSIVE')) return false
        if (country !== 'ALL' && row.country !== country) return false
        if (sector !== 'ALL' && row.sector !== sector) return false
        if (theme !== 'ALL' && !row.themes.includes(theme)) return false
        if (tag !== 'ALL' && row.valuation_tag !== tag) return false
        if (minScore !== null && row.quality_value_score < minScore) return false
        if (maxPe !== null && ((bestPe(row) ?? Number.POSITIVE_INFINITY) > maxPe)) return false
        if (minFcf !== null && ((row.fcf_yield ?? Number.NEGATIVE_INFINITY) < minFcf)) return false
        return true
      })
      .sort((left, right) => compareRows(left, right, sortConfig))
  }, [country, maximumPe, minimumFcfYield, minimumScore, preset, rows, search, sector, sortConfig, tag, theme])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const boundedPage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((boundedPage - 1) * PAGE_SIZE, boundedPage * PAGE_SIZE)
  const selectedRow = filteredRows.find((row) => row.instrument_key === selectedKey) ?? filteredRows[0] ?? null
  const lastSync = lastSyncLabel(data?.lastUpdateIso)
  const stale = isStale(data?.lastBackendRun?.finished_at ?? data?.lastUpdateIso)

  const handleSort = (nextKey: SortKey) => {
    setPage(1)
    setSortConfig((current) => {
      if (current.key === nextKey) return { key: nextKey, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      return { key: nextKey, direction: DEFAULT_SORT[nextKey] }
    })
  }

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setPage(1)
  }

  const schemaPending = data?.status === 'SCHEMA_PENDING'
  const itServicesCount = rows.filter((row) => row.themes.includes('IT_SERVICES')).length
  const potentialValueCount = rows.filter((row) => row.valuation_tag === 'POTENTIAL_VALUE').length

  return (
    <AppShell lastSync={lastSync} lastSyncIso={data?.lastUpdateIso ?? null}>
      <main className="flex min-h-[calc(100vh-4rem)] flex-col gap-4 p-3 sm:p-5">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-sm font-black uppercase tracking-[0.24em] text-slate-900 dark:text-white">
              Open Screener
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-slate-500 dark:text-gray-500">
              <span>{data?.rowCount ?? rows.length} instruments</span>
              <span>{itServicesCount} IT services</span>
              <span>{potentialValueCount} potential value</span>
              {data?.lastBackendRun && <span>run {data.lastBackendRun.status.toLowerCase()}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest">
            <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
              <DatabaseZap className="h-3 w-3" />
              Supabase read model
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <Filter className="h-3 w-3" />
              Missing stays visible
            </span>
            {stale && (
              <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <Clock3 className="h-3 w-3" />
                Stale &gt; 8d
              </span>
            )}
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-[#0D1117]">
          <div className="relative min-w-full flex-1 sm:min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
              placeholder="Search company, ticker, industry"
              className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold outline-none transition focus:border-slate-400 dark:border-white/10 dark:bg-black/20 dark:text-white"
            />
          </div>
          <select
            value={preset}
            onChange={(event) => resetPage(setPreset)(event.target.value as Preset)}
            className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-black uppercase outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
          >
            <option value="ESN_UNIVERSE">ESN universe</option>
            <option value="IT_SERVICES_VALUE">ESN value</option>
            <option value="QUALITY_VALUE">Quality value</option>
            <option value="FCF_COMPOUNDERS">FCF compounders</option>
            <option value="ALL">All equities</option>
          </select>
          <SelectFilter label="Country" value={country} options={data?.countries ?? []} onChange={resetPage(setCountry)} />
          <SelectFilter label="Sector" value={sector} options={data?.sectors ?? []} onChange={resetPage(setSector)} />
          <SelectFilter label="Theme" value={theme} options={data?.themes ?? []} onChange={resetPage(setTheme)} />
          <select
            value={tag}
            onChange={(event) => resetPage(setTag)(event.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-black uppercase outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
          >
            <option value="ALL">Any tag</option>
            {(data?.valuationTags ?? []).map((value) => (
              <option key={value} value={value}>{tagLabel(value)}</option>
            ))}
          </select>
          <select value={minimumScore} onChange={(event) => resetPage(setMinimumScore)(event.target.value)} className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-black uppercase outline-none dark:border-white/10 dark:bg-black/20 dark:text-white">
            <option value="ALL">Any score</option>
            <option value="70">Score &gt;= 70</option>
            <option value="55">Score &gt;= 55</option>
            <option value="40">Score &gt;= 40</option>
          </select>
          <select value={maximumPe} onChange={(event) => resetPage(setMaximumPe)(event.target.value)} className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-black uppercase outline-none dark:border-white/10 dark:bg-black/20 dark:text-white">
            <option value="ALL">Any PE</option>
            <option value="15">PE &lt;= 15</option>
            <option value="25">PE &lt;= 25</option>
            <option value="35">PE &lt;= 35</option>
          </select>
          <select value={minimumFcfYield} onChange={(event) => resetPage(setMinimumFcfYield)(event.target.value)} className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-black uppercase outline-none dark:border-white/10 dark:bg-black/20 dark:text-white">
            <option value="ALL">Any FCF yield</option>
            <option value="8">FCF yield &gt;= 8%</option>
            <option value="5">FCF yield &gt;= 5%</option>
            <option value="3">FCF yield &gt;= 3%</option>
          </select>
        </section>

        {error ? (
          <EmptyState tone="error" className="flex-1" title="Open screener unreadable" message="The frontend cannot read equity_screener_latest. Apply the Supabase migration and verify anon SELECT grants." />
        ) : isLoading ? (
          <EmptyState tone="loading" className="flex-1" title="Loading open screener" message="Reading backend-computed screening metrics from Supabase." />
        ) : schemaPending ? (
          <EmptyState tone="warning" className="flex-1" title="Open screener schema pending" message={data?.message ?? 'Apply the equity screener migration and run the backend sync.'} />
        ) : rows.length === 0 ? (
          <EmptyState tone="warning" className="flex-1" title="Open screener sync pending" message="The schema is readable, but no equity screener rows have been written yet. Run sync_equity_screener.py after Trident and stock insights." />
        ) : filteredRows.length === 0 ? (
          <EmptyState tone="neutral" className="flex-1" title="No equities match these filters" message="Relax the preset, country, theme, PE, FCF yield, or score filter." />
        ) : (
          <section className="grid flex-1 min-h-0 grid-cols-1 gap-4 2xl:grid-cols-[minmax(760px,1fr)_420px]">
            <div className="h-[580px] min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117] 2xl:h-[calc(100vh-260px)]">
              <div className="flex h-full flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-mono text-slate-500 dark:border-white/10 dark:bg-[#080A0F] dark:text-gray-400">
                  <span>Rows {(boundedPage - 1) * PAGE_SIZE + 1}-{Math.min(boundedPage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}</span>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={boundedPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border border-slate-200 px-2 py-1 font-black uppercase disabled:opacity-40 dark:border-white/10">Prev</button>
                    <span className="font-black text-slate-700 dark:text-gray-200">{boundedPage}/{totalPages}</span>
                    <button type="button" disabled={boundedPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded border border-slate-200 px-2 py-1 font-black uppercase disabled:opacity-40 dark:border-white/10">Next</button>
                  </div>
                </div>

                <div className="block min-h-0 flex-1 overflow-auto p-2 md:hidden">
                  <div className="space-y-2">
                    {pageRows.map((row) => (
                      <button
                        type="button"
                        key={row.instrument_key}
                        data-equity-screener-row="true"
                        onClick={() => setSelectedKey(row.instrument_key)}
                        className={cn(
                          'w-full rounded-lg border p-3 text-left transition-colors',
                          selectedRow?.instrument_key === row.instrument_key
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
                              <span>{row.themes[0] ?? '--'}</span>
                            </div>
                          </div>
                          <span className={cn('shrink-0 rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', tagClass(row.valuation_tag))}>{tagLabel(row.valuation_tag)}</span>
                        </div>
                        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                          <Metric label="Score" value={formatScore(row.quality_value_score)} />
                          <Metric label="PE" value={formatMultiple(bestPe(row))} />
                          <Metric label="FCF Y" value={formatPct(row.fcf_yield)} />
                          <Metric label="CAGR" value={formatPct(row.revenue_cagr_3y)} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="hidden min-h-0 flex-1 overflow-auto md:block">
                  <table className="min-w-[1260px] w-full border-collapse text-left">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:bg-[#101722] dark:text-gray-400">
                      <tr>
                        <SortableHeader label="Company" sortKey="company" sortConfig={sortConfig} onSort={handleSort} />
                        <th className="px-3 py-3">Theme</th>
                        <SortableHeader label="Score" sortKey="score" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="Mkt Cap" sortKey="marketCap" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="PE" sortKey="pe" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="FCF Yield" sortKey="fcfYield" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="FCF Margin" sortKey="fcfMargin" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="Rev 3Y" sortKey="growth" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="Target" sortKey="target" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <SortableHeader label="Trident" sortKey="trident" sortConfig={sortConfig} align="right" onSort={handleSort} />
                        <th className="px-3 py-3 text-center">Tag</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {pageRows.map((row) => (
                        <tr
                          key={row.instrument_key}
                          data-equity-screener-row="true"
                          onClick={() => setSelectedKey(row.instrument_key)}
                          className={cn('cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-white/5', selectedRow?.instrument_key === row.instrument_key && 'bg-blue-50 dark:bg-[#00FF88]/10')}
                        >
                          <td className="px-3 py-3">
                            <div className="max-w-[240px] truncate text-sm font-black text-slate-950 dark:text-white">{row.name ?? row.ticker}</div>
                            <div className="mt-0.5 flex items-center gap-2 text-[10px] font-mono text-slate-500">
                              <span>{row.ticker}</span>
                              <span>{row.country ?? '--'}</span>
                              <span>{row.latest_fiscal_year ?? '--'}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-xs font-bold text-slate-600 dark:text-gray-300">
                            <div className="max-w-[170px] truncate">{row.themes.join(', ') || '--'}</div>
                            <div className="max-w-[170px] truncate text-[10px] font-mono text-slate-500">{row.industry ?? row.sector ?? '--'}</div>
                          </td>
                          <td className="px-3 py-3 text-right text-sm font-black tabular-nums">{formatScore(row.quality_value_score)}</td>
                          <td className="px-3 py-3 text-right text-xs font-mono font-black">{formatMoney(row.market_cap, row.valuation_currency)}</td>
                          <td className="px-3 py-3 text-right text-xs font-mono font-black">{formatMultiple(bestPe(row))}</td>
                          <td className="px-3 py-3 text-right text-xs font-mono font-black">{formatPct(row.fcf_yield)}</td>
                          <td className="px-3 py-3 text-right text-xs font-mono font-black">{formatPct(row.fcf_margin)}</td>
                          <td className="px-3 py-3 text-right text-xs font-mono font-black">{formatPct(row.revenue_cagr_3y)}</td>
                          <td className="px-3 py-3 text-right text-xs font-mono font-black">{formatPct(row.target_upside)}</td>
                          <td className="px-3 py-3 text-right text-xs font-mono font-black">{formatScore(row.trident_score)}</td>
                          <td className="px-3 py-3 text-center">
                            <span className={cn('rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', tagClass(row.valuation_tag))}>{tagLabel(row.valuation_tag)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <aside className="h-[70vh] min-h-[520px] overflow-auto rounded-lg border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#0D1117] 2xl:h-[calc(100vh-260px)] 2xl:min-h-0">
              {selectedRow && (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-black text-slate-950 dark:text-white">{selectedRow.name ?? selectedRow.ticker}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-mono text-slate-500">
                        <span>{selectedRow.ticker}</span>
                        {selectedRow.provider_symbol && selectedRow.provider_symbol !== selectedRow.ticker && <span>via {selectedRow.provider_symbol}</span>}
                        <span>{selectedRow.exchange ?? '--'}</span>
                        <span>{selectedRow.country ?? '--'}</span>
                      </div>
                    </div>
                    <span className={cn('shrink-0 rounded border px-2 py-1 text-[9px] font-black uppercase tracking-wider', tagClass(selectedRow.valuation_tag))}>{tagLabel(selectedRow.valuation_tag)}</span>
                  </div>
                  <ScoreBreakdown row={selectedRow} />
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Market cap" value={formatMoney(selectedRow.market_cap, selectedRow.valuation_currency)} />
                    <Metric label="Revenue" value={formatMoney(selectedRow.revenue, selectedRow.financial_currency)} />
                    <Metric label="Free cash flow" value={formatMoney(selectedRow.free_cash_flow, selectedRow.financial_currency)} />
                    <Metric label="FCF yield" value={formatPct(selectedRow.fcf_yield)} />
                    <Metric label="Trailing PE" value={formatMultiple(selectedRow.trailing_pe)} />
                    <Metric label="Forward PE" value={formatMultiple(selectedRow.forward_pe)} />
                    <Metric label="ROIC" value={formatPct(selectedRow.latest_roic)} />
                    <Metric label="Debt / EBITDA" value={formatMultiple(selectedRow.latest_net_debt_to_ebitda)} />
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-black/20">
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      <SlidersHorizontal className="h-3 w-3" />
                      Data states
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedRow.data_state.map((state) => (
                        <span key={state} className="rounded border border-slate-300 bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wider text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">{state}</span>
                      ))}
                    </div>
                  </div>
                  {selectedRow.data_state.includes(FORECAST_UNAVAILABLE_STATE) && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] font-mono text-slate-500 dark:border-white/10 dark:bg-black/20 dark:text-gray-400">
                      Forward revenue forecast unavailable. Current row uses historical financials, stock insights, and Trident facts from Supabase.
                    </div>
                  )}
                  <TridentRegressionChart
                    ticker={selectedRow.ticker}
                    instrumentKey={selectedRow.instrument_key}
                    providerSymbol={selectedRow.provider_symbol}
                    assetCurrency={selectedRow.currency}
                  />
                </div>
              )}
            </aside>
          </section>
        )}
      </main>
    </AppShell>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-center dark:border-white/10 dark:bg-black/20">
      <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">{value}</div>
    </div>
  )
}
