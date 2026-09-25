import { buildFamilyOfficeAllocationRows } from '../../lib/familyOfficeAllocation.ts'

// Synthetic only. Shared by the server-render and optional offline browser checks.
export function allocationFixture(scope = 'PERSO') {
  const today = new Date().toISOString().slice(0, 10)
  const updated_at = `${today}T00:00:00Z`
  const model = {
    id: 'model', portfolio_scope: scope, model_name: 'Synthetic model', source_file: 'synthetic.xlsx',
    status: 'READY', is_active: true, allocation_contract_version: 'allocation_contracts_v1',
    target_total_pct: 100, reserve_floor_eur: scope === 'PRO' ? 120000 : null,
    reserve_excluded_from_risky_allocation: scope === 'PRO', updated_at,
  }
  const base = { model_id: model.id, portfolio_scope: scope, updated_at }
  const buckets = (scope === 'PERSO' ? [['actions_us', 98], ['crypto', 2]] : [
    ['actions_us', 41], ['actions_europe', 18], ['actions_japan', 10],
    ['actions_pacific_ex_japan', 5], ['actions_emerging', 16], ['gold', 10],
  ]).map(([key, weight], i) => ({
    ...base, id: i + 1, bucket_key: key, bucket_label: key, target_weight_pct: weight,
    lower_band_pct: key === 'crypto' ? 0 : null, upper_band_pct: key === 'crypto' ? 4 : null,
  }))
  const sleeves = scope !== 'PRO' ? [] : [
    ['CORE', 'actions_us', 28], ['CORE', 'actions_europe', 12], ['CORE', 'actions_japan', 7],
    ['CORE', 'actions_pacific_ex_japan', 4], ['CORE', 'actions_emerging', 9], ['CORE', 'gold', 10],
    ['SATELLITE', 'actions_us', 13], ['SATELLITE', 'actions_europe', 6], ['SATELLITE', 'actions_japan', 3],
    ['SATELLITE', 'actions_pacific_ex_japan', 1], ['SATELLITE', 'actions_emerging', 7],
  ].map(([sleeve, bucket, weight], i) => ({
    ...base, id: i + 1, sleeve_key: sleeve, bucket_key: bucket, bucket_label: bucket,
    component_label: `Synthetic component ${i}`, target_weight_pct: weight,
  }))
  const lines = [80, 20].map((weight, i) => ({
    ...base, id: i + 1, envelope: 'SYNTHETIC', ticker: `ETF${i + 1}`, isin: null,
    instrument: `Synthetic target ${i + 1}`, target_weight_pct: weight,
  }))
  const portfolios = [{ id: 'portfolio', name: 'Synthetic portfolio', portfolio_type: scope === 'PRO' ? 'PROFESSIONAL' : 'PERSONAL' }]
  const source = {
    accounts: [
      { id: 'a1', external_account_id: 'SYNTHETIC', name: 'Synthetic', envelope: 'CTO' },
      { id: 'cash', external_account_id: 'CASH', name: 'Synthetic reserve', envelope: 'CASH' },
    ],
    cash: scope !== 'PRO' ? [] : [{
      id: 'c1', portfolio_id: 'portfolio', account_id: 'cash', balance_date: today, currency: 'EUR',
      balance_local: 120000, fx_rate_to_eur: 1, balance_eur: 120000, data_state: 'READY', calculated_at: updated_at,
    }],
    positions: lines.map((line, i) => ({
      id: `p${i}`, portfolio_id: 'portfolio', account_id: 'a1', instrument_id: `i${i}`, instrument_key: `ticker:${line.ticker}`,
      isin: null, ticker: line.ticker, name: `Synthetic holding ${i + 1}`, instrument_type: 'ETF', currency: 'EUR',
      snapshot_date: today, quantity: 10, average_cost: 100, cost_basis_eur: 1000, price_local: 100,
      fx_rate_to_eur: 1, market_value_eur: 1000, unrealized_pnl_eur: 0, data_state: 'READY',
      price_as_of: today, fx_as_of: today, reconciliation_state: 'MATCH', calculated_at: updated_at,
    })),
  }
  return { model, buckets, sleeves, lines, portfolios, source, allocation: buildFamilyOfficeAllocationRows(source) }
}

export const pageKeys = {
  targets: { portfolios: 'fo-target-portfolios', models: 'target-models', allocation: 'fo-allocation-source', buckets: 'target-buckets', sleeves: 'target-sleeves', lines: 'target-envelope-lines' },
  arbitrage: { portfolios: 'fo-arbitrage-portfolios', models: 'fo-arbitrage-target-models', allocation: 'fo-arbitrage-allocation', buckets: 'fo-arbitrage-target-buckets', sleeves: 'fo-arbitrage-target-sleeves', lines: 'fo-arbitrage-target-lines' },
}

export function fixtureCache(page, fixture) {
  const cache = new Map(Object.entries(pageKeys[page]).map(([name, key]) => [key, {
    data: name === 'models' ? [fixture.model] : fixture[name], isLoading: false,
  }]))
  if (page === 'arbitrage') {
    const advice = {
      portfolio_id: 'portfolio', portfolio_scope: fixture.model.portfolio_scope, bucket_key: 'actions_us',
      action: 'BUY', confidence: 80, rebalance_amount_eur: 600, current_weight_pct: 50,
      target_weight_pct: 80, drift_pct: -30, data_state: 'READY', reason_codes: [],
      updated_at: fixture.model.updated_at, model_contract_state: 'READY', model_contract_reason: null,
      preferred_execution: 'NEW_CASH_FIRST', reserve_current_eur: fixture.model.reserve_floor_eur,
      reserve_floor_eur: fixture.model.reserve_floor_eur, reserve_state: 'READY',
    }
    cache.set('allocation-advice', { data: [{ ...advice, bucket_label: 'Synthetic cached allocation advice' }] })
    cache.set('macro-allocation-advice', { data: [{
      ...advice, bucket_label: 'Synthetic cached macro advice', snapshot_id: 'synthetic',
      regime: 'SYNTHETIC', regime_state: 'READY', instrument_symbol: 'TEST',
      recommended_envelope: 'CTO', trend_ticker: null, trend_state: 'READY', ma200_status: null,
    }] })
  }
  return cache
}
