import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

// Execute the actual page functions without loading Next, credentials or Supabase.
const source = ts.createSourceFile('targets.tsx', fs.readFileSync(new URL('../app/targets/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = ['readNumber', 'readString', 'parseScope', 'parseTargetBucket', 'parseTargetBuckets']
const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
assert.equal(functions.length, names.length)
const context = vm.createContext({})
vm.runInContext(ts.transpileModule(functions.map((node) => node.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, context)
const bucket = (overrides = {}) => ({ id: 1, model_id: 'perso', portfolio_scope: 'PERSO', bucket_key: 'actions_us', bucket_label: 'US', target_weight_pct: 98, lower_band_pct: null, upper_band_pct: null, ...overrides })
const valid = [bucket(), bucket({ id: 2, bucket_key: 'crypto', bucket_label: 'Crypto', target_weight_pct: 2, lower_band_pct: 0, upper_band_pct: 4 })]
assert.equal(context.parseTargetBuckets(valid).length, 2)
for (const invalid of ['NaN', 'Infinity', '-Infinity', 'invalid']) {
  const rows = [...valid, bucket({ id: 3, bucket_key: 'gold', target_weight_pct: 0, lower_band_pct: invalid, upper_band_pct: 4 })]
  assert.throws(() => context.parseTargetBuckets(rows), /invalid row/)
}

// SWR can return cached, valid data together with a refresh error. Exercise the
// page's real assessment callback with that combination and with pending reads.
let callback
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'assessment') {
    callback = node.initializer.arguments[0].getText(source)
  }
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(callback)
let calls = 0
Object.assign(context, {
  allocationRows: [], selectedScope: 'PERSO', selectedTargetModel: { target_total_pct: 100 },
  targetBuckets: valid, targetSleeves: [], targetEnvelopeLines: [{}], targetEnvelopeLinesReady: true,
  sourceLoading: false, sourceError: undefined,
  assessFamilyOfficeAllocation: () => { calls++; return { rows: ['cached-decision'], target_model_ready: true } },
})
vm.runInContext(`var assessPage = ${callback}`, context)
assert.equal(context.assessPage().target_model_ready, true)
assert.equal(calls, 1)
for (const state of [{ sourceError: new Error('invalid row'), sourceLoading: false }, { sourceError: undefined, sourceLoading: true }]) {
  Object.assign(context, state)
  const result = context.assessPage()
  assert.equal(result.target_model_ready, false)
  assert.equal(result.rows.length, 0)
  assert.equal(calls, 1)
}
console.log('target buckets and cached-error gate: PASS')

// Render the actual React page using synthetic SWR responses, including the
// last good cached buckets plus a failed refresh. No auth or network is loaded.
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const family = await import('../lib/familyOfficeAllocation.ts')
const today = new Date().toISOString().slice(0, 10)
const model = { id: 'perso', portfolio_scope: 'PERSO', model_name: 'Synthetic model', source_file: 'synthetic.xlsx', status: 'READY', is_active: true, allocation_contract_version: 'allocation_contracts_v1', target_total_pct: 100, updated_at: `${today}T00:00:00Z` }
const allocationRows = family.buildFamilyOfficeAllocationRows({
  accounts: [{ id: 'a1', external_account_id: 'SYNTHETIC', name: 'Synthetic', envelope: 'CTO' }],
  cash: [],
  positions: [{ id: 'p1', portfolio_id: 'portfolio', account_id: 'a1', instrument_id: 'i1', instrument_key: 'ticker:ETF1', isin: null, ticker: 'ETF1', name: 'Synthetic current holding', instrument_type: 'ETF', currency: 'EUR', snapshot_date: today, quantity: 1, average_cost: 100, cost_basis_eur: 100, price_local: 100, fx_rate_to_eur: 1, market_value_eur: 100, unrealized_pnl_eur: 0, data_state: 'READY', price_as_of: today, fx_as_of: today, reconciliation_state: 'MATCH', calculated_at: `${today}T00:00:00Z` }],
})
const cache = new Map([
  ['fo-target-portfolios', { data: [{ id: 'portfolio', name: 'Synthetic portfolio', portfolio_type: 'PERSONAL' }] }],
  ['target-models', { data: [model] }],
  ['fo-allocation-source', { data: allocationRows }],
  ['target-buckets', { data: valid }],
  ['target-envelope-lines', { data: [{ id: 1, model_id: 'perso', portfolio_scope: 'PERSO', envelope: 'SYNTHETIC', ticker: 'ETF1', isin: null, instrument: 'Synthetic target', target_weight_pct: 100 }] }],
])
const fetchers = new Map()
let rawBuckets = valid
let latestAssessment
let assessmentCalls = 0
const pageModule = { exports: {} }
const dependencies = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  swr: (key, fetcher) => {
    const name = Array.isArray(key) ? key[0] : key
    fetchers.set(name, fetcher)
    return cache.get(name) ?? {}
  },
  'lucide-react': { Database: () => null, FileSpreadsheet: () => null, LockKeyhole: () => null, Target: () => null },
  '../../components/AppShell': { AppShell: ({ children }) => React.createElement('div', null, children) },
  '../../components/EmptyState': { EmptyState: ({ title, message }) => React.createElement('section', null, title, message) },
  '../../lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  '../../lib/supabase': { supabase: { from: (table) => {
    assert.equal(table, 'target_buckets')
    return { select: () => ({ eq: () => ({ order: async () => ({ data: rawBuckets, error: null }) }) }) }
  } } },
  '../../lib/familyOfficeAllocation': { ...family, assessFamilyOfficeAllocation: (...args) => {
    assessmentCalls++
    latestAssessment = family.assessFamilyOfficeAllocation(...args)
    return latestAssessment
  } },
}
vm.runInNewContext(ts.transpileModule(source.getFullText(), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, { module: pageModule, exports: pageModule.exports, require: (name) => {
  assert.ok(name in dependencies, `Unexpected page dependency: ${name}`)
  return dependencies[name]
} })
const render = () => renderToStaticMarkup(React.createElement(pageModule.exports.default))
assert.match(render(), /Synthetic current holding/)
assert.equal(latestAssessment.target_model_ready, true)
assert.equal((await fetchers.get('target-buckets')()).length, 2)
const goodCalls = assessmentCalls
rawBuckets = [...valid, bucket({ id: 3, bucket_key: 'gold', target_weight_pct: 0, lower_band_pct: 'NaN', upper_band_pct: 4 })]
await assert.rejects(fetchers.get('target-buckets'), /invalid row/)
cache.set('target-buckets', { data: valid, error: new Error('invalid row') })
const unavailable = render()
assert.match(unavailable, /Allocation inputs unavailable/)
assert.doesNotMatch(unavailable, /Synthetic current holding/)
assert.equal(assessmentCalls, goodCalls)
cache.set('target-buckets', { data: valid, isLoading: true })
assert.match(render(), /Loading allocation inputs/)
assert.equal(assessmentCalls, goodCalls)
cache.set('target-buckets', { data: valid })
assert.match(render(), /Synthetic current holding/)
assert.equal(latestAssessment.target_model_ready, true)
console.log('targets React render: valid / failed refresh / loading / recovered: PASS')
