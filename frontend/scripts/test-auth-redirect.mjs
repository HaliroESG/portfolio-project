import assert from 'node:assert/strict'

const { resolveAuthRedirectOrigin } = await import('../lib/authRedirect.ts')

assert.equal(
  resolveAuthRedirectOrigin(
    'https://localhost:8080/auth/callback?code=one-time-code',
    'https://astrocyte-readonly-v6379.ondigitalocean.app',
  ),
  'https://astrocyte-readonly-v6379.ondigitalocean.app',
)
assert.equal(
  resolveAuthRedirectOrigin('http://localhost:3000/auth/callback', ''),
  'http://localhost:3000',
)
assert.equal(
  resolveAuthRedirectOrigin('http://localhost:3000/auth/callback', 'http://localhost:3001'),
  'http://localhost:3001',
)

for (const untrustedOrigin of [
  'http://example.com',
  'https://user:password@example.com',
  'https://example.com/auth/callback',
  'https://example.com?next=evil.example',
  'not-a-url',
]) {
  assert.equal(
    resolveAuthRedirectOrigin('https://safe.example/auth/callback', untrustedOrigin),
    'https://safe.example',
  )
}

console.log('auth redirect tests: PASS')
