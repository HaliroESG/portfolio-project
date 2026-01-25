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
          .or('category.eq.MACRO,impact_level.eq.HIGH')
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

  // Protection contre undefined/null
  const safeNews = news || []
  
  if (loading || safeNews.length === 0) {
    return null
  }

  return (
    <div className="bg-[#020617] border-b border-emerald-400/20 overflow-hidden">
      <div className="flex items-center gap-4 py-2">
        <div className="flex items-center gap-2 px-4 flex-shrink-0">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-75"></div>
            <div className="relative w-2 h-2 rounded-full bg-red-500"></div>
          </div>
          <span className="text-[8px] font-mono font-black text-emerald-400 uppercase tracking-[0.3em]">
            HOT NEWS
          </span>
        </div>
        
        <div className="flex-1 overflow-hidden relative">
          <div className="flex gap-8 whitespace-nowrap animate-marquee" style={{ width: 'max-content' }}>
            {[...safeNews, ...safeNews].map((item, index) => (
              <div
                key={`${item.id}-${index}`}
                className="flex items-center gap-3 flex-shrink-0 group"
              >
                {/* Badge rouge pulsant pour HIGH IMPACT */}
                {item.impact_level === 'HIGH' ? (
                  <div className="relative flex items-center gap-1.5">
                    <div className="absolute inset-0 rounded-full bg-rose-500 animate-ping opacity-75"></div>
                    <span className="relative text-[9px] font-mono font-black text-rose-500 uppercase tracking-wider px-1.5 py-0.5 bg-rose-500/10 rounded border border-rose-500/30">
                      HIGH
                    </span>
                  </div>
                ) : (
                  <span className={cn(
                    "text-[9px] font-mono font-black uppercase tracking-wider",
                    item.impact_level === 'MEDIUM' ? 'text-amber-400' : 'text-slate-400'
                  )}>
                    {item.impact_level}
                  </span>
                )}
                <span className="text-[9px] font-mono text-emerald-400/60">
                  [{item.source}]
                </span>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "text-[10px] font-mono font-bold line-clamp-1 max-w-md transition-colors",
                    item.impact_level === 'HIGH' 
                      ? "text-rose-500 hover:text-rose-400" 
                      : "text-emerald-400 hover:text-emerald-300"
                  )}
                >
                  {item.title}
                </a>
                {item.ticker && (
                  <span className="text-[9px] font-mono font-black text-emerald-400 px-1.5 py-0.5 bg-emerald-400/10 rounded border border-emerald-400/20">
                    {item.ticker}
                  </span>
                )}
                <ExternalLink className="w-3 h-3 text-emerald-400/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-px h-4 bg-emerald-400/20"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
