"use client"

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Activity, Globe, Wallet, Settings } from 'lucide-react'

export function Sidebar() {
  const pathname = usePathname()

  const menuItems = [
    { name: 'Portfolio Matrix', icon: LayoutDashboard, href: '/' },
    { name: 'Macro Intelligence', icon: Activity, href: '/mdss' },
    { name: 'Geographic View', icon: Globe, href: '/geo' },
    { name: 'Currencies', icon: Wallet, href: '/fx' },
  ]

  return (
    <aside className="w-64 border-r border-slate-200 dark:border-[#1a1d24] bg-slate-50 dark:bg-[#080A0F] flex flex-col transition-colors">
      <div className="p-6">
        <div className="flex items-center gap-2 px-2">
          <div className="w-6 h-6 bg-[#00FF88] rounded-md flex items-center justify-center font-black text-black text-xs">Q</div>
          <span className="font-black tracking-tighter text-slate-900 dark:text-white uppercase">QuantTerminal</span>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {menuItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                isActive 
                  ? 'bg-[#00FF88]/10 text-[#00FF88] border border-[#00FF88]/20' 
                  : 'text-slate-500 dark:text-gray-500 hover:bg-slate-200 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <item.icon size={18} />
              {item.name}
            </Link>
          )
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-white/5">
        <button className="flex items-center gap-3 px-4 py-3 w-full text-slate-500 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white text-sm font-bold transition-colors">
          <Settings size={18} />
          Settings
        </button>
      </div>
    </aside>
  )
}