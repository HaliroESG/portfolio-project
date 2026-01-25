import React from 'react';
import { PerformanceData } from '../types';
import { formatPercent } from '../utils/formatters';
interface PerformanceCellProps {
  data: PerformanceData;
}
export function PerformanceCell({
  data
}: PerformanceCellProps) {
  const {
    value,
    currencyImpact
  } = data;
  const totalReturn = value + currencyImpact;
  // Heatmap logic - Pure Green/Red scale
  let bgColor = 'bg-transparent';
  let textColor = 'text-gray-400';
  // Stronger thresholds for visual impact
  if (value >= 3) {
    bgColor = 'bg-[#00FF88]/10';
    textColor = 'text-[#00FF88]';
  } else if (value <= -3) {
    bgColor = 'bg-[#FF3366]/10';
    textColor = 'text-[#FF3366]';
  } else if (value > 0) {
    textColor = 'text-[#00FF88]';
  } else if (value < 0) {
    textColor = 'text-[#FF3366]';
  }
  return <div className={`h-full w-full p-2 flex flex-col justify-center items-end ${bgColor} transition-colors duration-200`}>
      <span className={`text-xs font-mono font-bold ${textColor}`}>
        {formatPercent(value)}
      </span>
      <div className="flex items-center space-x-1 mt-0.5">
        <span className="text-[9px] text-gray-600 uppercase">EUR</span>
        <span className={`text-[10px] font-mono ${totalReturn >= 0 ? 'text-gray-400' : 'text-gray-500'}`}>
          {formatPercent(totalReturn)}
        </span>
      </div>
    </div>;
}