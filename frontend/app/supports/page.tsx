"use client"

import React, { useMemo, useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUpDown, Library, LockKeyhole, Search } from 'lucide-react'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import type { InvestmentSupportRow, InvestmentSupportType, SupportAvailabilityRow, SupportMetricsState } from '../../types'

type SortKey = 'score' | 'name' | 'fee' | 'sri' | 'perf5y'
type SortDirection = 'asc' | 'desc'
type SortConfig = { key: SortKey; direction: SortDirection }
type RawRow = Record<string, unknown>

const SUPPORT_SELECTOR = [
  'source_id',
  'isin',
  'name',
  'support_type',
  'legal_form',
  'manager',
  'sri',
  'performance_1y_pct',
  'performance_5y_pct',
  'asset_fee_pct',
  'contract_fee_pct',
  'total_fee_pct',
  'retrocession_pct',
  'morningstar_rating',
  'quantalys_rating',
  'computed_momentum_pct',
  'computed_volatility_pct',
  'computed_drawdown_pct',
  'computed_beta',
  'computed_alpha_pct',
  'metrics_state',
  'score',
  'score_details',
  'page',
  'raw_text',
  'updated_at',
].join(',')

const PAGE_SIZE = 100
const SUPPORT_TYPES: InvestmentSupportType[] = ['ETF', 'FUND', 'FONDS_EURO', 'SCPI', 'SCI', 'OPCI', 'PRIVATE_ASSET', 'UNKNOWN']
const DEFAULT_SORT: SortConfig = { key: 'score', direction: 'desc' }

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseSupportType(value: unknown): InvestmentSupportType {
  return SUPPORT_TYPES.includes(value as InvestmentSupportType) ? value as InvestmentSupportType : 'UNKNOWN'
}

function parseMetricsState(value: unknown): SupportMetricsState {
  if (value === 'READY' || value === 'PARTIAL' || value === 'METRICS_UNAVAILABLE') return value
  return 'METRICS_UNAVAILABLE'
}

function parseSupportRow(raw: RawRow): InvestmentSupportRow | null {
  const sourceId = readString(raw.source_id)
  const isin = readString(raw.isin)
  const name = readString(raw.name)
  if (!sourceId || !isin || !name) return null
  const scoreDetails = raw.score_details && typeof raw.score_details === 'object' && !Array.isArray(raw.score_details)
    ? raw.score_details as Record<string, unknown>
    : {}
  return {
    source_id: sourceId,
    isin,
    name,
    support_type: parseSupportType(raw.support_type),
    legal_form: readString(raw.legal_form),
    manager: readString(raw.manager),
    sri: readNumber(raw.sri),
    performance_1y_pct: readNumber(raw.performance_1y_pct),
    performance_5y_pct: readNumber(raw.performance_5y_pct),
    asset_fee_pct: readNumber(raw.asset_fee_pct),
    contract_fee_pct: readNumber(raw.contract_fee_pct),
    total_fee_pct: readNumber(raw.total_fee_pct),
    retrocession_pct: readNumber(raw.retrocession_pct),
    morningstar_rating: readNumber(raw.morningstar_rating),
    quantalys_rating: readNumber(raw.quantalys_rating),
    computed_momentum_pct: readNumber(raw.computed_momentum_pct),
    computed_volatility_pct: readNumber(raw.computed_volatility_pct),
    computed_drawdown_pct: readNumber(raw.computed_drawdown_pct),
    computed_beta: readNumber(raw.computed_beta),
    computed_alpha_pct: readNumber(raw.computed_alpha_pct),
    metrics_state: parseMetricsState(raw.metrics_state),
    score: readNumber(raw.score),
    score_details: scoreDetails,
    page: readNumber(raw.page),
    raw_text: readString(raw.raw_text),
    updated_at: readString(raw.updated_at) ?? '',
  }
}

function parseAvailability(raw: RawRow): SupportAvailabilityRow | null {
  const sourceId = readString(raw.source_id)
  const isin = readString(raw.isin)
  const envelope = readString(raw.envelope)
  if (!sourceId || !isin || !envelope) return null
  return {
    source_id: sourceId,
    isin,
    envelope,
    available: raw.available === true,
    constraints_json: raw.constraints_json && typeof raw.constraints_json === 'object' && !Array.isArray(raw.constraints_json)
      ? raw.constraints_json as Record<string, unknown>
      : {},
    updated_at: readString(raw.updated_at) ?? '',
  }
}

function formatPct(value: number | null, digits = 2): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value.toFixed(digits)}%`
}

function formatScore(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  return value.toFixed(0)
}

function compareNumber(left: number | null, right: number | null, direction: SortDirection): number {
  const leftMissing = left === null || Number.isNaN(left)
  const rightMissing = right === null || Number.isNaN(right)
  if (leftMissing && rightMissing) return 0
  if (leftMissing) return 1
  if (rightMissing) return -1
  return (left - right) * (direction === 'asc' ? 1 : -1)
}

function compareRows(left: InvestmentSupportRow, right: InvestmentSupportRow, sort: SortConfig): number {
  if (sort.key === 'name') return left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' }) * (sort.direction === 'asc' ? 1 : -1)
  if (sort.key === 'fee') return compareNumber(left.total_fee_pct, right.total_fee_pct, sort.direction)
  if (sort.key === 'sri') return compareNumber(left.sri, right.sri, sort.direction)
  if (sort.key === 'perf5y') return compareNumber(left.performance_5y_pct, right.performance_5y_pct, sort.direction)
  return compareNumber(left.score, right.score, sort.direction)
}

function typeClass(type: InvestmentSupportType): string {
  if (type === 'ETF') return 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-300'
  if (type === 'FUND') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
  if (type === 'FONDS_EURO') return 'border-slate-300 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
  if (type === 'PRIVATE_ASSET' || type === 'SCPI' || type === 'SCI' || type === 'OPCI') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'
  return 'border-slate-300 bg-white text-slate-500 dark:border-white/10 dark:bg-transparent dark:text-gray-500'
}

function metricsClass(state: SupportMetricsState): string {
  if (state === 'READY') return 'text-emerald-600 dark:text-emerald-300'
  if (state === 'PARTIAL') return 'text-amber-600 dark:text-amber-300'
  return 'text-slate-500 dark:text-gray-500'
}

function sortIcon(active: boolean, direction: SortDirection) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-50" />
  return direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

function SortHeader({ label, sortKey, sort, align = 'left', onSort }: {
  label: string
  sortKey: SortKey
  sort: SortConfig
  align?: 'left' | 'right' | 'center'
  onSort: (key: SortKey) => void
}) {
  const active = sort.key === sortKey
  return (
    <th className="p-0" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'flex w-full items-center gap-1.5 px-3 py-3 text-[10px] font-black uppercase tracking-widest transition hover:bg-slate-100 dark:hover:bg-white/5',
          align === 'right' && 'justify-end text-right',
          align === 'center' && 'justify-center text-center',
          active && 'text-blue-700 dark:text-[#00FF88]',
        )}
      >
        {label}
        {sortIcon(active, sort.direction)}
      </button>
    </th>
  )
}

export default function SupportsPage() {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | InvestmentSupportType>('ALL')
  const [envelopeFilter, setEnvelopeFilter] = useState('ALL')
  const [metricsFilter, setMetricsFilter] = useState<'ALL' | SupportMetricsState>('ALL')
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT)
  const [page, setPage] = useState(1)

  const { data: supports = [], error, isLoading } = useSWR('investment-supports', async () => {
    const { data, error } = await supabase
      .from('investment_supports')
      .select(SUPPORT_SELECTOR)
      .order('score', { ascending: false, nullsFirst: false })
      .limit(5000)
    if (error) throw error
    return ((data ?? []) as unknown as RawRow[])
      .map(parseSupportRow)
      .filter((row): row is InvestmentSupportRow => row !== null)
  })

  const { data: availability = [] } = useSWR('support-availability', async () => {
    const { data, error } = await supabase
      .from('support_availability')
      .select('source_id,isin,envelope,available,constraints_json,updated_at')
      .limit(5000)
    if (error) return []
    return ((data ?? []) as unknown as RawRow[])
      .map(parseAvailability)
      .filter((row): row is SupportAvailabilityRow => row !== null)
  })

  const envelopeBySupport = useMemo(() => {
    const map = new Map<string, string[]>()
    availability.forEach((row) => {
      if (!row.available) return
      const key = `${row.source_id}:${row.isin}`
      const existing = map.get(key) ?? []
      if (!existing.includes(row.envelope)) existing.push(row.envelope)
      map.set(key, existing)
    })
    return map
  }, [availability])

  const envelopes = useMemo(() => {
    return Array.from(new Set(availability.map((row) => row.envelope))).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [availability])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return supports
      .filter((row) => typeFilter === 'ALL' || row.support_type === typeFilter)
      .filter((row) => metricsFilter === 'ALL' || row.metrics_state === metricsFilter)
      .filter((row) => {
        if (envelopeFilter === 'ALL') return true
        return (envelopeBySupport.get(`${row.source_id}:${row.isin}`) ?? []).includes(envelopeFilter)
      })
      .filter((row) => {
        if (!needle) return true
        return [row.isin, row.name, row.manager, row.support_type].some((value) => value?.toLowerCase().includes(needle))
      })
      .sort((left, right) => compareRows(left, right, sort))
  }, [envelopeBySupport, envelopeFilter, metricsFilter, query, sort, supports, typeFilter])

  const stats = useMemo(() => {
    const etfCount = supports.filter((row) => row.support_type === 'ETF').length
    const scored = supports.filter((row) => row.score !== null)
    const metricsUnavailable = supports.filter((row) => row.metrics_state === 'METRICS_UNAVAILABLE').length
    const avgFee = supports
      .map((row) => row.total_fee_pct)
      .filter((value): value is number => value !== null)
    return {
      total: supports.length,
      etfCount,
      scored: scored.length,
      metricsUnavailable,
      avgTotalFee: avgFee.length > 0 ? avgFee.reduce((sum, value) => sum + value, 0) / avgFee.length : null,
    }
  }, [supports])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageIndex = Math.min(page, totalPages)
  const pageRows = filtered.slice((pageIndex - 1) * PAGE_SIZE, pageIndex * PAGE_SIZE)

  const handleSort = (key: SortKey) => {
    setSort((current) => {
      if (current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      const defaultDirection: Record<SortKey, SortDirection> = {
        score: 'desc',
        name: 'asc',
        fee: 'asc',
        sri: 'asc',
        perf5y: 'desc',
      }
      return { key, direction: defaultDirection[key] }
    })
  }

  return (
    <AppShell className="bg-slate-50">
      <main className="p-3 sm:p-6 lg:p-10">
        <div className="mx-auto max-w-7xl space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Library className="h-5 w-5 shrink-0 text-[#00FF88]" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-black uppercase tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                  Supports
                </h1>
                <p className="mt-1 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                  Assurance-vie and PER support universe, selection criteria and explicit metric coverage.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-gray-400">
              <LockKeyhole size={12} />
              Read only
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['Supports', stats.total.toString()],
              ['ETF / ETC', stats.etfCount.toString()],
              ['Scored', stats.scored.toString()],
              ['Avg total fee', formatPct(stats.avgTotalFee)],
              ['No metrics', stats.metricsUnavailable.toString()],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white/80 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">{label}</div>
                <div className="mt-1 text-sm font-mono font-black text-slate-950 dark:text-white">{value}</div>
              </div>
            ))}
          </div>

          <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-[#0D1117] md:flex-row md:flex-wrap md:items-center">
            <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-black/20">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(1)
                }}
                placeholder="Search ISIN, support, manager"
                className="min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
              />
            </label>
            <FilterSelect label="Type" value={typeFilter} options={SUPPORT_TYPES} onChange={(value) => { setTypeFilter(value as 'ALL' | InvestmentSupportType); setPage(1) }} />
            <FilterSelect label="Envelope" value={envelopeFilter} options={envelopes} onChange={(value) => { setEnvelopeFilter(value); setPage(1) }} />
            <FilterSelect label="Metrics" value={metricsFilter} options={['READY', 'PARTIAL', 'METRICS_UNAVAILABLE']} onChange={(value) => { setMetricsFilter(value as 'ALL' | SupportMetricsState); setPage(1) }} />
          </section>

          {error ? (
            <EmptyState
              tone="error"
              title="Support universe unavailable"
              message="Apply the Supabase supports/targets migration, then run import_support_universe.py with service-role credentials."
            />
          ) : isLoading ? (
            <EmptyState tone="loading" title="Loading supports" message="Reading investment_supports from Supabase." />
          ) : supports.length === 0 ? (
            <EmptyState title="No supports imported" message="Run the Lucya/Cardif support universe import in dry-run then apply mode." />
          ) : (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]/70">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-tight text-slate-950 dark:text-white">Support selector</h2>
                  <div className="mt-1 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                    {filtered.length} filtered - page {pageIndex}/{totalPages}
                  </div>
                </div>
                {stats.metricsUnavailable > 0 && (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    External ratings optional
                  </div>
                )}
              </div>

              <div className="divide-y divide-slate-200 dark:divide-white/10 md:hidden">
                {pageRows.map((row) => (
                  <SupportCard key={`${row.source_id}-${row.isin}`} row={row} envelopes={envelopeBySupport.get(`${row.source_id}:${row.isin}`) ?? []} />
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-[1180px] w-full">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-[#080A0F] dark:text-gray-500">
                    <tr>
                      <SortHeader label="Score" sortKey="score" sort={sort} align="right" onSort={handleSort} />
                      <SortHeader label="Name" sortKey="name" sort={sort} onSort={handleSort} />
                      <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest">Type</th>
                      <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest">ISIN</th>
                      <SortHeader label="SRI" sortKey="sri" sort={sort} align="right" onSort={handleSort} />
                      <SortHeader label="Fee" sortKey="fee" sort={sort} align="right" onSort={handleSort} />
                      <SortHeader label="Perf 5Y" sortKey="perf5y" sort={sort} align="right" onSort={handleSort} />
                      <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest">Envelope</th>
                      <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest">Metrics</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {pageRows.map((row) => (
                      <tr key={`${row.source_id}-${row.isin}`} data-support-row="true" className="transition-colors hover:bg-slate-50/70 dark:hover:bg-white/5">
                        <td className="p-3 text-right text-sm font-mono font-black text-slate-900 dark:text-white">{formatScore(row.score)}</td>
                        <td className="max-w-[360px] p-3">
                          <div className="truncate text-sm font-black text-slate-950 dark:text-white">{row.name}</div>
                          <div className="mt-0.5 truncate text-[10px] font-mono text-slate-500 dark:text-gray-500">{row.manager ?? 'manager unknown'}</div>
                        </td>
                        <td className="p-3"><TypeBadge type={row.support_type} /></td>
                        <td className="p-3 text-xs font-mono font-bold text-slate-600 dark:text-gray-300">{row.isin}</td>
                        <td className="p-3 text-right text-xs font-mono font-black text-slate-800 dark:text-gray-200">{row.sri ?? '--'}</td>
                        <td className="p-3 text-right text-xs font-mono font-black text-slate-800 dark:text-gray-200">{formatPct(row.total_fee_pct)}</td>
                        <td className="p-3 text-right text-xs font-mono font-black text-slate-800 dark:text-gray-200">{formatPct(row.performance_5y_pct)}</td>
                        <td className="max-w-[180px] p-3 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                          {(envelopeBySupport.get(`${row.source_id}:${row.isin}`) ?? ['--']).join(', ')}
                        </td>
                        <td className={cn('p-3 text-[10px] font-mono font-bold', metricsClass(row.metrics_state))}>{row.metrics_state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 dark:border-white/10">
                <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={pageIndex <= 1} className="rounded-md border border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-600 disabled:opacity-40 dark:border-white/10 dark:text-gray-300">
                  Previous
                </button>
                <span className="text-[10px] font-mono text-slate-500 dark:text-gray-400">{pageRows.length} rows rendered</span>
                <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={pageIndex >= totalPages} className="rounded-md border border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-600 disabled:opacity-40 dark:border-white/10 dark:text-gray-300">
                  Next
                </button>
              </div>
            </section>
          )}
        </div>
      </main>
    </AppShell>
  )
}

function FilterSelect({ label, value, options, onChange }: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex min-w-[150px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2 dark:border-white/10 dark:bg-black/20 md:flex-none">
      <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[10px] font-black uppercase text-slate-900 outline-none dark:text-white">
        <option value="ALL">All</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function TypeBadge({ type }: { type: InvestmentSupportType }) {
  return <span className={cn('rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', typeClass(type))}>{type}</span>
}

function SupportCard({ row, envelopes }: { row: InvestmentSupportRow; envelopes: string[] }) {
  return (
    <article className="bg-white p-4 dark:bg-transparent">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-slate-950 dark:text-white">{row.name}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-mono text-slate-500 dark:text-gray-400">
            <span>{row.isin}</span>
            <span>{row.manager ?? 'manager unknown'}</span>
          </div>
        </div>
        <TypeBadge type={row.support_type} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Score" value={formatScore(row.score)} />
        <Metric label="SRI" value={row.sri === null ? '--' : row.sri.toString()} />
        <Metric label="Fee" value={formatPct(row.total_fee_pct)} />
        <Metric label="Perf 5Y" value={formatPct(row.performance_5y_pct)} />
      </div>
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-mono text-slate-600 dark:border-white/10 dark:bg-black/20 dark:text-gray-300">
        <div className={metricsClass(row.metrics_state)}>{row.metrics_state}</div>
        <div className="mt-1">{envelopes.length > 0 ? envelopes.join(', ') : 'availability unknown'}</div>
      </div>
    </article>
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
