import type { FxRateView } from '../types'

export function FxRateDetails({ rate, cached = false }: { rate: FxRateView; cached?: boolean }) {
  const synthetic = rate.provenance === 'OFFLINE_SYNTHETIC'
  return (
    <div data-fx-detail={rate.id} className="mt-1 space-y-1 text-[10px] leading-relaxed text-slate-500 dark:text-gray-400">
      <div>{cached ? 'CACHED · ' : ''}{synthetic ? 'FIXTURE HORS LIGNE · ' : ''}{rate.status}
        {rate.provenance === 'LEGACY' ? ' · Non certifié' : rate.status === 'IDENTITY' ? ' · Identité mathématique, pas un cours' : ''}</div>
      <div>1 {rate.id} = taux en EUR</div>
      {rate.status !== 'IDENTITY' && <>
        <div>Cotation : {rate.observed_at ?? rate.observed_date ?? 'inconnue'}</div>
        <div>Collecte : {rate.last_update ?? 'inconnue'}</div>
        <div>Source : {rate.provider ?? 'non renseignée'}{rate.provenance === 'LEGACY' ? ' (table currencies)' : ''}</div>
        <details>
          <summary className="cursor-pointer underline underline-offset-2">Traçabilité et variation</summary>
          <div className="mt-1 break-words">Âge en séances : {rate.session_age ?? 'inconnu'} · Calendrier : {rate.calendar_ref ?? 'non renseigné'}</div>
          <div className="break-words">{rate.reason_codes.join(' · ')}</div>
          <div className="break-words">{rate.change_pct === null ? `Variation N/A : ${rate.comparison_reason_codes.join(' · ')}` : 'Variation entre deux séances sources consécutives comparables.'}</div>
          {synthetic && <div>Exemple synthétique : aucun droit de collecte, écriture ou activation.</div>}
        </details>
      </>}
    </div>
  )
}
