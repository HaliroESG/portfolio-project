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
  selectedPortfolioId?: string
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

// Calculate drift status based on tolerance (PRD Step 2 logic)
// 🟢 OK: |Drift| <= B
// 🟠 WARNING: |Drift| > B/2 ET |Drift| <= B (Zone de prudence)
// 🔴 BREACH: |Drift| > B (Violation de règle)
function calculateDriftStatus(drift: number, toleranceBand: number): 'OK' | 'WARNING' | 'BREACH' {
  const absDrift = Math.abs(drift)
  const halfBand = toleranceBand / 2
  
  if (absDrift <= toleranceBand) {
    // Check if within first 50% of band (OK) or second 50% (WARNING)
    if (absDrift <= halfBand) {
      return 'OK'
    } else {
      return 'WARNING'
    }
  } else {
    return 'BREACH'
  }
}

export function GovernanceWidget({ assets, selectedPortfolioId = 'ALL' }: GovernanceWidgetProps) {
  const [targets, setTargets] = useState<GovernanceTarget[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch governance targets for the main portfolio
  useEffect(() => {
    async function fetchTargets() {
      try {
        let portfolioId = selectedPortfolioId

        if (portfolioId === 'ALL') {
          const portfoliosResponse = await supabase
            .from('portfolios')
            .select('id')
            .limit(1)
            .single()

          if (portfoliosResponse.error || !portfoliosResponse.data) {
            console.warn('No portfolio found, skipping governance targets fetch')
            setTargets([])
            setLoading(false)
            return
          }

          portfolioId = portfoliosResponse.data.id
        }
        
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
  }, [selectedPortfolioId])

  // Calculate current allocation based on assets (PRD Step 2)
  const { allocationData, hasBreach, totalTargetPct, unknownPct } = useMemo(() => {
    if (!assets || assets.length === 0) {
      return {
        allocationData: [] as AllocationData[],
        hasBreach: false,
        totalTargetPct: 0,
        unknownPct: 0
      }
    }
    
    // 1. Calculate total portfolio value: Sum(price * quantity) for all assets
    const totalValue = assets.reduce((sum, asset) => {
      const price = asset.price || 0
      const quantity = asset.quantity || 1 // Default to 1 if quantity is null/undefined
      return sum + (price * quantity)
    }, 0)
    
    if (totalValue === 0) {
      return {
        allocationData: [] as AllocationData[],
        hasBreach: false,
        totalTargetPct: 0,
        unknownPct: 0
      }
    }
    
    // 2. Group assets by asset_class and calculate current allocation
    const allocationByClass = assets.reduce((acc, asset) => {
      // Use asset_class from database, normalize it
      let assetClass = normalizeAssetClass(asset.asset_class)
      
      // Gestion des cas limites : Si pas de classe, utiliser "UNKNOWN"
      if (!assetClass) {
        assetClass = 'UNKNOWN'
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
    
    // Calculate UNKNOWN percentage for alert
    const unknownValue = allocationByClass['UNKNOWN'] || 0
    const unknownPct = totalValue > 0 ? (unknownValue / totalValue) * 100 : 0
    
    // 3. Create allocation data with targets
    const allocation: AllocationData[] = []
    
    // Normalize target asset_class names for matching
    const normalizedTargets = targets.map(target => ({
      ...target,
      normalized_class: normalizeAssetClass(target.asset_class) || target.asset_class
    }))
    
    // Calculate total target percentage for validation
    const totalTargetPct = normalizedTargets.reduce((sum, target) => sum + target.target_pct, 0)
    
    // Process each target
    let hasBreach = false
    normalizedTargets.forEach(target => {
      // Try to match with normalized class name
      const normalizedClass = target.normalized_class
      const currentValue = allocationByClass[normalizedClass] || 0
      const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0
      const drift = currentPct - target.target_pct
      const driftStatus = calculateDriftStatus(drift, target.tolerance_band)
      
      if (driftStatus === 'BREACH') {
        hasBreach = true
      }
      
      allocation.push({
        asset_class: normalizedClass,
        current_pct: currentPct,
        target_pct: target.target_pct,
        tolerance_band: target.tolerance_band,
        drift: drift,
        drift_status: driftStatus
      })
    })
    
    // Add UNKNOWN class if it exists (for alert display)
    if (allocationByClass['UNKNOWN'] && allocationByClass['UNKNOWN'] > 0) {
      allocation.push({
        asset_class: 'UNKNOWN',
        current_pct: unknownPct,
        target_pct: 0,
        tolerance_band: 0,
        drift: unknownPct,
        drift_status: unknownPct > 10 ? 'BREACH' : 'WARNING'
      })
      if (unknownPct > 10) {
        hasBreach = true
      }
    }
    
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
    
    return {
      allocationData: allocation.sort((a, b) => a.asset_class.localeCompare(b.asset_class)),
      hasBreach,
      totalTargetPct,
      unknownPct
    }
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

      {/* Global Alert: Portfolio Non-Compliant */}
      {hasBreach && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
            <span className="text-xs font-black text-red-700 dark:text-red-400 uppercase tracking-wider">
              ⚠️ Portfolio Non-Compliant
            </span>
          </div>
        </div>
      )}

      {/* Configuration Error: Total targets != 100% */}
      {targets.length > 0 && Math.abs(totalTargetPct - 100) > 0.1 && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-black text-amber-700 dark:text-amber-400 uppercase tracking-wider">
              Configuration Error: Total Targets = {totalTargetPct.toFixed(1)}% (Expected 100%)
            </span>
          </div>
        </div>
      )}

      {/* UNKNOWN Assets Alert */}
      {unknownPct > 10 && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
            <span className="text-xs font-black text-red-700 dark:text-red-400 uppercase tracking-wider">
              ⚠️ UNKNOWN Assets: {unknownPct.toFixed(1)}% (Exceeds 10% threshold)
            </span>
          </div>
        </div>
      )}

      {allocationData.length === 0 ? (
        <div className="text-center py-8 text-slate-500 dark:text-gray-400 text-sm">
          No allocation data available
        </div>
      ) : (
        <div className="space-y-4">
          {allocationData.map((item) => {
            const isPositive = item.drift >= 0
            
            return (
              <div key={item.asset_class} className="space-y-3">
                {/* Header with Asset Class and Status Badge */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-950 dark:text-white uppercase tracking-wider">
                    {item.asset_class}
                  </span>
                  {/* Status Badge/Chip with Drift */}
                  {item.target_pct > 0 ? (
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
                      {isPositive ? '+' : ''}{item.drift.toFixed(1)}% Drift
                    </span>
                  ) : item.asset_class === 'UNKNOWN' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800/50">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      {item.current_pct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800/50 text-slate-500 dark:text-gray-400 border border-slate-300 dark:border-slate-700">
                      No Target
                    </span>
                  )}
                </div>
                
                {/* Progress Bar with Current Allocation */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                      Current Allocation
                    </span>
                    <span className="text-xs font-mono font-black text-slate-950 dark:text-white">
                      {item.current_pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="relative h-3 w-full bg-slate-200 dark:bg-white/5 rounded-full overflow-hidden">
                    {/* Current allocation bar */}
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
                    {/* Target indicator (vertical line) */}
                    {item.target_pct > 0 && (
                      <div
                        className="absolute top-0 h-full w-0.5 bg-slate-600 dark:bg-gray-400 z-10"
                        style={{ left: `${Math.min(100, item.target_pct)}%` }}
                      />
                    )}
                    {/* Tolerance band indicator (subtle background) */}
                    {item.target_pct > 0 && (
                      <div
                        className="absolute top-0 h-full border-l border-r border-slate-400 dark:border-gray-600 opacity-20 z-0"
                        style={{
                          left: `${Math.max(0, item.target_pct - item.tolerance_band)}%`,
                          width: `${Math.min(100, item.tolerance_band * 2)}%`
                        }}
                      />
                    )}
                  </div>
                </div>
                
                {/* Target Display */}
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                    Target:
                  </span>
                  {item.target_pct > 0 ? (
                    <span className="text-xs font-mono font-black text-slate-950 dark:text-white">
                      {item.target_pct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-slate-400 dark:text-gray-500">
                      No Target
                    </span>
                  )}
                </div>
                
                {/* Drift info (only if target exists) */}
                {item.target_pct > 0 && (
                  <div className="flex items-center justify-between text-[9px] text-slate-500 dark:text-gray-400 pt-1 border-t border-slate-200 dark:border-white/5">
                    <span>
                      Drift: <span className={cn(
                        "font-black",
                        item.drift_status === 'OK'
                          ? "text-green-600 dark:text-green-400"
                          : item.drift_status === 'WARNING'
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-red-600 dark:text-red-400"
                      )}>
                        {isPositive ? '+' : ''}{item.drift.toFixed(1)}%
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
