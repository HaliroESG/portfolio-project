import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createReadClient, equityRow, researchTables, tridentRow } from './fixtures/research-fixtures.mjs'
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try { return next(specifier + '.ts', context) } catch { /* Node/Next extension parity. */ }
  }
  return next(specifier, context)
} })
const model = await import('../lib/researchModel.ts')
const { loadResearchBundle } = await import('../lib/researchData.ts')
const { loadEquityScreenerBundle } = await import('../lib/equityScreenerData.ts')
const { loadAssetPriceHistoryWithFallback } = await import('../lib/priceHistory.ts')
const { isNavigationActive } = await import('../lib/navigation.ts')
const defaults = model.DEFAULT_RESEARCH_STATE
let count = 0
async function test(name, run) { await run(); count++; console.log(`PASS ${name}`) }
const q = equityRow(), t = tridentRow()
const joined = model.joinResearchRows([q], [t], true)[0]

await test('same canonical instrument joins; primary score never averages two scores', () => {
  assert.equal(joined.key, q.instrument_key); assert.equal(model.primaryScore(joined), 94); assert.equal(joined.trident.score, 71)
  assert.deepEqual(joined.issues, [])
})
await test('different share classes with same ticker are never deduplicated', () => {
  const rows = model.joinResearchRows([q, { ...q, instrument_key: 'fixture:ASTER:B' }], [t], true)
  assert.equal(rows.length, 2); assert.equal(rows.find(row => row.key.endsWith(':B')).trident, null)
})
await test('symbol-keyed history cannot substitute a shared ticker for another share class', () => {
  const rows = model.joinResearchRows([q, { ...q, instrument_key: 'fixture:ASTER:B', provider_symbol: 'ASTER.B' }], [t], true)
  assert.equal(rows[0].priceTicker, 'ASTER.IT'); assert.equal(rows[1].priceTicker, 'ASTER.B')
  const ambiguous = model.joinResearchRows([q, { ...q, instrument_key: 'fixture:ASTER:B' }], [t], true)
  assert.ok(ambiguous.every(row => row.priceTicker === null))
  assert.equal(joined.priceTicker, 'ASTER.IT'); assert.equal(joined.priceFallbackSymbol, null)
  assert.equal(model.joinResearchRows([q], [t])[0].priceTicker, null) // Completeness must be explicit.
  assert.equal(model.joinResearchRows([{ ...q, provider_symbol: null }], [], true)[0].priceTicker, null)
})
await test('asymmetric universes preserved; Trident score never substitutes missing QV', () => {
  const rows = model.joinResearchRows([q], [{ ...t, instrument_key: 'other', score: 100 }], true)
  assert.equal(rows.length, 2); assert.equal(model.primaryScore(rows.find(row => row.key === 'other')), null)
})
await test('identity conflicts quarantine ratios and criteria instead of choosing a source', () => {
  for (const field of ['ticker', 'currency', 'exchange', 'provider_symbol', 'provider', 'country']) {
    const row = model.joinResearchRows([q], [{ ...t, [field]: 'DIFFERENT' }], true)[0]
    assert.equal(row.equity, null); assert.equal(row.trident, null); assert.equal(model.primaryScore(row), null)
    assert.equal(model.qualification(row).tone, 'danger')
  }
})
await test('duplicate source keys are quarantined while the unique peer remains identified', () => {
  const row = model.joinResearchRows([q, { ...q, ticker: 'BAD' }], [t], true)[0]
  assert.equal(row.equity, null); assert.equal(row.identity, t); assert.equal(row.trident, t)
  const both = model.joinResearchRows([q, q], [t, t], true)[0]
  assert.equal(both.equity, null); assert.equal(both.trident, null)
})
await test('all claims survive conflict/duplicate quarantine, either reader, alias field and input order', () => {
  for (const field of ['provider_symbol', 'ticker']) for (const side of ['equity', 'trident']) {
    for (const mode of ['conflict', 'duplicate']) for (const reverse of [false, true]) {
      const qb = equityRow({ instrument_key: 'fixture:ASTER:B', ticker: 'ASTER.B', provider_symbol: 'ASTER.B', currency: 'USD', exchange: 'New York' })
      const tb = tridentRow(qb), claims = { equity: [q, qb], trident: [t, tb] }
      const other = { ...claims[side][1], [field]: ' aStEr.iT ' }
      if (mode === 'duplicate') claims[side].push(other)
      else claims[side][1] = other
      if (reverse) { claims.equity.reverse(); claims.trident.reverse() }
      const before = JSON.stringify(claims)
      const rows = model.joinResearchRows(claims.equity, claims.trident, true)
      const a = rows.find(row => row.key === q.instrument_key)
      assert.equal(a.priceTicker, null, `${side}/${mode}/${field}/${reverse}`)
      assert.equal(a.priceFallbackSymbol, null)
      assert.ok(a.issues.some(issue => issue.includes('symbole de cours revendiqué')))
      assert.equal(model.qualification(a).label, 'À vérifier')
      assert.ok(rows.find(row => row.key === qb.instrument_key).issues.length > 0)
      assert.equal(JSON.stringify(claims), before)
    }
  }
})
await test('unidentified claims block shared symbols without inventing an instrument', () => {
  for (const side of ['equity', 'trident']) {
    const rows = model.joinResearchRows(side === 'equity' ? [q, { ...q, instrument_key: ' ' }] : [q], side === 'trident' ? [t, { ...t, instrument_key: '' }] : [t], true)
    assert.equal(rows.length, 1); assert.equal(rows[0].priceTicker, null)
  }
})
await test('same-owner repeated claims and unrelated conflicts do not erase valid price identity', () => {
  const qb = equityRow({ instrument_key: 'fixture:ASTER:B', ticker: 'ASTER.B', provider_symbol: 'ASTER.B' })
  for (const reverse of [false, true]) {
    const equity = [q, q, qb], trident = [t, tridentRow({ ...qb, provider_symbol: 'ASTER.C' })]
    if (reverse) { equity.reverse(); trident.reverse() }
    const a = model.joinResearchRows(equity, trident, true).find(row => row.key === q.instrument_key)
    assert.equal(a.priceTicker, 'ASTER.IT'); assert.equal(a.priceFallbackSymbol, null)
    assert.equal(a.equity, null); assert.ok(a.trident)
  }
})
await test('typed readers preserve quarantined claims before price requests can be authorized', async () => {
  for (const side of ['equity_screener_latest', 'trident_screener_latest']) for (const mode of ['conflict', 'duplicate']) {
    const tables = researchTables()
    const qb = equityRow({ instrument_key: 'fixture:ASTER:B', ticker: 'ASTER.B', provider_symbol: 'ASTER.B', currency: 'USD', exchange: 'New York' })
    tables.equity_screener_latest = [q, qb]; tables.trident_screener_latest = [t, tridentRow(qb)]
    const claim = { ...tables[side][1], provider_symbol: 'ASTER.IT' }
    if (mode === 'duplicate') tables[side].push(claim)
    else tables[side][1] = claim
    tables.historical_prices = tables.historical_prices.filter(row => row.ticker === 'ASTER').map(row => ({ ...row, ticker: 'ASTER.IT', source: 'fixture-class-B' }))
    const client = createReadClient(tables), bundle = await loadResearchBundle(client)
    const a = bundle.rows.find(row => row.key === q.instrument_key)
    assert.equal(a.priceTicker, null); assert.equal(a.priceFallbackSymbol, null)
    assert.ok(a.issues.some(issue => issue.includes('symbole de cours revendiqué')))
    assert.equal(client.reads.filter(read => read.table === 'historical_prices').length, 0)
    assert.deepEqual(client.mutations, [])
  }
})
await test('zero differs from absent, nonfinite and out-of-range scores', () => {
  for (const score of [null, undefined, NaN, Infinity, -1, 101]) assert.equal(model.primaryScore({ ...joined, equity: { ...q, quality_value_score: score } }), null)
  assert.equal(model.primaryScore({ ...joined, equity: { ...q, quality_value_score: 0 } }), 0)
})
await test('actual parser does not invent zero or accept numeric junk', async () => {
  for (const value of [null, undefined, '', '94junk', Infinity, '0x10']) {
    const client = createReadClient({ equity_screener_latest: [equityRow({ quality_value_score: value })], etl_runs: [], equity_screener_results: [] })
    assert.equal((await loadEquityScreenerBundle(client)).rows[0].quality_value_score, null)
  }
  const client = createReadClient({ equity_screener_latest: [equityRow({ quality_value_score: '0' })], etl_runs: [], equity_screener_results: [] })
  assert.equal((await loadEquityScreenerBundle(client)).rows[0].quality_value_score, 0)
})
await test('qualification is explicitly historical; never certifies current Top Quality', () => {
  for (const state of ['QUALIFIED', 'WATCHLIST', 'REJECTED', 'NO_DATA', null]) {
    const row = { ...joined, trident: { ...t, overall_state: state } }
    assert.notEqual(model.qualification(row).tone, 'positive')
    assert.deepEqual(model.filterResearch([row], { ...defaults, view: 'top' }), [])
  }
})
await test('civil observation dates are strict, future dates explicit, collection not substituted', () => {
  for (const value of [null, '', '2026-02-30', '2026-10-19T00:00:00Z', 'today']) assert.equal(model.observationDate(value), null)
  assert.match(model.observationLabel('2099-01-01', new Date('2026-10-19T00:00:00Z')), /future/)
  assert.equal(model.observationLabel(null), 'Date non attestée')
  assert.equal(model.observationLabel('2026-06-19'), 'Observé le 19/06/2026')
})
await test('URL round trip preserves all filters, sort, page, issuer, tab and horizon', () => {
  const state = { ...defaults, query: 'A & B', country: 'FR', sector: 'Tech', exchange: 'Paris', theme: 'IT_SERVICES', state: 'WATCHLIST', tag: 'FAIR', preset: 'QUALITY_VALUE', minScore: '40', maxPe: '20', minYield: '3.5', sort: 'pe', direction: 'asc', page: 3, instrument: 'fixture:A/B?x=#', tab: 'quality', horizon: 10 }
  assert.deepEqual(model.readResearchState(new URL(model.researchHref(state), 'https://example.invalid').searchParams), state)
  assert.equal(model.researchHref(defaults), '/research')
})
await test('malformed query parameters cannot select invalid tabs or unbounded pages', () => {
  const state = model.readResearchState(new URLSearchParams('tab=evil&horizon=200&minScore=Infinity&maxPe=-2&minYield=bad&page=-10&sort=unknown&view=green'))
  assert.deepEqual(state, defaults)
})
await test('unknown filters remain explicit instead of silently matching the entire universe', () => {
  assert.equal(model.filterResearch([joined], { ...defaults, country: 'XX' }).length, 0)
  assert.equal(model.filterResearch([joined], { ...defaults, state: 'NOT_A_STATE' }).length, 0)
})
await test('zero thresholds retain true zeros and reject missing ratios', () => {
  const zero = { ...joined, key: 'zero', equity: { ...q, quality_value_score: 0, fcf_yield: 0 } }
  const missing = { ...joined, key: 'missing', equity: { ...q, quality_value_score: null, fcf_yield: null, forward_pe: null } }
  assert.deepEqual(model.filterResearch([zero, missing], { ...defaults, minScore: '0' }).map(r => r.key), ['zero'])
  assert.deepEqual(model.filterResearch([zero, missing], { ...defaults, minYield: '0' }).map(r => r.key), ['zero'])
})
await test('PER filter uses forward only, not a hidden minimum or trailing replacement', () => {
  const row = { ...joined, equity: { ...q, forward_pe: 30, trailing_pe: 8 } }
  assert.equal(model.filterResearch([row], { ...defaults, maxPe: '20' }).length, 0)
  assert.equal(model.filterResearch([{ ...row, equity: { ...q, forward_pe: -1 } }], { ...defaults, maxPe: '20' }).length, 0)
})
await test('missing sort values stay last in both directions and ties use canonical identity', () => {
  const missing = { ...joined, key: 'empty', equity: null }, b = { ...joined, key: 'b' }, a = { ...joined, key: 'a' }
  for (const direction of ['asc', 'desc']) assert.deepEqual(model.filterResearch([missing, b, a], { ...defaults, direction }).map(row => row.key), ['a', 'b', 'empty'])
})
await test('search and country/sector/exchange/theme/tag/state filters compose without changing source rows', () => {
  const before = JSON.stringify(joined)
  assert.equal(model.filterResearch([joined], { ...defaults, query: 'it services', country: 'IT', sector: 'Technology', exchange: 'Milan', theme: 'IT_SERVICES', tag: 'POTENTIAL_VALUE', state: 'WATCHLIST' }).length, 1)
  assert.equal(JSON.stringify(joined), before)
})
await test('all legacy exploration presets remain available, without supplying a score', () => {
  for (const preset of model.RESEARCH_PRESETS) assert.equal(typeof model.matchesResearchPreset(q, preset), 'boolean')
  assert.equal(model.matchesResearchPreset(q, 'ESN_UNIVERSE'), true)
  assert.equal(model.matchesResearchPreset(q, 'IT_SERVICES_VALUE'), true)
  assert.equal(model.matchesResearchPreset(q, 'FCF_COMPOUNDERS'), true)
  assert.equal(model.matchesResearchPreset(q, 'QUALITY_VALUE'), true)
  assert.equal(model.matchesResearchPreset(q, 'MOMENTUM_TREND'), true)
  assert.equal(model.matchesResearchPreset({ ...q, themes: ['SOFTWARE'] }, 'SECTOR_BOOMS'), true)
  assert.equal(model.matchesResearchPreset(null, 'QUALITY_VALUE'), false)
})
await test('unsafe source URLs are not actionable', () => {
  for (const raw of ['javascript:alert(1)', 'data:text/html,test', '//example.invalid', 'https://user:password@example.invalid']) assert.equal(model.safeSourceUrl(raw), null)
  assert.equal(model.safeSourceUrl('https://example.invalid/report'), 'https://example.invalid/report')
})
await test('all pages read in stable order, even with more than 1000 tied scores', async () => {
  const client = createReadClient(researchTables('ready', 1105))
  const bundle = await loadResearchBundle(client)
  assert.equal(bundle.status, 'READY'); assert.equal(bundle.rows.length, 1106)
  assert.equal(new Set(bundle.rows.map(row => row.key)).size, 1106)
  for (const table of ['equity_screener_latest', 'trident_screener_latest']) {
    const reads = client.reads.filter(read => read.table === table)
    assert.equal(reads.length, 2)
    assert.ok(reads.every(read => read.orders.some(([key]) => key === 'instrument_key')))
  }
  assert.deepEqual(client.mutations, [])
})
await test('single reader failure remains partial; dual failure is not an empty success', async () => {
  for (const failed of ['equity_screener_latest', 'trident_screener_latest']) {
    const client = createReadClient(researchTables(), read => read.table === failed)
    const bundle = await loadResearchBundle(client)
    assert.equal(bundle.status, 'PARTIAL'); assert.ok(bundle.rows.length > 0); assert.ok(bundle.messages.length > 0)
    assert.ok(bundle.rows.every(row => row.priceTicker === null && row.priceFallbackSymbol === null))
    if (failed === 'equity_screener_latest') assert.ok(bundle.rows.every(row => model.primaryScore(row) === null))
  }
  const failed = await loadResearchBundle(createReadClient(researchTables(), read => read.table.endsWith('screener_latest')))
  assert.equal(failed.status, 'ERROR'); assert.equal(failed.rows.length, 0)
  assert.equal((await loadResearchBundle(createReadClient(researchTables('empty')))).status, 'READY')
})
await test('partial reader cannot turn another class ticker into the surviving issuer price identity', async () => {
  for (const failed of ['equity_screener_latest', 'trident_screener_latest']) {
    const tables = researchTables()
    const survivor = failed === 'equity_screener_latest' ? 'trident_screener_latest' : 'equity_screener_latest'
    tables[survivor] = tables[survivor].filter(row => row.instrument_key !== 'fixture:ASTER:B')
    const complete = (await loadResearchBundle(createReadClient(tables))).rows.find(row => row.key === q.instrument_key)
    assert.equal(complete.priceTicker, 'ASTER.IT')
    const partial = await loadResearchBundle(createReadClient(tables, read => read.table === failed))
    const survivingA = partial.rows.find(row => row.key === q.instrument_key)
    assert.ok(survivingA); assert.equal(survivingA.priceTicker, null); assert.equal(survivingA.priceFallbackSymbol, null)
    assert.ok(survivingA.issues.some(issue => issue.includes('lecteur indisponible')))
  }
})
await test('explicit price source reads EUR class A, never available USD class B or short-ticker fallback', async () => {
  const tables = researchTables(), client = createReadClient(tables)
  const result = await loadAssetPriceHistoryWithFallback(client, joined.priceTicker, joined.priceFallbackSymbol, 'MAX')
  assert.ok(result.points.length > 0); assert.equal(result.points[0].price_local, 60); assert.equal(result.points[0].local_currency, 'EUR')
  assert.ok(client.reads.every(read => read.filters.some(([op, key, value]) => op === 'eq' && key === 'ticker' && value === 'ASTER.IT')))
  tables.historical_prices = tables.historical_prices.filter(row => row.ticker !== 'ASTER.IT')
  const missingClient = createReadClient(tables)
  const missing = await loadAssetPriceHistoryWithFallback(missingClient, joined.priceTicker, joined.priceFallbackSymbol, 'MAX')
  assert.equal(missing.points.length, 0); assert.equal(missing.fallback_used, false)
  assert.equal(missingClient.reads.length, 1); assert.ok(missingClient.reads[0].filters.some(([, key, value]) => key === 'ticker' && value === 'ASTER.IT'))
})
await test('sidebar distinguishes operations/closes and exact path boundaries', () => {
  assert.equal(isNavigationActive('/operations', 'view=closes', '/operations'), false)
  assert.equal(isNavigationActive('/operations', 'view=closes', '/operations?view=closes'), true)
  assert.equal(isNavigationActive('/operations', '', '/operations'), true)
  assert.equal(isNavigationActive('/operations', '', '/operations?view=closes'), false)
  assert.equal(isNavigationActive('/research-other', '', '/research'), false)
})
console.log(`PASS research: ${count} offline checks; no provider, database writes or activation`)
