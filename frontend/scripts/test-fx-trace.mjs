// Pure Python -> typed TS -> shared presentation contract. No real client.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../..', import.meta.url))
const fixtures = JSON.parse(readFileSync(path.join(root, 'backend/tests/fixtures/fx_contracts_v1.json'), 'utf8'))
const python = String.raw`
import json, sys
sys.path.insert(0, "tests")
from source_contracts_offline_guard import install
install()
from fx_contracts import prepare_fx_series
data = json.load(sys.stdin)
print(json.dumps([prepare_fx_series(c["rows"], currency=c["currency"], now=data["now"], calendar=c["calendar"])
                  for c in data["cases"]], allow_nan=False))
`
const result = spawnSync('python3.11', ['-B', '-c', python], {
  cwd: path.join(root, 'backend'), env: { PATH: process.env.PATH, PYTHONNOUSERSITE: '1' },
  input: JSON.stringify(fixtures), encoding: 'utf8', timeout: 10000,
})
assert.equal(result.error, undefined)
assert.equal(result.status, 0, 'Offline normalization failed')
const payloads = JSON.parse(result.stdout)
function diagnostics(values) {
  const virtual = path.join(root, 'frontend/scripts/__fx_fixture__.ts')
  const code = "import type { FxTraceV1 } from '../types';\n" + values.map((v, i) =>
    'const fixture' + i + ' = ' + JSON.stringify(v) + ' satisfies FxTraceV1;').join('\n')
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] }
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, language, error, fresh) => file === virtual
    ? ts.createSourceFile(file, code, language, true) : original(file, language, error, fresh)
  return ts.getPreEmitDiagnostics(ts.createProgram([virtual], options, host))
}
assert.equal(diagnostics(payloads).length, 0, 'Python outputs must satisfy FxTraceV1')
for (const invalid of [
  { ...payloads[0], scope: 'LIVE' }, { ...payloads[0], operational_authority: true },
  { ...payloads[0], currency: 'BTC' }, { ...payloads[0], change_pct: '10%' },
]) assert.ok(diagnostics([invalid]).length, 'Negative type control')

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try { return next(specifier + '.ts', context) } catch { /* Non-TS path. */ }
    }
    return next(specifier, context)
  },
  // Existing consumers use non-type imports. Match the real TS compilation,
  // rather than patching production files just for Node's strip-types runner.
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/')) {
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText }
    }
    return next(url, context)
  },
})
const { projectOfflineFxTrace, projectLegacyFx, eurIdentity } = await import('../lib/fxTrace.ts')
const { parseFxCache, parseCurrencyRate, loadCurrencyRates } = await import('../lib/fxData.ts')
for (const [i, payload] of payloads.entries()) {
  const row = projectOfflineFxTrace(payload), expected = fixtures.cases[i].expected
  assert.equal(row.status, expected.status)
  assert.equal(row.provenance, 'OFFLINE_SYNTHETIC')
  assert.equal(row.change_pct, payload.change_pct)
  if (row.status === 'CONFLICT') assert.equal(row.rate_to_eur, null)
  assert.equal(row.session_age, expected.age)
  if (payload.current) {
    assert.equal(row.last_update, payload.current.observation.collected_at)
    assert.equal(row.observed_date, payload.current.observation.identity.observed_date)
  }
}
for (const patch of [{ scope: 'LIVE' }, { ticker: 'EURUSD=X' }, { currency: 'BTC' }, { change_pct: .99 }, { operational_authority: true }]) {
  assert.throws(() => projectOfflineFxTrace({ ...payloads[0], ...patch }))
}
const identity = eurIdentity()
assert.equal(identity.rate_to_eur, 1)
assert.equal(identity.observed_date, null)
assert.equal(identity.provider, null)
assert.equal(identity.last_update, null)
assert.equal(identity.change_pct, null)
assert.equal(projectLegacyFx({ id: 'EUR', rate_to_eur: 2 }).status, 'CONFLICT')
assert.equal(projectLegacyFx({ id: 'EUR', rate_to_eur: 2 }).rate_to_eur, null)

const now = Date.now(), fresh = new Date(now - 1000).toISOString()
const legacy = { id: 'USD', symbol: '$', rate_to_eur: .99, last_update: fresh,
  status: 'VALIDATED', observed_date: '2026-10-16', change_pct: .1, trace: payloads[0] }
const view = projectLegacyFx(legacy)
assert.equal(view.status, 'UNKNOWN')
assert.equal(view.change_pct, null)
assert.equal(view.observed_date, null)
assert.equal(view.provider, null)
assert.equal(view.rate_to_eur, .99)
const cached = parseFxCache(JSON.stringify([legacy]))[0]
assert.deepEqual(Object.keys(cached).sort(), ['id', 'symbol', 'rate_to_eur', 'last_update'].sort())
assert.equal(projectLegacyFx(cached).status, 'UNKNOWN')
for (const bad of [null, '', 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.equal(parseCurrencyRate({ id: 'USD', rate_to_eur: bad }).rate_to_eur, null)
}
assert.equal(projectLegacyFx({ ...legacy, last_update: new Date(now - 5 * 86400000).toISOString() }).status, 'STALE')
assert.equal(projectLegacyFx({ ...legacy, last_update: null }).status, 'UNKNOWN')

function client(tables, fail = () => null) {
  const calls = []
  return { calls, from(table) {
    let start = 0, end = Infinity, single = false, selector = ''
    const api = {
      select(value) { selector = value; return api }, order() { return api }, eq() { return api },
      limit(value) { end = value - 1; return api }, range(a, b) { start = a; end = b; return api },
      maybeSingle() { single = true; return api },
      then(resolve, reject) {
        calls.push({ table, selector })
        const error = fail(table, selector), rows = (tables[table] ?? []).slice(start, end + 1)
        return Promise.resolve({ data: error ? null : single ? rows[0] ?? null : rows, error, count: rows.length }).then(resolve, reject)
      },
    }
    for (const mutation of ['insert', 'update', 'upsert', 'delete', 'rpc']) api[mutation] = () => { throw new Error('Database mutation forbidden') }
    return api
  } }
}
const rates = payloads.slice(0, 4).map(payload => {
  const view = projectOfflineFxTrace(payload)
  return { id: view.id, symbol: view.symbol, rate_to_eur: view.rate_to_eur, last_update: fresh }
})
const current = client({ currencies: rates })
assert.deepEqual(await loadCurrencyRates(current), rates)
const oldSchema = client({ currencies: rates.map(row => ({ id: row.id, symbol: row.symbol, rate_to_eur: row.rate_to_eur })) }, (_, selector) => selector.includes('last_update') ? { code: '42703' } : null)
assert.ok((await loadCurrencyRates(oldSchema)).every(row => projectLegacyFx(row).observed_date === null))
assert.equal(oldSchema.calls.length, 2)
const denied = client({}, () => ({ code: '42501' }))
await assert.rejects(loadCurrencyRates(denied))
assert.equal(denied.calls.length, 1)

const { loadPortfolioAggregation } = await import('../lib/portfolioData.ts')
const mock = client({ currencies: rates,
  portfolios: [{ id: 'synthetic', name: 'Synthetic' }],
  market_watch: rates.map(row => ({ ticker: `FIXTURE_${row.id}`, name: 'Synthetic', currency: row.id,
    last_price: 100, type: 'Stock', last_update: fresh, data_status: 'OK' })),
  portfolio_positions: rates.map(row => ({ portfolio_id: 'synthetic', ticker: `FIXTURE_${row.id}`,
    currency: row.id, quantity_current: 2, quantity_buy: 2, pru: 50 })),
})
const bundle = await loadPortfolioAggregation(mock)
for (const rate of rates) {
  assert.equal(bundle.currencies.find(row => row.id === rate.id).rate_to_eur, rate.rate_to_eur)
  assert.equal(bundle.assetsByPortfolio.ALL.find(row => row.ticker === `FIXTURE_${rate.id}`).market_value_eur, 200 * rate.rate_to_eur)
}
// Targets and screener consume already-valued fields. L1 must not recalculate
// their historical values or replace their explicit FX date with collection time.
const { parseTargetEnvelopeLines } = await import('../lib/targetModelReaders.ts')
const target = parseTargetEnvelopeLines([{ id: 1, model_id: 'fixture', envelope: 'fixture', portfolio_scope: 'PERSO', currency: 'USD', target_value_eur: 99 }])[0]
assert.equal(target.target_value_eur, 99)
assert.equal(target.currency, 'USD')
const { loadEquityScreenerBundle } = await import('../lib/equityScreenerData.ts')
const screener = await loadEquityScreenerBundle(client({ equity_screener_latest: [{ instrument_key: 'fixture', ticker: 'FIXTURE', provider: 'fixture',
  currency: 'USD', market_cap: 100, market_cap_usd: 100, market_cap_fx_rate: .99, market_cap_fx_as_of: '2026-10-16', updated_at: fresh }] }))
assert.equal(screener.rows[0].market_cap_fx_as_of, '2026-10-16')
assert.equal(screener.rows[0].market_cap_fx_rate, .99)
assert.equal(screener.rows[0].market_cap_usd, 100)
const supports = readFileSync(path.join(root, 'frontend/app/supports/page.tsx'), 'utf8')
assert.equal(/rate_to_eur|from\(['"]currencies['"]\)/.test(supports), false,
  'Supports catalogue has no FX conversion reader; do not invent one in L1')
console.log(JSON.stringify({ status: 'PASS', python_ts_fixtures: payloads.length, negative_type_controls: 4,
  negative_runtime_controls: 5, pilot_currency_parity: 4, legacy_cache_schema_guards: 'PASS',
  consumers: { portfolio: 'PASS valid rates', targets: 'PASS EUR values preserved', screener: 'PASS dated valuation preserved', supports: 'NOT_APPLICABLE no FX conversion' },
  network: 'FORBIDDEN', database_mutations: 0, operational_authority: false }))
