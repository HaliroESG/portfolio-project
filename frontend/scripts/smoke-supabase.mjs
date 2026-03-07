import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const outArg = process.argv.find((a) => a.startsWith('--output='))
const output = outArg ? outArg.split('=')[1] : 'smoke-supabase-report.json'
const MARKET_WATCH_TECHNICAL_SELECTOR =
  'ticker,last_update,macd_line,macd_signal,macd_hist,rsi_14,momentum_20,trend_state,trend_changed'
const MARKET_WATCH_BASE_SELECTOR = 'ticker,last_update,data_status,last_price,currency'

if (!url || !anon) {
  const report = {
    ok: false,
    status: 'FAIL',
    error: 'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
  }
  console.log(JSON.stringify(report, null, 2))
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
  process.exit(2)
}

const supabase = createClient(url, anon)

async function q(name, fn) {
  const { data, error, count } = await fn()
  if (error) return { name, ok: false, status: 'FAIL', error: error.message }
  return { name, ok: true, status: 'PASS', row_count: count ?? (data?.length ?? 0), sample: data?.[0] ?? null }
}

function isMissingColumnError(message) {
  return /column .* does not exist/i.test(message || '')
}

async function marketWatchCheck() {
  const technicalAttempt = await supabase
    .from('market_watch')
    .select(MARKET_WATCH_TECHNICAL_SELECTOR, { count: 'exact' })
    .limit(5)

  if (!technicalAttempt.error) {
    return {
      name: 'market_watch',
      ok: true,
      status: 'PASS',
      technical_schema: 'present',
      row_count: technicalAttempt.count ?? (technicalAttempt.data?.length ?? 0),
      sample: technicalAttempt.data?.[0] ?? null,
    }
  }

  if (!isMissingColumnError(technicalAttempt.error.message)) {
    return {
      name: 'market_watch',
      ok: false,
      status: 'FAIL',
      error: technicalAttempt.error.message,
    }
  }

  const fallbackAttempt = await supabase
    .from('market_watch')
    .select(MARKET_WATCH_BASE_SELECTOR, { count: 'exact' })
    .limit(5)

  if (fallbackAttempt.error) {
    return {
      name: 'market_watch',
      ok: false,
      status: 'FAIL',
      error: technicalAttempt.error.message,
      fallback_error: fallbackAttempt.error.message,
    }
  }

  return {
    name: 'market_watch',
    ok: false,
    status: 'BLOCKED',
    blocked_reason: 'Technical schema drift: required columns for BL-001 are missing in market_watch.',
    error: technicalAttempt.error.message,
    fallback_selector_used: MARKET_WATCH_BASE_SELECTOR,
    row_count: fallbackAttempt.count ?? (fallbackAttempt.data?.length ?? 0),
    sample: fallbackAttempt.data?.[0] ?? null,
  }
}

const checks = await Promise.all([
  marketWatchCheck(),
  q('currencies', () => supabase.from('currencies').select('id,symbol,rate_to_eur,last_update', { count: 'exact' }).limit(5)),
  q('valuation_snapshots', () => supabase.from('valuation_snapshots').select('coverage_pct,created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(5)),
  q('news_feed', () => supabase.from('news_feed').select('id,title,impact_score,published_at,ticker', { count: 'exact' }).limit(5)),
  q('macro_indicators', () => supabase.from('macro_indicators').select('id,name,value,last_update', { count: 'exact' }).limit(5)),
  q('etl_runs', () => supabase.from('etl_runs').select('job_name,status,started_at,finished_at,duration_sec', { count: 'exact' }).order('started_at', { ascending: false }).limit(5)),
])

const hasFail = checks.some((c) => c.status === 'FAIL')
const hasBlocked = checks.some((c) => c.status === 'BLOCKED')
const status = hasFail ? 'FAIL' : hasBlocked ? 'BLOCKED' : 'PASS'
const ok = status === 'PASS'
const report = { ok, status, checks }
console.log(JSON.stringify(report, null, 2))
fs.writeFileSync(output, JSON.stringify(report, null, 2))
if (status === 'PASS') {
  process.exit(0)
}
if (status === 'BLOCKED') {
  process.exit(3)
}
process.exit(1)
