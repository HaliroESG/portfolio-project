import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

const root = fileURLToPath(new URL('../..', import.meta.url))
const python = String.raw`
import json,sys
sys.path.insert(0,'tests')
from source_contracts_offline_guard import install
install()
from test_publication_contracts import FIXTURES,ttm_case
from publication_contracts import prepare_publication,strict_ttm
from test_equity_publications_l3 import sec_payload
from test_equity_publications import record
from equity_publications import normalize_sec_submissions,event_payload
print(json.dumps({'events':[prepare_publication({**FIXTURES['event_base'],**c['patch']},now=FIXTURES['now']) for c in FIXTURES['event_cases']],
 'ttms':[strict_ttm(ttm_case(c)) for c in FIXTURES['ttm_cases']],
 'sec':event_payload(normalize_sec_submissions(record(),sec_payload())[0],'2026-10-18T12:00:00Z')},allow_nan=False))
`
const run = spawnSync('python3.11', ['-B', '-c', python], { cwd: path.join(root, 'backend'),
  env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10000 })
assert.equal(run.status, 0, run.stderr)
const payloads = JSON.parse(run.stdout)
function diagnostics(values, type) {
  const virtual = path.join(root, 'frontend/scripts/__publication_fixture__.ts')
  const code = `import type { ${type} } from '../types';\n` + values.map((v, i) =>
    `const f${i} = ${JSON.stringify(v)} satisfies ${type};`).join('\n')
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] }
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, language, error, fresh) => file === virtual
    ? ts.createSourceFile(file, code, language, true) : original(file, language, error, fresh)
  return ts.getPreEmitDiagnostics(ts.createProgram([virtual], options, host))
}
assert.equal(diagnostics(payloads.events, 'PublicationTraceV1').length, 0)
assert.equal(diagnostics(payloads.ttms, 'PublicationTtmV1').length, 0)
for (const patch of [{ scope: 'LIVE' }, { operational_authority: true }, { effective_status: 'SUCCESS' }, { actual_eps: '0' }]) {
  assert.ok(diagnostics([{ ...payloads.events[0], ...patch }], 'PublicationTraceV1').length)
}
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try { return next(specifier + '.ts', context) } catch { /* pass through */ }
  }
  return next(specifier, context)
} })
const { publicationEvidence, publicationCoverageDimensions } = await import('../lib/publicationTrace.ts')
const ui = await import('../lib/equityPublicationUi.ts')
const today = '2026-10-18'
const legacy = { event_key: 'legacy', instrument_key: 'fixture', provider_symbol: 'TEST', source_provider: 'yfinance_yahoo',
  status: 'REPORTED', event_type: 'EARNINGS', event_date: '2026-10-17', match_confidence: 'HIGH', metadata: {}, trace: payloads.events[3] }
assert.match(publicationEvidence(legacy, today).label, /preuve non attestée/)
assert.equal(publicationEvidence(payloads.sec, today).basis, 'OFFICIAL_DOCUMENT')
for (const patch of [{ source_url: 'https://invalid.example/test' }, { source_provider: 'other' }, { event_type: 'EARNINGS' }, { filing_date: null }, { event_date: '2027-01-01' }, { metadata: {} }]) {
  assert.equal(publicationEvidence({ ...payloads.sec, ...patch }, today).basis, 'UNATTESTED')
}
const aggregator = { ...legacy, metadata: { eps_actual: 0, publication_evidence: {
  version: 'publication-evidence/v1', basis: 'AGGREGATOR_RESULT', reference: 'TEST:2026-10-17', event_date: '2026-10-17' } } }
assert.equal(publicationEvidence(aggregator, today).basis, 'AGGREGATOR_RESULT')
assert.equal(publicationEvidence({ ...aggregator, metadata: { ...aggregator.metadata, eps_actual: null } }, today).basis, 'UNATTESTED')
const coverage = publicationCoverageDimensions([{ instrument_key: 'fixture', annual_revenue: 0, annual_ebitda: null,
  interim_revenue: 25, valuation_as_of: '2020-01-01', ttm_complete: true }], [legacy, aggregator, payloads.sec], today)
assert.equal(coverage.annual[0].available, 1)
assert.equal(coverage.interim[0].available, 1)
assert.equal(coverage.valuation[0].asOf, '2020-01-01')
assert.equal(coverage.officialDocuments, 1)
assert.equal(coverage.aggregatorResults, 1)
assert.equal(coverage.unattestedReported, 1)
assert.equal(coverage.ttmComparablePeriods, 'UNATTESTED')
assert.equal(coverage.operationalAuthority, false)
// Civil dates remain unchanged across runtime time zones, including DST dates.
for (const tz of ['UTC', 'Europe/Paris', 'America/New_York']) {
  process.env.TZ = tz
  for (const d of ['2026-03-29', '2026-10-25', '2026-11-01']) assert.equal(ui.publicationDateKey(ui.publicationDate(d)), d)
}
console.log(JSON.stringify({ status: 'PASS', python_ts_events: payloads.events.length, python_ts_ttm: payloads.ttms.length,
  type_negative_controls: 4, evidence_negative_controls: 8, timezones: 3, legacy_not_certified: true, database_mutations: 0 }))
