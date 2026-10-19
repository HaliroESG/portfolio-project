// Entirely synthetic. These records are NEVER imported by production code.
export function equityRow(overrides = {}) {
  return { instrument_key: 'fixture:ASTER:A', ticker: 'ASTER', provider_symbol: 'ASTER.IT', provider: 'fixture', name: 'Aster Systems',
    exchange: 'Milan', country: 'IT', currency: 'EUR', sector: 'Technology', industry: 'IT services', source_index: 'Fixture universe',
    as_of_date: '2026-06-19', updated_at: '2026-10-18T12:00:00Z', latest_fiscal_year: 2025, themes: ['IT_SERVICES'],
    quality_value_score: 94, valuation_tag: 'POTENTIAL_VALUE', financial_currency: 'EUR', valuation_currency: 'EUR',
    market_cap: 3.4e9, market_cap_usd: 3.9e9, market_cap_fx_rate: 1.147, market_cap_fx_as_of: '2026-06-19',
    revenue: 2.4e9, free_cash_flow: 280e6, fcf_margin: 0.1167, fcf_yield: 0.082, revenue_cagr_3y: 0.086, revenue_cagr_5y: 0.094,
    forecast_revenue_growth: null, trailing_pe: 13.1, forward_pe: 11.6, latest_roic: 0.247, latest_net_debt_to_ebitda: -1,
    target_upside: 0.624, analyst_count: 12, trident_score: 71, trident_state: 'WATCHLIST', regression_slope_pct: 22.3,
    regression_z_score: -1.37, ma200_state: 'ABOVE', momentum_3m_pct: 10, momentum_12m_pct: 20, price_coverage_pct: 92,
    score_details: { valuation_points: 18, fcf_points: 25, quality_points: 18, growth_points: 13, health_points: 20 },
    data_state: ['FORECAST_UNAVAILABLE', 'STALE'], ...overrides }
}
export function tridentRow(overrides = {}) {
  const q = equityRow()
  return { ...q, source_provider: 'fixture', source_license_note: 'Synthetic test data, no source right inferred', is_active: true,
    overall_state: 'WATCHLIST', score: 71, confidence: 88, growth_score: 67, profitability_score: 100, capital_score: 50, health_score: 90,
    criteria_pass_count: 46, criteria_fail_count: 0, criteria_missing_count: 6, failed_eliminators: [],
    horizons: Object.fromEntries([1, 3, 5, 10].map(h => [String(h), { horizon_years: h, start_year: 2026 - h, end_year: 2025, status: 'partial',
      coverage: { expected_observations: h, observed_observations: Math.max(0, h - 1), coverage_pct: (h - 1) / h * 100, missing_years: [2025], duplicate_years: [] }, metrics: {} }])), summary: {}, ...overrides }
}
export function researchTables(scenario = 'ready', count = 62) {
  const equity = [equityRow(), equityRow({ instrument_key: 'fixture:ASTER:B', name: 'Aster Systems · classe B', currency: 'USD', exchange: 'New York', provider_symbol: 'ASTER.B', quality_value_score: 90 }),
    equityRow({ instrument_key: 'fixture:BOREAL', ticker: 'BOR', provider_symbol: 'BOR.FR', name: 'Boreal Group', country: 'FR', exchange: 'Paris', themes: ['HEALTHCARE'], sector: 'Healthcare', quality_value_score: 0, latest_roic: 0, forward_pe: null, fcf_yield: 0 }),
    equityRow({ instrument_key: 'fixture:MISSING', ticker: 'MIS', provider_symbol: 'MIS', name: 'Chiffres absents', quality_value_score: null, fcf_yield: null, forward_pe: null, as_of_date: null }),
    equityRow({ instrument_key: 'fixture:Q-ONLY', ticker: 'QO', provider_symbol: 'QO', name: 'Lecteur valorisation seul', quality_value_score: 40 }),
    ...Array.from({ length: Math.max(0, count - 5) }, (_, i) => equityRow({ instrument_key: `fixture:EXAMPLE:${String(i).padStart(4, '0')}`, name: `Société test ${String(i).padStart(4, '0')}`, ticker: `TEST${i}`, provider_symbol: `TEST${i}`, quality_value_score: 60 }))]
  const trident = equity.filter(q => q.instrument_key !== 'fixture:Q-ONLY').map(q => tridentRow({ ...q, overall_state: q.instrument_key.endsWith('BOREAL') ? 'REJECTED' : q.instrument_key.endsWith(':B') ? 'QUALIFIED' : 'WATCHLIST' }))
  trident.push(tridentRow({ instrument_key: 'fixture:T-ONLY', ticker: 'TO', provider_symbol: 'TO', name: 'Lecteur Trident seul', score: 99 }))
  if (scenario === 'conflict') trident[0].currency = 'GBP'
  if (scenario === 'duplicate') equity.push({ ...equity[0] })
  const key = 'fixture:ASTER:A'
  const annual = [2025, 2024, 2023].map(year => ({ instrument_key: key, fiscal_year: year, fiscal_period_end: `${year}-12-31`, currency: 'EUR', revenue: 2.4e9, ebitda: 320e6, operating_income: 250e6, net_income: 180e6, eps_diluted: year === 2024 ? 0 : 8.1, free_cash_flow: 280e6, provider: 'fixture', source_url: 'https://example.invalid/annual', updated_at: '2026-06-19T12:00:00Z' }))
  const interim = [{ ...annual[0], fiscal_period_end: '2026-06-30', fiscal_year: 2026, period_kind: 'H1', period_months: 6, operating_cash_flow: 100e6, capital_expenditure: -10e6, source_provider: 'fixture', data_state: 'PARTIAL', reason_codes: ['SYNTHETIC'], collected_at: '2026-07-20T12:00:00Z' }]
  const events = [{ event_key: 'fixture-result', instrument_key: key, ticker: 'ASTER', name: 'Aster Systems', provider_symbol: 'ASTER.IT', source_index: 'Fixture', currency: 'EUR', event_type: 'EARNINGS', event_label: 'Résultat semestriel synthétique', event_date: '2026-07-20', event_time_utc: null, status: 'REPORTED', fiscal_year: 2026, fiscal_period_end: '2026-06-30', period_kind: 'H1', filing_date: null, match_confidence: 'HIGH', source_provider: 'yfinance_yahoo', source_url: 'https://example.invalid/result', metadata: {}, first_seen_at: '2026-07-20T12:00:00Z', last_seen_at: '2026-07-20T12:00:00Z' },
    { event_key: 'fixture-estimate', instrument_key: key, provider_symbol: 'ASTER.IT', source_index: 'Fixture', event_date: '2027-02-20', status: 'ESTIMATED', event_type: 'EARNINGS', event_label: 'Prochaine échéance synthétique', source_provider: 'fixture', metadata: {} }]
  const criteria = [1, 3, 5, 10].flatMap(h => [
    { instrument_key: key, horizon_years: h, criterion_key: 'roic', category: 'capital', label: `ROIC sur ${h} ans`, status: 'pass', actual: 0.247, threshold: 0.15, comparator: '>=', is_eliminating: false, reason: 'Observation synthétique', updated_at: '2026-06-19T12:00:00Z' },
    { instrument_key: key, horizon_years: h, criterion_key: 'revenue_cagr', category: 'growth', label: 'Croissance du CA', status: 'missing', actual: null, threshold: 0.05, comparator: '>=', is_eliminating: true, reason: 'Année absente ; ce n’est pas un échec.', updated_at: '2026-06-19T12:00:00Z' },
    { instrument_key: key, horizon_years: h, criterion_key: 'net_debt', category: 'health', label: 'Dette nette', status: 'fail', actual: 4, threshold: 3, comparator: '<', is_eliminating: true, reason: 'Exemple d’éliminatoire échoué', updated_at: '2026-06-19T12:00:00Z' }])
  const prices = Array.from({ length: 350 }, (_, i) => ({ ticker: 'ASTER', date: new Date(Date.UTC(2020, 0, 6 + i * 7)).toISOString().slice(0, 10), adj_close: 60 + i * 0.2 + Math.sin(i / 10) * 6, adj_close_local: 60 + i * 0.2 + Math.sin(i / 10) * 6, local_currency: 'EUR', fx_rate_to_eur: 1, source: 'fixture', updated_at: '2026-10-18T12:00:00Z' }))
  return { equity_screener_latest: scenario === 'empty' ? [] : equity, trident_screener_latest: scenario === 'empty' ? [] : trident, trident_equity_universe: trident,
    trident_results: [], trident_criterion_results: criteria, trident_financial_annual: annual, equity_financial_interim: interim, equity_reporting_calendar: events,
    trident_stock_insights: [{ instrument_key: key, ticker: 'ASTER', provider_symbol: 'ASTER.IT', name: 'Aster Systems', business_summary: 'Entreprise fictive pour vérifier le parcours de recherche.', source_provider: 'fixture', updated_at: '2026-06-19T12:00:00Z', news_items: [], data_state: ['STALE'] }],
    // The short ticker deliberately belongs to a different share class/currency.
    historical_prices: [...prices.map(row => ({ ...row, adj_close: 9, adj_close_local: 10, local_currency: 'USD', fx_rate_to_eur: 0.9 })), ...prices.map(row => ({ ...row, ticker: 'ASTER.IT' }))], currencies: [], etl_runs: [], equity_screener_results: [] }
}
export function createReadClient(tables, fail = () => false) {
  const reads = [], mutations = []
  return { reads, mutations, from(table) {
    if (!(table in tables)) throw new Error(`Unexpected synthetic table ${table}`)
    const request = { table, filters: [], orders: [], start: 0, end: Infinity, single: false, head: false }
    const query = {
      select(selector, options) { request.selector = selector; request.head = Boolean(options?.head); return proxy },
      order(column, options) { request.orders.push([column, options?.ascending !== false]); return proxy },
      range(start, end) { request.start = start; request.end = end; return proxy },
      limit(limit) { request.end = limit - 1; return proxy },
      eq(key, value) { request.filters.push(['eq', key, value]); return proxy },
      gte(key, value) { request.filters.push(['gte', key, value]); return proxy },
      lte(key, value) { request.filters.push(['lte', key, value]); return proxy },
      maybeSingle() { request.single = true; return proxy },
      then(resolve, reject) { return Promise.resolve().then(() => {
        reads.push({ ...request })
        if (fail(request)) return { data: null, error: { code: '42501', message: 'Synthetic reader failure' }, count: null }
        let rows = tables[table].filter(row => request.filters.every(([op, key, value]) => op === 'eq' ? row[key] === value : op === 'gte' ? row[key] >= value : row[key] <= value))
        rows = [...rows].sort((a, b) => { for (const [key, asc] of request.orders) {
          if (a[key] == null && b[key] != null) return 1
          if (b[key] == null && a[key] != null) return -1
          const result = typeof a[key] === 'number' && typeof b[key] === 'number' ? a[key] - b[key] : String(a[key] ?? '').localeCompare(String(b[key] ?? ''))
          if (result) return asc ? result : -result
        } return 0 })
        const count = rows.length
        rows = rows.slice(request.start, request.end + 1)
        return { data: request.head ? null : request.single ? rows[0] ?? null : rows, count, error: null }
      }).then(resolve, reject) },
    }
    const proxy = new Proxy(query, { get(target, key) {
      if (Object.hasOwn(target, key)) return target[key]
      mutations.push(String(key)); throw new Error(`Mutation/unsupported operation forbidden: ${String(key)}`)
    } })
    return proxy
  } }
}
