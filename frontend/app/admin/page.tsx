"use client"

import { Building2, Database, Landmark, Plus, Server, ShieldCheck } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import useSWR from 'swr'
import { AppShell } from '../../components/AppShell'
import { DataHealthPanel } from '../../components/DataHealthPanel'
import { EmptyState } from '../../components/EmptyState'
import { command } from '../../lib/commandApi'
import { supabase } from '../../lib/supabase'
import { useFamilyOfficeBundle } from '../../lib/useFamilyOfficeBundle'
import type { FamilyOfficeOwnerProfileRow } from '../../types'

async function loadProfile(expectedOwnerUserId: string): Promise<FamilyOfficeOwnerProfileRow | null> {
  const { data, error } = await supabase.from('fo_owner_profiles').select('user_id,email,display_name,base_currency,created_at,updated_at').maybeSingle()
  if (error) throw error
  const profile = data as FamilyOfficeOwnerProfileRow | null
  if (profile && profile.user_id !== expectedOwnerUserId) {
    throw new Error('Cross-owner profile data was refused by the UI boundary')
  }
  return profile
}

export default function AdminPage() {
  const { data, error, isLoading, mutate, ownerUserId } = useFamilyOfficeBundle()
  const { data: profile, error: profileError } = useSWR(
    ownerUserId ? `family-office-owner-profile-v2:${ownerUserId}` : null,
    () => loadProfile(ownerUserId ?? ''),
  )
  const [pending, setPending] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    setPending(null)
    setFeedback(null)
    setActionError(null)
  }, [ownerUserId])

  const executeForm = async (key: string, action: () => Promise<unknown>, form: HTMLFormElement) => {
    setPending(key)
    setFeedback(null)
    setActionError(null)
    try {
      await action()
      form.reset()
      setFeedback('Modification enregistrée et auditée.')
      await mutate()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Commande impossible')
    } finally {
      setPending(null)
    }
  }

  const addAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    await executeForm('account', () => command('/v1/accounts', { body: { portfolio_id: String(values.get('portfolio_id')), institution_id: String(values.get('institution_id')), external_account_id: String(values.get('external_account_id')), name: String(values.get('name')), envelope: String(values.get('envelope')), base_currency: String(values.get('base_currency')) } }), form)
  }

  const addHolding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    await executeForm('holding', () => command('/v1/manual-holdings', { body: { portfolio_id: String(values.get('portfolio_id')), holding_kind: String(values.get('holding_kind')), asset_type: String(values.get('asset_type')), name: String(values.get('name')), currency: String(values.get('currency')), valuation_frequency: String(values.get('valuation_frequency')), next_valuation_date: values.get('next_valuation_date') || null, notes: values.get('notes') || null } }), form)
  }

  const addValuation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const holdingId = String(values.get('holding_id'))
    await executeForm('valuation', () => command(`/v1/manual-holdings/${holdingId}/valuations`, { body: { valuation_date: String(values.get('valuation_date')), value_local: Number(values.get('value_local')), fx_rate_to_eur: Number(values.get('fx_rate_to_eur')), value_eur: Number(values.get('value_eur')), source: String(values.get('source')), confidence: String(values.get('confidence')) } }), form)
  }

  if (isLoading) return <AppShell><main className="p-5 text-sm text-slate-500">Chargement de l’administration…</main></AppShell>
  if (error || profileError || !data) return <AppShell><main className="p-5"><EmptyState tone="error" title="Administration indisponible" message="La lecture Supabase du registre ou du profil propriétaire a échoué." /></main></AppShell>

  return (
    <AppShell>
      <main className="p-4 sm:p-5 lg:p-8">
        <div className="mx-auto max-w-[1450px] space-y-5">
          <header><p className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">Configuration privée</p><h1 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">Administration</h1><p className="mt-2 text-sm text-slate-500">Propriétaire, comptes, actifs déclaratifs et santé des données.</p></header>
          {feedback && <div className="border-l-2 border-emerald-500 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">{feedback}</div>}
          {actionError && <div className="border-l-2 border-red-500 bg-red-50 px-4 py-3 text-xs text-red-700 dark:bg-red-950/20 dark:text-red-300">{actionError}</div>}

          <section className="grid overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117] sm:grid-cols-2 lg:grid-cols-4">
            <AdminMetric icon={ShieldCheck} label="Propriétaire" value={profile?.display_name || profile?.email || 'Non configuré'} />
            <AdminMetric icon={Landmark} label="Portefeuilles" value={String(data.portfolios.length)} />
            <AdminMetric icon={Building2} label="Comptes" value={String(data.accounts.length)} />
            <AdminMetric icon={Server} label="API de commandes" value={process.env.NEXT_PUBLIC_COMMAND_API_URL ? 'Configurée' : 'Non configurée'} alert={!process.env.NEXT_PUBLIC_COMMAND_API_URL} />
          </section>

          <div className="grid gap-5 xl:grid-cols-3">
            <FormSection title="Ajouter un compte" subtitle="Fortuneo, IBKR ou compte de cash">
              <form onSubmit={addAccount} className="space-y-3">
                <SelectField name="portfolio_id" label="Portefeuille" options={data.portfolios.map((row) => ({ value: row.id, label: row.name }))} />
                <SelectField name="institution_id" label="Institution" options={data.institutions.map((row) => ({ value: row.id, label: row.name }))} />
                <InputField name="external_account_id" label="Identifiant broker" required />
                <InputField name="name" label="Nom du compte" required />
                <div className="grid grid-cols-2 gap-3"><SelectField name="envelope" label="Enveloppe" options={['PEA', 'CTO', 'PER', 'AV', 'CASH', 'OTHER'].map((value) => ({ value, label: value }))} /><InputField name="base_currency" label="Devise" defaultValue="EUR" required /></div>
                <SubmitButton pending={pending === 'account'} label="Créer le compte" />
              </form>
            </FormSection>

            <FormSection title="Ajouter un actif déclaratif" subtitle="Immobilier, private equity, assurance ou dette">
              <form onSubmit={addHolding} className="space-y-3">
                <SelectField name="portfolio_id" label="Portefeuille" options={data.portfolios.map((row) => ({ value: row.id, label: row.name }))} />
                <div className="grid grid-cols-2 gap-3"><SelectField name="holding_kind" label="Nature" options={[{ value: 'ASSET', label: 'Actif' }, { value: 'LIABILITY', label: 'Passif' }]} /><SelectField name="asset_type" label="Type" options={['REAL_ESTATE', 'PRIVATE_EQUITY', 'INSURANCE', 'PENSION', 'LOAN', 'OTHER'].map((value) => ({ value, label: value }))} /></div>
                <InputField name="name" label="Libellé" required />
                <div className="grid grid-cols-2 gap-3"><InputField name="currency" label="Devise" defaultValue="EUR" required /><SelectField name="valuation_frequency" label="Fréquence" options={['MONTHLY', 'QUARTERLY', 'ANNUAL', 'ON_DEMAND'].map((value) => ({ value, label: value }))} /></div>
                <InputField name="next_valuation_date" label="Prochaine valorisation" type="date" />
                <SubmitButton pending={pending === 'holding'} label="Créer l’actif" />
              </form>
            </FormSection>

            <FormSection title="Enregistrer une valorisation" subtitle="Valeur sourcée, déclarée ou estimée">
              <form onSubmit={addValuation} className="space-y-3">
                <SelectField name="holding_id" label="Actif / passif" options={data.manualHoldings.map((row) => ({ value: row.holding_id, label: row.name }))} />
                <InputField name="valuation_date" label="Date" type="date" required />
                <div className="grid grid-cols-2 gap-3"><InputField name="value_local" label="Valeur locale" type="number" required /><InputField name="fx_rate_to_eur" label="FX vers EUR" type="number" defaultValue="1" required /></div>
                <InputField name="value_eur" label="Valeur EUR" type="number" required />
                <InputField name="source" label="Source" required />
                <SelectField name="confidence" label="Confiance" options={['VERIFIED', 'DECLARED', 'ESTIMATED'].map((value) => ({ value, label: value }))} />
                <SubmitButton pending={pending === 'valuation'} label="Ajouter la valorisation" disabled={data.manualHoldings.length === 0} />
              </form>
            </FormSection>
          </div>

          <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10"><Database size={16} className="text-emerald-500" /><h2 className="text-sm font-black">Comptes configurés</h2></div>
            {data.accounts.length === 0 ? <div className="p-5 text-sm text-slate-500">Aucun compte.</div> : <div className="divide-y divide-slate-200 dark:divide-white/10">{data.accounts.map((row) => <div key={row.id} className="flex items-center justify-between px-4 py-3"><div><div className="text-xs font-black">{row.name}</div><div className="mt-1 text-[9px] font-mono text-slate-500">{row.external_account_id} · {row.envelope} · {row.base_currency}</div></div><span className="text-[9px] font-black uppercase text-slate-500">{row.status}</span></div>)}</div>}
          </section>

          <DataHealthPanel />
        </div>
      </main>
    </AppShell>
  )
}

function AdminMetric({ icon: Icon, label, value, alert = false }: { icon: typeof ShieldCheck; label: string; value: string; alert?: boolean }) { return <div className="border-b border-slate-200 p-4 last:border-b-0 dark:border-white/10 sm:border-r sm:border-b-0"><div className="flex items-center gap-2 text-[9px] font-black uppercase text-slate-500"><Icon size={14} />{label}</div><div className={`mt-3 truncate text-sm font-black ${alert ? 'text-amber-600 dark:text-amber-300' : 'text-slate-950 dark:text-white'}`}>{value}</div></div> }
function FormSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]"><div className="border-b border-slate-200 px-4 py-3 dark:border-white/10"><h2 className="text-sm font-black">{title}</h2><p className="mt-1 text-[10px] text-slate-500">{subtitle}</p></div><div className="p-4">{children}</div></section> }
function InputField({ name, label, type = 'text', defaultValue, required = false }: { name: string; label: string; type?: string; defaultValue?: string; required?: boolean }) { return <label className="block"><span className="text-[9px] font-black uppercase text-slate-500">{label}</span><input name={name} type={type} defaultValue={defaultValue} required={required} step={type === 'number' ? 'any' : undefined} className="input mt-2" /></label> }
function SelectField({ name, label, options }: { name: string; label: string; options: Array<{ value: string; label: string }> }) { return <label className="block"><span className="text-[9px] font-black uppercase text-slate-500">{label}</span><select name={name} required className="input mt-2"><option value="">Sélectionner</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }
function SubmitButton({ pending, label, disabled = false }: { pending: boolean; label: string; disabled?: boolean }) { return <button type="submit" disabled={pending || disabled} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-950 text-xs font-black text-white disabled:opacity-50 dark:bg-emerald-400 dark:text-slate-950"><Plus size={14} />{pending ? 'Enregistrement…' : label}</button> }
