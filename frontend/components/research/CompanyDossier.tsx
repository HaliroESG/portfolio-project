'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, BookOpen } from 'lucide-react'
import { finite, observationLabel, primaryScore, qualification, researchHref, researchMetric, RESEARCH_TABS, type ResearchInstrument, type ResearchState, type ResearchTab } from '../../lib/researchModel'
import { Badge, button, Metric, money, multiple, Notice, number, Panel, percent, percentagePoints, Score } from './ResearchUi'
import { ResearchCriteria } from './ResearchCriteria'
import { ResearchPublications } from './ResearchPublications'
import { TridentCompanyInsight } from '../TridentCompanyInsight'

const Regression = dynamic(() => import('../TridentRegressionChart').then(module => module.TridentRegressionChart), { ssr: false, loading: () => <p role="status" className="p-6 text-sm text-slate-500">Chargement du graphique de régression…</p> })
export const TAB_LABELS: Record<ResearchTab, string> = { summary: 'Synthèse', quality: 'Qualité & critères', valuation: 'Valorisation', history: 'Cours & régression', publications: 'Publications', insights: 'Société & analyses', sources: 'Données & méthode' }
const PARTS = [['valuation_points', 'Valorisation', 20], ['fcf_points', 'Free cash-flow', 25], ['quality_points', 'Qualité', 20], ['growth_points', 'Croissance', 15], ['health_points', 'Santé financière', 20]] as const

function ScoreBreakdown({ instrument }: { instrument: ResearchInstrument }) {
  const details = instrument.equity?.score_details
  const parts = PARTS.map(([key, label, max]) => ({ key, label, max, value: details?.[key] }))
  const complete = parts.every(part => finite(part.value) && part.value >= 0 && part.value <= part.max)
  const total = complete ? parts.reduce((sum, part) => sum + (part.value as number), 0) : null
  return <Panel title="Un score de classement, cinq composantes" note="Score Quality Value calculé par le backend. Aucun mélange avec le score Trident.">
    <div className="mb-5"><Score value={primaryScore(instrument)} large /></div>
    <dl className="space-y-4">{parts.map(part => <div key={part.key}><div className="mb-1.5 flex justify-between gap-3 text-xs"><dt>{part.label}</dt><dd className="font-semibold tabular-nums">{number(part.value, 0)} / {part.max}</dd></div><div className="h-1 rounded bg-slate-100 dark:bg-white/10" aria-hidden="true"><div className="h-full rounded bg-emerald-700/65 dark:bg-emerald-400" style={{ width: `${finite(part.value) && part.value >= 0 && part.value <= part.max ? part.value / part.max * 100 : 0}%` }} /></div></div>)}</dl>
    <p className="mt-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Une entrée manquante peut valoir zéro dans une composante backend. Elle reste signalée dans les états de données ; elle ne devient pas un chiffre financier nul.</p>
    {total === null ? <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">Décomposition incomplète : aucune reconstitution du score.</p> : total !== primaryScore(instrument) && <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">Décomposition différente du score reçu ({number(total)} points). À vérifier ; le score n’est pas recalculé.</p>}
  </Panel>
}

function Valuation({ instrument }: { instrument: ResearchInstrument }) {
  const q = instrument.equity
  return <div className="space-y-4"><Notice>Valorisation datée, pas signal d’achat. Les deux PER restent distincts ; le plus faible n’est pas présenté comme un PER unique.</Notice>
    <Panel title="Valorisation & génération de trésorerie" note={observationLabel(q?.as_of_date)}><dl className="grid grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-3">
      <Metric label="PER historique" value={multiple(q?.trailing_pe)} note="Prix / bénéfice par action historique" />
      <Metric label="PER forward" value={multiple(q?.forward_pe)} note="Bénéfice prévisionnel ; distinct du résultat publié" />
      <Metric label="Rendement FCF" value={percent(q?.fcf_yield)} note="FCF / capitalisation, devises compatibles requises" />
      <Metric label="Marge FCF" value={percent(q?.fcf_margin)} note="FCF / chiffre d’affaires de l’exercice" />
      <Metric label="CA · croissance annualisée 3 ans" value={percent(q?.revenue_cagr_3y)} />
      <Metric label="CA · croissance annualisée 5 ans" value={percent(q?.revenue_cagr_5y)} />
      <Metric label="Capitalisation · devise source" value={money(q?.market_cap, q?.valuation_currency)} />
      <Metric label="Capitalisation · USD" value={money(q?.market_cap_usd, 'USD')} note={`Conversion : ${q?.market_cap_fx_rate ?? 'non attestée'} · au ${q?.market_cap_fx_as_of ?? 'non attesté'}`} />
      <Metric label="Chiffre d’affaires annuel" value={money(q?.revenue, q?.financial_currency)} note={`FY ${q?.latest_fiscal_year ?? 'non attesté'}`} />
      <Metric label="Free cash-flow annuel" value={money(q?.free_cash_flow, q?.financial_currency)} />
      <Metric label="Croissance prévisionnelle du CA" value={percent(q?.forecast_revenue_growth)} note="Une prévision absente reste absente" />
      <Metric label="Écart à l’objectif analystes" value={percent(q?.target_upside)} note={`${q?.analyst_count ?? 'Nombre non attesté'} analystes · estimation, pas rendement attendu`} />
    </dl></Panel>
    <Panel title="Lecture historique du prix" note="Ces indicateurs viennent du lecteur screener. Le graphique permet de vérifier la période et la couverture."><dl className="grid grid-cols-2 gap-6 lg:grid-cols-4"><Metric label="Pente de régression" value={percentagePoints(q?.regression_slope_pct)} /><Metric label="Écart à la tendance (z-score)" value={finite(q?.regression_z_score) ? `${number(q.regression_z_score, 2)} σ` : '—'} /><Metric label="Momentum 3 / 12 mois" value={`${percentagePoints(q?.momentum_3m_pct)} / ${percentagePoints(q?.momentum_12m_pct)}`} /><Metric label="Position / MM200" value={q?.ma200_state ?? 'Non attestée'} /></dl></Panel>
  </div>
}

function Sources({ instrument }: { instrument: ResearchInstrument }) {
  const q = instrument.equity, t = instrument.trident
  return <div className="space-y-4">
    <Notice>Les droits d’usage et la fraîcheur qualifiée ne sont pas attestés par les lecteurs actuels. La Top Quality courante reste fermée, même si un score est élevé ou un état historique indique QUALIFIED.</Notice>
    <Panel title="Identité et provenance" note="Rapprochement uniquement sur instrument_key. Les classes d’actions et places de cotation restent distinctes."><dl className="grid gap-6 sm:grid-cols-2">
      <Metric label="Identifiant canonique" value={instrument.key} />
      <Metric label="Fournisseur / symbole" value={`${instrument.identity.provider} / ${instrument.identity.provider_symbol ?? 'non attesté'}`} />
      <Metric label="Observation · valorisation" value={observationLabel(q?.as_of_date)} note={`Collecte / mise à jour : ${q?.updated_at ?? 'non attestée'}`} />
      <Metric label="Observation · Trident" value={observationLabel(t?.as_of_date)} note={`Collecte / mise à jour : ${t?.updated_at ?? 'non attestée'}`} />
      <Metric label="Source / univers" value={`${t?.source_provider ?? q?.provider ?? '—'} / ${instrument.identity.source_index ?? '—'}`} />
      <Metric label="Note de licence (pas une autorisation)" value={t?.source_license_note ?? 'Non disponible'} />
    </dl>
    <div className="mt-5 flex flex-wrap gap-2">{(q?.data_state.length ? q.data_state : ['État détaillé non fourni']).map(state => <Badge key={state} tone="warning">{state}</Badge>)}</div>
    {instrument.issues.map(issue => <p key={issue} className="mt-3 text-xs text-amber-800 dark:text-amber-200">{issue}</p>)}
    </Panel>
    <div className="grid gap-4 xl:grid-cols-2"><ScoreBreakdown instrument={instrument} /><Panel title="Ne pas confondre les indicateurs"><dl className="space-y-5 text-sm">
      <div><dt className="font-semibold">Score Quality Value</dt><dd className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Classement de recherche / 100. Source : equity_screener_latest. Pondérations : valorisation 20, FCF 25, qualité 20, croissance 15, santé 20. Ce n’est ni une probabilité ni une recommandation.</dd></div>
      <div><dt className="font-semibold">Admissibilité Trident</dt><dd className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">État historique calculé par trident_screener_latest, expliqué critère par critère dans trident_criteria. Les critères éliminatoires et les données manquantes restent distincts.</dd></div>
      <div><dt className="font-semibold">Diagnostic Trident hérité</dt><dd className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Score historique : {number(t?.score, 0)} / 100 · confiance de calcul : {number(t?.confidence, 0)} / 100. Conservés pour la parité et l’audit ; ils ne servent pas de second classement dans la liste unifiée.</dd></div>
      <div><dt className="font-semibold">Régression et z-score</dt><dd className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Modèle descriptif de l’historique de prix sélectionné, en échelle linéaire ou logarithmique et devise locale ou EUR. La pente, les bandes et l’écart dépendent de la fenêtre. Ce n’est pas une prévision de cours.</dd></div>
      <div><dt className="font-semibold">Date et couverture</dt><dd className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">as_of_date désigne l’observation. updated_at désigne la collecte ou mise à jour technique. Une collecte récente ne rend pas une observation ancienne actuelle. Un tiret signifie indisponible, jamais zéro.</dd></div>
    </dl></Panel></div>
  </div>
}

export function CompanyDossier({ instrument, state, onChange }: { instrument: ResearchInstrument; state: ResearchState; onChange: (patch: Partial<ResearchState>, push?: boolean) => void }) {
  const id = instrument.identity, t = instrument.trident, q = instrument.equity, status = qualification(instrument)
  const safeIdentity = Boolean(q || t)
  const tab = state.tab
  const navigateTab = (next: ResearchTab) => onChange({ tab: next })
  return <section aria-label={`Dossier ${id.name ?? id.ticker}`} className="space-y-5">
    <Link id="research-back" className="inline-flex items-center gap-2 rounded text-xs font-semibold text-emerald-800 dark:text-emerald-300" href={researchHref({ ...state, instrument: '', tab: 'summary' })}><ArrowLeft size={15} />Retour aux résultats filtrés</Link>
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">Rechercher / Dossier société</p><h1 id="research-dossier-title" tabIndex={-1} className="break-words text-2xl font-semibold tracking-tight outline-none lg:text-3xl">{id.name ?? id.ticker}</h1><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{id.ticker} · {id.exchange ?? 'Place non attestée'} · {id.country ?? 'Pays non attesté'} · {id.sector ?? 'Secteur non attesté'} · {id.currency ?? 'Devise non attestée'}</p></div><Badge>Univers global · Consultation</Badge></div>
    {!!instrument.issues.length && <Notice>{instrument.issues.join(' · ')}</Notice>}
    <dl className="grid grid-cols-2 gap-5 rounded-lg border border-[#e1e8e5] bg-white p-5 dark:border-white/10 dark:bg-[#0e141b] lg:grid-cols-4">
      <div><dt className="mb-2 text-xs text-slate-500">Score de classement</dt><dd><Score value={primaryScore(instrument)} large /></dd></div>
      <div><dt className="mb-2 text-xs text-slate-500">Admissibilité historique</dt><dd><Badge tone={status.tone}>{status.label}</Badge></dd><dd className="mt-2 text-[11px] text-slate-500">Top Quality actuelle non attestée</dd></div>
      <Metric label="ROIC" value={percent(researchMetric(instrument, 'roic'))} note={observationLabel(q?.latest_roic != null ? q.as_of_date : t?.as_of_date)} />
      <Metric label="Dette nette / EBITDA" value={multiple(researchMetric(instrument, 'debt'))} note={observationLabel(q?.latest_net_debt_to_ebitda != null ? q.as_of_date : t?.as_of_date)} />
    </dl>
    <div role="tablist" aria-label="Sections du dossier" className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-white/10">
      {RESEARCH_TABS.map((key, index) => <button key={key} id={`research-tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`research-panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => navigateTab(key)} onKeyDown={event => {
        let next = index
        if (event.key === 'ArrowRight') next = (index + 1) % RESEARCH_TABS.length
        else if (event.key === 'ArrowLeft') next = (index + RESEARCH_TABS.length - 1) % RESEARCH_TABS.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = RESEARCH_TABS.length - 1
        else return
        event.preventDefault(); navigateTab(RESEARCH_TABS[next]); document.getElementById(`research-tab-${RESEARCH_TABS[next]}`)?.focus()
      }} className={`min-h-11 shrink-0 border-b-2 px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-emerald-700 ${tab === key ? 'border-emerald-700 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>{TAB_LABELS[key]}</button>)}
    </div>
    <div role="tabpanel" id={`research-panel-${tab}`} aria-labelledby={`research-tab-${tab}`} tabIndex={0} className="outline-none focus-visible:outline-2 focus-visible:outline-emerald-700">
      {tab === 'summary' && <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]"><div className="space-y-4">
        <Panel title="Ce qu’il faut examiner" note="Le classement aide à chercher. Le dossier sert à vérifier avant toute décision.">
          <div className="space-y-5"><div><Badge tone={status.tone}>{status.label}</Badge><p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{status.reason}</p></div>
            <dl className="grid grid-cols-3 gap-3"><Metric label="Critères conformes" value={number(t?.criteria_pass_count, 0)} /><Metric label="Critères échoués" value={number(t?.criteria_fail_count, 0)} /><Metric label="Critères manquants" value={number(t?.criteria_missing_count, 0)} /></dl>
            {!!t?.failed_eliminators.length && <Notice danger>Éliminatoires échoués : {t.failed_eliminators.join(', ')}</Notice>}
            <div className="flex flex-wrap gap-2"><button className={button} onClick={() => navigateTab('quality')}>Examiner les critères<ArrowRight size={14} /></button><button className={button} onClick={() => navigateTab('sources')}><BookOpen size={14} />Comprendre la méthode</button></div>
          </div>
        </Panel>
        <Panel title="Valorisation en contexte" note={observationLabel(q?.as_of_date)} action={<button className={button} onClick={() => navigateTab('valuation')}>Tous les ratios<ArrowRight size={14} /></button>}><dl className="grid grid-cols-2 gap-6 sm:grid-cols-3"><Metric label="PER historique / forward" value={`${multiple(q?.trailing_pe)} / ${multiple(q?.forward_pe)}`} /><Metric label="Rendement FCF" value={percent(q?.fcf_yield)} /><Metric label="CA · croissance 3 ans" value={percent(q?.revenue_cagr_3y)} /><Metric label="Marge FCF" value={percent(q?.fcf_margin)} /><Metric label="Capitalisation source" value={money(q?.market_cap, q?.valuation_currency)} /><Metric label="Exercice financier" value={q?.latest_fiscal_year ? `FY ${q.latest_fiscal_year}` : 'Non attesté'} /></dl></Panel>
        <Panel title="Poursuivre la vérification"><div className="grid gap-3 sm:grid-cols-2"><button className={`${button} justify-between`} onClick={() => navigateTab('history')}>Cours & régression historique<ArrowRight size={14} /></button><button className={`${button} justify-between`} onClick={() => navigateTab('publications')}>Comptes & publications<ArrowRight size={14} /></button></div><p className="mt-4 text-xs text-slate-500">Aucun ordre, arbitrage ou activation depuis ce dossier. Les analyses et actualités sont accessibles dans « Société & analyses ».</p></Panel>
      </div><div className="space-y-4"><ScoreBreakdown instrument={instrument} /><Notice>{observationLabel(q?.as_of_date)} (valorisation). {observationLabel(t?.as_of_date)} (Trident). Consulter les sources avant d’utiliser ces chiffres.</Notice></div></div>}
      {tab === 'quality' && <ResearchCriteria instrument={instrument} horizon={state.horizon} onHorizon={horizon => onChange({ horizon })} />}
      {tab === 'valuation' && <Valuation instrument={instrument} />}
      {tab === 'history' && <Panel title="Cours & régression historique" note="Le moteur existant est conservé : 5 ans / 10 ans / maximum, devise locale / EUR, log / linéaire, MM200 et plein écran.">{safeIdentity && instrument.priceTicker ? <><p className="mb-3 text-xs text-slate-500">Symbole source de lecture : {instrument.priceTicker}. Aucun repli sur un ticker court. Si un lecteur est indisponible, l’historique reste suspendu.</p><Regression ticker={instrument.priceTicker} instrumentKey={instrument.key} providerSymbol={instrument.priceFallbackSymbol} assetCurrency={id.currency} wide /></> : <Notice danger>Identité de prix ambiguë ou non vérifiable : aucun historique de prix n’est chargé.</Notice>}</Panel>}
      {tab === 'publications' && (safeIdentity ? <ResearchPublications instrumentKey={instrument.key} /> : <Notice danger>Identité ambiguë : aucune publication n’est rapprochée.</Notice>)}
      {tab === 'insights' && <Panel title="Société, consensus & actualités" note="Lecteur existant. Les dates, fournisseurs, limites et indisponibilités restent visibles ; les textes de synthèse ne sont pas des faits vérifiés.">{safeIdentity ? <TridentCompanyInsight instrumentKey={instrument.key} ticker={id.ticker} providerSymbol={id.provider_symbol} /> : <Notice danger>Identité ambiguë : aucune analyse n’est chargée.</Notice>}</Panel>}
      {tab === 'sources' && <Sources instrument={instrument} />}
    </div>
  </section>
}
