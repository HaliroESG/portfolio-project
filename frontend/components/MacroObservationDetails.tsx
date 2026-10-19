import type { MacroObservationView } from '../types'

export function MacroObservationDetails({ view }: { view: MacroObservationView }) {
  return (
    <details data-macro-details={view.id} className="mt-2 min-w-0 text-xs text-slate-500">
      <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2">Source, période et méthode</summary>
      <div className="mt-2 space-y-1 break-words">
        <p>{view.provenance === 'OFFLINE_SYNTHETIC' ? 'FIXTURE HORS LIGNE · ' : 'Données historiques · '}{view.status}</p>
        <p>Observation source : {view.observed_date ?? 'non attestée'}</p>
        <p>Période : {view.period ? view.period.start + ' → ' + view.period.end : 'non attestée'}</p>
        <p>Collecte : {view.collected_at ?? 'inconnue'} — ne certifie pas la fraîcheur source.</p>
        <p>Source : {view.provider ?? 'non attestée'}{view.native_id ? ' · ' + view.native_id : ''}</p>
        <p>Unité : {view.unit ?? 'non attestée'}</p>
        <p>Cadence : {view.cadence_ref ?? 'non attestée'}</p>
        {view.expected_period ? <p>Période attendue : {view.expected_period.start} → {view.expected_period.end}</p> : null}
        <p>Méthode : {view.formula_ref ?? 'aucun calcul attesté'} · {view.input_count} entrées liées</p>
        {Object.entries(view.method_parameters).map(([key, value]) => <p key={key}>{key} : {Array.isArray(value) ? value.join(', ') : value}</p>)}
        {view.reason_codes.length > 0 ? <p>{view.reason_codes.join(' · ')}</p> : null}
        <p>Aucun signal tactique, régime ou cible activé. Les droits source restent un contrôle distinct.</p>
      </div>
    </details>
  )
}
