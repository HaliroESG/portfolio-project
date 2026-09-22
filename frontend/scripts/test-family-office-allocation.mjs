import assert from 'node:assert/strict'

const {
  assessFamilyOfficeAllocation: assessFamilyOfficeAllocationAtDate,
  buildFamilyOfficeAllocationRows,
  toPortfolioDecisionRows,
} = await import('../lib/familyOfficeAllocation.ts')

const assessFamilyOfficeAllocation = (rows, targetModel, targetLines, options = {}) => (
  assessFamilyOfficeAllocationAtDate(rows, targetModel, targetLines, {
    expectedScope: options.expectedScope ?? targetModel?.portfolio_scope ?? 'PERSO',
    targetBuckets: options.targetBuckets ?? (targetModel?.portfolio_scope === 'PERSO' ? persoBuckets : []),
    targetSleeves: options.targetSleeves ?? [],
    referenceDate: '2026-09-20',
  })
)

const accounts = [
  { id: 'a1', external_account_id: 'lucya-1', name: 'Lucya Cardif', envelope: 'AV' },
  { id: 'a2', external_account_id: 'SECOND_ACCOUNT', name: 'Second Account', envelope: 'PEA' },
  { id: 'a3', external_account_id: 'CASH_CORE', name: 'Cash Core', envelope: 'CASH' },
  { id: 'a4', external_account_id: 'CASH_OFFSET', name: 'Cash Offset', envelope: 'CASH' },
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
  allocation_contract_version: 'allocation_contracts_v1',
  reserve_floor_eur: null,
  reserve_excluded_from_risky_allocation: false,
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
  envelope: 'Cardif_Lucya_PostArb',
  ticker: 'ETF1',
  isin: 'FR0000000001',
  instrument: 'ETF One',
  asset_class: 'ETF',
  region: null,
  currency: 'EUR',
  target_weight_pct: 100,
  target_value_eur: null,
  notes: null,
  source_sheet: 'Targets',
  source_row: 2,
  updated_at: '2026-09-18T12:00:00Z',
  ...overrides,
})

const bucket = (overrides = {}) => ({
  id: 1,
  model_id: 'model-1',
  portfolio_scope: 'PERSO',
  bucket_key: 'actions_us',
  bucket_label: 'Actions US',
  parent_bucket_key: null,
  target_weight_pct: 98,
  lower_band_pct: 90,
  upper_band_pct: 100,
  source_sheet: 'Strategic_Target_Perso',
  source_row: 2,
  updated_at: '2026-09-18T12:00:00Z',
  ...overrides,
})

const persoBuckets = [
  bucket(),
  bucket({
    id: 2,
    bucket_key: 'crypto',
    bucket_label: 'Crypto',
    target_weight_pct: 2,
    lower_band_pct: 0,
    upper_band_pct: 4,
    source_row: 3,
  }),
]

const source = {
  accounts,
  positions: [
    position(),
    position({ id: 'p2', account_id: 'a2', quantity: 2, market_value_eur: 200 }),
  ],
  cash: [cash()],
}

const rows = buildFamilyOfficeAllocationRows(source)
assert.equal(rows.length, 3)
const cashRow = rows.find((row) => row.ticker === 'CASH_EUR')
const firstAccountRow = rows.find((row) => row.source_accounts[0].account_id === 'a1')
const secondAccountRow = rows.find((row) => row.source_accounts[0].account_id === 'a2')
assert.equal(cashRow?.current_value_eur, 500)
assert.equal(firstAccountRow?.ticker, 'ETF1')
assert.equal(firstAccountRow?.current_quantity, 1)
assert.equal(firstAccountRow?.current_value_eur, 100)
assert.equal(secondAccountRow?.ticker, 'ETF1')
assert.equal(secondAccountRow?.current_quantity, 2)
assert.equal(secondAccountRow?.current_value_eur, 200)
assert.ok(rows.every((row) => row.source_accounts.length === 1))

const lines = [
  target(),
  target({ id: 2, envelope: 'SECOND_ACCOUNT', target_weight_pct: 100 }),
  target({ id: 3, envelope: 'CASH_CORE', ticker: 'CASH_EUR', isin: null, instrument: 'Cash EUR', asset_class: 'CASH', target_weight_pct: 100 }),
]
const ready = assessFamilyOfficeAllocation(rows, model(), lines)
assert.equal(ready.total_value_eur, 800)
assert.equal(ready.target_model_ready, true)
assert.deepEqual(ready.rows.map((row) => row.action), ['HOLD', 'HOLD', 'HOLD'])
assert.deepEqual(ready.rows.map((row) => row.reason_codes), [[], [], []])

const legacyModel = assessFamilyOfficeAllocation(rows, model({ allocation_contract_version: null }), lines)
assert.equal(legacyModel.target_model_ready, false)
assert.ok(legacyModel.rows.every((row) => row.action === 'UNAVAILABLE'))
assert.ok(legacyModel.rows.every((row) => row.reason_codes.includes('TARGET_MODEL_INVALID')))

const mismatchedScope = assessFamilyOfficeAllocation(rows, model(), lines, { expectedScope: 'PRO' })
assert.equal(mismatchedScope.target_model_ready, false)
assert.ok(mismatchedScope.rows.every((row) => row.action === 'UNAVAILABLE'))

const missingCryptoContract = assessFamilyOfficeAllocation(rows, model(), lines, {
  targetBuckets: [bucket({ target_weight_pct: 100 })],
})
assert.equal(missingCryptoContract.target_model_ready, false)
assert.ok(missingCryptoContract.rows.every((row) => row.action === 'UNAVAILABLE'))

const invalidGenericBucketBand = assessFamilyOfficeAllocation(rows, model(), lines, {
  targetBuckets: persoBuckets.map((row) => row.bucket_key === 'actions_us'
    ? { ...row, lower_band_pct: 35, upper_band_pct: 50 }
    : row),
})
assert.equal(invalidGenericBucketBand.target_model_ready, false)
assert.ok(invalidGenericBucketBand.rows.every((row) => row.reason_codes.includes('TARGET_MODEL_INVALID')))

const proSleeveWeights = [
  ['CORE', 'actions_us', 28],
  ['CORE', 'actions_europe', 12],
  ['CORE', 'actions_japan', 7],
  ['CORE', 'actions_pacific_ex_japan', 4],
  ['CORE', 'actions_emerging', 9],
  ['CORE', 'gold', 10],
  ['SATELLITE', 'actions_us', 13],
  ['SATELLITE', 'actions_europe', 6],
  ['SATELLITE', 'actions_japan', 3],
  ['SATELLITE', 'actions_pacific_ex_japan', 1],
  ['SATELLITE', 'actions_emerging', 7],
]
const proModel = model({
  id: 'pro-model',
  portfolio_scope: 'PRO',
  reserve_floor_eur: 120000,
  reserve_excluded_from_risky_allocation: true,
})
const proLines = lines
  .filter((line) => line.asset_class !== 'CASH')
  .map((line) => ({ ...line, model_id: 'pro-model', portfolio_scope: 'PRO' }))
const proSleeves = proSleeveWeights.map(([sleeve, bucket, weight], index) => ({
  id: index + 1,
  model_id: 'pro-model',
  portfolio_scope: 'PRO',
  sleeve_key: sleeve,
  component_label: 'test',
  bucket_key: bucket,
  bucket_label: bucket,
  target_weight_pct: weight,
  instrument_policy: null,
  activation_status: 'NOT_ACTIVATED',
  source_sheet: 'Modele_Core_Satellite',
  source_row: index + 5,
  updated_at: '2026-09-18T12:00:00Z',
}))
const proBuckets = [
  ['actions_us', 41],
  ['actions_europe', 18],
  ['actions_japan', 10],
  ['actions_pacific_ex_japan', 5],
  ['actions_emerging', 16],
  ['gold', 10],
].map(([bucketKey, weight], index) => bucket({
  id: index + 1,
  model_id: 'pro-model',
  portfolio_scope: 'PRO',
  bucket_key: bucketKey,
  bucket_label: bucketKey,
  target_weight_pct: weight,
  lower_band_pct: null,
  upper_band_pct: null,
  source_sheet: 'Modele_Core_Satellite',
  source_row: index + 5,
}))
const proRows = buildFamilyOfficeAllocationRows({
  ...source,
  cash: [cash({ balance_local: 120000, balance_eur: 120000 })],
})
const readyPro = assessFamilyOfficeAllocation(proRows, proModel, proLines, {
  expectedScope: 'PRO',
  targetBuckets: proBuckets,
  targetSleeves: proSleeves,
})
assert.equal(readyPro.target_model_ready, true)
assert.equal(readyPro.total_value_eur, 300)
assert.deepEqual(readyPro.rows.map((row) => row.action), ['HOLD', 'HOLD', 'HOLD'])
const readyProReserve = readyPro.rows.find((row) => row.instrument_type === 'CASH')
assert.equal(readyProReserve?.target_line_id, null)
assert.deepEqual(readyProReserve?.reason_codes, ['PRO_RESERVE_EXCLUDED'])
assert.equal(readyProReserve?.allocation_role, 'PROTECTED_RESERVE')
assert.equal(toPortfolioDecisionRows(readyPro).find((row) => row.asset_class === 'CASH')?.data_state, 'READY')

const excessReserveProRows = buildFamilyOfficeAllocationRows({
  ...source,
  cash: [cash({ balance_local: 150000, balance_eur: 150000 })],
})
const excessReservePro = assessFamilyOfficeAllocation(excessReserveProRows, proModel, proLines, {
  expectedScope: 'PRO',
  targetBuckets: proBuckets,
  targetSleeves: proSleeves,
})
assert.equal(excessReservePro.target_model_ready, true)
assert.equal(excessReservePro.total_value_eur, 30300)
const protectedReserveRow = excessReservePro.rows.find((row) => row.reason_codes.includes('PRO_RESERVE_EXCLUDED'))
const excessReserveRow = excessReservePro.rows.find((row) => row.reason_codes.includes('PRO_RESERVE_EXCESS'))
assert.equal(protectedReserveRow?.current_value_eur, 120000)
assert.equal(excessReserveRow?.current_value_eur, 30000)
assert.equal(excessReserveRow?.target_weight_pct, 0)
assert.equal(excessReserveRow?.action, 'EXIT')

const netReserveProRows = buildFamilyOfficeAllocationRows({
  ...source,
  cash: [
    cash({ id: 'cash-positive', account_id: 'a3', balance_local: 130000, balance_eur: 130000 }),
    cash({ id: 'cash-negative', account_id: 'a4', balance_local: -10000, balance_eur: -10000 }),
  ],
})
const netReservePro = assessFamilyOfficeAllocation(netReserveProRows, proModel, proLines, {
  expectedScope: 'PRO',
  targetBuckets: proBuckets,
  targetSleeves: proSleeves,
})
assert.equal(netReservePro.target_model_ready, true)
assert.equal(netReservePro.total_value_eur, 300)
assert.equal(netReservePro.rows.filter((row) => row.allocation_role === 'RESERVE_EXCESS').length, 0)
assert.deepEqual(
  netReservePro.rows.filter((row) => row.allocation_role === 'PROTECTED_RESERVE').map((row) => row.current_value_eur).sort((a, b) => a - b),
  [-10000, 130000],
)

const fondsEuroProRows = buildFamilyOfficeAllocationRows({
  ...source,
  positions: [
    ...source.positions,
    position({
      id: 'fonds-euro',
      account_id: 'a3',
      instrument_id: 'fonds-euro',
      instrument_key: 'fund:fgdiq',
      isin: null,
      ticker: 'FGDIQ',
      name: 'Fonds euro',
      instrument_type: 'FUND',
      market_value_eur: 120000,
    }),
  ],
  cash: [],
})
const fondsEuroPro = assessFamilyOfficeAllocation(fondsEuroProRows, proModel, proLines, {
  expectedScope: 'PRO',
  targetBuckets: proBuckets,
  targetSleeves: proSleeves,
})
assert.equal(fondsEuroPro.target_model_ready, false)
assert.equal(fondsEuroPro.rows.find((row) => row.ticker === 'FGDIQ')?.allocation_role, 'NON_TARGET')
assert.ok(!fondsEuroPro.rows.find((row) => row.ticker === 'FGDIQ')?.reason_codes.includes('TARGET_LINE_MISSING'))
assert.ok(!fondsEuroPro.rows.find((row) => row.ticker === 'FGDIQ')?.reason_codes.includes('PRO_RESERVE_EXCLUDED'))

const incompletePro = assessFamilyOfficeAllocation(proRows, proModel, proLines, {
  expectedScope: 'PRO',
  targetBuckets: proBuckets,
  targetSleeves: proSleeves.slice(1),
})
assert.equal(incompletePro.target_model_ready, false)
assert.ok(incompletePro.rows.every((row) => row.action === 'UNAVAILABLE'))

const missingProReserve = assessFamilyOfficeAllocation(
  proRows,
  { ...proModel, reserve_floor_eur: null },
  proLines,
  { expectedScope: 'PRO', targetBuckets: proBuckets, targetSleeves: proSleeves },
)
assert.equal(missingProReserve.target_model_ready, false)
assert.ok(missingProReserve.rows.every((row) => row.action === 'UNAVAILABLE'))

const belowFloorProRows = buildFamilyOfficeAllocationRows({
  ...source,
  cash: [cash({ balance_local: 119999, balance_eur: 119999 })],
})
const belowFloorPro = assessFamilyOfficeAllocation(belowFloorProRows, proModel, proLines, {
  expectedScope: 'PRO',
  targetBuckets: proBuckets,
  targetSleeves: proSleeves,
})
assert.equal(belowFloorPro.target_model_ready, false)
assert.ok(belowFloorPro.rows.filter((row) => row.instrument_type !== 'CASH').every((row) => (
  row.action === 'UNAVAILABLE' && row.reason_codes.includes('TARGET_COVERAGE_INCOMPLETE')
)))
assert.ok(belowFloorPro.rows.find((row) => row.instrument_type === 'CASH')?.reason_codes.includes('PRO_RESERVE_BELOW_FLOOR'))

const genericBondProRows = buildFamilyOfficeAllocationRows({
  ...source,
  positions: [
    ...source.positions,
    position({
      id: 'bond',
      account_id: 'a3',
      instrument_id: 'bond',
      instrument_key: 'isin:FR0000000099',
      isin: 'FR0000000099',
      ticker: 'BOND',
      name: 'Generic Corporate Bond',
      instrument_type: 'BOND',
      market_value_eur: 10000,
    }),
  ],
  cash: [cash({ balance_local: 120000, balance_eur: 120000 })],
})
const genericBondPro = assessFamilyOfficeAllocation(genericBondProRows, proModel, proLines, {
  expectedScope: 'PRO',
  targetBuckets: proBuckets,
  targetSleeves: proSleeves,
})
assert.equal(genericBondPro.target_model_ready, true)
assert.equal(genericBondPro.rows.find((row) => row.ticker === 'BOND')?.allocation_role, 'NON_TARGET')
assert.equal(genericBondPro.rows.find((row) => row.ticker === 'BOND')?.target_weight_pct, 0)
assert.equal(genericBondPro.rows.find((row) => row.ticker === 'BOND')?.action, 'EXIT')
assert.ok(genericBondPro.rows.find((row) => row.ticker === 'BOND')?.reason_codes.includes('PRO_NON_TARGET_CASH_BONDS'))

const mismatchedProBuckets = assessFamilyOfficeAllocation(proRows, proModel, proLines, {
  expectedScope: 'PRO',
  targetBuckets: proBuckets.map((row) => row.bucket_key === 'actions_us'
    ? { ...row, target_weight_pct: 42 }
    : row.bucket_key === 'actions_europe'
      ? { ...row, target_weight_pct: 17 }
      : row),
  targetSleeves: proSleeves,
})
assert.equal(mismatchedProBuckets.target_model_ready, false)
assert.ok(mismatchedProBuckets.rows.every((row) => row.action === 'UNAVAILABLE'))

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
  ...lines.slice(1),
])
assert.equal(missingWeight.target_model_ready, false)
assert.equal(missingWeight.rows.find((row) => row.ticker === 'ETF1')?.action, 'UNAVAILABLE')
assert.ok(missingWeight.rows.find((row) => row.ticker === 'ETF1')?.reason_codes.includes('TARGET_WEIGHT_MISSING'))

const ambiguous = assessFamilyOfficeAllocation(rows, model(), [...lines, target({ id: 4 })])
const ambiguousEtf = ambiguous.rows.find((row) => row.ticker === 'ETF1')
assert.equal(ambiguousEtf?.action, 'UNAVAILABLE')
assert.ok(ambiguousEtf?.reason_codes.includes('TARGET_LINE_AMBIGUOUS'))

const conflictingIsin = assessFamilyOfficeAllocation(rows, model(), [
  target({ isin: 'FR0000000099' }),
  ...lines.slice(1),
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

const staleValuationRows = buildFamilyOfficeAllocationRows({
  accounts,
  positions: [position({ price_as_of: '2026-09-01', fx_as_of: '2026-09-01' })],
  cash: [],
})
const staleValuation = assessFamilyOfficeAllocation(staleValuationRows, model(), [target()])
assert.equal(staleValuation.rows[0].action, 'UNAVAILABLE')
assert.ok(staleValuation.rows[0].reason_codes.includes('VALUATION_STALE'))

const withinEnvelopeRows = buildFamilyOfficeAllocationRows({
  accounts,
  positions: [
    position(),
    position({
      id: 'p3',
      instrument_id: 'i2',
      instrument_key: 'isin:FR0000000002',
      isin: 'FR0000000002',
      ticker: 'ETF2',
      name: 'ETF Two',
      quantity: 3,
      market_value_eur: 300,
    }),
  ],
  cash: [],
})
const withinEnvelope = assessFamilyOfficeAllocation(withinEnvelopeRows, model(), [
  target({ target_weight_pct: 25 }),
  target({ id: 2, isin: 'FR0000000002', ticker: 'ETF2', instrument: 'ETF Two', target_weight_pct: 75 }),
])
assert.deepEqual(withinEnvelope.rows.map((row) => row.current_weight_pct), [25, 75])
assert.deepEqual(withinEnvelope.rows.map((row) => row.action), ['HOLD', 'HOLD'])

const invalidWeight = assessFamilyOfficeAllocation(rows, model(), [
  target({ target_weight_pct: -1 }),
  ...lines.slice(1),
])
assert.equal(invalidWeight.target_model_ready, false)
assert.ok(invalidWeight.rows.find((row) => row.source_accounts[0].account_id === 'a1')?.reason_codes.includes('TARGET_WEIGHT_INVALID'))

const mismatchRows = buildFamilyOfficeAllocationRows({
  accounts,
  positions: [position({ reconciliation_state: 'MISMATCH' })],
  cash: [],
})
const mismatchDecision = toPortfolioDecisionRows(assessFamilyOfficeAllocation(mismatchRows, model(), [target()]))
assert.equal(mismatchDecision[0].reconciliation_state, 'MISMATCH')

console.log('family-office allocation tests: PASS')
