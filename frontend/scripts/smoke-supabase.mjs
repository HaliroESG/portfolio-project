import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

function loadLocalEnv() {
  const env = {}
  for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!match) continue
      const [, key, rawValue] = match
      env[key] = rawValue.trim().replace(/^['"]|['"]$/g, '')
    }
  }
  return env
}

const localEnv = loadLocalEnv()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || localEnv.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
const ciSkipMissing = process.argv.includes('--ci-skip-missing-env')
const outArg = process.argv.find((a) => a.startsWith('--output='))
const output = outArg ? outArg.split('=')[1] : 'smoke-supabase-report.json'
const MARKET_WATCH_TECHNICAL_SELECTOR =
  'ticker,last_update,macd_line,macd_signal,macd_hist,rsi_14,momentum_20,trend_state,trend_changed'
const MARKET_WATCH_BASE_SELECTOR = 'ticker,last_update,data_status,last_price,currency'

if (!url || !anon) {
  const report = {
    ok: ciSkipMissing,
    status: ciSkipMissing ? 'SKIPPED' : 'FAIL',
    skipped: ciSkipMissing,
    error: 'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
  }
  console.log(JSON.stringify(report, null, 2))
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
  process.exit(ciSkipMissing ? 0 : 2)
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

async function tridentLatestCheck() {
  const check = await q('trident_screener_latest', () =>
    supabase
      .from('trident_screener_latest')
      .select('instrument_key,ticker,score,confidence,overall_state,latest_roic,latest_net_debt_to_ebitda,updated_at', { count: 'exact' })
      .limit(5)
  )

  if (check.ok && check.row_count === 0) {
    if (process.env.REQUIRE_TRIDENT_ROWS === 'true') {
      return {
        ...check,
        ok: false,
        status: 'FAIL',
        error: 'Trident is enabled but trident_screener_latest returned zero rows.',
      }
    }

    return {
      ...check,
      feature_state: 'UNCONFIGURED_OR_EMPTY',
      warning: 'Trident schema is readable but no provider rows were returned.',
    }
  }

  return check
}

const checks = await Promise.all([
  marketWatchCheck(),
  q('currencies', () => supabase.from('currencies').select('id,symbol,rate_to_eur,last_update', { count: 'exact' }).limit(5)),
  q('valuation_snapshots', () => supabase.from('valuation_snapshots').select('coverage_pct,created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(5)),
  q('news_feed', () => supabase.from('news_feed').select('id,title,impact_score,published_at,ticker', { count: 'exact' }).limit(5)),
  q('macro_indicators', () => supabase.from('macro_indicators').select('id,name,value,last_update', { count: 'exact' }).limit(5)),
  q('etl_runs', () => supabase.from('etl_runs').select('job_name,status,started_at,finished_at,duration_sec', { count: 'exact' }).order('started_at', { ascending: false }).limit(5)),
  tridentLatestCheck(),
  q('trident_criterion_results', () => supabase.from('trident_criterion_results').select('instrument_key,horizon_years,criterion_key,category,status,actual,threshold', { count: 'exact' }).limit(5)),
  q('historical_prices', () => supabase.from('historical_prices').select('ticker,date,adj_close,currency,source,updated_at', { count: 'exact' }).limit(5)),
  q('historical_price_coverage', () => supabase.from('historical_price_coverage').select('ticker,requested_start_date,requested_end_date,earliest_date,coverage_pct,used_proxy,updated_at', { count: 'exact' }).limit(5)),
  q('backtest_runs', () => supabase.from('backtest_runs').select('id,name,created_at,base_currency,start_date,end_date,start_date_effective,end_date_effective,data_mode', { count: 'exact' }).order('created_at', { ascending: false }).limit(5)),
  q('backtest_portfolios', () => supabase.from('backtest_portfolios').select('run_id,portfolio_key,portfolio_id,preset_key,label,role,start_date_effective', { count: 'exact' }).limit(5)),
  q('backtest_results', () => supabase.from('backtest_results').select('run_id,portfolio_key,date,nav,drawdown,returns_daily', { count: 'exact' }).limit(5)),
  q('backtest_kpis', () => supabase.from('backtest_kpis').select('run_id,portfolio_key,cagr,vol,sharpe,sortino,max_drawdown,calmar,worst_year,best_year', { count: 'exact' }).limit(5)),
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
