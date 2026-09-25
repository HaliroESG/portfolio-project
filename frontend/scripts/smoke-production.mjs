import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const productionUrl = process.env.PRODUCTION_APP_URL || process.env.VERCEL_PRODUCTION_URL || process.argv.find((arg) => arg.startsWith('--url='))?.split('=')[1]
const output = process.argv.find((arg) => arg.startsWith('--output='))?.split('=')[1] ?? 'production-smoke-report.json'
const supabaseOutput = path.join(path.dirname(output), 'smoke-supabase-production-report.json')

function run(label, command, args, env = {}) {
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
  return {
    label,
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exit_code: result.status,
    duration_ms: Date.now() - started,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

const checks = []
if (!productionUrl) {
  checks.push({
    label: 'production_url',
    status: 'FAIL',
    error: 'PRODUCTION_APP_URL or --url=https://... is required',
  })
} else {
  checks.push({
    label: 'production_url',
    status: 'PASS',
    url: productionUrl,
  })
  checks.push(run(
    'supabase_anon_contract',
    process.execPath,
    ['scripts/smoke-supabase.mjs', `--output=${supabaseOutput}`],
    {
      REQUIRE_TRIDENT_ROWS: 'true',
      REQUIRE_EQUITY_SCREENER_ROWS: 'true',
    }
  ))
  checks.push(run(
    'vercel_browser_runtime',
    process.execPath,
    ['scripts/browser-smoke.mjs'],
    {
      BASE_URL: productionUrl,
      VERCEL_PROTECTION_BYPASS: process.env.VERCEL_PROTECTION_BYPASS || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '',
    }
  ))
}

const ok = checks.every((check) => check.status === 'PASS')
const report = {
  ok,
  status: ok ? 'PASS' : 'FAIL',
  generated_at: new Date().toISOString(),
  production_url: productionUrl ?? null,
  checks,
}

console.log(JSON.stringify(report, null, 2))
fs.writeFileSync(output, JSON.stringify(report, null, 2))
process.exit(ok ? 0 : 1)
