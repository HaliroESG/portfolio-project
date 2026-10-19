import { createReadClient, equityRow, researchTables, tridentRow } from './research-fixtures.mjs'
// Scenario in the hash survives the real application's canonical query string.
const scenario = new URLSearchParams(location.hash.slice(1)).get('scenario') ?? 'ready'
const tables = researchTables(scenario)
if (scenario === 'partial') tables.trident_screener_latest = tables.trident_screener_latest.filter(row => row.instrument_key !== 'fixture:ASTER:B')
if (scenario === 'trident-partial') tables.equity_screener_latest = tables.equity_screener_latest.filter(row => row.instrument_key !== 'fixture:ASTER:B')
if (scenario === 'price-missing') tables.historical_prices = tables.historical_prices.filter(row => row.ticker !== 'ASTER.IT')
if (scenario.startsWith('symbol-claim-')) {
  const [, , side, mode] = scenario.split('-')
  const qb = equityRow({ instrument_key: 'fixture:ASTER:B', ticker: 'ASTER.B', provider_symbol: 'ASTER.B', currency: 'USD', exchange: 'New York' })
  tables.equity_screener_latest = [equityRow(), qb]
  tables.trident_screener_latest = [tridentRow(), tridentRow(qb)]
  const source = side === 'equity' ? 'equity_screener_latest' : 'trident_screener_latest'
  const claim = { ...tables[source][1], provider_symbol: 'ASTER.IT' }
  if (mode === 'duplicate') tables[source].push(claim)
  else tables[source][1] = claim
  // The disputed source exists and would yield the wrong class/currency if read.
  tables.historical_prices = tables.historical_prices.filter(row => row.ticker === 'ASTER').map(row => ({ ...row, ticker: 'ASTER.IT', source: 'fixture-class-B' }))
}
const failure = request => scenario === 'error' && request.table.endsWith('screener_latest')
  || scenario === 'partial' && request.table === 'equity_screener_latest'
  || scenario === 'trident-partial' && request.table === 'trident_screener_latest'
  || scenario === 'criteria-error' && request.table === 'trident_criterion_results' && !request.head
  || scenario === 'publications-error' && request.table === 'equity_reporting_calendar'
const client = createReadClient(tables, failure)
const listeners = new Set()
let owner = scenario === 'signed-out' ? null : 'offline-owner-a'
let unsubscribed = 0, authCalls = 0, authError = scenario === 'auth-error', authPending = scenario === 'auth-pending'
const pendingAuth = []
const emitSession = (event, next) => { for (const callback of listeners) callback(event, next ? { user: { id: next } } : null) }
const authResult = (verifiedOwner, error) => ({ data: { user: verifiedOwner ? { id: verifiedOwner } : null }, error: error ? new Error('Synthetic auth error') : null })
window.researchQa = { scenario, reads: client.reads, mutations: client.mutations,
  setSession(next) { owner = next; emitSession(next ? 'SIGNED_IN' : 'SIGNED_OUT', next) },
  emitSession,
  configureAuth({ verifiedOwner = owner, error = authError, pending = authPending }) { owner = verifiedOwner; authError = error; authPending = pending },
  settleNextAuth(verifiedOwner, error = false) { const resolve = pendingAuth.shift(); if (!resolve) throw new Error('No pending verification'); resolve(authResult(verifiedOwner, error)) },
  stats: () => ({ listeners: listeners.size, unsubscribed, authCalls, pendingAuth: pendingAuth.length }),
}
const auth = {
  getUser: () => { authCalls++; return authPending ? new Promise(resolve => pendingAuth.push(resolve)) : Promise.resolve(authResult(owner, authError)) },
  onAuthStateChange(callback) {
    listeners.add(callback)
    queueMicrotask(() => { if (listeners.has(callback)) callback('INITIAL_SESSION', owner ? { user: { id: owner } } : null) })
    return { data: { subscription: { unsubscribe() { unsubscribed++; listeners.delete(callback) } } } }
  },
  signOut: async () => { window.researchQa.setSession(null); return { error: null } },
}
export const supabase = { from: (...args) => client.from(...args), auth }
