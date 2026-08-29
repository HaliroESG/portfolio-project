"use client"

import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  Gauge,
  Landmark,
  RefreshCw,
  Scale,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { EmptyState } from '../components/EmptyState'
import { FamilyOfficeStateBadge } from '../components/FamilyOfficeStateBadge'
import { command } from '../lib/commandApi'
import { useFamilyOfficeBundle } from '../lib/useFamilyOfficeBundle'
import type { FamilyOfficeOperationRow, FamilyOfficeOverviewRow } from '../types'

const eur = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

function formatEur(value: number | null | undefined): string {
  return value === null || value === undefined ? '--' : eur.format(value)
}

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

function formatRiskPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  return `${value.toFixed(1)}%`
}

function aggregateOverview(rows: FamilyOfficeOverviewRow[]) {
  const totals = rows.reduce(
    (result, row) => ({
      liquid: result.liquid + row.liquid_assets_eur,
      cash: result.cash + row.cash_eur,
      manual: result.manual + row.manual_assets_eur,
      liabilities: result.liabilities + row.liabilities_eur,
      exceptions: result.exceptions + row.open_exception_count,
    }),
    { liquid: 0, cash: 0, manual: 0, liabilities: 0, exceptions: 0 }
  )
  return {
    ...totals,
    nav: rows.length > 0 && rows.every((row) => row.net_asset_value_eur !== null)
      ? rows.reduce((sum, row) => sum + (row.net_asset_value_eur ?? 0), 0)
      : null,
  }
}

function severityClass(severity: FamilyOfficeOperationRow['severity']): string {
  if (severity === 'CRITICAL') return 'border-red-500 bg-red-500'
  if (severity === 'WARNING') return 'border-amber-500 bg-amber-500'
  return 'border-slate-400 bg-slate-400'
}

export default function FamilyOfficeOverviewPage() {
  const { data, error, isLoading, mutate } = useFamilyOfficeBundle()
  const [bootstrapping, setBootstrapping] = useState(false)
  const [commandError, setCommandError] = useState<string | null>(null)

  const totals = useMemo(() => aggregateOverview(data?.overview ?? []), [data?.overview])
  const primary = data?.overview[0] ?? null
  const operations = data?.operations.slice(0, 6) ?? []
  const lastSync = data?.overview
    .map((row) => row.updated_at)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null

  const bootstrap = async () => {
    setBootstrapping(true)
    setCommandError(null)
    try {
      await command('/v1/bootstrap', { body: { portfolio_name: 'Patrimoine familial' } })
      await mutate()
    } catch (caught) {
      setCommandError(caught instanceof Error ? caught.message : 'Initialisation impossible')
    } finally {
      setBootstrapping(false)
    }
  }

  if (isLoading) {
    return (
      <AppShell>
        <main className="p-5 lg:p-8">
          <div className="h-24 animate-pulse rounded-md bg-slate-200 dark:bg-white/5" />
        </main>
      </AppShell>
    )
  }

  if (error) {
    return (
      <AppShell>
        <main className="p-5 lg:p-8">
          <EmptyState tone="error" title="Registre patrimonial indisponible" message="La lecture Supabase a échoué. Vérifiez le Data API et la session propriétaire." />
        </main>
      </AppShell>
    )
  }

  if (data?.schemaState === 'SCHEMA_PENDING') {
    return (
      <AppShell>
        <main className="p-5 lg:p-8">
          <EmptyState tone="error" title="Migration Family Office requise" message="Le contrat fo_* n’est pas encore disponible dans Supabase." />
        </main>
      </AppShell>
    )
  }

  if (!data || data.portfolios.length === 0) {
    return (
      <AppShell>
        <main className="mx-auto max-w-4xl p-5 lg:p-8">
          <section className="border-l-4 border-emerald-500 bg-white px-6 py-8 dark:bg-[#0D1117]">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Landmark size={22} />
            </div>
            <h1 className="mt-6 text-2xl font-black text-slate-950 dark:text-white">Initialiser le registre patrimonial</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-gray-400">
              Le socle sécurisé est prêt mais ne contient encore aucun portefeuille. L’initialisation crée l’entité personnelle, le portefeuille EUR, les institutions Fortuneo/IBKR et la politique Core-Satellite 70/30.
            </p>
            {commandError && <p className="mt-4 text-sm font-medium text-red-600 dark:text-red-300">{commandError}</p>}
            <button
              type="button"
              onClick={bootstrap}
              disabled={bootstrapping}
              className="mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-emerald-400 dark:text-slate-950"
            >
              <RefreshCw size={15} className={bootstrapping ? 'animate-spin' : ''} />
              {bootstrapping ? 'Initialisation…' : 'Créer le registre'}
            </button>
          </section>
        </main>
      </AppShell>
    )
  }

  const coverage = primary?.coverage_pct ?? null

  return (
    <AppShell lastSyncIso={lastSync} coveragePct={coverage}>
      <main className="p-4 sm:p-5 lg:p-8">
        <div className="mx-auto max-w-[1500px] space-y-5">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">Pilotage consolidé</p>
              <h1 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">Vue Family Office</h1>
              <p className="mt-2 text-sm text-slate-500 dark:text-gray-400">{data.portfolios.length} portefeuille{data.portfolios.length > 1 ? 's' : ''} · consolidation EUR</p>
            </div>
            <div className="flex items-center gap-2">
              <FamilyOfficeStateBadge state={primary?.performance_state ?? 'MISSING'} />
              <Link href="/operations" className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
                <AlertTriangle size={14} />
                {totals.exceptions} exception{totals.exceptions !== 1 ? 's' : ''}
              </Link>
            </div>
          </header>

          <section className="grid overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117] sm:grid-cols-2 xl:grid-cols-5">
            <SummaryMetric icon={BriefcaseBusiness} label="Patrimoine net" value={formatEur(totals.nav)} emphasis />
            <SummaryMetric icon={WalletCards} label="Actifs cotés" value={formatEur(totals.liquid)} />
            <SummaryMetric icon={Banknote} label="Liquidités" value={formatEur(totals.cash)} />
            <SummaryMetric icon={Landmark} label="Actifs déclaratifs" value={formatEur(totals.manual)} />
            <SummaryMetric icon={Scale} label="Passifs" value={formatEur(totals.liabilities)} negative={totals.liabilities > 0} />
          </section>

          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10">
                <div>
                  <h2 className="text-sm font-black text-slate-950 dark:text-white">Performance investisseur</h2>
                  <p className="mt-1 text-[10px] font-mono text-slate-500">TWR neutralisé des flux · XIRR investisseur</p>
                </div>
                <CircleDollarSign size={18} className="text-emerald-500" />
              </div>
              <div className="grid grid-cols-3 border-b border-slate-200 dark:border-white/10">
                <RateMetric label="Mois" value={formatRate(primary?.twr_mtd)} />
                <RateMetric label="Année" value={formatRate(primary?.twr_ytd)} />
                <RateMetric label="XIRR" value={formatRate(primary?.xirr_since_inception)} />
              </div>
              <PerformanceTrack rows={data.performance.filter((row) => row.portfolio_id === primary?.portfolio_id)} />
            </section>

            <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10">
                <div>
                  <h2 className="text-sm font-black text-slate-950 dark:text-white">Risque consolidé</h2>
                  <p className="mt-1 text-[10px] font-mono text-slate-500">Mesures calculées sur la NAV vérifiée</p>
                </div>
                <ShieldCheck size={18} className="text-blue-500" />
              </div>
              <div className="divide-y divide-slate-200 dark:divide-white/10">
                <RiskLine label="Volatilité 30 jours" value={formatRiskPct(primary?.volatility_30d_pct)} />
                <RiskLine label="Drawdown YTD" value={formatRiskPct(primary?.max_drawdown_ytd_pct)} alert={(primary?.max_drawdown_ytd_pct ?? 0) < -10} />
                <RiskLine label="Plus grande ligne" value={formatRiskPct(primary?.largest_position_pct)} alert={(primary?.largest_position_pct ?? 0) > 15} />
                <RiskLine label="Couverture des données" value={coverage === null ? '--' : `${coverage.toFixed(1)}%`} alert={(coverage ?? 0) < 100} />
              </div>
            </section>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_1.25fr]">
            <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10">
                <h2 className="text-sm font-black text-slate-950 dark:text-white">À traiter</h2>
                <Link href="/operations" className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">Tout voir <ArrowUpRight size={12} /></Link>
              </div>
              {operations.length === 0 ? (
                <div className="flex items-center gap-3 px-4 py-7 text-sm text-slate-500 dark:text-gray-400">
                  <CheckCircle2 size={18} className="text-emerald-500" /> Aucune exception ouverte
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-white/10">
                  {operations.map((operation) => (
                    <div key={`${operation.exception_type}-${operation.id}`} className="flex items-start gap-3 px-4 py-3">
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full border ${severityClass(operation.severity)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-black text-slate-900 dark:text-white">{operation.title}</div>
                        <div className="mt-1 text-[10px] font-mono text-slate-500">{operation.exception_type} · {new Date(operation.detected_at).toLocaleDateString('fr-FR')}</div>
                      </div>
                      <span className="text-[9px] font-black uppercase text-slate-500">{operation.severity}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10">
                <h2 className="text-sm font-black text-slate-950 dark:text-white">Portefeuilles</h2>
                <Gauge size={17} className="text-slate-400" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[650px]">
                  <thead className="bg-slate-50 text-[9px] font-black uppercase text-slate-500 dark:bg-black/20">
                    <tr><th className="px-4 py-3 text-left">Portefeuille</th><th className="px-3 py-3 text-right">NAV</th><th className="px-3 py-3 text-right">Cash</th><th className="px-3 py-3 text-right">TWR YTD</th><th className="px-4 py-3 text-right">État</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                    {data.overview.map((row) => (
                      <tr key={row.portfolio_id} className="text-xs">
                        <td className="px-4 py-3"><div className="font-black text-slate-950 dark:text-white">{row.portfolio_name}</div><div className="mt-1 text-[9px] font-mono text-slate-500">{row.portfolio_type} · {row.base_currency}</div></td>
                        <td className="px-3 py-3 text-right font-mono font-black">{formatEur(row.net_asset_value_eur)}</td>
                        <td className="px-3 py-3 text-right font-mono">{formatEur(row.cash_eur)}</td>
                        <td className="px-3 py-3 text-right font-mono font-black">{formatRate(row.twr_ytd)}</td>
                        <td className="px-4 py-3 text-right"><FamilyOfficeStateBadge state={row.performance_state} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </main>
    </AppShell>
  )
}

function SummaryMetric({ icon: Icon, label, value, emphasis = false, negative = false }: { icon: typeof BriefcaseBusiness; label: string; value: string; emphasis?: boolean; negative?: boolean }) {
  return (
    <div className="border-b border-slate-200 p-4 last:border-b-0 dark:border-white/10 sm:border-r xl:border-b-0">
      <div className="flex items-center gap-2 text-[9px] font-black uppercase text-slate-500"><Icon size={14} /> {label}</div>
      <div className={`mt-3 font-mono font-black ${emphasis ? 'text-xl' : 'text-lg'} ${negative ? 'text-red-600 dark:text-red-300' : 'text-slate-950 dark:text-white'}`}>{value}</div>
    </div>
  )
}

function RateMetric({ label, value }: { label: string; value: string }) {
  const negative = value.startsWith('-')
  return <div className="border-r border-slate-200 px-4 py-4 last:border-r-0 dark:border-white/10"><div className="text-[9px] font-black uppercase text-slate-500">{label}</div><div className={`mt-2 font-mono text-lg font-black ${negative ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'}`}>{value}</div></div>
}

function RiskLine({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className="flex items-center justify-between px-4 py-3"><span className="text-xs font-medium text-slate-600 dark:text-gray-300">{label}</span><span className={`font-mono text-xs font-black ${alert ? 'text-amber-600 dark:text-amber-300' : 'text-slate-950 dark:text-white'}`}>{value}</span></div>
}

function PerformanceTrack({ rows }: { rows: Array<{ nav_eur: number | null; performance_date: string }> }) {
  const points = rows.filter((row) => row.nav_eur !== null).slice(-90)
  if (points.length < 2) return <div className="flex h-40 items-center justify-center text-xs text-slate-500">Historique insuffisant</div>
  const values = points.map((point) => point.nav_eur as number)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const spread = max - min || 1
  const path = values.map((value, index) => `${(index / (values.length - 1)) * 100},${100 - ((value - min) / spread) * 80 - 10}`).join(' ')
  return (
    <div className="h-40 px-4 py-4">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Évolution de la valeur nette">
        <polyline points={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-emerald-500" />
      </svg>
    </div>
  )
}
