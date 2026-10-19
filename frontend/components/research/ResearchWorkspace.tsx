'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR, { SWRConfig } from 'swr'
import { ArrowDown, ArrowRight, ArrowUp, ChevronLeft, ChevronRight, Filter, RotateCcw, Search } from 'lucide-react'
import { AppShell } from '../AppShell'
import { supabase } from '../../lib/supabase'
import { loadResearchBundle } from '../../lib/researchData'
import { DEFAULT_RESEARCH_STATE, filterResearch, PAGE_SIZE, primaryScore, qualification, readResearchState, RESEARCH_PRESETS, researchHref, researchMetric, observationLabel, type ResearchPreset, type ResearchSort, type ResearchState } from '../../lib/researchModel'
import { Badge, button, input, money, multiple, Notice, number, percent, Score, tableClass } from './ResearchUi'
import { CompanyDossier } from './CompanyDossier'

const PRESET_LABELS: Record<ResearchPreset, string> = { ALL: 'Tout l’univers', ESN_UNIVERSE: 'Services informatiques', IT_SERVICES_VALUE: 'Services IT · value', FCF_COMPOUNDERS: 'FCF compounders', QUALITY_VALUE: 'Quality Value', MOMENTUM_TREND: 'Momentum & tendance', SECTOR_BOOMS: 'Dynamique sectorielle' }
const COLUMNS: Array<{ key: ResearchSort; label: string }> = [{ key: 'score', label: 'Score / 100' }, { key: 'roic', label: 'ROIC' }, { key: 'debt', label: 'Dette / EBITDA' }, { key: 'pe', label: 'PER forward' }, { key: 'yield', label: 'FCF yield' }, { key: 'growth', label: 'CA · CAGR 3 ans' }]
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="min-w-0 text-[11px] text-slate-500 dark:text-slate-400">{label}<select aria-label={label} className={`${input} mt-1 text-xs`} value={value} onChange={event => onChange(event.target.value)}><option value="">Tous</option>{value && !options.includes(value) && <option value={value}>{value} (hors univers reçu)</option>}{options.map(option => <option value={option} key={option}>{option}</option>)}</select></label>
}

function ResearchBody() {
  const router = useRouter(), params = useSearchParams()
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState<boolean | null>(null)
  const state = useMemo(() => readResearchState(new URLSearchParams(params.toString())), [params])
  const { data, error, isLoading, isValidating, mutate } = useSWR('research-universe-v1', () => loadResearchBundle(supabase), { revalidateOnFocus: false, shouldRetryOnError: false })
  const rows = useMemo(() => data?.rows ?? [], [data])
  const filtered = useMemo(() => filterResearch(rows, state), [rows, state])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), page = Math.min(state.page, pages)
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selected = rows.find(row => row.key === state.instrument)
  const previousKey = useRef('')
  const onChange = (patch: Partial<ResearchState>, push = false) => {
    const href = researchHref({ ...state, ...patch })
    if (push) router.push(href, { scroll: false })
    else router.replace(href, { scroll: false })
  }
  const filter = (patch: Partial<ResearchState>) => onChange({ ...patch, page: 1 })
  useEffect(() => {
    if (state.instrument && !selected) return
    if (state.instrument === previousKey.current) return
    const old = previousKey.current
    previousKey.current = state.instrument
    if (state.instrument) document.getElementById('research-dossier-title')?.focus()
    else if (old) document.getElementById(`research-row-${encodeURIComponent(old)}${window.innerWidth < 768 ? '-mobile' : ''}`)?.focus()
  }, [state.instrument, selected])
  const options = (field: 'country' | 'sector' | 'exchange') => Array.from(new Set(rows.map(row => row.identity[field]).filter((v): v is string => !!v))).sort()
  const themes = Array.from(new Set(rows.flatMap(row => row.equity?.themes ?? []))).sort()
  const activeFilters = [state.query, state.country, state.sector, state.exchange, state.theme, state.state, state.tag, state.minScore, state.maxPe, state.minYield].filter(Boolean).length + (state.preset !== 'ALL' ? 1 : 0)
  const showMobileFilters = mobileFiltersOpen ?? (activeFilters > (state.query ? 1 : 0))
  const latestCollection = [data?.equity?.lastUpdateIso, data?.trident?.lastUpdateIso].filter((value): value is string => Boolean(value)).sort().at(-1)
  const sort = (key: ResearchSort) => onChange({ sort: key, direction: state.sort === key ? state.direction === 'asc' ? 'desc' : 'asc' : key === 'company' || key === 'pe' || key === 'debt' ? 'asc' : 'desc', page: 1 })
  const sortHeader = (key: ResearchSort, label: string) => <th key={key} aria-sort={state.sort === key ? state.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="inline-flex min-h-8 items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-emerald-700" onClick={() => sort(key)}>{label}{state.sort === key && (state.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button></th>
  return <AppShell lastSyncIso={latestCollection} contextLabel="Rechercher · Univers global · Consultation">
    <main className="mx-auto max-w-[1800px] space-y-5 px-4 py-6 sm:px-6 lg:px-8" aria-label="Espace de recherche">
      {state.instrument ? selected ? <CompanyDossier key={selected.key} instrument={selected} state={state} onChange={onChange} /> : <div className="space-y-4"><Link className={button} href={researchHref({ ...state, instrument: '', tab: 'summary' })}>Retour aux résultats</Link><Notice danger={!isLoading}>{isLoading ? 'Chargement du dossier…' : 'Instrument absent des lecteurs reçus ou lecture indisponible. Aucun rapprochement par ticker n’est effectué.'}</Notice></div> : <>
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">Rechercher / Actions</p><h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">Screener & Top Quality</h1><p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">Comparer les valeurs, comprendre leur qualité, puis vérifier chaque dossier.</p></div><Badge>Univers global · Consultation</Badge></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-white/10"><div className="flex gap-5" role="group" aria-label="Vue de recherche">{(['all', 'top'] as const).map(view => <button key={view} className={`min-h-12 border-b-2 text-sm font-semibold ${state.view === view ? 'border-emerald-700 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300' : 'border-transparent text-slate-500'}`} aria-pressed={state.view === view} onClick={() => filter({ view })}>{view === 'all' ? 'Toutes les valeurs' : 'Top Quality'}{view === 'all' && data && <span className="ml-2 text-xs font-normal text-slate-500">{rows.length}</span>}</button>)}</div><button className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-500" onClick={() => void mutate()} disabled={isValidating}><RotateCcw size={13} />{isValidating ? 'Lecture…' : 'Relire les données'}</button></div>
        <Notice><strong>Un score n’est pas une qualification.</strong> Classement Quality Value / 100, critères Trident et état des sources restent distincts. La Top Quality actuelle attend une preuve de fraîcheur et de droits d’usage.</Notice>
      </>}
      {isLoading && <p role="status" className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500 dark:border-white/10 dark:bg-white/5">Lecture du screener et des critères Trident…</p>}
      {(error || data?.status === 'ERROR') && <Notice danger>Impossible de lire l’univers de recherche. Aucun résultat vide n’est interprété comme une absence de valeurs. {error && data && 'Les données précédentes sont conservées en cache, sans actualisation attestée.'} <button className={button} onClick={() => void mutate()}>Réessayer</button></Notice>}
      {data?.messages.map(message => <Notice key={message}>{message}</Notice>)}
      {!state.instrument && !isLoading && data && data.status !== 'ERROR' && <>
        <section aria-label="Filtres du screener" className="rounded-lg border border-[#e1e8e5] bg-white p-4 dark:border-white/10 dark:bg-[#0e141b]">
          <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(200px,1.5fr)_1fr_1fr_1fr_auto]">
            <label className="text-[11px] text-slate-500 dark:text-slate-400">Rechercher une valeur<div className="relative mt-1"><Search size={16} className="absolute left-3 top-3 text-slate-400" /><input className={`${input} pl-9`} placeholder="Société, ticker, activité…" value={state.query} onChange={event => filter({ query: event.target.value })} type="search" /></div></label>
            <button className={`${button} sm:hidden`} aria-expanded={showMobileFilters} aria-controls="research-filter-fields" onClick={() => setMobileFiltersOpen(!showMobileFilters)}><Filter size={14} />{showMobileFilters ? 'Masquer les filtres' : 'Affiner les résultats'}{activeFilters ? ` (${activeFilters})` : ''}</button>
            <div id="research-filter-fields" className={`${showMobileFilters ? 'grid' : 'hidden'} grid-cols-2 gap-3 sm:contents`}>
            <label className="text-[11px] text-slate-500 dark:text-slate-400">Profil d’exploration<select aria-label="Profil d’exploration" className={`${input} mt-1 text-xs`} value={state.preset} onChange={event => filter({ preset: event.target.value as ResearchPreset })}>{RESEARCH_PRESETS.map(preset => <option key={preset} value={preset}>{PRESET_LABELS[preset]}</option>)}</select></label>
            <Select label="Secteur" value={state.sector} options={options('sector')} onChange={sector => filter({ sector })} />
            <Select label="État Trident historique" value={state.state} options={['QUALIFIED', 'WATCHLIST', 'REJECTED', 'NO_DATA']} onChange={value => filter({ state: value })} />
            <button className={button} onClick={() => onChange({ ...DEFAULT_RESEARCH_STATE, view: state.view })}><RotateCcw size={14} />Réinitialiser{activeFilters ? ` (${activeFilters})` : ''}</button>
            </div>
          </div>
          <details className={`mt-3 ${showMobileFilters ? 'block' : 'hidden'} sm:block`} open={Boolean(state.country || state.exchange || state.theme || state.tag || state.minScore || state.maxPe || state.minYield) || undefined}><summary className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400"><Filter size={13} />Filtres avancés & tri</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select label="Pays" value={state.country} options={options('country')} onChange={country => filter({ country })} /><Select label="Place de cotation" value={state.exchange} options={options('exchange')} onChange={exchange => filter({ exchange })} />
              <Select label="Thème" value={state.theme} options={themes} onChange={theme => filter({ theme })} /><Select label="Tag de valorisation" value={state.tag} options={['POTENTIAL_VALUE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']} onChange={tag => filter({ tag })} />
              {([{ key: 'minScore', label: 'Score minimum / 100', min: 0, max: 100 }, { key: 'maxPe', label: 'PER forward maximum (positif)', min: 0, max: 10000 }, { key: 'minYield', label: 'FCF yield minimum (%)', min: -100, max: 10000 }] as const).map(field => <label key={field.key} className="text-[11px] text-slate-500 dark:text-slate-400">{field.label}<input className={`${input} mt-1`} type="number" min={field.min} max={field.max} step="any" placeholder="Sans limite" value={state[field.key]} onChange={event => filter({ [field.key]: event.target.value })} /></label>)}
              <label className="text-[11px] text-slate-500 dark:text-slate-400">Trier par<select aria-label="Trier par" className={`${input} mt-1 text-xs`} value={state.sort} onChange={event => sort(event.target.value as ResearchSort)}><option value="company">Société</option>{COLUMNS.map(col => <option key={col.key} value={col.key}>{col.label}</option>)}<option value="marketCap">Capitalisation USD</option><option value="margin">Marge FCF</option><option value="target">Écart objectif analystes</option></select><button onClick={() => onChange({ direction: state.direction === 'asc' ? 'desc' : 'asc', page: 1 })} className="mt-1 min-h-7 text-xs underline">{state.direction === 'asc' ? 'Croissant' : 'Décroissant'}</button></label>
            </div><p className="mt-3 text-[11px] text-slate-500">Profils hérités exploratoires, pas des listes qualifiées. Le filtre PER utilise explicitement le forward ; les valeurs manquantes ne satisfont pas un seuil numérique.</p>
          </details>
        </section>
        <section className="min-w-0 overflow-hidden rounded-lg border border-[#e1e8e5] bg-white dark:border-white/10 dark:bg-[#0e141b]" aria-label="Résultats de recherche">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-xs dark:border-white/10"><p aria-live="polite"><strong>{filtered.length}</strong> instruments{state.view === 'all' ? ` sur ${rows.length}` : ''} · {data.equity?.rows.length ?? 0} valorisations · {data.trident?.rows.length ?? 0} dossiers Trident</p><p className="text-[11px] text-slate-500">Devises sources conservées · — = indisponible</p></div>
          {!filtered.length ? <div className="max-w-2xl space-y-3 px-6 py-10"><h2 className="text-lg font-semibold">{state.view === 'top' ? 'Top Quality non attestée' : rows.length ? 'Aucun résultat pour ces filtres' : 'Univers reçu vide'}</h2><p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">{state.view === 'top' ? 'Les lecteurs actuels ne fournissent pas de preuve complète de droits et de fraîcheur. Aucun instrument ne peut être certifié ici, même avec un score élevé. Les qualifications historiques restent consultables.' : rows.length ? 'Les valeurs non renseignées restent dans l’univers, mais ne satisfont pas un filtre numérique.' : 'Aucun instrument reçu des lecteurs. La couverture du marché n’est pas établie.'}</p><button className={button} onClick={() => onChange({ ...DEFAULT_RESEARCH_STATE })}>Explorer toutes les valeurs<ArrowRight size={14} /></button>{state.view === 'top' && <button className={`${button} ml-2`} onClick={() => onChange({ ...DEFAULT_RESEARCH_STATE, state: 'QUALIFIED' })}>Voir les qualifications historiques</button>}</div> : <>
            <ul className="divide-y divide-slate-100 dark:divide-white/10 md:hidden" aria-label="Valeurs du screener">{visible.map(row => {
              const status = qualification(row)
              return <li key={row.key} className="space-y-4 p-4"><div className="flex items-start justify-between gap-4"><div><Link id={`research-row-${encodeURIComponent(row.key)}-mobile`} className="text-sm font-semibold text-emerald-900 underline-offset-4 hover:underline dark:text-emerald-200" href={researchHref({ ...state, instrument: row.key, tab: 'summary' })}>{row.identity.name ?? row.identity.ticker}</Link><p className="mt-1 text-[11px] text-slate-500">{row.identity.ticker} · {row.identity.exchange ?? '—'} · {row.identity.currency ?? '—'}</p></div><Score value={primaryScore(row)} /></div><Badge tone={status.tone}>{status.label}</Badge><dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="text-slate-500">ROIC</dt><dd className="mt-1 font-semibold">{percent(researchMetric(row, 'roic'))}</dd></div><div><dt className="text-slate-500">Dette / EBITDA</dt><dd className="mt-1 font-semibold">{multiple(researchMetric(row, 'debt'))}</dd></div><div><dt className="text-slate-500">PER forward</dt><dd className="mt-1 font-semibold">{multiple(researchMetric(row, 'pe'))}</dd></div><div><dt className="text-slate-500">FCF yield</dt><dd className="mt-1 font-semibold">{percent(researchMetric(row, 'yield'))}</dd></div></dl><p className="text-[11px] leading-relaxed text-slate-500">QV : {observationLabel(row.equity?.as_of_date)} · Trident : {observationLabel(row.trident?.as_of_date)}</p>{!!row.issues.length && <p className="text-xs text-amber-800 dark:text-amber-200">{row.issues.join(' · ')}</p>}</li>
            })}</ul>
            <div className="hidden overflow-x-auto md:block" tabIndex={0} aria-label="Résultats, défilement horizontal"><table className={`${tableClass} [&_tbody_tr:hover]:bg-emerald-50/40 dark:[&_tbody_tr:hover]:bg-white/5`}><caption className="sr-only">Screener unifié, classement Quality Value</caption><thead><tr>{sortHeader('company', 'Société / cotation')}{sortHeader('score', 'Score / 100')}<th>Admissibilité historique</th>{COLUMNS.filter(col => col.key !== 'score').map(col => sortHeader(col.key, col.label))}<th>État des données</th></tr></thead><tbody>{visible.map(row => {
              const id = row.identity, status = qualification(row)
              return <tr key={row.key}><td className="min-w-52 max-w-72"><Link id={`research-row-${encodeURIComponent(row.key)}`} className="rounded font-semibold text-[#172d2b] hover:text-emerald-700 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-700 dark:text-slate-100" href={researchHref({ ...state, instrument: row.key, tab: 'summary' })}>{id.name ?? id.ticker}</Link><div className="mt-1 text-[10px] text-slate-500">{id.ticker} · {id.exchange ?? 'Place inconnue'} · {id.country ?? '—'} · {id.currency ?? '—'}</div><div className="mt-1 text-[10px] text-slate-500">{id.sector ?? 'Secteur inconnu'}</div></td>
                <td><Score value={primaryScore(row)} /></td><td className="min-w-40"><Badge tone={status.tone}>{status.label}</Badge><p className="mt-1 text-[10px] text-slate-500">Conformes {number(row.trident?.criteria_pass_count, 0)} · échecs {number(row.trident?.criteria_fail_count, 0)} · manquants {number(row.trident?.criteria_missing_count, 0)}</p></td>
                <td className="whitespace-nowrap tabular-nums">{percent(researchMetric(row, 'roic'))}</td><td className="whitespace-nowrap tabular-nums">{multiple(researchMetric(row, 'debt'))}</td><td className="whitespace-nowrap tabular-nums">{multiple(researchMetric(row, 'pe'))}</td><td className="whitespace-nowrap tabular-nums">{percent(researchMetric(row, 'yield'))}</td><td className="whitespace-nowrap tabular-nums">{percent(researchMetric(row, 'growth'))}</td>
                <td className="min-w-48 text-[10px] text-slate-500"><div>QV : {observationLabel(row.equity?.as_of_date)}</div><div>Trident : {observationLabel(row.trident?.as_of_date)}</div><div className="mt-1">{row.issues.length ? row.issues.join(' · ') : row.equity?.data_state.length ? row.equity.data_state.join(' · ') : 'Qualité courante non attestée'}</div>{state.sort === 'marketCap' && <div>Capitalisation USD : {money(researchMetric(row, 'marketCap'), 'USD')}</div>}{state.sort === 'margin' && <div>Marge FCF : {percent(researchMetric(row, 'margin'))}</div>}{state.sort === 'target' && <div>Objectif analystes : {percent(researchMetric(row, 'target'))}</div>}</td>
              </tr>
            })}</tbody></table></div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"><span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} sur {filtered.length}</span><div className="flex items-center gap-3"><button className={button} disabled={page === 1} onClick={() => onChange({ page: page - 1 })} aria-label="Page précédente"><ChevronLeft size={15} /></button><span>Page {page} / {pages}</span><button className={button} disabled={page === pages} onClick={() => onChange({ page: page + 1 })} aria-label="Page suivante"><ChevronRight size={15} /></button></div></div>
          </>}
        </section>
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">Les dossiers regroupent les informations existantes, sans modifier leur calcul. Les <Link className="underline" href="/trident">critères Trident historiques</Link> et le <Link className="underline" href="/screener">screener historique</Link> restent accessibles pour contrôler la parité.</p>
      </>}
    </main>
  </AppShell>
}

/** No cross-session dossier cache. Only the authenticated subject selects a cache. */
export function ResearchWorkspace() {
  const [session, setSession] = useState<{ state: 'loading' | 'ready' | 'signed-out' | 'error'; owner?: string }>({ state: 'loading' })
  useEffect(() => {
    let alive = true, generation = 0
    const verify = (expectedOwner?: string) => {
      const request = ++generation
      setSession({ state: 'loading' })
      // Leave the synchronous auth callback before asking the SDK to verify.
      // Cached event payloads never select a data cache or authorize reads.
      void Promise.resolve().then(() => supabase.auth.getUser()).then(({ data, error }) => {
        if (!alive || generation !== request) return
        setSession(error || (expectedOwner && data.user?.id !== expectedOwner) ? { state: 'error' }
          : data.user ? { state: 'ready', owner: data.user.id } : { state: 'signed-out' })
      }).catch(() => { if (alive && generation === request) setSession({ state: 'error' }) })
    }
    verify()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      if (!alive || event === 'INITIAL_SESSION') return // Initial verification above is authoritative.
      if (event === 'SIGNED_OUT' || !next?.user) { generation++; setSession({ state: 'signed-out' }) }
      else verify(next.user.id)
    })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])
  if (session.state !== 'ready') return <main className="min-h-screen bg-[#f6f8f7] p-8 dark:bg-[#080A0F]"><h1 className="mb-5 text-xl font-semibold text-slate-800 dark:text-slate-200">Portfolio Office · Recherche</h1><Notice>{session.state === 'loading' ? 'Vérification de la session…' : <>{session.state === 'error' ? 'Session non vérifiable. Aucune donnée chargée.' : 'Session déconnectée. Cache de recherche fermé.'} <Link href="/login" className="underline">Se connecter</Link></>}</Notice></main>
  return <SWRConfig key={session.owner} value={{ provider: () => new Map() }}><ResearchBody /></SWRConfig>
}
