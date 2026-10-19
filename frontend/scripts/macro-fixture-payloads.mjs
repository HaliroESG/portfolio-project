import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
export const root = fileURLToPath(new URL('../..', import.meta.url))
export function macroFixtures() {
  const fixtures = JSON.parse(readFileSync(path.join(root, 'backend/tests/fixtures/macro_contracts_v1.json'), 'utf8'))
  const python = String.raw`
import json,sys
sys.path.insert(0,'tests')
from source_contracts_offline_guard import install
install()
from macro_contracts import prepare_macro_series, derive_misery, derive_jpy_realized_volatility
data=json.load(sys.stdin)
results=[]
for c in data['cases']:
    if c['kind']=='series':
        r=prepare_macro_series(c['rows'],series_id=c['series_id'],now=data['now'],policy=c['policy'])
    elif c['kind']=='misery':
        r=derive_misery(c['cpi'],c['unrate'],now=data['now'],policies=c['policies'])
    else:
        r=derive_jpy_realized_volatility(c['rows'],now=data['now'],policy=c['policy'],
             result_policy=c['result_policy'],sessions=c['sessions'],calendar_ref=c['calendar_ref'])
    results.append(r)
print(json.dumps(results,allow_nan=False))
`
  const child = spawnSync('python3.11', ['-B', '-c', python], {
    cwd: path.join(root, 'backend'), env: { PATH: process.env.PATH, PYTHONNOUSERSITE: '1' },
    input: JSON.stringify(fixtures), encoding: 'utf8', timeout: 10000, maxBuffer: 4_000_000,
  })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 0, 'Offline Python macro preparation: ' + child.stderr)
  return { fixtures, payloads: JSON.parse(child.stdout) }
}
