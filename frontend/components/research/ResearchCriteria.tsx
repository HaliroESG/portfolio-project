'use client'

import useSWR from 'swr'
import { supabase } from '../../lib/supabase'
import { loadTridentCriteria } from '../../lib/tridentData'
import { observationLabel, type ResearchInstrument, type ResearchState } from '../../lib/researchModel'
import { Badge, button, Notice, number, Panel, percent, tableClass } from './ResearchUi'

const statuses = { pass: 'Conforme', fail: 'Échoué', missing: 'Manquant', not_applicable: 'Non applicable' }
const categories = { growth: 'Croissance', profitability: 'Rentabilité', capital: 'Capital', health: 'Santé financière' }
export function ResearchCriteria({ instrument, horizon, onHorizon }: { instrument: ResearchInstrument; horizon: ResearchState['horizon']; onHorizon: (h: ResearchState['horizon']) => void }) {
  const { data, error, isLoading, mutate } = useSWR(instrument.trident ? ['research-criteria', instrument.key, horizon] : null,
    () => loadTridentCriteria(supabase, instrument.key, horizon), { revalidateOnFocus: false, shouldRetryOnError: false })
  const summary = instrument.trident?.horizons[String(horizon)]
  return <div className="space-y-4">
    <Notice>Les critères expliquent la qualité historique. Un critère manquant n’est pas un échec ; une conformité historique n’atteste pas la Top Quality actuelle.</Notice>
    <Panel title="Qualité & critères Trident" note={observationLabel(instrument.trident?.as_of_date)} action={<div className="flex gap-1" role="group" aria-label="Horizon des critères">{([1, 3, 5, 10] as const).map(h => <button key={h} className={button} aria-pressed={h === horizon} onClick={() => onHorizon(h)} style={h === horizon ? { background: '#e8f4ef', color: '#087d64', borderColor: '#87c5b5' } : undefined}>{h} {h === 1 ? 'an' : 'ans'}</button>)}</div>}>
      {!instrument.trident ? <p className="text-sm">Critères indisponibles pour cet instrument. Aucun dossier voisin n’est substitué.</p> : <>
        <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-400">
          <span>Période : {summary?.start_year ?? '—'} → {summary?.end_year ?? '—'}</span>
          <span>Observations : {summary?.coverage?.observed_observations ?? '—'} / {summary?.coverage?.expected_observations ?? '—'}</span>
          <span>Couverture : {summary?.coverage ? `${number(summary.coverage.coverage_pct)} %` : 'non attestée'}</span>
          <Badge tone={summary?.status === 'complete' ? 'neutral' : 'warning'}>{summary?.status === 'complete' ? 'Historique déclaré complet' : 'Historique partiel ou non attesté'}</Badge>
        </div>
        {!!summary?.coverage?.missing_years.length && <p className="mb-3 text-xs text-amber-800 dark:text-amber-200">Années absentes : {summary.coverage.missing_years.join(', ')}</p>}
        {!!summary?.coverage?.duplicate_years.length && <Notice>Années dupliquées : {summary.coverage.duplicate_years.join(', ')}</Notice>}
        {isLoading && <p role="status">Chargement des critères…</p>}
        {error && <Notice danger>Lecture des critères impossible. <button className={button} onClick={() => void mutate()}>Réessayer les critères</button></Notice>}
        {!error && data && !data.length && <p className="text-sm">Aucun critère reçu sur cet horizon. La qualité n’est pas déduite d’une liste vide.</p>}
        {!error && !!data?.length && <div className="overflow-x-auto" tabIndex={0} aria-label="Tableau des critères, défilement horizontal"><table className={tableClass}><caption className="sr-only">Critères Trident sur {horizon} ans</caption><thead><tr><th>Critère / famille</th><th>Observé</th><th>Règle backend</th><th>Résultat</th><th>Explication</th></tr></thead><tbody>{data.map(row => {
          const ratio = /margin|cagr|roic|roe|roce|shares|fcf_quality/i.test(row.criterion_key)
          const format = ratio ? percent : number
          return <tr key={`${row.category}:${row.criterion_key}`}><td className="min-w-44"><strong>{row.label}</strong><div className="mt-1 text-[11px] text-slate-500">{categories[row.category]}{row.is_eliminating ? ' · Éliminatoire' : ''}</div></td><td className="tabular-nums">{format(row.actual)}</td><td className="whitespace-nowrap tabular-nums">{row.comparator ?? '—'} {format(row.threshold)}</td><td><Badge tone={row.status === 'fail' ? 'danger' : row.status === 'missing' ? 'warning' : 'neutral'}>{statuses[row.status]}</Badge></td><td className="min-w-48 text-slate-600 dark:text-slate-400">{row.reason ?? 'Aucune explication fournie'}<div className="mt-1 text-[10px]">Mise à jour : {row.updated_at ?? 'non attestée'}</div></td></tr>
        })}</tbody></table></div>}
      </>}
    </Panel>
  </div>
}
