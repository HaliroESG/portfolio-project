import { financialQualification } from '../lib/financialQualification'

export function FinancialKpiNotice({ family, context = {} }: { family: string; context?: object }) {
  const proof = financialQualification(family, context)
  return (
    <details className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <summary className="cursor-pointer font-bold">Indicateurs non qualifiés — voir pourquoi</summary>
      <p className="mt-2">{proof.message} Les valeurs patrimoniales restent distinctes des rendements.</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <dt>Périmètre</dt><dd>{proof.portfolio_id ?? 'Non documenté'}</dd>
        <dt>Début / fin du calcul</dt><dd>{proof.window_start ?? 'Inconnu'} / {proof.window_end ?? 'Inconnue'}</dd>
        <dt>Date de calcul</dt><dd>{proof.calculated_at ?? 'Inconnue'}</dd>
        <dt>Couverture publiée</dt><dd>{proof.coverage_pct === null ? 'Inconnue' : `${proof.coverage_pct}% — ne vaut pas qualification`}</dd>
        <dt>Version du calcul</dt><dd>{proof.calculation_version ?? 'Inconnue'} — non qualifiée</dd>
      </dl>
      <p className="mt-2 text-[10px]">{proof.reason_code} · {proof.policy_version}</p>
    </details>
  )
}
