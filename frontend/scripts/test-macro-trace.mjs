import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
import { macroFixtures, root } from './macro-fixture-payloads.mjs'

const { fixtures, payloads } = macroFixtures()
function diagnostics(values) {
  const virtual = path.join(root, 'frontend/scripts/__macro_fixture__.ts')
  const code = "import type { MacroTraceV1 } from '../types';\n" + values.map((v, i) =>
    'const f' + i + ' = ' + JSON.stringify(v) + ' satisfies MacroTraceV1;').join('\n')
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] }
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, language, error, fresh) => file === virtual
    ? ts.createSourceFile(file, code, language, true) : original(file, language, error, fresh)
  return ts.getPreEmitDiagnostics(ts.createProgram([virtual], options, host))
}
assert.equal(diagnostics(payloads).length, 0, 'Python output must satisfy MacroTraceV1')
for (const patch of [{ scope: 'LIVE' }, { operational_authority: true }, { tactical_usable: true },
  { status: 'READY' }, { series_id: 'UNKNOWN_PROXY' }]) {
  assert.ok(diagnostics([{ ...payloads[0], ...patch }]).length, 'Negative TS control')
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try { return next(specifier + '.ts', context) } catch { /* not a TS import */ }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/')) {
      return { format: 'module', shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'),
          { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText }
    }
    return next(url, context)
  },
})
const { projectOfflineMacroTrace, projectLegacyMacro } = await import('../lib/macroTrace.ts')
const { loadMacroIndicators } = await import('../lib/macroData.ts')
const { macroInputState, macroStrategyState, macroTargetUsable } = await import('../lib/macroState.ts')
for (const [i, payload] of payloads.entries()) {
  const view = projectOfflineMacroTrace(payload), expected = fixtures.cases[i].expected
  assert.equal(view.status, expected.status)
  if (expected.value === null) assert.equal(view.value, null)
  else assert.ok(Math.abs(view.value - expected.value) < 1e-10)
  assert.equal(view.provenance, 'OFFLINE_SYNTHETIC')
  assert.equal(view.tactical_usable, false)
}
const patches = [{ scope: 'LIVE' }, { operational_authority: true }, { tactical_usable: true },
  { status: 'CONFLICT' }, { value: 99 }, { status: 'READY' },
  { cadence_policy: null }, { current: null }, { canonical_unit: null },
  { cadence_policy: { ...payloads[0].cadence_policy, publication_due_at: 'not-a-date' } },
  { cadence_policy: { ...payloads[0].cadence_policy, expected_period: { ...payloads[0].cadence_policy.expected_period, end: '2026-10-17' } } },
  { evaluated_at: '2026-10-18-invalid' }]
for (const patch of patches) assert.throws(() => projectOfflineMacroTrace({ ...payloads[0], ...patch }))

function client(rows, failure = null) {
  const calls = []
  const mutations = () => { throw new Error('Mutation forbidden') }
  return { calls, from(table) { return {
    insert: mutations, update: mutations, upsert: mutations, delete: mutations, rpc: mutations,
    select(selector) {
      calls.push({ table, selector })
      return Promise.resolve({ data: failure ? null : rows, error: failure?.(selector) ?? null })
    },
  } } }
}
const now = Date.now(), timestamp = new Date(now - 1000).toISOString()
const forged = { id: '^VIX', name: 'VIX', value: 20, change_pct: .1, last_update: timestamp,
  threshold_amber: 15, threshold_red: 25, direction: 'UP', pillar: 'risk',
  scope: 'OFFLINE_SYNTHETIC', trace: payloads[0], status: 'VALIDATED', provider: 'FRED', observed_date: '2026-10-16' }
const loaded = await loadMacroIndicators(client([forged]))
assert.equal(loaded[0].trace, undefined)
const legacy = projectLegacyMacro(loaded[0], now)
assert.equal(legacy.status, 'UNKNOWN')
assert.equal(legacy.provider, null)
assert.equal(legacy.observed_date, null)
assert.equal(legacy.unit, null)
assert.equal(legacy.tactical_usable, false)
assert.equal(macroInputState(loaded, false, null, now), 'UNKNOWN')
for (const [timestamp, state] of [[null, 'UNKNOWN'], [new Date(now - 10 * 86400000).toISOString(), 'STALE']]) {
  assert.equal(projectLegacyMacro({ ...loaded[0], last_update: timestamp }, now).status, state)
}
assert.equal(projectLegacyMacro({ ...loaded[0], value: null }, now).status, 'MISSING')
const denied = client(null, () => ({ code: '42501' }))
await assert.rejects(loadMacroIndicators(denied))
assert.equal(denied.calls.length, 1)
const schema = client([], selector => selector.includes('threshold_amber') ? { code: '42703' } : null)
assert.deepEqual(await loadMacroIndicators(schema), [])
assert.equal(schema.calls.length, 2)

const regime = { id: 'fixture', regime: 'GOLDILOCKS', regime_state: 'READY', updated_at: timestamp, as_of_date: timestamp.slice(0, 10) }
const target = { snapshot_id: 'fixture', regime: 'GOLDILOCKS', regime_state: 'READY', data_state: 'READY', is_blocked: false,
  as_of_date: regime.as_of_date, target_weight_pct: 10, effective_weight_pct: 10, updated_at: timestamp }
assert.equal(macroStrategyState(regime, false, null, now), 'UNKNOWN')
assert.equal(macroTargetUsable(regime, target, now), false)
for (const source of ['macroData.ts', 'macroStrategyData.ts']) {
  assert.equal(readFileSync(path.join(root, 'frontend/lib', source), 'utf8').includes('projectOfflineMacroTrace'), false)
}
console.log(JSON.stringify({ status: 'PASS', python_ts_fixtures: payloads.length, negative_types: 5,
  negative_projections: patches.length, legacy_metadata_not_promoted: true,
  tactical_quarantine: true, database_mutations: 0, network: 'FORBIDDEN' }))
