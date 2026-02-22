import React from 'react'
import { BacktestKpi } from '../types'
import { cn } from '../lib/utils'

interface KpiComparisonTableProps {
  portfolios: { portfolio_key: string; label: string; role: string }[]
  kpis: Record<string, BacktestKpi>
}

const KPI_ROWS = [
  { key: 'cagr', label: 'CAGR', format: 'pct' },
  { key: 'vol', label: 'Volatility', format: 'pct' },
  { key: 'sharpe', label: 'Sharpe', format: 'num' },
  { key: 'sortino', label: 'Sortino', format: 'num' },
  { key: 'max_drawdown', label: 'Max Drawdown', format: 'pct' },
  { key: 'calmar', label: 'Calmar', format: 'num' },
  { key: 'worst_year', label: 'Worst Year', format: 'pct' },
  { key: 'best_year', label: 'Best Year', format: 'pct' },
] as const

function formatValue(value: number | null | undefined, format: 'pct' | 'num'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  if (format === 'pct') return `${(value * 100).toFixed(2)}%`
  return value.toFixed(2)
}

function roleTone(role: string): string {
  if (role === 'target') return 'text-emerald-600 dark:text-emerald-300'
  if (role === 'current') return 'text-blue-600 dark:text-blue-300'
  if (role === 'baseline') return 'text-slate-500 dark:text-gray-400'
  return 'text-amber-600 dark:text-amber-300'
}

export function KpiComparisonTable({ portfolios, kpis }: KpiComparisonTableProps) {
  if (portfolios.length === 0) {
    return (
      <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl p-6">
        <div className="text-sm font-black text-slate-500 dark:text-gray-400 uppercase tracking-wider">KPIs</div>
        <div className="mt-4 text-xs text-slate-500 dark:text-gray-400">No KPI data.</div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden">
      <div className="px-6 py-4 border-b-2 border-slate-200 dark:border-white/5">
        <h3 className="text-sm font-black uppercase tracking-tighter text-slate-950 dark:text-white">KPI Comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-[#080A0F]">
            <tr>
              <th className="p-4 text-left text-[10px] font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                Metric
              </th>
              {portfolios.map((portfolio) => (
                <th
                  key={portfolio.portfolio_key}
                  className="p-4 text-right text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5"
                >
                  <span className={cn('block', roleTone(portfolio.role))}>{portfolio.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KPI_ROWS.map((row) => (
              <tr key={row.key} className="border-b border-slate-200/60 dark:border-white/5">
                <td className="p-4 text-[11px] font-mono text-slate-600 dark:text-gray-300">{row.label}</td>
                {portfolios.map((portfolio) => {
                  const kpi = kpis[portfolio.portfolio_key]
                  const value = kpi ? (kpi as Record<string, number | null>)[row.key] : null
                  return (
                    <td key={`${portfolio.portfolio_key}-${row.key}`} className="p-4 text-right text-[11px] font-mono text-slate-900 dark:text-gray-200">
                      {formatValue(value ?? null, row.format)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
