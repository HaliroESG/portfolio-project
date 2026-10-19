'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { loadEquityPublicationHistory } from '../../lib/equityPublicationsData'
import { publicationEvidence } from '../../lib/publicationTrace'
import { Badge, button, money, Notice, number, Panel, SourceLink, tableClass } from './ResearchUi'
import type { EquityAnnualFinancialRow, EquityInterimFinancialRow } from '../../types'

function FinancialTable({ rows, annual }: { rows: Array<EquityAnnualFinancialRow | EquityInterimFinancialRow>; annual: boolean }) {
  return <div className="overflow-x-auto" tabIndex={0} aria-label={annual ? 'Comptes annuels, défilement horizontal' : 'Comptes intermédiaires, défilement horizontal'}><table className={tableClass}>
    <caption className="sr-only">{annual ? 'Historique annuel' : 'Périodes intermédiaires'}</caption>
    <thead><tr><th>Période / clôture</th><th>CA</th><th>EBITDA</th><th>Résultat op.</th><th>Résultat net</th><th>BPA dilué</th><th>FCF</th>{!annual && <><th>Flux opérationnel</th><th>Capex</th></>}<th>Traçabilité</th></tr></thead>
    <tbody>{rows.map((row, i) => <tr key={`${row.fiscal_year}:${row.fiscal_period_end}:${'period_kind' in row ? row.period_kind : 'FY'}:${i}`}>
      <td className="min-w-36"><strong>{'period_kind' in row ? row.period_kind : 'FY'} {row.fiscal_year}</strong><div className="mt-1 text-[11px] text-slate-500">{row.fiscal_period_end ?? 'Clôture non attestée'}</div>{'period_months' in row && <div className="text-[11px] text-slate-500">Durée : {row.period_months ?? '—'} mois</div>}</td>
      {[row.revenue, row.ebitda, row.operating_income, row.net_income].map((value, index) => <td key={index} className="whitespace-nowrap tabular-nums">{money(value, row.currency)}</td>)}
      <td className="whitespace-nowrap tabular-nums">{number(row.eps_diluted, 2)} {row.eps_diluted !== null ? row.currency ?? '(devise inconnue)' : ''}</td><td className="whitespace-nowrap tabular-nums">{money(row.free_cash_flow, row.currency)}</td>
      {!annual && <><td className="whitespace-nowrap">{money('operating_cash_flow' in row ? row.operating_cash_flow : null, row.currency)}</td><td className="whitespace-nowrap">{money('capital_expenditure' in row ? row.capital_expenditure : null, row.currency)}</td></>}
      <td className="min-w-56"><SourceLink url={row.source_url} /><div className="mt-1 text-[10px] text-slate-500">{'provider' in row ? row.provider : row.source_provider} · collecté / mis à jour : {row.updated_at ?? 'non attesté'}</div>{'data_state' in row && <div className="mt-1"><Badge>{row.data_state}</Badge>{row.reason_codes.map(reason => <div className="mt-1 text-[10px]" key={reason}>{reason}</div>)}</div>}</td>
    </tr>)}</tbody></table></div>
}

export function ResearchPublications({ instrumentKey }: { instrumentKey: string }) {
  const { data, error, isLoading, mutate } = useSWR(['research-publications', instrumentKey], () => loadEquityPublicationHistory(supabase, instrumentKey), { revalidateOnFocus: false, shouldRetryOnError: false })
  return <div className="space-y-4">
    <Notice>Comptes et calendrier ne constituent pas la même preuve. Les dates estimées restent estimées. Les champs manquants restent vides ; aucun TTM n’est reconstruit ici.</Notice>
    {isLoading && <p role="status">Chargement des publications…</p>}
    {error && <Notice danger>Publications indisponibles pour cet instrument. <button className={button} onClick={() => void mutate()}>Réessayer les publications</button></Notice>}
    {!error && data && <>
      <Panel title="Historique annuel" note="Les 5 exercices les plus récents du lecteur existant. Chaque montant conserve sa devise comptable.">{data.annual.length ? <FinancialTable rows={data.annual} annual /> : <p className="text-sm text-slate-500">Aucun exercice reçu. Cela ne signifie pas que la société ne publie pas.</p>}</Panel>
      <Panel title="Périodes intermédiaires" note="Les 8 dernières périodes reçues. Trimestre isolé, semestre et cumul annuel ne sont pas additionnés.">{data.interim.length ? <FinancialTable rows={data.interim} annual={false} /> : <p className="text-sm text-slate-500">Aucune période intermédiaire reçue.</p>}</Panel>
      <Panel title="Publications & dépôts" note="Les 24 événements les plus récents du lecteur. La clôture comptable n’est pas la date de publication." action={<Link className={button} href="/publications">Calendrier global</Link>}>
        {!data.events.length ? <p className="text-sm text-slate-500">Aucun événement reçu dans cette fenêtre ; couverture non attestée.</p> : <ol className="divide-y divide-slate-100 dark:divide-white/10">{data.events.map(event => {
          const evidence = publicationEvidence(event)
          return <li key={event.event_key} className="grid gap-3 py-4 first:pt-0 sm:grid-cols-[100px_1fr_auto]">
            <div className="text-sm font-semibold tabular-nums">{event.event_date}<div className="mt-1 text-[11px] font-normal text-slate-500">{event.event_time_utc ? `${event.event_time_utc} UTC` : 'Heure non fournie'}</div></div>
            <div><h4 className="text-sm font-semibold">{event.event_label ?? event.event_type}</h4><div className="my-2"><Badge tone={evidence.basis === 'UNATTESTED' ? 'warning' : 'neutral'}>{evidence.label}</Badge></div><p className="text-[11px] text-slate-500">{event.source_provider} · {event.period_kind ?? 'Période non attestée'} {event.fiscal_year ?? ''} · clôture {event.fiscal_period_end ?? 'non attestée'}</p><p className="mt-1 text-[11px] text-slate-500">Observé : {event.last_seen_at ?? 'non attesté'} · correspondance fiscale {event.match_confidence} (pas une preuve de publication)</p></div>
            <SourceLink url={event.source_url} />
          </li>
        })}</ol>}
      </Panel>
    </>}
  </div>
}
