"use client"

import React from 'react'
import useSWR from 'swr'
import { AppShell } from '../../components/AppShell'
import { supabase } from '../../lib/supabase'
import { ArrowRightLeft, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '../../lib/utils'
import { FX_PAIRS_SWR_KEY, fxPairState, loadFxPairs } from '../../lib/fxData'
import { latestSourceTimestamp } from '../../lib/readerState'

export default function CurrenciesPage() {
  const { data, isLoading, error } = useSWR(
    FX_PAIRS_SWR_KEY, () => loadFxPairs(supabase),
    { refreshInterval: 300000, revalidateOnFocus: false }
  )
  const currencyPairs = data ?? []
  const lastSyncIso = latestSourceTimestamp(currencyPairs.map((pair) => pair.last_update))
  const lastSync = lastSyncIso ? new Date(lastSyncIso).toLocaleTimeString('fr-FR') : ''

  return (
    <AppShell lastSync={lastSync} lastSyncIso={lastSyncIso} className="bg-slate-50">
        <main className="p-4 sm:p-6 lg:p-12">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
              <ArrowRightLeft className="text-[#00FF88]" />
              <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-950 dark:text-white">Currency Pairs</h1>
            </div>
            
            {/* Currency Pairs Table */}
            <p className="text-sm text-slate-500">Paires explicites uniquement. 1 unité de devise de base = taux en devise de cotation. Statut de marché déclaré par la source ; date affichée = collecte, pas cotation. Variation source masquée si l’état est périmé, incomplet ou inconnu.</p>
            {error && <p role="alert" className="text-sm text-amber-700">Lecture FX impossible. Les éventuelles valeurs précédentes sont conservées comme cache.</p>}
            <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden">
              <div className="p-6 border-b-2 border-slate-200 dark:border-white/5">
                <h2 className="text-sm font-black uppercase tracking-tighter text-slate-950 dark:text-white">
                  FX Pairs from Market Watch
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
                        Daily Change
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
                                {change === null ? null : isPositive ? (
                                  <TrendingUp className="w-3 h-3 text-green-600 dark:text-green-400" />
                                ) : (
                                  <TrendingDown className="w-3 h-3 text-red-600 dark:text-red-400" />
                                )}
                                <span className={cn(
                                  "text-sm font-mono font-black",
                                  change === null ? 'text-slate-500' : isPositive
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-red-600 dark:text-red-400"
                                )}>
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
