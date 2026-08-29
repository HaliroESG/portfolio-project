"use client"

import React, { useMemo, useState } from 'react'
import { AppShell } from '../../components/AppShell'
import { GeographicMap } from '../../components/GeographicMap'
import { Globe, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Asset, CountryPerformance, GeoTimeframe, PortfolioOption } from '../../types'
import { buildGeographicPerformance } from '../../lib/portfolioData'
import { stateFromList, stateLabel as dataStateLabel } from '../../lib/dataStates'
import { usePortfolioAggregationOwnerReader } from '../../lib/portfolioAggregationOwnerReader'

function getDisplayedPerformance(country: CountryPerformance, timeframe: GeoTimeframe): number {
  if (timeframe === 'day') return country.performanceDay
  if (timeframe === 'month') return country.performanceMonth
  return country.performanceYtd
}

export default function GeoPage() {
  const [timeframe, setTimeframe] = useState<GeoTimeframe>('day')
  const {
    ownerError,
    selectedPortfolioId,
    setSelectedPortfolioId,
    portfolioBundle,
    bundleError,
    loading,
  } = usePortfolioAggregationOwnerReader()

  const portfolioOptions: PortfolioOption[] = portfolioBundle?.portfolioOptions ?? []
  const lastSync = portfolioBundle?.lastSync ?? ''
  const lastSyncIso = portfolioBundle?.lastSyncIso ?? null

  const assets = useMemo(() => {
    const assetsByPortfolio: Record<string, Asset[]> = portfolioBundle?.assetsByPortfolio ?? { ALL: [] }
    return assetsByPortfolio[selectedPortfolioId] ?? assetsByPortfolio.ALL ?? []
  }, [portfolioBundle, selectedPortfolioId])

  const { regions, countries } = useMemo(() => {
    return buildGeographicPerformance(assets, timeframe)
  }, [assets, timeframe])

  const geoState = stateFromList({ loading, count: regions.length, error: ownerError ?? bundleError })

  return (
    <AppShell lastSync={lastSync} lastSyncIso={lastSyncIso}>
        <main className="flex flex-col gap-5 p-4 sm:p-6 lg:gap-8 lg:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><h1 className="text-2xl font-black uppercase tracking-tighter text-slate-950 dark:text-white sm:text-4xl">
              Global <span className="text-[#00FF88]">Exposure</span>
            </h1><p className="text-xs text-slate-500 dark:text-gray-400 mt-1">{dataStateLabel(geoState)}</p></div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-lg bg-slate-200/70 dark:bg-white/10 px-2 py-1">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400">Portfolio</span>
                <select
                  value={selectedPortfolioId}
                  onChange={(event) => setSelectedPortfolioId(event.target.value)}
                  className="bg-transparent text-[10px] font-black text-slate-900 dark:text-white outline-none"
                >
                  <option value="ALL">All Portfolios</option>
                  {portfolioOptions.map((portfolio) => (
                    <option key={portfolio.id} value={portfolio.id}>
                      {portfolio.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1">
                {(
                  [
                    { key: 'day', label: 'Daily' },
                    { key: 'month', label: 'Monthly' },
                    { key: 'ytd', label: 'YTD' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.key}
                    onClick={() => setTimeframe(option.key)}
                    className={cn(
                      'px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors',
                      timeframe === option.key
                        ? 'bg-slate-950 text-white dark:bg-[#00FF88] dark:text-black'
                        : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-gray-400 hover:bg-slate-300 dark:hover:bg-white/20'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12 xl:gap-8">
            <div className="min-h-[420px] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-white/5 dark:bg-black/20 dark:shadow-inner sm:min-h-[560px] lg:rounded-3xl lg:border-2 lg:p-4 xl:col-span-9">
              <div className="w-full h-full rounded-2xl bg-white dark:bg-transparent transition-colors scale-100">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                  </div>
                ) : !regions || regions.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Globe className="w-12 h-12 mx-auto text-slate-400 mb-4" />
                      <p className="text-slate-500 dark:text-gray-400">No geographic data available</p>
                    </div>
                  </div>
                ) : (
                  <GeographicMap
                    regions={regions}
                    hoveredAsset={null}
                    showBubbles
                    viewLabel={`WEIGHTED ${timeframe.toUpperCase()} PERFORMANCE`}
                  />
                )}
              </div>
            </div>

            <div className="space-y-6 xl:col-span-3">
              <div className="p-6 bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-xl">
                <h3 className="text-sm font-black uppercase mb-6 text-slate-950 dark:text-white">Regional Performance</h3>
                <div className="space-y-4">
                  {countries.map((country) => {
                    const displayed = getDisplayedPerformance(country, timeframe)
                    return (
                      <div key={country.code} className="space-y-2">
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-gray-400 block truncate">
                              {country.name}
                            </span>
                            <span className="text-[9px] text-slate-400 dark:text-gray-500">
                              {country.exposurePct.toFixed(1)}% weight · {country.assetCount} asset{country.assetCount > 1 ? 's' : ''}
                            </span>
                          </div>
                          <span
                            className={cn(
                              'text-[10px] font-mono font-black',
                              displayed >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                            )}
                          >
                            {displayed >= 0 ? '+' : ''}
                            {displayed.toFixed(2)}%
                          </span>
                        </div>

                        <div className="h-1.5 w-full bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full transition-all duration-500',
                              displayed >= 0 ? 'bg-green-500 dark:bg-green-400' : 'bg-red-500 dark:bg-red-400'
                            )}
                            style={{ width: `${Math.min(100, country.exposurePct)}%` }}
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-1 text-[8px] font-mono">
                          <span className={cn(country.performanceDay >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                            D {country.performanceDay >= 0 ? '+' : ''}{country.performanceDay.toFixed(1)}%
                          </span>
                          <span className={cn(country.performanceMonth >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                            M {country.performanceMonth >= 0 ? '+' : ''}{country.performanceMonth.toFixed(1)}%
                          </span>
                          <span className={cn(country.performanceYtd >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                            YTD {country.performanceYtd >= 0 ? '+' : ''}{country.performanceYtd.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </main>
    </AppShell>
  )
}
