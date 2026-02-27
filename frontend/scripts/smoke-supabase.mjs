import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const outArg = process.argv.find((a) => a.startsWith('--output='))
const output = outArg ? outArg.split('=')[1] : 'smoke-supabase-report.json'

if (!url || !anon) {
  const report = { ok: false, error: 'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY' }
  console.log(JSON.stringify(report, null, 2))
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
  process.exit(2)
}

const supabase = createClient(url, anon)

async function q(name, fn) {
  const { data, error, count } = await fn()
  if (error) return { name, ok: false, error: error.message }
  return { name, ok: true, row_count: count ?? (data?.length ?? 0), sample: data?.[0] ?? null }
}

const checks = await Promise.all([
  q('market_watch', () => supabase.from('market_watch').select('ticker,last_update,macd_line,macd_signal,macd_hist,rsi_14,momentum_20,trend_state,trend_changed', { count: 'exact' }).limit(5)),
  q('currencies', () => supabase.from('currencies').select('id,symbol,rate_to_eur,last_update', { count: 'exact' }).limit(5)),
  q('valuation_snapshots', () => supabase.from('valuation_snapshots').select('coverage_pct,created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(5)),
  q('news_feed', () => supabase.from('news_feed').select('id,title,impact_score,published_at,ticker', { count: 'exact' }).limit(5)),
  q('macro_indicators', () => supabase.from('macro_indicators').select('id,name,value,last_update', { count: 'exact' }).limit(5)),
  q('etl_runs', () => supabase.from('etl_runs').select('job_name,status,started_at,finished_at,duration_sec', { count: 'exact' }).order('started_at', { ascending: false }).limit(5)),
])

const ok = checks.every((c) => c.ok)
const report = { ok, checks }
console.log(JSON.stringify(report, null, 2))
fs.writeFileSync(output, JSON.stringify(report, null, 2))
process.exit(ok ? 0 : 1)
