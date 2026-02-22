import React from 'react'
import { cn } from '../lib/utils'
import { CoverageBadge } from './CoverageBadge'

export interface PortfolioCard {
  portfolio_key: string
  label: string
  role: 'target' | 'current' | 'preset' | 'baseline'
  coveragePct: number | null
  start_date_requested: string
  start_date_effective?: string | null
  end_date?: string | null
}

interface PortfolioSelectGridProps {
  portfolios: PortfolioCard[]
  selectedKeys: string[]
  onToggle: (portfolioKey: string) => void
}

function roleTone(role: PortfolioCard['role']): string {
  switch (role) {
    case 'target':
      return 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700/60'
    case 'current':
      return 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-700/60'
    case 'baseline':
      return 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-800/60 dark:text-gray-300 dark:border-slate-700/60'
    default:
      return 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700/60'
  }
}

export function PortfolioSelectGrid({
  portfolios,
  selectedKeys,
  onToggle,
}: PortfolioSelectGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {portfolios.map((portfolio) => {
        const selected = selectedKeys.includes(portfolio.portfolio_key)
        return (
          <button
            key={portfolio.portfolio_key}
            onClick={() => onToggle(portfolio.portfolio_key)}
            className={cn(
              'text-left p-4 rounded-2xl border-2 transition-all shadow-2xl bg-white dark:bg-[#0D1117]/50',
              selected
                ? 'border-[#00FF88] ring-2 ring-[#00FF88]/30'
                : 'border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/20'
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black uppercase tracking-tight text-slate-950 dark:text-white">
                  {portfolio.label}
                </div>
                <div className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                  {portfolio.portfolio_key}
                </div>
              </div>
              <span className={cn('px-2 py-0.5 rounded border text-[9px] font-black uppercase tracking-wider', roleTone(portfolio.role))}>
                {portfolio.role}
              </span>
            </div>
            <div className="mt-3">
              <CoverageBadge
                coveragePct={portfolio.coveragePct}
                startRequested={portfolio.start_date_requested}
                startEffective={portfolio.start_date_effective}
                endDate={portfolio.end_date}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}
