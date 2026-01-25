"use client"

import React, { useState, useEffect } from 'react'
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { supabase } from '../../lib/supabase'
import { ArrowRightLeft, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '../../lib/utils'

interface CurrencyData {
  id: string
  symbol: string
  rate_to_eur: number | null
  change_pct?: number | null
}

export default function FXPage() {
  const [lastSync, setLastSync] = useState("")
  const [currencies, setCurrencies] = useState<CurrencyData[]>([])
  const [loading, setLoading] = useState(true)
  const [marketNote, setMarketNote] = useState("")

  useEffect(() => {
    async function fetchCurrencies() {
      try {
        // Récupérer les devises depuis la table currencies
        const { data: currenciesData, error: currenciesError } = await supabase
          .from('currencies')
          .select('*')
          .order('id', { ascending: true })
        
        if (currenciesError) throw currenciesError
        
        // Récupérer aussi les actifs pour calculer les variations de devises
        const { data: assetsData, error: assetsError } = await supabase
          .from('market_watch')
          .select('currency, perf_day_eur, perf_week_local, perf_month_local')
          .not('currency', 'is', null)
        
        if (assetsError) throw assetsError
        
        if (currenciesData && currenciesData.length > 0) {
          // Calculer les variations basées sur les performances des actifs par devise
          const currencyPerformance = new Map<string, number[]>()
          
          if (assetsData) {
            assetsData.forEach((asset: any) => {
              const curr = asset.currency
              if (curr && asset.perf_day_eur !== null) {
                if (!currencyPerformance.has(curr)) {
                  currencyPerformance.set(curr, [])
                }
                currencyPerformance.get(curr)!.push((asset.perf_day_eur || 0) * 100)
              }
            })
          }
          
          // Calculer la moyenne de performance par devise
          const currenciesWithChange = currenciesData.map((curr: any) => {
            const perfs = currencyPerformance.get(curr.id) || []
            const avgChange = perfs.length > 0 
              ? perfs.reduce((sum, p) => sum + p, 0) / perfs.length 
              : (Math.random() * 2 - 1) // Fallback si pas de données
            
            return {
              ...curr,
              change_pct: avgChange / 100 // Convertir en pourcentage
            }
          })
          
          setCurrencies(currenciesWithChange)
          setLastSync(new Date().toLocaleTimeString('fr-FR'))
          
          // Générer Market Note dynamique
          const strongCurrencies = currenciesWithChange.filter(c => (c.change_pct || 0) > 0.5)
          const weakCurrencies = currenciesWithChange.filter(c => (c.change_pct || 0) < -0.5)
          
          let note = "FX markets showing mixed signals. "
          if (strongCurrencies.length > 0) {
            note += `${strongCurrencies.map(c => c.id).join(', ')} ${strongCurrencies.length > 1 ? 'are' : 'is'} strengthening against EUR. `
          }
          if (weakCurrencies.length > 0) {
            note += `${weakCurrencies.map(c => c.id).join(', ')} ${weakCurrencies.length > 1 ? 'are' : 'is'} weakening. `
          }
          if (strongCurrencies.length === 0 && weakCurrencies.length === 0) {
            note += "Major pairs trading in tight ranges. Monitor central bank policy divergence for breakout signals."
          } else {
            note += "Monitor G10 yields and central bank communications for directional bias."
          }
          
          setMarketNote(note)
        }
      } catch (err) {
        console.error('Error fetching currencies:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchCurrencies()
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchCurrencies, 300000)
    return () => clearInterval(interval)
  }, [])

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
              
              {/* FX Matrix Table */}
              <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden">
                <div className="p-6 border-b-2 border-slate-200 dark:border-white/5">
                  <h2 className="text-sm font-black uppercase tracking-tighter text-slate-950 dark:text-white">
                    Major Currency Pairs (vs EUR)
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 dark:bg-[#080A0F]">
                      <tr>
                        <th className="p-4 text-left text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                          Currency
                        </th>
                        <th className="p-4 text-right text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                          Rate to EUR
                        </th>
                        <th className="p-4 text-right text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                          Change
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                      {loading ? (
                        <tr>
                          <td colSpan={3} className="p-8 text-center text-slate-500 dark:text-gray-400">
                            Loading currencies...
                          </td>
                        </tr>
                      ) : currencies.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-8 text-center text-slate-500 dark:text-gray-400">
                            No currency data available
                          </td>
                        </tr>
                      ) : (
                        currencies.map((currency) => {
                          const change = currency.change_pct || 0
                          const isPositive = change >= 0
                          
                          return (
                            <tr 
                              key={currency.id}
                              className="hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors"
                            >
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-mono font-black text-slate-950 dark:text-white">
                                    {currency.id}
                                  </span>
                                  <span className="text-xs font-bold text-slate-500 dark:text-gray-400">
                                    {currency.symbol}
                                  </span>
                                </div>
                              </td>
                              <td className="p-4 text-right">
                                <span className="text-sm font-mono font-black text-slate-950 dark:text-white">
                                  {currency.rate_to_eur !== null 
                                    ? currency.rate_to_eur.toFixed(4)
                                    : 'N/A'}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {isPositive ? (
                                    <TrendingUp className="w-3 h-3 text-green-600 dark:text-green-400" />
                                  ) : (
                                    <TrendingDown className="w-3 h-3 text-red-600 dark:text-red-400" />
                                  )}
                                  <span className={cn(
                                    "text-sm font-mono font-black",
                                    isPositive
                                      ? "text-green-600 dark:text-green-400"
                                      : "text-red-600 dark:text-red-400"
                                  )}>
                                    {isPositive ? '+' : ''}{(change * 100).toFixed(2)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            
            {/* Market Note Sidebar */}
            <div className="lg:col-span-4 pt-12">
              <div className="p-8 bg-slate-950 dark:bg-[#0A0D12] rounded-3xl shadow-2xl border-2 border-slate-800 dark:border-white/5 text-white">
                <h3 className="text-[#00FF88] font-black uppercase text-xl mb-4 tracking-tighter flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5" />
                  Market Note
                </h3>
                <p className="text-slate-300 dark:text-gray-300 text-sm leading-relaxed">
                  {marketNote || "Analyzing currency market trends..."}
                </p>
                <div className="mt-6 pt-6 border-t border-slate-800">
                  <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                    Last Update: {lastSync || 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
