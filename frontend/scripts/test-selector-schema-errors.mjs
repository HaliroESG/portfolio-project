import assert from 'node:assert/strict'

const { isSelectorSchemaError } = await import('../lib/supabaseSelectorErrors.ts')

for (const code of ['42703', 'PGRST204', 'PGRST100']) {
  assert.equal(isSelectorSchemaError({ code, message: 'irrelevant' }), true)
}

assert.equal(
  isSelectorSchemaError({ message: 'column market_watch.macd_line does not exist' }),
  true
)
assert.equal(isSelectorSchemaError({ code: 'PGRST301', message: 'JWT expired' }), false)
assert.equal(isSelectorSchemaError({ message: 'Failed to fetch' }), false)
assert.equal(isSelectorSchemaError(null), false)

console.log('selector schema-error tests: PASS')
