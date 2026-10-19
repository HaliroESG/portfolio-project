import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { allocationFixture, fixtureCache, pageKeys } from './fixtures/allocation-readers.mjs'
import * as readers from '../lib/targetModelReaders.ts'
import * as family from '../lib/familyOfficeAllocation.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const parsers = {
  target_models: readers.parseTargetModels,
  target_buckets: readers.parseTargetBuckets,
  target_sleeve_allocations: readers.parseTargetSleeves,
  target_envelope_lines: readers.parseTargetEnvelopeLines,
  fo_portfolios: readers.parseTargetPortfolios,
}
const malformed = {
  target_models: { source_file: '' },
  target_buckets: { lower_band_pct: 'NaN' },
  target_sleeve_allocations: { component_label: '' },
  target_envelope_lines: { envelope: '' },
  fo_portfolios: { id: '' },
}
let scenarios = 0
for (const scope of ['PERSO', 'PRO']) {
  const fixture = allocationFixture(scope)
  const tables = {
    target_models: [fixture.model], target_buckets: fixture.buckets,
    target_sleeve_allocations: fixture.sleeves, target_envelope_lines: fixture.lines,
    fo_portfolios: fixture.portfolios,
  }
  // Reject the entire collection, not just the malformed row.
  for (const [table, parse] of Object.entries(parsers)) {
    assert.equal(parse(tables[table]).length, tables[table].length)
    for (const raw of [null, {}, [null], [...tables[table], { ...tables[table][0], ...malformed[table] }]]) {
      assert.throws(() => parse(raw), /invalid row/)
    }
  }
  for (const value of ['NaN', 'Infinity', '-Infinity', '100garbage', '', {}, NaN, Infinity, -Infinity]) {
    assert.throws(() => readers.parseTargetModels([{ ...fixture.model, target_total_pct: value }]), /invalid row/)
    assert.throws(() => readers.parseTargetModels([{ ...fixture.model, reserve_floor_eur: value }]), /invalid row/)
    const assessment = family.assessFamilyOfficeAllocation(fixture.allocation, { ...fixture.model, target_total_pct: value }, fixture.lines, {
      expectedScope: scope, targetBuckets: fixture.buckets, targetSleeves: fixture.sleeves,
    })
    assert.equal(assessment.target_model_ready, false)
    assert.ok(assessment.rows.every(row => row.action === 'UNAVAILABLE'))
    assert.equal(assessment.target_total_pct, null)
    if (scope === 'PRO') {
      const reserve = family.assessFamilyOfficeAllocation(fixture.allocation, { ...fixture.model, reserve_floor_eur: value }, fixture.lines, {
        expectedScope: scope, targetBuckets: fixture.buckets, targetSleeves: fixture.sleeves,
      })
      assert.equal(reserve.target_model_ready, false)
      assert.ok(reserve.rows.every(row => row.action === 'UNAVAILABLE'))
    }
  }
  assert.equal(readers.parseTargetModels([{ ...fixture.model, target_total_pct: '100.00' }])[0].target_total_pct, 100)
  assert.equal(readers.parseTargetModels([{ ...fixture.model, target_total_pct: null }])[0].target_total_pct, null)

  for (const page of ['targets', 'arbitrage']) {
    const cache = fixtureCache(page, fixture)
    const fetchers = new Map()
    const fetcherKeys = new Map()
    const queryFilters = []
    const source = fs.readFileSync(new URL('../app/' + page + '/page.tsx', import.meta.url), 'utf8')
    let latestAssessment
    let scopeOverride = null
    let rawTables = { ...tables }
    const pageModule = { exports: {} }
    const dependencies = {
      react: { ...React, useState: initial => React.useState(initial === null ? scopeOverride : initial) },
      'react/jsx-runtime': require('react/jsx-runtime'),
      swr: (key, fetcher) => {
        if (!key) return {}
        const name = Array.isArray(key) ? key[0] : key
        fetchers.set(name, fetcher)
        fetcherKeys.set(name, key)
        return cache.get(name) ?? {}
      },
      'lucide-react': new Proxy({}, { get: () => () => null }),
      '../../components/AppShell': { AppShell: ({ children }) => React.createElement('div', null, children) },
      '../../components/EmptyState': { EmptyState: ({ title, message }) => React.createElement('section', null, title, message) },
      '../../lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
      '../../lib/targetModelReaders': readers,
      '../../lib/sourceReadiness': require('../lib/sourceReadiness.ts'),
      '../../lib/usePortfolioSelection': { usePortfolioSelection: portfolios => {
        const first = Array.isArray(portfolios) && portfolios.length ? portfolios[0].id : ''
        return [first, () => {}]
      } },
      '../../components/SourceStateScreen': { SourceStateScreen: ({ state }) => React.createElement('section', { 'data-source-state': state }) },
      '../../lib/macroStrategyData': { loadMacroAllocationAdvice: () => { throw new Error('Unexpected live read') } },
      '../../lib/supabase': { supabase: { from: table => {
        assert.ok(table in rawTables, 'Unexpected table ' + table)
        const query = {
          select: () => query,
          eq: (column, value) => { queryFilters.push({ table, column, value }); return query },
          order: () => query,
          then: (resolve, reject) => Promise.resolve({ data: rawTables[table], error: null }).then(resolve, reject),
        }
        return query
      } } },
      '../../lib/familyOfficeAllocation': { ...family, assessFamilyOfficeAllocation: (...args) => {
        latestAssessment = family.assessFamilyOfficeAllocation(...args)
        return latestAssessment
      } },
    }
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, { module: pageModule, exports: pageModule.exports, require: name => {
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    } })
    const render = () => renderToStaticMarkup(React.createElement(pageModule.exports.default))
    assert.match(render(), /Synthetic holding 1/)
    assert.equal(latestAssessment.target_model_ready, true, page + ':' + scope)
    assert.ok(latestAssessment.rows.some(row => row.action === 'BUY' || row.action === 'REDUCE'), 'Valid PERSO and native PROFESSIONAL fixtures produce informative decisions')
    if (page === 'arbitrage') {
      assert.deepEqual(Array.from(fetcherKeys.get('allocation-advice')), ['allocation-advice', scope, 'portfolio'], 'Advice cache includes the exact portfolio, not only its scope')
      const adviceKey = 'allocation-advice'
      const saved = cache.get(adviceKey)
      const good = { ...saved.data[0], model_id: fixture.model.id, model_name: fixture.model.model_name, source_file: fixture.model.source_file }
      rawTables.allocation_advice_items_latest = [good]
      queryFilters.length = 0
      const fetchAdvice = fetchers.get(adviceKey)
      assert.equal((await fetchAdvice()).length, 1)
      assert.ok(queryFilters.some(({ table, column, value }) => table === 'allocation_advice_items_latest' && column === 'portfolio_id' && value === 'portfolio'), 'Actual page query filters portfolio_id')
      assert.ok(queryFilters.some(({ column, value }) => column === 'portfolio_scope' && value === scope), 'Actual page query also filters scope')
      for (const bad of [
        { ...good, portfolio_id: 'foreign' }, { ...good, portfolio_id: null },
        { ...good, portfolio_id: undefined }, { ...good, portfolio_id: '' },
        { ...good, portfolio_scope: scope === 'PRO' ? 'PERSO' : 'PRO' },
        { ...good, portfolio_scope: undefined },
      ]) {
        for (const data of [[bad], [good, bad]]) {
          rawTables.allocation_advice_items_latest = data
          await assert.rejects(fetchAdvice, /advice/i, 'Never silently drop a foreign row and accept the remainder')
          cache.set(adviceKey, { data })
          assert.match(render(), /data-source-state="UNAVAILABLE"/, 'A bypassed/contaminated cache fails closed too')
          assert.doesNotMatch(render(), /Synthetic cached (macro|allocation) advice|Synthetic holding 1/)
          scenarios++
        }
      }
      rawTables.allocation_advice_items_latest = []
      assert.equal((await fetchAdvice()).length, 0, 'A genuinely empty response is valid, not an identity error')
      for (const data of [null, {}, [null], [good, { ...good, model_id: null }]]) {
        rawTables.allocation_advice_items_latest = data
        await assert.rejects(fetchAdvice, /advice/i, 'Malformed collections/rows cannot become a valid empty or partial result')
        scenarios++
      }
      cache.set(adviceKey, { data: [] })
      assert.match(render(), /No allocation advice/)
      cache.set(adviceKey, saved)
      rawTables = { ...tables }
      assert.match(render(), /Synthetic cached allocation advice/)
      const registryKey = pageKeys[page].portfolios
      const registry = cache.get(registryKey)
      for (const data of [[], [fixture.portfolios[0], { ...fixture.portfolios[0] }]]) {
        cache.set(registryKey, { data })
        fetchers.clear()
        assert.match(render(), /data-source-state="UNAVAILABLE"/)
        assert.equal(fetchers.has(adviceKey), false, 'A missing/duplicate selected identity disables advice reads')
        scenarios++
      }
      cache.set(registryKey, registry)
      render()
      scenarios++
    }
    // A valid model/cache must never override the selected portfolio's identity.
    // In particular, a PERSO contract on PROFESSIONAL must not bypass its reserve.
    const portfolioKey = pageKeys[page].portfolios
    const savedPortfolios = cache.get(portfolioKey)
    const nativeType = scope === 'PRO' ? 'PROFESSIONAL' : 'PERSONAL'
    const incompatibleType = scope === 'PRO' ? 'PERSONAL' : 'PROFESSIONAL'
    for (const portfolioType of [incompatibleType, 'UNKNOWN', undefined, null]) {
      scopeOverride = scope
      cache.set(portfolioKey, { data: [{ ...fixture.portfolios[0], portfolio_type: portfolioType }] })
      latestAssessment = undefined
      fetchers.clear()
      const html = render()
      assert.match(html, /data-source-state="UNAVAILABLE"/, `${page}: ${String(portfolioType)} cannot use ${scope}`)
      assert.doesNotMatch(html, /Synthetic holding 1|Synthetic cached (macro|allocation) advice/)
      assert.equal(latestAssessment, undefined, 'No allocation calculation under an unverified or incompatible scope')
      for (const dependent of ['lines', 'buckets', 'sleeves']) assert.equal(fetchers.has(pageKeys[page][dependent]), false)
      assert.equal(fetchers.has('allocation-advice'), false, 'No scope-bound advice query under a mismatch')
      scenarios++
    }
    cache.set(portfolioKey, savedPortfolios)
    scopeOverride = scope === 'PRO' ? 'PERSO' : 'PRO'
    latestAssessment = undefined
    assert.match(render(), /data-source-state="UNAVAILABLE"/, `${page}: opposite manual scope is blocked on ${nativeType}`)
    assert.equal(latestAssessment, undefined)
    scopeOverride = scope
    assert.match(render(), /Synthetic holding 1/)
    assert.equal(latestAssessment.target_model_ready, true, 'Compatible explicit scope recovers the valid contract')
    if (scope === 'PRO') {
      const protectedReserve = latestAssessment.rows.find(row => row.reason_codes.includes('PRO_RESERVE_EXCLUDED'))
      assert.equal(protectedReserve?.current_value_eur, 120000, 'Compatible PRO still protects its reserve')
      assert.ok(!['BUY', 'REDUCE'].includes(protectedReserve.action))
    }
    scopeOverride = null
    render()
    scenarios += 2
    // Run actual page fetchers: both readers must reject an extra malformed row.
    for (const [name, table] of [['models', 'target_models'], ['buckets', 'target_buckets'], ['lines', 'target_envelope_lines'], ['portfolios', 'fo_portfolios'], ...(scope === 'PRO' ? [['sleeves', 'target_sleeve_allocations']] : [])].filter(([name]) => name !== 'execution')) {
      const fetcher = fetchers.get(pageKeys[page][name])
      if (typeof fetcher !== 'function') { console.log('NOFETCHER', name, pageKeys[page][name]); continue }
      assert.equal((await fetcher()).length, tables[table].length)
      rawTables[table] = [...tables[table], { ...tables[table][0], ...malformed[table] }]
      await assert.rejects(fetcher, /invalid row/)
      rawTables = { ...tables }
    }
    const required = Object.entries(pageKeys[page]).filter(([name]) => scope === 'PRO' || name !== 'sleeves').filter(([name]) => name !== 'execution')
    for (const [, key] of required) {
      const saved = cache.get(key)
      for (const state of [
        { ...saved, error: new Error('Synthetic refresh error') },
        { ...saved, isLoading: true },
        { data: undefined, isLoading: false },
      ]) {
        cache.set(key, state)
        const html = render()
        assert.doesNotMatch(html, /Synthetic holding 1/)
        if (page === 'arbitrage') {
          assert.doesNotMatch(html, /Synthetic cached (macro|allocation) advice/)
          assert.doesNotMatch(html, /Synthetic holding 1/)
        }
        scenarios++
      }
      cache.set(key, saved)
      render()
      assert.equal(latestAssessment.target_model_ready, true)
    }
    if (page === 'arbitrage') {
      for (const [key, label] of [['allocation-advice', 'allocation'], ['macro-allocation-advice', 'macro']]) {
        const saved = cache.get(key)
        assert.ok(render().includes('Synthetic cached ' + label + ' advice'))
        for (const state of [{ ...saved, error: new Error('refresh failed') }, { ...saved, isLoading: true }]) {
          cache.set(key, state)
          assert.equal(render().includes('Synthetic cached ' + label + ' advice'), false)
        }
        cache.set(key, saved)
        assert.ok(render().includes('Synthetic cached ' + label + ' advice'))
      }
      const key = pageKeys[page].portfolios
      const saved = cache.get(key)
      cache.set(key, { data: [{ ...fixture.portfolios[0], portfolio_type: 'UNKNOWN' }] })
      assert.doesNotMatch(render(), /Synthetic cached (macro|allocation) advice/)
      cache.set(key, saved)
    }
    // A cached numeric NaN must also fail closed if the parser is bypassed.
    const modelsKey = pageKeys[page].models
    for (const bad of [NaN, 'NaN', Infinity, '100']) {
      cache.set(modelsKey, { data: [{ ...fixture.model, target_total_pct: bad }] })
      render()
      assert.equal(latestAssessment.target_model_ready, false)
      assert.ok(latestAssessment.rows.every(row => row.action === 'UNAVAILABLE'))
    }
    cache.set(modelsKey, { data: [fixture.model] })
    assert.match(render(), /Synthetic holding 1/)
    console.log(page + ' ' + scope + ': shared fetchers, cached errors, missing reads and recovery PASS')
  }
}
console.log('Allocation reader render scenarios: ' + scenarios + ' PASS')
