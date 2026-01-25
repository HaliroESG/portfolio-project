"use client"

import React, { useState } from 'react'
import { cn } from '../lib/utils'

interface TooltipProps {
  children: React.ReactNode
  content: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tooltip({ children, content, side = 'top' }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)

  const sideClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          className={cn(
            "absolute z-50 px-2 py-1 text-[9px] font-mono text-white bg-slate-950 dark:bg-slate-800 rounded border border-slate-700 whitespace-nowrap shadow-xl",
            sideClasses[side]
          )}
        >
          {content}
          <div className={cn(
            "absolute w-0 h-0 border-4",
            side === 'top' && "top-full left-1/2 -translate-x-1/2 border-t-slate-950 dark:border-t-slate-800 border-l-transparent border-r-transparent border-b-transparent",
            side === 'bottom' && "bottom-full left-1/2 -translate-x-1/2 border-b-slate-950 dark:border-b-slate-800 border-l-transparent border-r-transparent border-t-transparent",
            side === 'left' && "left-full top-1/2 -translate-y-1/2 border-l-slate-950 dark:border-l-slate-800 border-t-transparent border-b-transparent border-r-transparent",
            side === 'right' && "right-full top-1/2 -translate-y-1/2 border-r-slate-950 dark:border-r-slate-800 border-t-transparent border-b-transparent border-l-transparent"
          )} />
        </div>
      )}
    </div>
  )
}
