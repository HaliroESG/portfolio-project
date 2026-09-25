"use client"

import React, { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileClock,
  ListFilter,
  Search,
  Table2,
  X,
} from 'lucide-react'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { Tooltip } from '../../components/Tooltip'
import {
  loadEquityPublicationHistory,
  loadEquityPublicationsBundle,
} from '../../lib/equityPublicationsData'
import {
  matchesPublicationSearch,
  publicationDate,
  publicationDateKey,
  publicationMonthGrid,
} from '../../lib/equityPublicationUi'
import { supabase } from '../../lib/supabase'
import { swrOptions, SWR_REFRESH } from '../../lib/swrConfig'
import { cn } from '../../lib/utils'
import type {
  EquityAnnualFinancialRow,
  EquityInterimFinancialRow,
  EquityPublicationDashboardRow,
  EquityPublicationDataState,
  EquityReportingEventRow,
  EquityReportingEventStatus,
} from '../../types'

type ViewMode = 'TABLE' | 'CALENDAR'
type IndexFilter = 'Tous' | 'CAC 40' | 'S&P 500'
type SortKey = 'company' | 'annualRevenue' | 'annualEbitda' | 'annualFcf' | 'pe' | 'nextEvent'
type SortDirection = 'asc' | 'desc'

const EMPTY_ROWS: EquityPublicationDashboardRow[] = []
const EMPTY_EVENTS: EquityReportingEventRow[] = []
const INDEX_FILTERS: IndexFilter[] = ['Tous', 'CAC 40', 'S&P 500']
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const TABLE_PAGE_SIZE = 100

const REASON_LABELS: Record<string, string> = {
  ANNUAL_UNAVAILABLE: 'Comptes annuels indisponibles',
  ANNUAL_STALE: 'Comptes annuels à rafraîchir',
  INTERIM_UNAVAILABLE: 'Données intermédiaires non publiées par la source',
  INTERIM_PARTIAL: 'Période intermédiaire incomplète',
  TTM_INCOMPLETE: 'Moins de quatre trimestres comparables',
  NEXT_PUBLICATION_UNAVAILABLE: 'Prochaine date indisponible',
  PUBLICATION_DATE_ESTIMATED: 'Date estimée, non confirmée par l’émetteur',
  REVENUE_UNAVAILABLE: 'Chiffre d’affaires indisponible',
  EBITDA_UNAVAILABLE: 'EBITDA indisponible',
  FCF_UNAVAILABLE: 'Free cash-flow indisponible',
  FCF_DERIVED: 'FCF calculé à partir du cash-flow opérationnel et du capex',
}

function formatDate(value: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return '--'
  const parsed = value.length === 10 ? publicationDate(value) : new Date(value)
  if (Number.isNaN(parsed.getTime())) return '--'
  return parsed.toLocaleDateString('fr-FR', options ?? { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  const formatter = new Intl.NumberFormat('fr-FR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  return `${formatter.format(value)}${currency ? ` ${currency}` : ''}`
}

function formatMultiple(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  return `${value.toFixed(1)}x`
}

function stateClass(state: EquityPublicationDataState): string {
  if (state === 'READY') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300'
  if (state === 'PARTIAL') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300'
  if (state === 'STALE') return 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/30 dark:text-orange-300'
  return 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300'
}

function eventStatusClass(status: EquityReportingEventStatus): string {
  if (status === 'CONFIRMED') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300'
  if (status === 'REPORTED') return 'border-slate-300 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
  if (status === 'CANCELLED') return 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300'
  return 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-300'
}

function statusLabel(status: EquityReportingEventStatus): string {
  if (status === 'CONFIRMED') return 'Confirmée'
  if (status === 'REPORTED') return 'Publiée'
  if (status === 'CANCELLED') return 'Annulée'
  return 'Estimée'
}

function StateBadge({ state, reasons = [] }: { state: EquityPublicationDataState; reasons?: string[] }) {
  const content = reasons.length
    ? reasons.map((reason) => REASON_LABELS[reason] ?? reason).join(' · ')
    : state
  return (
    <Tooltip content={content}>
      <span className={cn('inline-flex rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase', stateClass(state))}>
        {state}
      </span>
    </Tooltip>
  )
}

function EventStatusBadge({ status }: { status: EquityReportingEventStatus }) {
  return (
    <span className={cn('inline-flex rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase', eventStatusClass(status))}>
      {statusLabel(status)}
    </span>
  )
}

function MetricValue({
  value,
  currency,
  reasons,
}: {
  value: number | null
  currency?: string | null
  reasons?: string[]
}) {
  if (value !== null) return <>{formatMoney(value, currency)}</>
  const detail = (reasons ?? []).map((reason) => REASON_LABELS[reason] ?? reason).join(' · ') || 'Donnée non publiée'
  return (
    <Tooltip content={detail}>
      <span className="text-slate-400 dark:text-slate-600">--</span>
    </Tooltip>
  )
}

function compareNullable(left: number | string | null, right: number | string | null, direction: SortDirection): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  const result =
    typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right), 'fr', { sensitivity: 'base' })
  return direction === 'asc' ? result : -result
}

function sortRows(
  rows: EquityPublicationDashboardRow[],
  key: SortKey,
  direction: SortDirection
): EquityPublicationDashboardRow[] {
  return [...rows].sort((left, right) => {
    if (key === 'company') return compareNullable(left.name ?? left.ticker, right.name ?? right.ticker, direction)
    if (key === 'annualRevenue') return compareNullable(left.annual_revenue, right.annual_revenue, direction)
    if (key === 'annualEbitda') return compareNullable(left.annual_ebitda, right.annual_ebitda, direction)
    if (key === 'annualFcf') return compareNullable(left.annual_free_cash_flow, right.annual_free_cash_flow, direction)
    if (key === 'pe') return compareNullable(left.forward_pe ?? left.trailing_pe, right.forward_pe ?? right.trailing_pe, direction)
    return compareNullable(left.next_event_date, right.next_event_date, direction)
  })
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  direction: SortDirection
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === activeKey
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="inline-flex w-full items-center justify-end gap-1 px-2 py-2 text-right"
    >
      {label}
      {active ? direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
    </button>
  )
}

function SourceLink({ href }: { href: string | null }) {
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Ouvrir la source"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
    >
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  )
}

function HistoryTable({
  annual,
  interim,
}: {
  annual: EquityAnnualFinancialRow[]
  interim: EquityInterimFinancialRow[]
}) {
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 text-[10px] font-black uppercase text-slate-500">Historique annuel</div>
        {annual.length === 0 ? (
          <div className="border-y border-slate-200 py-4 text-xs text-slate-500 dark:border-white/10">Aucun exercice disponible.</div>
        ) : (
          <div className="overflow-x-auto border-y border-slate-200 dark:border-white/10">
            <table className="w-full min-w-[620px] text-xs">
              <thead className="bg-slate-100 text-[9px] uppercase text-slate-500 dark:bg-white/5">
                <tr>
                  <th className="px-2 py-2 text-left">Exercice</th>
                  <th className="px-2 py-2 text-right">CA</th>
                  <th className="px-2 py-2 text-right">EBITDA</th>
                  <th className="px-2 py-2 text-right">Résultat net</th>
                  <th className="px-2 py-2 text-right">FCF</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {annual.map((row) => (
                  <tr key={row.fiscal_year} className="border-t border-slate-200 dark:border-white/5">
                    <td className="px-2 py-2 font-bold">FY {row.fiscal_year}</td>
                    <td className="px-2 py-2 text-right font-mono">{formatMoney(row.revenue, row.currency)}</td>
                    <td className="px-2 py-2 text-right font-mono">{formatMoney(row.ebitda, row.currency)}</td>
                    <td className="px-2 py-2 text-right font-mono">{formatMoney(row.net_income, row.currency)}</td>
                    <td className="px-2 py-2 text-right font-mono">{formatMoney(row.free_cash_flow, row.currency)}</td>
                    <td className="px-1 py-1"><SourceLink href={row.source_url} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 text-[10px] font-black uppercase text-slate-500">Périodes intermédiaires</div>
        {interim.length === 0 ? (
          <div className="border-y border-amber-200 bg-amber-50/60 py-4 text-center text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
            La source gratuite ne fournit pas de période intermédiaire pour cette société.
          </div>
        ) : (
          <div className="overflow-x-auto border-y border-slate-200 dark:border-white/10">
            <table className="w-full min-w-[680px] text-xs">
              <thead className="bg-slate-100 text-[9px] uppercase text-slate-500 dark:bg-white/5">
                <tr>
                  <th className="px-2 py-2 text-left">Période</th>
                  <th className="px-2 py-2 text-right">CA</th>
                  <th className="px-2 py-2 text-right">EBITDA</th>
                  <th className="px-2 py-2 text-right">Résultat net</th>
                  <th className="px-2 py-2 text-right">FCF</th>
                  <th className="px-2 py-2 text-center">État</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {interim.map((row) => (
                  <tr key={`${row.fiscal_period_end}-${row.period_kind}`} className="border-t border-slate-200 dark:border-white/5">
                    <td className="px-2 py-2">
                      <div className="font-bold">{row.period_kind} {row.fiscal_year}</div>
                      <div className="text-[10px] text-slate-500">{formatDate(row.fiscal_period_end)}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{formatMoney(row.revenue, row.currency)}</td>
                    <td className="px-2 py-2 text-right font-mono">{formatMoney(row.ebitda, row.currency)}</td>
                    <td className="px-2 py-2 text-right font-mono">{formatMoney(row.net_income, row.currency)}</td>
                    <td className="px-2 py-2 text-right font-mono">{formatMoney(row.free_cash_flow, row.currency)}</td>
                    <td className="px-2 py-2 text-center"><StateBadge state={row.data_state} reasons={row.reason_codes} /></td>
                    <td className="px-1 py-1"><SourceLink href={row.source_url} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function PublicationDrawer({
  row,
  onClose,
}: {
  row: EquityPublicationDashboardRow | null
  onClose: () => void
}) {
  const { data, error, isLoading } = useSWR(
    row ? ['equity-publication-history', row.instrument_key] : null,
    () => {
      if (!row) throw new Error('Missing instrument')
      return loadEquityPublicationHistory(supabase, row.instrument_key)
    },
    swrOptions(SWR_REFRESH.SLOW)
  )

  return (
    <>
      <button
        type="button"
        aria-label="Fermer le détail"
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-[70] bg-black/55 transition-opacity',
          row ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />
      <aside
        aria-hidden={!row}
        className={cn(
          'fixed inset-y-0 right-0 z-[80] flex w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform dark:border-white/10 dark:bg-[#0B0E14]',
          row ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {row && (
          <>
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-white/10">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-black text-slate-950 dark:text-white">{row.name ?? row.ticker}</h2>
                  <StateBadge state={row.data_state} reasons={row.reason_codes} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] font-mono uppercase text-slate-500">
                  <span>{row.ticker}</span>
                  <span>{row.source_index}</span>
                  <span>{row.sector ?? 'Secteur inconnu'}</span>
                </div>
              </div>
              <button
                type="button"
                aria-label="Fermer"
                onClick={onClose}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 sm:grid-cols-4 dark:border-white/10 dark:bg-white/[0.02]">
              {[
                ['CA FY', formatMoney(row.annual_revenue, row.annual_currency)],
                ['EBITDA FY', formatMoney(row.annual_ebitda, row.annual_currency)],
                ['FCF FY', formatMoney(row.annual_free_cash_flow, row.annual_currency)],
                ['PER forward', formatMultiple(row.forward_pe)],
              ].map(([label, value]) => (
                <div key={label} className="border-r border-slate-200 px-4 py-3 last:border-r-0 dark:border-white/10">
                  <div className="text-[9px] font-black uppercase text-slate-500">{label}</div>
                  <div className="mt-1 font-mono text-sm font-black text-slate-950 dark:text-white">{value}</div>
                </div>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {isLoading && <EmptyState title="Chargement" message="Lecture de l’historique financier." tone="loading" />}
              {error && <EmptyState title="Historique indisponible" message={String(error)} tone="error" />}
              {data && (
                <div className="space-y-8">
                  <HistoryTable annual={data.annual} interim={data.interim} />
                  <section>
                    <div className="mb-2 text-[10px] font-black uppercase text-slate-500">Publications et dépôts</div>
                    {data.events.length === 0 ? (
                      <div className="border-y border-slate-200 py-4 text-xs text-slate-500 dark:border-white/10">Aucun événement disponible.</div>
                    ) : (
                      <div className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-white/10 dark:border-white/10">
                        {data.events.map((event) => (
                          <div key={event.event_key} className="flex items-center gap-3 py-3">
                            <div className="w-20 shrink-0 font-mono text-xs font-bold">{formatDate(event.event_date, { day: '2-digit', month: 'short', year: '2-digit' })}</div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-bold text-slate-900 dark:text-white">{event.event_label ?? 'Publication'}</div>
                              <div className="mt-1 text-[9px] uppercase text-slate-500">{event.source_provider} · {event.match_confidence}</div>
                            </div>
                            <EventStatusBadge status={event.status} />
                            <SourceLink href={event.source_url} />
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  )
}

function PublicationTable({
  rows,
  sortKey,
  sortDirection,
  onSort,
  onSelect,
}: {
  rows: EquityPublicationDashboardRow[]
  sortKey: SortKey
  sortDirection: SortDirection
  onSort: (key: SortKey) => void
  onSelect: (row: EquityPublicationDashboardRow) => void
}) {
  if (rows.length === 0) {
    return <EmptyState title="Aucune société" message="Aucune ligne ne correspond aux filtres actifs." />
  }
  return (
    <>
      <div className="hidden overflow-x-auto border-y border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]/70 lg:block">
        <table className="w-full min-w-[1780px] border-collapse text-[11px]">
          <thead className="sticky top-0 z-20 bg-slate-100 text-[9px] font-black uppercase text-slate-500 dark:bg-[#11161e]">
            <tr className="border-b border-slate-300 dark:border-white/10">
              <th rowSpan={2} className="sticky left-0 z-30 min-w-56 border-r border-slate-300 bg-slate-100 px-3 text-left dark:border-white/10 dark:bg-[#11161e]">
                <button type="button" onClick={() => onSort('company')} className="inline-flex items-center gap-1 py-2">
                  Société
                  {sortKey === 'company' ? sortDirection === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
                </button>
              </th>
              <th rowSpan={2} className="min-w-24 border-r border-slate-300 px-2 dark:border-white/10">Indice</th>
              <th colSpan={6} className="border-r border-slate-300 px-2 py-2 text-center text-emerald-700 dark:border-white/10 dark:text-emerald-300">Dernier exercice</th>
              <th colSpan={5} className="border-r border-slate-300 px-2 py-2 text-center text-blue-700 dark:border-white/10 dark:text-blue-300">Dernière période</th>
              <th colSpan={3} className="border-r border-slate-300 px-2 py-2 text-center text-amber-700 dark:border-white/10 dark:text-amber-300">Valorisation</th>
              <th colSpan={2} className="px-2 py-2 text-center">Prochaine publication</th>
            </tr>
            <tr className="border-b border-slate-300 dark:border-white/10">
              <th className="px-2 py-2 text-left">Période</th>
              <th className="px-2 py-2 text-left">Publiée</th>
              <th><SortHeader label="CA" sortKey="annualRevenue" activeKey={sortKey} direction={sortDirection} onSort={onSort} /></th>
              <th><SortHeader label="EBITDA" sortKey="annualEbitda" activeKey={sortKey} direction={sortDirection} onSort={onSort} /></th>
              <th className="px-2 py-2 text-right">EPS</th>
              <th className="border-r border-slate-300 dark:border-white/10"><SortHeader label="FCF" sortKey="annualFcf" activeKey={sortKey} direction={sortDirection} onSort={onSort} /></th>
              <th className="px-2 py-2 text-left">Période</th>
              <th className="px-2 py-2 text-left">Publiée</th>
              <th className="px-2 py-2 text-right">CA</th>
              <th className="px-2 py-2 text-right">EBITDA</th>
              <th className="border-r border-slate-300 px-2 py-2 text-right dark:border-white/10">FCF</th>
              <th className="px-2 py-2 text-right">PER hist.</th>
              <th><SortHeader label="PER fwd." sortKey="pe" activeKey={sortKey} direction={sortDirection} onSort={onSort} /></th>
              <th className="border-r border-slate-300 px-2 py-2 text-left dark:border-white/10">Au</th>
              <th><SortHeader label="Date" sortKey="nextEvent" activeKey={sortKey} direction={sortDirection} onSort={onSort} /></th>
              <th className="px-2 py-2 text-center">Statut</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.instrument_key}
                tabIndex={0}
                onClick={() => onSelect(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelect(row)
                }}
                className="cursor-pointer border-b border-slate-200 hover:bg-emerald-50/50 focus:bg-emerald-50/50 focus:outline-none dark:border-white/5 dark:hover:bg-emerald-950/10 dark:focus:bg-emerald-950/10"
              >
                <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-[#0D1117]">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-black text-slate-950 dark:text-white">{row.name ?? row.ticker}</div>
                      <div className="mt-0.5 font-mono text-[9px] text-slate-500">{row.ticker} · {row.company_currency ?? '--'}</div>
                    </div>
                    <StateBadge state={row.data_state} reasons={row.reason_codes} />
                  </div>
                </td>
                <td className="border-r border-slate-200 px-2 py-2 font-bold dark:border-white/10">{row.source_index}</td>
                <td className="px-2 py-2 font-bold">FY {row.annual_fiscal_year ?? '--'}</td>
                <td className="px-2 py-2 font-mono text-[10px]">{formatDate(row.annual_published_on, { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                <td className="px-2 py-2 text-right font-mono"><MetricValue value={row.annual_revenue} currency={row.annual_currency} reasons={row.reason_codes} /></td>
                <td className="px-2 py-2 text-right font-mono"><MetricValue value={row.annual_ebitda} currency={row.annual_currency} reasons={row.reason_codes} /></td>
                <td className="px-2 py-2 text-right font-mono">{row.annual_eps_diluted?.toFixed(2) ?? '--'}</td>
                <td className="border-r border-slate-200 px-2 py-2 text-right font-mono dark:border-white/10"><MetricValue value={row.annual_free_cash_flow} currency={row.annual_currency} reasons={row.reason_codes} /></td>
                <td className="px-2 py-2">
                  <div className="font-bold">{row.interim_period_kind ?? '--'} {row.interim_fiscal_year ?? ''}</div>
                  <div className="font-mono text-[9px] text-slate-500">{formatDate(row.interim_period_end, { day: '2-digit', month: 'short', year: '2-digit' })}</div>
                </td>
                <td className="px-2 py-2 font-mono text-[10px]">{formatDate(row.interim_published_on, { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                <td className="px-2 py-2 text-right font-mono"><MetricValue value={row.interim_revenue} currency={row.interim_currency} reasons={row.interim_reason_codes} /></td>
                <td className="px-2 py-2 text-right font-mono"><MetricValue value={row.interim_ebitda} currency={row.interim_currency} reasons={row.interim_reason_codes} /></td>
                <td className="border-r border-slate-200 px-2 py-2 text-right font-mono dark:border-white/10"><MetricValue value={row.interim_free_cash_flow} currency={row.interim_currency} reasons={row.interim_reason_codes} /></td>
                <td className="px-2 py-2 text-right font-mono">{formatMultiple(row.trailing_pe)}</td>
                <td className="px-2 py-2 text-right font-mono">{formatMultiple(row.forward_pe)}</td>
                <td className="border-r border-slate-200 px-2 py-2 font-mono text-[10px] dark:border-white/10">{formatDate(row.valuation_as_of, { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                <td className="px-2 py-2 text-right font-mono font-bold">{formatDate(row.next_event_date, { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                <td className="px-2 py-2 text-center">{row.next_event_status ? <EventStatusBadge status={row.next_event_status} /> : '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 lg:hidden">
        {rows.map((row) => (
          <button
            type="button"
            key={row.instrument_key}
            onClick={() => onSelect(row)}
            className="rounded-lg border border-slate-200 bg-white p-4 text-left dark:border-white/10 dark:bg-[#0D1117]/70"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-slate-950 dark:text-white">{row.name ?? row.ticker}</div>
                <div className="mt-1 text-[9px] font-mono uppercase text-slate-500">{row.ticker} · {row.source_index}</div>
              </div>
              <StateBadge state={row.data_state} reasons={row.reason_codes} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 border-y border-slate-200 py-3 dark:border-white/10">
              <div><div className="text-[8px] font-black uppercase text-slate-500">CA FY</div><div className="mt-1 font-mono text-xs font-bold">{formatMoney(row.annual_revenue, row.annual_currency)}</div></div>
              <div><div className="text-[8px] font-black uppercase text-slate-500">EBITDA</div><div className="mt-1 font-mono text-xs font-bold">{formatMoney(row.annual_ebitda, row.annual_currency)}</div></div>
              <div><div className="text-[8px] font-black uppercase text-slate-500">FCF</div><div className="mt-1 font-mono text-xs font-bold">{formatMoney(row.annual_free_cash_flow, row.annual_currency)}</div></div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-[8px] font-black uppercase text-slate-500">Dernière période</div>
                <div className="mt-1 text-xs font-bold">{row.interim_period_kind ?? 'Non disponible'} {row.interim_fiscal_year ?? ''}</div>
              </div>
              <div className="text-right">
                <div className="text-[8px] font-black uppercase text-slate-500">Prochaine publication</div>
                <div className="mt-1 font-mono text-xs font-bold">{formatDate(row.next_event_date)}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  )
}

function CalendarView({
  events,
  month,
  onMonth,
  onSelect,
}: {
  events: EquityReportingEventRow[]
  month: Date
  onMonth: (value: Date) => void
  onSelect: (event: EquityReportingEventRow) => void
}) {
  const eventsByDate = useMemo(() => {
    const result = new Map<string, EquityReportingEventRow[]>()
    events.forEach((event) => {
      const existing = result.get(event.event_date) ?? []
      existing.push(event)
      result.set(event.event_date, existing)
    })
    return result
  }, [events])
  const days = publicationMonthGrid(month)
  const monthEvents = events.filter((event) => {
    const parsed = publicationDate(event.event_date)
    return parsed.getFullYear() === month.getFullYear() && parsed.getMonth() === month.getMonth()
  })

  return (
    <div>
      <div className="flex items-center justify-between border-y border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-[#0D1117]/70">
        <div className="flex items-center gap-2">
          <Tooltip content="Mois précédent">
            <button
              type="button"
              aria-label="Mois précédent"
              onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content="Mois suivant">
            <button
              type="button"
              aria-label="Mois suivant"
              onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={() => onMonth(new Date())}
            className="h-8 rounded-md border border-slate-200 px-3 text-[10px] font-black uppercase hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/5"
          >
            Aujourd’hui
          </button>
        </div>
        <h2 className="text-sm font-black capitalize text-slate-950 dark:text-white">
          {month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
        </h2>
        <div className="hidden text-[10px] font-mono text-slate-500 sm:block">{monthEvents.length} événements</div>
      </div>

      <div className="hidden grid-cols-7 border-b border-l border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]/70 md:grid">
        {WEEKDAYS.map((day) => (
          <div key={day} className="border-r border-slate-200 px-2 py-2 text-center text-[9px] font-black uppercase text-slate-500 dark:border-white/10">{day}</div>
        ))}
        {days.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="h-32 border-r border-t border-slate-200 bg-slate-50/60 dark:border-white/10 dark:bg-black/10" />
          const key = publicationDateKey(day)
          const dayEvents = eventsByDate.get(key) ?? []
          const isToday = key === publicationDateKey(new Date())
          return (
            <div key={key} className="h-32 overflow-hidden border-r border-t border-slate-200 p-1.5 dark:border-white/10">
              <div className={cn('mb-1 flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold', isToday && 'bg-emerald-400 text-slate-950')}>
                {day.getDate()}
              </div>
              <div className="space-y-1">
                {dayEvents.slice(0, 3).map((event) => (
                  <button
                    type="button"
                    key={event.event_key}
                    onClick={() => onSelect(event)}
                    title={`${event.ticker} · ${event.event_label ?? 'Publication'}`}
                    className={cn(
                      'block h-6 w-full truncate rounded-md border px-1.5 text-left text-[9px] font-bold',
                      eventStatusClass(event.status)
                    )}
                  >
                    {event.ticker} · {event.event_type === 'REGULATORY_FILING' ? 'Dépôt' : event.period_kind ?? 'Résultats'}
                  </button>
                ))}
                {dayEvents.length > 3 && <div className="px-1 text-[9px] font-bold text-slate-500">+{dayEvents.length - 3}</div>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="divide-y divide-slate-200 border-b border-slate-200 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-[#0D1117]/70 md:hidden">
        {monthEvents.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">Aucune publication ce mois-ci.</div>
        ) : (
          monthEvents.map((event) => (
            <button
              type="button"
              key={event.event_key}
              onClick={() => onSelect(event)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03]"
            >
              <div className="w-12 shrink-0 text-center">
                <div className="text-[9px] font-black uppercase text-slate-500">{publicationDate(event.event_date).toLocaleDateString('fr-FR', { month: 'short' })}</div>
                <div className="font-mono text-lg font-black">{publicationDate(event.event_date).getDate()}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-black">{event.name ?? event.ticker}</div>
                <div className="mt-1 truncate text-[10px] text-slate-500">{event.event_label ?? 'Publication de résultats'}</div>
              </div>
              <EventStatusBadge status={event.status} />
            </button>
          ))
        )}
      </div>
    </div>
  )
}

export default function PublicationsPage() {
  const [view, setView] = useState<ViewMode>('TABLE')
  const [indexFilter, setIndexFilter] = useState<IndexFilter>('Tous')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('nextEvent')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [page, setPage] = useState(1)
  const [month, setMonth] = useState(() => new Date())
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null)
  const { data, error, isLoading } = useSWR(
    'equity-publications',
    () => loadEquityPublicationsBundle(supabase),
    swrOptions(SWR_REFRESH.MEDIUM)
  )
  const rows = data?.rows ?? EMPTY_ROWS
  const events = data?.events ?? EMPTY_EVENTS

  const filteredRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (indexFilter !== 'Tous' && row.source_index !== indexFilter) return false
      return matchesPublicationSearch([row.ticker, row.name, row.sector], search)
    })
    return sortRows(filtered, sortKey, sortDirection)
  }, [rows, indexFilter, search, sortKey, sortDirection])

  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        if (indexFilter !== 'Tous' && event.source_index !== indexFilter) return false
        return matchesPublicationSearch([event.ticker, event.name, event.event_label], search)
      }),
    [events, indexFilter, search]
  )

  const selectedRow = rows.find((row) => row.instrument_key === selectedInstrument) ?? null
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / TABLE_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = filteredRows.slice((safePage - 1) * TABLE_PAGE_SIZE, safePage * TABLE_PAGE_SIZE)
  const coverage = data?.coverage[indexFilter] ?? {
    total: 0,
    ready: 0,
    partial: 0,
    stale: 0,
    missing: 0,
    calendar: 0,
    interim: 0,
  }
  function handleSort(key: SortKey) {
    setPage(1)
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection(key === 'company' || key === 'nextEvent' ? 'asc' : 'desc')
    }
  }

  return (
    <AppShell lastSyncIso={data?.lastUpdateIso}>
      <main className="min-w-0 pb-12">
        <section className="border-b border-slate-200 bg-white px-4 py-5 dark:border-white/10 dark:bg-[#0B0E14]/70 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[9px] font-black uppercase text-emerald-600 dark:text-emerald-400">
                <FileClock className="h-3.5 w-3.5" />
                Recherche actions
              </div>
              <h1 className="mt-2 text-2xl font-black text-slate-950 dark:text-white">Publications</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
                Comptes publiés, valorisation datée et prochaines échéances du CAC 40 et du S&amp;P 500.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-9 rounded-md border border-slate-200 bg-slate-100 p-0.5 dark:border-white/10 dark:bg-black/20">
                <button
                  type="button"
                  onClick={() => setView('TABLE')}
                  className={cn('inline-flex items-center gap-2 rounded-md px-3 text-xs font-bold', view === 'TABLE' ? 'bg-white text-slate-950 shadow-sm dark:bg-white/10 dark:text-white' : 'text-slate-500')}
                >
                  <Table2 className="h-3.5 w-3.5" />
                  Tableau
                </button>
                <button
                  type="button"
                  onClick={() => setView('CALENDAR')}
                  className={cn('inline-flex items-center gap-2 rounded-md px-3 text-xs font-bold', view === 'CALENDAR' ? 'bg-white text-slate-950 shadow-sm dark:bg-white/10 dark:text-white' : 'text-slate-500')}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Calendrier
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50 px-4 py-4 dark:border-white/10 dark:bg-[#090c11] sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1 lg:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
                placeholder="Rechercher une action"
                aria-label="Rechercher une action"
                className="input pl-10"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <ListFilter className="mr-1 h-4 w-4 text-slate-400" />
              {INDEX_FILTERS.map((index) => (
                <button
                  type="button"
                  key={index}
                  onClick={() => {
                    setIndexFilter(index)
                    setPage(1)
                  }}
                  className={cn(
                    'h-9 rounded-md border px-3 text-[10px] font-black uppercase',
                    indexFilter === index
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'border-slate-200 bg-white text-slate-500 hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.03] dark:hover:text-white'
                  )}
                >
                  {index}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2 text-[10px] font-mono text-slate-500">
              <Clock3 className="h-3.5 w-3.5" />
              {data?.lastBackendRun?.status ?? 'SYNC PENDING'}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 border-b border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]/60 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Univers', coverage.total],
            ['Prêtes', coverage.ready],
            ['Partielles', coverage.partial],
            ['Intermédiaires', coverage.interim],
            ['Calendrier', coverage.calendar],
            ['Événements filtrés', filteredEvents.length],
          ].map(([label, value]) => (
            <div key={label} className="border-r border-slate-200 px-4 py-3 last:border-r-0 dark:border-white/10">
              <div className="text-[8px] font-black uppercase text-slate-500">{label}</div>
              <div className="mt-1 font-mono text-lg font-black text-slate-950 dark:text-white">{value}</div>
            </div>
          ))}
        </section>

        <div className="px-4 py-5 sm:px-6 lg:px-8">
          {isLoading && <EmptyState title="Chargement des publications" message="Lecture des fondamentaux et du calendrier." tone="loading" />}
          {error && <EmptyState title="Lecture impossible" message={String(error)} tone="error" />}
          {data?.status === 'SCHEMA_PENDING' && (
            <EmptyState title="Schéma en attente" message={data.message ?? 'Migration Supabase requise.'} tone="warning" />
          )}
          {data?.status === 'READY' && data.rows.length === 0 && (
            <EmptyState title="Univers vide" message="Le backfill CAC 40 / S&P 500 n’a pas encore été exécuté." tone="warning" />
          )}
          {data?.status === 'READY' && data.rows.length > 0 && view === 'TABLE' && (
            <>
              <PublicationTable
                rows={pageRows}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={handleSort}
                onSelect={(row) => setSelectedInstrument(row.instrument_key)}
              />
              {pageCount > 1 && (
                <div className="mt-3 flex items-center justify-between border-y border-slate-200 bg-white px-3 py-2 text-[10px] font-mono text-slate-500 dark:border-white/10 dark:bg-[#0D1117]/70">
                  <span>{filteredRows.length} sociétés · page {safePage}/{pageCount}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Page précédente"
                      disabled={safePage === 1}
                      onClick={() => setPage(Math.max(1, safePage - 1))}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 disabled:opacity-30 dark:border-white/10"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Page suivante"
                      disabled={safePage === pageCount}
                      onClick={() => setPage(Math.min(pageCount, safePage + 1))}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 disabled:opacity-30 dark:border-white/10"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {data?.status === 'READY' && data.rows.length > 0 && view === 'CALENDAR' && (
            <CalendarView
              events={filteredEvents}
              month={month}
              onMonth={setMonth}
              onSelect={(event) => setSelectedInstrument(event.instrument_key)}
            />
          )}
        </div>

        {coverage.partial + coverage.missing + coverage.stale > 0 && (
          <section className="mx-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300 sm:mx-6 lg:mx-8">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <span className="font-black">Couverture explicite.</span>{' '}
              Les sociétés européennes peuvent publier un semestre complet mais seulement le chiffre d’affaires aux autres trimestres. Les champs absents restent vides.
            </div>
          </section>
        )}
      </main>
      <PublicationDrawer row={selectedRow} onClose={() => setSelectedInstrument(null)} />
    </AppShell>
  )
}
