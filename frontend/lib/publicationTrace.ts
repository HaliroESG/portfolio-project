import type { EquityReportingEventRow, PublicationEventEvidence, EquityPublicationDashboardRow } from '../types'
import { publicationCivilDate, publicationDateKey, publicationStatusLabel } from './equityPublicationUi'

/** Interpret only the versioned producer metadata. HIGH is fiscal matching,
 * never proof; a collection timestamp does not certify the underlying result. */
export function publicationEvidence(event: EquityReportingEventRow, today = publicationDateKey(new Date())): PublicationEventEvidence {
  const raw = event.metadata?.publication_evidence
  const proof = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const dated = publicationCivilDate(event.event_date) && event.event_date <= today
  const bound = proof.version === 'publication-evidence/v1' && proof.event_date === event.event_date
    && typeof proof.reference === 'string' && proof.reference.length > 0
  if (event.status === 'REPORTED' && dated && bound) {
    if (proof.basis === 'OFFICIAL_DOCUMENT' && event.event_type === 'REGULATORY_FILING'
      && event.source_provider === 'sec_edgar' && event.filing_date === event.event_date
      && proof.reference === event.metadata.accession_number
      && typeof proof.reference === 'string' && /^\d{10}-\d{2}-\d{6}$/.test(proof.reference)
      && typeof event.metadata.issuer_cik === 'string' && /^\d{10}$/.test(event.metadata.issuer_cik)
      && Number(event.metadata.issuer_cik) > 0
      && typeof event.metadata.primary_document === 'string' && /^[a-zA-Z0-9_.-]+$/.test(event.metadata.primary_document)) {
      const expected = `https://www.sec.gov/Archives/edgar/data/${Number(event.metadata.issuer_cik)}/${proof.reference.replaceAll('-', '')}/${event.metadata.primary_document}`
      if (event.source_url === expected) return { basis: 'OFFICIAL_DOCUMENT', label: 'Dépôt référencé par SEC' }
    }
    if (proof.basis === 'AGGREGATOR_RESULT' && event.event_type === 'EARNINGS'
      && event.source_provider === 'yfinance_yahoo'
      && proof.reference === `${event.provider_symbol}:${event.event_date}`
      && typeof event.metadata.eps_actual === 'number' && Number.isFinite(event.metadata.eps_actual)) {
      return { basis: 'AGGREGATOR_RESULT', label: 'Résultat observé · agrégateur' }
    }
  }
  return { basis: 'UNATTESTED', label: event.status === 'REPORTED'
    ? 'Déclarée publiée · preuve non attestée'
    : event.status === 'CONFIRMED' ? 'Date déclarée confirmée · preuve non attestée'
    : publicationStatusLabel(event.status, event.event_date, today) }
}

export function publicationCoverageDimensions(rows: EquityPublicationDashboardRow[], events: EquityReportingEventRow[], today = publicationDateKey(new Date())) {
  const annualFields = ['annual_revenue', 'annual_ebitda', 'annual_operating_income', 'annual_net_income', 'annual_eps_diluted', 'annual_free_cash_flow'] as const
  const interimFields = ['interim_revenue', 'interim_ebitda', 'interim_operating_income', 'interim_net_income', 'interim_eps_diluted', 'interim_free_cash_flow'] as const
  let officialDocuments = 0, aggregatorResults = 0, unattestedReported = 0
  for (const event of events) {
    const basis = publicationEvidence(event, today).basis
    if (basis === 'OFFICIAL_DOCUMENT') officialDocuments++
    else if (basis === 'AGGREGATOR_RESULT') aggregatorResults++
    else if (event.status === 'REPORTED') unattestedReported++
  }
  return {
    companies: rows.length,
    annual: rows.map(row => ({ key: row.instrument_key, period: row.annual_period_end,
      available: annualFields.filter(k => typeof row[k] === 'number' && Number.isFinite(row[k])).length, total: annualFields.length })),
    interim: rows.map(row => ({ key: row.instrument_key, period: row.interim_period_end,
      available: interimFields.filter(k => typeof row[k] === 'number' && Number.isFinite(row[k])).length, total: interimFields.length })),
    events: events.length,
    officialDocuments, aggregatorResults, unattestedReported,
    valuation: rows.map(row => ({ key: row.instrument_key, asOf: row.valuation_as_of })),
    // Legacy SQL's ttm_complete only used a broad span. No proof of strict L3.
    ttmComparablePeriods: 'UNATTESTED' as const,
    operationalAuthority: false as const,
  }
}
