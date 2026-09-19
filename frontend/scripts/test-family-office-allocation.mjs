import assert from 'node:assert/strict'

const {
  assessFamilyOfficeAllocation,
  buildFamilyOfficeAllocationRows,
  toPortfolioDecisionRows,
} = await import('../lib/familyOfficeAllocation.ts')

const accounts = [
  { id: 'a1', name: 'PEA 1', envelope: 'PEA' },
  { id: 'a2', name: 'PEA 2', envelope: 'PEA' },
  { id: 'a3', name: 'Cash', envelope: 'CASH' },
]

const position = (overrides = {}) => ({
  id: 'p1',
  owner_user_id: 'owner',
  portfolio_id: 'portfolio',
  account_id: 'a1',
  instrument_id: 'i1',
  instrument_key: 'isin:FR0000000001',
  isin: 'FR0000000001',
  ticker: 'ETF1',
  name: 'ETF One',
  instrument_type: 'ETF',
  currency: 'EUR',
  snapshot_date: '2026-09-18',
  quantity: 1,
  average_cost: 90,
  cost_basis_eur: 90,
  price_local: 100,
  fx_rate_to_eur: 1,
  market_value_eur: 100,
  unrealized_pnl_eur: 10,
  data_state: 'READY',
  price_as_of: '2026-09-18',
  fx_as_of: '2026-09-18',
  reconciliation_state: 'MATCH',
  calculated_at: '2026-09-18T12:00:00Z',
  ...overrides,
})

const cash = (overrides = {}) => ({
  id: 'c1',
  owner_user_id: 'owner',
  portfolio_id: 'portfolio',
  account_id: 'a3',
  balance_date: '2026-09-18',
  currency: 'EUR',
  balance_local: 500,
  fx_rate_to_eur: 1,
  balance_eur: 500,
  data_state: 'READY',
  calculated_at: '2026-09-18T12:00:00Z',
  ...overrides,
})

const model = (overrides = {}) => ({
  id: 'model-1',
  portfolio_scope: 'PERSO',
  model_name: 'Model',
  source_file: 'targets.xlsx',
  source_kind: 'test',
  as_of_date: '2026-09-18',
  is_active: true,
  target_total_pct: 100,
  status: 'READY',
  report_json: {},
  imported_at: '2026-09-18T12:00:00Z',
  updated_at: '2026-09-18T12:00:00Z',
  ...overrides,
})

const target = (overrides = {}) => ({
  id: 1,
  model_id: 'model-1',
  portfolio_scope: 'PERSO',
  envelope: 'PEA',
  ticker: 'ETF1',
  isin: 'FR0000000001',
  instrument: 'ETF One',
  asset_class: 'ETF',
  region: null,
  currency: 'EUR',
  target_weight_pct: 37.5,
  target_value_eur: null,
  notes: null,
  source_sheet: 'Targets',
  source_row: 2,
  updated_at: '2026-09-18T12:00:00Z',
  ...overrides,
})

const source = {
  accounts,
  positions: [
    position(),
    position({ id: 'p2', account_id: 'a2', quantity: 2, market_value_eur: 200 }),
  ],
  cash: [cash()],
}

const rows = buildFamilyOfficeAllocationRows(source)
assert.equal(rows.length, 2)
assert.equal(rows[0].ticker, 'CASH_EUR')
assert.equal(rows[0].current_value_eur, 500)
assert.equal(rows[1].ticker, 'ETF1')
assert.equal(rows[1].current_quantity, 3)
assert.equal(rows[1].current_value_eur, 300)
assert.equal(rows[1].source_accounts.length, 2)

const lines = [
  target(),
  target({ id: 2, envelope: 'CASH', ticker: 'CASH_EUR', isin: null, instrument: 'Cash EUR', asset_class: 'CASH', target_weight_pct: 62.5 }),
]
const ready = assessFamilyOfficeAllocation(rows, model(), lines)
assert.equal(ready.total_value_eur, 800)
assert.equal(ready.target_model_ready, true)
assert.deepEqual(ready.rows.map((row) => row.action), ['HOLD', 'HOLD'])
assert.deepEqual(ready.rows.map((row) => row.reason_codes), [[], []])

const noTargets = assessFamilyOfficeAllocation(rows, null, [])
assert.ok(noTargets.rows.every((row) => row.action === 'UNAVAILABLE'))
assert.ok(noTargets.rows.every((row) => row.reason_codes.includes('TARGET_MODEL_MISSING')))
assert.ok(noTargets.rows.every((row) => row.reason_codes.includes('TARGET_LINE_MISSING')))

const missingHolding = assessFamilyOfficeAllocation(rows, model(), [
  ...lines,
  target({ id: 4, ticker: 'ETF2', isin: 'FR0000000002', target_weight_pct: 10 }),
])
assert.equal(missingHolding.target_model_ready, false)
assert.ok(missingHolding.rows.every((row) => row.action === 'UNAVAILABLE'))
assert.ok(missingHolding.rows.every((row) => row.reason_codes.includes('TARGET_COVERAGE_INCOMPLETE')))

const invalidModel = assessFamilyOfficeAllocation(rows, model({ target_total_pct: 90 }), lines)
assert.ok(invalidModel.rows.every((row) => row.action === 'UNAVAILABLE'))
assert.ok(invalidModel.rows.every((row) => row.reason_codes.includes('TARGET_MODEL_INVALID')))

const missingWeight = assessFamilyOfficeAllocation(rows, model(), [
  target({ target_weight_pct: null }),
  lines[1],
])
assert.equal(missingWeight.target_model_ready, false)
assert.equal(missingWeight.rows.find((row) => row.ticker === 'ETF1')?.action, 'UNAVAILABLE')
assert.ok(missingWeight.rows.find((row) => row.ticker === 'ETF1')?.reason_codes.includes('TARGET_WEIGHT_MISSING'))

const ambiguous = assessFamilyOfficeAllocation(rows, model(), [...lines, target({ id: 3 })])
const ambiguousEtf = ambiguous.rows.find((row) => row.ticker === 'ETF1')
assert.equal(ambiguousEtf?.action, 'UNAVAILABLE')
assert.ok(ambiguousEtf?.reason_codes.includes('TARGET_LINE_AMBIGUOUS'))

const conflictingIsin = assessFamilyOfficeAllocation(rows, model(), [
  target({ isin: 'FR0000000099' }),
  lines[1],
])
const conflictingEtf = conflictingIsin.rows.find((row) => row.ticker === 'ETF1')
assert.equal(conflictingEtf?.action, 'UNAVAILABLE')
assert.ok(conflictingEtf?.reason_codes.includes('TARGET_LINE_MISSING'))

const incompleteRows = buildFamilyOfficeAllocationRows({
  ...source,
  positions: [position({ market_value_eur: null })],
})
const incomplete = assessFamilyOfficeAllocation(incompleteRows, model(), lines)
assert.equal(incomplete.total_value_eur, null)
assert.ok(incomplete.rows.every((row) => row.action === 'UNAVAILABLE'))
assert.ok(incomplete.rows.every((row) => row.reason_codes.includes('PORTFOLIO_VALUE_INCOMPLETE')))
const decisionRows = toPortfolioDecisionRows(incomplete)
assert.ok(decisionRows.every((row) => row.data_state === 'PRICE_MISSING'))

const staleRows = buildFamilyOfficeAllocationRows({
  accounts,
  positions: [position({ data_state: 'STALE' })],
  cash: [],
})
const stale = assessFamilyOfficeAllocation(staleRows, model(), [target({ target_weight_pct: 100 })])
assert.equal(stale.rows[0].action, 'UNAVAILABLE')
assert.ok(stale.rows[0].reason_codes.includes('SOURCE_STALE'))

console.log('family-office allocation tests: PASS')
