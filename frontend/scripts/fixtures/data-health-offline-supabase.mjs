// Synthetic transport for the real DataHealthPanel. No provider client is loaded.
const attempted = (total, success, coverage) => ({
  items_total: total, items_success: success, items_failed: total - success, coverage_pct: coverage,
})
const rows = {
  'no-attempts': [['SUCCESS', attempted(1, 1, 50)], ['SUCCESS', attempted(0, 0, 0)]],
  'true-zero': [['SUCCESS', attempted(1, 1, 50)], ['FAILED', attempted(2, 0, 0)]],
  'failed-partial': [['SUCCESS', attempted(10, 10, 50)], ['FAILED', attempted(10, 8, 25)]],
  mixed: [['SUCCESS', attempted(1, 1, 50)], ['SUCCESS', attempted(10, 7, 95)],
    ['FAILED', { coverage_pct: 25 }], ['SUCCESS', attempted(0, 0, 0)]],
  coverage: [['FAILED', { coverage_pct: 75 }], ['RUNNING', { coverage_pct: 0 }], ['SUCCESS', {}]],
  status: [['SUCCESS', {}], ['FAILED', {}], ['RUNNING', {}]],
  missing: [['RUNNING', {}], ['RUNNING', {}]],
  legacy: [['SUCCESS', { assets_total: 10, tickers_ok: 8, tickers_failed: 2, coverage_pct: 80 }],
    ['RUNNING', { assets_total: 0, tickers_ok: 0, tickers_failed: 0 }]],
  improving: [['SUCCESS', attempted(10, 4, 50)], ['SUCCESS', attempted(0, 0, 0)],
    ['SUCCESS', attempted(10, 5, 50)], ['SUCCESS', attempted(10, 8, 50)],
    ['SUCCESS', attempted(10, 9, 50)], ['SUCCESS', attempted(0, 0, 0)]],
}
const scenario = new URLSearchParams(window.location.search).get('scenario') || 'no-attempts'
if (!Object.hasOwn(rows, scenario)) throw new Error('Unknown offline data-health scenario')
const runs = rows[scenario].map(([status, stats], i) => ({
  job_name: 'equity_publications_sync', status, stats,
  started_at: `2026-10-${String(i + 10).padStart(2, '0')}T12:00:00Z`,
  finished_at: status === 'RUNNING' ? null : `2026-10-${String(i + 10).padStart(2, '0')}T12:01:00Z`,
  duration_sec: status === 'RUNNING' ? null : 60,
  error: status === 'FAILED' ? 'Synthetic fixture failure' : null,
})).reverse()
const tables = new Set(['etl_runs', 'market_watch', 'valuation_snapshots', 'news_feed', 'macro_indicators',
  'macro_series_latest', 'macro_regime_snapshots', 'macro_satellite_targets_latest',
  'trident_stock_insights', 'equity_publication_dashboard_latest'])
window.dataHealthQa = { scenario, reads: [], mutations: [] }
export const supabase = new Proxy({
  from(table) {
    if (!tables.has(table)) throw new Error('Unexpected offline table: ' + table)
    let single = false
    const filters = []
    const query = {
      select() { return proxy }, order() { return proxy }, limit() { return proxy },
      gte() { return proxy }, not() { return proxy },
      eq(key, value) { filters.push([key, value]); return proxy },
      maybeSingle() { single = true; return proxy },
      then(resolve, reject) {
        window.dataHealthQa.reads.push({ table, single, filters })
        const data = table === 'etl_runs' ? runs.filter(r => filters.every(([key, value]) => r[key] === value)) : []
        return Promise.resolve({ data: single ? data[0] || null : data, error: null, count: data.length }).then(resolve, reject)
      },
    }
    const proxy = new Proxy(query, { get(target, key) {
      if (Object.hasOwn(target, key)) return target[key]
      window.dataHealthQa.mutations.push(String(key))
      throw new Error('Only synthetic reads are permitted: ' + String(key))
    } })
    return proxy
  },
}, { get(target, key) {
  if (key === 'from') return target.from
  throw new Error('Provider IO forbidden: ' + String(key))
} })
