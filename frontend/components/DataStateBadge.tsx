import React from 'react'
import { cn } from '../lib/utils'

export type DataState = 'LOADING' | 'LIVE' | 'STALE' | 'NO_DATA'

interface DataStateBadgeProps {
  state: DataState
  label?: string
}

export function DataStateBadge({ state, label }: DataStateBadgeProps) {
  const tone =
    state === 'LIVE'
      ? 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-300'
      : state === 'STALE'
        ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300'
        : state === 'NO_DATA'
          ? 'bg-slate-200 text-slate-600 border-slate-300 dark:bg-slate-800/60 dark:text-gray-300'
          : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-gray-300'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1 rounded border text-[10px] font-black uppercase tracking-widest',
        tone
      )}
    >
      {label ?? state}
    </span>
  )
}
