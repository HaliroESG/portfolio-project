/* eslint-disable react-hooks/immutability -- offline test controls, not application components */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SWRConfig, useSWRConfig, unstable_serialize } from 'swr'
import Targets from '../../app/targets/page'
import Arbitrage from '../../app/arbitrage/page'
import { buildFamilyOfficeAllocationRows } from '../../lib/familyOfficeAllocation'

// Bundled only by the offline test runner, never imported by application code.
// Real SWR performs the fetch/cache/revalidation transitions; only IO is synthetic.
const today = new Date().toISOString().slice(0, 10)
const updated_at = `${today}T00:00:00Z`
const models = ['PERSO', 'PRO'].map((scope) => ({
  id: scope, portfolio_scope: scope, model_name: `Synthetic ${scope}`, source_file: 'synthetic.xlsx',
  status: 'READY', is_active: true, target_total_pct: 100, updated_at,
}))
const lines = (scope) => [80, 20].map((weight, i) => ({
  id: i + 1, model_id: scope, portfolio_scope: scope, envelope: 'SYNTHETIC', ticker: `ETF${i + 1}`,
  instrument: `Synthetic target ${i + 1}`, target_weight_pct: weight, target_value_eur: null,
  isin: null, asset_class: null, region: null, currency: 'EUR', notes: null,
}))
const allocation = (id) => buildFamilyOfficeAllocationRows({
  accounts: [{ id: 'a1', external_account_id: 'SYNTHETIC', name: 'Synthetic', envelope: 'CTO' }],
  cash: [],
  positions: [0, 1].map((i) => ({
    id: `p${i}`, portfolio_id: id, account_id: 'a1', instrument_id: `i${i}`, instrument_key: `ticker:ETF${i + 1}`,
    isin: null, ticker: `ETF${i + 1}`, name: `Holding ${id} ${i + 1}`, instrument_type: 'ETF', currency: 'EUR',
    snapshot_date: today, quantity: 10, average_cost: 100, cost_basis_eur: 1000, price_local: 100,
    fx_rate_to_eur: 1, market_value_eur: 1000, unrealized_pnl_eur: 0, data_state: 'READY',
    price_as_of: today, fx_as_of: today, reconciliation_state: 'MATCH', calculated_at: updated_at,
  })),
})
const sourceNames = {
  'fo-target-portfolios': 'portfolios', 'fo-arbitrage-portfolios': 'portfolios',
  'fo-allocation-source': 'allocation', 'fo-arbitrage-allocation': 'allocation',
  'target-models': 'models', 'fo-arbitrage-target-models': 'models',
  'target-buckets': 'buckets', 'target-envelope-lines': 'lines', 'fo-arbitrage-target-lines': 'lines',
  'allocation-advice': 'advice', 'macro-allocation-advice': 'macro', 'arbitrage-execution-universe': 'execution',
}
const query = new URLSearchParams(location.search)
const initialHold = query.get('hold')
const keys = new Map(), modes = new Map(), pending = new Map(), observed = new Map()
const fetchCounts = new Map()
if (initialHold) modes.set(initialHold, 'hold')
function fixture(key) {
  const name = sourceNames[Array.isArray(key) ? key[0] : key]
  const scope = Array.isArray(key) ? key[1] : 'PERSO'
  if (name === 'portfolios') return [{ id: 'p1', name: 'Portfolio one' }, { id: 'p2', name: 'Portfolio two' }]
  if (name === 'models') return models
  if (name === 'allocation') return allocation(scope)
  if (name === 'lines') return lines(scope)
  if (name === 'buckets') return [{ id: 1, bucket_key: 'test', bucket_label: 'Synthetic bucket', target_weight_pct: 100, lower_band_pct: null, upper_band_pct: null, parent_bucket_key: null }]
  const advice = { current_weight_pct: 50, target_weight_pct: 80, drift_pct: -30, rebalance_amount_eur: 600, current_value_eur: 1000, action: 'BUY', reason_codes: [], confidence: 80, updated_at }
  if (name === 'advice') return [{ ...advice, model_id: scope, bucket_key: 'test', bucket_label: `Advice ${scope}`, source_file: 'synthetic.xlsx', preferred_execution: 'NEW_CASH_FIRST' }]
  if (name === 'macro') return [{ ...advice, bucket_key: 'test', bucket_label: `Macro ${scope}`, snapshot_id: 'synthetic', regime: 'SYNTHETIC', regime_state: 'READY', instrument_symbol: 'TEST', recommended_envelope: 'CTO', trend_ticker: null, trend_state: 'READY', ma200_status: null }]
  if (name === 'execution') return []
  throw new Error('Unexpected source ' + key)
}
const middleware = (useSWRNext) => (key, _fetcher, config) => {
  const name = key && sourceNames[Array.isArray(key) ? key[0] : key]
  if (key) keys.set(name, key)
  const response = useSWRNext(key, async (key) => {
    fetchCounts.set(name, (fetchCounts.get(name) ?? 0) + 1)
    if (modes.get(name) === 'error') throw new Error('Synthetic source failure')
    if (modes.get(name) === 'hold') return new Promise((resolve) => pending.set(name, () => resolve(fixture(key))))
    return fixture(key)
  }, config)
  if (key) observed.set(name, { isLoading: response.isLoading, isValidating: response.isValidating, hasData: response.data !== undefined })
  return response
}
function Controls() {
  const { mutate, cache } = useSWRConfig()
  window.qa = {
    observed: () => Object.fromEntries(observed),
    fetchCounts: () => Object.fromEntries(fetchCounts),
    activeKey: (name) => keys.get(name),
    setMode(name, mode) { modes.set(name, mode) },
    revalidate(name, mode) { modes.set(name, mode); void mutate(keys.get(name)).catch(() => {}) },
    recover(name) { modes.delete(name); if (pending.has(name)) { pending.get(name)(); pending.delete(name) } else { void mutate(keys.get(name)).catch(() => {}) } },
    replace(name, value) { void mutate(keys.get(name), value, { revalidate: false }) },
    // Verification hook: current key, not a previous portfolio/scope cache entry.
    cached(name) { return cache.get(unstable_serialize(keys.get(name)))?.data },
  }
  return null
}
const Page = location.pathname === '/targets' ? Targets : Arbitrage
createRoot(document.getElementById('root')).render(
  <SWRConfig value={{ provider: () => new Map(), use: [middleware], dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false, revalidateOnReconnect: false }}>
    <Controls /><Page />
  </SWRConfig>,
)
