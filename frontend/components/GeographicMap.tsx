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

  // Évite les erreurs d'hydratation Next.js
  useEffect(() => {
    setMounted(true)
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

  if (!mounted) return <div className="h-full w-full bg-[#080A0F]" />

  return (
    <div className="bg-[#080A0F] border border-[#1a1d24] rounded-lg h-full flex flex-col relative overflow-hidden shadow-inner">
      
      {/* Indicateur de Statut */}
      <div className="absolute top-4 left-4 z-20 p-2 bg-black/50 rounded border border-white/10 backdrop-blur-sm">
        <div className="text-[10px] text-gray-500 uppercase font-mono tracking-tighter">View Mode</div>
        <div className={`text-xs font-bold ${hoveredAsset ? 'text-[#00FF88]' : 'text-orange-500'}`}>
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
                  // On normalise l'ID numérique sur 3 chiffres (ex: "250")
                  const numericId = geo.id?.toString().padStart(3, '0');
                  
                  // On cherche la correspondance : Dictionnaire -> Propriétés Géo -> ID Brut
                  const countryCode = (
                    ISO_MAP[numericId] || 
                    geo.properties?.ISO_A2 || 
                    geo.id
                  )?.toString().toUpperCase();

                  // --- CALCUL DU STYLE ---
                  const perf = performanceMap.get(countryCode);
                  
                  // Couleurs par défaut (Heatmap)
                  let fill = perf !== undefined ? colorScale(perf) : '#12151c';
                  let opacity = 1;
                  let stroke = '#1a1d24';
                  let strokeWidth = 0.5;

                  // --- OVERRIDE SI SURVOL (Look-through) ---
                  if (hoveredAsset && hoveredAsset.constituents) { // Changé geo_coverage -> constituents
                    const weight = hoveredAsset.constituents[countryCode]; // Changé geo_coverage -> constituents
                    
                    if (weight !== undefined) {
                      // Calcul de l'opacité en fonction du poids (ex: 0.2 à 1.0)
                      const opacity = 0.2 + (weight / 100) * 0.8;
                      return `rgba(0, 255, 136, ${opacity})`; // Vert Quant
                    }
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
                          default: { outline: 'none', transition: 'all 250ms' },
                          // On ne permet le highlight individuel que si on ne survole pas déjà un actif
                          hover: { 
                            fill: hoveredAsset ? fill : "#3B82F6", 
                            fillOpacity: 1,
                            outline: 'none', 
                            cursor: 'pointer' 
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