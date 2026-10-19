import type { MacroIndicatorRow, MacroObservationView, MacroTraceV1 } from '../types'
import { macroCollectionState } from './macroState'

// The live/legacy path cannot promote extra columns or cached fixture metadata.
export function projectLegacyMacro(row: MacroIndicatorRow, now = Date.now()): MacroObservationView {
  const collection = macroCollectionState(row, now)
  return {
    id: row.id, provenance: 'LEGACY', value: row.value,
    unit: null, status: collection === 'COLLECTED' ? 'UNKNOWN' : collection,
    observed_date: null, period: null, collected_at: row.last_update,
    provider: null, native_id: null, formula_ref: null, cadence_ref: null,
    expected_period: null, input_count: 0, method_parameters: {},
    reason_codes: ['LEGACY_SOURCE_UNIT_PERIOD_UNVERIFIED'], tactical_usable: false,
  }
}

// Fixture presentation only: never imported by a Supabase reader. Values and
// derivations come from Python; this guard is NOT a physical schema validator.
export function projectOfflineMacroTrace(trace: MacroTraceV1): MacroObservationView {
  const fail = () => { throw new Error('Invalid offline macro trace') }
  if (trace.contract_version !== 'macro-trace/v1' || trace.scope !== 'OFFLINE_SYNTHETIC'
      || trace.operational_authority !== false || trace.tactical_usable !== false
      || !['MISSING', 'UNKNOWN', 'STALE', 'PARTIAL', 'VALIDATED', 'CONFLICT'].includes(trace.status)) fail()
  for (const entry of [trace.current, ...trace.observations, ...trace.inputs]) {
    if (!entry) continue
    const observation = entry.observation
    if (observation.contract_version !== 'source-observation/v1'
        || observation.scope !== 'OFFLINE_SYNTHETIC' || observation.operational_authority !== false
        || observation.identity.domain !== 'MACRO') fail()
    for (const value of [entry.canonical_value, observation.value]) {
      if (value !== null && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) fail()
    }
  }
  const current = trace.current
  const observation = current?.observation
  if (observation && (observation.identity.key !== trace.series_id || observation.identity.frequency !== trace.frequency)) fail()
  if (trace.value !== null) {
    if (!Number.isFinite(trace.value) || Math.abs(trace.value) > Number.MAX_SAFE_INTEGER
        || !['VALIDATED', 'STALE', 'PARTIAL'].includes(trace.status)
        || trace.value !== current?.canonical_value) fail()
  }
  if (trace.status === 'VALIDATED') {
    const policy = trace.cadence_policy
    const period = observation?.identity.period
    const periodKey = period?.start ?? observation?.identity.observed_date
    const periodEnd = period?.end ?? observation?.identity.observed_date
    if (!current || !observation || observation.quality !== 'VALIDATED'
        || trace.reason_codes.length || current.reason_codes.length
        || !policy || policy.scope !== 'OFFLINE_SYNTHETIC' || policy.series_id !== trace.series_id
        || policy.frequency !== trace.frequency || policy.evaluated_on !== trace.evaluated_at.slice(0, 10)
        || policy.expected_period.start !== periodKey || policy.expected_period.end !== periodEnd
        || trace.value === null || trace.canonical_unit === null
        || !Number.isFinite(Date.parse(policy.publication_due_at)) || !Number.isFinite(Date.parse(trace.evaluated_at))
        || Date.parse(policy.publication_due_at) > Date.parse(trace.evaluated_at)) fail()
  }
  if (observation?.nature === 'DERIVED'
      && (trace.formula_ref !== observation.formula_ref || trace.inputs.length !== observation.input_refs.length)) fail()
  return {
    id: trace.series_id, provenance: 'OFFLINE_SYNTHETIC', status: trace.status,
    value: trace.value, unit: trace.canonical_unit,
    observed_date: observation?.identity.observed_date ?? null,
    period: observation?.identity.period ?? null, collected_at: observation?.collected_at ?? null,
    provider: observation?.source.provider ?? null, native_id: current?.provider_native_id ?? null,
    formula_ref: trace.formula_ref, cadence_ref: trace.cadence_policy
      ? trace.cadence_policy.id + '@' + trace.cadence_policy.version : null,
    expected_period: trace.cadence_policy?.expected_period ?? null,
    input_count: trace.inputs.length, method_parameters: trace.parameters,
    reason_codes: trace.reason_codes, tactical_usable: false,
  }
}
