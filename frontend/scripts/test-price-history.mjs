import assert from 'node:assert/strict'

const priceHistory = await import('../lib/priceHistory.ts')
const regressionChart = await import('../lib/regressionChart.ts')

assert.equal(
  priceHistory.getPriceHistoryStartDate('YTD', new Date('2026-05-24T12:00:00Z')),
  '2026-01-01',
)
assert.equal(
  priceHistory.getPriceHistoryStartDate('5Y', new Date('2026-05-24T12:00:00Z')),
  '2021-05-24',
)
assert.equal(
  priceHistory.getPriceHistoryStartDate('10Y', new Date('2026-05-24T12:00:00Z')),
  '2016-05-24',
)
assert.equal(
  priceHistory.getPriceHistoryStartDate('MAX', new Date('2026-05-24T12:00:00Z')),
  '1999-01-01',
)

const parsed = priceHistory.parseAssetPriceHistoryRow({
  date: '2026-01-02',
  adj_close: '90.5',
  adj_close_local: '100.5',
  local_currency: 'USD',
  fx_rate_to_eur: '0.9004975124',
  source: 'yfinance',
  updated_at: '2026-01-03T00:00:00Z',
})
assert.equal(parsed.price_eur, 90.5)
assert.equal(parsed.price_local, 100.5)
assert.equal(parsed.local_currency, 'USD')
assert.equal(parsed.source, 'yfinance')

assert.equal(
  priceHistory.parseAssetPriceHistoryRow({
    date: '2026-01-02',
    adj_close: null,
    adj_close_local: null,
    local_currency: null,
    fx_rate_to_eur: null,
    source: null,
    updated_at: null,
  }),
  null,
)

const displayEur = priceHistory.buildDisplayPriceSeries(
  [
    { date: '2026-01-02', price_eur: 90, price_local: null, local_currency: null, fx_rate_to_eur: null, source: 'proxy:SPY', updated_at: null },
    { date: '2026-01-05', price_eur: 92, price_local: 102, local_currency: 'USD', fx_rate_to_eur: 0.9, source: 'yfinance', updated_at: null },
  ],
  'EUR',
)
const displayLocal = priceHistory.buildDisplayPriceSeries(
  [
    { date: '2026-01-02', price_eur: 90, price_local: null, local_currency: null, fx_rate_to_eur: null, source: 'proxy:SPY', updated_at: null },
    { date: '2026-01-05', price_eur: 92, price_local: 102, local_currency: 'USD', fx_rate_to_eur: 0.9, source: 'yfinance', updated_at: null },
  ],
  'LOCAL',
)
assert.equal(displayEur.length, 2)
assert.equal(displayLocal.length, 1)
assert.equal(displayLocal[0].price, 102)

function makeRows(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 1 + index))
    return {
      date: date.toISOString().slice(0, 10),
      adj_close: 100 + index,
      adj_close_local: null,
      local_currency: null,
      fx_rate_to_eur: null,
      source: 'yfinance',
      updated_at: null,
    }
  })
}

const batches = [makeRows(1000), makeRows(1)]
const ranges = []
const fakeSupabase = {
  from(table) {
    assert.equal(table, 'historical_prices')
    const query = {
      select(selector) {
        assert.equal(
          selector,
          'date,adj_close,adj_close_local,local_currency,fx_rate_to_eur,source,updated_at',
        )
        return query
      },
      eq(column, value) {
        assert.equal(column, 'ticker')
        assert.equal(value, 'ABC')
        return query
      },
      gte(column, value) {
        assert.equal(column, 'date')
        assert.match(value, /^\d{4}-\d{2}-\d{2}$/)
        return query
      },
      order(column, options) {
        assert.equal(column, 'date')
        assert.equal(options.ascending, true)
        return query
      },
      async range(from, to) {
        ranges.push([from, to])
        return { data: batches.shift() ?? [], error: null }
      },
    }
    return query
  },
}

const paged = await priceHistory.loadAssetPriceHistory(fakeSupabase, 'abc', 'YTD')
assert.equal(paged.ticker, 'ABC')
assert.equal(paged.points.length, 1001)
assert.deepEqual(ranges, [[0, 999], [1000, 1999]])

const maxBatches = [makeRows(1000), makeRows(1000), makeRows(10)]
const maxRanges = []
const fakeMaxSupabase = {
  from(table) {
    assert.equal(table, 'historical_prices')
    const query = {
      select() { return query },
      eq(column, value) {
        assert.equal(column, 'ticker')
        assert.equal(value, 'ABC')
        return query
      },
      gte(column, value) {
        assert.equal(column, 'date')
        assert.equal(value, '1999-01-01')
        return query
      },
      order(column, options) {
        assert.equal(column, 'date')
        assert.equal(options.ascending, true)
        return query
      },
      async range(from, to) {
        maxRanges.push([from, to])
        return { data: maxBatches.shift() ?? [], error: null }
      },
    }
    return query
  },
}

const maxPaged = await priceHistory.loadAssetPriceHistory(fakeMaxSupabase, 'abc', 'MAX')
assert.equal(maxPaged.points.length, 2010)
assert.deepEqual(maxRanges, [[0, 999], [1000, 1999], [2000, 2999]])

const regressionPoints = Array.from({ length: 260 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 0, 1 + index))
  return {
    date: date.toISOString().slice(0, 10),
    price: 100 * Math.exp(index * 0.001),
    source: 'yfinance',
    updated_at: null,
  }
})
const logModel = regressionChart.computeRegressionChartModel(regressionPoints, 'LOG')
assert.ok(logModel)
assert.equal(logModel.points.length, 260)
assert.ok(logModel.sigma < 1e-10)
assert.ok(logModel.points[199].ma200)
assert.equal(logModel.points[198].ma200, null)
assert.ok(logModel.annualizedSlopePct > 0)

const noisyPoints = regressionPoints.map((point, index) => ({
  ...point,
  price: index === regressionPoints.length - 1 ? point.price * 1.25 : point.price,
}))
const noisyModel = regressionChart.computeRegressionChartModel(noisyPoints, 'LINEAR')
assert.ok(noisyModel.latestZScore > 1)
assert.equal(
  regressionChart.computeRegressionChartModel(regressionPoints.slice(0, 20), 'LOG'),
  null,
)

console.log('frontend price-history tests: PASS')
