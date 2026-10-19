"use client"

import React from 'react'
import { Menu } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { CurrencyWidget } from './CurrencyWidget'
import { LogoutButton } from './LogoutButton'
import { formatSyncTime } from '../lib/dataFreshness'

interface HeaderProps {
  lastSync?: string;
  lastSyncIso?: string | null;
  coveragePct?: number | null;
  onMenuClick?: () => void;
  menuOpen?: boolean;
  contextLabel?: string;
}

export function Header({ lastSync, lastSyncIso, coveragePct, onMenuClick, menuOpen, contextLabel }: HeaderProps) {
  const safeCoveragePct = coveragePct ?? 100
  const showCoverageWarning = safeCoveragePct < 90
  const displaySync = formatSyncTime(lastSyncIso, lastSync)

  return (
    <>
      {/* Coverage Warning Banner */}
      {showCoverageWarning && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800/50 px-8 py-2 sticky top-0 z-50">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-400">
            <span>!</span>
            <span>
              Couverture du portefeuille : {safeCoveragePct.toFixed(1)} % — certains actifs ne sont pas valorisés
            </span>
          </div>
        </div>
      )}
      
      <header className={`h-16 border-b border-slate-200 dark:border-[#1a1d24] bg-white/85 dark:bg-[#0B0E14]/75 backdrop-blur-md flex items-center justify-between gap-3 px-3 sm:px-5 lg:px-8 sticky ${showCoverageWarning ? 'top-[42px]' : 'top-0'} z-40 transition-colors`}>
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <button
            type="button"
            aria-label="Ouvrir la navigation"
            aria-controls="app-navigation"
            aria-expanded={Boolean(menuOpen)}
            onClick={onMenuClick}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10 md:hidden"
          >
            <Menu size={17} />
          </button>

          <div className="flex min-w-0 flex-col">
            <h2 className="truncate text-xs font-black uppercase tracking-widest text-slate-900 dark:text-white sm:text-sm">
              Portfolio Office
            </h2>
            <span className="hidden text-[10px] text-slate-500 dark:text-gray-400 sm:inline">{contextLabel ?? 'Registre patrimonial privé · ASTROCYTE'}</span>
          </div>

          {/* DATA FRESHNESS INDICATOR */}
          <div className="hidden lg:flex flex-col border-l border-slate-200 dark:border-white/10 pl-6" title="La collecte ne certifie pas la fraîcheur des observations. Consulter la date de chaque source.">
            <span className="text-[9px] text-slate-500 dark:text-gray-500 font-semibold uppercase tracking-wider">Dernière collecte</span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-gray-600" />
              <span className="text-xs font-mono font-black text-slate-950 dark:text-gray-300">
                {displaySync}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <CurrencyWidget />
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>
    </>
  )
}
