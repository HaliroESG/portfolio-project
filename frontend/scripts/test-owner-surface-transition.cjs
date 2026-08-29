/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const Module = require('node:module')
const assert = require('node:assert/strict')
const React = require('react')
const { act, create } = require('react-test-renderer')
const { SWRConfig } = require('swr')
const { transformSync } = require('next/dist/build/swc')

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'local-test-key'

Module._extensions['.ts'] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const transformed = transformSync(source, {
    filename,
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  })
  module._compile(transformed.code, filename)
}

const { useTargetsOwnerReader } = require('../lib/targetsOwnerReader.ts')
const { useArbitrageOwnerReader } = require('../lib/arbitrageOwnerReader.ts')
const { useGovernanceOwnerReader } = require('../lib/governanceOwnerReader.ts')
const { useDataHealthOwnerReader } = require('../lib/dataHealthOwnerReader.ts')
const { usePortfolioAggregationOwnerReader } = require('../lib/portfolioAggregationOwnerReader.ts')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

class MockAuth {
  ownerUserId = 'owner-a'
  listeners = new Set()

  getSession = async () => ({ data: { session: this.session() }, error: null })
  onAuthStateChange = (listener) => {
    this.listeners.add(listener)
    return { data: { subscription: { unsubscribe: () => this.listeners.delete(listener) } } }
  }
  session() {
    return { user: { id: this.ownerUserId } }
  }
  transition(ownerUserId) {
    this.ownerUserId = ownerUserId
    for (const listener of this.listeners) listener('SIGNED_IN', this.session())
  }
}

class MockQuery {
  constructor(client, table) {
    this.client = client
    this.table = table
    this.filters = new Map()
  }
  select() { return this }
  eq(column, value) { this.filters.set(column, value); return this }
  order() { return this }
  limit() { return this }
  maybeSingle() { this.single = true; return this }
  then(resolve, reject) { return this.client.resolve(this).then(resolve, reject) }
}

class MockSupabaseClient {
  constructor(heldTable) {
    this.auth = new MockAuth()
    this.heldTable = heldTable
    this.ownerTableCalls = new Map()
    this.held = null
  }
  from(table) { return new MockQuery(this, table) }
  ownerFor(query) {
    return query.filters.get('owner_user_id')
      ?? (String(query.filters.get('portfolio_id') ?? '').endsWith('-a') ? 'owner-a' : null)
      ?? (String(query.filters.get('portfolio_id') ?? '').endsWith('-b') ? 'owner-b' : null)
      ?? this.auth.ownerUserId
  }
  async resolve(query) {
    const owner = this.ownerFor(query)
    const counterKey = `${query.table}:${owner}`
    const count = (this.ownerTableCalls.get(counterKey) ?? 0) + 1
    this.ownerTableCalls.set(counterKey, count)
    if (query.table === this.heldTable && owner === 'owner-a' && count === 2) {
      return new Promise((resolve) => { this.held = () => resolve(this.response(query, owner)) })
    }
    return this.response(query, owner)
  }
  response(query, owner) {
    const suffix = owner === 'owner-a' ? 'a' : 'b'
    const rows = {
      portfolios: [{ id: `portfolio-${suffix}`, owner_user_id: owner, name: `Portfolio ${suffix.toUpperCase()}` }],
      portfolio_positions: [{
        owner_user_id: owner,
        portfolio_id: `portfolio-${suffix}`,
        ticker: `POSITION-${suffix.toUpperCase()}`,
        name: `Position ${suffix.toUpperCase()}`,
        instrument_type: 'STOCK',
        currency: 'EUR',
        quantity_buy: 1,
        quantity_current: 1,
        pru: 100,
        target_weight_pct: 100,
        geo_coverage: { FR: 100 },
      }],
      portfolio_decision_items_latest: [{
        portfolio_id: `portfolio-${suffix}`,
        ticker: `DECISION-${suffix.toUpperCase()}`,
        action: 'HOLD',
      }],
      governance_targets: [{
        id: `governance-${suffix}`,
        owner_user_id: owner,
        portfolio_id: `portfolio-${suffix}`,
        asset_class: `CLASS-${suffix.toUpperCase()}`,
        target_pct: 100,
        tolerance_band: 5,
      }],
      valuation_snapshots: [{
        owner_user_id: owner,
        coverage_pct: suffix === 'a' ? 81 : 92,
        created_at: '2026-08-29T00:00:00Z',
      }],
      market_watch: [{
        id: 'market-shared',
        ticker: `POSITION-${suffix.toUpperCase()}`,
        name: `Market ${suffix.toUpperCase()}`,
        last_price: 110,
        currency: 'EUR',
        data_status: 'OK',
        last_update: '2026-08-29T00:00:00Z',
      }],
      currencies: [{ id: 'EUR', symbol: '€', rate_to_eur: 1 }],
    }[query.table] ?? []
    return Promise.resolve({ data: query.single ? (rows[0] ?? null) : rows, error: null })
  }
  releaseHeldA() {
    assert.ok(this.held, `expected an owner A request to ${this.heldTable} to remain in flight`)
    const release = this.held
    this.held = null
    release()
  }
}

async function waitFor(renderer, pattern) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (pattern.test(JSON.stringify(renderer.toJSON()))) return
    await act(tick)
  }
  assert.match(JSON.stringify(renderer.toJSON()), pattern)
}

async function exerciseMountedProductionReader({ name, heldTable, Harness, aPattern, bPattern, setAFilter, defaultFilter }) {
  const client = new MockSupabaseClient(heldTable)
  const controls = { current: null }
  const cache = new Map()
  let renderer
  await act(async () => {
    renderer = create(React.createElement(
      SWRConfig,
      { value: { provider: () => cache, dedupingInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false } },
      React.createElement(Harness, { client, controls }),
    ))
  })
  await waitFor(renderer, aPattern)
  if (setAFilter) {
    await act(async () => setAFilter(controls.current))
    assert.match(JSON.stringify(renderer.toJSON()), /A-FILTER/)
  }

  let heldPromise
  await act(async () => { heldPromise = controls.current.revalidate() })
  assert.ok(client.held, `${name} must keep a real owner A Supabase loader in flight`)

  await act(async () => { client.auth.transition('owner-b') })
  const immediatelyAfterTransition = JSON.stringify(renderer.toJSON())
  assert.doesNotMatch(immediatelyAfterTransition, aPattern, `${name} retained an A row during the mounted transition`)
  assert.doesNotMatch(immediatelyAfterTransition, /A-FILTER|owner-a|ERROR-A/, `${name} retained A-private state`)
  if (defaultFilter) assert.match(immediatelyAfterTransition, defaultFilter)
  await waitFor(renderer, bPattern)

  await act(async () => {
    client.releaseHeldA()
    await heldPromise
  })
  const afterLateA = JSON.stringify(renderer.toJSON())
  assert.match(afterLateA, bPattern)
  assert.doesNotMatch(afterLateA, aPattern)
  assert.doesNotMatch(afterLateA, /A-FILTER|owner-a|ERROR-A/)

  await act(async () => renderer.unmount())
}

function TargetsHarness({ client, controls }) {
  const reader = useTargetsOwnerReader(client, client)
  controls.current = { revalidate: reader.mutatePositions, setFilter: reader.setSelectedScope }
  return React.createElement('div', null,
    React.createElement('span', null, reader.selectedScope),
    React.createElement('span', null, reader.positions?.map((row) => row.ticker).join(',')),
    React.createElement('span', null, String(reader.ownerError ?? reader.positionsError ?? '')),
  )
}

function ArbitrageHarness({ client, controls }) {
  const reader = useArbitrageOwnerReader(client, client)
  controls.current = { revalidate: reader.mutateDecisions, setFilter: reader.setActionFilter }
  return React.createElement('div', null,
    React.createElement('span', null, reader.actionFilter),
    React.createElement('span', null, reader.rawDecisionRows.map((row) => row.ticker).join(',')),
    React.createElement('span', null, String(reader.ownerError ?? reader.decisionError ?? '')),
  )
}

function GovernanceHarness({ client, controls }) {
  const reader = useGovernanceOwnerReader('ALL', client, client)
  controls.current = { revalidate: reader.mutateTargets }
  return React.createElement('div', null,
    React.createElement('span', null, reader.targets.map((row) => row.asset_class).join(',')),
    React.createElement('span', null, String(reader.ownerError ?? reader.targetsError ?? '')),
  )
}

function DataHealthHarness({ client, controls }) {
  const reader = useDataHealthOwnerReader(client, client)
  controls.current = { revalidate: reader.mutateValuationCoverage }
  return React.createElement('div', null,
    React.createElement('span', null, `COVERAGE-${reader.valuationCoveragePct ?? 'NONE'}`),
    React.createElement('span', null, String(reader.ownerError ?? reader.valuationError ?? '')),
  )
}

function GeoHarness({ client, controls }) {
  const reader = usePortfolioAggregationOwnerReader(client, client)
  controls.current = { revalidate: reader.mutateAggregation, setFilter: reader.setSelectedPortfolioId }
  const tickers = reader.portfolioBundle?.assetsByPortfolio.ALL.map((asset) => asset.ticker).join(',') ?? ''
  return React.createElement('div', null,
    React.createElement('span', null, reader.selectedPortfolioId),
    React.createElement('span', null, tickers),
    React.createElement('span', null, String(reader.ownerError ?? reader.bundleError ?? '')),
  )
}

async function main() {
await exerciseMountedProductionReader({
  name: 'Targets page reader', heldTable: 'portfolio_positions', Harness: TargetsHarness,
  aPattern: /POSITION-A/, bPattern: /POSITION-B/,
  setAFilter: (controls) => controls.setFilter('A-FILTER'), defaultFilter: /PERSO/,
})
await exerciseMountedProductionReader({
  name: 'Arbitrage page reader', heldTable: 'portfolio_decision_items_latest', Harness: ArbitrageHarness,
  aPattern: /DECISION-A/, bPattern: /DECISION-B/,
  setAFilter: (controls) => controls.setFilter('A-FILTER'), defaultFilter: /ALL/,
})
await exerciseMountedProductionReader({
  name: 'GovernanceWidget reader', heldTable: 'governance_targets', Harness: GovernanceHarness,
  aPattern: /CLASS-A/, bPattern: /CLASS-B/,
})
await exerciseMountedProductionReader({
  name: 'DataHealthPanel reader', heldTable: 'valuation_snapshots', Harness: DataHealthHarness,
  aPattern: /COVERAGE-81/, bPattern: /COVERAGE-92/,
})
await exerciseMountedProductionReader({
  name: 'Geo portfolioData reader', heldTable: 'portfolio_positions', Harness: GeoHarness,
  aPattern: /POSITION-A/, bPattern: /POSITION-B/,
  setAFilter: (controls) => controls.setFilter('A-FILTER'), defaultFilter: /ALL/,
})

console.log('mounted production readers A -> B with late A responses: Targets, Arbitrage, GovernanceWidget, DataHealthPanel, Geo/portfolioData: PASS')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
