"use client"

import React, { useMemo } from 'react';
import { Asset } from '../types';
import { PerformanceCell } from './PerformanceCell';
import { AlertCircle } from 'lucide-react';
import { DataTrustBadge } from './DataTrustBadge';
import { cn } from '../lib/utils';

interface AssetTableProps {
  assets: Asset[];
  onHoverAsset: (asset: Asset | null) => void;
  onSelectAsset: (asset: Asset) => void;
  selectedAssetId: string | null;
  groupByClass?: boolean;
  currencyFilter?: string;
}

export function AssetTable({ assets, onHoverAsset, onSelectAsset, selectedAssetId, groupByClass = false, currencyFilter = "ALL" }: AssetTableProps) {
  const hasMissingData = (asset: Asset): boolean => {
    return asset.price === null || asset.price === 0 || asset.price === undefined;
  }

  // Calculate volatility (annualized % based on performance variance)
  const calculateVolatility = (asset: Asset): number => {
    const perf = asset.performance
    const values = [
      perf?.day?.value || 0,
      perf?.week?.value || 0,
      perf?.month?.value || 0,
      perf?.ytd?.value || 0,
    ].filter(v => v !== 0)
    
    if (values.length === 0) return 0
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
    const stdDev = Math.sqrt(variance)
    
    // Annualize: multiply by sqrt(252) for daily, but we're using mixed periods
    // Simplified: use stdDev * 16 (rough annualization factor)
    return Math.abs(stdDev * 16)
  }

  // Filter and group assets
  const processedAssets = useMemo(() => {
    let filtered = assets

    // Apply currency filter
    if (currencyFilter !== "ALL") {
      filtered = filtered.filter(asset => asset.currency === currencyFilter)
    }

    // Group by asset class if enabled
    if (groupByClass) {
      const grouped = filtered.reduce((acc, asset) => {
        const type = asset.type.toUpperCase()
        if (!acc[type]) acc[type] = []
        acc[type].push(asset)
        return acc
      }, {} as Record<string, Asset[]>)

      // Flatten grouped assets with headers
      const result: (Asset | { isHeader: true; type: string })[] = []
      Object.entries(grouped).forEach(([type, assets]) => {
        result.push({ isHeader: true, type })
        result.push(...assets.sort((a, b) => a.name.localeCompare(b.name)))
      })
      return result
    }

    return filtered
  }, [assets, groupByClass, currencyFilter])

  return (
    <div className="w-full h-full overflow-auto bg-white dark:bg-[#080A0F] transition-colors duration-300">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-[#0D1117] border-b-2 border-slate-300 dark:border-[#1a1d24]">
          <tr>
            <th className="p-4 text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest w-[260px]">Asset / Ticker</th>
            <th className="p-4 text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest text-center border-l border-slate-200 dark:border-[#1a1d24]">Day</th>
            <th className="p-4 text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest text-center border-l border-slate-200 dark:border-[#1a1d24]">Week</th>
            <th className="p-4 text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest text-center border-l border-slate-200 dark:border-[#1a1d24]">Month</th>
            <th className="p-4 text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest text-center border-l border-slate-200 dark:border-[#1a1d24]">YTD</th>
            <th className="p-4 text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest text-center border-l border-slate-200 dark:border-[#1a1d24]">Volatility</th>
            <th className="p-4 text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest text-center border-l border-slate-200 dark:border-[#1a1d24]">Trend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-[#1a1d24]">
          {processedAssets.map((item) => {
            // Handle group headers
            if ('isHeader' in item && item.isHeader) {
              return (
                <tr key={`header-${item.type}`} className="bg-slate-100 dark:bg-[#0D1117]">
                  <td colSpan={7} className="p-3 border-b-2 border-slate-300 dark:border-[#1a1d24]">
                    <span className="text-[10px] font-black text-slate-950 dark:text-white uppercase tracking-widest">
                      {item.type}
                    </span>
                  </td>
                </tr>
              )
            }

            const asset = item as Asset
            const missingData = hasMissingData(asset);
            const isSelected = selectedAssetId === asset.id;
            const volatility = asset.technical?.volatility_30d ?? calculateVolatility(asset);
            const trendState = asset.technical?.trend_state ?? 'UNKNOWN'
            const trendChanged = asset.technical?.trend_changed ?? false
            const quantityCurrent = asset.quantity_current ?? asset.quantity ?? null
            const targetWeight = asset.target_weight_pct
            const hasPortfolioBookData =
              quantityCurrent !== null ||
              asset.pru !== null ||
              targetWeight !== null
            
            return (
              <tr 
                key={asset.id} 
                className={cn(
                  "transition-all duration-200 group cursor-pointer",
                  isSelected
                    ? "bg-blue-100 dark:bg-[#00FF88]/10 border-l-4 border-l-blue-600 dark:border-l-[#00FF88]"
                    : "hover:bg-blue-50/50 dark:hover:bg-white/5"
                )}
                onMouseEnter={() => onHoverAsset(asset)} 
                onMouseLeave={() => onHoverAsset(null)}
                onClick={() => onSelectAsset(asset)}
              >
                <td className="p-4 border-r border-slate-200 dark:border-[#1a1d24]">
                  <div className="flex flex-col">
                    <div className="flex justify-between items-baseline gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="text-sm font-black text-slate-950 dark:text-gray-100 truncate">{asset.name}</span>
                        {missingData && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 flex-shrink-0">
                            <AlertCircle className="w-2.5 h-2.5" />
                            Check Ticker
                          </span>
                        )}
                        {/* Data Trust Badge */}
                        <DataTrustBadge status={asset.data_status} lastUpdate={asset.last_update} />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-gray-500 flex-shrink-0">{asset.ticker}</span>
                    </div>
                    <div className="flex justify-between items-baseline mt-1">
                      <span className="text-[9px] font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest">
                        {asset.type}
                        {asset.portfolio_ids && asset.portfolio_ids.length > 1 ? ` · ${asset.portfolio_ids.length}PF` : ''}
                      </span>
                      <span className={`text-xs font-mono font-black ${missingData ? 'text-amber-600 dark:text-amber-500' : 'text-slate-950 dark:text-gray-200'}`}>
                        {missingData ? 'N/A' : (asset.price ?? 0).toLocaleString('fr-FR')} <span className="text-[9px] font-bold text-slate-500 dark:text-gray-500">{asset.currency}</span>
                      </span>
                    </div>
                    {hasPortfolioBookData && (
                      <div className="mt-1 text-[9px] font-mono text-slate-500 dark:text-gray-500 flex items-center justify-between gap-2">
                        <span>
                          QTY {quantityCurrent !== null ? quantityCurrent.toLocaleString('fr-FR', { maximumFractionDigits: 4 }) : '--'}
                        </span>
                        <span>
                          PRU {asset.pru !== null && asset.pru !== undefined ? asset.pru.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}
                        </span>
                        <span>
                          TG {targetWeight !== null && targetWeight !== undefined ? `${targetWeight.toFixed(1)}%` : '--'}
                        </span>
                      </div>
                    )}
                  </div>
                </td>
                <td className="p-0 border-r border-slate-200 dark:border-[#1a1d24] w-28"><PerformanceCell data={asset.performance.day} /></td>
                <td className="p-0 border-r border-slate-200 dark:border-[#1a1d24] w-28"><PerformanceCell data={asset.performance.week} /></td>
                <td className="p-0 border-r border-slate-200 dark:border-[#1a1d24] w-28"><PerformanceCell data={asset.performance.month} /></td>
                <td className="p-0 border-r border-slate-200 dark:border-[#1a1d24] w-28"><PerformanceCell data={asset.performance.ytd} /></td>
                <td className="p-4 text-center border-l border-slate-200 dark:border-[#1a1d24]">
                  <span className={cn(
                    "text-xs font-mono font-black",
                    volatility > 30 ? "text-red-600 dark:text-red-400" :
                    volatility > 20 ? "text-amber-600 dark:text-amber-400" :
                    "text-slate-950 dark:text-white"
                  )}>
                    {volatility > 0 ? `${volatility.toFixed(1)}%` : 'N/A'}
                  </span>
                </td>
                <td className="p-4 text-center border-l border-slate-200 dark:border-[#1a1d24]">
                  <div className="flex flex-col items-center gap-1">
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border",
                      trendState === 'BULLISH'
                        ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800/60"
                        : trendState === 'BEARISH'
                        ? "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/60"
                        : trendState === 'UNKNOWN'
                        ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/60"
                        : "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/40 dark:text-gray-400 dark:border-slate-700"
                    )}>
                      {trendState}
                    </span>
                    {trendChanged && (
                      <span className="text-[9px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                        Change
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
