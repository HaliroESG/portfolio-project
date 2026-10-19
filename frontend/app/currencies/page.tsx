"use client"

import React from 'react'
import useSWR from 'swr'
import { AppShell } from '../../components/AppShell'
import { supabase } from '../../lib/supabase'
import { ArrowRightLeft } from 'lucide-react'
import { FX_PAIRS_SWR_KEY, fxPairState, loadFxPairs } from '../../lib/fxData'
import { latestSourceTimestamp } from '../../lib/readerState'
import { useFxRates } from '../../hooks/useFxRates'
import { FxRateDetails } from '../../components/FxRateDetails'

export default function CurrenciesPage() {
  const rates = useFxRates()
  const { data, isLoading, error } = useSWR(
    FX_PAIRS_SWR_KEY, () => loadFxPairs(supabase),
    { refreshInterval: 300000, revalidateOnFocus: false }
  )
  const currencyPairs = data ?? []
  const lastSyncIso = latestSourceTimestamp(rates.rows.map(row => row.last_update))
  const lastSync = lastSyncIso ? new Date(lastSyncIso).toLocaleTimeString('fr-FR') : ''

  return (
    <AppShell lastSync={lastSync} lastSyncIso={lastSyncIso} className="bg-slate-50">
        <main className="p-4 sm:p-6 lg:p-12">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
              <ArrowRightLeft className="text-[#00FF88]" />
              <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-950 dark:text-white">Currency Pairs</h1>
            </div>
            
            <section aria-label="Référence EUR commune" className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#0D1117]/50">
              <h2 className="font-bold">Référence EUR commune · {rates.state}</h2>
              <p className="my-2 text-sm text-slate-500">Mêmes taux que FX Intelligence et le panneau d’en-tête. La collecte ne prouve ni la date de cotation ni la comparabilité des séances.</p>
              {rates.loading && <p>Chargement des taux…</p>}
              {rates.error && <p role="alert" className="text-sm text-amber-700">Lecture des taux impossible. Les éventuelles valeurs conservées sont un cache.</p>}
              {!rates.loading && !rates.error && rates.rows.length === 0 && <p>Aucun taux disponible.</p>}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {rates.rows.map(rate => <div key={rate.id} data-fx-rate={rate.id} className="min-w-0 rounded-lg border border-slate-200 p-3 dark:border-white/10">
                  <div className="flex justify-between gap-2 font-mono text-sm font-bold"><span>{rate.id}/EUR</span><span data-fx-value>{rate.rate_to_eur === null ? 'N/A' : rate.rate_to_eur.toFixed(4)}</span></div>
                  <FxRateDetails rate={rate} cached={rates.usingCache} />
                  <p className="mt-2 text-xs text-slate-500">Variation : <span data-fx-change>{rate.change_pct === null ? 'N/A' : `${(rate.change_pct * 100).toFixed(2)}%`}</span></p>
                </div>)}
              </div>
            </section>
            {/* Separate source observations: never substitute these for the EUR reference. */}
            <p className="text-sm text-slate-500">Les paires Market Watch ci-dessous sont des observations distinctes, non rapprochées des taux de conversion. 1 unité de base = taux en devise de cotation. Les variations fournies ne sont pas certifiées : séances et méthode non renseignées.</p>
            {error && <p role="alert" className="text-sm text-amber-700">Lecture FX impossible. Les éventuelles valeurs précédentes sont conservées comme cache.</p>}
            <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden">
              <div className="p-6 border-b-2 border-slate-200 dark:border-white/5">
                <h2 className="text-sm font-black uppercase tracking-tighter text-slate-950 dark:text-white">
                  FX Pairs from Market Watch · source distincte
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-[#080A0F]">
                    <tr>
                      <th className="p-4 text-left text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                        Pair
                      </th>
                      <th className="p-4 text-left text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                        Ticker
                      </th>
                      <th className="p-4 text-right text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                        Rate
                      </th>
                      <th className="p-4 text-right text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                        Variation source (non vérifiée)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {isLoading ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-500 dark:text-gray-400">
                          Loading currency pairs...
                        </td>
                      </tr>
                    ) : currencyPairs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-500 dark:text-gray-400">
                          {error ? 'FX read failed — no verified pairs available' : 'No explicit currency pairs found'}
                        </td>
                      </tr>
                    ) : (
                      currencyPairs.map((pair) => {
                        const state = fxPairState(pair)
                        const change = !error && state === 'SOURCE_OK' ? pair.perf_day_local : null
                        const isPositive = change !== null && change >= 0
                        
                        return (
                          <tr 
                            key={pair.ticker}
                            className="hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors"
                          >
                            <td className="p-4">
                              <span className="text-sm font-black text-slate-950 dark:text-white">
                                {pair.name}
                              </span>
                              <div className="mt-1 text-[10px] text-slate-500">{error ? 'CACHED' : state} · Collecte : {pair.last_update ? new Date(pair.last_update).toLocaleString('fr-FR') : 'date inconnue'}</div>
                            </td>
                            <td className="p-4">
                              <span className="text-sm font-mono font-bold text-slate-500 dark:text-gray-400">
                                {pair.ticker}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <span className="text-sm font-mono font-black text-slate-950 dark:text-white">
                                {pair.last_price !== null
                                  ? pair.last_price.toFixed(4)
                                  : 'N/A'}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <span className="text-sm font-mono font-black text-slate-500">
                                  {change === null ? 'N/A' : `${isPositive ? '+' : ''}${(change * 100).toFixed(2)}%`}
                                </span>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
    </AppShell>
  )
}
