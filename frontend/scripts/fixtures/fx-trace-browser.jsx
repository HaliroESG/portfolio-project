/* eslint-disable react-hooks/immutability -- isolated offline QA controls */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SWRConfig, useSWRConfig } from 'swr'
import FXPage from '../../app/fx/page'
import CurrenciesPage from '../../app/currencies/page'
import { FxRateDetails } from '../../components/FxRateDetails'
import { projectOfflineFxTrace } from '../../lib/fxTrace'
import { FX_RATES_SWR_KEY, FX_PAIRS_SWR_KEY, FX_CACHE_KEY } from '../../lib/fxData'
import payloads from 'fx-offline-payloads'

// Only bundled by test-fx-trace-browser.mjs. No application imports this fixture.
const query = new URLSearchParams(location.search)
const scenario = query.get('scenario') ?? 'legacy'
const collected = new Date(Date.now() - 1000).toISOString()
const baseRows = [
  { id: 'USD', symbol: '$', rate_to_eur: .99, last_update: collected },
  { id: 'CHF', symbol: 'CHF', rate_to_eur: 1.05, last_update: collected },
  { id: 'GBP', symbol: '£', rate_to_eur: 1.17, last_update: collected },
  { id: 'JPY', symbol: '¥', rate_to_eur: .0061, last_update: collected },
]
const rows = scenario === 'empty' ? [] : baseRows.map(row => ({ ...row,
  last_update: scenario === 'undated' ? null : scenario === 'stale' ? new Date(Date.now() - 5 * 86400000).toISOString() : row.last_update,
  rate_to_eur: scenario === 'missing' ? null : row.rate_to_eur,
}))
let mode = ['error', 'cache'].includes(scenario) ? 'error' : scenario === 'loading' ? 'hold' : null
let pending
const counts = {}
if (query.has('clear')) localStorage.clear()
if (scenario === 'cache') localStorage.setItem(FX_CACHE_KEY, JSON.stringify(baseRows.map(row => ({
  ...row, status: 'VALIDATED', observed_date: '2026-10-16', provider: 'forged', change_pct: .1,
}))))
const middleware = next => (key, fetcher, config) => next(key, async key => {
  counts[key] = (counts[key] ?? 0) + 1
  if (key === FX_CACHE_KEY) return fetcher(key) // Real legacy-cache parser.
  if (key === FX_PAIRS_SWR_KEY) return [{ ticker: 'EURUSD=X', base: 'EUR', quote: 'USD', name: 'EUR / USD', last_price: 1.1, perf_day_local: .1, last_update: collected, data_status: 'OK' }]
  if (key !== FX_RATES_SWR_KEY) throw new Error('Unexpected fixture query')
  if (mode === 'error') throw new Error('Synthetic FX read error')
  if (mode === 'hold') return new Promise(resolve => { pending = () => resolve(rows) })
  return rows
}, config)
function Controls() {
  const { mutate } = useSWRConfig()
  window.fxQa = {
    counts: () => counts,
    fail() { mode = 'error'; void mutate(FX_RATES_SWR_KEY).catch(() => {}) },
    recover() { mode = null; if (pending) { pending(); pending = null } else void mutate(FX_RATES_SWR_KEY).catch(() => {}) },
  }
  return null
}
function FixtureDetail() {
  const index = Number(query.get('case') ?? 0)
  const row = projectOfflineFxTrace(payloads[index])
  return <main className="mx-auto max-w-2xl p-6"><h1 className="text-xl font-bold">FX · preuve synthétique hors ligne</h1>
    <section data-fx-rate={row.id} className="mt-4 rounded-xl border p-4">
      <div className="flex justify-between"><span>{row.id}/EUR</span><span data-fx-value>{row.rate_to_eur === null ? 'N/A' : row.rate_to_eur.toFixed(4)}</span></div>
      <FxRateDetails rate={row} />
      <p className="mt-3">Variation : <span data-fx-change>{row.change_pct === null ? 'N/A' : `${(row.change_pct * 100).toFixed(2)}%`}</span></p>
    </section></main>
}
const Page = location.pathname === '/fixture' ? FixtureDetail : location.pathname === '/currencies' ? CurrenciesPage : FXPage
createRoot(document.getElementById('root')).render(
  <SWRConfig value={{ provider: () => new Map(), use: [middleware], shouldRetryOnError: false,
    revalidateOnFocus: false, revalidateOnReconnect: false }}><Controls /><Page /></SWRConfig>,
)
