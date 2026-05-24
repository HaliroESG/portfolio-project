"use client"

import React from 'react'
import { ThemeToggle } from './ThemeToggle'
import { formatSyncTime, resolveFreshness } from '../lib/dataFreshness'

interface HeaderProps {
  lastSync?: string;
  lastSyncIso?: string | null;
  coveragePct?: number | null;
}

export function Header({ lastSync, lastSyncIso, coveragePct }: HeaderProps) {
  const safeCoveragePct = coveragePct ?? 100
  const showCoverageWarning = safeCoveragePct < 90
  const freshness = resolveFreshness(lastSyncIso, 36 * 60, { marketAware: true })
  const isRecent = lastSyncIso ? freshness.state === 'LIVE' : Boolean(lastSync && lastSync !== '--:--:--')
  const displaySync = formatSyncTime(lastSyncIso, lastSync)

  return (
    <>
      {/* Coverage Warning Banner */}
      {showCoverageWarning && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800/50 px-8 py-2 sticky top-0 z-50">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-400">
            <span>!</span>
            <span>
              Portfolio Coverage: {safeCoveragePct.toFixed(1)}% - Some assets are unpriced
            </span>
          </div>
        </div>
      )}
      
      <header className={`h-16 border-b border-slate-200 dark:border-[#1a1d24] bg-white/80 dark:bg-[#0B0E14]/50 backdrop-blur-md flex items-center justify-between px-8 sticky ${showCoverageWarning ? 'top-[42px]' : 'top-0'} z-40 transition-colors`}>
        <div className="flex items-center space-x-6">
          <div className="flex flex-col">
            <h2 className="text-sm font-black tracking-widest text-slate-900 dark:text-white uppercase">
              Market Intelligence <span className="text-[#00FF88]">v1.1</span>
            </h2>
            <span className="text-[10px] font-mono text-slate-400 dark:text-gray-500">REAL-TIME DATA STREAM</span>
          </div>

          {/* DATA FRESHNESS INDICATOR */}
          <div className="hidden md:flex flex-col border-l border-slate-200 dark:border-white/10 pl-6">
            <span className="text-[9px] text-slate-500 dark:text-gray-500 font-black uppercase tracking-[0.2em]">Last Sync</span>
            <div className="flex items-center gap-2">
              {isRecent ? (
                <div className="relative">
                  <div className="w-2 h-2 rounded-full bg-[#00FF88] animate-pulse"></div>
                  <div className="absolute inset-0 w-2 h-2 rounded-full bg-[#00FF88] animate-ping opacity-75"></div>
                </div>
              ) : (
                <div className="w-2 h-2 rounded-full bg-slate-400 dark:bg-gray-600"></div>
              )}
              <span className="text-xs font-mono font-black text-slate-950 dark:text-gray-300">
                {displaySync}
              </span>
              {lastSyncIso && freshness.isMarketClosedGrace && (
                <span className="text-[9px] font-mono font-bold uppercase text-slate-500 dark:text-gray-500">
                  market closed
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <ThemeToggle />
        </div>
      </header>
    </>
  )
}
