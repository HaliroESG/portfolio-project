import type { ReactNode } from 'react'
import { ExternalLink, Info } from 'lucide-react'
import { finite, safeSourceUrl } from '../../lib/researchModel'

export const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-[#111820] dark:text-slate-200 dark:hover:bg-white/10'
export const input = 'min-h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:outline-2 focus:outline-emerald-700 dark:border-white/15 dark:bg-[#111820] dark:text-slate-200'
export const tableClass = 'w-full border-collapse text-left text-xs [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-3 [&_th]:font-semibold [&_th]:text-slate-600 [&_td]:border-b [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-3 dark:[&_th]:border-white/10 dark:[&_th]:bg-white/5 dark:[&_th]:text-slate-300 dark:[&_td]:border-white/10'
export const number = (value: unknown, digits = 1): string => finite(value) ? value.toLocaleString('fr-FR', { maximumFractionDigits: digits }) : '—'
export const percent = (value: unknown) => finite(value) ? `${number(value * 100)} %` : '—'
export const percentagePoints = (value: unknown) => finite(value) ? `${number(value)} %` : '—'
export const multiple = (value: unknown) => finite(value) ? `${number(value)} ×` : '—'
export const money = (value: unknown, currency?: string | null) => {
  if (!finite(value)) return '—'
  const unit = Math.abs(value) >= 1e9 ? 1e9 : Math.abs(value) >= 1e6 ? 1e6 : 1
  return `${number(value / unit, unit === 1 ? 2 : 1)}${unit === 1e9 ? ' Md' : unit === 1e6 ? ' M' : ''} ${currency ?? '(devise non attestée)'}`
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'danger' | 'positive' }) {
  const palette = tone === 'danger' ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200' : tone === 'warning' ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : tone === 'positive' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'
  return <span className={`inline-flex rounded px-2 py-1 text-[11px] font-semibold leading-relaxed ${palette}`}>{children}</span>
}
export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <div role={danger ? 'alert' : undefined} className={`flex items-start gap-2 rounded-md border px-4 py-3 text-xs leading-relaxed ${danger ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200' : 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200'}`}><Info size={15} className="mt-0.5 shrink-0" /><div>{children}</div></div>
}
export function Panel({ title, note, children, action }: { title: string; note?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="min-w-0 rounded-lg border border-[#e1e8e5] bg-white dark:border-white/10 dark:bg-[#0e141b]">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/10"><div><h3 className="text-sm font-semibold">{title}</h3>{note && <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{note}</p>}</div>{action}</div>
    <div className="p-5">{children}</div>
  </section>
}
export function SourceLink({ url, children = 'Source' }: { url: string | null | undefined; children?: ReactNode }) {
  const safe = safeSourceUrl(url)
  return safe ? <a href={safe} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded text-xs font-semibold text-emerald-800 underline underline-offset-4 dark:text-emerald-300">{children}<ExternalLink size={12} aria-label="Nouvel onglet" /></a> : <span className="text-xs text-slate-500">Lien source absent</span>
}
export function Score({ value, large = false }: { value: number | null; large?: boolean }) {
  return <div className={large ? 'w-full max-w-40' : 'w-24'}>
    <div className={`font-semibold tabular-nums ${large ? 'text-3xl' : 'text-sm'}`}>{number(value, 0)}<span className="ml-1 text-[11px] font-normal text-slate-500">/ 100</span></div>
    <div aria-hidden="true" className="mt-1.5 h-1 overflow-hidden rounded bg-slate-100 dark:bg-white/10"><div className="h-full rounded bg-[#087d64] dark:bg-emerald-400" style={{ width: `${value ?? 0}%` }} /></div>
    {value === null && <span className="text-[10px] text-slate-500">Non disponible</span>}
  </div>
}
export function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="min-w-0"><dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt><dd className="mt-1 break-words font-semibold tabular-nums">{value}</dd>{note && <dd className="mt-1 break-words text-[11px] text-slate-500 dark:text-slate-400">{note}</dd>}</div>
}
