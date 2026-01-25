"use client"

import React, { useState, useEffect } from 'react'
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { CurrencyWidget } from '../../components/CurrencyWidget'
import { mockCurrencyPairs } from '../../utils/mockData'
import { ArrowRightLeft } from 'lucide-react'

export default function FXPage() {
  const [lastSync, setLastSync] = useState("")
  useEffect(() => { setLastSync(new Date().toLocaleTimeString('fr-FR')) }, [])

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#080A0F] transition-colors duration-500">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header lastSync={lastSync} />
        <main className="flex-1 p-12 overflow-y-auto">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12">
            <div className="lg:col-span-8 space-y-6">
              <div className="flex items-center gap-3">
                <ArrowRightLeft className="text-[#00FF88]" />
                <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-950 dark:text-white">FX Intelligence</h1>
              </div>
              <div className="bg-white dark:bg-[#0D1117]/50 p-8 rounded-[40px] border-2 border-slate-200 dark:border-white/5 shadow-2xl">
                <CurrencyWidget pairs={mockCurrencyPairs} />
              </div>
            </div>
            <div className="lg:col-span-4 pt-12">
              <div className="p-8 bg-slate-950 rounded-[40px] shadow-2xl border border-slate-800 text-white">
                <h3 className="text-[#00FF88] font-black uppercase text-xl mb-4 tracking-tighter">Market Note</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Relative currency strength is currently driven by diverging central bank policies. 
                  Monitor G10 yields for breakout signals.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}