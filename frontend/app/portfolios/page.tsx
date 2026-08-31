"use client"

import { Banknote, Building2, RefreshCw, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { FamilyOfficeStateBadge } from '../../components/FamilyOfficeStateBadge'
import { command } from '../../lib/commandApi'
import { useFamilyOfficeBundle } from '../../lib/useFamilyOfficeBundle'

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 })

export default function PortfoliosPage() {
  const { data, error, isLoading, mutate, ownerUserId } = useFamilyOfficeBundle()
  const [portfolioOverride, setPortfolioOverride] = useState('')
  const [accountOverride, setAccountOverride] = useState('ALL')
  const [recalculating, setRecalculating] = useState(false)
  const [commandError, setCommandError] = useState<string | null>(null)
  useEffect(() => {
    setPortfolioOverride('')
    setAccountOverride('ALL')
    setRecalculating(false)
    setCommandError(null)
  }, [ownerUserId])
  const portfolioId = portfolioOverride || data?.portfolios[0]?.id || ''
  const accounts = data?.accounts.filter((row) => row.portfolio_id === portfolioId) ?? []
  const positions = data?.positions.filter((row) => row.portfolio_id === portfolioId && (accountOverride === 'ALL' || row.account_id === accountOverride)) ?? []
  const cash = data?.cash.filter((row) => row.portfolio_id === portfolioId && (accountOverride === 'ALL' || row.account_id === accountOverride)) ?? []
  const manual = data?.manualHoldings.filter((row) => row.portfolio_id === portfolioId) ?? []
  const overview = data?.overview.find((row) => row.portfolio_id === portfolioId) ?? null
  const institutions = useMemo(() => new Map((data?.institutions ?? []).map((row) => [row.id, row.name])), [data?.institutions])
  const accountNames = useMemo(() => new Map((data?.accounts ?? []).map((row) => [row.id, row.name])), [data?.accounts])

  const recalculate = async () => {
    if (!portfolioId) return
    setRecalculating(true)
    setCommandError(null)
    try {
      await command('/v1/recalculate', { body: { portfolio_id: portfolioId } })
      await mutate()
    } catch (caught) {
      setCommandError(caught instanceof Error ? caught.message : 'Calcul impossible')
    } finally {
      setRecalculating(false)
    }
  }

  if (isLoading) return <AppShell><main className="p-5 text-sm text-slate-500">Chargement du registre…</main></AppShell>
  if (error || !data) return <AppShell><main className="p-5"><EmptyState tone="error" title="Portefeuilles indisponibles" message="La lecture du registre a échoué." /></main></AppShell>
  if (data.portfolios.length === 0) return <AppShell><main className="p-5"><EmptyState title="Aucun portefeuille" message="Initialisez le registre depuis la vue d’ensemble." /></main></AppShell>

  return (
    <AppShell lastSyncIso={overview?.updated_at ?? null} coveragePct={overview?.coverage_pct ?? null}>
      <main className="p-4 sm:p-5 lg:p-8">
        <div className="mx-auto max-w-[1500px] space-y-5">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">Registre patrimonial</p>
              <h1 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">Portefeuilles et comptes</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={portfolioId} onChange={(event) => { setPortfolioOverride(event.target.value); setAccountOverride('ALL') }} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold dark:border-white/10 dark:bg-[#0D1117]">
                {data.portfolios.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <select value={accountOverride} onChange={(event) => setAccountOverride(event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold dark:border-white/10 dark:bg-[#0D1117]">
                <option value="ALL">Tous les comptes</option>
                {accounts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <button type="button" onClick={recalculate} disabled={recalculating} className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-black text-white disabled:opacity-50 dark:bg-emerald-400 dark:text-slate-950">
                <RefreshCw size={14} className={recalculating ? 'animate-spin' : ''} /> Recalculer
              </button>
            </div>
          </header>
          {commandError && <div className="border-l-2 border-red-500 bg-red-50 px-4 py-3 text-xs font-medium text-red-700 dark:bg-red-950/20 dark:text-red-300">{commandError}</div>}

          <section className="grid overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117] sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={WalletCards} label="Valeur nette" value={overview?.net_asset_value_eur === null || overview?.net_asset_value_eur === undefined ? '--' : eur.format(overview.net_asset_value_eur)} />
            <Metric icon={Building2} label="Comptes" value={String(accounts.length)} />
            <Metric icon={Banknote} label="Cash" value={eur.format(overview?.cash_eur ?? 0)} />
            <div className="border-t border-slate-200 p-4 dark:border-white/10 sm:border-l sm:border-t-0"><div className="text-[9px] font-black uppercase text-slate-500">Qualité</div><div className="mt-3"><FamilyOfficeStateBadge state={overview?.performance_state ?? 'MISSING'} /></div></div>
          </section>

          <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-white/10"><h2 className="text-sm font-black text-slate-950 dark:text-white">Comptes de conservation</h2></div>
            <div className="grid divide-y divide-slate-200 dark:divide-white/10 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-3">
              {accounts.map((account) => {
                const accountPositions = data.positions.filter((position) => position.account_id === account.id)
                const accountCash = data.cash.filter((item) => item.account_id === account.id)
                const complete = [...accountPositions, ...accountCash].length > 0 && accountPositions.every((item) => item.market_value_eur !== null) && accountCash.every((item) => item.balance_eur !== null)
                const value = accountPositions.reduce((sum, item) => sum + (item.market_value_eur ?? 0), 0) + accountCash.reduce((sum, item) => sum + (item.balance_eur ?? 0), 0)
                return <button type="button" key={account.id} onClick={() => setAccountOverride(account.id)} className="p-4 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.03]"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-black text-slate-950 dark:text-white">{account.name}</div><div className="mt-1 text-[10px] font-mono text-slate-500">{institutions.get(account.institution_id)} · {account.envelope} · {account.base_currency}</div></div><span className="rounded border border-slate-300 px-2 py-1 text-[9px] font-black uppercase dark:border-white/10">{account.status}</span></div><div className="mt-5 font-mono text-lg font-black">{complete ? eur.format(value) : '--'}</div><div className="mt-2 text-[10px] text-slate-500">{accountPositions.length} positions · {accountCash.length} soldes cash</div></button>
              })}
              {accounts.length === 0 && <div className="p-5 text-sm text-slate-500">Aucun compte. Ajoutez Fortuneo ou IBKR depuis Administration.</div>}
            </div>
          </section>

          <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10"><h2 className="text-sm font-black text-slate-950 dark:text-white">Positions cotées</h2><span className="text-[10px] font-mono text-slate-500">{positions.length} lignes</span></div>
            {positions.length === 0 ? <div className="p-5 text-sm text-slate-500">Aucune position calculée pour ce périmètre.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[950px]"><thead className="bg-slate-50 text-[9px] font-black uppercase text-slate-500 dark:bg-black/20"><tr><th className="px-4 py-3 text-left">Instrument</th><th className="px-3 py-3 text-left">Compte</th><th className="px-3 py-3 text-right">Quantité</th><th className="px-3 py-3 text-right">PRU</th><th className="px-3 py-3 text-right">Valeur</th><th className="px-3 py-3 text-right">P&L latent</th><th className="px-3 py-3 text-left">Prix / FX</th><th className="px-4 py-3 text-right">État</th></tr></thead><tbody className="divide-y divide-slate-200 dark:divide-white/10">{positions.map((row) => <tr key={row.id} className="text-xs"><td className="px-4 py-3"><div className="font-black text-slate-950 dark:text-white">{row.name}</div><div className="mt-1 text-[9px] font-mono text-slate-500">{row.ticker ?? row.isin ?? row.instrument_key} · {row.currency}</div></td><td className="px-3 py-3 text-slate-600 dark:text-gray-300">{accountNames.get(row.account_id)}</td><td className="px-3 py-3 text-right font-mono">{number.format(row.quantity)}</td><td className="px-3 py-3 text-right font-mono">{row.average_cost === null ? '--' : number.format(row.average_cost)}</td><td className="px-3 py-3 text-right font-mono font-black">{row.market_value_eur === null ? '--' : eur.format(row.market_value_eur)}</td><td className={`px-3 py-3 text-right font-mono font-black ${(row.unrealized_pnl_eur ?? 0) < 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'}`}>{row.unrealized_pnl_eur === null ? '--' : eur.format(row.unrealized_pnl_eur)}</td><td className="px-3 py-3 text-[9px] font-mono text-slate-500">{row.price_as_of ?? 'prix manquant'}<br />{row.fx_as_of ?? 'FX manquant'}</td><td className="px-4 py-3 text-right"><FamilyOfficeStateBadge state={row.data_state} /></td></tr>)}</tbody></table></div>}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <SimpleTable title="Liquidités" empty="Aucun solde cash calculé.">{cash.map((row) => <div key={row.id} className="flex items-center justify-between px-4 py-3"><div><div className="text-xs font-black">{accountNames.get(row.account_id)}</div><div className="mt-1 text-[9px] font-mono text-slate-500">{row.currency} · {row.balance_date}</div></div><div className="text-right"><div className="font-mono text-sm font-black">{row.balance_eur === null ? '--' : eur.format(row.balance_eur)}</div><div className="mt-1"><FamilyOfficeStateBadge state={row.data_state} /></div></div></div>)}</SimpleTable>
            <SimpleTable title="Actifs et passifs déclaratifs" empty="Aucun actif déclaratif.">{manual.map((row) => <div key={row.holding_id} className="flex items-center justify-between px-4 py-3"><div><div className="text-xs font-black">{row.name}</div><div className="mt-1 text-[9px] font-mono text-slate-500">{row.asset_type} · {row.confidence ?? 'NON VALORISÉ'}</div></div><div className={`font-mono text-sm font-black ${row.holding_kind === 'LIABILITY' ? 'text-red-600 dark:text-red-300' : ''}`}>{row.value_eur === null ? '--' : `${row.holding_kind === 'LIABILITY' ? '-' : ''}${eur.format(row.value_eur)}`}</div></div>)}</SimpleTable>
          </div>
        </div>
      </main>
    </AppShell>
  )
}

function Metric({ icon: Icon, label, value }: { icon: typeof WalletCards; label: string; value: string }) { return <div className="border-b border-slate-200 p-4 dark:border-white/10 sm:border-r sm:border-b-0"><div className="flex items-center gap-2 text-[9px] font-black uppercase text-slate-500"><Icon size={14} />{label}</div><div className="mt-3 font-mono text-lg font-black text-slate-950 dark:text-white">{value}</div></div> }
function SimpleTable({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children); return <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]"><div className="border-b border-slate-200 px-4 py-3 dark:border-white/10"><h2 className="text-sm font-black">{title}</h2></div><div className="divide-y divide-slate-200 dark:divide-white/10">{hasChildren ? children : <div className="p-5 text-sm text-slate-500">{empty}</div>}</div></section> }
