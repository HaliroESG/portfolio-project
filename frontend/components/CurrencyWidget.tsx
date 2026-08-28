"use client"

import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Wallet, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CurrencyPair } from '../types' // IMPORT UNIQUE ICI
import { cn } from '../lib/utils'

interface CurrencyWidgetProps {
  pairs?: CurrencyPair[]; 
}

export function CurrencyWidget({ pairs: initialPairs }: CurrencyWidgetProps) {
  const [currencies, setCurrencies] = useState<CurrencyPair[]>(initialPairs || [])
  const [loading, setLoading] = useState(!initialPairs || initialPairs.length === 0)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (initialPairs && initialPairs.length > 0) {
      setCurrencies(initialPairs)
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

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (loading && currencies.length === 0) return null

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Open forex rates"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-xs font-black uppercase tracking-wider transition-colors',
          open
            ? 'border-slate-950 bg-slate-950 text-white dark:border-[#00FF88] dark:bg-[#00FF88] dark:text-black'
            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10'
        )}
      >
        <Wallet className="h-4 w-4" />
        <span className="hidden sm:inline">FX</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close forex rates overlay"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/35 md:hidden"
          />
          <div className="fixed inset-x-3 bottom-3 z-50 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-[#1a1d24] dark:bg-[#0B0E14] md:absolute md:inset-auto md:right-0 md:top-11 md:min-w-[240px]">
            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2 dark:border-[#1a1d24]">
              <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 dark:text-gray-500">
                Forex Rates (EUR)
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-[#00FF88]" />
                <button
                  type="button"
                  aria-label="Close forex rates"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white md:hidden"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {currencies.map((cur) => (
                <div key={cur.id} className="flex items-center justify-between gap-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-medium text-slate-500 dark:text-gray-500">{cur.symbol}</span>
                    <span className="text-xs font-bold text-slate-700 dark:text-gray-300">{cur.id}/EUR</span>
                  </div>
                  <div className="rounded bg-[#00FF88]/10 px-2 py-0.5 font-mono text-xs text-emerald-700 dark:text-[#00FF88]">
                    {Number(cur.rate_to_eur || 0).toFixed(4)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
