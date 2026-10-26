import fs from 'node:fs'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'
const source = fs.readFileSync(new URL('./validate-critical-flows.mjs', import.meta.url), 'utf8')
const start = source.indexOf('  // Parse before removing comments')
const end = source.indexOf('  const dataHealth =', start)
assert(start > 0 && end > start)
const block = source.slice(start, end)
const home = fs.readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8')
const reader = fs.readFileSync(new URL('../lib/familyOfficeData.ts', import.meta.url), 'utf8')
function check(page = home, lib = reader) {
  let result
  vm.runInNewContext(block, { ts, read: p => p.endsWith('/page.tsx') ? page : lib,
    hasAll: (content, patterns) => patterns.every(pattern => content.includes(pattern)),
    addCheck: (name, ok) => { if (name === 'frontend.dashboard.family_office_shared_cache') result = ok },
  })
  assert.equal(typeof result, 'boolean')
  return result
}
assert.equal(check(), true)
const mutations = [
  ['unscoped cache', 'useSWR(owner ? [FAMILY_OFFICE_SWR_KEY, owner, pathname] : null,', 'useSWR(FAMILY_OFFICE_SWR_KEY,'],
  ['trust session payload', 'supabase.auth.getUser()', 'supabase.auth.getSession()'],
  ['no initial invalidation', 'setSession(null)', 'setSession(session)'],
  ['no post-read verification', 'const bundle = await loadFamilyOfficeBundle(supabase)\n    await verifyOwner()', 'const bundle = await loadFamilyOfficeBundle(supabase)'],
  ['cached previous data visible', 'keepPreviousData: false', 'keepPreviousData: true'],
  ['foreign owner accepted', 'row.owner_user_id !== owner', 'false'],
  ['unverified data exposed', 'data: owner && !result.error ? result.data : undefined', 'data: result.data'],
]
for (const [name, before, after] of mutations) {
  assert(reader.includes(before), name)
  assert.equal(check(home, reader.replaceAll(before, after)), false, name)
  assert.equal(check(home, reader.replaceAll(before, after) + '\n/* ' + before + ' */'), false, name + ' hidden in comment')
}
assert.equal(check(home.replaceAll('<FamilyOfficeStateBadge', '<RemovedBadge')), false)
assert.equal(check(home.replaceAll("data?.schemaState === 'SCHEMA_PENDING'", 'false')), false)
assert.equal(check(home.replaceAll('useFamilyOfficeBundle(supabase)', 'unscopedLoader()')), false)
console.log('PASS 18 static contract positive/negative cases; no runtime certification')
