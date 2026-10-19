// Compile actual Python-normalized fixtures against the shared TS logical type.
// No app import, provider, Supabase client, secret or emitted TypeScript file.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../..', import.meta.url))
const fixtures = JSON.parse(readFileSync(path.join(root, 'backend/tests/fixtures/source_contracts_v1.json'), 'utf8'))
const python = String.raw`
import json, sys
sys.path.insert(0, "tests")
from source_contracts_offline_guard import install
install()
from source_contracts import normalize_observation
data = json.load(sys.stdin)
print(json.dumps([normalize_observation(c["input"], now=data["now"], policy=c["policy"])
                  for c in data["cases"]], allow_nan=False))
`
const result = spawnSync('python3.11', ['-B', '-c', python], {
  cwd: path.join(root, 'backend'),
  env: { PATH: process.env.PATH, PYTHONNOUSERSITE: '1' },
  input: JSON.stringify(fixtures), encoding: 'utf8', timeout: 10000,
})
assert.equal(result.error, undefined, 'Local Python runner unavailable')
assert.equal(result.status, 0, 'Offline normalization failed')
const payloads = JSON.parse(result.stdout)
assert.equal(payloads.length, fixtures.cases.length)
for (const [i, payload] of payloads.entries()) {
  assert.equal(payload.quality, fixtures.cases[i].expected.quality)
  assert.equal(payload.operational_authority, false)
}

function diagnostics(values) {
  const virtual = path.join(root, 'frontend/scripts/__source_contract_fixture__.ts')
  const code = "import type { SourceObservationV1 } from '../types';\n" +
    values.map((v, i) => "const fixture" + i + " = " + JSON.stringify(v) +
      " satisfies SourceObservationV1;").join('\n')
  const options = { strict: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] }
  const host = ts.createCompilerHost(options)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, language, error, fresh) =>
    file === virtual ? ts.createSourceFile(file, code, language, true)
      : original(file, language, error, fresh)
  return ts.getPreEmitDiagnostics(ts.createProgram([virtual], options, host))
}
const errors = diagnostics(payloads)
if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
  getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n',
}))
for (const invalid of [
  { ...payloads[0], quality: 'READY' },
  { ...payloads[0], operational_authority: true },
  { ...payloads[0], scope: 'PRODUCTION' },
  { ...payloads[0], value: '0.91' },
]) assert.ok(diagnostics([invalid]).length, 'Negative type control must fail')
console.log('PASS ' + payloads.length + ' Python fixtures conform to SourceObservationV1; 4 negative controls rejected')
