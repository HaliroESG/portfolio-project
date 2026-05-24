"use client"

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Activity, Globe, Wallet, Settings, Target, LineChart, Layers, Filter, X } from 'lucide-react'
import { cn } from '../lib/utils'

interface SidebarProps {
  mobileOpen?: boolean
  onClose?: () => void
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname()

  const menuItems = [
    { name: 'Portfolio Matrix', icon: LayoutDashboard, href: '/' },
    { name: 'Macro Intelligence', icon: Activity, href: '/mdss' },
    { name: 'Geographic View', icon: Globe, href: '/geo' },
    { name: 'Currencies', icon: Wallet, href: '/fx' },
    { name: 'Trident Screener', icon: Filter, href: '/trident' },
    { name: 'Targets', icon: Target, href: '/targets' },
    { name: 'Backtest', icon: LineChart, href: '/backtest' },
    { name: 'Compare', icon: Layers, href: '/compare' },
  ]

  return (
    <>
      <button
        type="button"
        aria-label="Close navigation overlay"
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-50 bg-black/50 transition-opacity md:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-[60] flex h-dvh w-64 flex-col border-r border-slate-200 bg-slate-50 transition-transform dark:border-[#1a1d24] dark:bg-[#080A0F] md:sticky md:top-0 md:z-30 md:h-screen md:w-20 md:translate-x-0 xl:w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
      <div className="p-4 xl:p-6">
        <div className="flex items-center justify-between gap-2 px-2 md:justify-center xl:justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#00FF88] rounded-md flex items-center justify-center font-black text-black text-xs">Q</div>
            <span className="font-black tracking-tighter text-slate-900 dark:text-white uppercase md:hidden xl:inline">QuantTerminal</span>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/10 md:hidden"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1 md:px-3 xl:px-4">
        {menuItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onClose}
              title={item.name}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all md:justify-center md:px-0 xl:justify-start xl:px-4 ${
                isActive 
                  ? 'bg-[#00FF88]/10 text-[#00FF88] border border-[#00FF88]/20' 
                  : 'text-slate-500 dark:text-gray-500 hover:bg-slate-200 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <item.icon size={18} />
              <span className="md:hidden xl:inline">{item.name}</span>
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-white/5">
        <button className="flex items-center gap-3 px-4 py-3 w-full text-slate-500 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white text-sm font-bold transition-colors md:justify-center md:px-0 xl:justify-start xl:px-4">
          <Settings size={18} />
          <span className="md:hidden xl:inline">Settings</span>
        </button>
      </div>
    </aside>
    </>
  )
}
