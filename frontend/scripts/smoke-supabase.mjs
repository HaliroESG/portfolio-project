import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const ciSkipMissing = process.argv.includes('--ci-skip-missing-env')
const outputArg = process.argv.find((a) => a.startsWith('--output='))
const outputPath = outputArg ? outputArg.split('=')[1] : 'smoke-supabase-report.json'

function writeReport(report) {
  try {
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2))
  } catch {
    // best effort only
  }
}

if (!url || !anon) {
  const report = {
    ok: false,
    skipped: !!ciSkipMissing,
    reason: 'Missing NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY',
  }
  writeReport(report)
  console.log(JSON.stringify(report, null, 2))
  process.exit(ciSkipMissing ? 0 : 2)
}

const supabase = createClient(url, anon)

function ageMinutes(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return Math.round((Date.now() - d.getTime()) / 60000)
}

function maxTimestamp(rows, field) {
  if (!field || !rows.length) return null
  const vals = rows.map((r) => r?.[field]).filter((v) => typeof v === 'string')
  if (vals.length === 0) return null
  return vals.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
}

async function runQuery(name, queryFactory, expectedColumns, tsField) {
  const { data, error, count } = await queryFactory()
  if (error) {
    return { name, ok: false, error: error.message }
  }

  const rows = data ?? []
  const sample = rows[0] ?? {}
  const missingColumns = expectedColumns.filter((c) => !(c in sample) && rows.length > 0)
  if (missingColumns.length > 0) {
    return {
      name,
      ok: false,
      error: `Missing expected columns: ${missingColumns.join(', ')}`,
      row_count: typeof count === 'number' ? count : rows.length,
    }
  }

  const maxTs = maxTimestamp(rows, tsField)
  return {
    name,
    ok: true,
    row_count: typeof count === 'number' ? count : rows.length,
    max_timestamp_field: tsField ?? null,
    max_timestamp: maxTs,
    max_timestamp_age_minutes: ageMinutes(maxTs),
  }
}

async function nonNullCount(table, column) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .not(column, 'is', null)
  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true, count: count ?? 0 }
}

async function main() {
  const checks = []

  checks.push(
    await runQuery(
      'market_watch',
      () =>
        supabase
          .from('market_watch')
          .select(
            'ticker,name,last_price,currency,data_status,last_update,ma200_value,ma200_status,trend_slope,volatility_30d,macd_line,macd_signal,macd_hist,rsi_14,momentum_20,trend_state,trend_changed',
            { count: 'exact' }
          )
          .order('last_update', { ascending: false })
          .limit(5),
      [
        'ticker',
        'name',
        'last_price',
        'currency',
        'data_status',
        'last_update',
        'ma200_value',
        'ma200_status',
        'trend_slope',
        'volatility_30d',
        'macd_line',
        'macd_signal',
        'macd_hist',
        'rsi_14',
        'momentum_20',
        'trend_state',
        'trend_changed',
      ],
      'last_update'
    )
  )

  checks.push(
    await runQuery(
      'currencies',
      () =>
        supabase
          .from('currencies')
          .select('id,symbol,rate_to_eur,last_update', { count: 'exact' })
          .order('id', { ascending: true })
          .limit(5),
      ['id', 'symbol', 'rate_to_eur', 'last_update'],
      'last_update'
    )
  )

  checks.push(
    await runQuery(
      'valuation_snapshots',
      () =>
        supabase
          .from('valuation_snapshots')
          .select('coverage_pct,created_at', { count: 'exact' })
          .order('created_at', { ascending: false })
          .limit(5),
      ['coverage_pct', 'created_at'],
      'created_at'
    )
  )

  checks.push(
    await runQuery(
      'news_feed',
      () =>
        supabase
          .from('news_feed')
          .select('id,title,impact_score,published_at,ticker', { count: 'exact' })
          .order('published_at', { ascending: false })
          .limit(5),
      ['id', 'title', 'impact_score', 'published_at', 'ticker'],
      'published_at'
    )
  )

  checks.push(
    await runQuery(
      'macro_indicators',
      () =>
        supabase
          .from('macro_indicators')
          .select('id,name,value,last_update', { count: 'exact' })
          .order('last_update', { ascending: false })
          .limit(5),
      ['id', 'name', 'value', 'last_update'],
      'last_update'
    )
  )

  checks.push(
    await runQuery(
      'etl_runs',
      () =>
        supabase
          .from('etl_runs')
          .select('job_name,status,started_at,finished_at,duration_sec', { count: 'exact' })
          .order('started_at', { ascending: false })
          .limit(5),
      ['job_name', 'status', 'started_at', 'finished_at', 'duration_sec'],
      'started_at'
    )
  )

  const techCols = ['macd_line', 'macd_signal', 'macd_hist', 'rsi_14', 'momentum_20']
  const techCounts = {}
  let techError = null
  for (const col of techCols) {
    const result = await nonNullCount('market_watch', col)
    if (!result.ok) {
      techError = result.error
      break
    }
    techCounts[col] = result.count
  }

  const failedChecks = checks.filter((c) => !c.ok)
  const report = {
    ok: failedChecks.length === 0 && !techError,
    checks,
    technical_non_null_counts: techCounts,
    technical_counts_error: techError,
  }

  writeReport(report)
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.ok ? 0 : 1)
}

main().catch((err) => {
  const report = { ok: false, fatal: err.message }
  writeReport(report)
  console.error(JSON.stringify(report, null, 2))
  process.exit(1)
})
