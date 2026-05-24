"use client"

import React, { useMemo, useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, LineChart } from 'lucide-react'
import type { PriceHistoryCurrencyMode, PriceHistoryHorizon, RegressionScaleMode } from '../types'
import { supabase } from '../lib/supabase'
import { SWR_REFRESH, swrOptions } from '../lib/swrConfig'
import {
  buildDisplayPriceSeries,
  getPriceHistoryStartDate,
  loadAssetPriceHistory,
} from '../lib/priceHistory'
import {
  MA200_WINDOW,
  REGRESSION_MIN_POINTS,
  computeRegressionChartModel,
} from '../lib/regressionChart'
import type { RegressionChartModel } from '../lib/regressionChart'
import { cn } from '../lib/utils'
import { FullscreenChartButton } from './FullscreenChart'

const HORIZONS: PriceHistoryHorizon[] = ['5Y', '10Y', 'MAX']
const MODES: { key: PriceHistoryCurrencyMode; label: string }[] = [
  { key: 'LOCAL', label: 'Local' },
  { key: 'EUR', label: 'EUR' },
]
const SCALES: { key: RegressionScaleMode; label: string }[] = [
  { key: 'LOG', label: 'Log' },
  { key: 'LINEAR', label: 'Lin' },
]

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function formatCompactDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('fr-FR', { month: '2-digit', year: '2-digit' })
}

function formatPrice(value: number, currency: string): string {
  return `${value.toLocaleString('fr-FR', {
    minimumFractionDigits: value >= 100 ? 2 : 3,
    maximumFractionDigits: value >= 100 ? 2 : 3,
  })} ${currency}`
}

function formatPct(value: number | null): string {
  if (value === null) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatZScore(value: number | null): string {
  if (value === null) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}σ`
}

function daysSince(value: string): number | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Math.floor((Date.now() - date.getTime()) / 86_400_000)
}

function pathFromPoints<T>(
  points: T[],
  getPoint: (point: T, index: number) => { x: number; y: number } | null,
): string {
  let path = ''
  let active = false
  points.forEach((point, index) => {
    const plotted = getPoint(point, index)
    if (!plotted) {
      active = false
      return
    }
    path += `${active ? ' L' : ' M'} ${plotted.x.toFixed(2)} ${plotted.y.toFixed(2)}`
    active = true
  })
  return path.trim()
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '')
}

interface RegressionChartGeometry {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
}

interface RegressionRenderChart extends RegressionChartGeometry {
  points: RegressionChartModel['points']
  getX: (index: number) => number
  getY: (price: number) => number
  pricePath: string
  regressionPath: string
  plus1Path: string
  plus2Path: string
  minus1Path: string
  minus2Path: string
  ma200Path: string
  band2Path: string
  band1Path: string
  yTicks: Array<{ price: number; y: number }>
  xTicks: Array<{ date: string; x: number }>
}

function buildRegressionRenderChart(
  model: RegressionChartModel,
  scaleMode: RegressionScaleMode,
  showMa200: boolean,
  geometry: RegressionChartGeometry,
): RegressionRenderChart {
  const { width, height, left, right, top, bottom } = geometry
  const points = model.points

  const prices = points.flatMap((point) => [
    point.price,
    point.regression,
    point.plus1,
    point.plus2,
    point.minus1,
    point.minus2,
    showMa200 ? point.ma200 : null,
  ]).filter((value): value is number => value !== null && value > 0 && Number.isFinite(value))

  const toScaleValue = (price: number) => scaleMode === 'LOG' ? Math.log(price) : price
  const scaleValues = prices.map(toScaleValue)
  const minScale = Math.min(...scaleValues)
  const maxScale = Math.max(...scaleValues)
  const padding = Math.max((maxScale - minScale) * 0.06, 0.0001)
  const yMin = minScale - padding
  const yMax = maxScale + padding
  const yRange = Math.max(yMax - yMin, 0.0001)

  const getX = (index: number) => {
    const ratio = points.length > 1 ? index / (points.length - 1) : 0
    return left + ratio * (width - left - right)
  }
  const getY = (price: number) => {
    const scaled = toScaleValue(price)
    const ratio = (scaled - yMin) / yRange
    return bottom - ratio * (bottom - top)
  }

  const pricePath = pathFromPoints(points, (point, index) => ({ x: getX(index), y: getY(point.price) }))
  const regressionPath = pathFromPoints(points, (point, index) => ({ x: getX(index), y: getY(point.regression) }))
  const plus1Path = pathFromPoints(points, (point, index) => point.plus1 ? { x: getX(index), y: getY(point.plus1) } : null)
  const plus2Path = pathFromPoints(points, (point, index) => point.plus2 ? { x: getX(index), y: getY(point.plus2) } : null)
  const minus1Path = pathFromPoints(points, (point, index) => point.minus1 ? { x: getX(index), y: getY(point.minus1) } : null)
  const minus2Path = pathFromPoints(points, (point, index) => point.minus2 ? { x: getX(index), y: getY(point.minus2) } : null)
  const ma200Path = pathFromPoints(points, (point, index) => point.ma200 ? { x: getX(index), y: getY(point.ma200) } : null)

  const band2Top = points
    .map((point, index) => point.plus2 ? `${index === 0 ? 'M' : 'L'} ${getX(index).toFixed(2)} ${getY(point.plus2).toFixed(2)}` : '')
    .filter(Boolean)
    .join(' ')
  const band2Bottom = [...points]
    .reverse()
    .map((point, reverseIndex) => {
      if (!point.minus2) return ''
      const index = points.length - 1 - reverseIndex
      return `L ${getX(index).toFixed(2)} ${getY(point.minus2).toFixed(2)}`
    })
    .filter(Boolean)
    .join(' ')
  const band1Top = points
    .map((point, index) => point.plus1 ? `${index === 0 ? 'M' : 'L'} ${getX(index).toFixed(2)} ${getY(point.plus1).toFixed(2)}` : '')
    .filter(Boolean)
    .join(' ')
  const band1Bottom = [...points]
    .reverse()
    .map((point, reverseIndex) => {
      if (!point.minus1) return ''
      const index = points.length - 1 - reverseIndex
      return `L ${getX(index).toFixed(2)} ${getY(point.minus1).toFixed(2)}`
    })
    .filter(Boolean)
    .join(' ')

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const scaled = yMin + ratio * yRange
    const price = scaleMode === 'LOG' ? Math.exp(scaled) : scaled
    return { price, y: bottom - ratio * (bottom - top) }
  })
  const xTicks = [0, 0.5, 1].map((ratio) => {
    const index = Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))))
    return { date: points[index].date, x: getX(index) }
  })

  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    points,
    getX,
    getY,
    pricePath,
    regressionPath,
    plus1Path,
    plus2Path,
    minus1Path,
    minus2Path,
    ma200Path,
    band2Path: `${band2Top} ${band2Bottom} Z`,
    band1Path: `${band1Top} ${band1Bottom} Z`,
    yTicks,
    xTicks,
  }
}

export function TridentRegressionChart({
  ticker,
  assetCurrency,
}: {
  ticker: string
  assetCurrency: string | null
}) {
  const [horizon, setHorizon] = useState<PriceHistoryHorizon>('MAX')
  const [mode, setMode] = useState<PriceHistoryCurrencyMode>('LOCAL')
  const [scaleMode, setScaleMode] = useState<RegressionScaleMode>('LOG')
  const [showMa200, setShowMa200] = useState(true)

  const { data, error, isLoading } = useSWR(
    ['trident-regression-history', ticker, horizon],
    () => loadAssetPriceHistory(supabase, ticker, horizon),
    swrOptions(SWR_REFRESH.SLOW),
  )

  const hasLocalPrices = useMemo(
    () => Boolean(data?.points.some((point) => point.price_local !== null)),
    [data?.points],
  )
  const effectiveMode = hasLocalPrices ? mode : 'EUR'
  const localCurrency = useMemo(
    () => data?.points.find((point) => point.local_currency)?.local_currency ?? assetCurrency ?? 'LOCAL',
    [assetCurrency, data?.points],
  )
  const currency = effectiveMode === 'LOCAL' ? localCurrency : 'EUR'

  const displayPoints = useMemo(
    () => buildDisplayPriceSeries(data?.points ?? [], effectiveMode),
    [data?.points, effectiveMode],
  )

  const model = useMemo(
    () => computeRegressionChartModel(displayPoints, scaleMode),
    [displayPoints, scaleMode],
  )

  const charts = useMemo(() => {
    if (!model) return null
    return {
      inline: buildRegressionRenderChart(model, scaleMode, showMa200, {
        width: 520,
        height: 240,
        left: 44,
        right: 18,
        top: 18,
        bottom: 202,
      }),
      fullscreen: buildRegressionRenderChart(model, scaleMode, showMa200, {
        width: 1600,
        height: 700,
        left: 92,
        right: 80,
        top: 52,
        bottom: 610,
      }),
    }
  }, [model, scaleMode, showMa200])

  const requestedStartDate = data?.requested_start_date ?? getPriceHistoryStartDate(horizon)
  const staleDays = model?.lastDate ? daysSince(model.lastDate) : null
  const isStale = staleDays !== null && staleDays > 7
  const shortHistory = Boolean(
    model?.firstDate &&
      new Date(model.firstDate).getTime() - new Date(requestedStartDate).getTime() > 30 * 86_400_000,
  )
  const sources = Array.from(new Set(displayPoints.map((point) => point.source).filter(Boolean)))
  const sourceLabel = sources.length > 1 ? `${sources[0]} +${sources.length - 1}` : sources[0] ?? 'unknown'
  const renderRegressionSvg = (renderChart: RegressionRenderChart, className: string, idSuffix: string, density: 'inline' | 'fullscreen') => {
    if (!model) return null
    const gradientId = `tridentRegressionBand-${safeId(ticker)}-${idSuffix}`
    const isFullscreen = density === 'fullscreen'
    const axisTextClass = isFullscreen
      ? 'fill-slate-500 text-[11px] font-mono dark:fill-gray-500'
      : 'fill-slate-500 text-[8px] font-mono dark:fill-gray-500'
    const dateTextClass = isFullscreen
      ? 'fill-slate-500 text-[12px] font-mono dark:fill-gray-500'
      : 'fill-slate-500 text-[8px] font-mono dark:fill-gray-500'
    const latestX = renderChart.getX(renderChart.points.length - 1)
    const latestY = renderChart.getY(model.latestPrice)
    const latestLabelX = Math.min(
      renderChart.width - renderChart.right - 12,
      Math.max(renderChart.left + 120, latestX - (isFullscreen ? 44 : 72)),
    )
    return (
      <svg viewBox={`0 0 ${renderChart.width} ${renderChart.height}`} className={cn('w-full', className)}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#64748b" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#64748b" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={renderChart.width} height={renderChart.height} rx={isFullscreen ? '16' : '8'} className="fill-slate-50 dark:fill-black/20" />
        {renderChart.yTicks.map((tick) => (
          <g key={tick.y}>
            <line
              x1={renderChart.left}
              x2={renderChart.width - renderChart.right}
              y1={tick.y}
              y2={tick.y}
              stroke="currentColor"
              strokeOpacity="0.08"
              className="text-slate-950 dark:text-white"
            />
            <text x={isFullscreen ? 24 : 6} y={tick.y + (isFullscreen ? 4 : 3)} className={axisTextClass}>
              {tick.price >= 100 ? tick.price.toFixed(0) : tick.price.toFixed(1)}
            </text>
          </g>
        ))}
        <line x1={renderChart.left} x2={renderChart.left} y1={renderChart.top} y2={renderChart.bottom} stroke="currentColor" strokeOpacity="0.18" className="text-slate-950 dark:text-white" />
        <line x1={renderChart.left} x2={renderChart.width - renderChart.right} y1={renderChart.bottom} y2={renderChart.bottom} stroke="currentColor" strokeOpacity="0.18" className="text-slate-950 dark:text-white" />
        <path d={renderChart.band2Path} fill={`url(#${gradientId})`} />
        <path d={renderChart.band1Path} fill="#64748b" opacity="0.08" />
        <path d={renderChart.plus2Path} fill="none" stroke="#94a3b8" strokeWidth={isFullscreen ? '1.8' : '1'} strokeDasharray={isFullscreen ? '8 8' : '4 5'} />
        <path d={renderChart.plus1Path} fill="none" stroke="#94a3b8" strokeWidth={isFullscreen ? '1.6' : '1'} strokeDasharray={isFullscreen ? '6 7' : '3 4'} />
        <path d={renderChart.minus1Path} fill="none" stroke="#94a3b8" strokeWidth={isFullscreen ? '1.6' : '1'} strokeDasharray={isFullscreen ? '6 7' : '3 4'} />
        <path d={renderChart.minus2Path} fill="none" stroke="#94a3b8" strokeWidth={isFullscreen ? '1.8' : '1'} strokeDasharray={isFullscreen ? '8 8' : '4 5'} />
        <path d={renderChart.regressionPath} fill="none" stroke="#f97316" strokeWidth={isFullscreen ? '4' : '1.8'} />
        {showMa200 && renderChart.ma200Path && (
          <path d={renderChart.ma200Path} fill="none" stroke="#111827" strokeWidth={isFullscreen ? '3' : '1.5'} strokeDasharray={isFullscreen ? '10 8' : '6 4'} className="dark:stroke-white" />
        )}
        <path d={renderChart.pricePath} fill="none" stroke="#38bdf8" strokeWidth={isFullscreen ? '3.4' : '1.7'} />
        <circle
          cx={latestX}
          cy={latestY}
          r={isFullscreen ? '7' : '3.2'}
          fill="#38bdf8"
          stroke="white"
          strokeWidth={isFullscreen ? '3' : '1.2'}
        />
        <text
          x={latestLabelX}
          y={Math.max(renderChart.top + (isFullscreen ? 28 : 12), latestY - (isFullscreen ? 18 : 8))}
          textAnchor="end"
          className={cn(
            'fill-blue-600 font-black dark:fill-[#00FF88]',
            isFullscreen ? 'text-[18px]' : 'text-[9px]',
          )}
        >
          {formatPrice(model.latestPrice, currency)}
        </text>
        {renderChart.xTicks.map((tick, index) => (
          <text
            key={`${tick.date}-${index}`}
            x={tick.x}
            y={renderChart.bottom + (isFullscreen ? 36 : 18)}
            textAnchor={index === 0 ? 'start' : index === renderChart.xTicks.length - 1 ? 'end' : 'middle'}
            className={dateTextClass}
          >
            {formatCompactDate(tick.date)}
          </text>
        ))}
      </svg>
    )
  }

  return (
    <section className="mt-4 border-t border-slate-200 pt-4 dark:border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-blue-600 dark:text-[#00FF88]" />
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-700 dark:text-gray-300">
              Regression
            </h2>
          </div>
          <div className="mt-1 text-[10px] font-mono text-slate-500">
            {model ? `${formatDate(model.firstDate)} -> ${formatDate(model.lastDate)}` : ticker}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {HORIZONS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={horizon === item}
              onClick={() => setHorizon(item)}
              className={cn(
                'h-7 rounded-md border px-2 text-[9px] font-black uppercase tracking-wider transition-colors',
                horizon === item
                  ? 'border-slate-950 bg-slate-950 text-white dark:border-[#00FF88] dark:bg-[#00FF88] dark:text-black'
                  : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 dark:border-white/10 dark:bg-black/20 dark:text-gray-400 dark:hover:bg-white/5',
              )}
            >
              {item}
            </button>
          ))}
          {model && charts && (
            <FullscreenChartButton title={`${ticker} Regression`} className="h-7 w-7">
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="Last" value={formatPrice(model.latestPrice, currency)} />
                  <Metric label="Z-score" value={formatZScore(model.latestZScore)} tone={model.latestZScore !== null && Math.abs(model.latestZScore) >= 2 ? 'warn' : 'neutral'} />
                  <Metric label="Slope" value={formatPct(model.annualizedSlopePct)} tone={model.annualizedSlopePct !== null && model.annualizedSlopePct < 0 ? 'bad' : 'neutral'} />
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-black/20">
                  {renderRegressionSvg(charts.fullscreen, 'h-auto', 'fullscreen', 'fullscreen')}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] font-mono uppercase tracking-wider text-slate-500 dark:text-gray-500">
                  <span>{currency}</span>
                  <span>{scaleMode.toLowerCase()}</span>
                  <span>{sourceLabel}</span>
                  <span>MM{MA200_WINDOW}</span>
                </div>
              </div>
            </FullscreenChartButton>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {MODES.map((item) => {
            const disabled = item.key === 'LOCAL' && !hasLocalPrices
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={effectiveMode === item.key}
                disabled={disabled}
                title={disabled ? 'Local unavailable' : item.label}
                onClick={() => setMode(item.key)}
                className={cn(
                  'h-7 rounded-md border px-2 text-[9px] font-black uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  effectiveMode === item.key
                    ? 'border-blue-600 bg-blue-600 text-white dark:border-[#00FF88] dark:bg-[#00FF88] dark:text-black'
                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 dark:border-white/10 dark:bg-black/20 dark:text-gray-400 dark:hover:bg-white/5',
                )}
              >
                {item.label}
              </button>
            )
          })}
          {SCALES.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={scaleMode === item.key}
              onClick={() => setScaleMode(item.key)}
              className={cn(
                'h-7 rounded-md border px-2 text-[9px] font-black uppercase tracking-wider transition-colors',
                scaleMode === item.key
                  ? 'border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-black'
                  : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 dark:border-white/10 dark:bg-black/20 dark:text-gray-400 dark:hover:bg-white/5',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={showMa200}
          onClick={() => setShowMa200((value) => !value)}
          className={cn(
            'h-7 rounded-md border px-2 text-[9px] font-black uppercase tracking-wider transition-colors',
            showMa200
              ? 'border-sky-500 bg-sky-500 text-white dark:border-sky-400 dark:bg-sky-400 dark:text-black'
              : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 dark:border-white/10 dark:bg-black/20 dark:text-gray-400 dark:hover:bg-white/5',
          )}
        >
          MM200
        </button>
      </div>

      <div className="mt-3 min-h-[285px]">
        {isLoading && (
          <div className="flex h-[285px] items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs font-mono text-slate-500 dark:border-white/10 dark:bg-black/20 dark:text-gray-400">
            Loading price history...
          </div>
        )}

        {error && !isLoading && (
          <div className="flex h-[285px] flex-col items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-center dark:border-red-900/60 dark:bg-red-950/20">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <div className="text-xs font-black uppercase text-red-700 dark:text-red-300">Price history error</div>
            <div className="text-[10px] font-mono text-red-600/80 dark:text-red-300/80">
              {error instanceof Error ? error.message : 'Supabase query failed'}
            </div>
          </div>
        )}

        {!isLoading && !error && displayPoints.length === 0 && (
          <div className="flex h-[285px] flex-col items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 text-center dark:border-amber-900/60 dark:bg-amber-950/20">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <div className="text-xs font-black uppercase text-amber-800 dark:text-amber-300">No price history</div>
            <div className="text-[10px] font-mono text-amber-700/80 dark:text-amber-300/80">
              {ticker} has no usable {effectiveMode === 'LOCAL' ? 'local' : 'EUR'} series.
            </div>
          </div>
        )}

        {!isLoading && !error && displayPoints.length > 0 && !model && (
          <div className="flex h-[285px] flex-col items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 text-center dark:border-amber-900/60 dark:bg-amber-950/20">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <div className="text-xs font-black uppercase text-amber-800 dark:text-amber-300">Insufficient history</div>
            <div className="text-[10px] font-mono text-amber-700/80 dark:text-amber-300/80">
              {displayPoints.length} points, minimum {REGRESSION_MIN_POINTS}.
            </div>
          </div>
        )}

        {!isLoading && !error && model && charts && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Metric label="Last" value={formatPrice(model.latestPrice, currency)} />
              <Metric label="Z-score" value={formatZScore(model.latestZScore)} tone={model.latestZScore !== null && Math.abs(model.latestZScore) >= 2 ? 'warn' : 'neutral'} />
              <Metric label="Slope" value={formatPct(model.annualizedSlopePct)} tone={model.annualizedSlopePct !== null && model.annualizedSlopePct < 0 ? 'bad' : 'neutral'} />
            </div>

            {renderRegressionSvg(charts.inline, 'h-60', 'inline', 'inline')}

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] font-mono uppercase tracking-wider text-slate-500 dark:text-gray-500">
              <span>{currency}</span>
              <span>{scaleMode.toLowerCase()}</span>
              <span>{sourceLabel}</span>
              <span>MM{MA200_WINDOW}</span>
              {!hasLocalPrices && <span className="text-amber-600 dark:text-amber-400">Local unavailable</span>}
              {shortHistory && <span className="text-amber-600 dark:text-amber-400">Short history</span>}
              {isStale && <span className="text-red-600 dark:text-red-400">Stale {staleDays}d</span>}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'warn' | 'bad'
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 dark:border-white/10 dark:bg-black/20">
      <div className="text-[8px] font-black uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={cn(
          'mt-1 truncate text-[11px] font-mono font-black text-slate-950 dark:text-white',
          tone === 'warn' && 'text-amber-700 dark:text-amber-300',
          tone === 'bad' && 'text-red-700 dark:text-red-300',
        )}
      >
        {value}
      </div>
    </div>
  )
}
