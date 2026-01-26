"use client"

import React, { useState, useEffect } from 'react'
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { supabase } from '../../lib/supabase'
import { ArrowRightLeft, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '../../lib/utils'

interface CurrencyPair {
  ticker: string
  name: string
  currency: string
  last_price: number
  perf_day_local: number
}

// Interface pour les données brutes de Supabase
interface MarketWatchItem {
  ticker: string | null
  name: string | null
  currency: string | null
  last_price: number | null
  perf_day_local: number | null
  last_update: string | null
}

export default function CurrenciesPage() {
  const [lastSync, setLastSync] = useState("")
  const [currencyPairs, setCurrencyPairs] = useState<CurrencyPair[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchCurrencyPairs() {
      try {
        // Récupérer les actifs de type Forex/Currency ou dont le nom contient "vs" ou "Pair"
        const { data, error } = await supabase
          .from('market_watch')
          .select('ticker, name, currency, last_price, perf_day_local, last_update')
          .not('currency', 'is', null)
        
        if (error) throw error
        
        if (data && data.length > 0) {
          // Type-safe: Cast data to MarketWatchItem[]
          const typedData = data as MarketWatchItem[]
          
          // Filtrer pour n'afficher que les paires de devises
          const pairs = typedData.filter((item) => {
            const name = (item.name || '').toLowerCase()
            const ticker = (item.ticker || '').toUpperCase()
            const currency = (item.currency || '').toUpperCase()
            
            // Filtrer les devises non-EUR ou contenant "vs"/"Pair" dans le nom
            // Ou les tickers FX (EURUSD=X, GBPUSD=X, etc.)
            return (
              (currency !== 'EUR') ||
              name.includes('vs') ||
              name.includes('pair') ||
              ticker.includes('=X') ||
              ticker.includes('USD') ||
              ticker.includes('EUR')
            )
          }).map((item) => ({
            ticker: item.ticker || 'N/A',
            name: item.name || 'Unknown',
            currency: item.currency || 'USD',
            last_price: item.last_price || 0,
            perf_day_local: (item.perf_day_local || 0) * 100 // Convertir en pourcentage
          }))
          
          setCurrencyPairs(pairs)
          
          // Type-safe reduce pour trouver le dernier sync time
          // Valeur initiale sécurisée : data[0]?.last_update ou ISO string
          const initialValue = typedData[0]?.last_update || new Date().toISOString()
          const latest = typedData.reduce((max: string, item: MarketWatchItem) => {
            const itemUpdate = item.last_update
            // Gérer les cas où last_update est undefined/null
            if (!itemUpdate) return max
            
            // S'assurer que max est valide avant de créer une Date
            const maxDate = max ? new Date(max) : new Date(0)
            const itemDate = new Date(itemUpdate)
            
            // Vérifier que la date est valide
            if (isNaN(itemDate.getTime())) return max
            
            return itemDate > maxDate ? itemUpdate : max
          }, initialValue)
          
          setLastSync(new Date(latest).toLocaleTimeString('fr-FR'))
        }
      } catch (err) {
        console.error('Error fetching currency pairs:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchCurrencyPairs()
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchCurrencyPairs, 300000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#080A0F] transition-colors duration-500">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header lastSync={lastSync} />
        <main className="flex-1 p-12 overflow-y-auto">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
              <ArrowRightLeft className="text-[#00FF88]" />
              <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-950 dark:text-white">Currency Pairs</h1>
            </div>
            
            {/* Currency Pairs Table */}
            <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden">
              <div className="p-6 border-b-2 border-slate-200 dark:border-white/5">
                <h2 className="text-sm font-black uppercase tracking-tighter text-slate-950 dark:text-white">
                  FX Pairs from Market Watch
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-[#080A0F]">
                    <tr>
                      <th className="p-4 text-left text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                        Pair
                      </th>
                      <th className="p-4 text-left text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                        Ticker
                      </th>
                      <th className="p-4 text-right text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                        Rate
                      </th>
                      <th className="p-4 text-right text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                        Daily Change
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {loading ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-500 dark:text-gray-400">
                          Loading currency pairs...
                        </td>
                      </tr>
                    ) : currencyPairs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-500 dark:text-gray-400">
                          No currency pairs found
                        </td>
                      </tr>
                    ) : (
                      currencyPairs.map((pair) => {
                        const isPositive = pair.perf_day_local >= 0
                        
                        return (
                          <tr 
                            key={pair.ticker}
                            className="hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors"
                          >
                            <td className="p-4">
                              <span className="text-sm font-black text-slate-950 dark:text-white">
                                {pair.name}
                              </span>
                            </td>
                            <td className="p-4">
                              <span className="text-sm font-mono font-bold text-slate-500 dark:text-gray-400">
                                {pair.ticker}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <span className="text-sm font-mono font-black text-slate-950 dark:text-white">
                                {pair.last_price > 0 
                                  ? pair.last_price.toFixed(4)
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
                                  {isPositive ? '+' : ''}{pair.perf_day_local.toFixed(2)}%
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
        </main>
      </div>
    </div>
  )
}
