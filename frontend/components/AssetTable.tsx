"use client"

import React from 'react';
import { Asset } from '../types';
import { PerformanceCell } from './PerformanceCell';
import { AlertCircle } from 'lucide-react';

interface AssetTableProps {
  assets: Asset[];
  onHoverAsset: (asset: Asset | null) => void;
}

export function AssetTable({ assets, onHoverAsset }: AssetTableProps) {
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
            return (
              <tr 
                key={asset.id} 
                className="hover:bg-blue-50/50 dark:hover:bg-white/5 transition-colors duration-200 group cursor-pointer" 
                onMouseEnter={() => onHoverAsset(asset)} 
                onMouseLeave={() => onHoverAsset(null)}
              >
                <td className="p-4 border-r border-slate-200 dark:border-[#1a1d24]">
                  <div className="flex flex-col">
                    <div className="flex justify-between items-baseline gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="text-sm font-black text-slate-950 dark:text-gray-100 truncate">{asset.name}</span>
                        {missingData && (
                          <div className="group/icon relative flex-shrink-0">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                            <div className="absolute left-0 top-full mt-1 hidden group-hover/icon:block z-20">
                              <div className="bg-slate-950 dark:bg-slate-800 text-white text-[9px] font-mono px-2 py-1 rounded border border-slate-700 whitespace-nowrap shadow-xl">
                                Ticker Error: Check Yahoo Finance Symbol
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-gray-500 flex-shrink-0">{asset.ticker}</span>
                    </div>
                    <div className="flex justify-between items-baseline mt-1">
                      <span className="text-[9px] font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest">{asset.type}</span>
                      <span className={`text-xs font-mono font-black ${missingData ? 'text-slate-400 dark:text-gray-600' : 'text-slate-950 dark:text-gray-200'}`}>
                        {missingData ? '--' : (asset.price ?? 0).toLocaleString('fr-FR')} <span className="text-[9px] font-bold text-slate-500 dark:text-gray-500">{asset.currency}</span>
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