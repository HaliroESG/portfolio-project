"use client"

import React, { useEffect, useState, useMemo } from 'react'
import { Asset } from '../types'
import { X, ExternalLink, Star, TrendingUp, TrendingDown, Globe2, Activity, Newspaper } from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { Tooltip } from './Tooltip'

const WATCHLIST_STORAGE_KEY = 'portfolio_watchlist_tickers'

function readWatchlist(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []
  } catch {
    return []
  }
}

function writeWatchlist(tickers: string[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(tickers))
}

// Helper function to format Market Cap (e.g., 2,500,000,000 -> "2.5B")
function formatMarketCap(marketCap: number | null | undefined): string {
  if (marketCap === null || marketCap === undefined || marketCap === 0) {
    return 'N/A'
  }
  
  const absValue = Math.abs(marketCap)
  
  if (absValue >= 1_000_000_000_000) {
    return `${(marketCap / 1_000_000_000_000).toFixed(2)}T`
  } else if (absValue >= 1_000_000_000) {
    return `${(marketCap / 1_000_000_000).toFixed(2)}B`
  } else if (absValue >= 1_000_000) {
    return `${(marketCap / 1_000_000).toFixed(2)}M`
  } else if (absValue >= 1_000) {
    return `${(marketCap / 1_000).toFixed(2)}K`
  } else {
    return marketCap.toFixed(2)
  }
}

// Helper function to format P/E Ratio (2 decimal places)
function formatPERatio(peRatio: number | null | undefined): string {
  if (peRatio === null || peRatio === undefined || peRatio === 0) {
    return 'N/A'
  }
  return peRatio.toFixed(2)
}

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

interface NewsItem {
  id: string
  url: string
  title: string
  source: string
  impact_level: string
  impact_score: number
  impact_explanation?: string | null
  published_at: string
}

export function AssetDetailDrawer({ asset, isOpen, onClose }: AssetDetailDrawerProps) {
  // ===== ALL HOOKS MUST BE DECLARED FIRST (before any conditional returns) =====
  
  // Hook 1: useState
  const [news, setNews] = useState<NewsItem[]>([])
  const [watchlistEntries, setWatchlistEntries] = useState<string[]>(() => readWatchlist())

  // Hook 2: useMemo - Memoize derived data to prevent recalculation on every render
  const geographicData = useMemo(() => {
    if (!asset?.constituents) return []
    
    return Object.entries(asset.constituents)
      .map(([code, value]) => ({
        code: code.toUpperCase(),
        name: COUNTRY_NAMES[code.toUpperCase()] || code,
        value: value as number
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10) // Top 10 regions
  }, [asset?.constituents])

  // Hook 3: useMemo
  const totalExposure = useMemo(() => {
    return geographicData.reduce((sum, item) => sum + item.value, 0)
  }, [geographicData])

  // Hook 4: useMemo
  const dayChange = useMemo(() => asset?.performance?.day?.value || 0, [asset?.performance?.day?.value])

  // Hook 5: useMemo - Watchlist status from localStorage
  const isInWatchlist = useMemo(() => {
    if (!asset?.ticker) return false
    return watchlistEntries.includes(asset.ticker)
  }, [asset?.ticker, watchlistEntries])

  // Hook 6: useEffect - Fetch news for this ticker
  useEffect(() => {
    // Garde-fou au début de l'effet
    if (!asset?.ticker) return

    async function fetchNews() {
      try {
        const ticker = asset?.ticker // Utiliser optional chaining
        if (!ticker) return
        
        const { data, error } = await supabase
          .from('news_feed')
          .select('*')
          .eq('ticker', ticker) // Utiliser ticker (singulier) pour la requête
          .order('impact_score', { ascending: false })
          .order('published_at', { ascending: false })
          .limit(5)
        
        if (error) throw error
        if (data) {
          setNews(data)
        }
      } catch (err) {
        console.error('Error fetching news:', err)
      }
    }

    fetchNews()
  }, [asset?.ticker]) // Dépendance : seulement asset?.ticker (pas asset entier)

  // ===== CONDITIONAL RETURN MOVED AFTER ALL HOOKS =====
  // Sécurité totale : si pas d'asset, ne rien afficher (APRÈS tous les hooks)
  if (!asset) return null

  // ===== DERIVED VALUES (not hooks, safe to calculate after conditional) =====
  const isPositive = dayChange >= 0
  const hasMissingData = asset?.price === null || asset?.price === 0 || asset?.price === undefined
  const ma200Status = asset?.technical?.ma200_status ?? null
  const trendSlope = asset?.technical?.trend_slope ?? null
  const rsi14 = asset?.technical?.rsi_14 ?? null
  const macdLine = asset?.technical?.macd_line ?? null
  const macdSignal = asset?.technical?.macd_signal ?? null
  const macdHist = asset?.technical?.macd_hist ?? null
  const momentum20 = asset?.technical?.momentum_20 ?? null

  // ===== EVENT HANDLERS =====
  const handleYahooFinance = () => {
    if (!asset?.ticker) return
    window.open(`https://finance.yahoo.com/quote/${asset?.ticker}`, '_blank')
  }

  const handleWatchlist = () => {
    if (!asset?.ticker) return
    const exists = watchlistEntries.includes(asset.ticker)
    const next = exists
      ? watchlistEntries.filter((ticker) => ticker !== asset.ticker)
      : [...watchlistEntries, asset.ticker]
    writeWatchlist(next)
    setWatchlistEntries(next)
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
      {asset && (
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
                    {asset?.name || 'Unknown Asset'}
                  </h2>
                  {hasMissingData && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50">
                      Check Ticker
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-bold text-slate-500 dark:text-gray-400">
                    {asset?.ticker || 'N/A'}
                  </span>
                  <span className="text-xs font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest">
                    {asset?.type || 'N/A'}
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
                  {hasMissingData ? 'N/A' : (asset?.price ?? 0).toLocaleString('fr-FR', { 
                    minimumFractionDigits: 2, 
                    maximumFractionDigits: 2 
                  })}
                </span>
                <span className="text-lg font-bold text-slate-500 dark:text-gray-400">
                  {asset?.currency || 'N/A'}
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
                    {formatPERatio(asset?.pe_ratio)}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                    Market Cap
                  </span>
                  <div className="text-lg font-mono font-black text-slate-950 dark:text-white">
                    {formatMarketCap(asset?.market_cap)}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                    Week Change
                  </span>
                  <div className={cn(
                    "text-lg font-mono font-black",
                    (asset?.performance?.week?.value || 0) >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  )}>
                    {((asset?.performance?.week?.value || 0) >= 0 ? '+' : '')}
                    {(asset?.performance?.week?.value || 0).toFixed(2)}%
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                    YTD Change
                  </span>
                  <div className={cn(
                    "text-lg font-mono font-black",
                    (asset?.performance?.ytd?.value || 0) >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  )}>
                    {((asset?.performance?.ytd?.value || 0) >= 0 ? '+' : '')}
                    {(asset?.performance?.ytd?.value || 0).toFixed(2)}%
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
                    ma200Status === 'above'
                      ? "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-800/50"
                      : ma200Status === 'below'
                      ? "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800/50"
                      : "bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-gray-400 border border-slate-300 dark:border-slate-700"
                  )}>
                    {ma200Status === 'above' ? 'Above MA200' : ma200Status === 'below' ? 'Below MA200' : 'N/A'}
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
                      {trendSlope !== null ? `${trendSlope >= 0 ? '+' : ''}${trendSlope.toFixed(4)}` : '--'}
                    </div>
                    <div className={cn(
                      "text-[9px] font-bold uppercase",
                      trendSlope === null
                        ? "text-slate-500 dark:text-gray-500"
                        : trendSlope >= 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    )}>
                      {trendSlope === null ? 'N/A' : trendSlope >= 0 ? 'Bullish' : 'Bearish'}
                    </div>
                  </div>
                </div>

                {/* RSI Gauge */}
                <div className="p-3 bg-white dark:bg-[#0A0D12] rounded-xl border border-slate-200 dark:border-white/5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                      Relative Strength Index (RSI 14)
                    </span>
                    <span className="text-sm font-mono font-black text-slate-950 dark:text-white">
                      {rsi14 !== null ? rsi14.toFixed(1) : '--'}
                    </span>
                  </div>
                  <div className="relative h-3 w-full bg-slate-200 dark:bg-white/5 rounded-full overflow-hidden">
                    <div className="absolute inset-0 flex">
                      <div className="w-2/5 bg-red-500 dark:bg-red-500/50"></div>
                      <div className="w-1/5 bg-amber-500 dark:bg-amber-500/50"></div>
                      <div className="w-2/5 bg-green-500 dark:bg-green-500/50"></div>
                    </div>
                    <div 
                      className="absolute top-0 h-full w-1 bg-slate-950 dark:bg-white transition-all duration-500"
                      style={{ left: `${Math.max(0, Math.min(100, rsi14 ?? 0))}%` }}
                    />
                    <div
                      className="absolute top-0 h-full w-0.5 bg-blue-700/70 dark:bg-blue-300/70"
                      style={{ left: '60%' }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-[8px] font-bold text-slate-500 dark:text-gray-500">
                    <span>Oversold</span>
                    <span>Threshold 60</span>
                    <span>Strong</span>
                  </div>
                </div>

                {/* MACD + Momentum */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-white dark:bg-[#0A0D12] rounded-xl border border-slate-200 dark:border-white/5">
                    <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                      MACD
                    </span>
                    <div className="mt-2 space-y-1 text-xs font-mono font-bold">
                      <div className="flex justify-between">
                        <span className="text-slate-500 dark:text-gray-500">Line</span>
                        <span className="text-slate-900 dark:text-gray-100">{macdLine !== null ? macdLine.toFixed(3) : '--'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 dark:text-gray-500">Signal</span>
                        <span className="text-slate-900 dark:text-gray-100">{macdSignal !== null ? macdSignal.toFixed(3) : '--'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 dark:text-gray-500">Hist</span>
                        <span className={cn(
                          macdHist !== null && macdHist >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                        )}>
                          {macdHist !== null ? macdHist.toFixed(3) : '--'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 bg-white dark:bg-[#0A0D12] rounded-xl border border-slate-200 dark:border-white/5">
                    <span className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider">
                      Momentum 20d
                    </span>
                    <div className={cn(
                      "mt-2 text-lg font-mono font-black",
                      (momentum20 ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                    )}>
                      {(momentum20 ?? 0) >= 0 ? '+' : ''}{momentum20 !== null ? momentum20.toFixed(2) : '--'}%
                    </div>
                    <div className="mt-1 text-[10px] font-bold text-slate-500 dark:text-gray-500 uppercase tracking-wider">
                      {(momentum20 ?? 0) > 0 ? 'Positive Impulse' : 'Negative Impulse'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Latest Headlines */}
            {news.length > 0 && (
              <div className="bg-slate-50 dark:bg-[#080A0F] rounded-2xl border-2 border-slate-200 dark:border-white/5 p-6 shadow-xl">
                <div className="flex items-center gap-2 mb-4">
                  <Newspaper className="w-5 h-5 text-blue-600 dark:text-[#00FF88]" />
                  <h3 className="text-sm font-black text-slate-950 dark:text-white uppercase tracking-tighter">
                    Latest Headlines
                  </h3>
                </div>
                <div className="space-y-3">
                  {news.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-3 bg-white dark:bg-[#0A0D12] rounded-xl border border-slate-200 dark:border-white/5 hover:border-blue-500 dark:hover:border-[#00FF88] transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <Tooltip 
                          content={item.impact_explanation || `Impact Level: ${item.impact_level}`}
                          side="top"
                        >
                          <span className={cn(
                            "text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded cursor-help",
                            item.impact_level === 'HIGH' 
                              ? "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400"
                              : item.impact_level === 'MEDIUM'
                              ? "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-gray-400"
                          )}>
                            {item.impact_level}
                          </span>
                        </Tooltip>
                        <span className="text-[8px] font-mono text-slate-400 dark:text-gray-500">
                          {item.source}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-950 dark:text-white group-hover:text-blue-600 dark:group-hover:text-[#00FF88] transition-colors line-clamp-2">
                        {item.title}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[8px] font-mono text-slate-400 dark:text-gray-500">
                          Score: {item.impact_score}
                        </span>
                        <ExternalLink className="w-3 h-3 text-slate-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

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
                  {isInWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </>
  )
}
