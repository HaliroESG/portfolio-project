import React from 'react'
import { LineSeries } from './BacktestChart'
import { FullscreenChartButton } from './FullscreenChart'

interface DrawdownChartProps {
  dates: string[]
  series: LineSeries[]
  title?: string
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function buildLinePath(values: number[], getX: (index: number) => number, getY: (value: number) => number): string {
  return values
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${getX(index)} ${getY(value)}`)
    .join(' ')
}

export function DrawdownChart({ dates, series, title = 'Drawdown' }: DrawdownChartProps) {
  if (dates.length === 0 || series.length === 0) {
    return (
      <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl p-6">
        <div className="text-sm font-black text-slate-500 dark:text-gray-400 uppercase tracking-wider">{title}</div>
        <div className="mt-4 text-xs text-slate-500 dark:text-gray-400">No drawdown data.</div>
      </div>
    )
  }

  const width = 720
  const height = 200
  const paddingX = 24
  const top = 18
  const bottom = 170

  const allValues = series.flatMap((s) => s.values)
  const min = Math.min(...allValues, 0)
  const max = Math.max(...allValues, 0)
  const safeRange = Math.max(0.01, max - min)

  const getX = (index: number) => {
    const ratio = dates.length > 1 ? index / (dates.length - 1) : 0
    return paddingX + ratio * (width - paddingX * 2)
  }

  const getY = (value: number) => {
    const ratio = (value - min) / safeRange
    return bottom - ratio * (bottom - top)
  }

  const zeroY = getY(0)
  const legend = (
    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-500 dark:text-gray-400">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }}></span>
          {s.label}
        </span>
      ))}
    </div>
  )
  const renderChartSvg = (heightClass: string) => (
    <svg viewBox={`0 0 ${width} ${height}`} className={`w-full ${heightClass}`}>
      <line x1={paddingX} x2={width - paddingX} y1={zeroY} y2={zeroY} stroke="#64748b" strokeDasharray="4 4" />
      {series.map((s) => {
        const linePath = buildLinePath(s.values, getX, getY)
        return (
          <path key={s.key} d={linePath} fill="none" stroke={s.color} strokeWidth="2.2" />
        )
      })}
      <text x="10" y="14" className="fill-slate-500 dark:fill-gray-500 text-[9px] font-mono">
        {max.toFixed(2)}
      </text>
      <text x="10" y="190" className="fill-slate-500 dark:fill-gray-500 text-[9px] font-mono">
        {min.toFixed(2)}
      </text>
    </svg>
  )

  return (
    <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-black text-slate-950 dark:text-white uppercase tracking-tighter">{title}</div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-gray-500 uppercase tracking-wider">
            {formatDate(dates[0])} → {formatDate(dates[dates.length - 1])}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {legend}
          <FullscreenChartButton title={title}>
            <div className="space-y-4">
              {legend}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-white/5 dark:bg-[#080A0F]">
                {renderChartSvg('h-[70vh] min-h-[420px]')}
              </div>
            </div>
          </FullscreenChartButton>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#080A0F] p-3">
        {renderChartSvg('h-48')}
      </div>
    </div>
  )
}
