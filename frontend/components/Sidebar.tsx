"use client"

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
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

interface SidebarProps {
  mobileOpen?: boolean
  onClose?: () => void
}
const groups = [
  {
    label: 'Pilotage',
    items: [
      { name: 'Vue d’ensemble', icon: Landmark, href: '/' },
      { name: 'Portefeuilles', icon: BriefcaseBusiness, href: '/portfolios' },
    ],
  },
  {
    label: 'Décisions',
    items: [
      { name: 'Arbitrage', icon: Scale, href: '/arbitrage' },
      { name: 'Journal', icon: ClipboardCheck, href: '/decisions' },
      { name: 'Allocations cibles', icon: Target, href: '/targets' },
    ],
  },
  {
    label: 'Recherche',
    items: [
      { name: 'Macro', icon: Activity, href: '/mdss' },
      { name: 'Trident', icon: Filter, href: '/trident' },
      { name: 'Screener', icon: SlidersHorizontal, href: '/screener' },
      { name: 'Publications', icon: CalendarClock, href: '/publications' },
      { name: 'Supports', icon: Library, href: '/supports' },
      { name: 'Géographie', icon: Globe, href: '/geo' },
      { name: 'Devises', icon: Wallet, href: '/fx' },
      { name: 'Backtests', icon: AreaChart, href: '/backtest' },
      { name: 'Comparaisons', icon: Layers, href: '/compare' },
    ],
  },
  {
    label: 'Opérations',
    items: [
      { name: 'Boîte de contrôle', icon: ListChecks, href: '/operations' },
      { name: 'Clôtures', icon: FileClock, href: '/operations?view=closes' },
    ],
  },
]

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname()

  return (
    <>
      <button
        type="button"
        aria-label="Fermer le volet de navigation"
        onClick={onClose}
        className={cn('fixed inset-0 z-50 bg-black/50 transition-opacity md:hidden', mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <aside className={cn('fixed inset-y-0 left-0 z-[60] flex h-dvh w-64 flex-col border-r border-slate-200 bg-slate-50 transition-transform dark:border-[#1a1d24] dark:bg-[#080A0F] md:sticky md:top-0 md:z-30 md:h-screen md:w-20 md:translate-x-0 xl:w-64', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="border-b border-slate-200 p-4 dark:border-white/5 xl:px-5 xl:py-5">
          <div className="flex items-center justify-between gap-2 px-1 md:justify-center xl:justify-between">
            <Link href="/" onClick={onClose} className="flex min-w-0 items-center gap-2" title="Portfolio Office">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-400 font-black text-slate-950">P</div>
              <div className="min-w-0 md:hidden xl:block">
                <div className="truncate text-sm font-black text-slate-950 dark:text-white">Portfolio Office</div>
                <div className="text-[8px] font-black uppercase text-slate-500">Private wealth</div>
              </div>
            </Link>
            <button type="button" aria-label="Fermer la navigation" onClick={onClose} className="rounded-md border border-slate-200 p-2 text-slate-500 dark:border-white/10 md:hidden"><X size={15} /></button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {groups.map((group) => (
            <section key={group.label} className="mb-4">
              <div className="mb-1 px-3 text-[8px] font-black uppercase text-slate-400 md:hidden xl:block">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const itemPath = item.href.split('?')[0]
                  const isActive = itemPath === '/' ? pathname === '/' : pathname.startsWith(itemPath)
                  return (
                    <Link
                      key={`${group.label}-${item.name}`}
                      href={item.href}
                      onClick={onClose}
                      title={item.name}
                      className={cn(
                        'flex h-10 items-center gap-3 rounded-md px-3 text-xs font-bold transition md:justify-center md:px-0 xl:justify-start xl:px-3',
                        isActive
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
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
