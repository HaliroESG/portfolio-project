import assert from 'node:assert/strict'
import { classifyAuthRedirect } from './browser-smoke-auth.mjs'

assert.deepEqual(
  classifyAuthRedirect('http://127.0.0.1:3001/login?next=%2Ftrident', '/trident', true),
  { detected: true, valid: true, reason: 'expected authentication redirect' }
)

assert.equal(
  classifyAuthRedirect('http://127.0.0.1:3001/login?next=%2Fscreener', '/trident', true).valid,
  false
)
assert.equal(
  classifyAuthRedirect('http://127.0.0.1:3001/login?next=%2Ftrident', '/trident', false).valid,
  false
)
assert.deepEqual(
  classifyAuthRedirect('http://127.0.0.1:3001/trident', '/trident', false),
  { detected: false, valid: false, reason: 'not redirected to /login' }
)

console.log('browser smoke auth tests: PASS')
