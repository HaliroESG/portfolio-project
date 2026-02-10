"use client"

import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TrendingUp, TrendingDown, AlertCircle, HelpCircle } from 'lucide-react'
import { Tooltip } from './Tooltip'

interface MacroIndicator {
  id: string
  name: string
  value: number | null
  change_pct: number | null
  last_update: string | null
}

const MACRO_CONFIG: Record<string, { 
  label: string
  format: (v: number) => string
  threshold: number
  tooltip: string
}> = {
  '^VIX': { 
    label: 'VIX', 
    format: (v) => v.toFixed(2), 
    threshold: 20,
    tooltip: 'CBOE Volatility Index: Measures market fear. >20 = High Risk'
  },
  'DX-Y.NYB': { 
    label: 'DXY', 
    format: (v) => v.toFixed(2), 
    threshold: 105,
    tooltip: 'US Dollar Index: Strength of USD vs basket. >105 = Strong Dollar'
  },
  '^MOVE': { 
    label: 'MOVE', 
    format: (v) => v.toFixed(2), 
    threshold: 100,
    tooltip: 'Merrill Lynch Option Volatility Estimate: Bond market volatility'
  },
  '^TNX': { 
    label: '10Y', 
    format: (v) => v.toFixed(2) + '%', 
    threshold: 4.5,
    tooltip: '10-Year Treasury Yield: Long-term interest rate benchmark'
  },
}

export function MacroStrip() {
  const [indicators, setIndicators] = useState<MacroIndicator[]>([])

  // Define getIndicator function first to avoid hoisting issues
  const getIndicator = (id: string): MacroIndicator | undefined => {
    return indicators.find(i => i.id === id)
  }

  useEffect(() => {
    async function fetchMacro() {
      try {
        const { data, error } = await supabase
          .from('macro_indicators')
          .select('*')
          .in('id', ['^VIX', 'DX-Y.NYB', '^MOVE', '^TNX', 'SPREAD_10Y_2Y', 'MISERY_INDEX', 'JPY_VOLATILITY'])
        
        if (error) throw error
        if (data) {
          setIndicators(data)
        }
      } catch (err) {
        console.error('Error fetching macro indicators:', err)
      }
    }

    fetchMacro()
    const interval = setInterval(fetchMacro, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [])

  // Calculate Yield Spread (10Y - 2Y)
  const yieldSpread = (() => {
    return getIndicator('SPREAD_10Y_2Y')?.value ?? null
  })()
  const miseryIndex = getIndicator('MISERY_INDEX')?.value ?? null
  const jpyVolatility = getIndicator('JPY_VOLATILITY')?.value ?? null

  const getTrendColor = (indicator: MacroIndicator | undefined, config: typeof MACRO_CONFIG[string]): string => {
    if (!indicator || indicator.value === null) return 'text-slate-400'
    
    const value = indicator.value
    const change = indicator.change_pct ?? 0
    
    // VIX: Red if > 20, amber if > 15
    if (indicator.id === '^VIX') {
      if (value >= 20) return 'text-red-500'
      if (value >= 15) return 'text-amber-500'
      return change >= 0 ? 'text-red-400' : 'text-green-400'
    }
    
    // DXY: Red if > 105
    if (indicator.id === 'DX-Y.NYB') {
      if (value >= config.threshold) return 'text-red-500'
      return change >= 0 ? 'text-green-400' : 'text-red-400'
    }
    
    // MOVE: Red if > 100
    if (indicator.id === '^MOVE') {
      if (value >= config.threshold) return 'text-red-500'
      return change >= 0 ? 'text-red-400' : 'text-green-400'
    }
    
    // 10Y: Red if > 4.5%
    if (indicator.id === '^TNX') {
      if (value >= config.threshold) return 'text-red-500'
      return change >= 0 ? 'text-green-400' : 'text-red-400'
    }
    
    return change >= 0 ? 'text-green-400' : 'text-red-400'
  }

  const getTrendIcon = (indicator: MacroIndicator | undefined) => {
    if (!indicator || indicator.change_pct === null) return null
    const change = indicator.change_pct
    if (change > 0.001) {
      return <TrendingUp className="w-3 h-3 text-red-400" />
    } else if (change < -0.001) {
      return <TrendingDown className="w-3 h-3 text-green-400" />
    }
    return null
  }

  return (
    <div className="bg-white dark:bg-slate-950 border-b-2 border-slate-200 dark:border-slate-800 px-4 py-2">
      <div className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-2">
          <span className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.3em]">MACRO</span>
        </div>
        
        <div className="flex items-center gap-4 flex-1 justify-center overflow-x-auto">
          {(['^VIX', 'DX-Y.NYB', '^MOVE', '^TNX'] as const).map((id) => {
            const indicator = getIndicator(id)
            const config = MACRO_CONFIG[id]
            const value = indicator?.value ?? null
            const change = indicator?.change_pct ?? null
            
            return (
              <div key={id} className="flex items-center gap-3 flex-shrink-0">
                <Tooltip content={config.tooltip} side="bottom">
                  <div className="flex items-center gap-1.5">
                    {/* Pulsing Live Dot */}
                    <div className="relative flex-shrink-0">
                      <div className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-75"></div>
                      <div className="relative w-1.5 h-1.5 rounded-full bg-green-500"></div>
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[7px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                          {config.label}
                        </span>
                        <HelpCircle className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500 cursor-help" />
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className={`text-sm font-mono font-black ${getTrendColor(indicator, config)}`}>
                          {value !== null ? config.format(value) : '--'}
                        </span>
                        {getTrendIcon(indicator)}
                        {change !== null && (
                          <span className={`text-[8px] font-mono font-bold ${change >= 0 ? 'text-red-500 dark:text-red-400' : 'text-green-500 dark:text-green-400'}`}>
                            {change >= 0 ? '+' : ''}{(change * 100).toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Tooltip>
                <div className="w-px h-6 bg-slate-300 dark:bg-slate-700" />
              </div>
            )
          })}

          {/* Yield Spread (10Y-2Y) */}
          <Tooltip content="10Y-2Y Yield Spread: Inversion (<0) signals recession risk" side="bottom">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-75"></div>
                <div className="relative w-1.5 h-1.5 rounded-full bg-green-500"></div>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1">
                  <span className="text-[7px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    SPREAD
                  </span>
                  <HelpCircle className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500 cursor-help" />
                </div>
                <span className={`text-sm font-mono font-black ${yieldSpread !== null && yieldSpread < 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-950 dark:text-white'}`}>
                  {yieldSpread !== null ? `${yieldSpread >= 0 ? '+' : ''}${yieldSpread.toFixed(2)}%` : '--'}
                </span>
              </div>
            </div>
          </Tooltip>
          <div className="w-px h-6 bg-slate-300 dark:bg-slate-700" />

          {/* Misery Index */}
          <Tooltip content="Misery Index: Inflation + Unemployment. Higher = Economic distress" side="bottom">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-75"></div>
                <div className="relative w-1.5 h-1.5 rounded-full bg-green-500"></div>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1">
                  <span className="text-[7px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    MISERY
                  </span>
                  <HelpCircle className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500 cursor-help" />
                </div>
                <span className={`text-sm font-mono font-black ${miseryIndex !== null && miseryIndex > 7 ? 'text-red-500 dark:text-red-400' : 'text-slate-950 dark:text-white'}`}>
                  {miseryIndex !== null ? miseryIndex.toFixed(1) : '--'}
                </span>
              </div>
            </div>
          </Tooltip>
          <div className="w-px h-6 bg-slate-300 dark:bg-slate-700" />

          {/* JPY Monitoring */}
          <Tooltip content="JPY/USD Volatility: High volatility = Carry Trade Risk" side="bottom">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-75"></div>
                <div className="relative w-1.5 h-1.5 rounded-full bg-green-500"></div>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1">
                  <span className="text-[7px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    JPY
                  </span>
                  <HelpCircle className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500 cursor-help" />
                </div>
                <span className={`text-sm font-mono font-black ${jpyVolatility !== null && jpyVolatility > 1.5 ? 'text-amber-500 dark:text-amber-400' : 'text-slate-950 dark:text-white'}`}>
                  {jpyVolatility !== null ? `${jpyVolatility.toFixed(1)}%` : '--'}
                </span>
              </div>
            </div>
          </Tooltip>
        </div>
        
        <div className="flex items-center gap-2">
          {indicators.some(i => i.value !== null && i.id === '^VIX' && i.value >= 20) && (
            <div className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 dark:bg-red-500/20 border border-red-500/30 dark:border-red-500/50 rounded">
              <AlertCircle className="w-2.5 h-2.5 text-red-500 dark:text-red-400" />
              <span className="text-[8px] font-black text-red-500 dark:text-red-400 uppercase">RISK</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
