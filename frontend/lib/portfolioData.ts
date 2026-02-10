import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Asset,
  AssetType,
  CountryPerformance,
  CurrencyPair,
  DataStatus,
  GeoTimeframe,
  MarketRegion,
  PortfolioOption,
  TrendState,
} from '../types'

type JsonRecord = Record<string, unknown>

interface MarketWatchRow {
  id: string | null
  name: string | null
  ticker: string | null
  last_price: number | null
  currency: string | null
  type: string | null
  geo_coverage: Record<string, number> | null
  data_status: DataStatus | null
  last_update: string | null
  pe_ratio: number | null
  market_cap: number | null
  asset_class: string | null
  quantity: number | null
  quantity_buy: number | null
  pru: number | null
  target_weight_pct: number | null
  portfolio_id: string | null
  perf_day_eur: number | null
  perf_day_local: number | null
  perf_week_local: number | null
  perf_month_local: number | null
  perf_ytd_eur: number | null
  ma200_value: number | null
  ma200_status: 'above' | 'below' | null
  trend_slope: number | null
  volatility_30d: number | null
  rsi_14: number | null
  macd_line: number | null
  macd_signal: number | null
  macd_hist: number | null
  momentum_20: number | null
  trend_state: TrendState | null
  trend_changed: boolean | null
}

interface PortfolioRow {
  id: string
  name: string
}

interface PortfolioPositionRow {
  portfolio_id: string
  ticker: string
  name: string | null
  instrument_type: string | null
  currency: string | null
  quantity_buy: number | null
  quantity_current: number | null
  pru: number | null
  target_weight_pct: number | null
  geo_coverage: Record<string, number> | null
}

interface AggregationBundle {
  portfolioOptions: PortfolioOption[]
  assetsByPortfolio: Record<string, Asset[]>
  currencies: CurrencyPair[]
  lastSync: string
  lastSyncIso: string | null
}

interface CountryAccumulator {
  code: string
  name: string
  coordinates: [number, number]
  totalExposure: number
  weightedDay: number
  weightedMonth: number
  weightedYtd: number
  tickers: Set<string>
}

const DEFAULT_PORTFOLIO_ID = 'default'

const COUNTRY_COORDS: Record<string, [number, number]> = {
  US: [37, -95],
  FR: [46, 2],
  GB: [55, -3],
  DE: [51, 10],
  JP: [36, 138],
  CN: [35, 104],
  CH: [46, 8],
  CA: [56, -106],
  AU: [-25, 133],
  IT: [41, 12],
  ES: [40, -3],
  NL: [52, 5],
  SE: [60, 18],
  NO: [60, 8],
  DK: [56, 9],
  FI: [61, 25],
  IE: [53, -8],
  BE: [50, 4],
  BR: [-10, -55],
  IN: [21, 78],
  KR: [36, 128],
  TW: [23, 121],
  ZA: [-29, 24],
  MX: [23, -102],
  SA: [24, 45],
}

const TICKER_SUFFIX_TO_COUNTRY: Record<string, string> = {
  '.PA': 'FR',
  '.DE': 'DE',
  '.UK': 'GB',
  '.L': 'GB',
  '.JP': 'JP',
  '.T': 'JP',
  '.SW': 'CH',
  '.VX': 'CH',
  '.AS': 'NL',
  '.MI': 'IT',
  '.MC': 'ES',
  '.TO': 'CA',
  '.AX': 'AU',
  '.HK': 'CN',
  '.SS': 'CN',
  '.SZ': 'CN',
  '.KS': 'KR',
  '.TW': 'TW',
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  FR: 'France',
  GB: 'United Kingdom',
  DE: 'Germany',
  JP: 'Japan',
  CN: 'China',
  CH: 'Switzerland',
  CA: 'Canada',
  AU: 'Australia',
  IT: 'Italy',
  ES: 'Spain',
  NL: 'Netherlands',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  IE: 'Ireland',
  BE: 'Belgium',
  BR: 'Brazil',
  IN: 'India',
  KR: 'South Korea',
  TW: 'Taiwan',
  ZA: 'South Africa',
  MX: 'Mexico',
  SA: 'Saudi Arabia',
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const normalized = value.replace(',', '.')
    const parsed = Number.parseFloat(normalized)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  return null
}

function readGeoCoverage(value: unknown): Record<string, number> | null {
  if (!value) return null

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value.replace(/'/g, '"'))
      if (parsed && typeof parsed === 'object') {
        return readGeoCoverage(parsed)
      }
    } catch {
      return null
    }
    return null
  }

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const output: Record<string, number> = {}
    Object.entries(source).forEach(([country, weight]) => {
      const parsed = readNumber(weight)
      if (!parsed || parsed <= 0) return
      output[country.toUpperCase()] = parsed
    })
    return Object.keys(output).length > 0 ? output : null
  }

  return null
}

function normalizeCoveragePercentages(
  coverage: Record<string, number> | null,
  ticker: string
): Record<string, number> {
  const fallbackCountry = getCountryFromTicker(ticker)
  const raw = coverage ?? (fallbackCountry ? { [fallbackCountry]: 100 } : null)
  if (!raw) return {}

  const positiveEntries = Object.entries(raw).filter(([, value]) => value > 0)
  if (positiveEntries.length === 0) return {}

  const total = positiveEntries.reduce((sum, [, value]) => sum + value, 0)
  const asPercent = total <= 1.5

  const normalized: Record<string, number> = {}
  positiveEntries.forEach(([country, value]) => {
    const upperCountry = country.toUpperCase()
    const percentage = asPercent ? value * 100 : (value / total) * 100
    normalized[upperCountry] = percentage
  })

  return normalized
}

function normalizeAssetType(value: string | null): AssetType {
  if (!value) return 'Stock'
  const upper = value.toUpperCase()
  if (upper === 'ETF') return 'ETF'
  if (upper === 'CRYPTO') return 'CRYPTO'
  if (upper === 'CASH') return 'Cash'
  if (upper === 'FOREX') return 'Forex'
  if (upper === 'CURRENCY') return 'Currency'
  if (upper === 'STOCK') return 'Stock'
  return 'Stock'
}

function resolveTrendState(row: MarketWatchRow): TrendState {
  const hasIndicators =
    row.macd_line !== null &&
    row.macd_signal !== null &&
    row.rsi_14 !== null &&
    row.momentum_20 !== null

  if (!hasIndicators) return 'UNKNOWN'
  if (row.trend_state === 'BULLISH') return 'BULLISH'
  if (row.trend_state === 'BEARISH') return 'BEARISH'
  return 'NEUTRAL'
}

function toCurrencyRateMap(currencies: CurrencyPair[]): Map<string, number> {
  const map = new Map<string, number>()
  map.set('EUR', 1)
  currencies.forEach((currency) => {
    if (currency.rate_to_eur !== null && Number.isFinite(currency.rate_to_eur)) {
      map.set(currency.id.toUpperCase(), currency.rate_to_eur)
    }
  })
  return map
}

function getRateToEur(currency: string | null, rates: Map<string, number>): number {
  if (!currency) return 1
  const upper = currency.toUpperCase()
  return rates.get(upper) ?? 1
}

function parseMarketWatchRow(raw: JsonRecord): MarketWatchRow {
  const trendCandidate = readString(raw.trend_state)
  const trendState: TrendState | null =
    trendCandidate === 'BULLISH' || trendCandidate === 'BEARISH' || trendCandidate === 'NEUTRAL' || trendCandidate === 'UNKNOWN'
      ? trendCandidate
      : null

  const ma200StatusCandidate = readString(raw.ma200_status)
  const ma200Status = ma200StatusCandidate === 'above' || ma200StatusCandidate === 'below' ? ma200StatusCandidate : null

  const statusCandidate = readString(raw.data_status)
  const dataStatus: DataStatus | null =
    statusCandidate === 'OK' || statusCandidate === 'STALE' || statusCandidate === 'LOW_CONFIDENCE' || statusCandidate === 'PARTIAL'
      ? statusCandidate
      : null

  return {
    id: readString(raw.id),
    name: readString(raw.name),
    ticker: readString(raw.ticker),
    last_price: readNumber(raw.last_price),
    currency: readString(raw.currency),
    type: readString(raw.type),
    geo_coverage: readGeoCoverage(raw.geo_coverage),
    data_status: dataStatus,
    last_update: readString(raw.last_update),
    pe_ratio: readNumber(raw.pe_ratio),
    market_cap: readNumber(raw.market_cap),
    asset_class: readString(raw.asset_class),
    quantity: readNumber(raw.quantity),
    quantity_buy: readNumber(raw.quantity_buy),
    pru: readNumber(raw.pru),
    target_weight_pct: readNumber(raw.target_weight_pct),
    portfolio_id: readString(raw.portfolio_id),
    perf_day_eur: readNumber(raw.perf_day_eur),
    perf_day_local: readNumber(raw.perf_day_local),
    perf_week_local: readNumber(raw.perf_week_local),
    perf_month_local: readNumber(raw.perf_month_local),
    perf_ytd_eur: readNumber(raw.perf_ytd_eur),
    ma200_value: readNumber(raw.ma200_value),
    ma200_status: ma200Status,
    trend_slope: readNumber(raw.trend_slope),
    volatility_30d: readNumber(raw.volatility_30d),
    rsi_14: readNumber(raw.rsi_14),
    macd_line: readNumber(raw.macd_line),
    macd_signal: readNumber(raw.macd_signal),
    macd_hist: readNumber(raw.macd_hist),
    momentum_20: readNumber(raw.momentum_20),
    trend_state: trendState,
    trend_changed: readBoolean(raw.trend_changed),
  }
}

function parsePortfolioRow(raw: JsonRecord): PortfolioRow | null {
  const id = readString(raw.id)
  if (!id) return null
  const name = readString(raw.name) ?? `Portfolio ${id.slice(0, 6)}`
  return { id, name }
}

function parsePositionRow(raw: JsonRecord): PortfolioPositionRow | null {
  const ticker = readString(raw.ticker)?.toUpperCase()
  if (!ticker) return null

  const portfolioId = readString(raw.portfolio_id) ?? DEFAULT_PORTFOLIO_ID
  const quantityCurrent = readNumber(raw.quantity_current) ?? readNumber(raw.quantity)
  const quantityBuy = readNumber(raw.quantity_buy) ?? quantityCurrent
  const pru = readNumber(raw.pru) ?? readNumber(raw.average_cost) ?? readNumber(raw.avg_cost)
  const targetWeight = readNumber(raw.target_weight_pct) ?? readNumber(raw.target_pct) ?? readNumber(raw.target_weight)
  const coverage = readGeoCoverage(raw.geo_coverage)

  return {
    portfolio_id: portfolioId,
    ticker,
    name: readString(raw.name),
    instrument_type: readString(raw.instrument_type) ?? readString(raw.type),
    currency: readString(raw.currency),
    quantity_buy: quantityBuy,
    quantity_current: quantityCurrent,
    pru,
    target_weight_pct: targetWeight,
    geo_coverage: coverage,
  }
}

async function selectWithFallback(
  supabase: SupabaseClient,
  table: string,
  selectors: string[],
  orderBy?: { column: string; ascending?: boolean }
): Promise<JsonRecord[]> {
  let lastErrorMessage = ''

  for (const selector of selectors) {
    let query = supabase.from(table).select(selector)
    if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true })
    }
    const { data, error } = await query
    if (!error) {
      return ((data ?? []) as unknown as JsonRecord[])
    }
    lastErrorMessage = error.message
  }

  if (lastErrorMessage) {
    console.warn(`[portfolioData] table "${table}" unavailable: ${lastErrorMessage}`)
  }
  return []
}

async function fetchMarketWatchRows(supabase: SupabaseClient): Promise<MarketWatchRow[]> {
  const rows = await selectWithFallback(
    supabase,
    'market_watch',
    [
      'id,name,ticker,last_price,currency,type,geo_coverage,data_status,last_update,pe_ratio,market_cap,asset_class,quantity,quantity_buy,pru,target_weight_pct,portfolio_id,perf_day_eur,perf_day_local,perf_week_local,perf_month_local,perf_ytd_eur,ma200_value,ma200_status,trend_slope,volatility_30d,rsi_14,macd_line,macd_signal,macd_hist,momentum_20,trend_state,trend_changed',
      'id,name,ticker,last_price,currency,type,geo_coverage,data_status,last_update,pe_ratio,market_cap,asset_class,quantity,perf_day_eur,perf_day_local,perf_week_local,perf_month_local,perf_ytd_eur,ma200_value,ma200_status,trend_slope,volatility_30d,rsi_14,macd_line,macd_signal,macd_hist,momentum_20,trend_state,trend_changed',
      'id,name,ticker,last_price,currency,type,geo_coverage,data_status,last_update,pe_ratio,market_cap,asset_class,quantity,perf_day_eur,perf_day_local,perf_week_local,perf_month_local,perf_ytd_eur',
    ]
  )
  return rows.map(parseMarketWatchRow)
}

async function fetchCurrencyRows(supabase: SupabaseClient): Promise<CurrencyPair[]> {
  const rows = await selectWithFallback(
    supabase,
    'currencies',
    ['id,symbol,rate_to_eur,last_update', 'id,symbol,rate_to_eur'],
    { column: 'id', ascending: true }
  )

  return rows
    .map((row) => {
      const id = readString(row.id)
      if (!id) return null
      return {
        id,
        symbol: readString(row.symbol) ?? id,
        rate_to_eur: readNumber(row.rate_to_eur),
      } as CurrencyPair
    })
    .filter((currency): currency is CurrencyPair => currency !== null)
}

async function fetchPortfolios(supabase: SupabaseClient): Promise<PortfolioRow[]> {
  const rows = await selectWithFallback(supabase, 'portfolios', ['id,name', 'id'])
  return rows
    .map(parsePortfolioRow)
    .filter((portfolio): portfolio is PortfolioRow => portfolio !== null)
}

async function fetchPositions(supabase: SupabaseClient): Promise<PortfolioPositionRow[]> {
  const rows = await selectWithFallback(
    supabase,
    'portfolio_positions',
    [
      'portfolio_id,ticker,name,instrument_type,currency,quantity_buy,quantity_current,pru,target_weight_pct,geo_coverage',
      'portfolio_id,ticker,name,type,currency,quantity_buy,quantity,pru,target_pct,geo_coverage',
      'portfolio_id,ticker,name,currency,quantity,geo_coverage',
    ]
  )

  return rows
    .map(parsePositionRow)
    .filter((position): position is PortfolioPositionRow => position !== null)
}

function buildFallbackPositions(marketRows: MarketWatchRow[]): PortfolioPositionRow[] {
  return marketRows
    .filter((row) => !!row.ticker)
    .map((row) => {
      const ticker = (row.ticker ?? '').toUpperCase()
      const quantityCurrent = row.quantity ?? 1
      return {
        portfolio_id: row.portfolio_id ?? DEFAULT_PORTFOLIO_ID,
        ticker,
        name: row.name,
        instrument_type: row.type,
        currency: row.currency,
        quantity_buy: row.quantity_buy ?? quantityCurrent,
        quantity_current: quantityCurrent,
        pru: row.pru,
        target_weight_pct: row.target_weight_pct,
        geo_coverage: row.geo_coverage,
      }
    })
}

function calculateLastSync(rows: MarketWatchRow[]): { display: string; iso: string | null } {
  const updates = rows
    .map((row) => row.last_update)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  if (updates.length === 0) {
    return { display: '--:--:--', iso: null }
  }

  const latest = updates.reduce((max, current) => (new Date(current) > new Date(max) ? current : max))
  return {
    display: new Date(latest).toLocaleTimeString('fr-FR'),
    iso: latest,
  }
}

function aggregateByTicker(
  positions: PortfolioPositionRow[],
  marketByTicker: Map<string, MarketWatchRow>,
  portfolioNameById: Map<string, string>,
  rates: Map<string, number>
): Asset[] {
  const grouped = new Map<string, PortfolioPositionRow[]>()
  positions.forEach((position) => {
    const key = position.ticker.toUpperCase()
    const current = grouped.get(key) ?? []
    current.push(position)
    grouped.set(key, current)
  })

  const assets: Asset[] = []

  grouped.forEach((tickerPositions, ticker) => {
    const market = marketByTicker.get(ticker) ?? null
    const portfolioIds = Array.from(new Set(tickerPositions.map((position) => position.portfolio_id)))
    const portfolioNames = portfolioIds.map((id) => portfolioNameById.get(id) ?? id)

    let totalQuantityCurrent = 0
    let totalQuantityBuy = 0
    let weightedPruNumerator = 0
    let marketValueEur = 0
    let investedValueEur = 0
    let investedSamples = 0
    let targetWeightedNumerator = 0
    let targetWeightedDenominator = 0
    const geoExposureByCountry: Record<string, number> = {}

    tickerPositions.forEach((position) => {
      const quantityCurrent = position.quantity_current ?? position.quantity_buy ?? 0
      const quantityBuy = position.quantity_buy ?? position.quantity_current ?? 0
      const price = market?.last_price ?? 0
      const currency = position.currency ?? market?.currency ?? 'EUR'
      const fxRate = getRateToEur(currency, rates)
      const valueEur = quantityCurrent * price * fxRate

      totalQuantityCurrent += quantityCurrent
      totalQuantityBuy += quantityBuy
      marketValueEur += valueEur

      if (position.pru !== null && quantityBuy > 0) {
        weightedPruNumerator += position.pru * quantityBuy
        investedValueEur += position.pru * quantityBuy * fxRate
        investedSamples += 1
      }

      if (position.target_weight_pct !== null) {
        const weightingValue = valueEur > 0 ? valueEur : Math.max(quantityCurrent, 1)
        targetWeightedNumerator += position.target_weight_pct * weightingValue
        targetWeightedDenominator += weightingValue
      }

      const coverage = normalizeCoveragePercentages(position.geo_coverage, ticker)
      Object.entries(coverage).forEach(([country, weight]) => {
        const countryExposure = valueEur * (weight / 100)
        geoExposureByCountry[country] = (geoExposureByCountry[country] ?? 0) + countryExposure
      })
    })

    const geoExposureTotal = Object.values(geoExposureByCountry).reduce((sum, value) => sum + value, 0)
    const constituents: Record<string, number> = {}
    if (geoExposureTotal > 0) {
      Object.entries(geoExposureByCountry).forEach(([country, value]) => {
        constituents[country] = (value / geoExposureTotal) * 100
      })
    } else {
      const fallbackCoverage = normalizeCoveragePercentages(market?.geo_coverage ?? null, ticker)
      Object.assign(constituents, fallbackCoverage)
    }

    const avgCost = totalQuantityBuy > 0 ? weightedPruNumerator / totalQuantityBuy : null
    const targetWeight = targetWeightedDenominator > 0 ? targetWeightedNumerator / targetWeightedDenominator : null
    const investedValue = investedSamples > 0 ? investedValueEur : null
    const pnlEur = investedValue !== null ? marketValueEur - investedValue : null
    const pnlPct = investedValue !== null && investedValue > 0 ? (marketValueEur / investedValue - 1) * 100 : null

    const trendState = market ? resolveTrendState(market) : 'UNKNOWN'

    assets.push({
      id: market?.id ?? ticker,
      name: market?.name ?? tickerPositions[0]?.name ?? ticker,
      ticker,
      price: market?.last_price ?? 0,
      currency: market?.currency ?? tickerPositions[0]?.currency ?? 'EUR',
      type: normalizeAssetType(market?.type ?? tickerPositions[0]?.instrument_type ?? null),
      constituents,
      data_status: market?.data_status ?? undefined,
      last_update: market?.last_update ?? undefined,
      pe_ratio: market?.pe_ratio ?? null,
      market_cap: market?.market_cap ?? null,
      asset_class: market?.asset_class ?? null,
      quantity: totalQuantityCurrent,
      quantity_buy: totalQuantityBuy || null,
      quantity_current: totalQuantityCurrent,
      pru: avgCost,
      target_weight_pct: targetWeight,
      market_value_eur: marketValueEur,
      invested_value_eur: investedValue,
      pnl_eur: pnlEur,
      pnl_pct: pnlPct,
      portfolio_ids: portfolioIds,
      portfolio_names: portfolioNames,
      technical: {
        ma200_value: market?.ma200_value ?? null,
        ma200_status: market?.ma200_status ?? null,
        trend_slope: market?.trend_slope ?? null,
        volatility_30d: market?.volatility_30d ?? null,
        rsi_14: market?.rsi_14 ?? null,
        macd_line: market?.macd_line ?? null,
        macd_signal: market?.macd_signal ?? null,
        macd_hist: market?.macd_hist ?? null,
        momentum_20: market?.momentum_20 ?? null,
        trend_state: trendState,
        trend_changed: trendState === 'UNKNOWN' ? false : market?.trend_changed ?? false,
      },
      performance: {
        day: {
          value: (market?.perf_day_eur ?? 0) * 100,
          currencyImpact: ((market?.perf_day_eur ?? 0) - (market?.perf_day_local ?? 0)) * 100,
        },
        week: {
          value: (market?.perf_week_local ?? 0) * 100,
          currencyImpact: 0,
        },
        month: {
          value: (market?.perf_month_local ?? 0) * 100,
          currencyImpact: 0,
        },
        ytd: {
          value: (market?.perf_ytd_eur ?? 0) * 100,
          currencyImpact: 0,
        },
      },
    })
  })

  return assets.sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }))
}

export function buildGeographicPerformance(
  assets: Asset[],
  timeframe: GeoTimeframe
): { regions: MarketRegion[]; countries: CountryPerformance[] } {
  const countryMap = new Map<string, CountryAccumulator>()

  assets.forEach((asset) => {
    const exposure = asset.market_value_eur ?? ((asset.quantity_current ?? asset.quantity ?? 0) * asset.price)
    if (!exposure || exposure <= 0) return

    const normalizedCoverage = normalizeCoveragePercentages(asset.constituents ?? null, asset.ticker)
    const coverageEntries = Object.entries(normalizedCoverage)
    if (coverageEntries.length === 0) return

    coverageEntries.forEach(([countryCode, weightPct]) => {
      const code = countryCode.toUpperCase()
      const countryExposure = exposure * (weightPct / 100)
      const dayPerf = asset.performance.day.value
      const monthPerf = asset.performance.month.value
      const ytdPerf = asset.performance.ytd.value

      const entry = countryMap.get(code) ?? {
        code,
        name: COUNTRY_NAMES[code] ?? code,
        coordinates: COUNTRY_COORDS[code] ?? [0, 0],
        totalExposure: 0,
        weightedDay: 0,
        weightedMonth: 0,
        weightedYtd: 0,
        tickers: new Set<string>(),
      }

      entry.totalExposure += countryExposure
      entry.weightedDay += dayPerf * countryExposure
      entry.weightedMonth += monthPerf * countryExposure
      entry.weightedYtd += ytdPerf * countryExposure
      entry.tickers.add(asset.ticker)

      countryMap.set(code, entry)
    })
  })

  const totalExposure = Array.from(countryMap.values()).reduce((sum, entry) => sum + entry.totalExposure, 0)

  const countries: CountryPerformance[] = Array.from(countryMap.values())
    .map((entry) => {
      const exposure = entry.totalExposure
      const performanceDay = exposure > 0 ? entry.weightedDay / exposure : 0
      const performanceMonth = exposure > 0 ? entry.weightedMonth / exposure : 0
      const performanceYtd = exposure > 0 ? entry.weightedYtd / exposure : 0
      const avgPerformance =
        timeframe === 'day' ? performanceDay : timeframe === 'month' ? performanceMonth : performanceYtd

      return {
        code: entry.code,
        name: entry.name,
        avgPerformance,
        performanceDay,
        performanceMonth,
        performanceYtd,
        assetCount: entry.tickers.size,
        totalExposure: exposure,
        exposurePct: totalExposure > 0 ? (exposure / totalExposure) * 100 : 0,
        coordinates: entry.coordinates,
      }
    })
    .sort((left, right) => right.totalExposure - left.totalExposure)

  const regions: MarketRegion[] = countries.map((country, index) => ({
    id: `region-${country.code}-${index}`,
    code: country.code,
    name: country.name,
    value: country.exposurePct,
    performance: country.avgPerformance,
    exposure: country.exposurePct,
    coordinates: country.coordinates,
  }))

  return { regions, countries }
}

export function getCountryFromTicker(ticker: string): string | null {
  if (!ticker) return null
  const upperTicker = ticker.toUpperCase()

  for (const [suffix, countryCode] of Object.entries(TICKER_SUFFIX_TO_COUNTRY)) {
    if (upperTicker.endsWith(suffix)) {
      return countryCode
    }
  }

  if (upperTicker.startsWith('^') || upperTicker.includes('=')) return null

  if (/^[A-Z]{1,5}$/.test(upperTicker)) return 'US'

  return null
}

export function getFreshnessStatus(lastUpdateIso: string | null, staleAfterMinutes: number): 'FRESH' | 'STALE' | 'UNKNOWN' {
  if (!lastUpdateIso) return 'UNKNOWN'
  const diffMs = Date.now() - new Date(lastUpdateIso).getTime()
  if (Number.isNaN(diffMs)) return 'UNKNOWN'
  const diffMinutes = diffMs / (1000 * 60)
  return diffMinutes <= staleAfterMinutes ? 'FRESH' : 'STALE'
}

export async function loadPortfolioAggregation(supabase: SupabaseClient): Promise<AggregationBundle> {
  const [marketRows, currencies, portfolios, persistedPositions] = await Promise.all([
    fetchMarketWatchRows(supabase),
    fetchCurrencyRows(supabase),
    fetchPortfolios(supabase),
    fetchPositions(supabase),
  ])

  const positions = persistedPositions.length > 0 ? persistedPositions : buildFallbackPositions(marketRows)

  const portfolioNameById = new Map<string, string>()
  portfolios.forEach((portfolio) => {
    portfolioNameById.set(portfolio.id, portfolio.name)
  })

  const positionPortfolioIds = Array.from(new Set(positions.map((position) => position.portfolio_id)))
  if (positionPortfolioIds.length === 0) {
    positionPortfolioIds.push(DEFAULT_PORTFOLIO_ID)
  }

  if (positionPortfolioIds.length === 1 && positionPortfolioIds[0] === DEFAULT_PORTFOLIO_ID) {
    portfolioNameById.set(DEFAULT_PORTFOLIO_ID, 'Main Portfolio')
  }

  positionPortfolioIds.forEach((portfolioId) => {
    if (!portfolioNameById.has(portfolioId)) {
      portfolioNameById.set(
        portfolioId,
        portfolioId === DEFAULT_PORTFOLIO_ID ? 'Main Portfolio' : `Portfolio ${portfolioId.slice(0, 6)}`
      )
    }
  })

  const portfolioOptions: PortfolioOption[] = positionPortfolioIds
    .map((portfolioId) => ({
      id: portfolioId,
      name: portfolioNameById.get(portfolioId) ?? portfolioId,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }))

  const rates = toCurrencyRateMap(currencies)
  const marketByTicker = new Map<string, MarketWatchRow>()
  marketRows.forEach((row) => {
    const ticker = row.ticker?.toUpperCase()
    if (ticker) {
      marketByTicker.set(ticker, row)
    }
  })

  const assetsByPortfolio: Record<string, Asset[]> = {}
  assetsByPortfolio.ALL = aggregateByTicker(positions, marketByTicker, portfolioNameById, rates)
  portfolioOptions.forEach((portfolio) => {
    const filteredPositions = positions.filter((position) => position.portfolio_id === portfolio.id)
    assetsByPortfolio[portfolio.id] = aggregateByTicker(filteredPositions, marketByTicker, portfolioNameById, rates)
  })

  const lastSync = calculateLastSync(marketRows)

  return {
    portfolioOptions,
    assetsByPortfolio,
    currencies,
    lastSync: lastSync.display,
    lastSyncIso: lastSync.iso,
  }
}
