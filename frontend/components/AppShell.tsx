"use client"

import React, { Suspense, useState } from 'react'
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
  contextLabel?: string
}

export function AppShell({
  children,
  lastSync,
  lastSyncIso,
  coveragePct,
  className,
  contentClassName,
  contextLabel,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className={cn('min-h-screen bg-[#f6f8f7] text-[#172d2b] dark:bg-[#080A0F] dark:text-gray-300', className)}>
      <a href="#app-content" className="sr-only z-[70] rounded-md bg-white p-3 text-emerald-900 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Aller au contenu</a>
      <div className="min-h-screen md:flex">
        <Suspense fallback={null}><Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} /></Suspense>
        <div className="flex min-w-0 flex-1 flex-col" inert={mobileNavOpen}>
          <Header
            lastSync={lastSync}
            lastSyncIso={lastSyncIso}
            coveragePct={coveragePct}
            onMenuClick={() => setMobileNavOpen(true)}
            menuOpen={mobileNavOpen}
            contextLabel={contextLabel}
          />
          <div id="app-content" tabIndex={-1} className={cn('min-w-0 flex-1 outline-none', contentClassName)}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
