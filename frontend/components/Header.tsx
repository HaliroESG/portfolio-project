"use client"

import React from 'react'
import { ThemeToggle } from './ThemeToggle'

interface HeaderProps {
  lastSync?: string;
}

export function Header({ lastSync }: HeaderProps) {
  return (
    <header className="h-16 border-b border-slate-200 dark:border-[#1a1d24] bg-white/80 dark:bg-[#0B0E14]/50 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-40 transition-colors">
      <div className="flex items-center space-x-6">
        <div className="flex flex-col">
          <h2 className="text-sm font-black tracking-widest text-slate-900 dark:text-white uppercase">
            Market Intelligence <span className="text-[#00FF88]">v1.1</span>
          </h2>
          <span className="text-[10px] font-mono text-slate-400 dark:text-gray-500">REAL-TIME DATA STREAM</span>
        </div>

        {/* DATA FRESHNESS INDICATOR */}
        <div className="hidden md:flex flex-col border-l border-slate-200 dark:border-white/10 pl-6">
           <span className="text-[9px] text-slate-400 dark:text-gray-500 font-bold uppercase tracking-[0.2em]">Last Sync</span>
           <div className="flex items-center gap-2">
             <div className="w-1.5 h-1.5 rounded-full bg-[#00FF88] animate-pulse"></div>
             <span className="text-xs font-mono text-slate-600 dark:text-gray-300">
               {lastSync || '--:--:--'}
             </span>
           </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <ThemeToggle />
      </div>
    </header>
  )
}