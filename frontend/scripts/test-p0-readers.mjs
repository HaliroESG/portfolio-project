import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// Node's strip-types runner does not resolve extensionless TS imports like Next.
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try { return next(specifier + '.ts', context) } catch { /* Delegate non-TS paths. */ }
  }
  return next(specifier, context)
} })
const fx = await import('../lib/fxData.ts')
const fxTrace = await import('../lib/fxTrace.ts')
const macro = await import('../lib/macroData.ts')
const states = await import('../lib/macroState.ts')
const reader = await import('../lib/readerState.ts')
const publications = await import('../lib/equityPublicationsData.ts')
const pagination = await import('../lib/publicationPagination.ts')
const ui = await import('../lib/equityPublicationUi.ts')
let tests = 0
async function test(name, run) { await run(); tests++; console.log(`PASS ${name}`) }
const now = Date.now(), fresh = new Date(now - 1000).toISOString(), old = new Date(now - 5 * 86400000).toISOString()
const indicator = (overrides = {}) => ({ id: '^VIX', name: 'VIX', value: 12, change_pct: null, last_update: fresh, threshold_amber: 20, threshold_red: 30, direction: 'UP', pillar: null, ...overrides })
const pair = (overrides = {}) => ({ ticker: 'EURUSD=X', last_price: 1.1, perf_day_local: 0.1, last_update: fresh, data_status: 'OK', ...overrides })
const event = (i, overrides = {}) => ({ event_key: String(i).padStart(6, '0'), instrument_key: 'instrument-1', ticker: 'TEST', provider_symbol: 'TEST', source_index: 'S&P 500', event_type: 'EARNINGS', event_date: ui.publicationDateKey(new Date()), status: 'ESTIMATED', source_provider: 'synthetic', ...overrides })

function client(tables = {}, options = {}) {
  const calls = []
  return { calls, from(table) {
    const q = { table, filters: [], orders: [], start: 0, end: Infinity, single: false }
    const api = {
      select(selector, opts) { q.selector = selector; q.count = opts?.count; return api },
      order(column, opts) { q.orders.push([column, opts?.ascending !== false]); return api },
      range(start, end) { q.start = start; q.end = end; return api },
      limit(limit) { q.end = limit - 1; return api },
      eq(column, value) { q.filters.push(row => row[column] === value); return api },
      gte(column, value) { q.filters.push(row => row[column] >= value); return api },
      lte(column, value) { q.filters.push(row => row[column] <= value); return api },
      like(column, value) { assert.equal(value, '%=X'); q.filters.push(row => row[column]?.endsWith('=X')); return api },
      maybeSingle() { q.single = true; return api },
      then(resolve, reject) { return Promise.resolve().then(() => {
        calls.push({ ...q })
        const failure = options.fail?.(q)
        if (failure) return { data: null, error: failure, count: null }
        let rows = (tables[table] ?? []).filter(row => q.filters.every(f => f(row)))
        rows.sort((a, b) => { for (const [key, asc] of q.orders) { const order = String(a[key]).localeCompare(String(b[key])); if (order) return asc ? order : -order } return 0 })
        const count = options.noCount ? null : rows.length
        rows = rows.slice(q.start, Math.min(q.end + 1, q.start + (options.cap ?? Infinity)))
        return { data: q.single ? rows[0] ?? null : rows, error: null, count }
      }).then(resolve, reject) },
    }
    return api
  } }
}

await test('strict numbers; no null, blank, NaN, Infinity or junk becomes zero', () => {
  for (const value of [null, undefined, '', ' ', '12junk', Infinity, NaN, '0x10']) assert.equal(reader.finiteNumber(value), null)
  assert.equal(reader.finiteNumber('0'), 0); assert.equal(reader.finiteNumber('-1.25'), -1.25)
})
await test('source timestamps never invented or future-dated', () => {
  for (const value of [null, '', 'not-a-date', '10', '2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z', new Date(now + 86400000).toISOString()]) assert.equal(reader.sourceTimestamp(value, now), null)
  assert.equal(reader.latestSourceTimestamp(['invalid', old, fresh], now), fresh)
  assert.equal(reader.latestSourceTimestamp([]), null)
  assert.equal(reader.observationState(0, fresh, now), 'READY')
  assert.equal(reader.observationState(null, fresh, now), 'MISSING')
  assert.equal(reader.observationState(1, null, now), 'UNKNOWN')
  assert.equal(reader.observationState(1, old, now), 'STALE')
})
await test('FX accepts explicit supported currency pairs, never equities or crypto', () => {
  for (const ticker of ['MSFT', 'EURONEXT', 'BTC-USD', 'USD', 'USD=X', 'ABCDEF=X', 'EUREUR=X']) assert.equal(fx.parseFxPair(pair({ ticker, currency: 'USD', name: 'Currency pair vs EUR' })), null)
  assert.equal(fx.parseFxPair(pair()).quote, 'USD')
  const missing = fx.parseFxPair(pair({ last_price: null, perf_day_local: null, last_update: null }))
  assert.equal(missing.last_price, null); assert.equal(missing.perf_day_local, null); assert.equal(missing.last_update, null)
  assert.equal(fx.parseFxPair(pair({ last_price: -1, perf_day_local: -1 })).perf_day_local, null)
})
await test('L1 supersedes collection-day joins: legacy rates never imply comparable market sessions', () => {
  const rate = fx.parseCurrencyRate({ id: 'USD', rate_to_eur: 0.9, last_update: fresh })
  for (const last_update of [fresh, old, null]) {
    const view = fxTrace.projectLegacyFx({ ...rate, last_update, change_pct: 0.1, status: 'VALIDATED' }, now)
    assert.equal(view.change_pct, null)
    assert.equal(view.observed_date, null)
    assert.equal(view.session_age, null)
    assert.notEqual(view.status, 'VALIDATED')
  }
})
await test('canonical FX rates, nullable fallback and tainted cache isolation', async () => {
  const c = client({ currencies: [{ id: 'USD', rate_to_eur: '0.9', last_update: null }], market_watch: [pair(), pair({ ticker: 'MSFT' })] })
  assert.equal((await fx.loadFxPairs(c)).length, 1)
  assert.equal((await fx.loadCurrencyRates(c))[0].rate_to_eur, 0.9)
  assert.equal(fx.parseFxCache('bad').length, 0)
  assert.equal(fx.parseFxCache(JSON.stringify([{ id: 'USD', rate_to_eur: -1, change_pct: 1 }]))[0].rate_to_eur, null)
  assert.equal('change_pct' in fx.parseFxCache(JSON.stringify([{ id: 'USD', rate_to_eur: 1, change_pct: 1 }]))[0], false)
  const fallback = client({ currencies: [{ id: 'USD', rate_to_eur: 1 }] }, { fail: q => q.selector.includes('last_update') ? { code: '42703' } : null })
  assert.equal((await fx.loadCurrencyRates(fallback))[0].last_update, null)
  const denied = client({}, { fail: () => ({ code: '42501' }) })
  await assert.rejects(fx.loadCurrencyRates(denied)); assert.equal(denied.calls.length, 1)
  await assert.rejects(fx.loadFxPairs(denied))
})
await test('macro errors propagate; schema fallback cannot make a green diagnosis', async () => {
  const denied = client({}, { fail: () => ({ code: '42501' }) })
  await assert.rejects(macro.loadMacroIndicators(denied)); assert.equal(denied.calls.length, 1)
  const fallback = client({ macro_indicators: [{ id: '^VIX', value: 12, last_update: fresh }] }, { fail: q => q.selector.includes('threshold_red') ? { code: '42703' } : null })
  assert.equal(states.macroHealthState(await macro.loadMacroIndicators(fallback)), 'UNKNOWN')
  const unavailable = client({}, { fail: () => ({ code: '42703' }) })
  await assert.rejects(macro.loadMacroIndicators(unavailable)); assert.equal(unavailable.calls.length, 2)
})
await test('duplicate FX identities fail closed, including local cache', async () => {
  await assert.rejects(fx.loadFxPairs(client({ market_watch: [pair(), pair()] })))
  const rates = [{ id: 'USD', rate_to_eur: 1 }, { id: 'usd', rate_to_eur: 2 }]
  await assert.rejects(fx.loadCurrencyRates(client({ currencies: rates })))
  assert.deepEqual(fx.parseFxCache(JSON.stringify(rates)), [])
})
await test('fresh collection never upgrades stale, partial or unknown FX source quality', async () => {
  const rate = fx.parseCurrencyRate({ id: 'USD', rate_to_eur: 0.9, last_update: fresh })
  assert.equal(fx.currencyCollectionState(rate, now), 'COLLECTED')
  for (const [data_status, expected] of [['STALE', 'STALE'], ['PARTIAL', 'PARTIAL'], ['LOW_CONFIDENCE', 'LOW_CONFIDENCE'], [null, 'UNKNOWN'], ['UNSUPPORTED', 'UNKNOWN']]) {
    const parsed = fx.parseFxPair(pair({ data_status }))
    assert.equal(fx.fxPairState(parsed, now), expected)
    assert.equal(fxTrace.projectLegacyFx(rate, now).change_pct, null)
  }
  assert.equal(fx.fxPairState(fx.parseFxPair(pair()), now), 'SOURCE_OK')
  assert.equal(fx.fxPairState(fx.parseFxPair(pair({ last_update: old })), now), 'STALE')
  assert.equal(fx.fxPairState(fx.parseFxPair(pair({ last_update: null })), now), 'UNKNOWN')
  const c = client({ market_watch: [pair({ data_status: 'STALE' })] })
  assert.equal((await fx.loadFxPairs(c))[0].data_status, 'STALE')
  assert.ok(c.calls[0].selector.includes('data_status'))
})
await test('legacy macro collection cannot certify normal, caution or stress without observation provenance', () => {
  for (const value of [12, 20, 30]) assert.equal(states.macroHealthState([indicator({ value })]), 'UNKNOWN')
  assert.equal(states.macroCollectionState(indicator(), now), 'COLLECTED')
  assert.equal(states.macroHealthState([]), 'MISSING')
  assert.equal(states.macroHealthState([indicator({ value: null })]), 'MISSING')
  assert.equal(states.macroHealthState([indicator({ last_update: old })]), 'STALE')
  for (const row of [{ threshold_amber: null }, { threshold_red: null }, { direction: null }, { threshold_red: 10 }, { last_update: null }]) assert.equal(states.macroHealthState([indicator(row)]), 'UNKNOWN')
  assert.equal(states.macroHealthState([indicator()], false, new Error('read')), 'ERROR')
  assert.equal(states.macroHealthState([indicator()], true), 'LOADING')
  assert.equal(states.thresholdState(indicator({ direction: 'DOWN', threshold_red: -1, threshold_amber: 0, value: -2 })), 'UNKNOWN')
})
await test('quarantined pillars never green; strategy PARTIAL never READY', () => {
  assert.equal(states.pillarState([undefined, indicator()], false, false), 'unknown')
  assert.equal(states.pillarState([indicator({ last_update: old })], false, false), 'stale')
  assert.equal(states.pillarState([indicator()], false, false), 'unknown')
  assert.equal(states.pillarState([indicator()], true, false), 'unknown')
  assert.equal(states.pillarState([indicator()], false, false, false, true), 'error')
  for (const state of ['PARTIAL', 'UNKNOWN', 'STALE']) assert.equal(states.macroStrategyState({ regime: 'GOLDILOCKS', regime_state: state, updated_at: fresh }, false, null), state)
  assert.equal(states.macroStrategyState({ regime: 'GOLDILOCKS', regime_state: 'READY', updated_at: null }, false, null), 'UNKNOWN')
  const regime = { id: 'r1', regime: 'GOLDILOCKS', regime_state: 'READY', as_of_date: '2026-10-01', updated_at: fresh }
  const target = { snapshot_id: 'r1', regime: regime.regime, as_of_date: regime.as_of_date, regime_state: 'READY', data_state: 'READY', is_blocked: false, target_weight_pct: 10, effective_weight_pct: 10, updated_at: fresh }
  assert.equal(states.macroTargetUsable(regime, target), false)
  for (const change of [{ snapshot_id: 'other' }, { updated_at: old }, { updated_at: null }, { is_blocked: true }, { regime_state: 'PARTIAL' }]) assert.equal(states.macroTargetUsable(regime, { ...target, ...change }), false)
})
await test('P0-R2-F1: old, future, invalid and fresh as_of dates cannot be promoted by a new collection timestamp', () => {
  for (const as_of_date of ['2000-01-01', '2999-01-01', '2026-02-30', null, '', fresh.slice(0, 10)]) {
    const regime = { id: 'r1', regime: 'GOLDILOCKS', regime_state: 'READY', as_of_date, updated_at: fresh }
    const target = { snapshot_id: 'r1', regime: regime.regime, as_of_date, regime_state: 'READY', data_state: 'READY', is_blocked: false, target_weight_pct: 10, effective_weight_pct: 10, updated_at: fresh }
    assert.equal(states.macroStrategyState(regime, false, null, now), 'UNKNOWN')
    assert.equal(states.macroTargetUsable(regime, target, now), false)
    assert.equal(states.macroStrategyState({ ...regime, updated_at: old }, false, null, now), 'STALE')
    assert.equal(states.macroStrategyState(regime, false, new Error('cache'), now), 'ERROR')
    assert.equal(states.macroStrategyState(regime, true, null, now), 'LOADING')
  }
})
await test('P0-R2-F2: degraded MISERY fallback cannot yield a reassuring inflation or cross-asset signal', async () => {
  for (const value of [2 + 3.7, 3.2 + 3.7, 3.2 + 2, 0, 10]) {
    const loaded = await macro.loadMacroIndicators(client({ macro_indicators: [indicator({ id: 'MISERY_INDEX', value }), indicator({ id: '^TNX', value: 3.5 })] }))
    const misery = loaded.find(row => row.id === 'MISERY_INDEX'), tnx = loaded.find(row => row.id === '^TNX')
    assert.equal(states.macroInputState([misery, tnx], false, null, now), 'UNKNOWN')
    assert.equal(states.pillarState([misery, tnx], value >= 8 || tnx.value >= 4.7, value >= 6.8 || tnx.value >= 4.1, false, null, now), 'unknown')
    assert.equal(states.thresholdState(misery, now), 'UNKNOWN')
    assert.equal(misery.value, value) // Quarantine retains the source value, not a fabricated replacement.
  }
})
await test('P0-R2-F3: source variations stay neutral when collected, stale, unknown, missing, loading or cached on error', () => {
  for (const change_pct of [-0.1, 0, 0.1, null, NaN, Infinity]) {
    for (const last_update of [fresh, old, null]) {
      const row = indicator({ change_pct, last_update })
      assert.equal(states.macroVariationClass(row, false, null, now), 'text-slate-500')
      assert.equal(states.macroVariationClass(row, false, new Error('cache'), now), 'text-slate-500')
      assert.equal(states.macroVariationClass(row, true, null, now), 'text-slate-500')
    }
  }
})
await test('strict civil dates, leap years, month coverage and past estimates', () => {
  for (const invalid of ['2026-02-30', '2026-02-29', '2026-13-01', '2026-1-02', '2026-01-01T00:00:00Z', 'junk']) assert.equal(ui.publicationCivilDate(invalid), null)
  assert.equal(ui.publicationCivilDate('2024-02-29'), '2024-02-29')
  assert.equal(ui.publicationDate('2026-10-25').getDate(), 25)
  assert.equal(ui.publicationStatusLabel('ESTIMATED', '2026-01-01', '2026-10-01'), 'Estimée · échéance passée')
  assert.equal(ui.publicationStatusLabel('REPORTED', '2026-01-01'), 'Publiée')
  assert.equal(ui.publicationMonthCovered(new Date(2026, 9, 1), { start: '2026-09-01', end: '2026-10-31' }), true)
  assert.equal(ui.publicationMonthCovered(new Date(2026, 10, 1), { start: '2026-09-01', end: '2026-10-31' }), false)
})
await test('publication loader fetches >1000 rows despite a smaller server cap, stable order and aligned counts', async () => {
  const c = client({ equity_reporting_calendar: Array.from({ length: 2307 }, (_, i) => event(i)), equity_publication_dashboard_latest: [{ instrument_key: 'instrument-1', ticker: 'TEST', provider_symbol: 'TEST', source_index: 'S&P 500' }] }, { cap: 317 })
  const result = await publications.loadEquityPublicationsBundle(c)
  assert.equal(result.events.length, 2307); assert.equal(result.calendarRead.state, 'COMPLETE')
  assert.equal(result.calendarRead.expected, 2307); assert.equal(result.calendarRead.pages, 8)
  assert.equal(result.coverage.Tous.calendar, 1)
  assert.equal(result.calendarWindow.start.endsWith('-01'), true)
  assert.equal(ui.publicationMonthCovered(new Date(), result.calendarWindow), true)
  const calls = c.calls.filter(q => q.table === 'equity_reporting_calendar')
  assert.deepEqual(calls.map(q => q.start), [0, 317, 634, 951, 1268, 1585, 1902, 2219])
  assert.ok(calls.every(q => q.count === 'exact' && q.orders[0][0] === 'event_key'))
  assert.ok(c.calls.find(q => q.table === 'equity_publication_dashboard_latest').orders[0][0] === 'instrument_key')
})
await test('partial later-page failure preserves rows and never claims complete', async () => {
  const c = client({ equity_reporting_calendar: Array.from({ length: 1500 }, (_, i) => event(i)) }, { fail: q => q.table === 'equity_reporting_calendar' && q.start > 0 ? { message: 'synthetic failure' } : null })
  const result = await publications.loadEquityPublicationsBundle(c)
  assert.equal(result.events.length, 1000); assert.equal(result.calendarRead.state, 'PARTIAL')
  assert.ok(result.calendarRead.reasons.includes('PAGE_READ_FAILED'))
  const denied = client({}, { fail: () => ({ message: 'Permission denied' }) })
  await assert.rejects(publications.loadEquityPublicationsBundle(denied))
})
await test('duplicates, invalid dates and malformed rows cannot produce complete receipts', async () => {
  const result = await pagination.readPublicationPages(async () => ({ data: [{ id: 'one' }, { id: 'one' }, null], error: null, count: 3 }), 'id')
  assert.equal(result.rows.length, 1); assert.equal(result.receipt.state, 'PARTIAL')
  const invalidDateInWindow = ui.publicationDateKey(new Date()).slice(0, 7) + '-00'
  const c = client({ equity_reporting_calendar: [event(1), event(2, { event_date: invalidDateInWindow })] })
  const result2 = await publications.loadEquityPublicationsBundle(c)
  assert.equal(result2.calendarRead.state, 'PARTIAL'); assert.ok(result2.calendarRead.reasons.includes('INVALID_ROWS'))
})
await test('unknown counts probe through short pages; caps and count drift are bounded', async () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const result = await pagination.readPublicationPages(async offset => ({ data: rows.slice(offset, offset + 1), count: null, error: null }), 'id')
  assert.equal(result.receipt.state, 'COMPLETE'); assert.equal(result.receipt.pages, 4)
  const capped = await pagination.readPublicationPages(async offset => ({ data: [{ id: String(offset) }], count: 100, error: null }), 'id', 2)
  assert.equal(capped.receipt.state, 'PARTIAL'); assert.equal(capped.receipt.pages, 2)
  const drift = await pagination.readPublicationPages(async offset => ({ data: rows.slice(offset, offset + 1), count: offset ? 3 : 4, error: null }), 'id')
  assert.ok(drift.receipt.reasons.includes('COUNT_CHANGED'))
})
await test('history preserves annual/interim/event limits and null financial values', async () => {
  const c = client({ equity_reporting_calendar: [event(1)] })
  const result = await publications.loadEquityPublicationHistory(c, 'instrument-1')
  assert.deepEqual(c.calls.map(q => q.end), [4, 7, 23])
  assert.equal(result.events.length, 1)
})
await test('publication search preserves event labels/periods and table-calendar identity parity', () => {
  const rows = [{ instrument_key: 'instrument-1', ticker: 'TEST', name: 'Synthetic', sector: 'Software', source_index: 'CAC 40' }]
  const events = [event(1, { event_label: 'Results Q4 2026', period_kind: 'Q4', fiscal_year: 2026 }), event(2, { event_label: 'Results Q3 2026', period_kind: 'Q3', fiscal_year: 2026 })]
  for (const search of ['Software', 'TEST', 'Synthetic']) {
    const filtered = ui.filterPublicationSearch(rows, events, 'CAC 40', search)
    assert.equal(filtered.rows.length, 1); assert.equal(filtered.events.length, 2)
  }
  const quarter = ui.filterPublicationSearch(rows, events, 'CAC 40', 'Q4 2026')
  assert.equal(quarter.rows.length, 1); assert.equal(quarter.events.length, 1)
  assert.equal(ui.filterPublicationSearch(rows, events, 'S&P 500', '').events.length, 0)
  const orphan = ui.filterPublicationSearch([], events, 'Tous', 'Q4 2026')
  assert.equal(orphan.rows.length, 0); assert.equal(orphan.events.length, 1)
})
console.log(`P0 reader tests: PASS (${tests} groups; synthetic, no provider I/O)`)
