"use client"

import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Asset } from '../types'
import { Shield, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '../lib/utils'

interface GovernanceTarget {
  id: string
  portfolio_id: string
  asset_class: string
  target_pct: number
  tolerance_band: number
}

interface AllocationData {
  asset_class: string
  current_pct: number
  target_pct: number
  tolerance_band: number
  drift: number
  drift_status: 'OK' | 'WARNING' | 'BREACH'
}

interface GovernanceWidgetProps {
  assets: Asset[]
}

// Normalize asset_class to standard format (EQUITY -> Equity)
function normalizeAssetClass(assetClass: string | null | undefined): string | null {
  if (!assetClass) return null
  
  const upper = assetClass.toUpperCase()
  // Map common variations to standard format
  if (upper === 'EQUITY' || upper === 'STOCK' || upper === 'STOCKS') {
    return 'Equity'
  }
  if (upper === 'BOND' || upper === 'BONDS' || upper === 'FIXED_INCOME') {
    return 'Bond'
  }
  if (upper === 'CASH' || upper === 'CASH_EQUIVALENTS') {
    return 'Cash'
  }
  
  // Return capitalized version (first letter uppercase, rest lowercase)
  return assetClass.charAt(0).toUpperCase() + assetClass.slice(1).toLowerCase()
}

// Calculate drift status based on tolerance
function calculateDriftStatus(drift: number, toleranceBand: number): 'OK' | 'WARNING' | 'BREACH' {
  const absDrift = Math.abs(drift)
  const halfBand = toleranceBand / 2
  const fullBand = toleranceBand
  
  if (absDrift <= halfBand) {
    return 'OK'
  } else if (absDrift <= fullBand) {
    return 'WARNING'
  } else {
    return 'BREACH'
  }
}

export function GovernanceWidget({ assets }: GovernanceWidgetProps) {
  const [targets, setTargets] = useState<GovernanceTarget[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch governance targets for the main portfolio
  useEffect(() => {
    async function fetchTargets() {
      try {
        // First, get the first available portfolio_id
        const portfoliosResponse = await supabase
          .from('portfolios')
          .select('id')
          .limit(1)
          .single()
        
        if (portfoliosResponse.error || !portfoliosResponse.data) {
          console.warn('No portfolio found, skipping governance targets fetch')
          setLoading(false)
          return
        }
        
        const portfolioId = portfoliosResponse.data.id
        
        // Fetch governance targets for this portfolio
        const { data, error } = await supabase
          .from('governance_targets')
          .select('*')
          .eq('portfolio_id', portfolioId)
        
        if (error) throw error
        
        if (data) {
          setTargets(data as GovernanceTarget[])
        }
      } catch (err) {
        console.error('Error fetching governance targets:', err)
      } finally {
        setLoading(false)
      }
    }
    
    fetchTargets()
  }, [])

  // Calculate current allocation based on assets
  const allocationData = useMemo((): AllocationData[] => {
    if (!assets || assets.length === 0) return []
    
    // Calculate total portfolio value: Sum(price * quantity) for all assets
    const totalValue = assets.reduce((sum, asset) => {
      const price = asset.price || 0
      const quantity = asset.quantity || 1 // Default to 1 if quantity is null/undefined
      return sum + (price * quantity)
    }, 0)
    
    if (totalValue === 0) return []
    
    // Group assets by asset_class and calculate current allocation
    const allocationByClass = assets.reduce((acc, asset) => {
      // Use asset_class from database, normalize it
      let assetClass = normalizeAssetClass(asset.asset_class)
      
      // Fallback: if no asset_class, map from type (for backward compatibility)
      if (!assetClass) {
        const typeUpper = asset.type.toUpperCase()
        if (typeUpper === 'CASH') {
          assetClass = 'Cash'
        } else if (typeUpper === 'BOND' || typeUpper.includes('BOND')) {
          assetClass = 'Bond'
        } else {
          assetClass = 'Equity' // Default: Stock, STOCK, ETF, Crypto → Equity
        }
      }
      
      const price = asset.price || 0
      const quantity = asset.quantity || 1
      const value = price * quantity
      
      if (!acc[assetClass]) {
        acc[assetClass] = 0
      }
      acc[assetClass] += value
      
      return acc
    }, {} as Record<string, number>)
    
    // Create allocation data with targets
    const allocation: AllocationData[] = []
    
    // Normalize target asset_class names for matching
    const normalizedTargets = targets.map(target => ({
      ...target,
      normalized_class: normalizeAssetClass(target.asset_class) || target.asset_class
    }))
    
    // Process each target
    normalizedTargets.forEach(target => {
      // Try to match with normalized class name
      const normalizedClass = target.normalized_class
      const currentValue = allocationByClass[normalizedClass] || 0
      const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0
      const drift = currentPct - target.target_pct
      const driftStatus = calculateDriftStatus(drift, target.tolerance_band)
      
      allocation.push({
        asset_class: normalizedClass,
        current_pct: currentPct,
        target_pct: target.target_pct,
        tolerance_band: target.tolerance_band,
        drift: drift,
        drift_status: driftStatus
      })
    })
    
    // If no targets, show all asset classes found in the portfolio with current allocation
    if (allocation.length === 0) {
      Object.keys(allocationByClass).forEach(assetClass => {
        const currentValue = allocationByClass[assetClass] || 0
        const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0
        
        allocation.push({
          asset_class: assetClass,
          current_pct: currentPct,
          target_pct: 0, // No target set
          tolerance_band: 5, // Default tolerance
          drift: 0,
          drift_status: 'OK'
        })
      })
    }
    
    return allocation.sort((a, b) => a.asset_class.localeCompare(b.asset_class))
  }, [assets, targets])

  if (loading) {
    return (
      <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-blue-600 dark:text-[#00FF88]" />
          <h3 className="text-sm font-black text-slate-950 dark:text-white uppercase tracking-tighter">
            Governance Targets
          </h3>
        </div>
        <div className="text-center py-8 text-slate-500 dark:text-gray-400">
          Loading governance data...
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl p-6">
      <div className="flex items-center gap-2 mb-6">
        <Shield className="w-5 h-5 text-blue-600 dark:text-[#00FF88]" />
        <h3 className="text-sm font-black text-slate-950 dark:text-white uppercase tracking-tighter">
          Governance Targets
        </h3>
      </div>

      {allocationData.length === 0 ? (
        <div className="text-center py-8 text-slate-500 dark:text-gray-400 text-sm">
          No allocation data available
        </div>
      ) : (
        <div className="space-y-4">
          {allocationData.map((item) => {
            const driftAbs = Math.abs(item.drift)
            const isPositive = item.drift >= 0
            
            return (
              <div key={item.asset_class} className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-950 dark:text-white uppercase tracking-wider">
                    {item.asset_class}
                  </span>
                  <div className="flex items-center gap-2">
                    {/* Drift Badge */}
                    {item.target_pct > 0 && (
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider",
                        item.drift_status === 'OK'
                          ? "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-800/50"
                          : item.drift_status === 'WARNING'
                          ? "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800/50"
                          : "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800/50"
                      )}>
                        {item.drift_status === 'OK' && <CheckCircle2 className="w-2.5 h-2.5" />}
                        {item.drift_status === 'WARNING' && <AlertTriangle className="w-2.5 h-2.5" />}
                        {item.drift_status === 'BREACH' && <AlertTriangle className="w-2.5 h-2.5" />}
                        {item.drift_status === 'BREACH' ? 'Breach' : item.drift_status === 'WARNING' ? 'Warning' : 'OK'}
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Comparison: Current vs Target side-by-side */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Current Allocation */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                        Current
                      </span>
                      <span className="text-xs font-mono font-black text-slate-950 dark:text-white">
                        {item.current_pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="relative h-2.5 w-full bg-slate-200 dark:bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "absolute top-0 left-0 h-full transition-all duration-500",
                          item.target_pct > 0 && item.drift_status === 'OK'
                            ? "bg-green-500 dark:bg-green-400"
                            : item.target_pct > 0 && item.drift_status === 'WARNING'
                            ? "bg-amber-500 dark:bg-amber-400"
                            : item.target_pct > 0 && item.drift_status === 'BREACH'
                            ? "bg-red-500 dark:bg-red-400"
                            : "bg-blue-500 dark:bg-blue-400"
                        )}
                        style={{ width: `${Math.min(100, item.current_pct)}%` }}
                      />
                    </div>
                  </div>
                  
                  {/* Target Allocation */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                        Target
                      </span>
                      <span className="text-xs font-mono font-black text-slate-950 dark:text-white">
                        {item.target_pct > 0 ? `${item.target_pct.toFixed(1)}%` : 'N/A'}
                      </span>
                    </div>
                    <div className="relative h-2.5 w-full bg-slate-200 dark:bg-white/5 rounded-full overflow-hidden">
                      {item.target_pct > 0 ? (
                        <>
                          <div
                            className="absolute top-0 left-0 h-full bg-slate-400 dark:bg-gray-600 transition-all duration-500"
                            style={{ width: `${Math.min(100, item.target_pct)}%` }}
                          />
                          {/* Tolerance band indicator */}
                          <div
                            className="absolute top-0 h-full border-l border-r border-slate-600 dark:border-gray-500 opacity-30"
                            style={{
                              left: `${Math.max(0, item.target_pct - item.tolerance_band)}%`,
                              width: `${Math.min(100, item.tolerance_band * 2)}%`
                            }}
                          />
                        </>
                      ) : (
                        <div className="absolute top-0 left-0 h-full w-full flex items-center justify-center">
                          <span className="text-[8px] text-slate-400 dark:text-gray-500">No target</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Drift info */}
                {item.target_pct > 0 && (
                  <div className="flex items-center justify-between text-[9px] text-slate-500 dark:text-gray-400 pt-1">
                    <span>
                      Drift: <span className={cn(
                        "font-black",
                        item.drift_status === 'OK'
                          ? "text-green-600 dark:text-green-400"
                          : item.drift_status === 'WARNING'
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-red-600 dark:text-red-400"
                      )}>
                        {isPositive ? '+' : ''}{item.drift.toFixed(2)}%
                      </span>
                    </span>
                    <span>
                      Tolerance: ±{item.tolerance_band.toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
