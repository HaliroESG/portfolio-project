"use client"

import React, { useMemo, useState, useEffect } from 'react'
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps'
import { scaleLinear } from 'd3-scale'
import { Asset, MarketRegion } from '../types'

// URL stable pour les pays (TopoJSON)
const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// Dictionnaire de traduction IDs numériques -> Codes ISO Alpha-2
const ISO_MAP: { [key: string]: string } = {
  "250": "FR", "840": "US", "756": "CH", "056": "BE", "380": "IT", 
  "276": "DE", "826": "GB", "392": "JP", "124": "CA", "036": "AU",
  "156": "CN", "356": "IN", "158": "TW", "410": "KR", "076": "BR",
  "682": "SA", "710": "ZA", "484": "MX", "528": "NL", "752": "SE", 
  "208": "DK", "724": "ES", "578": "NO", "246": "FI", "372": "IE"
};

interface GeographicMapProps {
  regions: MarketRegion[]
  hoveredAsset: Asset | null
}

export function GeographicMap({ regions, hoveredAsset }: GeographicMapProps) {
  const [mounted, setMounted] = useState(false)
  const [isDark, setIsDark] = useState(false)

  // Évite les erreurs d'hydratation Next.js et détecte le thème
  useEffect(() => {
    setMounted(true)
    // Check initial theme
    const checkTheme = () => {
      if (typeof window !== 'undefined') {
        const isDarkMode = document.documentElement.classList.contains('dark') ||
          window.matchMedia('(prefers-color-scheme: dark)').matches
        setIsDark(isDarkMode)
      }
    }
    checkTheme()
    
    // Watch for theme changes
    const observer = new MutationObserver(checkTheme)
    if (typeof window !== 'undefined') {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class']
      })
    }
    
    return () => observer.disconnect()
  }, [])

  // Échelle de couleur pour la heatmap globale
  const colorScale = useMemo(() => 
    scaleLinear<string>()
      .domain([-5, 0, 5])
      .range(['#FF3366', '#1a1d24', '#00FF88']),
    []
  )

  // Map des performances par pays (pour la vue par défaut)
  const performanceMap = useMemo(() => {
    const map = new Map<string, number>()
    regions.forEach((r) => map.set(r.code.toUpperCase(), r.performance))
    return map
  }, [regions])

  if (!mounted) return <div className="h-full w-full bg-white dark:bg-[#080A0F]" />

  return (
    <div className="bg-white dark:bg-[#080A0F] h-full w-full flex flex-col relative overflow-hidden shadow-inner dark:shadow-2xl">
      
      {/* Indicateur de Statut */}
      <div className="absolute top-4 left-4 z-20 p-2 bg-white/90 dark:bg-black/50 rounded border border-slate-300 dark:border-white/10 backdrop-blur-sm shadow-lg">
        <div className="text-[10px] text-slate-500 dark:text-gray-500 uppercase font-mono tracking-tighter">View Mode</div>
        <div className={`text-xs font-bold ${hoveredAsset ? 'text-blue-600 dark:text-[#00FF88]' : 'text-slate-700 dark:text-orange-500'}`}>
          {hoveredAsset ? `FOCUS: ${hoveredAsset.ticker}` : 'MARKET HEATMAP'}
        </div>
      </div>

      <div className="flex-1 w-full h-full">
        <ComposableMap projectionConfig={{ scale: 145, center: [0, 20] }}>
          <ZoomableGroup zoom={1} minZoom={1} maxZoom={4}>
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  // --- IDENTIFICATION DU PAYS ---
                  const numericId = geo.id?.toString().padStart(3, '0');
                  const countryCode = (
                    ISO_MAP[numericId] || 
                    geo.properties?.ISO_A2 || 
                    geo.id
                  )?.toString().toUpperCase();

                  // --- CALCUL DU STYLE ---
                  const perf = performanceMap.get(countryCode);
                  
                  // Base colors: light gray in light mode, dark gray in dark mode
                  let fill = isDark ? 'rgba(30, 41, 59, 0.5)' : 'rgb(241, 245, 249)'; // slate-800/50 or slate-100
                  let opacity = 1;
                  let stroke = isDark ? 'rgb(51, 65, 85)' : 'rgb(203, 213, 225)'; // slate-700 or slate-300
                  let strokeWidth = 0.5;

                  // --- OVERRIDE SI SURVOL (Look-through) ---
                  if (hoveredAsset && hoveredAsset.constituents) {
                    const weight = hoveredAsset.constituents[countryCode];
                    
                    if (weight !== undefined && weight > 0) {
                      // Blue gradient with opacity based on exposure (0.3 to 1.0)
                      const exposureOpacity = 0.3 + (Math.min(weight / 100, 1) * 0.7);
                      fill = 'rgb(59, 130, 246)'; // blue-500
                      opacity = exposureOpacity;
                      stroke = 'rgb(37, 99, 235)'; // blue-600
                      strokeWidth = 0.75;
                    }
                  } else if (perf !== undefined) {
                    // Heatmap mode: use color scale for performance
                    fill = colorScale(perf);
                    opacity = 0.8;
                  }

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={fill}
                      fillOpacity={opacity}
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                      style={{
                        default: { outline: 'none', transition: 'all 250ms ease-in-out' },
                        hover: { 
                          fill: hoveredAsset ? fill : 'rgb(59, 130, 246)', // blue-500
                          fillOpacity: hoveredAsset ? opacity : 0.9,
                          outline: 'none', 
                          cursor: 'pointer',
                          transition: 'all 250ms ease-in-out'
                        },
                        pressed: { outline: 'none' },
                      }}
                    />
                  )
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>
      </div>
    </div>
  )
}