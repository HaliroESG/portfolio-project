import React from 'react'
import { AlertTriangle, Database, FileSearch, Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'

type EmptyStateTone = 'neutral' | 'warning' | 'error' | 'loading'

interface EmptyStateProps {
  title: string
  message: string
  tone?: EmptyStateTone
  className?: string
}

const toneStyles: Record<EmptyStateTone, string> = {
  neutral: 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-[#0D1117]/70 dark:text-gray-400',
  warning: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/20 dark:text-amber-300',
  error: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300',
  loading: 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-[#0D1117]/70 dark:text-gray-400',
}

export function EmptyState({ title, message, tone = 'neutral', className }: EmptyStateProps) {
  const Icon =
    tone === 'error' ? AlertTriangle : tone === 'warning' ? Database : tone === 'loading' ? Loader2 : FileSearch

  return (
    <div
      className={cn(
        'flex min-h-[180px] flex-col items-center justify-center rounded-xl border p-6 text-center',
        toneStyles[tone],
        className
      )}
    >
      <Icon className={cn('mb-3 h-5 w-5', tone === 'loading' && 'animate-spin')} />
      <div className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-white">{title}</div>
      <div className="mt-2 max-w-xl text-sm leading-relaxed">{message}</div>
    </div>
  )
}
