"use client"

import React from 'react'
import { Asset } from '../types'
import { X, ExternalLink, Star, TrendingUp, TrendingDown, Globe2, Activity } from 'lucide-react'
import { cn } from '../lib/utils'

interface AssetDetailDrawerProps {
  asset: Asset | null
  isOpen: boolean
  onClose: () => void
}

// Country code to name mapping for display
const COUNTRY_NAMES: Record<string, string> = {
  'US': 'United States',
  'FR': 'France',
  'GB': 'United Kingdom',
  'DE': 'Germany',
  'JP': 'Japan',
  'CN': 'China',
  'CH': 'Switzerland',
  'CA': 'Canada',
  'AU': 'Australia',
  'IT': 'Italy',
  'ES': 'Spain',
  'NL': 'Netherlands',
  'SE': 'Sweden',
  'NO': 'Norway',
  'DK': 'Denmark',
  'FI': 'Finland',
  'IE': 'Ireland',
  'BE': 'Belgium',
  'BR': 'Brazil',
  'IN': 'India',
  'KR': 'South Korea',
  'TW': 'Taiwan',
  'SA': 'Saudi Arabia',
  'ZA': 'South Africa',
  'MX': 'Mexico',
}

export function AssetDetailDrawer({ asset, isOpen, onClose }: AssetDetailDrawerProps) {
  if (!asset) return null

  const dayChange = asset.performance?.day?.value || 0
  const isPositive = dayChange >= 0
  const hasMissingData = asset.price === null || asset.price === 0 || asset.price === undefined

  // Prepare geographic breakdown data
  const geographicData = asset.constituents 
    ? Object.entries(asset.constituents)
        .map(([code, value]) => ({
          code: code.toUpperCase(),
          name: COUNTRY_NAMES[code.toUpperCase()] || code,
          value: value as number
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10) // Top 10 regions
    : []

  const totalExposure = geographicData.reduce((sum, item) => sum + item.value, 0)

  const handleYahooFinance = () => {
    window.open(`https://finance.yahoo.com/quote/${asset.ticker}`, '_blank')
  }

  const handleWatchlist = () => {
    // TODO: Implement watchlist functionality
    console.log('Add to watchlist:', asset.ticker)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-black/50 dark:bg-black/80 z-40 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          "fixed right-0 top-0 h-full w-full max-w-2xl bg-white dark:bg-[#0A0D12] z-50 shadow-2xl dark:shadow-[0_0_50px_rgba(0,255,136,0.1)]",
          "transform transition-transform duration-300 ease-in-out",
          "border-l-2 border-slate-200 dark:border-[#00FF88]/20",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="h-full flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-6 border-b-2 border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#080A0F]">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-2xl font-black text-slate-950 dark:text-white uppercase tracking-tighter">
                    {asset.name}
                  </h2>
                  {hasMissingData && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50">
                      Check Ticker
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-bold text-slate-500 dark:text-gray-400">
                    {asset.ticker}
                  </span>
                  <span className="text-xs font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest">
                    {asset.type}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-colors"
                aria-label="Close drawer"
              >
                <X className="w-5 h-5 text-slate-600 dark:text-gray-400" />
              </button>
            </div>

            {/* Price Section */}
            <div className="mt-4">
              <div className="flex items-baseline gap-3">
                <span className={cn(
                  "text-4xl font-mono font-black",
                  hasMissingData 
                    ? "text-amber-600 dark:text-amber-500" 
                    : "text-slate-950 dark:text-white"
                )}>
                  {hasMissingData ? 'N/A' : (asset.price ?? 0).toLocaleString('fr-FR', { 
                    minimumFractionDigits: 2, 
                    maximumFractionDigits: 2 
                  })}
                </span>
                <span className="text-lg font-bold text-slate-500 dark:text-gray-400">
                  {asset.currency}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                {isPositive ? (
                  <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
                )}
                <span className={cn(
                  "text-lg font-mono font-black",
                  isPositive 
                    ? "text-green-600 dark:text-green-400" 
                    : "text-red-600 dark:text-red-400"
                )}>
                  {isPositive ? '+' : ''}{dayChange.toFixed(2)}%
                </span>
                <span className="text-xs font-bold text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                  Today
                </span>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Geographic Breakdown */}
            {geographicData.length > 0 && (
              <div className="bg-slate-50 dark:bg-[#080A0F] rounded-2xl border-2 border-slate-200 dark:border-white/5 p-6 shadow-xl">
                <div className="flex items-center gap-2 mb-4">
                  <Globe2 className="w-5 h-5 text-blue-600 dark:text-[#00FF88]" />
                  <h3 className="text-sm font-black text-slate-950 dark:text-white uppercase tracking-tighter">
                    Geographic Breakdown
                  </h3>
                </div>
                <div className="space-y-3">
                  {geographicData.map((item) => {
                    const percentage = totalExposure > 0 ? (item.value / totalExposure) * 100 : 0
                    return (
                      <div key={item.code} className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-700 dark:text-gray-300">
                            {item.name}
                          </span>
                          <span className="text-xs font-mono font-black text-slate-950 dark:text-white">
                            {percentage.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-200 dark:bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 dark:bg-[#00FF88] transition-all duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Asset Metrics */}
            <div className="bg-slate-50 dark:bg-[#080A0F] rounded-2xl border-2 border-slate-200 dark:border-white/5 p-6 shadow-xl">
              <h3 className="text-sm font-black text-slate-950 dark:text-white uppercase tracking-tighter mb-4">
                Asset Metrics
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                    P/E Ratio
                  </span>
                  <div className="text-lg font-mono font-black text-slate-950 dark:text-white">
                    N/A
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                    Market Cap
                  </span>
                  <div className="text-lg font-mono font-black text-slate-950 dark:text-white">
                    N/A
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                    Week Change
                  </span>
                  <div className={cn(
                    "text-lg font-mono font-black",
                    (asset.performance?.week?.value || 0) >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  )}>
                    {((asset.performance?.week?.value || 0) >= 0 ? '+' : '')}
                    {(asset.performance?.week?.value || 0).toFixed(2)}%
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                    YTD Change
                  </span>
                  <div className={cn(
                    "text-lg font-mono font-black",
                    (asset.performance?.ytd?.value || 0) >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  )}>
                    {((asset.performance?.ytd?.value || 0) >= 0 ? '+' : '')}
                    {(asset.performance?.ytd?.value || 0).toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Technical Indicators */}
            <div className="bg-slate-50 dark:bg-[#080A0F] rounded-2xl border-2 border-slate-200 dark:border-white/5 p-6 shadow-xl">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-blue-600 dark:text-[#00FF88]" />
                <h3 className="text-sm font-black text-slate-950 dark:text-white uppercase tracking-tighter">
                  Technical Indicators
                </h3>
              </div>
              <div className="space-y-4">
                {/* MA200 Status */}
                <div className="flex items-center justify-between p-3 bg-white dark:bg-[#0A0D12] rounded-xl border border-slate-200 dark:border-white/5">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                      MA200 Status
                    </span>
                    <span className="text-xs font-mono text-slate-600 dark:text-gray-400 mt-1">
                      Price vs 200-Day Moving Average
                    </span>
                  </div>
                  <span className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-tighter",
                    "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-800/50"
                  )}>
                    Above MA200
                  </span>
                </div>

                {/* Long-term Trend (20-Year Linear Regression) */}
                <div className="flex items-center justify-between p-3 bg-white dark:bg-[#0A0D12] rounded-xl border border-slate-200 dark:border-white/5">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                      Long-term Trend
                    </span>
                    <span className="text-xs font-mono text-slate-600 dark:text-gray-400 mt-1">
                      20-Year Linear Regression Slope
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono font-black text-slate-950 dark:text-white">
                      +0.042
                    </div>
                    <div className="text-[9px] font-bold text-green-600 dark:text-green-400 uppercase">
                      Bullish
                    </div>
                  </div>
                </div>

                {/* RSI Gauge */}
                <div className="p-3 bg-white dark:bg-[#0A0D12] rounded-xl border border-slate-200 dark:border-white/5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                      Relative Strength Index (RSI)
                    </span>
                    <span className="text-sm font-mono font-black text-slate-950 dark:text-white">
                      58.3
                    </span>
                  </div>
                  <div className="relative h-3 w-full bg-slate-200 dark:bg-white/5 rounded-full overflow-hidden">
                    <div className="absolute inset-0 flex">
                      <div className="w-1/3 bg-red-500 dark:bg-red-500/50"></div>
                      <div className="w-1/3 bg-yellow-500 dark:bg-yellow-500/50"></div>
                      <div className="w-1/3 bg-green-500 dark:bg-green-500/50"></div>
                    </div>
                    <div 
                      className="absolute top-0 h-full w-1 bg-slate-950 dark:bg-white transition-all duration-500"
                      style={{ left: '58.3%' }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-[8px] font-bold text-slate-500 dark:text-gray-500">
                    <span>Oversold</span>
                    <span>Neutral</span>
                    <span>Overbought</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-slate-50 dark:bg-[#080A0F] rounded-2xl border-2 border-slate-200 dark:border-white/5 p-6 shadow-xl">
              <h3 className="text-sm font-black text-slate-950 dark:text-white uppercase tracking-tighter mb-4">
                Quick Actions
              </h3>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleYahooFinance}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 dark:bg-[#00FF88] text-white dark:text-black rounded-xl font-black uppercase tracking-tighter text-sm hover:bg-blue-700 dark:hover:bg-[#00FF88]/80 transition-colors shadow-lg"
                >
                  <ExternalLink className="w-4 h-4" />
                  View on Yahoo Finance
                </button>
                <button
                  onClick={handleWatchlist}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-200 dark:bg-white/10 text-slate-950 dark:text-white rounded-xl font-black uppercase tracking-tighter text-sm hover:bg-slate-300 dark:hover:bg-white/20 transition-colors border-2 border-slate-300 dark:border-white/10"
                >
                  <Star className="w-4 h-4" />
                  Add to Watchlist
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
