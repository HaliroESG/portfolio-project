"use client"

import React, { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  Activity,
  AreaChart,
  BriefcaseBusiness,
  CalendarClock,
  ClipboardCheck,
  FileClock,
  Filter,
  Globe,
  Landmark,
  Layers,
  Library,
  ListChecks,
  Scale,
  Settings,
  SlidersHorizontal,
  Target,
  Wallet,
  X,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { isNavigationActive } from '../lib/navigation'

interface SidebarProps {
  mobileOpen?: boolean
  onClose?: () => void
}
const groups = [
  {
    label: 'Piloter',
    items: [
      { name: 'Vue d’ensemble', icon: Landmark, href: '/' },
      { name: 'Portefeuilles', icon: BriefcaseBusiness, href: '/portfolios' },
      { name: 'Marchés & macro', icon: Activity, href: '/mdss' },
      { name: 'Géographie', icon: Globe, href: '/geo' },
      { name: 'Devises', icon: Wallet, href: '/fx' },
    ],
  },
  {
    label: 'Décider',
    items: [
      { name: 'Arbitrage', icon: Scale, href: '/arbitrage' },
      { name: 'Journal', icon: ClipboardCheck, href: '/decisions' },
      { name: 'Allocations cibles', icon: Target, href: '/targets' },
    ],
  },
  {
    label: 'Rechercher',
    items: [
      { name: 'Screener & Top Quality', icon: Filter, href: '/research' },
      { name: 'Publications', icon: CalendarClock, href: '/publications' },
      { name: 'Supports', icon: Library, href: '/supports' },
      { name: 'Backtests', icon: AreaChart, href: '/backtest' },
      { name: 'Comparaisons', icon: Layers, href: '/compare' },
    ],
  },
  {
    label: 'Fiabiliser',
    items: [
      { name: 'Boîte de contrôle', icon: ListChecks, href: '/operations' },
      { name: 'Clôtures', icon: FileClock, href: '/operations?view=closes' },
    ],
  },
]

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname()
  const search = useSearchParams()
  const panel = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.activeElement as HTMLElement | null
    const media = window.matchMedia('(min-width: 768px)')
    const resize = () => { if (media.matches) close.current?.() }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('a,button')?.focus()
    media.addEventListener('change', resize)
    resize()
    return () => {
      document.body.style.overflow = overflow
      media.removeEventListener('change', resize)
      previous?.focus()
    }
  }, [mobileOpen])

  return (
    <>
      {mobileOpen && <button
        type="button"
        aria-label="Fermer le volet de navigation"
        onClick={onClose}
        tabIndex={-1}
        className="fixed inset-0 z-50 bg-black/50 md:hidden"
      />}
      <aside id="app-navigation" ref={panel} aria-label="Navigation principale" role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined}
        onKeyDown={(event) => {
          if (!mobileOpen) return
          if (event.key === 'Escape') { event.preventDefault(); onClose?.() }
          if (event.key === 'Tab') {
            const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('a,button,summary') ?? []).filter(el => el.getClientRects().length)
            const first = focusable[0], last = focusable.at(-1)
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }
        }}
        className={cn('fixed inset-y-0 left-0 z-[60] flex h-dvh w-64 flex-col border-r border-[#e1e8e5] bg-white dark:border-[#1a1d24] dark:bg-[#080A0F] md:visible md:sticky md:top-0 md:z-30 md:h-screen md:w-20 md:translate-x-0 xl:w-56', mobileOpen ? 'visible translate-x-0' : 'invisible -translate-x-full')}>
        <div className="border-b border-slate-200 p-4 dark:border-white/5 xl:px-5 xl:py-5">
          <div className="flex items-center justify-between gap-2 px-1 md:justify-center xl:justify-between">
            <Link href="/" onClick={onClose} className="flex min-w-0 items-center gap-2" title="Portfolio Office">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-400 font-black text-slate-950">P</div>
              <div className="min-w-0 md:hidden xl:block">
                <div className="truncate text-sm font-black text-slate-950 dark:text-white">Portfolio Office</div>
                <div className="text-[9px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Astrocyte</div>
              </div>
            </Link>
            <button type="button" aria-label="Fermer la navigation" onClick={onClose} className="rounded-md border border-slate-200 p-2 text-slate-500 dark:border-white/10 md:hidden"><X size={15} /></button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {[groups[0], groups[2], groups[1], groups[3]].map((group) => (
            <section key={group.label} className="mb-4">
              <div className="mb-1 px-3 text-[8px] font-black uppercase text-slate-400 md:hidden xl:block">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = isNavigationActive(pathname, search.toString(), item.href)
                  return (
                    <Link
                      key={`${group.label}-${item.name}`}
                      href={item.href}
                      onClick={onClose}
                      title={item.name}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex h-10 items-center gap-3 rounded-md px-3 text-xs font-bold transition md:justify-center md:px-0 xl:justify-start xl:px-3',
                        isActive
                          ? 'bg-[#e8f4ef] text-[#087d64] dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'text-slate-500 hover:bg-slate-200 hover:text-slate-950 dark:text-gray-500 dark:hover:bg-white/5 dark:hover:text-white'
                      )}
                    >
                      <item.icon size={16} className="shrink-0" />
                      <span className="truncate md:hidden xl:block">{item.name}</span>
                    </Link>
                  )
                })}
              </div>
            </section>
          ))}
          <details className="border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-white/10" open={pathname === '/trident' || pathname === '/screener' || undefined}>
            <summary title="Vues historiques conservées" className="cursor-pointer px-2 py-2"><span className="md:hidden xl:inline">Vues historiques</span><SlidersHorizontal size={16} className="hidden md:inline xl:hidden" /></summary>
            <Link href="/trident" onClick={onClose} aria-current={pathname === '/trident' ? 'page' : undefined} title="Trident historique" className="block rounded p-2 hover:bg-slate-100 dark:hover:bg-white/5">Trident</Link>
            <Link href="/screener" onClick={onClose} aria-current={pathname === '/screener' ? 'page' : undefined} title="Screener historique" className="block rounded p-2 hover:bg-slate-100 dark:hover:bg-white/5">Screener</Link>
          </details>
        </nav>

        <div className="border-t border-slate-200 p-3 dark:border-white/5">
          <Link href="/admin" onClick={onClose} title="Administration" className="flex h-10 items-center gap-3 rounded-md px-3 text-xs font-bold text-slate-500 transition hover:bg-slate-200 hover:text-slate-950 dark:text-gray-500 dark:hover:bg-white/5 dark:hover:text-white md:justify-center md:px-0 xl:justify-start xl:px-3">
            <Settings size={16} />
            <span className="md:hidden xl:block">Administration</span>
          </Link>
        </div>
      </aside>
    </>
  )
}
