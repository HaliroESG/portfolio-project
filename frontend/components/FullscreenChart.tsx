"use client"

import React, { useEffect, useId, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import { cn } from '../lib/utils'

interface FullscreenChartButtonProps {
  title: string
  children: React.ReactNode
  className?: string
}

export function FullscreenChartButton({
  title,
  children,
  className,
}: FullscreenChartButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const titleId = useId()

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  return (
    <>
      <button
        type="button"
        aria-label={`Open ${title} fullscreen`}
        title="Fullscreen"
        onClick={() => setIsOpen(true)}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-white/10 dark:bg-black/20 dark:text-gray-400 dark:hover:text-white',
          className,
        )}
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-[90] bg-slate-950/85 p-3 backdrop-blur-sm md:p-6"
        >
          <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#080A0F]">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-white/10">
              <h2 id={titleId} className="text-xs font-black uppercase tracking-[0.2em] text-slate-950 dark:text-white">
                {title}
              </h2>
              <button
                type="button"
                aria-label="Close fullscreen chart"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:text-slate-950 dark:border-white/10 dark:bg-white/5 dark:text-gray-400 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
