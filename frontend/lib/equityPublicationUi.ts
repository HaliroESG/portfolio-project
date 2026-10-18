export function publicationDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(NaN)
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isFinite(parsed.getTime()) && publicationDateKey(parsed) === value ? parsed : new Date(NaN)
}

export function publicationCivilDate(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(publicationDate(value).getTime()) ? value : null
}

export function publicationStatusLabel(status: string, date?: string | null, today = publicationDateKey(new Date())): string {
  if (status === 'CONFIRMED') return 'Confirmée'
  if (status === 'REPORTED') return 'Publiée'
  if (status === 'CANCELLED') return 'Annulée'
  if (status !== 'ESTIMATED') return 'Inconnu'
  return publicationCivilDate(date) && date! < today ? 'Estimée · échéance passée' : 'Estimée'
}

export function publicationMonthCovered(month: Date, window: { start: string; end: string }): boolean {
  return publicationDateKey(new Date(month.getFullYear(), month.getMonth(), 1)) >= window.start
    && publicationDateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0)) <= window.end
}

export function publicationDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function publicationMonthGrid(month: Date): Array<Date | null> {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const leading = (first.getDay() + 6) % 7
  const values: Array<Date | null> = Array.from({ length: leading }, () => null)
  for (let day = 1; day <= last.getDate(); day += 1) {
    values.push(new Date(month.getFullYear(), month.getMonth(), day))
  }
  while (values.length % 7 !== 0) values.push(null)
  return values
}

export function matchesPublicationSearch(values: Array<string | null | undefined>, search: string): boolean {
  const normalizedSearch = search.trim().toLocaleLowerCase('fr')
  if (!normalizedSearch) return true
  return values
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase('fr')
    .includes(normalizedSearch)
}
import type { EquityPublicationDashboardRow, EquityReportingEventRow } from '../types'


// One company identity joins both views. Event labels/periods remain searchable;
// a matching event also exposes its company in the table, without joining names.
export function filterPublicationSearch(rows: EquityPublicationDashboardRow[], events: EquityReportingEventRow[], index: string, search: string) {
  const byKey = new Map(rows.map(row => [row.instrument_key, row]))
  const companyFields = (row: EquityPublicationDashboardRow) => [row.ticker, row.name, row.sector]
  const filteredEvents = events.filter(event => {
    const company = byKey.get(event.instrument_key)
    const sourceIndex = company?.source_index ?? event.source_index
    return (index === 'Tous' || sourceIndex === index) && matchesPublicationSearch([
      ...(company ? companyFields(company) : [event.ticker, event.name]),
      event.event_label, event.period_kind, event.fiscal_year?.toString(), event.event_date,
    ], search)
  })
  const eventKeys = new Set(filteredEvents.map(event => event.instrument_key))
  const filteredRows = rows.filter(row => (index === 'Tous' || row.source_index === index)
    && (matchesPublicationSearch(companyFields(row), search) || eventKeys.has(row.instrument_key)))
  return { rows: filteredRows, events: filteredEvents }
}
