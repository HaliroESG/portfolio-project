"use client"

import React, { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { supabase } from '../../lib/supabase'
import { ArrowRightLeft, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '../../lib/utils'
import { stateLabel as dataStateLabel, UnifiedDataState } from '../../lib/dataStates'
import { swrOptions, SWR_REFRESH } from '../../lib/swrConfig'
import { formatSyncTime, resolveFreshness } from '../../lib/dataFreshness'

type FxState = 'LIVE' | 'STALE' | 'CACHED' | 'EMPTY'

interface CurrencyData {
  id: string
  symbol: string
  rate_to_eur: number | null
  change_pct?: number | null
  last_update?: string | null
}

interface CurrencyRow {
  id: string
  symbol: string
  rate_to_eur: number | null
  last_update: string | null
}

interface MarketWatchAssetRow {
  ticker: string | null
  currency: string | null
  perf_day_eur: number | null
  perf_week_local?: number | null
  perf_month_local?: number | null
  last_price: number | null
  last_update: string | null
}

const FX_CACHE_KEY = 'fx_pairs_cache_v1'
const FX_DATA_SWR_KEY = 'fx-data-v1'
const SELECTOR_CACHE: Record<string, string> = {}

async function selectWithFallback<T>(
  table: string,
  selectors: string[],
  options?: {
    notNullColumn?: string
    orderBy?: { column: string; ascending?: boolean }
  }
): Promise<T[]> {
  let lastErrorMessage = ''
  const cachedSelector = SELECTOR_CACHE[table]
  const orderedSelectors = cachedSelector
    ? [cachedSelector, ...selectors.filter((selector) => selector !== cachedSelector)]
    : selectors

  for (const selector of orderedSelectors) {
    let query = supabase.from(table).select(selector)

    if (options?.notNullColumn) {
      query = query.not(options.notNullColumn, 'is', null)
    }
    if (options?.orderBy) {
      query = query.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? true })
    }

    const { data, error } = await query
    if (!error) {
      SELECTOR_CACHE[table] = selector
      return (data ?? []) as T[]
    }
    lastErrorMessage = error.message
  }

  throw new Error(`[fx] failed to query "${table}": ${lastErrorMessage || 'unknown error'}`)
}

function readFxCache(): CurrencyData[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(FX_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            ('rate_to_eur' in item)
        )
      : []
  } catch {
    return []
  }
}

function saveFxCache(values: CurrencyData[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(FX_CACHE_KEY, JSON.stringify(values))
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
}

function resolveFxState(lastUpdate: string | null): FxState {
  return resolveFreshness(lastUpdate, 36 * 60, { marketAware: true }).state === 'LIVE' ? 'LIVE' : 'STALE'
}

export default function FXPage() {
  const [lastSync, setLastSync] = useState('')
  const [lastSyncIso, setLastSyncIso] = useState<string | null>(null)
  const [currencies, setCurrencies] = useState<CurrencyData[]>([])
  const [loading, setLoading] = useState(true)
  const [marketNote, setMarketNote] = useState('')
  const [fxState, setFxState] = useState<FxState>('EMPTY')

  const { data, isLoading, error } = useSWR(
    FX_DATA_SWR_KEY,
    async () => {
      const [currenciesData, assetsData] = await Promise.all([
        selectWithFallback<CurrencyRow>(
          'currencies',
          ['id, symbol, rate_to_eur, last_update', 'id, symbol, rate_to_eur'],
          { orderBy: { column: 'id', ascending: true } }
        ),
        selectWithFallback<MarketWatchAssetRow>(
          'market_watch',
          [
            'ticker, currency, perf_day_eur, last_price, last_update',
          ],
          { notNullColumn: 'currency' }
        ),
      ])

      return {
        currencies: currenciesData,
        assets: assetsData,
      }
    },
    swrOptions(SWR_REFRESH.SLOW)
  )

  useEffect(() => {
    async function computeCurrencies() {
      try {
        const typedCurrencies = data?.currencies ?? []
        const typedAssets = data?.assets ?? []

        const forexAssets = typedAssets.filter((asset) => {
          const ticker = (asset.ticker || '').toUpperCase()
          return ticker.includes('=X')
        })

        const currencyPerformance = new Map<string, number[]>()

        const performanceSource = forexAssets.length > 0 ? forexAssets : typedAssets
        performanceSource.forEach((asset) => {
          const currency = asset.currency?.toUpperCase()
          if (!currency || asset.perf_day_eur === null) return

          if (!currencyPerformance.has(currency)) {
            currencyPerformance.set(currency, [])
          }
          currencyPerformance.get(currency)?.push((asset.perf_day_eur || 0) * 100)
        })

        let resolvedCurrencies: CurrencyData[] = []
        let nextFxState: FxState = 'EMPTY'

        if (typedCurrencies.length > 0) {
          resolvedCurrencies = typedCurrencies.map((currency) => {
            const perfs = currencyPerformance.get(currency.id.toUpperCase()) || []
            const avgChange = perfs.length > 0 ? perfs.reduce((sum, value) => sum + value, 0) / perfs.length : 0

            return {
              ...currency,
              change_pct: avgChange / 100,
            }
          })

          const latestUpdate = latestTimestamp(typedCurrencies.map((currency) => currency.last_update))
          setLastSync(latestUpdate ? new Date(latestUpdate).toLocaleTimeString('fr-FR') : '')
          setLastSyncIso(latestUpdate)
          nextFxState = resolveFxState(latestUpdate)
          setFxState(nextFxState)
          saveFxCache(resolvedCurrencies)
        } else {
          const inferredFromMarketWatch = new Map<string, CurrencyData>()

          forexAssets.forEach((asset) => {
            const currency = asset.currency?.toUpperCase()
            if (!currency || currency === 'EUR') return
            if (asset.last_price === null || asset.last_price <= 0) return

            const perfs = currencyPerformance.get(currency) || []
            const avgChange = perfs.length > 0 ? perfs.reduce((sum, value) => sum + value, 0) / perfs.length : 0

            inferredFromMarketWatch.set(currency, {
              id: currency,
              symbol: currency,
              rate_to_eur: asset.last_price,
              change_pct: avgChange / 100,
              last_update: null,
            })
          })

          resolvedCurrencies = Array.from(inferredFromMarketWatch.values()).sort((left, right) =>
            left.id.localeCompare(right.id, 'en', { sensitivity: 'base' })
          )

          if (resolvedCurrencies.length > 0) {
            const latestUpdate = latestTimestamp(performanceSource.map((asset) => asset.last_update))
            setLastSync(latestUpdate ? new Date(latestUpdate).toLocaleTimeString('fr-FR') : '')
            setLastSyncIso(latestUpdate)
            nextFxState = resolveFxState(latestUpdate)
            setFxState(nextFxState)
          } else {
            const cached = readFxCache()
            if (cached.length > 0) {
              resolvedCurrencies = cached
              const latestUpdate = latestTimestamp(cached.map((currency) => currency.last_update))
              setLastSync(latestUpdate ? new Date(latestUpdate).toLocaleTimeString('fr-FR') : '')
              setLastSyncIso(latestUpdate)
              nextFxState = 'CACHED'
              setFxState(nextFxState)
            } else {
              setLastSync('')
              setLastSyncIso(null)
              nextFxState = 'EMPTY'
              setFxState(nextFxState)
            }
          }
        }

        setCurrencies(resolvedCurrencies)

        const strongCurrencies = resolvedCurrencies.filter((currency) => (currency.change_pct || 0) > 0.5)
        const weakCurrencies = resolvedCurrencies.filter((currency) => (currency.change_pct || 0) < -0.5)

        let note = 'FX markets showing mixed signals. '
        if (strongCurrencies.length > 0) {
          note += `${strongCurrencies.map((currency) => currency.id).join(', ')} ${strongCurrencies.length > 1 ? 'are' : 'is'} strengthening against EUR. `
        }
        if (weakCurrencies.length > 0) {
          note += `${weakCurrencies.map((currency) => currency.id).join(', ')} ${weakCurrencies.length > 1 ? 'are' : 'is'} weakening. `
        }

        if (strongCurrencies.length === 0 && weakCurrencies.length === 0) {
          note += 'Major pairs trading in tight ranges. Monitor central bank policy divergence for breakout signals.'
        } else {
          note += 'Monitor G10 yields and central bank communications for directional bias.'
        }

        if (nextFxState === 'CACHED') {
          note += ' Display currently relies on last cached values.'
        }

        setMarketNote(note)
      } catch (error) {
        console.error('Error fetching currencies:', error)

        const cached = readFxCache()
        if (cached.length > 0) {
          setCurrencies(cached)
          const latestUpdate = latestTimestamp(cached.map((currency) => currency.last_update))
          setLastSync(latestUpdate ? new Date(latestUpdate).toLocaleTimeString('fr-FR') : '')
          setLastSyncIso(latestUpdate)
          setFxState('CACHED')
        } else {
          setLastSync('')
          setLastSyncIso(null)
          setFxState('EMPTY')
        }
      } finally {
        setLoading(isLoading)
      }
    }
    computeCurrencies()
  }, [data, isLoading])


  const unifiedState: UnifiedDataState = isLoading
    ? 'LOADING'
    : error
    ? 'ERROR'
    : fxState === 'EMPTY'
    ? 'EMPTY'
    : fxState === 'CACHED' || fxState === 'STALE'
    ? 'STALE'
    : 'OK'

  const stateLabel = useMemo(() => {
    if (fxState === 'LIVE') return { text: 'Live', color: 'text-green-400', dot: 'bg-green-400' }
    if (fxState === 'STALE') return { text: 'Stale', color: 'text-amber-400', dot: 'bg-amber-400' }
    if (fxState === 'CACHED') return { text: 'Cached', color: 'text-blue-400', dot: 'bg-blue-400' }
    return { text: 'No Feed', color: 'text-red-400', dot: 'bg-red-400' }
  }, [fxState])

  const freshnessLabel = useMemo(() => {
    if (!lastSyncIso) return 'No source timestamp'
    const freshness = resolveFreshness(lastSyncIso, 36 * 60, { marketAware: true })
    return freshness.isMarketClosedGrace ? `${freshness.label} (market closed)` : freshness.label
  }, [lastSyncIso])

  const sourceLabel = useMemo(() => {
    if (fxState === 'CACHED') return 'Browser cache fallback'
    if ((data?.currencies?.length ?? 0) > 0) return 'Supabase currencies'
    if (currencies.length > 0) return 'Inferred from market_watch'
    return 'No source rows'
  }, [currencies.length, data?.currencies?.length, fxState])

  return (
    <AppShell lastSync={lastSync} lastSyncIso={lastSyncIso} className="bg-slate-50">
        <main className="p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ArrowRightLeft className="text-[#00FF88]" />
                  <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-950 dark:text-white">FX Intelligence</h1>
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-200 dark:bg-white/10 border border-slate-300 dark:border-white/10">
                  <span className={`h-2 w-2 rounded-full ${stateLabel.dot}`} />
                  <span className={`text-[10px] font-black uppercase tracking-wider ${stateLabel.color}`}>{stateLabel.text}</span>
                  <span className="text-[10px] text-slate-500 dark:text-gray-400">· {dataStateLabel(unifiedState)}</span>
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
                    <div className="mt-1 text-xs font-mono font-black text-slate-950 dark:text-white">{value}</div>
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
                          <EmptyState title="Loading FX data" message="Reading currencies and market_watch rows from Supabase." tone="loading" />
                        </td>
                      </tr>
                    ) : currencies.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="p-8 text-center text-slate-500 dark:text-gray-400">
                          <EmptyState
                            title="No FX source data"
                            message="Supabase returned no currency rows and no inferable market_watch FX rows."
                            tone="warning"
                          />
                        </td>
                      </tr>
                      ) : (
                        currencies.map((currency) => {
                          const change = currency.change_pct || 0
                          const isPositive = change >= 0

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
                              </td>
                              <td className="p-4 text-right">
                                <span className="text-sm font-mono font-black text-slate-950 dark:text-white">
                                  {currency.rate_to_eur !== null ? currency.rate_to_eur.toFixed(4) : 'N/A'}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {isPositive ? (
                                    <TrendingUp className="w-3 h-3 text-green-600 dark:text-green-400" />
                                  ) : (
                                    <TrendingDown className="w-3 h-3 text-red-600 dark:text-red-400" />
                                  )}
                                  <span
                                    className={cn(
                                      'text-sm font-mono font-black',
                                      isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                                    )}
                                  >
                                    {isPositive ? '+' : ''}{(change * 100).toFixed(2)}%
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
