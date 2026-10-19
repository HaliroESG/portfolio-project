import type { CurrencyRateRow, FxRateView, FxTraceV1 } from '../types'
import { parseCurrencyRate } from './fxData'
import { observationState } from './readerState'

export const FX_PILOT = ['USD', 'CHF', 'GBP', 'JPY'] as const
const symbols: Record<string, string> = { USD: '$', CHF: 'CHF', GBP: '£', JPY: '¥' }

export function eurIdentity(): FxRateView {
  return {
    id: 'EUR', symbol: '€', rate_to_eur: 1, last_update: null, quote: 'EUR',
    provenance: 'MATHEMATICAL_IDENTITY', status: 'IDENTITY', observed_date: null,
    observed_at: null, provider: null, session_age: null, calendar_ref: null,
    change_pct: null, reason_codes: ['MATHEMATICAL_IDENTITY_NOT_A_QUOTE'],
    comparison_reason_codes: ['NOT_APPLICABLE'],
  }
}

// Every runtime/cache row is deliberately projected as legacy. Extra columns
// cannot promote a row to a verified quote, even if they claim VALIDATED.
export function projectLegacyFx(input: CurrencyRateRow, now = Date.now()): FxRateView {
  const row = parseCurrencyRate(input as unknown as Record<string, unknown>)
  if (!row) throw new Error('Invalid currency identity')
  if (row.id === 'EUR' && row.rate_to_eur === 1) return eurIdentity()
  const collection = observationState(row.rate_to_eur, row.last_update, now)
  const conflict = row.id === 'EUR' && row.rate_to_eur !== null
  return {
    ...row, rate_to_eur: conflict ? null : row.rate_to_eur, quote: 'EUR', provenance: 'LEGACY',
    status: conflict ? 'CONFLICT' : collection === 'MISSING' ? 'MISSING' : collection === 'STALE' ? 'STALE' : 'UNKNOWN',
    observed_date: null, observed_at: null, provider: null, session_age: null,
    calendar_ref: null, change_pct: null,
    reason_codes: conflict ? ['EUR_IDENTITY_CONFLICT'] : ['LEGACY_PROVENANCE_UNAVAILABLE'],
    comparison_reason_codes: ['SOURCE_SESSIONS_UNVERIFIED'],
  }
}

// Offline-only projection of the typed Python output, never called by a live
// reader. Runtime activation needs a separately reviewed physical mapping and
// rights decision. These guards fail closed on inconsistent fixture bindings.
export function projectOfflineFxTrace(trace: FxTraceV1): FxRateView {
  if (trace.contract_version !== 'fx-trace/v1' || trace.scope !== 'OFFLINE_SYNTHETIC'
      || trace.operational_authority !== false || !FX_PILOT.includes(trace.currency)
      || trace.quote !== 'EUR' || trace.unit !== 'EUR_PER_UNIT'
      || trace.ticker !== `${trace.currency}EUR=X`) throw new Error('Invalid offline FX contract')
  for (const entry of [trace.current, trace.previous, ...trace.observations]) {
    if (!entry) continue
    const observation = entry.observation
    if (observation.scope !== 'OFFLINE_SYNTHETIC' || observation.operational_authority !== false
        || observation.contract_version !== 'source-observation/v1'
        || observation.identity.domain !== 'FX' || observation.identity.key !== `FX:${trace.currency}:EUR`
        || observation.identity.frequency !== 'DAILY' || observation.identity.period !== null
        || ![null, trace.ticker].includes(observation.source.native_id)
        || ![null, 'EUR_PER_UNIT'].includes(observation.unit)
        || (observation.value !== null && (!Number.isFinite(observation.value)
          || observation.value <= 0 || observation.value > Number.MAX_SAFE_INTEGER))) {
      throw new Error('Invalid offline FX observation')
    }
  }
  const current = trace.current?.observation
  if (trace.change_pct !== null || trace.inverse_change_pct !== null) {
    const previous = trace.previous?.observation
    const cal = trace.calendar
    const dates = cal?.sessions ?? []
    const value = current?.value
    const before = previous?.value
    const comparable = current && previous && cal && value && before
      && trace.status === 'VALIDATED' && current.quality === 'VALIDATED'
      && current.nature === 'OBSERVED' && previous.nature === 'OBSERVED'
      && trace.reason_codes.length === 0 && trace.comparison_reason_codes.length === 0
      && trace.conflicts.length === 0 && trace.current?.session_age === 0 && trace.previous?.session_age === 1
      && cal.provider === current.source.provider && cal.close_convention === trace.current?.close_convention
      && dates.at(-1) === current.identity.observed_date && dates.at(-2) === previous.identity.observed_date
      && ['provider', 'native_id', 'adapter_version'].every(key =>
        current.source[key as keyof typeof current.source] === previous.source[key as keyof typeof previous.source])
      && current.unit === previous.unit && current.unit === 'EUR_PER_UNIT'
      && current.identity.precision === previous.identity.precision
      && (current.identity.precision !== 'TIMESTAMP' || current.identity.observed_at?.slice(10) === previous.identity.observed_at?.slice(10))
      && trace.current?.close_convention === trace.previous?.close_convention
    if (!comparable || trace.change_pct !== value / before - 1 || trace.inverse_change_pct !== before / value - 1
        || !Number.isFinite(trace.change_pct) || !Number.isFinite(trace.inverse_change_pct)) {
      throw new Error('Inconsistent offline FX comparison')
    }
  }
  return {
    id: trace.currency, symbol: symbols[trace.currency], quote: 'EUR', provenance: 'OFFLINE_SYNTHETIC',
    rate_to_eur: trace.status === 'CONFLICT' ? null : current?.value ?? null,
    last_update: current?.collected_at ?? null, status: trace.status,
    observed_date: current?.identity.observed_date ?? null, observed_at: current?.identity.observed_at ?? null,
    provider: current?.source.provider ?? null, session_age: trace.current?.session_age ?? null,
    calendar_ref: trace.calendar ? `${trace.calendar.id}@${trace.calendar.version}` : null,
    change_pct: trace.change_pct, reason_codes: trace.reason_codes,
    comparison_reason_codes: trace.comparison_reason_codes,
  }
}
