"use client"

import React, { useState, useEffect } from 'react'
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { GeographicMap } from '../../components/GeographicMap'
import { supabase } from '../../lib/supabase'
import { Globe } from 'lucide-react'
import { cn } from '../../lib/utils'

interface CountryPerformance {
  code: string
  name: string
  avgPerformance: number
  assetCount: number
}

// Mapping des suffixes de ticker vers codes pays
const TICKER_SUFFIX_TO_COUNTRY: Record<string, string> = {
  '.PA': 'FR', // France
  '.US': 'US', // USA
  '.DE': 'DE', // Germany
  '.UK': 'GB', // UK
  '.JP': 'JP', // Japan
  '.CN': 'CN', // China
  '.CH': 'CH', // Switzerland
  '.SW': 'CH', // Switzerland (alternative)
  '.CA': 'CA', // Canada
  '.AU': 'AU', // Australia
  '.IT': 'IT', // Italy
  '.ES': 'ES', // Spain
  '.MC': 'ES', // Spain (Madrid)
  '.NL': 'NL', // Netherlands
  '.SE': 'SE', // Sweden
  '.NO': 'NO', // Norway
  '.DK': 'DK', // Denmark
  '.FI': 'FI', // Finland
  '.IE': 'IE', // Ireland
  '.BE': 'BE', // Belgium
}

const COUNTRY_NAMES: Record<string, string> = {
  'US': 'United States',
  'FR': 'France',
  'GB': 'United Kingdom',
  'DE': 'Germany',
  'JP': 'Japan',
  'CN': 'China',
  'CH': 'Switzerland',
  'CA': 'Canada',
  'AU': 'Australia',
  'IT': 'Italy',
  'ES': 'Spain',
  'NL': 'Netherlands',
  'SE': 'Sweden',
  'NO': 'Norway',
  'DK': 'Denmark',
  'FI': 'Finland',
  'IE': 'Ireland',
  'BE': 'Belgium',
}

function getCountryFromTicker(ticker: string): string | null {
  if (!ticker) return null
  
  // Cherche le suffixe dans le ticker
  for (const [suffix, countryCode] of Object.entries(TICKER_SUFFIX_TO_COUNTRY)) {
    if (ticker.endsWith(suffix)) {
      return countryCode
    }
  }
  
  // Si pas de suffixe, essaie de détecter par préfixe ou autres patterns
  if (ticker.startsWith('^') || ticker.includes('=')) {
    return null // Indices ou FX, on ignore
  }
  
  // Tickers US communs sans suffixe (ORCL, EL, etc.)
  const usTickers = ['ORCL', 'EL', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA']
  if (usTickers.includes(ticker.toUpperCase())) {
    return 'US'
  }
  
  // Par défaut, si c'est un ticker US simple (3-5 lettres), on assume US
  if (/^[A-Z]{3,5}$/.test(ticker)) {
    return 'US'
  }
  
  return null
}

export default function GeoPage() {
  const [lastSync, setLastSync] = useState("")
  const [countryPerformance, setCountryPerformance] = useState<CountryPerformance[]>([])
  const [regions, setRegions] = useState<Array<{ code: string; name: string; value: number }>>([])

  useEffect(() => {
    async function fetchData() {
      try {
        const { data, error } = await supabase.from('market_watch').select('*')
        if (error) throw error
        
        if (data && data.length > 0) {
          const latest = data.reduce((max, item) => 
            new Date(item.last_update) > new Date(max) ? item.last_update : max, data[0].last_update)
          setLastSync(new Date(latest).toLocaleTimeString('fr-FR'))

          // Grouper par pays et calculer la performance moyenne
          const countryMap = new Map<string, { total: number; count: number }>()
          
          data.forEach((item: any) => {
            const ticker = item.ticker || ''
            const countryCode = getCountryFromTicker(ticker)
            
            if (countryCode) {
              const perf = (item.perf_ytd_eur || item.perf_ytd_local || 0) * 100
              
              if (!countryMap.has(countryCode)) {
                countryMap.set(countryCode, { total: 0, count: 0 })
              }
              
              const entry = countryMap.get(countryCode)!
              entry.total += perf
              entry.count += 1
            }
          })

          // Convertir en array et calculer les moyennes
          const performance: CountryPerformance[] = Array.from(countryMap.entries())
            .map(([code, { total, count }]) => ({
              code,
              name: COUNTRY_NAMES[code] || code,
              avgPerformance: total / count,
              assetCount: count
            }))
            .sort((a, b) => b.avgPerformance - a.avgPerformance)

          setCountryPerformance(performance)

          // Préparer les régions pour la carte (normaliser entre 0-100 pour l'affichage)
          const maxPerf = Math.max(...performance.map(p => Math.abs(p.avgPerformance)), 1)
          const regionsData = performance.map(p => ({
            code: p.code,
            name: p.name,
            value: Math.max(0, (p.avgPerformance / maxPerf) * 100) // Normaliser pour l'affichage
          }))
          
          setRegions(regionsData)
        }
      } catch (err) {
        console.error('Error fetching geographic data:', err)
      }
    }
    fetchData()
  }, [])

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-[#080A0F] text-slate-900 transition-colors duration-500">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header lastSync={lastSync} />
        <main className="flex-1 p-8 flex flex-col gap-8">
          <div className="flex justify-between items-center">
            <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-950 dark:text-white">
              Global <span className="text-[#00FF88]">Exposure</span>
            </h1>
          </div>
          <div className="flex-1 grid grid-cols-12 gap-8">
            <div className="col-span-9 bg-white dark:bg-black/20 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl dark:shadow-inner p-4 relative overflow-hidden">
              <div className="w-full h-full rounded-2xl bg-white dark:bg-transparent transition-colors scale-100">
                <GeographicMap regions={regions} hoveredAsset={null} />
              </div>
            </div>
            <div className="col-span-3 space-y-6">
              <div className="p-6 bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-xl">
                <h3 className="text-sm font-black uppercase mb-6 text-slate-950 dark:text-white">Regional Performance</h3>
                <div className="space-y-4">
                  {countryPerformance.map((country) => (
                    <div key={country.code} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-gray-400">
                          {country.name}
                        </span>
                        <span className={cn(
                          "text-[10px] font-mono font-black",
                          country.avgPerformance >= 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        )}>
                          {country.avgPerformance >= 0 ? '+' : ''}{country.avgPerformance.toFixed(2)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full transition-all duration-500",
                            country.avgPerformance >= 0
                              ? "bg-green-500 dark:bg-green-400"
                              : "bg-red-500 dark:bg-red-400"
                          )}
                          style={{ width: `${Math.min(100, Math.abs(country.avgPerformance) * 10)}%` }}
                        />
                      </div>
                      <div className="text-[8px] text-slate-400 dark:text-gray-500">
                        {country.assetCount} asset{country.assetCount > 1 ? 's' : ''}
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
