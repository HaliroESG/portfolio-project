"use client"

import React, { useState, useEffect } from 'react'
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { GeographicMap } from '../../components/GeographicMap'
import { mockRegions } from '../../utils/mockData'
import { Globe } from 'lucide-react'

export default function GeoPage() {
  const [lastSync, setLastSync] = useState("")
  useEffect(() => { setLastSync(new Date().toLocaleTimeString('fr-FR')) }, [])

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-[#080A0F] text-slate-900 transition-colors duration-500">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header lastSync={lastSync} />
        <main className="flex-1 p-8 flex flex-col gap-8">
          <div className="flex justify-between items-center">
            <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-950 dark:text-white">Global <span className="text-[#00FF88]">Exposure</span></h1>
          </div>
          <div className="flex-1 grid grid-cols-12 gap-8">
            <div className="col-span-9 bg-white dark:bg-black/20 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl dark:shadow-inner p-4 relative overflow-hidden">
               {/* Wrapper pour forcer le contraste de la carte */}
               <div className="w-full h-full rounded-2xl bg-white dark:bg-transparent transition-colors scale-100">
                  <GeographicMap regions={mockRegions} hoveredAsset={null} />
               </div>
            </div>
            <div className="col-span-3 space-y-6">
              <div className="p-6 bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-xl">
                <h3 className="text-sm font-black uppercase mb-6 text-slate-950 dark:text-white">Regional Stats</h3>
                <div className="space-y-4">
                  {mockRegions.map((r, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-[10px] font-bold uppercase">
                        <span className="text-slate-500">{r.name}</span>
                        <span className="text-slate-950 dark:text-white">{(r as any).exposure || (r as any).value}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${(r as any).exposure || (r as any).value}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}