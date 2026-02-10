"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Sidebar } from '../components/Sidebar'
import { Header } from '../components/Header'
import { AssetTable } from '../components/AssetTable'
import { GeographicMap } from '../components/GeographicMap'
import { CurrencyWidget } from '../components/CurrencyWidget'
import { MacroStrip } from '../components/MacroStrip'
import { AssetDetailDrawer } from '../components/AssetDetailDrawer'
import { HotNewsTickerTape } from '../components/HotNewsTickerTape'
import { GovernanceWidget } from '../components/GovernanceWidget'
import { PortfolioTrendPanel } from '../components/PortfolioTrendPanel'
import { Asset, GeoTimeframe, PortfolioOption } from '../types'
import { buildGeographicPerformance, loadPortfolioAggregation } from '../lib/portfolioData'
import { cn } from '../lib/utils'

export default function PortfolioDashboard() {
  const [hoveredAsset, setHoveredAsset] = useState<Asset | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [assetsByPortfolio, setAssetsByPortfolio] = useState<Record<string, Asset[]>>({ ALL: [] })
  const [portfolioOptions, setPortfolioOptions] = useState<PortfolioOption[]>([])
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>('ALL')
  const [loading, setLoading] = useState(true)
  const [lastSync, setLastSync] = useState<string>('')
  const [groupByClass, setGroupByClass] = useState(false)
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL')
  const [coveragePct, setCoveragePct] = useState<number | null>(null)
  const [mapTimeframe, setMapTimeframe] = useState<GeoTimeframe>('day')

  const assets = useMemo(() => {
    return assetsByPortfolio[selectedPortfolioId] ?? assetsByPortfolio.ALL ?? []
  }, [assetsByPortfolio, selectedPortfolioId])

  const geoData = useMemo(() => {
    return buildGeographicPerformance(assets, mapTimeframe)
  }, [assets, mapTimeframe])

  useEffect(() => {
    async function fetchPortfolio() {
      try {
        const bundle = await loadPortfolioAggregation(supabase)
        setAssetsByPortfolio(bundle.assetsByPortfolio)
        setPortfolioOptions(bundle.portfolioOptions)
        setLastSync(bundle.lastSync)

        if (selectedPortfolioId !== 'ALL' && !bundle.assetsByPortfolio[selectedPortfolioId]) {
          setSelectedPortfolioId('ALL')
        }
      } catch (error) {
        console.error('Error fetching portfolio dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    async function fetchCoverage() {
      try {
        let query = supabase
          .from('valuation_snapshots')
          .select('coverage_pct, portfolio_id, created_at')
          .order('created_at', { ascending: false })

        if (selectedPortfolioId !== 'ALL') {
          query = query.eq('portfolio_id', selectedPortfolioId)
        }

        const { data, error } = await query.limit(1).maybeSingle()
        if (error) throw error

        if (data && typeof data.coverage_pct === 'number') {
          setCoveragePct(data.coverage_pct)
        } else if (selectedPortfolioId !== 'ALL') {
          // Fallback global si le portfolio filtré n'a pas encore de snapshot dédié.
          const { data: globalData } = await supabase
            .from('valuation_snapshots')
            .select('coverage_pct, created_at')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          setCoveragePct(globalData?.coverage_pct ?? null)
        }
      } catch (error) {
        console.error('Error fetching coverage:', error)
      }
    }

    fetchPortfolio()
    fetchCoverage()

    const interval = setInterval(fetchPortfolio, 300000)
    return () => clearInterval(interval)
  }, [selectedPortfolioId])

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-[#080A0F] text-slate-950 dark:text-gray-300 transition-colors duration-500">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header lastSync={lastSync} coveragePct={coveragePct} />
        <HotNewsTickerTape />
        <MacroStrip />
        <main className="flex-1 p-6 overflow-hidden flex flex-col gap-6">
          <div className="flex-1 flex gap-6 min-h-0">
            <div className="w-[65%] flex flex-col">
              <div className="flex items-center justify-between mb-2 px-1 gap-3">
                <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Portfolio Matrix</h2>
                <div className="flex items-center gap-3">
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

                  <button
                    onClick={() => setGroupByClass(!groupByClass)}
                    className={cn(
                      'px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-colors',
                      groupByClass
                        ? 'bg-blue-600 text-white dark:bg-[#00FF88] dark:text-black'
                        : 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-gray-300'
                    )}
                  >
                    Group by Class
                  </button>

                  <div className="flex items-center gap-1">
                    {['ALL', 'EUR', 'USD', 'JPY'].map((curr) => (
                      <button
                        key={curr}
                        onClick={() => setCurrencyFilter(curr)}
                        className={cn(
                          'px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-colors',
                          currencyFilter === curr
                            ? 'bg-slate-950 text-white dark:bg-[#00FF88] dark:text-black'
                            : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-gray-400 hover:bg-slate-300 dark:hover:bg-white/20'
                        )}
                      >
                        {curr}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-1 bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden">
                {loading ? (
                  <div className="h-full w-full flex items-center justify-center text-sm font-mono text-slate-500 dark:text-gray-400">
                    Loading portfolio matrix...
                  </div>
                ) : (
                  <AssetTable
                    assets={assets}
                    onHoverAsset={setHoveredAsset}
                    onSelectAsset={setSelectedAsset}
                    selectedAssetId={selectedAsset?.id || null}
                    groupByClass={groupByClass}
                    currencyFilter={currencyFilter}
                  />
                )}
              </div>
            </div>

            <div className="w-[35%] flex flex-col gap-6">
              <div className="flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-2 px-1">
                  <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Regional Exposure</h2>
                  <div className="flex items-center gap-1">
                    {(
                      [
                        { key: 'day', label: 'D' },
                        { key: 'month', label: 'M' },
                        { key: 'ytd', label: 'YTD' },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.key}
                        onClick={() => setMapTimeframe(option.key)}
                        className={cn(
                          'px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-colors',
                          mapTimeframe === option.key
                            ? 'bg-slate-950 text-white dark:bg-[#00FF88] dark:text-black'
                            : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-gray-400 hover:bg-slate-300 dark:hover:bg-white/20'
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl dark:shadow-inner overflow-hidden">
                  <div className="w-full h-full bg-white dark:bg-transparent rounded-2xl overflow-hidden scale-100">
                    <GeographicMap
                      regions={geoData.regions}
                      hoveredAsset={hoveredAsset}
                      showBubbles
                      viewLabel={`WEIGHTED ${mapTimeframe.toUpperCase()}`}
                    />
                  </div>
                </div>
              </div>

              <PortfolioTrendPanel />

              <GovernanceWidget assets={assets} selectedPortfolioId={selectedPortfolioId} />
            </div>
          </div>

          <CurrencyWidget />
        </main>
      </div>

      <AssetDetailDrawer asset={selectedAsset} isOpen={selectedAsset !== null} onClose={() => setSelectedAsset(null)} />
    </div>
  )
}
