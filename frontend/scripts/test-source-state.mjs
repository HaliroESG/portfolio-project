import assert from 'node:assert/strict'
import { sourceReadiness, portfolioOptions, hasSelectedPortfolio } from '../lib/sourceReadiness.ts'

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
console.log(`source-state: PASS (${cases + 4} checks)`)
