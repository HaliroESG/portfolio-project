"use client"

import React, { useState, useEffect } from 'react'
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { GeographicMap } from '../../components/GeographicMap'
import { supabase } from '../../lib/supabase'
import { Globe, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { MarketRegion } from '../../types'

interface CountryPerformance {
  code: string
  name: string
  avgPerformance: number
  assetCount: number
  totalExposure: number
}

// Coordonnées GPS pour chaque pays (centre approximatif)
const COUNTRY_COORDS: Record<string, [number, number]> = {
  'US': [-95.7129, 37.0902], // États-Unis (centre)
  'FR': [2.2137, 46.2276], // France
  'GB': [-3.4360, 55.3781], // Royaume-Uni
  'DE': [10.4515, 51.1657], // Allemagne
  'JP': [138.2529, 36.2048], // Japon
  'CN': [104.1954, 35.8617], // Chine
  'CH': [8.2275, 46.8182], // Suisse
  'CA': [-106.3468, 56.1304], // Canada
  'AU': [133.7751, -25.2744], // Australie
  'IT': [12.5674, 41.8719], // Italie
  'ES': [-3.7492, 40.4637], // Espagne
  'NL': [5.2913, 52.1326], // Pays-Bas
  'SE': [18.6435, 60.1282], // Suède
  'NO': [8.4689, 60.4720], // Norvège
  'DK': [9.5018, 56.2639], // Danemark
  'FI': [25.7482, 61.9241], // Finlande
  'IE': [-8.2439, 53.4129], // Irlande
  'BE': [4.4699, 50.5039], // Belgique
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
  const [regions, setRegions] = useState<MarketRegion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const { data, error } = await supabase.from('market_watch').select('*')
        if (error) throw error
        
        if (data && data.length > 0) {
          const latest = data.reduce((max, item) => 
            new Date(item.last_update) > new Date(max) ? item.last_update : max, data[0].last_update)
          setLastSync(new Date(latest).toLocaleTimeString('fr-FR'))

          // Grouper par pays et calculer la performance moyenne et l'exposition
          const countryMap = new Map<string, { total: number; count: number; totalExposure: number }>()
          
          data.forEach((item: any) => {
            const ticker = item.ticker || ''
            const countryCode = getCountryFromTicker(ticker)
            
            if (countryCode) {
              const perf = (item.perf_ytd_eur || item.perf_ytd_local || 0) * 100
              const exposure = item.last_price || 0 // Utiliser le prix comme proxy d'exposition
              
              if (!countryMap.has(countryCode)) {
                countryMap.set(countryCode, { total: 0, count: 0, totalExposure: 0 })
              }
              
              const entry = countryMap.get(countryCode)!
              entry.total += perf
              entry.count += 1
              entry.totalExposure += exposure
            }
          })

          // Convertir en array et calculer les moyennes
          const performance: CountryPerformance[] = Array.from(countryMap.entries())
            .map(([code, { total, count, totalExposure }]) => ({
              code,
              name: COUNTRY_NAMES[code] || code,
              avgPerformance: total / count,
              assetCount: count,
              totalExposure
            }))
            .sort((a, b) => b.avgPerformance - a.avgPerformance)

          setCountryPerformance(performance)

          // Préparer les régions pour la carte selon l'interface MarketRegion
          const totalGlobalExposure = performance.reduce((sum, p) => sum + p.totalExposure, 0) || 1
          const maxPerf = Math.max(...performance.map(p => Math.abs(p.avgPerformance)), 1) || 1
          
          const regionsData: MarketRegion[] = performance.map((p, index) => {
            const coords = COUNTRY_COORDS[p.code] || [0, 0] // Fallback si pays non trouvé
            const exposurePct = (p.totalExposure / totalGlobalExposure) * 100
            
            return {
              id: `region-${p.code}-${index}`,
              code: p.code,
              name: p.name,
              performance: p.avgPerformance,
              exposure: exposurePct,
              coordinates: coords
            }
          })
          
          setRegions(regionsData)
          setLoading(false)
        } else {
          setLoading(false)
        }
      } catch (err) {
        console.error('Error fetching geographic data:', err)
        setLoading(false)
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
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                  </div>
                ) : !regions || regions.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Globe className="w-12 h-12 mx-auto text-slate-400 mb-4" />
                      <p className="text-slate-500 dark:text-gray-400">No geographic data available</p>
                    </div>
                  </div>
                ) : (
                  <GeographicMap regions={regions} hoveredAsset={null} />
                )}
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
