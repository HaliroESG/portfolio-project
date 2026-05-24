import assert from 'node:assert/strict'

const priceHistory = await import('../lib/priceHistory.ts')

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

console.log('frontend price-history tests: PASS')
