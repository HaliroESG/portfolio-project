import type { PortfolioScope, TargetModelRow, TargetBucketRow, TargetSleeveKey, TargetSleeveAllocationRow, TargetEnvelopeLineRow } from '../types'

type RawRow = Record<string, unknown>

function readNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new Error('Target contract contains an invalid row: non-finite or malformed number')
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseScope(value: unknown): PortfolioScope | null {
  if (value === 'PERSO' || value === 'PRO') return value
  return null
}

function parseTargetModel(raw: RawRow): TargetModelRow | null {
  const id = readString(raw.id)
  const modelName = readString(raw.model_name)
  const sourceFile = readString(raw.source_file)
  const portfolioScope = parseScope(raw.portfolio_scope)
  if (!id || !modelName || !sourceFile || !portfolioScope) return null
  return {
    id,
    portfolio_scope: portfolioScope,
    model_name: modelName,
    source_file: sourceFile,
    source_kind: readString(raw.source_kind) ?? 'unknown',
    as_of_date: readString(raw.as_of_date),
    is_active: raw.is_active === true,
    target_total_pct: readNumber(raw.target_total_pct as number | string | null),
    allocation_contract_version: readString(raw.allocation_contract_version),
    reserve_floor_eur: readNumber(raw.reserve_floor_eur as number | string | null),
    reserve_excluded_from_risky_allocation: raw.reserve_excluded_from_risky_allocation === true,
    status: readString(raw.status) ?? 'UNKNOWN',
    report_json: raw.report_json && typeof raw.report_json === 'object' && !Array.isArray(raw.report_json)
      ? raw.report_json as Record<string, unknown>
      : {},
    imported_at: readString(raw.imported_at) ?? '',
    updated_at: readString(raw.updated_at) ?? '',
  }
}

function parseTargetSleeveKey(value: unknown): TargetSleeveKey | null {
  return value === 'CORE' || value === 'SATELLITE' ? value : null
}

function parseTargetSleeveAllocation(raw: RawRow): TargetSleeveAllocationRow | null {
  const id = readNumber(raw.id as number | string | null)
  const modelId = readString(raw.model_id)
  const sleeveKey = parseTargetSleeveKey(raw.sleeve_key)
  const componentLabel = readString(raw.component_label)
  const bucketKey = readString(raw.bucket_key)
  const bucketLabel = readString(raw.bucket_label)
  const targetWeight = readNumber(raw.target_weight_pct as number | string | null)
  const portfolioScope = parseScope(raw.portfolio_scope)
  if (id === null || !modelId || !portfolioScope || !sleeveKey || !componentLabel || !bucketKey || !bucketLabel || targetWeight === null) return null
  return {
    id,
    model_id: modelId,
    portfolio_scope: portfolioScope,
    sleeve_key: sleeveKey,
    component_label: componentLabel,
    bucket_key: bucketKey,
    bucket_label: bucketLabel,
    target_weight_pct: targetWeight,
    instrument_policy: readString(raw.instrument_policy),
    activation_status: readString(raw.activation_status) ?? 'UNKNOWN',
    source_sheet: readString(raw.source_sheet),
    source_row: readNumber(raw.source_row as number | string | null),
    updated_at: readString(raw.updated_at) ?? '',
  }
}

function parseTargetBucket(raw: RawRow): TargetBucketRow | null {
  const id = readNumber(raw.id as number | string | null)
  const modelId = readString(raw.model_id)
  const bucketKey = readString(raw.bucket_key)
  const bucketLabel = readString(raw.bucket_label)
  const targetWeight = readNumber(raw.target_weight_pct as number | string | null)
  const lowerBand = readNumber(raw.lower_band_pct as number | string | null)
  const upperBand = readNumber(raw.upper_band_pct as number | string | null)
  const lowerBandProvided = raw.lower_band_pct !== null && raw.lower_band_pct !== undefined
  const upperBandProvided = raw.upper_band_pct !== null && raw.upper_band_pct !== undefined
  const portfolioScope = parseScope(raw.portfolio_scope)
  if (id === null
    || !modelId
    || !portfolioScope
    || !bucketKey
    || !bucketLabel
    || targetWeight === null
    || (lowerBandProvided && lowerBand === null)
    || (upperBandProvided && upperBand === null)
  ) return null
  return {
    id,
    model_id: modelId,
    portfolio_scope: portfolioScope,
    bucket_key: bucketKey,
    bucket_label: bucketLabel,
    parent_bucket_key: readString(raw.parent_bucket_key),
    target_weight_pct: targetWeight,
    lower_band_pct: lowerBand,
    upper_band_pct: upperBand,
    source_sheet: readString(raw.source_sheet),
    source_row: readNumber(raw.source_row as number | string | null),
    updated_at: readString(raw.updated_at) ?? '',
  }
}

function parseTargetEnvelopeLine(raw: RawRow): TargetEnvelopeLineRow | null {
  const id = readNumber(raw.id as number | string | null)
  const modelId = readString(raw.model_id)
  const envelope = readString(raw.envelope)
  const portfolioScope = parseScope(raw.portfolio_scope)
  if (id === null || !modelId || !portfolioScope || !envelope) return null
  return {
    id,
    model_id: modelId,
    portfolio_scope: portfolioScope,
    envelope,
    ticker: readString(raw.ticker),
    isin: readString(raw.isin),
    instrument: readString(raw.instrument),
    asset_class: readString(raw.asset_class),
    region: readString(raw.region),
    currency: readString(raw.currency),
    target_weight_pct: readNumber(raw.target_weight_pct as number | string | null),
    target_value_eur: readNumber(raw.target_value_eur as number | string | null),
    notes: readString(raw.notes),
    source_sheet: readString(raw.source_sheet),
    source_row: readNumber(raw.source_row as number | string | null),
    updated_at: readString(raw.updated_at) ?? '',
  }
}

// Never discard malformed rows: doing so can turn an invalid complete contract
// into an apparently valid subset, or select an older model silently.
function parseRows<T>(rawRows: unknown, parse: (raw: RawRow) => T | null): T[] {
  if (!Array.isArray(rawRows)) throw new Error('Target contract contains an invalid row collection')
  return rawRows.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Target contract contains an invalid row')
    const row = parse(raw)
    if (row === null) throw new Error('Target contract contains an invalid row')
    return row
  })
}

export const parseTargetModels = (rows: unknown): TargetModelRow[] => parseRows(rows, parseTargetModel)
export const parseTargetBuckets = (rows: unknown): TargetBucketRow[] => parseRows(rows, parseTargetBucket)
export const parseTargetSleeves = (rows: unknown): TargetSleeveAllocationRow[] => parseRows(rows, parseTargetSleeveAllocation)
export const parseTargetEnvelopeLines = (rows: unknown): TargetEnvelopeLineRow[] => parseRows(rows, parseTargetEnvelopeLine)
export const parseTargetPortfolios = (rows: unknown) => parseRows(rows, (raw) => {
  const id = readString(raw.id)
  if (!id) return null
  return { id, name: readString(raw.name), portfolio_type: readString(raw.portfolio_type) }
})
