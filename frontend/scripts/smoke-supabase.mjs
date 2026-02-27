import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const ciSkipMissing = process.argv.includes('--ci-skip-missing-env')

if (!url || !anon) {
  const msg = 'Missing NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY'
  if (ciSkipMissing) {
    console.log(JSON.stringify({ skipped: true, reason: msg }, null, 2))
    process.exit(0)
  }
  console.error(msg)
  process.exit(2)
}

const supabase = createClient(url, anon)

function ageMinutes(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return Math.round((Date.now() - d.getTime()) / 60000)
}

async function runQuery(name, queryFactory, keys, tsField) {
  const { data, error, count } = await queryFactory()
  if (error) {
    return { name, ok: false, error: error.message }
  }
  const rows = data ?? []
  const sample = rows[0] ?? null
  const missingKeys = sample
    ? keys.filter((k) => !(k in sample))
    : []

  if (missingKeys.length > 0) {
    return {
      name,
      ok: false,
      error: `Missing expected columns in sample row: ${missingKeys.join(', ')}`,
    }
  }

  const latestTs = rows.length > 0 && tsField ? rows[0][tsField] ?? null : null
  return {
    name,
    ok: true,
    row_count: typeof count === 'number' ? count : rows.length,
    keys_present: sample ? keys.filter((k) => k in sample) : [],
    latest_timestamp_field: tsField ?? null,
    latest_timestamp_value: latestTs,
    latest_age_minutes: ageMinutes(latestTs),
  }
}

async function main() {
  const checks = await Promise.all([
    runQuery(
      'market_watch',
      () => supabase
        .from('market_watch')
        .select('ticker,last_update,macd_line,macd_signal,macd_hist,rsi_14,momentum_20,trend_state,trend_changed', { count: 'exact' })
        .order('last_update', { ascending: false })
        .limit(20),
      ['ticker', 'last_update', 'macd_line', 'macd_signal', 'macd_hist', 'rsi_14', 'momentum_20', 'trend_state', 'trend_changed'],
      'last_update'
    ),
    runQuery(
      'currencies',
      () => supabase
        .from('currencies')
        .select('id,symbol,rate_to_eur,last_update', { count: 'exact' })
        .order('id', { ascending: true })
        .limit(20),
      ['id', 'symbol', 'rate_to_eur', 'last_update'],
      'last_update'
    ),
    runQuery(
      'valuation_snapshots',
      () => supabase
        .from('valuation_snapshots')
        .select('coverage_pct,portfolio_id,created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(20),
      ['coverage_pct', 'portfolio_id', 'created_at'],
      'created_at'
    ),
    runQuery(
      'news_feed',
      () => supabase
        .from('news_feed')
        .select('id,title,source,published_at,impact_level,impact_score,ticker', { count: 'exact' })
        .order('published_at', { ascending: false })
        .limit(20),
      ['id', 'title', 'source', 'published_at', 'impact_level', 'impact_score', 'ticker'],
      'published_at'
    ),
    runQuery(
      'etl_runs',
      () => supabase
        .from('etl_runs')
        .select('job_name,status,started_at,finished_at,duration_sec,stats,error', { count: 'exact' })
        .order('started_at', { ascending: false })
        .limit(20),
      ['job_name', 'status', 'started_at', 'finished_at', 'duration_sec', 'stats', 'error'],
      'started_at'
    ),
  ])

  const failed = checks.filter((c) => !c.ok)
  const report = {
    ok: failed.length === 0,
    checks,
  }

  console.log(JSON.stringify(report, null, 2))
  process.exit(report.ok ? 0 : 1)
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, fatal: err.message }, null, 2))
  process.exit(1)
})
