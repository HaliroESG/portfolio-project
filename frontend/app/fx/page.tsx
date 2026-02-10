"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { supabase } from '../../lib/supabase'
import { ArrowRightLeft, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '../../lib/utils'

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
  perf_week_local: number | null
  perf_month_local: number | null
  last_price: number | null
  type: string | null
}

const FX_CACHE_KEY = 'fx_pairs_cache_v1'

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

function resolveFxState(lastUpdate: string | null): FxState {
  if (!lastUpdate) return 'STALE'
  const diffMs = Date.now() - new Date(lastUpdate).getTime()
  if (Number.isNaN(diffMs)) return 'STALE'
  const diffHours = diffMs / (1000 * 60 * 60)
  return diffHours <= 24 ? 'LIVE' : 'STALE'
}

export default function FXPage() {
  const [lastSync, setLastSync] = useState('')
  const [currencies, setCurrencies] = useState<CurrencyData[]>([])
  const [loading, setLoading] = useState(true)
  const [marketNote, setMarketNote] = useState('')
  const [fxState, setFxState] = useState<FxState>('EMPTY')

  useEffect(() => {
    async function fetchCurrencies() {
      try {
        const [{ data: currenciesData, error: currenciesError }, { data: assetsData, error: assetsError }] = await Promise.all([
          supabase
            .from('currencies')
            .select('id, symbol, rate_to_eur, last_update')
            .order('id', { ascending: true }),
          supabase
            .from('market_watch')
            .select('ticker, currency, perf_day_eur, perf_week_local, perf_month_local, last_price, type')
            .not('currency', 'is', null),
        ])

        if (currenciesError) throw currenciesError
        if (assetsError) throw assetsError

        const typedCurrencies = (currenciesData ?? []) as CurrencyRow[]
        const typedAssets = (assetsData ?? []) as MarketWatchAssetRow[]

        const forexAssets = typedAssets.filter((asset) => {
          const ticker = (asset.ticker || '').toUpperCase()
          const type = (asset.type || '').toUpperCase()
          return type === 'FOREX' || type === 'CURRENCY' || ticker.includes('=X')
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

          const latestUpdate = typedCurrencies
            .map((currency) => currency.last_update)
            .filter((value): value is string => !!value)
            .reduce((max, update) => (new Date(update) > new Date(max) ? update : max), typedCurrencies[0]?.last_update || new Date().toISOString())

          setLastSync(new Date(latestUpdate).toLocaleTimeString('fr-FR'))
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
            nextFxState = 'STALE'
            setFxState(nextFxState)
          } else {
            const cached = readFxCache()
            if (cached.length > 0) {
              resolvedCurrencies = cached
              nextFxState = 'CACHED'
              setFxState(nextFxState)
            } else {
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
          setFxState('CACHED')
        } else {
          setFxState('EMPTY')
        }
      } finally {
        setLoading(false)
      }
    }

    fetchCurrencies()

    const interval = setInterval(fetchCurrencies, 300000)
    return () => clearInterval(interval)
  }, [])

  const stateLabel = useMemo(() => {
    if (fxState === 'LIVE') return { text: 'Live', color: 'text-green-400', dot: 'bg-green-400' }
    if (fxState === 'STALE') return { text: 'Stale', color: 'text-amber-400', dot: 'bg-amber-400' }
    if (fxState === 'CACHED') return { text: 'Cached', color: 'text-blue-400', dot: 'bg-blue-400' }
    return { text: 'No Feed', color: 'text-red-400', dot: 'bg-red-400' }
  }, [fxState])

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#080A0F] transition-colors duration-500">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header lastSync={lastSync} />
        <main className="flex-1 p-12 overflow-y-auto">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12">
            <div className="lg:col-span-8 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ArrowRightLeft className="text-[#00FF88]" />
                  <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-950 dark:text-white">FX Intelligence</h1>
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-200 dark:bg-white/10 border border-slate-300 dark:border-white/10">
                  <span className={`h-2 w-2 rounded-full ${stateLabel.dot}`} />
                  <span className={`text-[10px] font-black uppercase tracking-wider ${stateLabel.color}`}>{stateLabel.text}</span>
                </div>
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
                            Loading currencies...
                          </td>
                        </tr>
                      ) : currencies.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-8 text-center text-slate-500 dark:text-gray-400">
                            No currency data available
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

            <div className="lg:col-span-4 pt-12">
              <div className="p-8 bg-slate-950 dark:bg-[#0A0D12] rounded-3xl shadow-2xl border-2 border-slate-800 dark:border-white/5 text-white">
                <h3 className="text-[#00FF88] font-black uppercase text-xl mb-4 tracking-tighter flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5" />
                  Market Note
                </h3>
                <p className="text-slate-300 dark:text-gray-300 text-sm leading-relaxed">
                  {marketNote || 'Analyzing currency market trends...'}
                </p>
                <div className="mt-6 pt-6 border-t border-slate-800 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                    Last Update: {lastSync || 'N/A'}
                  </p>
                  <span className={`text-[10px] font-black uppercase tracking-wider ${stateLabel.color}`}>
                    {stateLabel.text}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
