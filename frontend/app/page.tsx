"use client"

import React, { useState, useEffect } from 'react'
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
import { mockRegions, mockCurrencyPairs } from '../utils/mockData'
import { Asset } from '../types'
import { cn } from '../lib/utils'

export default function PortfolioDashboard() {
  const [hoveredAsset, setHoveredAsset] = useState<Asset | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [lastSync, setLastSync] = useState<string>("")
  const [groupByClass, setGroupByClass] = useState(false)
  const [currencyFilter, setCurrencyFilter] = useState<string>("ALL")
  const [coveragePct, setCoveragePct] = useState<number | null>(null)

  useEffect(() => {
    async function fetchAssets() {
      try {
        const { data, error } = await supabase.from('market_watch').select('*')
        if (error) throw error
        
        // Early return check BEFORE any state updates
        if (!data || data.length === 0) {
          setLoading(false)
          return
        }
        
        const latest = data.reduce((max, item) => 
          new Date(item.last_update || 0) > new Date(max || 0) ? item.last_update : max, 
          data[0]?.last_update || new Date().toISOString()
        )
        setLastSync(new Date(latest).toLocaleTimeString('fr-FR'))

        // MAPPING + TRI ALPHABÉTIQUE ROBUSTE
        const formattedAssets: Asset[] = data
          .map((item: any) => {
            // Sécuriser le mapping du type
            const validTypes = ['Stock', 'STOCK', 'ETF', 'Crypto', 'CRYPTO', 'Cash']
            const itemType = item.type || 'Stock'
            const safeType = validTypes.includes(itemType) ? itemType : 'Stock'
            
            // Valider data_status
            const validStatuses = ['OK', 'STALE', 'LOW_CONFIDENCE', 'PARTIAL']
            const dataStatus = item.data_status && validStatuses.includes(item.data_status) 
              ? item.data_status 
              : undefined
            
            return {
              id: item.id || '',
              name: item.name || 'Unknown',
              ticker: item.ticker || 'N/A',
              price: item.last_price || 0,
              currency: item.currency || 'EUR',
              type: safeType as any,
              constituents: item.geo_coverage || {},
              data_status: dataStatus,
              last_update: item.last_update || undefined,
              pe_ratio: item.pe_ratio ?? null,
              market_cap: item.market_cap ?? null,
              performance: {
                day: { value: (item.perf_day_eur || 0) * 100, currencyImpact: ((item.perf_day_eur || 0) - (item.perf_day_local || 0)) * 100 },
                week: { value: (item.perf_week_local || 0) * 100, currencyImpact: 0 },
                month: { value: (item.perf_month_local || 0) * 100, currencyImpact: 0 },
                ytd: { value: (item.perf_ytd_eur || 0) * 100, currencyImpact: 0 },
              }
            }
          })
          .sort((a: Asset, b: Asset) => {
            // Handle null/undefined names gracefully
            const nameA = (a.name || '').trim().toLowerCase()
            const nameB = (b.name || '').trim().toLowerCase()
            
            if (!nameA && !nameB) return 0
            if (!nameA) return 1
            if (!nameB) return -1
            
            return nameA.localeCompare(nameB, 'en', { sensitivity: 'base' })
          })
        setAssets(formattedAssets)
      } catch (err) { 
        console.error(err) 
      } finally { 
        setLoading(false) 
      }
    }
    fetchAssets()
    
    // Fetch latest coverage from valuation_snapshots
    async function fetchCoverage() {
      try {
        const { data, error } = await supabase
          .from('valuation_snapshots')
          .select('coverage_pct')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
        
        if (error) throw error
        if (data && data.coverage_pct !== null) {
          setCoveragePct(data.coverage_pct)
        }
      } catch (err) {
        console.error('Error fetching coverage:', err)
      }
    }
    fetchCoverage()
  }, [])

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-[#080A0F] text-slate-950 dark:text-gray-300 transition-colors duration-500">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header lastSync={lastSync} coveragePct={coveragePct} />
        <HotNewsTickerTape />
        <MacroStrip />
        <main className="flex-1 p-6 overflow-hidden flex flex-col gap-6">
          <div className="flex-1 flex gap-6 min-h-0">
            {/* Table Matrix */}
            <div className="w-[65%] flex flex-col">
              <div className="flex items-center justify-between mb-2 px-1">
                <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Portfolio Matrix</h2>
                <div className="flex items-center gap-3">
                  {/* Group by Asset Class Toggle */}
                  <button
                    onClick={() => setGroupByClass(!groupByClass)}
                    className={cn(
                      "px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-colors",
                      groupByClass
                        ? "bg-blue-600 text-white dark:bg-[#00FF88] dark:text-black"
                        : "bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-gray-300"
                    )}
                  >
                    Group by Class
                  </button>
                  {/* Currency Filter */}
                  <div className="flex items-center gap-1">
                    {['ALL', 'EUR', 'USD', 'JPY'].map((curr) => (
                      <button
                        key={curr}
                        onClick={() => setCurrencyFilter(curr)}
                        className={cn(
                          "px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-colors",
                          currencyFilter === curr
                            ? "bg-slate-950 text-white dark:bg-[#00FF88] dark:text-black"
                            : "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-gray-400 hover:bg-slate-300 dark:hover:bg-white/20"
                        )}
                      >
                        {curr}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex-1 bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden">
                <AssetTable 
                  assets={assets} 
                  onHoverAsset={setHoveredAsset}
                  onSelectAsset={setSelectedAsset}
                  selectedAssetId={selectedAsset?.id || null}
                  groupByClass={groupByClass}
                  currencyFilter={currencyFilter}
                />
              </div>
            </div>
            {/* Map Mini View */}
            <div className="w-[35%] flex flex-col gap-6">
              <div className="flex-1 flex flex-col">
                <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 px-1">Regional Exposure</h2>
                <div className="flex-1 bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl dark:shadow-inner overflow-hidden">
                  <div className="w-full h-full bg-white dark:bg-transparent rounded-2xl overflow-hidden scale-100">
                    <GeographicMap regions={mockRegions} hoveredAsset={hoveredAsset} />
                  </div>
                </div>
              </div>
              
              {/* Governance Widget */}
              <GovernanceWidget assets={assets} />
            </div>
          </div>
          <CurrencyWidget pairs={mockCurrencyPairs} />
        </main>
      </div>
      
      {/* Asset Detail Drawer */}
      <AssetDetailDrawer
        asset={selectedAsset}
        isOpen={selectedAsset !== null}
        onClose={() => setSelectedAsset(null)}
      />
    </div>
  )
}