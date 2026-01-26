"use client"

import React from 'react'
import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { DataStatus } from '../types'
import { Tooltip } from './Tooltip'
import { cn } from '../lib/utils'

interface DataTrustBadgeProps {
  status?: DataStatus | null
  lastUpdate?: string | null
}

export function DataTrustBadge({ status, lastUpdate }: DataTrustBadgeProps) {
  // Default to LOW_CONFIDENCE if status is missing
  const dataStatus = status || 'LOW_CONFIDENCE'
  
  // Format last update date
  const formatLastUpdate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return 'Unknown'
    try {
      const date = new Date(dateStr)
      return date.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return 'Unknown'
    }
  }

  const tooltipContent = (
    <div className="space-y-1">
      <div className="font-bold">Source: Yahoo Finance</div>
      <div className="text-xs">Last update: {formatLastUpdate(lastUpdate)}</div>
      {dataStatus === 'STALE' && (
        <div className="text-xs text-amber-400">Price &gt; 5 days old</div>
      )}
      {dataStatus === 'LOW_CONFIDENCE' && (
        <div className="text-xs text-red-400">Data incomplete</div>
      )}
      {dataStatus === 'PARTIAL' && (
        <div className="text-xs text-red-400">Data incomplete</div>
      )}
    </div>
  )

  // Render based on status
  if (dataStatus === 'OK') {
    return (
      <Tooltip content={tooltipContent} side="top">
        <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded cursor-help">
          <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-400" />
        </div>
      </Tooltip>
    )
  }

  if (dataStatus === 'STALE') {
    return (
      <Tooltip content={tooltipContent} side="top">
        <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded cursor-help">
          <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
        </div>
      </Tooltip>
    )
  }

  // LOW_CONFIDENCE or PARTIAL
  return (
    <Tooltip content={tooltipContent} side="top">
      <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded cursor-help">
        <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400" />
      </div>
    </Tooltip>
  )
}
