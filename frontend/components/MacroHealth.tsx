"use client"

import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { AlertTriangle, ShieldCheck, Zap, Activity, TrendingUp, TrendingDown, Bell } from 'lucide-react'

interface MacroIndicator {
  id: string;
  name: string;
  value: number | null; // Peut être null
  change_pct: number | null; // Peut être null
  threshold_amber: number;
  threshold_red: number;
  direction: 'UP' | 'DOWN';
  pillar: string;
}

export function MacroHealth() {
  const [indicators, setIndicators] = useState<MacroIndicator[]>([])
  const [alerts, setAlerts] = useState<string[]>([])

  // Memoize processTacticalSignals to prevent recreation on every render
  const processTacticalSignals = useCallback((data: MacroIndicator[]) => {
    const newAlerts: string[] = []
    const find = (id: string) => data.find(i => i.id === id)

    const vix = find('^VIX')
    const hy = find('HYG_OAS')
    // const bread = find('BREADTH_200') // Pas utilisé pour l'instant
    // const realYield = find('^TNX') 
    const dxy = find('DX-Y.NYB')
    const curve = find('10Y2Y')

    // Sécurisation des valeurs pour les comparaisons (fallback à 0 si null)
    const val = (i: MacroIndicator | undefined) => i?.value ?? 0

    // 1. RULE: Risk-Off Confirmation
    if (vix && hy && val(vix) > vix.threshold_amber && val(hy) > hy.threshold_amber) {
      newAlerts.push("RISK-OFF CONFIRMED: Tighten rebalancing bands & increase cash.")
    }

    // 2. RULE: USD Stress
    if (dxy && val(dxy) > dxy.threshold_red) {
      newAlerts.push("USD LIQUIDITY STRESS: Reduce Emerging Markets exposure.")
    }

    // 3. RULE: Yield Curve Inversion
    if (curve && val(curve) < curve.threshold_red) {
      newAlerts.push("CURVE DEEP INVERSION: Recession risk rising. Favor defensive quality.")
    }

    setAlerts(newAlerts)
  }, [])

  useEffect(() => {
    const fetchMacro = async () => {
      const { data } = await supabase.from('macro_indicators').select('*')
      if (data) {
        setIndicators(data)
        processTacticalSignals(data)
      }
    }
    fetchMacro()
    const interval = setInterval(fetchMacro, 30000)
    return () => clearInterval(interval)
  }, [processTacticalSignals])

  const getHealthStatus = () => {
    const vix = indicators.find(i => i.id === '^VIX')
    if (!vix) return 'NORMAL'
    
    // Protection contre les valeurs nulles
    const vixValue = vix.value ?? 0
    
    if (vixValue >= vix.threshold_red) return 'STRESS'
    if (vixValue >= vix.threshold_amber) return 'CAUTION'
    return 'NORMAL'
  }

  const status = getHealthStatus()

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-700">
      
      {/* 🟢 BANDEAU DE RÉGIME DYNAMIQUE */}
      <div className={`relative overflow-hidden p-5 rounded-2xl border transition-all duration-700 ${
        status === 'STRESS' ? 'bg-red-950/30 border-red-500/50' :
        status === 'CAUTION' ? 'bg-amber-950/30 border-amber-500/50' :
        'bg-[#00FF88]/5 border-[#00FF88]/20'
      }`}>
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_3s_infinite]" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${status === 'STRESS' ? 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 'bg-gray-800'}`}>
              {status === 'NORMAL' ? <ShieldCheck className="text-[#00FF88]" /> : <AlertTriangle className="text-white" />}
            </div>
            <div>
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Market Regime</div>
              <div className={`text-2xl font-black tracking-tighter ${
                status === 'STRESS' ? 'text-red-500' : status === 'CAUTION' ? 'text-amber-500' : 'text-[#00FF88]'
              }`}>
                {status} CONDITIONS
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 min-w-[300px]">
            {alerts.length > 0 ? (
              alerts.map((alert, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] font-bold text-white bg-white/5 border border-white/10 px-3 py-2 rounded-lg animate-pulse">
                  <Bell size={12} className="text-amber-500" />
                  {alert}
                </div>
              ))
            ) : (
              <div className="text-[11px] text-gray-500 italic flex items-center gap-2">
                <Zap size={12} /> No immediate tactical triggers detected.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 📊 GRILLE D'INDICATEURS DAILY */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {indicators.map((ind) => {
          // Sécurisation des valeurs ici aussi
          const safeValue = ind.value ?? 0
          const safeChange = ind.change_pct ?? 0

          const isWarning = (ind.direction === 'UP' && safeValue >= ind.threshold_amber) || 
                           (ind.direction === 'DOWN' && safeValue <= ind.threshold_amber)
          
          return (
            <div key={ind.id} className={`p-3 rounded-xl border transition-all hover:bg-white/5 ${
              isWarning ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/5 bg-[#0D1117]/50'
            }`}>
              <div className="flex justify-between items-start mb-2">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-tighter">{ind.name}</span>
                <Activity size={12} className={isWarning ? 'text-amber-500' : 'text-gray-700'} />
              </div>
              <div className="flex items-baseline justify-between">
                {/* BLINDAGE ICI : (safeValue).toFixed */}
                <span className={`text-lg font-mono font-bold ${isWarning ? 'text-amber-500' : 'text-gray-200'}`}>
                  {safeValue.toFixed(2)}
                </span>
                {/* BLINDAGE ICI : (safeChange * 100) */}
                <div className={`text-[10px] font-bold ${safeChange >= 0 ? 'text-[#00FF88]' : 'text-red-500'}`}>
                  {safeChange >= 0 ? '+' : ''}{(safeChange * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div> 
  )
}