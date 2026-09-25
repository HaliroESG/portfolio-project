"use client"

import { AlertTriangle, Check, FileDown, FileSpreadsheet, LockKeyhole, RefreshCw, Upload } from 'lucide-react'
import { FormEvent, useMemo, useState } from 'react'
import useSWR from 'swr'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { authenticatedDownload, command } from '../../lib/commandApi'
import { FAMILY_OFFICE_REFRESH_MS, FAMILY_OFFICE_SWR_KEY, loadFamilyOfficeBundle } from '../../lib/familyOfficeData'
import { supabase } from '../../lib/supabase'
import type { FamilyOfficeOperationRow } from '../../types'

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

function severityStyle(severity: FamilyOfficeOperationRow['severity']): string {
  if (severity === 'CRITICAL') return 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300'
  if (severity === 'WARNING') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300'
  return 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
}

export default function OperationsPage() {
  const { data, error, isLoading, mutate } = useSWR(FAMILY_OFFICE_SWR_KEY, () => loadFamilyOfficeBundle(supabase), { refreshInterval: FAMILY_OFFICE_REFRESH_MS })
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const primaryPortfolio = data?.portfolios[0] ?? null
  const institutionNames = useMemo(() => new Map((data?.institutions ?? []).map((row) => [row.id, row.name])), [data?.institutions])

  const importFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    const form = new FormData(target)
    const accountId = String(form.get('account_id') ?? '')
    const account = data?.accounts.find((row) => row.id === accountId)
    const institution = account ? institutionNames.get(account.institution_id)?.toUpperCase() ?? '' : ''
    const broker = institution.includes('INTERACTIVE') ? 'IBKR' : 'FORTUNEO'
    form.set('broker', broker)
    setPendingAction('import')
    setFeedback(null)
    setActionError(null)
    try {
      const result = await command<{ inserted_count: number; rejected_count: number }>('/v1/imports/broker', { formData: form })
      setFeedback(`${result.inserted_count} écritures importées, ${result.rejected_count} rejetée(s).`)
      await mutate()
      target.reset()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Import impossible')
    } finally {
      setPendingAction(null)
    }
  }

  const resolve = async (operation: FamilyOfficeOperationRow) => {
    setPendingAction(operation.id)
    setActionError(null)
    try {
      await command(`/v1/exceptions/${operation.id}`, { method: 'PATCH', body: { status: 'RESOLVED' } })
      await mutate()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Résolution impossible')
    } finally {
      setPendingAction(null)
    }
  }

  const closeMonth = async (finalize: boolean) => {
    if (!primaryPortfolio) return
    const now = new Date()
    const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10)
    setPendingAction(finalize ? 'close' : 'prepare')
    setFeedback(null)
    setActionError(null)
    try {
      const result = await command<{ monthly_close: { status: string } }>('/v1/monthly-closes', {
        body: { portfolio_id: primaryPortfolio.id, period_end: periodEnd, finalize },
      })
      setFeedback(`Clôture ${periodEnd} : ${result.monthly_close.status}.`)
      await mutate()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Clôture impossible')
    } finally {
      setPendingAction(null)
    }
  }

  const exportClose = async (closeId: string, periodEnd: string, format: 'csv' | 'pdf') => {
    setPendingAction(`export-${closeId}-${format}`)
    setActionError(null)
    try {
      const blob = await authenticatedDownload(`/v1/monthly-closes/${closeId}/export?format=${format}`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `cloture-${periodEnd}.${format}`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Export impossible')
    } finally {
      setPendingAction(null)
    }
  }

  if (isLoading) return <AppShell><main className="p-5 text-sm text-slate-500">Chargement des opérations…</main></AppShell>
  if (error || !data) return <AppShell><main className="p-5"><EmptyState tone="error" title="Opérations indisponibles" message="La lecture du registre a échoué." /></main></AppShell>

  const openOperations = data.operations.filter((row) => row.status === 'OPEN' || row.status === 'ACKNOWLEDGED')
  const criticalCount = openOperations.filter((row) => row.severity === 'CRITICAL').length

  return (
    <AppShell>
      <main className="p-4 sm:p-5 lg:p-8">
        <div className="mx-auto max-w-[1450px] space-y-5">
          <header>
            <p className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">Contrôle quotidien et mensuel</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">Opérations</h1>
            <p className="mt-2 text-sm text-slate-500">Imports, rapprochements, exceptions et clôtures.</p>
          </header>
          {feedback && <div className="border-l-2 border-emerald-500 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">{feedback}</div>}
          {actionError && <div className="border-l-2 border-red-500 bg-red-50 px-4 py-3 text-xs font-medium text-red-700 dark:bg-red-950/20 dark:text-red-300">{actionError}</div>}

          <section className="grid overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117] sm:grid-cols-3">
            <ControlMetric label="Exceptions ouvertes" value={String(openOperations.length)} icon={AlertTriangle} alert={openOperations.length > 0} />
            <ControlMetric label="Critiques" value={String(criticalCount)} icon={AlertTriangle} alert={criticalCount > 0} />
            <ControlMetric label="Dernière clôture" value={data.closes[0]?.period_end ?? 'Aucune'} icon={LockKeyhole} />
          </section>

          <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
            <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-white/10"><h2 className="text-sm font-black">Importer un relevé broker</h2><p className="mt-1 text-[10px] text-slate-500">CSV Fortuneo ou IBKR · ledger idempotent</p></div>
              <form onSubmit={importFile} className="space-y-4 p-4">
                <label className="block"><span className="text-[9px] font-black uppercase text-slate-500">Compte</span><select name="account_id" required className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-xs dark:border-white/10 dark:bg-black/20"><option value="">Sélectionner</option>{data.accounts.map((row) => <option key={row.id} value={row.id}>{institutionNames.get(row.institution_id)} · {row.name}</option>)}</select></label>
                <label className="block"><span className="text-[9px] font-black uppercase text-slate-500">Fichier transactions</span><input name="source_file" type="file" accept=".csv,text/csv" required className="mt-2 block w-full rounded-md border border-dashed border-slate-300 p-3 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-xs file:font-black file:text-white dark:border-white/10 dark:file:bg-emerald-400 dark:file:text-slate-950" /></label>
                <label className="block"><span className="text-[9px] font-black uppercase text-slate-500">Snapshot positions pour rapprochement</span><input name="positions_file" type="file" accept=".csv,text/csv" className="mt-2 block w-full rounded-md border border-dashed border-slate-300 p-3 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-2 file:text-xs file:font-black dark:border-white/10 dark:file:bg-white/10" /></label>
                <button type="submit" disabled={pendingAction === 'import' || data.accounts.length === 0} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-xs font-black text-white disabled:opacity-50 dark:bg-emerald-400 dark:text-slate-950"><Upload size={14} />{pendingAction === 'import' ? 'Import en cours…' : 'Importer et contrôler'}</button>
                {data.accounts.length === 0 && <p className="text-[10px] text-amber-600 dark:text-amber-300">Créez d’abord un compte Fortuneo ou IBKR dans Administration.</p>}
              </form>
              <div className="border-t border-slate-200 p-4 dark:border-white/10">
                <div className="text-[9px] font-black uppercase text-slate-500">Règles</div>
                <ul className="mt-2 space-y-2 text-[10px] leading-5 text-slate-500"><li>Hash du fichier et clés broker anti-doublon.</li><li>Instrument ambigu envoyé dans la file d’exceptions.</li><li>Recalcul explicite après validation du rapprochement.</li></ul>
              </div>
            </section>

            <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10"><div><h2 className="text-sm font-black">File d’exceptions</h2><p className="mt-1 text-[10px] text-slate-500">Aucune incertitude n’est masquée</p></div><RefreshCw size={16} className="text-slate-400" /></div>
              {openOperations.length === 0 ? <div className="flex items-center gap-3 p-6 text-sm text-slate-500"><Check size={18} className="text-emerald-500" /> Aucun contrôle en attente</div> : <div className="divide-y divide-slate-200 dark:divide-white/10">{openOperations.map((row) => <article key={`${row.exception_type}-${row.id}`} className="grid gap-3 p-4 md:grid-cols-[auto_1fr_auto] md:items-center"><span className={`rounded border px-2 py-1 text-[9px] font-black uppercase ${severityStyle(row.severity)}`}>{row.severity}</span><div className="min-w-0"><h3 className="truncate text-xs font-black text-slate-950 dark:text-white">{row.title}</h3><p className="mt-1 text-[9px] font-mono text-slate-500">{row.exception_type} · {new Date(row.detected_at).toLocaleString('fr-FR')}</p></div>{row.exception_type !== 'VALUATION_DUE' && <button type="button" onClick={() => resolve(row)} disabled={pendingAction === row.id} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 px-3 text-[10px] font-black hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"><Check size={12} /> Résoudre</button>}</article>)}</div>}
            </section>
          </div>

          <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/10"><div><h2 className="text-sm font-black">Clôture mensuelle</h2><p className="mt-1 text-[10px] text-slate-500">Couverture 100 %, performance READY et aucune exception critique</p></div><div className="flex gap-2"><button type="button" onClick={() => closeMonth(false)} disabled={!primaryPortfolio || pendingAction !== null} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-xs font-black disabled:opacity-50 dark:border-white/10"><FileSpreadsheet size={14} /> Préparer</button><button type="button" onClick={() => closeMonth(true)} disabled={!primaryPortfolio || pendingAction !== null} className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-xs font-black text-white disabled:opacity-50 dark:bg-emerald-400 dark:text-slate-950"><LockKeyhole size={14} /> Clôturer</button></div></div>
            {data.closes.length === 0 ? <div className="p-5 text-sm text-slate-500">Aucune clôture préparée.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[820px]"><thead className="bg-slate-50 text-[9px] font-black uppercase text-slate-500 dark:bg-black/20"><tr><th className="px-4 py-3 text-left">Période</th><th className="px-3 py-3 text-left">Statut</th><th className="px-3 py-3 text-right">NAV</th><th className="px-3 py-3 text-right">Couverture</th><th className="px-3 py-3 text-right">Exceptions</th><th className="px-4 py-3 text-right">Dossier</th></tr></thead><tbody className="divide-y divide-slate-200 dark:divide-white/10">{data.closes.map((row) => <tr key={row.id} className="text-xs"><td className="px-4 py-3 font-mono font-black">{row.period_end}</td><td className="px-3 py-3"><span className="rounded border border-slate-300 px-2 py-1 text-[9px] font-black uppercase dark:border-white/10">{row.status}</span></td><td className="px-3 py-3 text-right font-mono">{row.nav_eur === null ? '--' : eur.format(row.nav_eur)}</td><td className="px-3 py-3 text-right font-mono">{row.coverage_pct === null ? '--' : `${row.coverage_pct.toFixed(1)}%`}</td><td className="px-3 py-3 text-right font-mono">{row.open_exception_count}</td><td className="px-4 py-3"><div className="flex justify-end gap-1"><button type="button" title="Exporter le dossier CSV" aria-label={`Exporter la clôture ${row.period_end} en CSV`} onClick={() => exportClose(row.id, row.period_end, 'csv')} disabled={pendingAction !== null} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 disabled:opacity-50 dark:border-white/10"><FileSpreadsheet size={13} /></button><button type="button" title="Exporter le dossier PDF" aria-label={`Exporter la clôture ${row.period_end} en PDF`} onClick={() => exportClose(row.id, row.period_end, 'pdf')} disabled={pendingAction !== null} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 disabled:opacity-50 dark:border-white/10"><FileDown size={13} /></button></div></td></tr>)}</tbody></table></div>}
          </section>
        </div>
      </main>
    </AppShell>
  )
}

function ControlMetric({ label, value, icon: Icon, alert = false }: { label: string; value: string; icon: typeof AlertTriangle; alert?: boolean }) { return <div className="border-b border-slate-200 p-4 last:border-b-0 dark:border-white/10 sm:border-r sm:border-b-0"><div className="flex items-center gap-2 text-[9px] font-black uppercase text-slate-500"><Icon size={14} />{label}</div><div className={`mt-3 font-mono text-lg font-black ${alert ? 'text-amber-600 dark:text-amber-300' : 'text-slate-950 dark:text-white'}`}>{value}</div></div> }
