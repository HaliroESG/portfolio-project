import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(process.cwd(), '..')

function read(relPath) {
  const abs = path.join(repoRoot, relPath)
  return fs.readFileSync(abs, 'utf8')
}

function hasAll(content, patterns) {
  return patterns.every((pattern) => content.includes(pattern))
}

const checks = []

function addCheck(name, ok, details) {
  checks.push({ name, ok, details })
}

try {
  const bridge = read('backend/bridge.py')
  addCheck(
    'backend.bridge.market_watch_payload_keys',
    hasAll(bridge, [
      '"trend_state": current_trend_state',
      '"technical_backfilled"',
      '"technical_ready"',
      '"perf_week_eur": mkt[\'perf_eur\'][\'week\']',
      '"perf_month_eur": mkt[\'perf_eur\'][\'month\']',
    ]),
    'Bridge should emit technical states/counters and weekly/monthly EUR perf fields.'
  )

  const portfolioData = read('frontend/lib/portfolioData.ts')
  addCheck(
    'frontend.portfolioData.market_watch_selector_and_trend_resolution',
    hasAll(portfolioData, [
      'perf_week_eur',
      'perf_month_eur',
      'trend_state',
      "return hasAnyIndicators ? 'UNKNOWN' : 'INSUFFICIENT_HISTORY'",
      "if (row.trend_state === 'UNKNOWN' || row.trend_state === 'INSUFFICIENT_HISTORY')",
    ]),
    'Portfolio data mapping should preserve explicit unknown/history states and EUR perf fields.'
  )

  const assetTable = read('frontend/components/AssetTable.tsx')
  addCheck(
    'frontend.asset_table.explicit_trend_labels',
    hasAll(assetTable, [
      "trendState === 'INSUFFICIENT_HISTORY'",
      "? 'NO HISTORY'",
      "trendState === 'NEUTRAL'",
      "'NEUTRAL (RULE)'",
      "trendState === 'UNKNOWN'",
    ]),
    'Asset table should distinguish NO HISTORY / NEUTRAL (RULE) / UNKNOWN.'
  )

  const assetDrawer = read('frontend/components/AssetDetailDrawer.tsx')
  addCheck(
    'frontend.asset_drawer.explicit_technical_unavailability',
    hasAll(assetDrawer, [
      'technicalMissingLabel',
      'technicalMissingMessage',
      "trendState === 'INSUFFICIENT_HISTORY' ? 'NO HISTORY' : 'UNKNOWN'",
    ]),
    'Asset drawer should show explicit labels/messages for technical unavailability.'
  )
  addCheck(
    'frontend.asset_drawer.price_chart_present',
    hasAll(assetDrawer, [
      "import { AssetPriceChart } from './AssetPriceChart'",
      '<AssetPriceChart ticker={asset.ticker} assetCurrency={asset.currency} />',
    ]),
    'Asset drawer should render the targeted asset price chart.'
  )

  const assetPriceChart = read('frontend/components/AssetPriceChart.tsx')
  addCheck(
    'frontend.asset_price_chart_controls_and_states',
    hasAll(assetPriceChart, [
      "const HORIZONS: PriceHistoryHorizon[] = ['YTD', '5Y', '10Y']",
      "effectiveMode === 'LOCAL'",
      'Local unavailable',
      'Short history',
      'loadAssetPriceHistory(supabase, ticker, horizon)',
    ]),
    'Asset price chart should expose horizon/currency controls and explicit data states.'
  )

  const geoPage = read('frontend/app/geo/page.tsx')
  addCheck(
    'frontend.geo.timeframe_selector_present',
    hasAll(geoPage, [
      "{ key: 'day', label: 'Daily' }",
      "{ key: 'month', label: 'Monthly' }",
      "{ key: 'ytd', label: 'YTD' }",
    ]),
    'Geo page should expose day/month/ytd selectors.'
  )

  const dashboard = read('frontend/app/page.tsx')
  addCheck(
    'frontend.dashboard.shared_portfolio_cache_key',
    hasAll(dashboard, [
      "useSWR(",
      'PORTFOLIO_AGGREGATION_SWR_KEY',
      'loadPortfolioAggregation(supabase)',
      "<DataHealthPanel />",
    ]),
    'Dashboard should use shared aggregation fetch and include DataHealth panel.'
  )

  const dataHealth = read('frontend/components/DataHealthPanel.tsx')
  addCheck(
    'frontend.data_health.threshold_and_trend_semantics',
    hasAll(dataHealth, [
      "type EtlQualityState = 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN'",
      'ETL_QUALITY_THRESHOLDS',
      'trendDirectionLabel',
      'trendBasisLabel',
      'technicalBackfilled',
    ]),
    'Data health should classify threshold states and expose ETL trend semantics.'
  )

  const fxPage = read('frontend/app/fx/page.tsx')
  addCheck(
    'frontend.fx.data_state_handling',
    hasAll(fxPage, [
      "type FxState = 'LIVE' | 'STALE' | 'CACHED' | 'EMPTY'",
      'readFxCache',
      'saveFxCache',
      'resolveFxState',
      "text: 'No Feed'",
    ]),
    'FX page should include explicit feed/cached/stale state handling.'
  )

  const types = read('frontend/types.ts')
  addCheck(
    'frontend.types.trend_and_portfolio_fields',
    hasAll(types, [
      "export type TrendState = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN' | 'INSUFFICIENT_HISTORY'",
      'quantity_buy?: number | null;',
      'quantity_current?: number | null;',
      'target_weight_pct?: number | null;',
      'portfolio_ids?: string[];',
      'portfolio_names?: string[];',
    ]),
    'types.ts should carry current trend-state and portfolio model fields.'
  )
} catch (error) {
  console.error(error)
  process.exit(2)
}

const failed = checks.filter((c) => !c.ok)
const report = {
  ok: failed.length === 0,
  checks,
}

console.log(JSON.stringify(report, null, 2))
process.exit(report.ok ? 0 : 1)
