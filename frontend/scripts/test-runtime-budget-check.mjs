import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Exercise the real CLI against disposable source snapshots; never import readers
// or contact a database. These are structural guard tests, not runtime proof.
const script = fileURLToPath(new URL('./runtime-budget-check.mjs', import.meta.url))
const sourceRoot = path.resolve(path.dirname(script), '../..')
const files = [
  'frontend/app/trident/page.tsx', 'frontend/app/screener/page.tsx',
  'frontend/app/targets/page.tsx', 'frontend/app/supports/page.tsx',
  'frontend/app/page.tsx', 'frontend/lib/familyOfficeData.ts',
  'frontend/components/DataHealthPanel.tsx', 'frontend/app/publications/page.tsx',
  'frontend/lib/equityPublicationsData.ts',
]
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'astrocyte-runtime-budget-'))
const dashboard = 'frontend/app/page.tsx'
const reader = 'frontend/lib/familyOfficeData.ts'
const guard = 'dashboard.family_office_bounded_reads'
const original = new Map(files.map(name => [name, fs.readFileSync(path.join(sourceRoot, name), 'utf8')]))

function check(label, file, before, after) {
  const target = file && path.join(fixture, file)
  if (file) {
    const source = original.get(file)
    assert.equal(source.split(before).length - 1, 1, `unique mutation anchor: ${label}`)
    fs.writeFileSync(target, source.replace(before, after))
  }
  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: path.join(fixture, 'frontend'), env: {}, encoding: 'utf8', timeout: 10_000,
    })
    assert.ifError(result.error)
    assert.equal(result.signal, null, label)
    assert.equal(result.status, file ? 1 : 0, `${label}: ${result.stdout}\n${result.stderr}`)
    assert.ok((file ? result.stderr : result.stdout).includes(`${file ? 'FAIL' : 'PASS'} ${guard}`), label)
    console.log(`PASS ${label}`)
  } finally {
    if (file) fs.writeFileSync(target, original.get(file))
  }
}

try {
  for (const [name, content] of original) {
    const target = path.join(fixture, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  check('current dashboard delegates to the scoped shared hook')
  check('direct page reader bypass rejected', dashboard, 'useFamilyOfficeBundle(supabase)', 'loadFamilyOfficeBundle(supabase)')
  check('missing shared hook rejected', reader, 'export function useFamilyOfficeBundle(', 'export function disconnectedHook(')
  check('missing SWR import rejected', reader, "import useSWR from 'swr'", '')
  check('disconnected cache rejected', reader, 'const result = useSWR(', 'const result = disconnectedCache(')
  check('owner omitted from cache key rejected', reader, '[FAMILY_OFFICE_SWR_KEY, owner, pathname]', '[FAMILY_OFFICE_SWR_KEY, pathname]')
  check('route omitted from cache key rejected', reader, '[FAMILY_OFFICE_SWR_KEY, owner, pathname]', '[FAMILY_OFFICE_SWR_KEY, owner]')
  check('missing bounded loader rejected', reader, 'const bundle = await loadFamilyOfficeBundle(supabase)', 'const bundle = await otherLoader(supabase)')
  check('missing parallel read bundle rejected', reader, 'const results = await Promise.all([', 'const results = await otherReads([')
  for (const limit of [1500, 100, 36]) {
    check(`removed ${limit} row cap rejected`, reader, `.limit(${limit})`, '')
    check(`enlarged ${limit} row cap rejected`, reader, `.limit(${limit})`, `.limit(${limit * 10})`)
  }
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}
