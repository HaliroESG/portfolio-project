"use client"

import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// Imports des composants (Note le ../../ pour remonter de 2 niveaux)
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { MacroHealth } from '../../components/MacroHealth'

// Icônes pour le MDSS
import { 
  Activity, 
  TrendingUp, 
  Droplets, 
  ShieldAlert, 
  Zap,
  BarChart3
} from 'lucide-react'

// --- COMPOSANT INTERNE : CARTE DE PILIER MACRO ---
function MacroPillar({ title, subtitle, icon: Icon, status, indicators }: any) {
  const statusColors = {
    red: "border-red-500/50 bg-red-50/50 text-red-700 dark:bg-red-950/20 dark:text-red-500 dark:border-red-500/30",
    amber: "border-amber-500/50 bg-amber-50/50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-500 dark:border-amber-500/30",
    green: "border-green-500/50 bg-green-50/50 text-green-700 dark:bg-green-950/20 dark:text-green-500 dark:border-green-500/30"
  }

  return (
    <div className={`p-6 rounded-3xl border-2 shadow-xl shadow-slate-200/50 dark:shadow-none transition-all duration-500 ${statusColors[status as keyof typeof statusColors]}`}>
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
        {indicators.map((ind: any, i: number) => (
          <div key={i} className="flex justify-between items-center border-b border-current/10 pb-2 group hover:border-current/30 transition-colors">
            <span className="text-[11px] font-bold opacity-70 uppercase tracking-wider">{ind.label}</span>
            <div className="text-right">
              <div className="font-mono font-black text-sm">{ind.value}</div>
              {ind.trend && (
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
  const [lastSync, setLastSync] = useState("")

  useEffect(() => {
    setLastSync(new Date().toLocaleTimeString('fr-FR'))
  }, [])

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#080A0F] text-slate-900 dark:text-gray-300 font-sans overflow-hidden transition-colors duration-500">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Header lastSync={lastSync} />

        <main className="flex-1 p-8 overflow-y-auto space-y-8 custom-scrollbar">
          
          {/* HEADER DE LA PAGE */}
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
               <span className="text-[10px] font-black text-slate-400 dark:text-gray-600 uppercase tracking-widest">Engine v1.1.4</span>
               <div className="text-xs font-mono text-slate-500 mt-1">CROSS-ASSET SIGNALS: STABLE</div>
            </div>
          </div>

          {/* 1. LAYER 1 : RÉGIME DE VOLATILITÉ (LIVE FEED) */}
          <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border border-slate-200 dark:border-white/5 p-6 shadow-xl shadow-slate-200/50 dark:shadow-none">
             <div className="flex items-center gap-2 mb-6 px-1">
                <BarChart3 size={16} className="text-[#00FF88]" />
                <h2 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-[0.2em]">Volatility Regime & Tail Risk</h2>
             </div>
             <MacroHealth />
          </div>

          {/* 2. LAYER 2 : LES TROIS PILIERS DÉCISIONNELS */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* PILIER : GROWTH & ACTIVITY */}
            <MacroPillar 
              title="Economic Growth" 
              subtitle="Activity & Momentum"
              icon={Activity}
              status="green"
              indicators={[
                { label: "US GDP Nowcast", value: "2.40%", trend: "UP", change: "+0.2%" },
                { label: "Manufacturing PMI", value: "51.2", trend: "DOWN", change: "-0.5" },
                { label: "Copper/Gold Ratio", value: "Normal", trend: "UP", change: "Stable" }
              ]}
            />

            {/* PILIER : INFLATION REGIME */}
            <MacroPillar 
              title="Inflation Hub" 
              subtitle="Purchasing Power"
              icon={TrendingUp}
              status="amber"
              indicators={[
                { label: "Core CPI (YoY)", value: "3.20%", trend: "DOWN", change: "-0.1%" },
                { label: "5Y5Y Breakeven", value: "2.38%", trend: "UP", change: "+0.04" },
                { label: "Sticky Price Index", value: "Elevated", trend: "UP", change: "High" }
              ]}
            />

            {/* PILIER : LIQUIDITY & FINANCIAL CONDITIONS */}
            <MacroPillar 
              title="Liquidity" 
              subtitle="Monetary Conditions"
              icon={Droplets}
              status="red"
              indicators={[
                { label: "Fed Net Liquidity", value: "Draining", trend: "DOWN", change: "-$12B" },
                { label: "HY Credit Spreads", value: "420bps", trend: "UP", change: "+15bps" },
                { label: "DXY Dollar Index", value: "104.5", trend: "UP", change: "Stress" }
              ]}
            />
          </div>

          {/* 3. LAYER 3 : ANALYSE TACTIQUE (FOOTER) */}
          <div className="p-8 rounded-3xl bg-slate-900 dark:bg-[#0D1117]/80 border border-white/5 flex flex-col items-center justify-center text-center space-y-4 shadow-2xl">
             <div className="p-4 rounded-full bg-white/5 border border-white/10">
                <ShieldAlert className="text-[#00FF88] animate-pulse" size={32} />
             </div>
             <div>
               <h4 className="text-white font-black uppercase tracking-tighter text-xl">Tactical Rebalancing Signal</h4>
               <p className="text-gray-400 text-sm max-w-lg mt-2 font-medium">
                  Liquidity conditions are currently restrictive. Recommendation: Favor high-quality defensive assets and maintain a 5-10% cash buffer until credit spreads stabilize.
               </p>
             </div>
          </div>

        </main>
      </div>
    </div>
  )
}