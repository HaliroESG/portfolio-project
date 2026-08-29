import assert from 'node:assert/strict'

const { commandAvailability } = await import('../lib/commandAvailability.ts')
const { assertOwnerIsolation, familyOfficeSWRKey, OwnerIsolationError } = await import('../lib/ownerIsolation.ts')
const { ownerScopedSWRKey } = await import('../lib/useOwnerScopedSWR.ts')

const configuredProduction = commandAvailability({
  commandApiUrl: 'https://configured-but-unused.invalid',
  familyOfficeEnvironment: 'Production',
})
assert.equal(configuredProduction.status, 'DISABLED_PRODUCTION')
assert.equal(configuredProduction.httpStatus, 503)

const unconfiguredPreview = commandAvailability({ familyOfficeEnvironment: 'preview' })
assert.equal(unconfiguredPreview.status, 'UNCONFIGURED')
assert.equal(unconfiguredPreview.httpStatus, 503)

assert.deepEqual(
  commandAvailability({
    commandApiUrl: 'https://preview.invalid/',
    familyOfficeEnvironment: 'preview',
  }),
  { status: 'ENABLED', baseUrl: 'https://preview.invalid' },
)

assert.doesNotThrow(() => assertOwnerIsolation('owner-a', [
  [{ owner_user_id: 'owner-a' }],
  [],
]))
assert.throws(
  () => assertOwnerIsolation('owner-a', [[
    { owner_user_id: 'owner-a' },
    { owner_user_id: 'owner-b' },
  ]]),
  (error) => error instanceof OwnerIsolationError && error.code === 'CROSS_OWNER_DATA_REFUSED',
)
assert.notEqual(familyOfficeSWRKey('owner-a'), familyOfficeSWRKey('owner-b'))
assert.notDeepEqual(ownerScopedSWRKey('targets', 'owner-a'), ownerScopedSWRKey('targets', 'owner-b'))
assert.throws(() => ownerScopedSWRKey('targets', ''), /owner identity/i)

console.log('two-owner UI isolation and Production command guard tests: PASS')
