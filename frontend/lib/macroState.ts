import type { MacroIndicatorRow } from './macroData'
import type { MacroRegimeSnapshotRow, MacroSatelliteTargetRow } from '../types'
import { observationState } from './readerState'

export type MacroReadState = 'READY' | 'LOADING' | 'ERROR' | 'MISSING' | 'UNKNOWN' | 'STALE'
export type MacroHealthState = 'NORMAL' | 'CAUTION' | 'STRESS' | Exclude<MacroReadState, 'READY'>
export type PillarStatus = 'red' | 'amber' | 'green' | 'unknown' | 'stale' | 'error' | 'loading'

export const MACRO_PROVENANCE_NOTICE = 'Consultation seulement : date d’observation et qualité source non attestées. Les valeurs collectées ne constituent pas un signal tactique.'

export function macroCollectionState(row: MacroIndicatorRow | undefined, now = Date.now()): 'COLLECTED' | 'MISSING' | 'UNKNOWN' | 'STALE' {
  const state = observationState(row?.value, row?.last_update, now)
  return state === 'READY' ? 'COLLECTED' : state
}

export function macroInputState(rows: (MacroIndicatorRow | undefined)[], loading = false, error: unknown = null, now = Date.now()): MacroReadState {
  if (error) return 'ERROR'
  if (loading) return 'LOADING'
  const states = rows.map((row) => observationState(row?.value, row?.last_update, now))
  if (!states.length || states.includes('MISSING')) return 'MISSING'
  if (states.includes('UNKNOWN')) return 'UNKNOWN'
  if (states.includes('STALE')) return 'STALE'
  // macro_indicators.last_update is collection time, not observation time.
  // bridge.py can also publish fallback/approximate derived values without a
  // quality flag. This legacy contract cannot qualify ANY tactical conclusion.
  return 'UNKNOWN'
}

export function macroVariationClass(row: MacroIndicatorRow | undefined, loading = false, error: unknown = null, now = Date.now()): string {
  if (macroInputState([row], loading, error, now) !== 'READY'
    || row?.change_pct == null || !Number.isFinite(row.change_pct)) return 'text-slate-500'
  return row.change_pct >= 0 ? 'text-emerald-600' : 'text-red-500'
}

export function thresholdState(row: MacroIndicatorRow | undefined, now = Date.now()): MacroHealthState {
  const state = macroInputState([row], false, null, now)
  if (state !== 'READY') return state
  if (!row || row.threshold_amber === null || row.threshold_red === null || !row.direction
    || !Number.isFinite(row.threshold_amber) || !Number.isFinite(row.threshold_red)) return 'UNKNOWN'
  const up = row.direction === 'UP'
  if (up ? row.threshold_red <= row.threshold_amber : row.threshold_red >= row.threshold_amber) return 'UNKNOWN'
  const value = row.value!
  if (up ? value >= row.threshold_red : value <= row.threshold_red) return 'STRESS'
  if (up ? value >= row.threshold_amber : value <= row.threshold_amber) return 'CAUTION'
  return 'NORMAL'
}

export function macroHealthState(rows: MacroIndicatorRow[], loading = false, error: unknown = null, now = Date.now()): MacroHealthState {
  if (error) return 'ERROR'
  if (loading) return 'LOADING'
  return thresholdState(rows.find((row) => row.id === '^VIX'), now)
}

export function pillarState(rows: (MacroIndicatorRow | undefined)[], red: boolean, amber: boolean, loading = false, error: unknown = null, now = Date.now()): PillarStatus {
  const state = macroInputState(rows, loading, error, now)
  if (state === 'MISSING' || state === 'UNKNOWN') return 'unknown'
  if (state !== 'READY') return state.toLowerCase() as 'stale' | 'error' | 'loading'
  return red ? 'red' : amber ? 'amber' : 'green'
}

export function macroStrategyState(regime: MacroRegimeSnapshotRow | null | undefined, loading: boolean, error: unknown, now = Date.now()): MacroReadState | 'PARTIAL' {
  if (error) return 'ERROR'
  if (loading) return 'LOADING'
  if (!regime) return 'MISSING'
  if (regime.regime_state === 'UNKNOWN' || regime.regime === 'UNKNOWN') return 'UNKNOWN'
  if (regime.regime_state === 'STALE') return 'STALE'
  if (regime.regime_state === 'PARTIAL') return 'PARTIAL'
  const collectionState = observationState(1, regime.updated_at, now)
  if (collectionState !== 'READY') return collectionState
  // FRED per-series age limits are not a freshness contract for a regime or
  // target. A refreshed updated_at (even with READY) cannot certify as_of_date.
  // Until a separate business validity contract is available, keep all dated
  // snapshots consultable but quarantine their conclusions and target weights.
  return 'UNKNOWN'
}

export function macroTargetUsable(regime: MacroRegimeSnapshotRow | null, target: MacroSatelliteTargetRow, now = Date.now()): boolean {
  return Boolean(regime && macroStrategyState(regime, false, null, now) === 'READY'
    && target.snapshot_id === regime.id && target.as_of_date === regime.as_of_date && target.regime === regime.regime
    && target.regime_state === 'READY' && target.data_state === 'READY' && !target.is_blocked
    && observationState(target.target_weight_pct, target.updated_at, now) === 'READY'
    && Number.isFinite(target.effective_weight_pct))
}
