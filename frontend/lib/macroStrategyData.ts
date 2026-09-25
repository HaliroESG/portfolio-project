import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  MacroAllocationAction,
  MacroAllocationAdviceRow,
  MacroLiquiditySignal,
  MacroRecommendedEnvelope,
  MacroRegime,
  MacroRegimeSnapshotRow,
  MacroRegimeState,
  MacroSatelliteTargetRow,
  MacroSatelliteTargetState,
  MacroSeriesDataState,
  MacroSeriesLatestRow,
  MacroSignalDirection,
} from '../types'

export const MACRO_STRATEGY_SWR_KEY = 'macro-strategy-v1'
export const MACRO_STRATEGY_REFRESH_MS = 60000

type JsonRecord = Record<string, unknown>

export interface MacroStrategySnapshot {
  schemaState: 'READY' | 'SCHEMA_PENDING'
  series: MacroSeriesLatestRow[]
  regime: MacroRegimeSnapshotRow | null
  targets: MacroSatelliteTargetRow[]
}

const SERIES_SELECTOR = [
  'series_id',
  'as_of_date',
  'name',
  'value',
  'previous_value',
  'change_abs',
  'change_pct',
  'frequency',
  'source_provider',
  'source_url',
  'data_state',
  'reason_codes',
  'collected_at',
  'updated_at',
].join(',')

const REGIME_SELECTOR = [
  'id',
  'as_of_date',
  'regime',
  'regime_state',
  'confidence',
  'growth_signal',
  'inflation_signal',
  'liquidity_signal',
  'growth_score',
  'inflation_score',
  'liquidity_score',
  'evidence',
  'reason_codes',
  'created_at',
  'updated_at',
].join(',')

const TARGET_SELECTOR = [
  'id',
  'snapshot_id',
  'as_of_date',
  'regime',
  'regime_state',
  'regime_confidence',
  'bucket_key',
  'bucket_label',
  'instrument_symbol',
  'instrument_name',
  'target_weight_pct',
  'effective_weight_pct',
  'satellite_weight_pct',
  'recommended_envelope',
  'trend_ticker',
  'trend_state',
  'ma200_status',
  'data_state',
  'is_blocked',
  'reason_codes',
  'updated_at',
].join(',')

const ADVICE_SELECTOR = [
  'portfolio_id',
  'snapshot_id',
  'as_of_date',
  'regime',
  'regime_state',
  'bucket_key',
  'bucket_label',
  'instrument_symbol',
  'instrument_name',
  'recommended_envelope',
  'model_target_weight_pct',
  'target_weight_pct',
  'current_value_eur',
  'current_weight_pct',
  'drift_pct',
  'rebalance_amount_eur',
  'action',
  'confidence',
  'data_state',
  'reason_codes',
  'trend_ticker',
  'trend_state',
  'ma200_status',
  'is_blocked',
  'total_value_eur',
  'updated_at',
].join(',')

function isMissingSchemaError(error: unknown): boolean {
  const message = error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : String(error ?? '')
  return /could not find the table|schema cache|relation .* does not exist|column .* does not exist|PGRST205/i.test(message)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseSeriesState(value: unknown): MacroSeriesDataState {
  if (value === 'READY' || value === 'PARTIAL' || value === 'STALE' || value === 'UNKNOWN' || value === 'MISSING') return value
  return 'UNKNOWN'
}

function parseRegime(value: unknown): MacroRegime {
  if (value === 'REFLATION' || value === 'GOLDILOCKS' || value === 'STAGFLATION' || value === 'DEFLATION' || value === 'UNKNOWN') return value
  return 'UNKNOWN'
}

function parseRegimeState(value: unknown): MacroRegimeState {
  if (value === 'READY' || value === 'PARTIAL' || value === 'STALE' || value === 'UNKNOWN') return value
  return 'UNKNOWN'
}

function parseDirection(value: unknown): MacroSignalDirection {
  if (value === 'UP' || value === 'DOWN' || value === 'UNKNOWN') return value
  return 'UNKNOWN'
}

function parseLiquidity(value: unknown): MacroLiquiditySignal {
  if (value === 'LOOSE' || value === 'NEUTRAL' || value === 'TIGHT' || value === 'UNKNOWN') return value
  return 'UNKNOWN'
}

function parseEnvelope(value: unknown): MacroRecommendedEnvelope {
  if (value === 'CTO' || value === 'PEA' || value === 'PER' || value === 'CASH') return value
  return 'CTO'
}

function parseTargetState(value: unknown): MacroSatelliteTargetState {
  if (
    value === 'READY' ||
    value === 'BLOCKED_TREND' ||
    value === 'TREND_UNKNOWN' ||
    value === 'REGIME_UNKNOWN' ||
    value === 'REGIME_PARTIAL' ||
    value === 'UNKNOWN'
  ) return value
  return 'UNKNOWN'
}

function parseAction(value: unknown): MacroAllocationAction {
  if (value === 'BUY' || value === 'REDUCE' || value === 'HOLD' || value === 'UNAVAILABLE') return value
  return 'UNAVAILABLE'
}

function parseMa200(value: unknown): 'above' | 'below' | null {
  return value === 'above' || value === 'below' ? value : null
}

function parseSeriesRow(raw: JsonRecord): MacroSeriesLatestRow | null {
  const seriesId = readString(raw.series_id)
  const asOfDate = readString(raw.as_of_date)
  const name = readString(raw.name)
  if (!seriesId || !asOfDate || !name) return null
  return {
    series_id: seriesId,
    as_of_date: asOfDate,
    name,
    value: readNumber(raw.value),
    previous_value: readNumber(raw.previous_value),
    change_abs: readNumber(raw.change_abs),
    change_pct: readNumber(raw.change_pct),
    frequency: readString(raw.frequency) ?? 'UNKNOWN',
    source_provider: readString(raw.source_provider) ?? 'unknown',
    source_url: readString(raw.source_url),
    data_state: parseSeriesState(raw.data_state),
    reason_codes: readStringArray(raw.reason_codes),
    collected_at: readString(raw.collected_at),
    updated_at: readString(raw.updated_at),
  }
}

function parseRegimeRow(raw: JsonRecord): MacroRegimeSnapshotRow | null {
  const id = readString(raw.id)
  const asOfDate = readString(raw.as_of_date)
  if (!id || !asOfDate) return null
  return {
    id,
    as_of_date: asOfDate,
    regime: parseRegime(raw.regime),
    regime_state: parseRegimeState(raw.regime_state),
    confidence: readNumber(raw.confidence) ?? 0,
    growth_signal: parseDirection(raw.growth_signal),
    inflation_signal: parseDirection(raw.inflation_signal),
    liquidity_signal: parseLiquidity(raw.liquidity_signal),
    growth_score: readNumber(raw.growth_score),
    inflation_score: readNumber(raw.inflation_score),
    liquidity_score: readNumber(raw.liquidity_score),
    evidence: readObject(raw.evidence),
    reason_codes: readStringArray(raw.reason_codes),
    created_at: readString(raw.created_at),
    updated_at: readString(raw.updated_at),
  }
}

function parseTargetRow(raw: JsonRecord): MacroSatelliteTargetRow | null {
  const id = readString(raw.id)
  const snapshotId = readString(raw.snapshot_id)
  const asOfDate = readString(raw.as_of_date)
  const bucketKey = readString(raw.bucket_key)
  const bucketLabel = readString(raw.bucket_label)
  if (!id || !snapshotId || !asOfDate || !bucketKey || !bucketLabel) return null
  return {
    id,
    snapshot_id: snapshotId,
    as_of_date: asOfDate,
    regime: parseRegime(raw.regime),
    regime_state: parseRegimeState(raw.regime_state),
    regime_confidence: readNumber(raw.regime_confidence) ?? 0,
    bucket_key: bucketKey,
    bucket_label: bucketLabel,
    instrument_symbol: readString(raw.instrument_symbol),
    instrument_name: readString(raw.instrument_name),
    target_weight_pct: readNumber(raw.target_weight_pct) ?? 0,
    effective_weight_pct: readNumber(raw.effective_weight_pct) ?? 0,
    satellite_weight_pct: readNumber(raw.satellite_weight_pct) ?? 0,
    recommended_envelope: parseEnvelope(raw.recommended_envelope),
    trend_ticker: readString(raw.trend_ticker),
    trend_state: readString(raw.trend_state) ?? 'UNKNOWN',
    ma200_status: parseMa200(raw.ma200_status),
    data_state: parseTargetState(raw.data_state),
    is_blocked: raw.is_blocked === true,
    reason_codes: readStringArray(raw.reason_codes),
    updated_at: readString(raw.updated_at),
  }
}

function parseAdviceRow(raw: JsonRecord): MacroAllocationAdviceRow | null {
  const portfolioId = readString(raw.portfolio_id)
  const snapshotId = readString(raw.snapshot_id)
  const asOfDate = readString(raw.as_of_date)
  const bucketKey = readString(raw.bucket_key)
  const bucketLabel = readString(raw.bucket_label)
  if (!portfolioId || !snapshotId || !asOfDate || !bucketKey || !bucketLabel) return null
  return {
    portfolio_id: portfolioId,
    snapshot_id: snapshotId,
    as_of_date: asOfDate,
    regime: parseRegime(raw.regime),
    regime_state: parseRegimeState(raw.regime_state),
    bucket_key: bucketKey,
    bucket_label: bucketLabel,
    instrument_symbol: readString(raw.instrument_symbol),
    instrument_name: readString(raw.instrument_name),
    recommended_envelope: parseEnvelope(raw.recommended_envelope),
    model_target_weight_pct: readNumber(raw.model_target_weight_pct) ?? 0,
    target_weight_pct: readNumber(raw.target_weight_pct) ?? 0,
    current_value_eur: readNumber(raw.current_value_eur),
    current_weight_pct: readNumber(raw.current_weight_pct),
    drift_pct: readNumber(raw.drift_pct),
    rebalance_amount_eur: readNumber(raw.rebalance_amount_eur),
    action: parseAction(raw.action),
    confidence: readNumber(raw.confidence) ?? 0,
    data_state: parseTargetState(raw.data_state),
    reason_codes: readStringArray(raw.reason_codes),
    trend_ticker: readString(raw.trend_ticker),
    trend_state: readString(raw.trend_state) ?? 'UNKNOWN',
    ma200_status: parseMa200(raw.ma200_status),
    is_blocked: raw.is_blocked === true,
    total_value_eur: readNumber(raw.total_value_eur),
    updated_at: readString(raw.updated_at),
  }
}

export async function loadMacroStrategy(supabase: SupabaseClient): Promise<MacroStrategySnapshot> {
  const [seriesResult, regimeResult, targetsResult] = await Promise.all([
    supabase.from('macro_series_latest').select(SERIES_SELECTOR).order('series_id', { ascending: true }),
    supabase.from('macro_regime_snapshots').select(REGIME_SELECTOR).order('as_of_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('macro_satellite_targets_latest').select(TARGET_SELECTOR).order('bucket_key', { ascending: true }),
  ])

  const schemaError = seriesResult.error ?? regimeResult.error ?? targetsResult.error
  if (schemaError && isMissingSchemaError(schemaError)) {
    return { schemaState: 'SCHEMA_PENDING', series: [], regime: null, targets: [] }
  }
  if (seriesResult.error) throw seriesResult.error
  if (regimeResult.error) throw regimeResult.error
  if (targetsResult.error) throw targetsResult.error

  return {
    schemaState: 'READY',
    series: ((seriesResult.data ?? []) as unknown as JsonRecord[])
      .map(parseSeriesRow)
      .filter((row): row is MacroSeriesLatestRow => row !== null),
    regime: regimeResult.data ? parseRegimeRow(regimeResult.data as unknown as JsonRecord) : null,
    targets: ((targetsResult.data ?? []) as unknown as JsonRecord[])
      .map(parseTargetRow)
      .filter((row): row is MacroSatelliteTargetRow => row !== null),
  }
}

export async function loadMacroAllocationAdvice(
  supabase: SupabaseClient,
  portfolioId: string,
): Promise<MacroAllocationAdviceRow[]> {
  const { data, error } = await supabase
    .from('macro_allocation_advice_latest')
    .select(ADVICE_SELECTOR)
    .eq('portfolio_id', portfolioId)
    .order('bucket_key', { ascending: true })
  if (error) {
    if (isMissingSchemaError(error)) return []
    throw error
  }
  return ((data ?? []) as unknown as JsonRecord[])
    .map(parseAdviceRow)
    .filter((row): row is MacroAllocationAdviceRow => row !== null)
}
