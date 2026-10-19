import assert from 'node:assert/strict'
import { buildEtlTrend } from '../lib/etlTrend.ts'

let cases = 0
function test(name, run) { run(); cases++; console.log('PASS ' + name) }
const point = (successRatePct = null, coveragePct = null, status = 'SUCCESS', timestamp = 'fixture') =>
  ({ timestamp, status, successRatePct, coveragePct })
// Describe fixtures in chart order; the reader supplies newest-first rows.
const chart = rows => buildEtlTrend(rows.map((r, i) => ({ ...r, timestamp: String(i) })).reverse())
const scores = result => result.points.map(p => p.score)

test('R006: no attempt is not a zero success rate', () => {
  const result = chart([point(100, 50), point(null, 0)])
  assert.equal(result.basis, 'success_rate')
  assert.deepEqual(scores(result), [100, null])
  assert.equal(result.direction, 'NONE')
  assert.equal(result.delta, null)
})
test('a genuine zero remains zero; a failed run retains its measured ratio', () => {
  assert.deepEqual(scores(chart([point(100, 50), point(0, 90), point(80, 25, 'FAILED')])), [100, 0, 80])
})
test('coverage or status cannot fill a missing success rate', () => {
  assert.deepEqual(scores(chart([point(100), point(null, 75), point(null, 0, 'FAILED'), point()])), [100, null, null, null])
})
test('coverage series never substitutes status; zero coverage is available', () => {
  const result = chart([point(null, 75, 'FAILED'), point(null, 0), point(), point(null, null, 'FAILED')])
  assert.equal(result.basis, 'coverage')
  assert.deepEqual(scores(result), [75, 0, null, null])
  assert.equal(result.direction, 'NONE')
})
test('status fallback is explicit and running stays unknown', () => {
  const result = chart([point(), point(null, null, 'FAILED'), point(null, null, 'RUNNING')])
  assert.equal(result.basis, 'status')
  assert.deepEqual(scores(result), [100, 0, null])
})
test('empty and all missing have neither direction nor delta', () => {
  for (const rows of [[], [point(null, null, 'RUNNING')], [point(null, null, 'UNKNOWN')]]) {
    const result = chart(rows)
    assert.equal(result.direction, 'NONE')
    assert.equal(result.delta, null)
    assert.ok(scores(result).every(s => s === null))
  }
})
test('non-finite and out-of-range inputs do not create measured points', () => {
  for (const invalid of [NaN, Infinity, -Infinity, -1, 101, undefined, '50']) {
    assert.deepEqual(scores(chart([point(75, 60), { ...point(null, 30), successRatePct: invalid }])), [75, null])
    assert.deepEqual(scores(chart([point(null, 60), { ...point(), coveragePct: invalid }])), [60, null])
  }
})
test('eight-point cap applies before basis selection; input is not mutated', () => {
  const rows = Object.freeze(Array.from({ length: 9 }, (_, i) => Object.freeze(point(i === 8 ? 100 : null, i, 'SUCCESS', String(i)))))
  const before = JSON.stringify(rows)
  const result = buildEtlTrend(rows)
  assert.equal(result.basis, 'coverage')
  assert.deepEqual(scores(result), [7, 6, 5, 4, 3, 2, 1, 0])
  assert.deepEqual(result.points.map(p => p.timestamp), ['7', '6', '5', '4', '3', '2', '1', '0'])
  assert.equal(JSON.stringify(rows), before)
})
test('trend requires four comparable points, not four mixed metrics', () => {
  const result = chart([point(100), point(100), point(100), point(null, 0), point(null, null, 'FAILED')])
  assert.equal(result.direction, 'NONE')
  assert.equal(result.delta, null)
})
test('up, down, flat and inclusive two-point boundaries are preserved', () => {
  for (const [values, direction, delta] of [
    [[40, 50, 80, 90], 'UP', 40], [[90, 80, 50, 40], 'DOWN', -40],
    [[50, 50, 50, 50], 'FLAT', 0], [[50, 50, 52, 52], 'FLAT', 2], [[50, 50, 48, 48], 'FLAT', -2],
  ]) {
    const result = chart(values.map(v => point(v)))
    assert.equal(result.direction, direction)
    assert.equal(result.delta, delta)
  }
})
test('gaps are excluded, not averaged as zeros', () => {
  const result = chart([point(40), point(null, 0), point(50), point(80), point(90), point(null, 100, 'FAILED')])
  assert.deepEqual(scores(result), [40, null, 50, 80, 90, null])
  assert.equal(result.delta, 40)
  assert.equal(result.direction, 'UP')
})
test('pairwise unit invariance across all status and ratio combinations', () => {
  const variants = ['SUCCESS', 'FAILED', 'RUNNING'].flatMap(status => [null, 0, 75, 100].flatMap(successRatePct =>
    [null, 0, 50, 100].map(coveragePct => point(successRatePct, coveragePct, status))))
  for (const left of variants) for (const right of variants) {
    const pair = [left, right]
    const expectedBasis = pair.some(r => r.successRatePct !== null) ? 'success_rate'
      : pair.some(r => r.coveragePct !== null) ? 'coverage' : 'status'
    const expected = pair.map(r => expectedBasis === 'success_rate' ? r.successRatePct : expectedBasis === 'coverage' ? r.coveragePct
      : r.status === 'SUCCESS' ? 100 : r.status === 'FAILED' ? 0 : null)
    const result = chart(pair)
    assert.equal(result.basis, expectedBasis)
    assert.deepEqual(scores(result), expected)
  }
  console.log('  2304 pair combinations checked')
})
console.log(JSON.stringify({ status: 'PASS', cases, pair_combinations: 2304, network: 'not used' }))
