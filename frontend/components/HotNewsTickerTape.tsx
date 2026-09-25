"use client"

import React from 'react'
import useSWR from 'swr'
import { supabase } from '../lib/supabase'
import { ExternalLink } from 'lucide-react'
import { cn } from '../lib/utils'
import { Tooltip } from './Tooltip'
import { NewsFeedRow } from '../types'
import { swrOptions, SWR_REFRESH } from '../lib/swrConfig'

function formatPublishedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

export function HotNewsTickerTape() {
  const { data, isLoading } = useSWR(
    'hot-news',
    async () => {
      const { data: rows, error } = await supabase
        .from('news_feed')
        .select('id,url,title,source,category,impact_level,impact_score,impact_explanation,ticker,published_at')
        .or('category.eq.MACRO,impact_level.eq.HIGH')
        .order('published_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return (rows ?? []) as NewsFeedRow[]
    },
    swrOptions(SWR_REFRESH.SLOW)
  )

  // Protection contre undefined/null
  const safeNews = data || []

  if (isLoading || safeNews.length === 0) {
    return null
  }

  return (
    <div className="border-b border-slate-200 bg-white/90 dark:border-white/10 dark:bg-[#0B0E14]/95">
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:px-5 lg:flex-row lg:items-center lg:px-6">
        <div className="flex shrink-0 items-center gap-2 lg:w-32">
          <div className="h-2 w-2 rounded-full bg-amber-500" />
          <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600 dark:text-gray-300">
            Market News
          </span>
        </div>

        <div className="relative min-w-0 flex-1 overflow-x-auto">
          <div className="flex snap-x snap-mandatory items-stretch gap-2 pr-2">
            {safeNews.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex min-w-[270px] max-w-[360px] snap-start flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700 transition-colors hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-white/20 dark:hover:bg-white/[0.06] sm:min-w-[320px]"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Tooltip
                    content={item.impact_explanation || `Impact Level: ${item.impact_level}`}
                    side="top"
                  >
                    {item.impact_level === 'HIGH' ? (
                      <span className="cursor-help rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/20 dark:text-amber-300">
                        HIGH
                      </span>
                    ) : (
                      <span className={cn(
                        "cursor-help text-[9px] font-black uppercase tracking-wider",
                        item.impact_level === 'MEDIUM' ? 'text-slate-600 dark:text-gray-300' : 'text-slate-400 dark:text-gray-500'
                      )}>
                        {item.impact_level}
                      </span>
                    )}
                  </Tooltip>

                  <span className="min-w-0 truncate text-[10px] font-mono font-bold uppercase text-slate-500 dark:text-gray-500">
                    {item.source}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] font-mono text-slate-400 dark:text-gray-600">
                    {formatPublishedAt(item.published_at)}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400 opacity-70 transition-opacity group-hover:opacity-100" />
                </div>
                <span className="line-clamp-2 text-xs font-semibold leading-4 text-slate-800 dark:text-gray-200">
                  {item.title}
                </span>
                {item.ticker && (
                  <span className="self-start rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-mono font-black text-slate-600 dark:border-white/10 dark:bg-black/20 dark:text-gray-300">
                    {item.ticker}
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
