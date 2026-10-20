import assert from 'node:assert/strict'
import { sourceReadiness, portfolioOptions, hasSelectedPortfolio, sourceFailures } from '../lib/sourceReadiness.ts'
import { scopeFromPortfolioType } from '../lib/targetModelReaders.ts'

const ready = () => ({ data: [], isLoading: false, isValidating: false })
let cases = 0
for (let index = 0; index < 7; index++) {
  for (const [overrides, expected] of [
    [{ error: new Error('synthetic') }, 'ERROR'],
    [{ isLoading: true }, 'LOADING'],
    [{ isLoading: false, isValidating: true }, 'REVALIDATING'],
    [{ data: undefined }, 'UNAVAILABLE'],
    [{ data: null }, 'UNAVAILABLE'],
    [{ data: [] }, 'READY'],
  ]) {
    const sources = Array.from({ length: 7 }, ready)
    sources[index] = { ...sources[index], ...overrides }
    assert.equal(sourceReadiness(sources), expected)
    cases++
  }
}
assert.equal(sourceReadiness([{ ...ready(), error: 'failed', isValidating: true }]), 'ERROR')
assert.equal(sourceReadiness([{ ...ready(), isLoading: true, isValidating: true }]), 'LOADING')
const portfolios = [{ id: 'p1', name: 'Synthetic' }, { id: 'p2', name: null }]
assert.equal(hasSelectedPortfolio(portfolios, 'p1'), true)
assert.equal(hasSelectedPortfolio(portfolios, 'removed'), false)
for (const invalid of [undefined, null, [], [null], [{ id: '', name: null }], [{ id: 1, name: null }], [...portfolios, portfolios[0]]]) {
  assert.equal(hasSelectedPortfolio(invalid, 'p1'), false)
  assert.deepEqual(portfolioOptions(invalid), [])
  cases++
}
assert.deepEqual(sourceFailures([{ label: 'Targets', source: ready() }]), [])
for (const code of ['42703', '42P01', 'PGRST204', 'PGRST205']) {
  const failure = sourceFailures([{ label: 'Targets', source: { ...ready(), error: { code, message: 'PRIVATE_RAW_ERROR', details: 'PRIVATE_DETAILS' } } }])
  assert.equal(failure[0].code, 'SCHEMA_UNAVAILABLE')
  assert.equal(failure[0].label, 'Targets')
  assert.ok(!JSON.stringify(failure).includes('PRIVATE'))
  assert.equal(sourceReadiness([{ ...ready(), error: { code } }]), 'ERROR')
  cases++
}
for (const code of ['42501', '28000', 'PGRST301', 'PGRST302', 'PGRST303']) {
  assert.equal(sourceFailures([{ label: 'Portfolios', source: { ...ready(), error: { code } } }])[0].code, 'ACCESS_REQUIRED')
  cases++
}
for (const error of [new Error('PRIVATE_RAW_ERROR'), 'PRIVATE_RAW_ERROR', {}, { code: 'OTHER' }, 42]) {
  const failures = sourceFailures([{ label: 'Holdings', source: { ...ready(), error } }])
  assert.equal(failures[0].code, 'READ_FAILED')
  assert.ok(!JSON.stringify(failures).includes('PRIVATE'))
  cases++
}
assert.equal(scopeFromPortfolioType('PERSONAL'), 'PERSO')
assert.equal(scopeFromPortfolioType('PROFESSIONAL'), 'PRO')
for (const type of ['PRO', 'PERSO', 'professional', '', null, undefined, 1]) {
  assert.equal(scopeFromPortfolioType(type), null)
  cases++
}
console.log(`source-state: PASS (${cases + 7} checks)`)
