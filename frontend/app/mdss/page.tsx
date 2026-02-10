"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { MacroHealth } from '../../components/MacroHealth'

import {
  Activity,
  TrendingUp,
  Droplets,
  ShieldAlert,
  BarChart3
} from 'lucide-react'

type PillarStatus = 'red' | 'amber' | 'green'

interface MacroIndicator {
  id: string
  name: string | null
  value: number | null
  change_pct: number | null
  last_update: string | null
}

interface PillarIndicator {
  label: string
  value: string
  trend?: 'UP' | 'DOWN'
  change?: string
}

interface MacroPillarProps {
  title: string
  subtitle: string
  icon: React.ComponentType<{ size?: number }>
  status: PillarStatus
  indicators: PillarIndicator[]
}

function formatValue(value: number | null, decimals = 2, suffix = ''): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value.toFixed(decimals)}${suffix}`
}

function formatChange(changePct: number | null): { trend?: 'UP' | 'DOWN'; change?: string } {
  if (changePct === null || Number.isNaN(changePct)) return {}
  return {
    trend: changePct >= 0 ? 'UP' : 'DOWN',
    change: `${changePct >= 0 ? '+' : ''}${(changePct * 100).toFixed(2)}%`
  }
}

function MacroPillar({ title, subtitle, icon: Icon, status, indicators }: MacroPillarProps) {
  const statusColors = {
    red: "border-red-500/50 bg-red-50/50 text-red-700 dark:bg-red-950/20 dark:text-red-500 dark:border-red-500/30",
    amber: "border-amber-500/50 bg-amber-50/50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-500 dark:border-amber-500/30",
    green: "border-green-500/50 bg-green-50/50 text-green-700 dark:bg-green-950/20 dark:text-green-500 dark:border-green-500/30"
  }

  return (
    <div className={`p-6 rounded-3xl border-2 shadow-xl shadow-slate-200/50 dark:shadow-none transition-all duration-500 ${statusColors[status]}`}>
      <div className="flex justify-between items-start mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-current/10">
            <Icon size={24} />
          </div>
          <div>
            <h3 className="text-xl font-black uppercase tracking-tighter leading-none">{title}</h3>
            <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest mt-1">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="w-3 h-3 rounded-full bg-current animate-pulse shadow-[0_0_12px_currentColor]"></div>
          <span className="text-[9px] font-black mt-2 uppercase tracking-tighter">Status: {status}</span>
        </div>
      </div>
      
      <div className="space-y-3">
        {indicators.map((ind) => (
          <div key={ind.label} className="flex justify-between items-center border-b border-current/10 pb-2 group hover:border-current/30 transition-colors">
            <span className="text-[11px] font-bold opacity-70 uppercase tracking-wider">{ind.label}</span>
            <div className="text-right">
              <div className="font-mono font-black text-sm">{ind.value}</div>
              {ind.trend && ind.change && (
                 <div className={`text-[9px] font-bold ${ind.trend === 'UP' ? 'text-green-500' : 'text-red-500'}`}>
                    {ind.trend === 'UP' ? '▲' : '▼'} {ind.change}
                 </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MDSSPage() {
  const [indicators, setIndicators] = useState<MacroIndicator[]>([])

  useEffect(() => {
    async function fetchMacroIndicators() {
      try {
        const { data, error } = await supabase.from('macro_indicators').select('id, name, value, change_pct, last_update')
        if (error) throw error
        setIndicators((data ?? []) as MacroIndicator[])
      } catch (err) {
        console.error('Error fetching MDSS macro data:', err)
      }
    }

    fetchMacroIndicators()
    const interval = setInterval(fetchMacroIndicators, 60000)
    return () => clearInterval(interval)
  }, [])

  const indicatorMap = useMemo(() => {
    const map = new Map<string, MacroIndicator>()
    indicators.forEach((indicator) => map.set(indicator.id, indicator))
    return map
  }, [indicators])

  const lastSync = useMemo(() => {
    const latest = indicators
      .map((indicator) => indicator.last_update)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
    return latest ? new Date(latest).toLocaleTimeString('fr-FR') : ''
  }, [indicators])

  const get = (id: string) => indicatorMap.get(id)

  const vix = get('^VIX')?.value ?? null
  const spread = get('SPREAD_10Y_2Y')?.value ?? null
  const misery = get('MISERY_INDEX')?.value ?? null
  const tnx = get('^TNX')?.value ?? null
  const dxy = get('DX-Y.NYB')?.value ?? null
  const move = get('^MOVE')?.value ?? null
  const jpyVol = get('JPY_VOLATILITY')?.value ?? null

  const growthStatus: PillarStatus =
    (spread !== null && spread < 0) || (vix !== null && vix >= 22) ? 'red' :
    (spread !== null && spread < 0.5) || (vix !== null && vix >= 16) ? 'amber' : 'green'

  const inflationStatus: PillarStatus =
    (misery !== null && misery >= 8) || (tnx !== null && tnx >= 4.7) ? 'red' :
    (misery !== null && misery >= 6.8) || (tnx !== null && tnx >= 4.1) ? 'amber' : 'green'

  const liquidityStatus: PillarStatus =
    (dxy !== null && dxy >= 105) || (move !== null && move >= 110) || (jpyVol !== null && jpyVol >= 1.8) ? 'red' :
    (dxy !== null && dxy >= 102) || (move !== null && move >= 95) || (jpyVol !== null && jpyVol >= 1.3) ? 'amber' : 'green'

  const growthIndicators: PillarIndicator[] = [
    {
      label: '10Y-2Y Spread',
      value: formatValue(spread, 2, '%'),
      ...formatChange(get('SPREAD_10Y_2Y')?.change_pct ?? null),
    },
    {
      label: 'VIX',
      value: formatValue(vix, 2),
      ...formatChange(get('^VIX')?.change_pct ?? null),
    },
    {
      label: 'Bitcoin Proxy',
      value: formatValue(get('BTC-USD')?.value ?? null, 0),
      ...formatChange(get('BTC-USD')?.change_pct ?? null),
    }
  ]

  const inflationIndicators: PillarIndicator[] = [
    {
      label: 'Misery Index',
      value: formatValue(misery, 1),
      ...formatChange(get('MISERY_INDEX')?.change_pct ?? null),
    },
    {
      label: 'US 10Y Yield',
      value: formatValue(tnx, 2, '%'),
      ...formatChange(get('^TNX')?.change_pct ?? null),
    },
    {
      label: 'Gold (GC=F)',
      value: formatValue(get('GC=F')?.value ?? null, 0),
      ...formatChange(get('GC=F')?.change_pct ?? null),
    }
  ]

  const liquidityIndicators: PillarIndicator[] = [
    {
      label: 'DXY Dollar Index',
      value: formatValue(dxy, 2),
      ...formatChange(get('DX-Y.NYB')?.change_pct ?? null),
    },
    {
      label: 'MOVE Index',
      value: formatValue(move, 2),
      ...formatChange(get('^MOVE')?.change_pct ?? null),
    },
    {
      label: 'JPY Volatility',
      value: formatValue(jpyVol, 2, '%'),
      ...formatChange(get('JPY_VOLATILITY')?.change_pct ?? null),
    }
  ]

  const tacticalSignal =
    growthStatus === 'red' || inflationStatus === 'red' || liquidityStatus === 'red'
      ? 'Conditions restrictives détectées: réduire le risque directionnel, privilégier la qualité et conserver un buffer de cash.'
      : growthStatus === 'amber' || inflationStatus === 'amber' || liquidityStatus === 'amber'
        ? 'Régime mixte: maintenir une allocation diversifiée et surveiller le spread 10Y-2Y et le dollar.'
        : 'Régime globalement stable: conserver la stratégie de rebalancing avec suivi hebdomadaire des signaux.'

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#080A0F] text-slate-900 dark:text-gray-300 font-sans overflow-hidden transition-colors duration-500">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Header lastSync={lastSync} />

        <main className="flex-1 p-8 overflow-y-auto space-y-8 custom-scrollbar">
          
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="px-2 py-1 bg-[#00FF88] text-black text-[10px] font-black rounded uppercase">Active</div>
                <h1 className="text-4xl font-black tracking-tighter text-slate-950 dark:text-white uppercase leading-none">
                  Macro Decision <span className="text-[#00FF88]">Support System</span>
                </h1>
              </div>
              <p className="text-sm font-mono text-slate-500 dark:text-gray-500 uppercase tracking-widest">
                Multi-Pillar Quantitative Risk Assessment Hub
              </p>
            </div>
            <div className="hidden lg:block text-right">
               <span className="text-[10px] font-black text-slate-400 dark:text-gray-600 uppercase tracking-widest">Engine v1.2.0</span>
               <div className="text-xs font-mono text-slate-500 mt-1">CROSS-ASSET SIGNALS: LIVE</div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border border-slate-200 dark:border-white/5 p-6 shadow-xl shadow-slate-200/50 dark:shadow-none">
             <div className="flex items-center gap-2 mb-6 px-1">
                <BarChart3 size={16} className="text-[#00FF88]" />
                <h2 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-[0.2em]">Volatility Regime & Tail Risk</h2>
             </div>
             <MacroHealth />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <MacroPillar 
              title="Economic Growth" 
              subtitle="Activity & Momentum"
              icon={Activity}
              status={growthStatus}
              indicators={growthIndicators}
            />

            <MacroPillar 
              title="Inflation Hub" 
              subtitle="Purchasing Power"
              icon={TrendingUp}
              status={inflationStatus}
              indicators={inflationIndicators}
            />

            <MacroPillar 
              title="Liquidity" 
              subtitle="Monetary Conditions"
              icon={Droplets}
              status={liquidityStatus}
              indicators={liquidityIndicators}
            />
          </div>

          <div className="p-8 rounded-3xl bg-slate-900 dark:bg-[#0D1117]/80 border border-white/5 flex flex-col items-center justify-center text-center space-y-4 shadow-2xl">
             <div className="p-4 rounded-full bg-white/5 border border-white/10">
                <ShieldAlert className="text-[#00FF88] animate-pulse" size={32} />
             </div>
             <div>
               <h4 className="text-white font-black uppercase tracking-tighter text-xl">Tactical Rebalancing Signal</h4>
               <p className="text-gray-400 text-sm max-w-lg mt-2 font-medium">
                  {tacticalSignal}
               </p>
             </div>
          </div>

        </main>
      </div>
    </div>
  )
}
