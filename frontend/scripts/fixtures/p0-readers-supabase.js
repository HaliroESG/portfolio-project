// Test-only transport. Never imported by application code. No network or credentials.
const scenario = new URLSearchParams(location.search).get('case') ?? 'ready'
const fresh = new Date(Date.now() - 60_000).toISOString()
const last_update = scenario === 'stale' ? '2020-01-01T12:00:00Z' : scenario === 'unknown' ? null : fresh
const date = new Date().toLocaleDateString('en-CA')
const dashboard = { instrument_key: 'TEST', ticker: 'TEST', name: 'Synthetic Company', provider_symbol: 'TEST', source_index: 'S&P 500', sector: 'Synthetic Sector', data_state: 'PARTIAL', annual_fiscal_year: 2025, annual_currency: 'EUR', annual_revenue: 100_000_000, annual_ebitda: null, annual_free_cash_flow: null, next_event_date: '2026-01-01', next_event_status: 'ESTIMATED', updated_at: fresh }
const tables = {
  currencies: [{ id: 'USD', symbol: '$', rate_to_eur: 0.9, last_update }, { id: 'GBP', symbol: '£', rate_to_eur: null, last_update: null }],
  market_watch: [{ ticker: 'MSFT', name: 'Not an FX pair', currency: 'USD', last_price: 999, perf_day_local: 0.5, last_update, data_status: 'OK' }, { ticker: 'EURUSD=X', currency: 'USD', last_price: 1.1, perf_day_local: ['fx-ok', 'stale-source', 'unknown-source'].includes(scenario) ? 0.1 : null, last_update, data_status: scenario === 'stale-source' ? 'STALE' : scenario === 'unknown-source' ? null : 'OK' }],
  macro_indicators: ['^VIX', 'SPREAD_10Y_2Y', 'MISERY_INDEX', '^TNX', 'DX-Y.NYB', '^MOVE', 'JPY_VOLATILITY', 'HYG_OAS'].map((id, i) => ({ id, name: id, value: scenario === 'missing' && i === 0 ? null : [12, 1, 5.7, 3.5, 99, 80, 1, 1][i], change_pct: i % 2 ? -0.02 : 0.03, last_update, threshold_amber: scenario === 'thresholds' ? null : 20, threshold_red: scenario === 'thresholds' ? null : 30, direction: 'UP' })),
  equity_publication_dashboard_latest: [dashboard],
  equity_reporting_calendar: Array.from({ length: 1005 }, (_, i) => ({ event_key: String(i).padStart(5, '0'), instrument_key: 'TEST', ticker: `TEST${i + 1}`, provider_symbol: 'TEST', name: 'Synthetic Company', source_index: 'S&P 500', event_type: 'EARNINGS', event_date: date, status: 'ESTIMATED', source_provider: 'synthetic', event_label: `Synthetic event ${i + 1}`, updated_at: fresh })),
  trident_financial_annual: [{ instrument_key: 'TEST', fiscal_year: 2025, revenue: 100_000_000, currency: 'EUR', provider: 'synthetic', updated_at: fresh }],
  equity_financial_interim: [],
  etl_runs: [{ job_name: 'equity_publications_sync', status: 'SUCCESS', finished_at: fresh }],
}
if (scenario.startsWith('strategy-')) {
  const as_of_date = scenario === 'strategy-old' ? '2000-01-01' : scenario === 'strategy-future' ? '2999-01-01' : date
  tables.macro_regime_snapshots = [{ id: 'synthetic-regime', as_of_date, regime: 'GOLDILOCKS', regime_state: 'READY', confidence: 99, growth_signal: 'UP', inflation_signal: 'DOWN', liquidity_signal: 'EASING', updated_at: fresh }]
  tables.macro_series_latest = [{ series_id: 'UNRATE', name: 'Synthetic unemployment', as_of_date, value: 3.7, frequency: 'MONTHLY', source_provider: 'synthetic', data_state: 'READY', collected_at: fresh }]
  tables.macro_satellite_targets_latest = [{ id: 'synthetic-target', snapshot_id: 'synthetic-regime', as_of_date, regime: 'GOLDILOCKS', regime_state: 'READY', bucket_key: 'synthetic', bucket_label: 'Synthetic target', instrument_symbol: 'TEST', target_weight_pct: 18, effective_weight_pct: 18, recommended_envelope: 'CTO', trend_state: 'READY', ma200_status: 'above', data_state: 'READY', is_blocked: false, updated_at: fresh }]
}
if (['fx-ok', 'stale-source', 'unknown-source'].includes(scenario)) tables.currencies = tables.currencies.slice(0, 1)
let forceError = false
export function failReads() { forceError = true }
export const supabase = { from(table) {
  const q = { filters: [], orders: [], start: 0, end: Infinity, single: false }
  const api = {
    select() { return api }, order(key, options) { q.orders.push([key, options?.ascending !== false]); return api },
    range(start, end) { q.start = start; q.end = end; return api }, limit(limit) { q.end = limit - 1; return api },
    eq(key, value) { q.filters.push(row => row[key] === value); return api },
    gte(key, value) { q.filters.push(row => row[key] >= value); return api }, lte(key, value) { q.filters.push(row => row[key] <= value); return api },
    like(key) { q.filters.push(row => row[key]?.endsWith('=X')); return api },
    maybeSingle() { q.single = true; return api },
    then(resolve, reject) { return new Promise((done) => {
      if (scenario === 'loading') return
      if (forceError || scenario === 'error' || (scenario === 'partial' && table === 'equity_reporting_calendar' && q.start > 0)) { done({ data: null, error: { message: 'Synthetic read error' }, count: null }); return }
      let rows = scenario === 'empty' ? [] : (tables[table] ?? []).filter(row => q.filters.every(f => f(row)))
      rows.sort((a, b) => { for (const [key, asc] of q.orders) { const order = String(a[key]).localeCompare(String(b[key])); if (order) return asc ? order : -order } return 0 })
      const count = rows.length
      rows = rows.slice(q.start, Math.min(q.end + 1, q.start + 500))
      done({ data: q.single ? rows[0] ?? null : rows, count, error: null })
    }).then(resolve, reject) },
  }
  return api
} }
