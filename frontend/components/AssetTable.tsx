"use client"

import React from 'react';
import { Asset } from '../types';
import { PerformanceCell } from './PerformanceCell';
import { AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';

interface AssetTableProps {
  assets: Asset[];
  onHoverAsset: (asset: Asset | null) => void;
  onSelectAsset: (asset: Asset) => void;
  selectedAssetId: string | null;
}

export function AssetTable({ assets, onHoverAsset, onSelectAsset, selectedAssetId }: AssetTableProps) {
  const hasMissingData = (asset: Asset): boolean => {
    return asset.price === null || asset.price === 0 || asset.price === undefined;
  }

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
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-[#1a1d24]">
          {assets.map((asset) => {
            const missingData = hasMissingData(asset);
            const isSelected = selectedAssetId === asset.id;
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
                      </div>
                      <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-gray-500 flex-shrink-0">{asset.ticker}</span>
                    </div>
                    <div className="flex justify-between items-baseline mt-1">
                      <span className="text-[9px] font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest">{asset.type}</span>
                      <span className={`text-xs font-mono font-black ${missingData ? 'text-amber-600 dark:text-amber-500' : 'text-slate-950 dark:text-gray-200'}`}>
                        {missingData ? 'N/A' : (asset.price ?? 0).toLocaleString('fr-FR')} <span className="text-[9px] font-bold text-slate-500 dark:text-gray-500">{asset.currency}</span>
                      </span>
                    </div>
                  </div>
                </td>
                <td className="p-0 border-r border-slate-200 dark:border-[#1a1d24] w-28"><PerformanceCell data={asset.performance.day} /></td>
                <td className="p-0 border-r border-slate-200 dark:border-[#1a1d24] w-28"><PerformanceCell data={asset.performance.week} /></td>
                <td className="p-0 border-r border-slate-200 dark:border-[#1a1d24] w-28"><PerformanceCell data={asset.performance.month} /></td>
                <td className="p-0 w-28"><PerformanceCell data={asset.performance.ytd} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}