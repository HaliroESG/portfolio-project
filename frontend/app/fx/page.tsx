"use client"

import React, { useEffect } from 'react'
import useSWR from 'swr'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { supabase } from '../../lib/supabase'
import { ArrowRightLeft, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '../../lib/utils'
import { stateLabel as dataStateLabel, UnifiedDataState } from '../../lib/dataStates'
import { swrOptions, SWR_REFRESH } from '../../lib/swrConfig'
import { formatSyncTime } from '../../lib/dataFreshness'
import { FX_CACHE_KEY, FX_PAIRS_SWR_KEY, FX_RATES_SWR_KEY, currencyCollectionState, loadCurrencyRates, loadFxPairs, parseFxCache, rateDailyChange } from '../../lib/fxData'
import { latestSourceTimestamp, observationState } from '../../lib/readerState'
import type { CurrencyRateRow } from '../../types'

export default function FXPage() {
  const { data: rates, isLoading, error } = useSWR(FX_RATES_SWR_KEY, () => loadCurrencyRates(supabase), swrOptions(SWR_REFRESH.SLOW))
  const { data: pairs, error: pairError } = useSWR(FX_PAIRS_SWR_KEY, () => loadFxPairs(supabase), swrOptions(SWR_REFRESH.SLOW))
  const { data: cached = [] } = useSWR<CurrencyRateRow[]>(error ? FX_CACHE_KEY : null, () => {
    try { return parseFxCache(window.localStorage.getItem(FX_CACHE_KEY)) } catch { return [] }
  }, { revalidateOnFocus: false, revalidateOnReconnect: false })
  useEffect(() => {
    if (!rates) return
    try { window.localStorage.setItem(FX_CACHE_KEY, JSON.stringify(rates)) } catch { /* Cache is optional. */ }
  }, [rates])

  const usingCache = Boolean(error && ((rates?.length ?? 0) > 0 || cached.length > 0))
  const currencies = (error ? rates ?? cached : rates ?? []).map((rate) => ({
    ...rate,
    change_pct: error || pairError ? null : rateDailyChange(rate, pairs ?? []),
  }))
  const lastSyncIso = latestSourceTimestamp(currencies.map((row) => row.last_update))
  const lastSync = formatSyncTime(lastSyncIso, '')
  const loading = isLoading && !rates && !error
  const rowStates = currencies.map((row) => observationState(row.rate_to_eur, row.last_update))
  const fxState = usingCache ? 'CACHED' : error ? 'ERROR' : loading ? 'LOADING'
    : !currencies.length ? 'EMPTY' : rowStates.some((state) => state === 'MISSING' || state === 'UNKNOWN') ? 'UNKNOWN'
    : rowStates.includes('STALE') ? 'STALE' : 'COLLECTED'
  const unifiedState: UnifiedDataState = error ? 'ERROR' : loading ? 'LOADING' : fxState === 'EMPTY' ? 'EMPTY'
    : fxState === 'COLLECTED' ? 'OK' : 'STALE'
  const stateLabel = {
    text: fxState,
    color: fxState === 'COLLECTED' ? 'text-slate-700 dark:text-slate-300' : 'text-amber-700 dark:text-amber-400',
    dot: fxState === 'COLLECTED' ? 'bg-slate-400' : 'bg-amber-400',
  }
  const freshnessLabel = 'Collecte ≤ 72 h · fraîcheur de marché non certifiée'
  const sourceLabel = usingCache ? 'Cache daté — lecture en erreur' : 'Supabase currencies'
  const marketNote = '1 unité de devise = taux affiché en EUR. Variation fournie par une paire explicite déclarée OK par la source, orientée vs EUR, avec une collecte du même jour. La date exacte de cotation n’est pas fournie par ce contrat. Aucun cours LIVE certifié et aucune performance d’action utilisée. Source périmée, incomplète ou inconnue : variation N/A.'

  return (
    <AppShell lastSync={lastSync} lastSyncIso={lastSyncIso} className="bg-slate-50">
        <main className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 space-y-6">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <ArrowRightLeft className="shrink-0 text-[#00FF88]" />
                  <h1 className="min-w-0 text-2xl font-black uppercase tracking-tighter text-slate-950 dark:text-white sm:text-3xl">FX Intelligence</h1>
                </div>
                <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-lg border border-slate-300 bg-slate-200 px-3 py-1 dark:border-white/10 dark:bg-white/10">
                  <span className={`h-2 w-2 rounded-full ${stateLabel.dot}`} />
                  <span className={`text-[10px] font-black uppercase tracking-wider ${stateLabel.color}`}>{stateLabel.text}</span>
                  <span className="text-[10px] text-slate-500 dark:text-gray-400">· {fxState === 'COLLECTED' ? 'Collecte récente, date de marché inconnue' : fxState === 'UNKNOWN' ? 'Données ou dates incomplètes' : dataStateLabel(unifiedState)}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  ['Source', sourceLabel],
                  ['Freshness', freshnessLabel],
                  ['Pairs', currencies.length.toString()],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/[0.03] px-4 py-3">
                    <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">{label}</div>
                    <div className="mt-1 min-w-0 break-words text-xs font-mono font-black text-slate-950 dark:text-white">{value}</div>
                  </div>
                ))}
              </div>

              <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden">
                <div className="p-6 border-b-2 border-slate-200 dark:border-white/5">
                  <h2 className="text-sm font-black uppercase tracking-tighter text-slate-950 dark:text-white">
                    Major Currency Pairs (vs EUR)
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  {error && <p role="alert" className="p-4 text-sm text-amber-700">Lecture des taux impossible. Les éventuelles valeurs conservées sont un cache, pas des cours à jour.</p>}
                  {pairError && <p role="alert" className="p-4 text-sm text-amber-700">Variation quotidienne indisponible : lecture des paires en erreur.</p>}
                  <table className="w-full">
                    <thead className="bg-slate-50 dark:bg-[#080A0F]">
                      <tr>
                        <th className="p-4 text-left text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                          Currency
                        </th>
                        <th className="p-4 text-right text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                          Rate to EUR
                        </th>
                        <th className="p-4 text-right text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                          Change
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {loading ? (
                      <tr>
                        <td colSpan={3} className="p-8 text-center text-slate-500 dark:text-gray-400">
                          <EmptyState title="Loading FX data" message="Reading currency rates from Supabase." tone="loading" />
                        </td>
                      </tr>
                    ) : currencies.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="p-8 text-center text-slate-500 dark:text-gray-400">
                          <EmptyState
                            title={error ? 'FX read failed' : 'No FX source data'}
                            message="No verified currency rates are available. Equity prices are never used as an FX fallback."
                            tone="warning"
                          />
                        </td>
                      </tr>
                      ) : (
                        currencies.map((currency) => {
                          const change = currency.change_pct
                          const isPositive = change !== null && change >= 0

                          return (
                            <tr
                              key={currency.id}
                              className="hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors"
                            >
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-mono font-black text-slate-950 dark:text-white">
                                    {currency.id}
                                  </span>
                                  <span className="text-xs font-bold text-slate-500 dark:text-gray-400">
                                    {currency.symbol}
                                  </span>
                                </div>
                                <div className="mt-1 text-[10px] text-slate-500">{error ? 'CACHED' : currencyCollectionState(currency)} · Collecte : {currency.last_update ? new Date(currency.last_update).toLocaleString('fr-FR') : 'date inconnue'}</div>
                              </td>
                              <td className="p-4 text-right">
                                <span className="text-sm font-mono font-black text-slate-950 dark:text-white">
                                  {currency.rate_to_eur !== null ? currency.rate_to_eur.toFixed(4) : 'N/A'}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {change === null ? null : isPositive ? (
                                    <TrendingUp className="w-3 h-3 text-green-600 dark:text-green-400" />
                                  ) : (
                                    <TrendingDown className="w-3 h-3 text-red-600 dark:text-red-400" />
                                  )}
                                  <span
                                    className={cn(
                                      'text-sm font-mono font-black',
                                      change === null ? 'text-slate-500' : isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                                    )}
                                  >
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

            <div className="lg:col-span-4">
              <div className="p-8 bg-slate-950 dark:bg-[#0A0D12] rounded-3xl shadow-2xl border-2 border-slate-800 dark:border-white/5 text-white">
                <h3 className="text-[#00FF88] font-black uppercase text-xl mb-4 tracking-tighter flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5" />
                  Market Note
                </h3>
                <p className="text-slate-300 dark:text-gray-300 text-sm leading-relaxed">
                  {marketNote || 'Analyzing currency market trends...'}
                </p>
                <div className="mt-6 pt-6 border-t border-slate-800 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Last Update</p>
                    <span className="text-[10px] font-mono text-slate-300">
                      {formatSyncTime(lastSyncIso, lastSync || 'N/A')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">State</p>
                    <span className={`text-[10px] font-black uppercase tracking-wider ${stateLabel.color}`}>
                      {stateLabel.text}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Source</p>
                    <span className="text-[10px] font-mono text-slate-300">{sourceLabel}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
    </AppShell>
  )
}
