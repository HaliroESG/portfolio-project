"use client"

import React from 'react'
import { ThemeToggle } from './ThemeToggle'

interface HeaderProps {
  lastSync?: string;
  coveragePct?: number | null;
}

function isRecentSync(lastSync: string): boolean {
  if (!lastSync || lastSync === '--:--:--') return false
  
  try {
    // Parse the time string (format: "HH:MM:SS" from fr-FR locale)
    const parts = lastSync.split(':')
    if (parts.length < 2) return false
    
    const hours = parseInt(parts[0], 10)
    const minutes = parseInt(parts[1], 10)
    
    if (isNaN(hours) || isNaN(minutes)) return false
    
    const now = new Date()
    const syncTime = new Date()
    syncTime.setHours(hours, minutes, 0, 0)
    
    // Calculate difference in hours
    let diffMs = now.getTime() - syncTime.getTime()
    let diffHours = diffMs / (1000 * 60 * 60)
    
    // If sync time appears to be in the future (same day, later time), it's recent
    if (diffMs < 0) {
      // Check if it's the same day - if so, it's recent
      return now.getDate() === syncTime.getDate() && 
             now.getMonth() === syncTime.getMonth() && 
             now.getFullYear() === syncTime.getFullYear()
    }
    
    // If sync was within last 24 hours, it's recent
    // Also handle case where sync might be from today but earlier in the day
    if (diffHours < 24 && diffHours >= 0) {
      return true
    }
    
    // If sync is more than 24h old but same calendar day, still consider recent
    // (handles edge case where sync happened early today)
    if (now.getDate() === syncTime.getDate() && 
        now.getMonth() === syncTime.getMonth() && 
        now.getFullYear() === syncTime.getFullYear()) {
      return true
    }
    
    return false
  } catch {
    return false
  }
}

export function Header({ lastSync, coveragePct }: HeaderProps) {
  // Utiliser nullish coalescing pour donner une valeur par défaut de 100 si coveragePct est null/undefined
  const safeCoveragePct = coveragePct ?? 100
  const showCoverageWarning = safeCoveragePct < 90

  return (
    <>
      {/* Coverage Warning Banner */}
      {showCoverageWarning && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800/50 px-8 py-2 sticky top-0 z-50">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-400">
            <span>⚠️</span>
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
              {lastSync && isRecentSync(lastSync) ? (
                <div className="relative">
                  <div className="w-2 h-2 rounded-full bg-[#00FF88] animate-pulse"></div>
                  <div className="absolute inset-0 w-2 h-2 rounded-full bg-[#00FF88] animate-ping opacity-75"></div>
                </div>
              ) : (
                <div className="w-2 h-2 rounded-full bg-slate-400 dark:bg-gray-600"></div>
              )}
              <span className="text-xs font-mono font-black text-slate-950 dark:text-gray-300">
                {lastSync || '--:--:--'}
              </span>
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