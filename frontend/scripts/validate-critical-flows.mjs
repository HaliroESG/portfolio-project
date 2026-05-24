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
  addCheck(
    'frontend.asset_drawer.resizable_width',
    hasAll(assetDrawer, [
      "import { ASSET_DRAWER_WIDTH } from '../lib/panelWidth'",
      'usePersistedPanelWidth(ASSET_DRAWER_WIDTH)',
      'Resize asset detail drawer separator',
      'handleDrawerResizePointerDown',
      'style={{ width: `min(100vw, ${drawerWidth}px)` }}',
    ]) && !assetDrawer.includes('type="range"'),
    'Asset drawer should expose persisted separator-handle resizing and stay mobile-bounded without a range gauge.'
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
  addCheck(
    'frontend.asset_price_chart_fullscreen',
    hasAll(assetPriceChart, [
      "import { FullscreenChartButton } from './FullscreenChart'",
      '<FullscreenChartButton title={`${ticker} Price History`}>',
      "renderChartSvg('h-auto', 'fullscreen')",
    ]),
    'Asset price chart should expose a fullscreen chart view.'
  )

  const tridentPage = read('frontend/app/trident/page.tsx')
  const tridentRegressionChart = read('frontend/components/TridentRegressionChart.tsx')
  const regressionChart = read('frontend/lib/regressionChart.ts')
  const fullscreenChart = read('frontend/components/FullscreenChart.tsx')
  const panelWidth = read('frontend/lib/panelWidth.ts')
  addCheck(
    'frontend.trident_regression_chart_present',
    hasAll(tridentPage, [
      "import { TridentRegressionChart } from '../../components/TridentRegressionChart'",
      '<TridentRegressionChart',
      'ticker={selectedRow.ticker}',
      'instrumentKey={selectedRow.instrument_key}',
      'assetCurrency={selectedRow.currency}',
    ]),
    'Trident selected-row panel should render the regression price chart.'
  )
  addCheck(
    'frontend.trident_detail_resizable_width',
    hasAll(tridentPage, [
      "import { TRIDENT_DETAIL_WIDTH } from '../../lib/panelWidth'",
      'usePersistedPanelWidth(TRIDENT_DETAIL_WIDTH)',
      'Resize Trident detail separator',
      'handleDetailResizePointerDown',
      '--trident-detail-width',
    ]) && !tridentPage.includes('type="range"') && hasAll(panelWidth, [
      'TRIDENT_DETAIL_WIDTH',
      'ASSET_DRAWER_WIDTH',
      'clampPanelWidth',
      'readStoredPanelWidth',
      'writeStoredPanelWidth',
    ]),
    'Trident detail panel should expose persisted separator-handle resizing without a range gauge.'
  )
  addCheck(
    'frontend.trident_regression_chart_controls_and_calculations',
    hasAll(tridentRegressionChart, [
      "const HORIZONS: PriceHistoryHorizon[] = ['5Y', '10Y', 'MAX']",
      "const SCALES: { key: RegressionScaleMode; label: string }[]",
      'Local unavailable',
      'Short history',
      'Insufficient history',
      'price history not backfilled or unavailable',
      'computeRegressionChartModel(displayPoints, scaleMode)',
    ]) && hasAll(regressionChart, [
      'computeRegressionChartModel',
      'computeMovingAverage',
      'latestZScore',
      'annualizedSlopePct',
    ]),
    'Trident regression chart should expose horizon/currency/scale controls and compute regression bands/MM200.'
  )
  addCheck(
    'frontend.chart_fullscreen_controls',
    hasAll(fullscreenChart, [
      'Maximize2',
      'aria-label={`Open ${title} fullscreen`}',
      "event.key === 'Escape'",
      'role="dialog"',
    ]) && hasAll(tridentRegressionChart, [
      "import { FullscreenChartButton } from './FullscreenChart'",
      '<FullscreenChartButton title={`${ticker} Regression`} className="h-7 w-7">',
      'buildRegressionRenderChart(model, scaleMode, showMa200',
      "renderRegressionSvg(charts.fullscreen, 'h-auto', 'fullscreen', 'fullscreen')",
    ]),
    'Fullscreen chart overlay should be shared and wired into Trident regression with dedicated fullscreen geometry.'
  )

  const backtestChart = read('frontend/components/BacktestChart.tsx')
  const drawdownChart = read('frontend/components/DrawdownChart.tsx')
  const geographicMap = read('frontend/components/GeographicMap.tsx')
  addCheck(
    'frontend.general_charts_fullscreen',
    hasAll(backtestChart, [
      "import { FullscreenChartButton } from './FullscreenChart'",
      '<FullscreenChartButton title={title}>',
      "renderChartSvg('h-auto')",
    ]) && hasAll(drawdownChart, [
      "import { FullscreenChartButton } from './FullscreenChart'",
      '<FullscreenChartButton title={title}>',
      "renderChartSvg('h-auto')",
    ]) && hasAll(geographicMap, [
      "import { FullscreenChartButton } from './FullscreenChart'",
      '<FullscreenChartButton title="Geographic View">',
      "renderMapSurface('h-[78vh] min-h-[520px]')",
    ]),
    'General charts should expose the shared fullscreen control.'
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
