import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  FamilyOfficeAccountRow,
  FamilyOfficeCashRow,
  FamilyOfficeDataState,
  FamilyOfficeEnvelope,
  FamilyOfficePositionRow,
  PortfolioScope,
  PortfolioDecisionItemRow,
  TargetEnvelopeLineRow,
  TargetModelRow,
  TargetSleeveAllocationRow,
} from '../types'

const POSITION_COLUMNS = 'id,owner_user_id,portfolio_id,account_id,instrument_id,instrument_key,isin,ticker,name,instrument_type,currency,snapshot_date,quantity,average_cost,cost_basis_eur,price_local,fx_rate_to_eur,market_value_eur,unrealized_pnl_eur,data_state,price_as_of,fx_as_of,reconciliation_state,calculated_at'
const CASH_COLUMNS = 'id,owner_user_id,portfolio_id,account_id,balance_date,currency,balance_local,fx_rate_to_eur,balance_eur,data_state,calculated_at'
const ACCOUNT_COLUMNS = 'id,owner_user_id,portfolio_id,institution_id,external_account_id,name,envelope,base_currency,status,opened_on,closed_on,created_at,updated_at'

type ReconciliationState = 'MATCH' | 'MISMATCH' | 'NOT_CHECKED'
type ValuationState = 'READY' | 'STALE' | 'MISSING'

export interface FamilyOfficeAllocationSourceAccount {
  account_id: string
  external_account_id: string | null
  account_name: string
  envelope: FamilyOfficeEnvelope
  as_of_date: string
  price_as_of: string | null
  fx_as_of: string | null
  quantity: number
  value_eur: number | null
  data_state: FamilyOfficeDataState
  valuation_state: ValuationState
  reconciliation_state: ReconciliationState
}

export interface FamilyOfficeAllocationRow {
  row_key: string
  portfolio_id: string
  instrument_key: string
  isin: string | null
  ticker: string
  name: string
  instrument_type: string
  currency: string
  envelope: FamilyOfficeEnvelope
  current_quantity: number
  current_value_eur: number | null
  price_local: number | null
  fx_rate_to_eur: number | null
  data_state: FamilyOfficeDataState
  valuation_state: ValuationState
  reconciliation_state: ReconciliationState
  as_of_date: string
  updated_at: string
  source_accounts: FamilyOfficeAllocationSourceAccount[]
}

export interface FamilyOfficeAllocationAssessmentRow extends FamilyOfficeAllocationRow {
  target_weight_pct: number | null
  current_weight_pct: number | null
  drift_pct: number | null
  rebalance_amount_eur: number | null
  action: PortfolioDecisionItemRow['action']
  confidence: number
  reason_codes: string[]
  target_line_id: number | null
}

export interface FamilyOfficeAllocationAssessment {
  rows: FamilyOfficeAllocationAssessmentRow[]
  total_value_eur: number | null
  target_total_pct: number | null
  target_model_ready: boolean
}

export interface FamilyOfficeAllocationAssessmentOptions {
  expectedScope: PortfolioScope
  targetSleeves?: TargetSleeveAllocationRow[]
  referenceDate?: string
}

interface FamilyOfficeAllocationSource {
  positions: FamilyOfficePositionRow[]
  cash: FamilyOfficeCashRow[]
  accounts: FamilyOfficeAccountRow[]
}

interface MutableAllocationRow extends FamilyOfficeAllocationRow {
  value_incomplete: boolean
  price_values: number[]
  fx_values: number[]
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? ''
}

function oldest(left: string, right: string): string {
  return left <= right ? left : right
}

function newest(left: string, right: string): string {
  return left >= right ? left : right
}

function worstDataState(left: FamilyOfficeDataState, right: FamilyOfficeDataState): FamilyOfficeDataState {
  const rank: Record<FamilyOfficeDataState, number> = {
    READY: 0,
    PARTIAL: 1,
    STALE: 2,
    UNRECONCILED: 3,
    MISSING: 4,
  }
  return rank[right] > rank[left] ? right : left
}

function worstReconciliation(left: ReconciliationState, right: ReconciliationState): ReconciliationState {
  const rank: Record<ReconciliationState, number> = { MATCH: 0, NOT_CHECKED: 1, MISMATCH: 2 }
  return rank[right] > rank[left] ? right : left
}

function worstValuationState(left: ValuationState, right: ValuationState): ValuationState {
  const rank: Record<ValuationState, number> = { READY: 0, STALE: 1, MISSING: 2 }
  return rank[right] > rank[left] ? right : left
}

function positionValuationState(
  snapshotDate: string,
  priceAsOf: string | null,
  fxAsOf: string | null,
): ValuationState {
  if (!priceAsOf || !fxAsOf) return 'MISSING'
  const snapshot = Date.parse(`${snapshotDate}T00:00:00Z`)
  const price = Date.parse(`${priceAsOf}T00:00:00Z`)
  const fx = Date.parse(`${fxAsOf}T00:00:00Z`)
  if (![snapshot, price, fx].every(Number.isFinite)) return 'MISSING'
  const oldestValuation = Math.min(price, fx)
  return snapshot - oldestValuation > 7 * 24 * 60 * 60 * 1000 ? 'STALE' : 'READY'
}

function valuationStateAt(
  row: FamilyOfficeAllocationRow,
  referenceDate: string,
): ValuationState {
  const reference = Date.parse(`${referenceDate}T00:00:00Z`)
  if (!Number.isFinite(reference)) return 'MISSING'
  let state = row.valuation_state
  for (const account of row.source_accounts) {
    const dates = [account.as_of_date, account.price_as_of, account.fx_as_of]
    if (dates.some((value) => !value)) return 'MISSING'
    for (const value of dates) {
      const timestamp = Date.parse(`${value}T00:00:00Z`)
      if (!Number.isFinite(timestamp)) return 'MISSING'
      if (reference - timestamp > 3 * 24 * 60 * 60 * 1000) state = worstValuationState(state, 'STALE')
    }
  }
  return state
}

function commonValue(values: number[]): number | null {
  if (values.length === 0) return null
  const first = values[0]
  return values.every((value) => Math.abs(value - first) <= Math.max(1, Math.abs(first)) * 1e-9) ? first : null
}

function finalizeAllocationRow(row: MutableAllocationRow): FamilyOfficeAllocationRow {
  return {
    row_key: row.row_key,
    portfolio_id: row.portfolio_id,
    instrument_key: row.instrument_key,
    isin: row.isin,
    ticker: row.ticker,
    name: row.name,
    instrument_type: row.instrument_type,
    currency: row.currency,
    envelope: row.envelope,
    current_quantity: row.current_quantity,
    current_value_eur: row.current_value_eur,
    price_local: row.price_local,
    fx_rate_to_eur: row.fx_rate_to_eur,
    data_state: row.data_state,
    valuation_state: row.valuation_state,
    reconciliation_state: row.reconciliation_state,
    as_of_date: row.as_of_date,
    updated_at: row.updated_at,
    source_accounts: row.source_accounts,
  }
}

export async function loadFamilyOfficeAllocationSource(
  supabase: SupabaseClient,
  portfolioId: string,
): Promise<FamilyOfficeAllocationSource> {
  const [positions, cash, accounts] = await Promise.all([
    supabase.from('fo_positions_latest').select(POSITION_COLUMNS).eq('portfolio_id', portfolioId),
    supabase.from('fo_cash_balances_latest').select(CASH_COLUMNS).eq('portfolio_id', portfolioId),
    supabase.from('fo_accounts').select(ACCOUNT_COLUMNS).eq('portfolio_id', portfolioId),
  ])

  const error = positions.error ?? cash.error ?? accounts.error
  if (error) throw error

  return {
    positions: (positions.data ?? []) as FamilyOfficePositionRow[],
    cash: (cash.data ?? []) as FamilyOfficeCashRow[],
    accounts: (accounts.data ?? []) as FamilyOfficeAccountRow[],
  }
}

export function buildFamilyOfficeAllocationRows(source: FamilyOfficeAllocationSource): FamilyOfficeAllocationRow[] {
  const accounts = new Map(source.accounts.map((account) => [account.id, account]))
  const grouped = new Map<string, MutableAllocationRow>()

  for (const position of source.positions) {
    const account = accounts.get(position.account_id)
    const envelope = account?.envelope ?? 'OTHER'
    const key = `${position.instrument_key}|${position.account_id}`
    const quantity = asNumber(position.quantity) ?? 0
    const value = asNumber(position.market_value_eur)
    const price = asNumber(position.price_local)
    const fx = asNumber(position.fx_rate_to_eur)
    const reconciliation = position.reconciliation_state
    const valuationState = positionValuationState(position.snapshot_date, position.price_as_of, position.fx_as_of)
    const sourceAccount: FamilyOfficeAllocationSourceAccount = {
      account_id: position.account_id,
      external_account_id: account?.external_account_id ?? null,
      account_name: account?.name ?? position.account_id,
      envelope,
      as_of_date: position.snapshot_date,
      price_as_of: position.price_as_of,
      fx_as_of: position.fx_as_of,
      quantity,
      value_eur: value,
      data_state: position.data_state,
      valuation_state: valuationState,
      reconciliation_state: reconciliation,
    }
    const current = grouped.get(key)
    if (!current) {
      grouped.set(key, {
        row_key: key,
        portfolio_id: position.portfolio_id,
        instrument_key: position.instrument_key,
        isin: position.isin,
        ticker: position.ticker ?? position.instrument_key,
        name: position.name,
        instrument_type: position.instrument_type,
        currency: position.currency,
        envelope,
        current_quantity: quantity,
        current_value_eur: value,
        price_local: price,
        fx_rate_to_eur: fx,
        data_state: position.data_state,
        valuation_state: valuationState,
        reconciliation_state: reconciliation,
        as_of_date: position.snapshot_date,
        updated_at: position.calculated_at,
        source_accounts: [sourceAccount],
        value_incomplete: value === null,
        price_values: price === null ? [] : [price],
        fx_values: fx === null ? [] : [fx],
      })
      continue
    }

    current.current_quantity += quantity
    current.value_incomplete ||= value === null
    current.current_value_eur = current.value_incomplete ? null : (current.current_value_eur ?? 0) + (value ?? 0)
    current.data_state = worstDataState(current.data_state, position.data_state)
    current.valuation_state = worstValuationState(current.valuation_state, valuationState)
    current.reconciliation_state = worstReconciliation(current.reconciliation_state, reconciliation)
    current.as_of_date = oldest(current.as_of_date, position.snapshot_date)
    current.updated_at = newest(current.updated_at, position.calculated_at)
    current.source_accounts.push(sourceAccount)
    if (price !== null) current.price_values.push(price)
    if (fx !== null) current.fx_values.push(fx)
    current.price_local = commonValue(current.price_values)
    current.fx_rate_to_eur = commonValue(current.fx_values)
  }

  for (const cash of source.cash) {
    const account = accounts.get(cash.account_id)
    const envelope = account?.envelope ?? 'CASH'
    const currency = normalize(cash.currency) || 'EUR'
    const instrumentKey = `cash:${currency}`
    const key = `${instrumentKey}|${cash.account_id}`
    const quantity = asNumber(cash.balance_local) ?? 0
    const value = asNumber(cash.balance_eur)
    const fx = asNumber(cash.fx_rate_to_eur)
    const valuationState: ValuationState = cash.data_state === 'MISSING'
      ? 'MISSING'
      : cash.data_state === 'STALE'
        ? 'STALE'
        : 'READY'
    const sourceAccount: FamilyOfficeAllocationSourceAccount = {
      account_id: cash.account_id,
      external_account_id: account?.external_account_id ?? null,
      account_name: account?.name ?? cash.account_id,
      envelope,
      as_of_date: cash.balance_date,
      price_as_of: cash.balance_date,
      fx_as_of: cash.balance_date,
      quantity,
      value_eur: value,
      data_state: cash.data_state,
      valuation_state: valuationState,
      reconciliation_state: 'NOT_CHECKED',
    }
    const current = grouped.get(key)
    if (!current) {
      grouped.set(key, {
        row_key: key,
        portfolio_id: cash.portfolio_id,
        instrument_key: instrumentKey,
        isin: null,
        ticker: `CASH_${currency}`,
        name: `Cash ${currency}`,
        instrument_type: 'CASH',
        currency,
        envelope,
        current_quantity: quantity,
        current_value_eur: value,
        price_local: 1,
        fx_rate_to_eur: fx,
        data_state: cash.data_state,
        valuation_state: valuationState,
        reconciliation_state: 'NOT_CHECKED',
        as_of_date: cash.balance_date,
        updated_at: cash.calculated_at,
        source_accounts: [sourceAccount],
        value_incomplete: value === null,
        price_values: [1],
        fx_values: fx === null ? [] : [fx],
      })
      continue
    }

    current.current_quantity += quantity
    current.value_incomplete ||= value === null
    current.current_value_eur = current.value_incomplete ? null : (current.current_value_eur ?? 0) + (value ?? 0)
    current.data_state = worstDataState(current.data_state, cash.data_state)
    current.valuation_state = worstValuationState(current.valuation_state, valuationState)
    current.as_of_date = oldest(current.as_of_date, cash.balance_date)
    current.updated_at = newest(current.updated_at, cash.calculated_at)
    current.source_accounts.push(sourceAccount)
    if (fx !== null) current.fx_values.push(fx)
    current.fx_rate_to_eur = commonValue(current.fx_values)
  }

  return Array.from(grouped.values())
    .map(finalizeAllocationRow)
    .sort((left, right) => left.envelope.localeCompare(right.envelope, 'en') || left.name.localeCompare(right.name, 'en'))
}

const TARGET_ENVELOPE_QUALIFIERS = new Set(['CORE', 'POSTARB', 'POST', 'ARB'])
const ALLOCATION_CONTRACT_VERSION = 'allocation_contracts_v1'
const PRO_SLEEVE_WEIGHTS = new Map<string, number>([
  ['CORE:actions_us', 28],
  ['CORE:actions_europe', 12],
  ['CORE:actions_japan', 7],
  ['CORE:actions_pacific_ex_japan', 4],
  ['CORE:actions_emerging', 9],
  ['CORE:gold', 10],
  ['SATELLITE:actions_us', 13],
  ['SATELLITE:actions_europe', 6],
  ['SATELLITE:actions_japan', 3],
  ['SATELLITE:actions_pacific_ex_japan', 1],
  ['SATELLITE:actions_emerging', 7],
])

function targetModelContractReady(
  targetModel: TargetModelRow | null,
  targetSleeves: TargetSleeveAllocationRow[],
  expectedScope: PortfolioScope,
): boolean {
  if (!targetModel
    || !targetModel.is_active
    || targetModel.status !== 'READY'
    || targetModel.allocation_contract_version !== ALLOCATION_CONTRACT_VERSION
    || targetModel.portfolio_scope !== expectedScope
    || targetModel.target_total_pct === null
    || Math.abs(targetModel.target_total_pct - 100) > 0.05
  ) return false

  if (expectedScope === 'PERSO') return true
  if (targetModel.reserve_excluded_from_risky_allocation !== true
    || targetModel.reserve_floor_eur === null
    || Math.abs(targetModel.reserve_floor_eur - 120000) > 0.01
    || targetSleeves.length !== PRO_SLEEVE_WEIGHTS.size
  ) return false

  const observed = new Map<string, number>()
  for (const row of targetSleeves) {
    if (row.model_id !== targetModel.id || row.portfolio_scope !== 'PRO') return false
    const key = `${row.sleeve_key}:${row.bucket_key}`
    if (observed.has(key) || !PRO_SLEEVE_WEIGHTS.has(key)) return false
    observed.set(key, row.target_weight_pct)
  }
  return Array.from(PRO_SLEEVE_WEIGHTS.entries()).every(([key, expected]) => {
    const actual = observed.get(key)
    return actual !== undefined && Math.abs(actual - expected) <= 0.05
  })
}

function envelopeTokens(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length > 0 && !TARGET_ENVELOPE_QUALIFIERS.has(token))
}

function accountMatchesTargetEnvelope(account: FamilyOfficeAllocationSourceAccount, envelope: string): boolean {
  const exactCandidates = [account.account_id, account.external_account_id, account.account_name, account.envelope]
  if (exactCandidates.some((candidate) => candidate && normalize(candidate) === normalize(envelope))) return true

  const targetTokens = envelopeTokens(envelope)
  if (targetTokens.length === 0) return false
  return [account.external_account_id, account.account_name].some((candidate) => {
    if (!candidate) return false
    const candidateTokens = new Set(envelopeTokens(candidate))
    return targetTokens.every((token) => candidateTokens.has(token))
  })
}

function targetMatches(row: FamilyOfficeAllocationRow, line: TargetEnvelopeLineRow): boolean {
  if (!row.source_accounts.some((account) => accountMatchesTargetEnvelope(account, line.envelope))) return false
  if (row.isin && line.isin) return normalize(row.isin) === normalize(line.isin)
  if (line.ticker && normalize(row.ticker) === normalize(line.ticker)) return true
  return row.instrument_type === 'CASH'
    && normalize(line.asset_class) === 'CASH'
    && normalize(line.currency) === normalize(row.currency)
}

function actionFor(driftPct: number, amountEur: number, targetPct: number, currentValueEur: number): PortfolioDecisionItemRow['action'] {
  if (targetPct === 0 && currentValueEur >= 100) return 'EXIT'
  if (driftPct <= -3 && amountEur >= 100) return 'BUY'
  if (driftPct >= 3 && amountEur <= -100) return 'REDUCE'
  return 'HOLD'
}

export function assessFamilyOfficeAllocation(
  allocationRows: FamilyOfficeAllocationRow[],
  targetModel: TargetModelRow | null,
  targetLines: TargetEnvelopeLineRow[],
  options: FamilyOfficeAllocationAssessmentOptions,
): FamilyOfficeAllocationAssessment {
  const targetSleeves = options.targetSleeves ?? []
  const referenceDate = options.referenceDate ?? new Date().toISOString().slice(0, 10)
  const targetTotal = targetModel?.target_total_pct ?? null
  const targetModelReady = targetModelContractReady(targetModel, targetSleeves, options.expectedScope)
  const portfolioValueComplete = allocationRows.length > 0 && allocationRows.every((row) => row.current_value_eur !== null)
  const totalValue = portfolioValueComplete
    ? allocationRows.reduce((sum, row) => sum + (row.current_value_eur ?? 0), 0)
    : null
  const matchesByRow = new Map(
    allocationRows.map((row) => [row.row_key, targetLines.filter((line) => targetMatches(row, line))]),
  )
  const targetWeightIsValid = (line: TargetEnvelopeLineRow): boolean => {
    const weight = line.target_weight_pct
    return weight !== null && Number.isFinite(weight) && weight >= 0 && weight <= 100
  }
  const envelopeLines = new Map<string, TargetEnvelopeLineRow[]>()
  for (const line of targetLines) {
    const key = normalize(line.envelope)
    envelopeLines.set(key, [...(envelopeLines.get(key) ?? []), line])
  }
  const envelopeTargetsValid = envelopeLines.size > 0
    && Array.from(envelopeLines.values()).every((lines) => (
      lines.every(targetWeightIsValid)
      && Math.abs(lines.reduce((sum, line) => sum + (line.target_weight_pct ?? 0), 0) - 100) <= 0.05
    ))
  const targetCoverageReady = targetModelReady
    && targetModel !== null
    && targetLines.every((line) => line.model_id === targetModel.id && line.portfolio_scope === options.expectedScope)
    && envelopeTargetsValid
    && allocationRows.every((row) => {
      const matches = matchesByRow.get(row.row_key) ?? []
      return matches.length === 1 && targetWeightIsValid(matches[0])
    })
    && targetLines
      .filter((line) => (line.target_weight_pct ?? 0) > 0)
      .every((line) => allocationRows.filter((row) => targetMatches(row, line)).length === 1)

  const rows = allocationRows.map((row): FamilyOfficeAllocationAssessmentRow => {
    const matches = matchesByRow.get(row.row_key) ?? []
    const targetLine = matches.length === 1 ? matches[0] : null
    const targetWeight = targetLine?.target_weight_pct ?? null
    const targetEnvelopeKey = targetLine ? normalize(targetLine.envelope) : null
    const envelopeRows = targetEnvelopeKey === null
      ? []
      : allocationRows.filter((candidate) => {
        const candidateMatches = matchesByRow.get(candidate.row_key) ?? []
        return candidateMatches.length === 1 && normalize(candidateMatches[0].envelope) === targetEnvelopeKey
      })
    const envelopeValueComplete = envelopeRows.length > 0 && envelopeRows.every((candidate) => candidate.current_value_eur !== null)
    const envelopeValue = envelopeValueComplete
      ? envelopeRows.reduce((sum, candidate) => sum + (candidate.current_value_eur ?? 0), 0)
      : null
    const currentWeight = envelopeValue !== null && envelopeValue > 0 && row.current_value_eur !== null
      ? row.current_value_eur / envelopeValue * 100
      : null
    const drift = currentWeight !== null && targetWeight !== null ? currentWeight - targetWeight : null
    const amount = envelopeValue !== null && row.current_value_eur !== null && targetWeight !== null
      ? targetWeight / 100 * envelopeValue - row.current_value_eur
      : null
    const effectiveValuationState = valuationStateAt(row, referenceDate)
    const reasons: string[] = []

    if (!targetModel) reasons.push('TARGET_MODEL_MISSING')
    else if (!targetModelReady) reasons.push('TARGET_MODEL_INVALID')
    else if (!targetCoverageReady) reasons.push('TARGET_COVERAGE_INCOMPLETE')
    if (matches.length === 0) reasons.push('TARGET_LINE_MISSING')
    if (matches.length > 1) reasons.push('TARGET_LINE_AMBIGUOUS')
    if (targetLine && targetWeight === null) reasons.push('TARGET_WEIGHT_MISSING')
    if (targetLine && targetWeight !== null && !targetWeightIsValid(targetLine)) reasons.push('TARGET_WEIGHT_INVALID')
    if (targetLine && !envelopeTargetsValid) reasons.push('TARGET_ENVELOPE_TOTAL_INVALID')
    if (!portfolioValueComplete || totalValue === null || totalValue <= 0) reasons.push('PORTFOLIO_VALUE_INCOMPLETE')
    if (targetLine && (!envelopeValueComplete || envelopeValue === null || envelopeValue <= 0)) reasons.push('TARGET_ENVELOPE_VALUE_INCOMPLETE')
    if (row.current_value_eur === null) reasons.push('CURRENT_VALUE_MISSING')
    if (row.data_state !== 'READY') reasons.push(`SOURCE_${row.data_state}`)
    if (effectiveValuationState !== 'READY') reasons.push(`VALUATION_${effectiveValuationState}`)
    if (row.reconciliation_state !== 'MATCH' && row.instrument_type !== 'CASH') {
      reasons.push(`RECONCILIATION_${row.reconciliation_state}`)
    }

    const action = reasons.length === 0 && drift !== null && amount !== null && targetWeight !== null && row.current_value_eur !== null
      ? actionFor(drift, amount, targetWeight, row.current_value_eur)
      : 'UNAVAILABLE'
    return {
      ...row,
      valuation_state: effectiveValuationState,
      target_weight_pct: targetWeight,
      current_weight_pct: currentWeight,
      drift_pct: drift,
      rebalance_amount_eur: amount,
      action,
      confidence: action === 'UNAVAILABLE' ? 0 : 100,
      reason_codes: reasons,
      target_line_id: targetLine?.id ?? null,
    }
  })

  return {
    rows,
    total_value_eur: totalValue,
    target_total_pct: targetTotal,
    target_model_ready: targetCoverageReady,
  }
}

export function toPortfolioDecisionRows(assessment: FamilyOfficeAllocationAssessment): PortfolioDecisionItemRow[] {
  return assessment.rows.map((row) => ({
    portfolio_id: row.portfolio_id,
    ticker: row.ticker,
    name: `${row.name} · ${row.envelope}`,
    asset_class: row.instrument_type,
    isin: row.isin,
    currency: row.currency,
    current_quantity: row.current_quantity,
    current_value_eur: row.current_value_eur,
    current_weight_pct: row.current_weight_pct,
    target_weight_pct: row.target_weight_pct,
    drift_pct: row.drift_pct,
    rebalance_amount_eur: row.rebalance_amount_eur,
    action: row.action,
    confidence: row.confidence,
    reason_codes: row.reason_codes,
    data_state: row.current_value_eur === null || assessment.total_value_eur === null
      ? 'PRICE_MISSING'
      : row.target_weight_pct === null
        ? 'TARGET_MISSING'
        : !assessment.target_model_ready
          ? 'TARGET_INVALID'
          : row.data_state !== 'READY' || row.valuation_state !== 'READY' || (row.instrument_type !== 'CASH' && row.reconciliation_state !== 'MATCH')
            ? 'SOURCE_NOT_READY'
            : 'READY',
    price_state: row.current_value_eur === null || row.valuation_state === 'MISSING'
      ? 'MISSING'
      : row.data_state === 'STALE' || row.valuation_state === 'STALE'
        ? 'STALE'
        : 'LIVE',
    market_data_status: row.data_state,
    reconciliation_state: row.reconciliation_state === 'MATCH'
      ? 'MATCH'
      : row.reconciliation_state === 'NOT_CHECKED'
        ? 'NOT_CHECKED'
        : 'MISMATCH',
    trident_provider_symbol: null,
    trident_score: null,
    trident_confidence: null,
    history_coverage_pct: null,
    target_total_pct: assessment.target_total_pct,
    total_value_eur: assessment.total_value_eur,
    updated_at: row.updated_at,
  }))
}
