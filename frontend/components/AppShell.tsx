"use client"

import React, { useState } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { cn } from '../lib/utils'

interface AppShellProps {
  children: React.ReactNode
  lastSync?: string
  lastSyncIso?: string | null
  coveragePct?: number | null
  className?: string
  contentClassName?: string
}

export function AppShell({
  children,
  lastSync,
  lastSyncIso,
  coveragePct,
  className,
  contentClassName,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className={cn('min-h-screen bg-slate-100 text-slate-950 transition-colors duration-500 dark:bg-[#080A0F] dark:text-gray-300', className)}>
      <div className="min-h-screen md:flex">
        <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            lastSync={lastSync}
            lastSyncIso={lastSyncIso}
            coveragePct={coveragePct}
            onMenuClick={() => setMobileNavOpen(true)}
          />
          <div className={cn('min-w-0 flex-1', contentClassName)}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
