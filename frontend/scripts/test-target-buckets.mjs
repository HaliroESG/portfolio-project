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
    const source = fs.readFileSync(new URL('../app/' + page + '/page.tsx', import.meta.url), 'utf8')
    let calls = 0
    let latestAssessment
    let rawTables = { ...tables }
    const pageModule = { exports: {} }
    const dependencies = {
      react: React,
      'react/jsx-runtime': require('react/jsx-runtime'),
      swr: (key, fetcher) => {
        if (!key) return {}
        const name = Array.isArray(key) ? key[0] : key
        fetchers.set(name, fetcher)
        return cache.get(name) ?? {}
      },
      'lucide-react': new Proxy({}, { get: () => () => null }),
      '../../components/AppShell': { AppShell: ({ children }) => React.createElement('div', null, children) },
      '../../components/EmptyState': { EmptyState: ({ title, message }) => React.createElement('section', null, title, message) },
      '../../lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
      '../../lib/targetModelReaders': readers,
      '../../lib/macroStrategyData': { loadMacroAllocationAdvice: () => { throw new Error('Unexpected live read') } },
      '../../lib/supabase': { supabase: { from: table => {
        assert.ok(table in rawTables, 'Unexpected table ' + table)
        const query = {
          select: () => query, eq: () => query, order: () => query,
          then: (resolve, reject) => Promise.resolve({ data: rawTables[table], error: null }).then(resolve, reject),
        }
        return query
      } } },
      '../../lib/familyOfficeAllocation': { ...family, assessFamilyOfficeAllocation: (...args) => {
        calls++
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
    assert.ok(latestAssessment.rows.some(row => row.action === 'BUY' || row.action === 'REDUCE'))
    // Run actual page fetchers: both readers must reject an extra malformed row.
    for (const [name, table] of [['models', 'target_models'], ['buckets', 'target_buckets'], ['lines', 'target_envelope_lines'], ['portfolios', 'fo_portfolios'], ...(scope === 'PRO' ? [['sleeves', 'target_sleeve_allocations']] : [])]) {
      const fetcher = fetchers.get(pageKeys[page][name])
      assert.equal((await fetcher()).length, tables[table].length)
      rawTables[table] = [...tables[table], { ...tables[table][0], ...malformed[table] }]
      await assert.rejects(fetcher, /invalid row/)
      rawTables = { ...tables }
    }
    const required = Object.entries(pageKeys[page]).filter(([name]) => scope === 'PRO' || name !== 'sleeves')
    for (const [name, key] of required) {
      const saved = cache.get(key)
      const goodCalls = calls
      for (const state of [
        { ...saved, error: new Error('Synthetic refresh error') },
        { ...saved, isLoading: true },
        { data: undefined, isLoading: false },
      ]) {
        cache.set(key, state)
        const html = render()
        assert.equal(calls, goodCalls, page + ':' + scope + ':' + name)
        assert.doesNotMatch(html, /Synthetic holding 1/)
        if (page === 'arbitrage') {
          assert.doesNotMatch(html, /Synthetic cached (macro|allocation) advice/)
          assert.match(html, /Actions<\/div><div[^>]*>--<\/div>/)
          assert.match(html, /Gross trade<\/div><div[^>]*>--<\/div>/)
        }
        scenarios++
      }
      cache.set(key, saved)
      assert.match(render(), /Synthetic holding 1/)
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
