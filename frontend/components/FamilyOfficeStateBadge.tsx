import { AlertTriangle, CheckCircle2, CircleHelp, Clock3 } from 'lucide-react'
import type { FamilyOfficeDataState } from '../types'
import { cn } from '../lib/utils'

const classes: Record<FamilyOfficeDataState, string> = {
  READY: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  PARTIAL: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  STALE: 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300',
  MISSING: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
  UNRECONCILED: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-300',
}

export function FamilyOfficeStateBadge({ state }: { state: FamilyOfficeDataState | null }) {
  const resolved = state ?? 'MISSING'
  const Icon = resolved === 'READY' ? CheckCircle2 : resolved === 'MISSING' ? AlertTriangle : resolved === 'STALE' ? Clock3 : CircleHelp
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-1 text-[9px] font-black uppercase', classes[resolved])}>
      <Icon size={11} />
      {resolved}
    </span>
  )
}
