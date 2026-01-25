"use client"

import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CurrencyPair } from '../types' // IMPORT UNIQUE ICI

interface CurrencyWidgetProps {
  pairs?: CurrencyPair[]; 
}

export function CurrencyWidget({ pairs: initialPairs }: CurrencyWidgetProps) {
  const [currencies, setCurrencies] = useState<CurrencyPair[]>(initialPairs || [])
  const [loading, setLoading] = useState(!initialPairs)

  useEffect(() => {
    // Si on a déjà des pairs (mock data), on ne charge pas Supabase immédiatement
    if (initialPairs && initialPairs.length > 0) {
      setLoading(false)
      return
    }

    const fetchCurrencies = async () => {
      try {
        const { data, error } = await supabase
          .from('currencies')
          .select('id, symbol, rate_to_eur')
          .order('id', { ascending: true })
        
        if (error) throw error
        if (data) setCurrencies(data)
      } catch (err) {
        console.error("Erreur Fetch:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchCurrencies()
  }, [initialPairs])

  if (loading && currencies.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 bg-[#0B0E14]/90 backdrop-blur-md border border-[#1a1d24] rounded-xl p-4 shadow-2xl z-50 min-w-[200px]">
      <div className="flex items-center justify-between mb-3 border-b border-[#1a1d24] pb-2">
        <div className="text-[10px] text-gray-500 uppercase tracking-widest font-mono">
          Forex Rates (EUR)
        </div>
        <div className="h-1.5 w-1.5 rounded-full bg-[#00FF88] animate-pulse" />
      </div>

      <div className="space-y-3">
        {currencies.map((cur) => (
          <div key={cur.id} className="flex items-center justify-between group">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-medium text-gray-500">{cur.symbol}</span>
              <span className="text-xs font-bold text-gray-300">{cur.id}/EUR</span>
            </div>
            <div className="text-xs font-mono text-[#00FF88] bg-[#00FF88]/5 px-2 py-0.5 rounded">
              {Number(cur.rate_to_eur || 0).toFixed(4)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}