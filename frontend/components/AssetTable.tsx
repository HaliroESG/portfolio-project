"use client"

import React, { useMemo, useState } from 'react';
import { Asset } from '../types';
import { PerformanceCell } from './PerformanceCell';
import { AlertCircle, ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
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

type AssetSortKey = 'asset' | 'day' | 'week' | 'month' | 'ytd' | 'volatility' | 'trend'
type SortDirection = 'asc' | 'desc'
type GroupHeader = { isHeader: true; type: string }
type ProcessedAsset = Asset | GroupHeader

const TREND_SORT_RANK = {
  BULLISH: 5,
  NEUTRAL: 4,
  BEARISH: 3,
  INSUFFICIENT_HISTORY: 2,
  UNKNOWN: 1,
} as const

function sortIcon(active: boolean, direction: SortDirection) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-50" />
  return direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

function SortHeader({
  label,
  sortKey,
  activeSortKey,
  direction,
  align = 'left',
  className,
  onSort,
}: {
  label: string
  sortKey: AssetSortKey
  activeSortKey: AssetSortKey
  direction: SortDirection
  align?: 'left' | 'center'
  className?: string
  onSort: (sortKey: AssetSortKey) => void
}) {
  const active = activeSortKey === sortKey

  return (
    <th
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(
        "p-0 text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest",
        className
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "flex w-full items-center gap-1.5 p-4 transition-colors hover:bg-slate-200/70 dark:hover:bg-white/5",
          align === 'center' ? 'justify-center text-center' : 'justify-start text-left',
          active && 'text-blue-700 dark:text-[#00FF88]'
        )}
      >
        <span>{label}</span>
        {sortIcon(active, direction)}
      </button>
    </th>
  )
}

function hasMissingData(asset: Asset): boolean {
  return asset.price === null || asset.price === 0 || asset.price === undefined
}

// Calculate volatility (annualized % based on performance variance)
function calculateVolatility(asset: Asset): number {
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

  // Simplified annualization for mixed periods.
  return Math.abs(stdDev * 16)
}

export function AssetTable({ assets, onHoverAsset, onSelectAsset, selectedAssetId, groupByClass = false, currencyFilter = "ALL" }: AssetTableProps) {
  const [sortKey, setSortKey] = useState<AssetSortKey>('asset')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const handleSort = (nextSortKey: AssetSortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortKey(nextSortKey)
    setSortDirection(nextSortKey === 'asset' || nextSortKey === 'trend' ? 'asc' : 'desc')
  }

  // Filter and group assets
  const processedAssets = useMemo(() => {
    const compareAssets = (left: Asset, right: Asset): number => {
      const direction = sortDirection === 'asc' ? 1 : -1
      let result = 0

      if (sortKey === 'asset') {
        result = left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
        if (result === 0) result = left.ticker.localeCompare(right.ticker, 'en', { sensitivity: 'base' })
        return result * direction
      }

      if (sortKey === 'day') result = left.performance.day.value - right.performance.day.value
      if (sortKey === 'week') result = left.performance.week.value - right.performance.week.value
      if (sortKey === 'month') result = left.performance.month.value - right.performance.month.value
      if (sortKey === 'ytd') result = left.performance.ytd.value - right.performance.ytd.value
      if (sortKey === 'volatility') result = (left.technical?.volatility_30d ?? calculateVolatility(left)) - (right.technical?.volatility_30d ?? calculateVolatility(right))
      if (sortKey === 'trend') {
        const leftRank = TREND_SORT_RANK[left.technical?.trend_state ?? 'UNKNOWN']
        const rightRank = TREND_SORT_RANK[right.technical?.trend_state ?? 'UNKNOWN']
        result = leftRank - rightRank
      }

      if (result === 0) {
        result = left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
      }
      return result * direction
    }

    let filtered = [...assets]

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
      const result: ProcessedAsset[] = []
      Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right)).forEach(([type, groupedAssets]) => {
        result.push({ isHeader: true, type })
        result.push(...[...groupedAssets].sort(compareAssets))
      })
      return result
    }

    return filtered.sort(compareAssets)
  }, [assets, groupByClass, currencyFilter, sortKey, sortDirection])

  return (
    <div className="w-full h-full overflow-auto bg-white dark:bg-[#080A0F] transition-colors duration-300">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-[#0D1117] border-b-2 border-slate-300 dark:border-[#1a1d24]">
          <tr>
            <SortHeader label="Asset / Ticker" sortKey="asset" activeSortKey={sortKey} direction={sortDirection} className="w-[260px]" onSort={handleSort} />
            <SortHeader label="Day" sortKey="day" activeSortKey={sortKey} direction={sortDirection} align="center" className="border-l border-slate-200 dark:border-[#1a1d24]" onSort={handleSort} />
            <SortHeader label="Week" sortKey="week" activeSortKey={sortKey} direction={sortDirection} align="center" className="border-l border-slate-200 dark:border-[#1a1d24]" onSort={handleSort} />
            <SortHeader label="Month" sortKey="month" activeSortKey={sortKey} direction={sortDirection} align="center" className="border-l border-slate-200 dark:border-[#1a1d24]" onSort={handleSort} />
            <SortHeader label="YTD" sortKey="ytd" activeSortKey={sortKey} direction={sortDirection} align="center" className="border-l border-slate-200 dark:border-[#1a1d24]" onSort={handleSort} />
            <SortHeader label="Volatility" sortKey="volatility" activeSortKey={sortKey} direction={sortDirection} align="center" className="border-l border-slate-200 dark:border-[#1a1d24]" onSort={handleSort} />
            <SortHeader label="Trend" sortKey="trend" activeSortKey={sortKey} direction={sortDirection} align="center" className="border-l border-slate-200 dark:border-[#1a1d24]" onSort={handleSort} />
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
            const trendStateLabel =
              trendState === 'INSUFFICIENT_HISTORY'
                ? 'NO HISTORY'
                : trendState === 'NEUTRAL'
                ? 'NEUTRAL (RULE)'
                : trendState
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
                        : trendState === 'INSUFFICIENT_HISTORY'
                        ? "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800/60"
                        : "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/40 dark:text-gray-400 dark:border-slate-700"
                    )}>
                      {trendStateLabel}
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
