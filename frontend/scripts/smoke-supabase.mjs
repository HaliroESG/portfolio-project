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
const smokeKey = process.env.SUPABASE_SMOKE_KEY || process.env.SUPABASE_SERVICE_KEY || anon
const ciSkipMissing = process.argv.includes('--ci-skip-missing-env')
const outArg = process.argv.find((a) => a.startsWith('--output='))
const output = outArg ? outArg.split('=')[1] : 'smoke-supabase-report.json'
const requireTridentRows = process.env.REQUIRE_TRIDENT_ROWS === 'true'
const requireEquityScreenerRows = process.env.REQUIRE_EQUITY_SCREENER_ROWS === 'true'
const requireEquityPublicationRows = process.env.REQUIRE_EQUITY_PUBLICATION_ROWS === 'true'
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

const supabase = createClient(url, smokeKey)

async function q(name, fn) {
  const { data, error, count } = await fn()
  if (error) return { name, ok: false, status: 'FAIL', error: error.message }
  return { name, ok: true, status: 'PASS', row_count: count ?? (data?.length ?? 0), sample: data?.[0] ?? null }
}

function isMissingColumnError(message) {
  return /column .* does not exist/i.test(message || '') || /could not find .* column/i.test(message || '')
}

function isMissingRelationError(message) {
  return /could not find the table/i.test(message || '') || /relation .* does not exist/i.test(message || '')
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
  let check = await q('trident_screener_latest', () =>
    supabase
      .from('trident_screener_latest')
      .select('instrument_key,ticker,provider_symbol,score,confidence,overall_state,source_provider,source_index,criteria_pass_count,criteria_fail_count,criteria_missing_count,latest_roic,latest_net_debt_to_ebitda,updated_at', { count: 'exact' })
      .limit(5)
  )

  if (!check.ok && isMissingColumnError(check.error) && check.error.includes('provider_symbol')) {
    check = await q('trident_screener_latest', () =>
      supabase
        .from('trident_screener_latest')
        .select('instrument_key,ticker,score,confidence,overall_state,source_provider,source_index,criteria_pass_count,criteria_fail_count,criteria_missing_count,latest_roic,latest_net_debt_to_ebitda,updated_at', { count: 'exact' })
        .limit(5)
    )
    if (check.ok) {
      check.schema_warning = 'provider_symbol is missing from trident_screener_latest; apply backend/sql/20260525_portfolio_decision_items.sql.'
    }
  }

  if (check.ok && check.row_count === 0) {
    if (requireTridentRows) {
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

async function tridentPriceCoverageCheck() {
  const topN = Number.parseInt(process.env.TRIDENT_HISTORY_TOP_N || '20', 10)
  const enforce = process.env.REQUIRE_TRIDENT_HISTORY_COVERAGE === 'true'
  const minimumCoveragePct = Number.parseFloat(process.env.TRIDENT_HISTORY_MIN_COVERAGE_PCT || '80')
  let { data, error } = await supabase
    .from('trident_screener_latest')
    .select('ticker,provider_symbol,score')
    .order('score', { ascending: false, nullsFirst: false })
    .limit(Number.isFinite(topN) && topN > 0 ? topN : 20)

  let schemaWarning
  if (error && isMissingColumnError(error.message) && error.message.includes('provider_symbol')) {
    const fallback = await supabase
      .from('trident_screener_latest')
      .select('ticker,score')
      .order('score', { ascending: false, nullsFirst: false })
      .limit(Number.isFinite(topN) && topN > 0 ? topN : 20)
    data = fallback.data
    error = fallback.error
    schemaWarning = 'provider_symbol is missing from trident_screener_latest; coverage checked by ticker only.'
  }

  if (error) {
    return {
      name: 'trident_top_price_history',
      ok: false,
      status: 'FAIL',
      error: error.message,
    }
  }

  const rows = data ?? []
  if (rows.length === 0) {
    return {
      name: 'trident_top_price_history',
      ok: true,
      status: 'PASS',
      feature_state: 'UNCONFIGURED_OR_EMPTY',
      warning: 'No Trident rows to evaluate for historical price coverage.',
    }
  }

  const coverage = []
  for (const row of rows) {
    const symbols = Array.from(
      new Set([row.ticker, row.provider_symbol].filter(Boolean).map((value) => String(value).trim().toUpperCase()))
    )
    const query = supabase
      .from('historical_prices')
      .select('ticker', { count: 'exact', head: true })
    const history = symbols.length === 1 ? await query.eq('ticker', symbols[0]) : await query.in('ticker', symbols)
    coverage.push({
      ticker: row.ticker,
      provider_symbol: row.provider_symbol ?? null,
      score: row.score ?? null,
      historical_rows: history.error ? 0 : history.count ?? 0,
      error: history.error?.message,
    })
  }

  const missing = coverage.filter((row) => row.historical_rows === 0)
  const coveragePct = ((coverage.length - missing.length) / coverage.length) * 100
  const pass = !enforce || coveragePct >= minimumCoveragePct

  return {
    name: 'trident_top_price_history',
    ok: pass,
    status: pass ? 'PASS' : 'FAIL',
    enforced: enforce,
    top_n: coverage.length,
    coverage_pct: Number(coveragePct.toFixed(2)),
    minimum_coverage_pct: minimumCoveragePct,
    missing_count: missing.length,
    missing: missing.slice(0, 20),
    warning: schemaWarning ?? (missing.length > 0 ? 'Some top Trident rows have no historical price rows for ticker/provider_symbol.' : undefined),
  }
}

async function equityScreenerCheck() {
  const check = await q('equity_screener_latest', () =>
    supabase
      .from('equity_screener_latest')
      .select('instrument_key,ticker,country,sector,themes,market_cap,valuation_currency,market_cap_usd,market_cap_fx_rate,market_cap_fx_as_of,revenue,free_cash_flow,fcf_yield,revenue_cagr_3y,forecast_revenue_growth,trailing_pe,forward_pe,regression_slope_pct,regression_z_score,ma200_state,momentum_3m_pct,momentum_12m_pct,price_coverage_pct,quality_value_score,valuation_tag,data_state,updated_at', { count: 'exact' })
      .order('quality_value_score', { ascending: false })
      .limit(10)
  )

  if (!check.ok && (isMissingColumnError(check.error) || isMissingRelationError(check.error))) {
    return {
      ...check,
      ok: !requireEquityScreenerRows,
      status: requireEquityScreenerRows ? 'FAIL' : 'PASS',
      feature_state: 'SCHEMA_PENDING',
      schema_warning: 'Apply backend/sql/20260528_equity_screener.sql and run sync_equity_screener.py.',
    }
  }

  if (check.ok && check.row_count === 0) {
    if (requireEquityScreenerRows) {
      return {
        ...check,
        ok: false,
        status: 'FAIL',
        error: 'Open equity screener is required but equity_screener_latest returned zero rows.',
      }
    }
    return {
      ...check,
      feature_state: 'UNCONFIGURED_OR_EMPTY',
      warning: 'Open equity screener schema is readable but no rows were returned.',
    }
  }

  return check
}

async function equityPublicationsCheck() {
  const check = await q('equity_publication_dashboard_latest', () =>
    supabase
      .from('equity_publication_dashboard_latest')
      .select('instrument_key,ticker,name,source_index,annual_fiscal_year,annual_period_end,annual_revenue,annual_ebitda,annual_free_cash_flow,interim_period_kind,interim_period_end,interim_revenue,interim_ebitda,interim_free_cash_flow,ttm_complete,trailing_pe,forward_pe,valuation_as_of,last_event_date,next_event_date,next_event_status,data_state,reason_codes,updated_at', { count: 'exact' })
      .limit(10)
  )

  if (!check.ok && (isMissingColumnError(check.error) || isMissingRelationError(check.error))) {
    return {
      ...check,
      ok: !requireEquityPublicationRows,
      status: requireEquityPublicationRows ? 'FAIL' : 'PASS',
      feature_state: 'SCHEMA_PENDING',
      schema_warning: 'Apply backend/sql/20260727_equity_publications.sql and run sync_equity_publications.py.',
    }
  }

  if (check.ok && check.row_count === 0) {
    return {
      ...check,
      ok: !requireEquityPublicationRows,
      status: requireEquityPublicationRows ? 'FAIL' : 'PASS',
      feature_state: 'UNCONFIGURED_OR_EMPTY',
      warning: 'Equity publication schema is readable but CAC 40 / S&P 500 rows are empty.',
    }
  }

  return check
}

async function optionalReadModelCheck(name, queryFactory, schemaWarning) {
  const check = await q(name, queryFactory)
  if (check.ok) return check
  if (isMissingColumnError(check.error) || isMissingRelationError(check.error)) {
    return {
      ...check,
      ok: true,
      status: 'PASS',
      feature_state: 'SCHEMA_PENDING',
      schema_warning: schemaWarning,
    }
  }
  return check
}

const checks = await Promise.all([
  marketWatchCheck(),
  q('currencies', () => supabase.from('currencies').select('id,symbol,rate_to_eur,last_update', { count: 'exact' }).limit(5)),
  q('valuation_snapshots', () => supabase.from('valuation_snapshots').select('owner_user_id,coverage_pct,created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(5)),
  q('news_feed', () => supabase.from('news_feed').select('id,title,impact_score,published_at,ticker', { count: 'exact' }).limit(5)),
  q('macro_indicators', () => supabase.from('macro_indicators').select('id,name,value,last_update', { count: 'exact' }).limit(5)),
  optionalReadModelCheck(
    'macro_series_latest',
    () => supabase.from('macro_series_latest').select('series_id,as_of_date,name,value,data_state,updated_at', { count: 'exact' }).limit(5),
    'Apply backend/sql/20260705_macro_strategy_pilotage.sql and run scripts/sync_macro_regime.py.'
  ),
  optionalReadModelCheck(
    'macro_regime_snapshots',
    () => supabase.from('macro_regime_snapshots').select('id,as_of_date,regime,regime_state,confidence,growth_signal,inflation_signal,liquidity_signal,updated_at', { count: 'exact' }).limit(5),
    'Apply backend/sql/20260705_macro_strategy_pilotage.sql and run scripts/sync_macro_regime.py.'
  ),
  optionalReadModelCheck(
    'macro_satellite_targets_latest',
    () => supabase.from('macro_satellite_targets_latest').select('snapshot_id,as_of_date,regime,bucket_key,effective_weight_pct,data_state,is_blocked,updated_at', { count: 'exact' }).limit(5),
    'Apply backend/sql/20260705_macro_strategy_pilotage.sql and run scripts/sync_macro_regime.py.'
  ),
  optionalReadModelCheck(
    'macro_allocation_advice_latest',
    () => supabase.from('macro_allocation_advice_latest').select('portfolio_id,regime,bucket_key,action,target_weight_pct,current_weight_pct,rebalance_amount_eur,confidence,data_state,updated_at', { count: 'exact' }).limit(5),
    'Apply backend/sql/20260705_macro_strategy_pilotage.sql and run scripts/sync_macro_regime.py.'
  ),
  q('etl_runs', () => supabase.from('etl_runs').select('job_name,status,started_at,finished_at,duration_sec', { count: 'exact' }).order('started_at', { ascending: false }).limit(5)),
  tridentLatestCheck(),
  q('trident_criterion_results', () => supabase.from('trident_criterion_results').select('instrument_key,horizon_years,criterion_key,category,status,actual,threshold', { count: 'exact' }).limit(5)),
  q('historical_prices', () => supabase.from('historical_prices').select('ticker,date,adj_close,currency,source,updated_at,adj_close_local,local_currency,fx_rate_to_eur').limit(5)),
  q('historical_price_coverage', () => supabase.from('historical_price_coverage').select('ticker,requested_start_date,requested_end_date,earliest_date,coverage_pct,used_proxy,updated_at', { count: 'exact' }).limit(5)),
  q('backtest_runs', () => supabase.from('backtest_runs').select('id,name,created_at,base_currency,start_date,end_date,start_date_effective,end_date_effective,data_mode', { count: 'exact' }).order('created_at', { ascending: false }).limit(5)),
  q('backtest_portfolios', () => supabase.from('backtest_portfolios').select('run_id,portfolio_key,portfolio_id,preset_key,label,role,start_date_effective', { count: 'exact' }).limit(5)),
  q('backtest_results', () => supabase.from('backtest_results').select('run_id,portfolio_key,date,nav,drawdown,returns_daily', { count: 'exact' }).limit(5)),
  q('backtest_kpis', () => supabase.from('backtest_kpis').select('run_id,portfolio_key,cagr,vol,sharpe,sortino,max_drawdown,calmar,worst_year,best_year', { count: 'exact' }).limit(5)),
  tridentPriceCoverageCheck(),
  equityScreenerCheck(),
  equityPublicationsCheck(),
  optionalReadModelCheck(
    'equity_reporting_calendar',
    () => supabase.from('equity_reporting_calendar').select('event_key,instrument_key,ticker,source_index,event_type,event_date,event_time_utc,status,fiscal_period_end,period_kind,match_confidence,source_provider,source_url,updated_at', { count: 'exact' }).limit(10),
    'Apply backend/sql/20260727_equity_publications.sql and run sync_equity_publications.py.'
  ),
  optionalReadModelCheck(
    'trident_stock_insights',
    () => supabase.from('trident_stock_insights').select('instrument_key,ticker,provider_symbol,business_summary,recommendation_key,target_mean_price,latest_price,regression_slope_pct,regression_z_score,ma200_state,news_items,ai_trend_summary,ai_summary_state,data_state,updated_at', { count: 'exact' }).limit(5),
    'Apply backend/sql/20260527_trident_stock_insights.sql and run sync_trident_stock_insights.py.'
  ),
  optionalReadModelCheck(
    'support_sources',
    () => supabase.from('support_sources').select('id,source_name,source_kind,provider,source_quality,source_file,source_url,source_date,updated_at', { count: 'exact' }).limit(5),
    'Apply backend/sql/20260526_supports_targets_advice.sql and run import_support_universe.py.'
  ),
  optionalReadModelCheck(
    'investment_supports',
    () => supabase.from('investment_supports').select('source_id,isin,name,support_type,sri,total_fee_pct,score,metrics_state,updated_at', { count: 'exact' }).limit(5),
    'Apply backend/sql/20260526_supports_targets_advice.sql and run import_support_universe.py.'
  ),
  optionalReadModelCheck(
    'support_source_rows',
    () => supabase.from('support_source_rows').select('source_id,external_id,isin,name,support_type,source_quality,identifier_state,envelope,updated_at', { count: 'exact' }).limit(5),
    'Apply backend/sql/20260526_supports_targets_advice.sql and run import_support_universe.py for Linxea/Fortuneo partial source rows.'
  ),
  optionalReadModelCheck(
    'target_models',
    () => supabase.from('target_models').select('id,owner_user_id,portfolio_scope,model_name,source_file,target_total_pct,status,updated_at', { count: 'exact' }).limit(5),
    'Apply backend/sql/20260526_supports_targets_advice.sql and run import_target_model.py.'
  ),
  optionalReadModelCheck(
    'allocation_advice_items_latest',
    () => supabase.from('allocation_advice_items_latest').select('portfolio_scope,model_id,bucket_key,action,preferred_execution,confidence,updated_at', { count: 'exact' }).limit(5),
    'Apply backend/sql/20260526_supports_targets_advice.sql and import active target models.'
  ),
  q('fo_owner_profiles', () => supabase.from('fo_owner_profiles').select('user_id,email,base_currency,created_at', { count: 'exact' }).limit(2)),
  q('fo_portfolios', () => supabase.from('fo_portfolios').select('id,owner_user_id,name,portfolio_type,base_currency,status,updated_at', { count: 'exact' }).limit(5)),
  q('fo_accounts', () => supabase.from('fo_accounts').select('id,owner_user_id,portfolio_id,institution_id,name,envelope,base_currency,status', { count: 'exact' }).limit(5)),
  q('fo_ledger_entries', () => supabase.from('fo_ledger_entries').select('id,owner_user_id,account_id,event_type,trade_date,currency,idempotency_key', { count: 'exact' }).limit(5)),
  q('fo_positions_latest', () => supabase.from('fo_positions_latest').select('id,owner_user_id,portfolio_id,account_id,instrument_key,snapshot_date,market_value_eur,data_state,reconciliation_state', { count: 'exact' }).limit(5)),
  q('fo_portfolio_overview_latest', () => supabase.from('fo_portfolio_overview_latest').select('owner_user_id,portfolio_id,portfolio_name,net_asset_value_eur,coverage_pct,performance_state,open_exception_count,updated_at', { count: 'exact' }).limit(5)),
  q('fo_operations_inbox', () => supabase.from('fo_operations_inbox').select('id,owner_user_id,portfolio_id,exception_type,severity,status,title,detected_at', { count: 'exact' }).limit(5)),
  q('fo_performance_daily', () => supabase.from('fo_performance_daily').select('portfolio_id,performance_date,nav_eur,twr_ytd,xirr_since_inception,coverage_pct,data_state', { count: 'exact' }).limit(5)),
  q('fo_decisions', () => supabase.from('fo_decisions').select('id,owner_user_id,portfolio_id,title,status,created_at', { count: 'exact' }).limit(5)),
  q('fo_monthly_closes', () => supabase.from('fo_monthly_closes').select('id,owner_user_id,portfolio_id,period_end,status,coverage_pct,reconciliation_state', { count: 'exact' }).limit(5)),
])

const hasFail = checks.some((c) => c.status === 'FAIL')
const hasBlocked = checks.some((c) => c.status === 'BLOCKED')
const status = hasFail ? 'FAIL' : hasBlocked ? 'BLOCKED' : 'PASS'
const ok = status === 'PASS'
const report = {
  ok,
  status,
  require_trident_rows: requireTridentRows,
  require_equity_screener_rows: requireEquityScreenerRows,
  require_equity_publication_rows: requireEquityPublicationRows,
  checks,
}
console.log(JSON.stringify(report, null, 2))
fs.writeFileSync(output, JSON.stringify(report, null, 2))
if (status === 'PASS') {
  process.exit(0)
}
if (status === 'BLOCKED') {
  process.exit(3)
}
process.exit(1)
