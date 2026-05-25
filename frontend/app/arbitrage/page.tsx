"use client"

import React, { useMemo, useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUpDown, LockKeyhole, Scale } from 'lucide-react'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import type { PortfolioDecisionAction, PortfolioDecisionItemRow } from '../../types'

type SortKey = 'priority' | 'ticker' | 'action' | 'amount' | 'drift' | 'confidence'
type SortDirection = 'asc' | 'desc'
type SortConfig = { key: SortKey; direction: SortDirection }

interface PortfolioRow {
  id: string
  name: string | null
}

type RawDecisionRow = Record<string, unknown>

const DECISION_SELECTOR = [
  'portfolio_id',
  'ticker',
  'name',
  'asset_class',
  'isin',
  'currency',
  'current_quantity',
  'current_value_eur',
  'current_weight_pct',
  'target_weight_pct',
  'drift_pct',
  'rebalance_amount_eur',
  'action',
  'confidence',
  'reason_codes',
  'data_state',
  'price_state',
  'market_data_status',
  'reconciliation_state',
  'trident_provider_symbol',
  'trident_score',
  'trident_confidence',
  'history_coverage_pct',
  'target_total_pct',
  'total_value_eur',
  'updated_at',
].join(',')

const ACTION_RANK: Record<PortfolioDecisionAction, number> = {
  EXIT: 0,
  REDUCE: 1,
  BUY: 2,
  UNAVAILABLE: 3,
  HOLD: 4,
}

const DEFAULT_SORT: SortConfig = { key: 'priority', direction: 'asc' }

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function parseAction(value: unknown): PortfolioDecisionAction {
  if (value === 'BUY' || value === 'REDUCE' || value === 'EXIT' || value === 'HOLD' || value === 'UNAVAILABLE') return value
  return 'UNAVAILABLE'
}

function parseDecisionRow(raw: RawDecisionRow): PortfolioDecisionItemRow | null {
  const portfolioId = readString(raw.portfolio_id)
  const ticker = readString(raw.ticker)
  if (!portfolioId || !ticker) return null

  return {
    portfolio_id: portfolioId,
    ticker,
    name: readString(raw.name) ?? ticker,
    asset_class: readString(raw.asset_class),
    isin: readString(raw.isin),
    currency: readString(raw.currency) ?? 'EUR',
    current_quantity: readNumber(raw.current_quantity),
    current_value_eur: readNumber(raw.current_value_eur),
    current_weight_pct: readNumber(raw.current_weight_pct),
    target_weight_pct: readNumber(raw.target_weight_pct),
    drift_pct: readNumber(raw.drift_pct),
    rebalance_amount_eur: readNumber(raw.rebalance_amount_eur),
    action: parseAction(raw.action),
    confidence: readNumber(raw.confidence) ?? 0,
    reason_codes: parseStringArray(raw.reason_codes),
    data_state: raw.data_state === 'READY' || raw.data_state === 'TARGET_MISSING' || raw.data_state === 'TARGET_INVALID' || raw.data_state === 'QUANTITY_MISSING' || raw.data_state === 'PRICE_MISSING' || raw.data_state === 'FX_MISSING'
      ? raw.data_state
      : 'PRICE_MISSING',
    price_state: raw.price_state === 'LIVE' || raw.price_state === 'STALE' || raw.price_state === 'MISSING' ? raw.price_state : 'MISSING',
    market_data_status: readString(raw.market_data_status),
    reconciliation_state: raw.reconciliation_state === 'MATCH' || raw.reconciliation_state === 'MISMATCH_QTY' || raw.reconciliation_state === 'MISMATCH_COST' || raw.reconciliation_state === 'MISSING_IN_LEDGER' || raw.reconciliation_state === 'LEDGER_ONLY' || raw.reconciliation_state === 'NOT_CHECKED'
      ? raw.reconciliation_state
      : null,
    trident_provider_symbol: readString(raw.trident_provider_symbol),
    trident_score: readNumber(raw.trident_score),
    trident_confidence: readNumber(raw.trident_confidence),
    history_coverage_pct: readNumber(raw.history_coverage_pct),
    target_total_pct: readNumber(raw.target_total_pct),
    total_value_eur: readNumber(raw.total_value_eur),
    updated_at: readString(raw.updated_at),
  }
}

function formatPortfolioName(portfolio: PortfolioRow): string {
  return portfolio.name?.trim() || `Portfolio ${portfolio.id.slice(0, 6)}`
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

function formatPct(value: number | null, digits = 2): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value.toFixed(digits)}%`
}

function formatSignedPts(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} pts`
}

function actionClass(action: PortfolioDecisionAction): string {
  if (action === 'BUY') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
  if (action === 'REDUCE' || action === 'EXIT') return 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300'
  if (action === 'UNAVAILABLE') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'
  return 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
}

function compareText(left: string | null | undefined, right: string | null | undefined, direction: SortDirection): number {
  const multiplier = direction === 'asc' ? 1 : -1
  return (left ?? '').localeCompare(right ?? '', 'en', { sensitivity: 'base' }) * multiplier
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

function compareRows(left: PortfolioDecisionItemRow, right: PortfolioDecisionItemRow, sort: SortConfig): number {
  if (sort.key === 'priority') {
    return (ACTION_RANK[left.action] - ACTION_RANK[right.action])
      || compareNumber(Math.abs(right.rebalance_amount_eur ?? 0), Math.abs(left.rebalance_amount_eur ?? 0), 'asc')
      || compareText(left.ticker, right.ticker, 'asc')
  }
  if (sort.key === 'ticker') return compareText(left.ticker, right.ticker, sort.direction)
  if (sort.key === 'action') return (ACTION_RANK[left.action] - ACTION_RANK[right.action]) * (sort.direction === 'asc' ? 1 : -1)
  if (sort.key === 'amount') return compareNumber(Math.abs(left.rebalance_amount_eur ?? 0), Math.abs(right.rebalance_amount_eur ?? 0), sort.direction)
  if (sort.key === 'drift') return compareNumber(Math.abs(left.drift_pct ?? 0), Math.abs(right.drift_pct ?? 0), sort.direction)
  return compareNumber(left.confidence, right.confidence, sort.direction)
}

function sortIcon(active: boolean, direction: SortDirection) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-50" />
  return direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

function SortHeader({
  label,
  sortKey,
  sort,
  align = 'left',
  onSort,
}: {
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

export default function ArbitragePage() {
  const [selectedPortfolioIdOverride, setSelectedPortfolioIdOverride] = useState('')
  const [actionFilter, setActionFilter] = useState<'ALL' | PortfolioDecisionAction>('ALL')
  const [issueFilter, setIssueFilter] = useState('ALL')
  const [assetClassFilter, setAssetClassFilter] = useState('ALL')
  const [currencyFilter, setCurrencyFilter] = useState('ALL')
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT)

  const { data: portfolios } = useSWR('arbitrage-portfolios', async () => {
    const { data, error } = await supabase.from('portfolios').select('id,name')
    if (error) throw error
    return (data ?? []) as PortfolioRow[]
  })
  const selectedPortfolioId = selectedPortfolioIdOverride || portfolios?.[0]?.id || ''

  const { data: rows = [], error, isLoading } = useSWR(
    selectedPortfolioId ? ['portfolio-decision-items', selectedPortfolioId] : null,
    async () => {
      const { data, error } = await supabase
        .from('portfolio_decision_items_latest')
        .select(DECISION_SELECTOR)
        .eq('portfolio_id', selectedPortfolioId)
      if (error) throw error
      return ((data ?? []) as unknown as RawDecisionRow[])
        .map(parseDecisionRow)
        .filter((row): row is PortfolioDecisionItemRow => row !== null)
    }
  )

  const filters = useMemo(() => {
    const issueCodes = new Set<string>()
    const assetClasses = new Set<string>()
    const currencies = new Set<string>()
    rows.forEach((row) => {
      row.reason_codes.forEach((code) => issueCodes.add(code))
      if (row.asset_class) assetClasses.add(row.asset_class)
      currencies.add(row.currency)
    })
    return {
      issueCodes: Array.from(issueCodes).sort(),
      assetClasses: Array.from(assetClasses).sort((a, b) => a.localeCompare(b, 'en')),
      currencies: Array.from(currencies).sort(),
    }
  }, [rows])

  const filteredRows = useMemo(() => {
    return rows
      .filter((row) => actionFilter === 'ALL' || row.action === actionFilter)
      .filter((row) => issueFilter === 'ALL' || row.reason_codes.includes(issueFilter))
      .filter((row) => assetClassFilter === 'ALL' || row.asset_class === assetClassFilter)
      .filter((row) => currencyFilter === 'ALL' || row.currency === currencyFilter)
      .sort((left, right) => compareRows(left, right, sort))
  }, [actionFilter, assetClassFilter, currencyFilter, issueFilter, rows, sort])

  const stats = useMemo(() => {
    const actionable = rows.filter((row) => row.action === 'BUY' || row.action === 'REDUCE' || row.action === 'EXIT')
    const unavailable = rows.filter((row) => row.action === 'UNAVAILABLE')
    const totalValue = rows[0]?.total_value_eur ?? rows.reduce((sum, row) => sum + (row.current_value_eur ?? 0), 0)
    const grossTrade = actionable.reduce((sum, row) => sum + Math.abs(row.rebalance_amount_eur ?? row.current_value_eur ?? 0), 0)
    const avgConfidence = rows.length > 0 ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length : null
    return { actionable: actionable.length, unavailable: unavailable.length, totalValue, grossTrade, avgConfidence }
  }, [rows])

  const lastSyncIso = useMemo(() => {
    return rows
      .map((row) => row.updated_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
  }, [rows])
  const lastSync = lastSyncIso ? new Date(lastSyncIso).toLocaleTimeString('fr-FR') : ''

  const handleSort = (key: SortKey) => {
    setSort((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      }
      const defaultDirection: Record<SortKey, SortDirection> = {
        priority: 'asc',
        ticker: 'asc',
        action: 'asc',
        amount: 'desc',
        drift: 'desc',
        confidence: 'desc',
      }
      return { key, direction: defaultDirection[key] }
    })
  }

  return (
    <AppShell lastSync={lastSync} lastSyncIso={lastSyncIso} className="bg-slate-50">
      <main className="p-3 sm:p-6 lg:p-10">
        <div className="mx-auto max-w-7xl space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Scale className="h-5 w-5 shrink-0 text-[#00FF88]" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-black uppercase tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                  Arbitrage
                </h1>
                <p className="mt-1 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                  Recommendations from target/current drift, data quality and broker reconciliation state.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <div className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-200/70 px-3 py-2 dark:bg-white/10">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400">Portfolio</span>
                <select
                  value={selectedPortfolioId}
                  onChange={(event) => setSelectedPortfolioIdOverride(event.target.value)}
                  className="max-w-[190px] bg-transparent text-[10px] font-black text-slate-900 outline-none dark:text-white"
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
                Informative
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ['Portfolio value', formatEur(stats.totalValue || null)],
              ['Actions', stats.actionable.toString()],
              ['Unavailable', stats.unavailable.toString()],
              ['Gross trade', formatEur(stats.grossTrade || null)],
              ['Confidence', stats.avgConfidence === null ? '--' : `${stats.avgConfidence.toFixed(0)}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white/80 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">{label}</div>
                <div className="mt-1 text-sm font-mono font-black text-slate-950 dark:text-white">{value}</div>
              </div>
            ))}
          </div>

          <section className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-[#0D1117]">
            <FilterSelect label="Action" value={actionFilter} options={['BUY', 'REDUCE', 'EXIT', 'HOLD', 'UNAVAILABLE']} onChange={(value) => setActionFilter(value as 'ALL' | PortfolioDecisionAction)} />
            <FilterSelect label="Data issue" value={issueFilter} options={filters.issueCodes} onChange={setIssueFilter} />
            <FilterSelect label="Asset class" value={assetClassFilter} options={filters.assetClasses} onChange={setAssetClassFilter} />
            <FilterSelect label="Currency" value={currencyFilter} options={filters.currencies} onChange={setCurrencyFilter} />
          </section>

          {error ? (
            <EmptyState
              tone="error"
              title="Arbitrage read model unavailable"
              message="Apply the Supabase portfolio_decision_items_latest migration, including broker reconciliation tables and read grants."
            />
          ) : isLoading ? (
            <EmptyState tone="loading" title="Loading arbitrage decisions" message="Reading portfolio_decision_items_latest from Supabase." />
          ) : rows.length === 0 ? (
            <EmptyState title="No decision items" message="No target/current rows are available for this portfolio." />
          ) : (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]/70">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-tight text-slate-950 dark:text-white">Decision queue</h2>
                  <div className="mt-1 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                    {filteredRows.length} of {rows.length} items
                  </div>
                </div>
                {rows.some((row) => row.data_state !== 'READY') && (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Data issues visible
                  </div>
                )}
              </div>

              <div className="divide-y divide-slate-200 dark:divide-white/10 md:hidden">
                {filteredRows.map((row) => (
                  <DecisionCard key={`${row.portfolio_id}-${row.ticker}`} row={row} />
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-[1180px] w-full">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-[#080A0F] dark:text-gray-500">
                    <tr>
                      <SortHeader label="Priority" sortKey="priority" sort={sort} onSort={handleSort} />
                      <SortHeader label="Ticker" sortKey="ticker" sort={sort} onSort={handleSort} />
                      <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest">Name</th>
                      <SortHeader label="Action" sortKey="action" sort={sort} align="center" onSort={handleSort} />
                      <SortHeader label="Amount" sortKey="amount" sort={sort} align="right" onSort={handleSort} />
                      <SortHeader label="Drift" sortKey="drift" sort={sort} align="right" onSort={handleSort} />
                      <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-widest">Current / Target</th>
                      <SortHeader label="Confidence" sortKey="confidence" sort={sort} align="right" onSort={handleSort} />
                      <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest">Justification</th>
                      <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-widest">Data quality</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {filteredRows.map((row) => (
                      <tr key={`${row.portfolio_id}-${row.ticker}`} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-white/5">
                        <td className="p-3">
                          <span className={cn('rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', actionClass(row.action))}>
                            {row.action}
                          </span>
                        </td>
                        <td className="p-3 text-sm font-mono font-black text-slate-700 dark:text-gray-200">{row.ticker}</td>
                        <td className="max-w-[220px] p-3 text-sm font-black text-slate-950 dark:text-white">
                          <div className="truncate">{row.name}</div>
                          <div className="mt-0.5 text-[10px] font-mono font-normal text-slate-500">{row.asset_class ?? '--'} / {row.currency}</div>
                        </td>
                        <td className="p-3 text-center">
                          <span className={cn('rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', actionClass(row.action))}>
                            {row.action}
                          </span>
                        </td>
                        <td className="p-3 text-right text-sm font-mono font-black text-slate-800 dark:text-white">{formatSignedEur(row.rebalance_amount_eur)}</td>
                        <td className="p-3 text-right text-sm font-mono font-black text-slate-800 dark:text-white">{formatSignedPts(row.drift_pct)}</td>
                        <td className="p-3 text-right text-xs font-mono text-slate-600 dark:text-gray-300">
                          {formatPct(row.current_weight_pct)} / {formatPct(row.target_weight_pct)}
                        </td>
                        <td className="p-3 text-right text-sm font-mono font-black text-slate-800 dark:text-white">{row.confidence}%</td>
                        <td className="max-w-[280px] p-3 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                          <ReasonCodes codes={row.reason_codes} />
                        </td>
                        <td className="p-3 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                          <div>{row.data_state}</div>
                          <div>{row.price_state}{row.reconciliation_state ? ` / ${row.reconciliation_state}` : ''}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
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
    <label className="flex min-w-[150px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2 dark:border-white/10 dark:bg-black/20 sm:flex-none">
      <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[10px] font-black uppercase text-slate-900 outline-none dark:text-white"
      >
        <option value="ALL">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function ReasonCodes({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return <span className="text-slate-400">no blocking reason</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {codes.slice(0, 4).map((code) => (
        <span key={code} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-white/10">
          {code}
        </span>
      ))}
      {codes.length > 4 && <span>+{codes.length - 4}</span>}
    </div>
  )
}

function DecisionCard({ row }: { row: PortfolioDecisionItemRow }) {
  return (
    <article className="bg-white p-4 dark:bg-transparent">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-slate-950 dark:text-white">{row.name}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-mono text-slate-500 dark:text-gray-400">
            <span>{row.ticker}</span>
            <span>{row.asset_class ?? '--'}</span>
            <span>{row.currency}</span>
          </div>
        </div>
        <span className={cn('shrink-0 rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', actionClass(row.action))}>
          {row.action}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Amount" value={formatSignedEur(row.rebalance_amount_eur)} />
        <Metric label="Drift" value={formatSignedPts(row.drift_pct)} />
        <Metric label="Current" value={formatPct(row.current_weight_pct)} />
        <Metric label="Target" value={formatPct(row.target_weight_pct)} />
      </div>
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-mono text-slate-600 dark:border-white/10 dark:bg-black/20 dark:text-gray-300">
        <div className="font-black uppercase">Confidence {row.confidence}%</div>
        <div className="mt-1">{row.data_state} / {row.price_state}</div>
        <div className="mt-2"><ReasonCodes codes={row.reason_codes} /></div>
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
