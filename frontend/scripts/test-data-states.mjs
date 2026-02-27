import assert from 'node:assert/strict'

const dataStates = await import('../lib/dataStates.ts')

assert.equal(dataStates.stateFromList({ loading: true, count: 0 }), 'LOADING')
assert.equal(dataStates.stateFromList({ loading: false, count: 0 }), 'EMPTY')
assert.equal(dataStates.stateFromList({ loading: false, count: 2 }), 'OK')
assert.equal(dataStates.stateForTechnicalHistory('UNKNOWN'), 'INSUFFICIENT_HISTORY')
assert.equal(dataStates.stateForTechnicalHistory('INSUFFICIENT_HISTORY'), 'INSUFFICIENT_HISTORY')
assert.equal(dataStates.stateForTechnicalHistory('BULLISH'), 'OK')

const now = new Date().toISOString()
assert.equal(dataStates.stateFromTimestamp(now, 60), 'OK')

console.log('frontend data-state tests: PASS')
