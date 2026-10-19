/* eslint-disable react-hooks/immutability -- offline QA controls only */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SWRConfig, useSWRConfig } from 'swr'
import { MacroHealth } from '../../components/MacroHealth'
import { MacroStrip } from '../../components/MacroStrip'
import { MacroObservationDetails } from '../../components/MacroObservationDetails'
import { projectOfflineMacroTrace } from '../../lib/macroTrace'
import { MACRO_INDICATORS_SWR_KEY } from '../../lib/macroData'
import { macroStrategyState, macroTargetUsable } from '../../lib/macroState'
import payloads from 'macro-offline-payloads'

const query = new URLSearchParams(location.search)
const scenario = query.get('scenario') ?? 'legacy'
const timestamp = new Date(Date.now() - 1000).toISOString()
const template = ['^VIX', '^MOVE', 'DX-Y.NYB', '^TNX', 'SPREAD_10Y_2Y', 'MISERY_INDEX', 'JPY_VOLATILITY']
  .map((id, i) => ({ id, name: id, value: i === 0 ? 20 : 4, change_pct: .01,
    last_update: timestamp, threshold_amber: 15, threshold_red: 25, direction: 'UP', pillar: 'risk',
    trace: payloads[0], status: 'VALIDATED', observed_date: '2026-10-16' }))
const rows = scenario === 'empty' ? [] : template.map(row => ({ ...row,
  value: scenario === 'missing' ? null : row.value,
  last_update: scenario === 'stale' ? new Date(Date.now() - 10 * 86400000).toISOString()
    : scenario === 'undated' ? null : row.last_update,
}))
let mode = scenario === 'error' ? 'error' : scenario === 'loading' ? 'hold' : null
let pending
const middleware = next => (key, fetcher, config) => next(key, async key => {
  if (key !== MACRO_INDICATORS_SWR_KEY) throw new Error('Unexpected offline request')
  if (mode === 'error') throw new Error('Synthetic read failure')
  if (mode === 'hold') return new Promise(resolve => { pending = () => resolve(rows) })
  return rows
}, config)
function Controls() {
  const { mutate } = useSWRConfig()
  window.macroQa = {
    fail() { mode = 'error'; void mutate(MACRO_INDICATORS_SWR_KEY).catch(() => {}) },
    recover() { mode = null; if (pending) { pending(); pending = null } else void mutate(MACRO_INDICATORS_SWR_KEY).catch(() => {}) },
  }
  return null
}
function Fixture() {
  const view = projectOfflineMacroTrace(payloads[Number(query.get('case') ?? 0)])
  const regime = { id: 'fixture', regime: 'GOLDILOCKS', regime_state: 'READY', as_of_date: '2026-10-16', updated_at: timestamp }
  const target = { ...regime, snapshot_id: regime.id, data_state: 'READY', is_blocked: false, target_weight_pct: 10, effective_weight_pct: 10 }
  return <section className="mx-auto max-w-2xl rounded-xl border bg-white p-4">
    <h2>{view.id} — <span data-value>{view.value === null ? 'N/A' : view.value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</span></h2>
    <MacroObservationDetails view={view} />
    <p data-strategy>Régime : {macroStrategyState(regime, false, null)} · Cible applicable : {String(macroTargetUsable(regime, target))}</p>
  </section>
}
createRoot(document.getElementById('root')).render(
  <SWRConfig value={{ provider: () => new Map(), use: [middleware], shouldRetryOnError: false,
    revalidateOnFocus: false, revalidateOnReconnect: false }}>
    <Controls />
    <main className="min-h-screen bg-slate-50 p-4">
      <h1 className="mb-4 text-xl font-bold">Macro L2 · banc de test hors ligne</h1>
      {location.pathname === '/fixture' ? <Fixture /> : <><MacroStrip /><MacroHealth /></>}
    </main>
  </SWRConfig>,
)
