"use client"

import { CheckCircle2, FileDown, Plus, Send, XCircle } from 'lucide-react'
import { FormEvent, useState } from 'react'
import useSWR from 'swr'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { authenticatedDownload, command } from '../../lib/commandApi'
import { FAMILY_OFFICE_REFRESH_MS, FAMILY_OFFICE_SWR_KEY, loadFamilyOfficeBundle } from '../../lib/familyOfficeData'
import { supabase } from '../../lib/supabase'
import type { FamilyOfficeDecisionRow, FamilyOfficeDecisionStatus } from '../../types'

const transitions: Partial<Record<FamilyOfficeDecisionStatus, Array<{ status: FamilyOfficeDecisionStatus; label: string }>>> = {
  DRAFT: [{ status: 'VALIDATED', label: 'Valider' }, { status: 'CANCELLED', label: 'Annuler' }],
  VALIDATED: [{ status: 'CANCELLED', label: 'Annuler' }],
  EXPORTED: [{ status: 'EXECUTED', label: 'Marquer exécutée' }, { status: 'CANCELLED', label: 'Annuler' }],
  EXECUTED: [{ status: 'RECONCILED', label: 'Rapprocher' }],
}

function statusClass(status: FamilyOfficeDecisionStatus): string {
  if (status === 'RECONCILED') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'
  if (status === 'CANCELLED') return 'border-slate-300 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/5'
  if (status === 'DRAFT') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300'
  return 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-300'
}

export default function DecisionsPage() {
  const { data, error, isLoading, mutate } = useSWR(FAMILY_OFFICE_SWR_KEY, () => loadFamilyOfficeBundle(supabase), { refreshInterval: FAMILY_OFFICE_REFRESH_MS })
  const [pending, setPending] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [orderDecisionId, setOrderDecisionId] = useState('')

  const createDecision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    const form = new FormData(target)
    setPending('create')
    setFeedback(null)
    setActionError(null)
    try {
      await command('/v1/decisions', { body: { portfolio_id: String(form.get('portfolio_id')), title: String(form.get('title')), rationale: String(form.get('rationale')), macro_context: {}, risk_context: {}, source_snapshot: {} } })
      target.reset()
      setFeedback('Décision ajoutée au journal.')
      await mutate()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Création impossible')
    } finally {
      setPending(null)
    }
  }

  const transition = async (decision: FamilyOfficeDecisionRow, target: FamilyOfficeDecisionStatus) => {
    setPending(decision.id)
    setActionError(null)
    try {
      await command(`/v1/decisions/${decision.id}`, { method: 'PATCH', body: { status: target } })
      await mutate()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Transition impossible')
    } finally {
      setPending(null)
    }
  }

  const createOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const decisionId = String(form.get('decision_id'))
    setPending('order')
    setActionError(null)
    try {
      const result = await command<{ order: { id: string } }>('/v1/orders', {
        body: {
          decision_id: decisionId,
          account_id: String(form.get('account_id')),
          lines: [{ instrument_id: String(form.get('instrument_id')), side: String(form.get('side')), amount_eur: Number(form.get('amount_eur')), reason_codes: ['MANUAL_DRAFT'] }],
        },
      })
      setFeedback(`Ordre brouillon ${result.order.id.slice(0, 8)} créé.`)
      setOrderDecisionId('')
      await mutate()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Ordre impossible')
    } finally {
      setPending(null)
    }
  }

  const exportOrder = async (orderId: string, format: 'csv' | 'pdf') => {
    setPending(`export-${orderId}`)
    try {
      const blob = await authenticatedDownload(`/v1/orders/${orderId}/export?format=${format}`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `ordre-${orderId}.${format}`
      anchor.click()
      URL.revokeObjectURL(url)
      await mutate()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Export impossible')
    } finally {
      setPending(null)
    }
  }

  if (isLoading) return <AppShell><main className="p-5 text-sm text-slate-500">Chargement du journal…</main></AppShell>
  if (error || !data) return <AppShell><main className="p-5"><EmptyState tone="error" title="Journal indisponible" message="La lecture Supabase a échoué." /></main></AppShell>

  const instrumentOptions = Array.from(new Map(data.positions.map((row) => [row.instrument_id, row])).values())

  return (
    <AppShell>
      <main className="p-4 sm:p-5 lg:p-8">
        <div className="mx-auto max-w-[1450px] space-y-5">
          <header><p className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">Gouvernance</p><h1 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">Journal de décisions</h1><p className="mt-2 text-sm text-slate-500">Rationale, validation, ordre brouillon, exécution et rapprochement.</p></header>
          {feedback && <div className="border-l-2 border-emerald-500 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">{feedback}</div>}
          {actionError && <div className="border-l-2 border-red-500 bg-red-50 px-4 py-3 text-xs text-red-700 dark:bg-red-950/20 dark:text-red-300">{actionError}</div>}

          <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
            <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-white/10"><h2 className="text-sm font-black">Nouvelle décision</h2></div>
              <form onSubmit={createDecision} className="space-y-4 p-4">
                <Field label="Portefeuille"><select name="portfolio_id" required className="input"><option value="">Sélectionner</option>{data.portfolios.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
                <Field label="Objet"><input name="title" required minLength={3} maxLength={180} className="input" /></Field>
                <Field label="Rationale"><textarea name="rationale" required minLength={10} maxLength={5000} rows={6} className="input min-h-32 py-3" /></Field>
                <button type="submit" disabled={pending === 'create'} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-950 text-xs font-black text-white disabled:opacity-50 dark:bg-emerald-400 dark:text-slate-950"><Plus size={14} />Ajouter au journal</button>
              </form>
            </section>

            <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10"><h2 className="text-sm font-black">Cycle de décision</h2><span className="text-[10px] font-mono text-slate-500">{data.decisions.length} entrées</span></div>
              {data.decisions.length === 0 ? <div className="p-5 text-sm text-slate-500">Aucune décision enregistrée.</div> : <div className="divide-y divide-slate-200 dark:divide-white/10">{data.decisions.map((row) => <article key={row.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-sm font-black text-slate-950 dark:text-white">{row.title}</h3><p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600 dark:text-gray-400">{row.rationale}</p><p className="mt-2 text-[9px] font-mono text-slate-500">{new Date(row.created_at).toLocaleString('fr-FR')} · {row.id.slice(0, 8)}</p></div><span className={`rounded border px-2 py-1 text-[9px] font-black uppercase ${statusClass(row.status)}`}>{row.status}</span></div><div className="mt-4 flex flex-wrap gap-2">{(transitions[row.status] ?? []).map((item) => <button key={item.status} type="button" onClick={() => transition(row, item.status)} disabled={pending === row.id} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 px-3 text-[10px] font-black disabled:opacity-50 dark:border-white/10">{item.status === 'CANCELLED' ? <XCircle size={12} /> : <CheckCircle2 size={12} />}{item.label}</button>)}{row.status === 'VALIDATED' && <button type="button" onClick={() => setOrderDecisionId(row.id)} className="inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-3 text-[10px] font-black text-white"><Send size={12} />Préparer un ordre</button>}</div></article>)}</div>}
            </section>
          </div>

          {orderDecisionId && <section className="rounded-md border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20"><div className="flex items-center justify-between"><div><h2 className="text-sm font-black">Ordre brouillon</h2><p className="mt-1 text-[10px] text-slate-500">Aucun ordre ne sera envoyé au courtier.</p></div><button type="button" onClick={() => setOrderDecisionId('')} aria-label="Fermer"><XCircle size={18} /></button></div><form onSubmit={createOrder} className="mt-4 grid gap-3 md:grid-cols-5"><input type="hidden" name="decision_id" value={orderDecisionId} /><select name="account_id" required className="input"><option value="">Compte</option>{data.accounts.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><select name="instrument_id" required className="input"><option value="">Instrument</option>{instrumentOptions.map((row) => <option key={row.instrument_id} value={row.instrument_id}>{row.name}</option>)}</select><select name="side" required className="input"><option value="BUY">Acheter</option><option value="SELL">Vendre</option></select><input name="amount_eur" required type="number" min="1" step="0.01" placeholder="Montant EUR" className="input" /><button type="submit" disabled={pending === 'order'} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-black text-white disabled:opacity-50"><Send size={14} />Créer</button></form></section>}

          <OrdersPanel decisions={data.decisions} exportOrder={exportOrder} pending={pending} />
        </div>
      </main>
    </AppShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="text-[9px] font-black uppercase text-slate-500">{label}</span><div className="mt-2">{children}</div></label> }

function OrdersPanel({ decisions, exportOrder, pending }: { decisions: FamilyOfficeDecisionRow[]; exportOrder: (id: string, format: 'csv' | 'pdf') => void; pending: string | null }) {
  const [orders, setOrders] = useState<Array<{ id: string; decision_id: string; account_id: string; status: string; estimated_gross_eur: number | null }>>([])
  const [loaded, setLoaded] = useState(false)
  const load = async () => {
    const { data } = await supabase.from('fo_order_drafts').select('id,decision_id,account_id,status,estimated_gross_eur').order('created_at', { ascending: false })
    setOrders((data ?? []) as typeof orders)
    setLoaded(true)
  }
  const titleByDecision = new Map(decisions.map((row) => [row.id, row.title]))
  return <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10"><h2 className="text-sm font-black">Ordres brouillons</h2><button type="button" onClick={load} className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">{loaded ? 'Actualiser' : 'Charger'}</button></div>{!loaded ? <div className="p-5 text-sm text-slate-500">Chargez les ordres validés pour préparer un export.</div> : orders.length === 0 ? <div className="p-5 text-sm text-slate-500">Aucun ordre brouillon.</div> : <div className="divide-y divide-slate-200 dark:divide-white/10">{orders.map((order) => <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><div className="text-xs font-black">{titleByDecision.get(order.decision_id) ?? order.id.slice(0, 8)}</div><div className="mt-1 text-[9px] font-mono text-slate-500">{order.status} · {order.estimated_gross_eur ?? 0} EUR</div></div><div className="flex gap-2"><button type="button" onClick={() => exportOrder(order.id, 'csv')} disabled={pending === `export-${order.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 px-3 text-[10px] font-black dark:border-white/10"><FileDown size={12} />CSV</button><button type="button" onClick={() => exportOrder(order.id, 'pdf')} disabled={pending === `export-${order.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 px-3 text-[10px] font-black dark:border-white/10"><FileDown size={12} />PDF</button></div></div>)}</div>}</section>
}
