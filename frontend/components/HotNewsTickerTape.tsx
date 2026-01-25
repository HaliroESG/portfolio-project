"use client"

import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ExternalLink } from 'lucide-react'
import { cn } from '../lib/utils'

interface NewsItem {
  id: string
  url: string
  title: string
  source: string
  category: string
  impact_level: string
  impact_score: number
  ticker: string | null
  published_at: string
}

export function HotNewsTickerTape() {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchNews() {
      try {
        const { data, error } = await supabase
          .from('news_feed')
          .select('*')
          .in('category', ['MACRO'])
          .or('impact_level.eq.HIGH,impact_score.gte.70')
          .order('published_at', { ascending: false })
          .limit(20)
        
        if (error) throw error
        if (data) {
          setNews(data)
        }
      } catch (err) {
        console.error('Error fetching news:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchNews()
    const interval = setInterval(fetchNews, 300000) // Refresh every 5 minutes
    return () => clearInterval(interval)
  }, [])

  if (loading || news.length === 0) {
    return null
  }

  const getImpactColor = (level: string) => {
    switch (level) {
      case 'HIGH':
        return 'text-red-400 dark:text-red-500'
      case 'MEDIUM':
        return 'text-amber-400 dark:text-amber-500'
      default:
        return 'text-slate-400 dark:text-gray-500'
    }
  }

  return (
    <div className="bg-slate-950 dark:bg-black border-b-2 border-[#00FF88]/20 overflow-hidden">
      <div className="flex items-center gap-4 py-2">
        <div className="flex items-center gap-2 px-4 flex-shrink-0">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-75"></div>
            <div className="relative w-2 h-2 rounded-full bg-red-500"></div>
          </div>
          <span className="text-[8px] font-black text-[#00FF88] uppercase tracking-[0.3em]">
            HOT NEWS
          </span>
        </div>
        
        <div className="flex-1 overflow-hidden relative">
          <div className="flex gap-8 whitespace-nowrap animate-marquee">
            {[...news, ...news].map((item, index) => (
              <div
                key={`${item.id}-${index}`}
                className="flex items-center gap-3 flex-shrink-0 group"
              >
                <span className={cn(
                  "text-[9px] font-black uppercase tracking-wider",
                  getImpactColor(item.impact_level)
                )}>
                  {item.impact_level}
                </span>
                <span className="text-[9px] font-mono text-slate-400 dark:text-gray-500">
                  [{item.source}]
                </span>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-bold text-white dark:text-gray-200 hover:text-[#00FF88] transition-colors line-clamp-1 max-w-md"
                >
                  {item.title}
                </a>
                {item.ticker && (
                  <span className="text-[9px] font-mono font-black text-[#00FF88] px-1.5 py-0.5 bg-[#00FF88]/10 rounded">
                    {item.ticker}
                  </span>
                )}
                <ExternalLink className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-px h-4 bg-slate-700"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
