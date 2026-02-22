import React from 'react'
import { cn } from '../lib/utils'

interface CoverageBadgeProps {
  coveragePct: number | null
  startRequested: string
  startEffective?: string | null
  endDate?: string | null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '--'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('fr-FR')
}

export function CoverageBadge({
  coveragePct,
  startRequested,
  startEffective,
  endDate,
}: CoverageBadgeProps) {
  const normalized = coveragePct ?? null
  const coverageLabel = normalized === null ? 'n/a' : `${normalized.toFixed(1)}%`
  const statusTone =
    normalized === null
      ? 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-gray-300 dark:border-slate-700/60'
      : normalized >= 98
        ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-300 dark:border-green-800/60'
        : normalized >= 90
          ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800/60'
          : 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800/60'

  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
      <span className={cn('px-2 py-0.5 rounded border font-black uppercase tracking-widest', statusTone)}>
        Coverage {coverageLabel}
      </span>
      <span className="px-2 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 text-slate-600 dark:text-gray-300">
        Requested {formatDate(startRequested)}
      </span>
      <span className="px-2 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 text-slate-600 dark:text-gray-300">
        Effective {formatDate(startEffective)}
      </span>
      {endDate && (
        <span className="px-2 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5 text-slate-600 dark:text-gray-300">
          End {formatDate(endDate)}
        </span>
      )}
    </div>
  )
}
