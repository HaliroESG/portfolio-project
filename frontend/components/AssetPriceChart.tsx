"use client"

import React, { useMemo, useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, LineChart } from 'lucide-react'
import type { PriceHistoryCurrencyMode, PriceHistoryHorizon } from '../types'
import { supabase } from '../lib/supabase'
import { SWR_REFRESH, swrOptions } from '../lib/swrConfig'
import {
  buildDisplayPriceSeries,
  getPriceHistoryStartDate,
  loadAssetPriceHistory,
} from '../lib/priceHistory'
import { cn } from '../lib/utils'
import { FullscreenChartButton } from './FullscreenChart'

const HORIZONS: PriceHistoryHorizon[] = ['YTD', '5Y', '10Y']
const MODES: { key: PriceHistoryCurrencyMode; label: string }[] = [
  { key: 'EUR', label: 'EUR' },
  { key: 'LOCAL', label: 'Local' },
]

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function formatPrice(value: number, currency: string): string {
  return `${value.toLocaleString('fr-FR', {
    minimumFractionDigits: value >= 100 ? 2 : 3,
    maximumFractionDigits: value >= 100 ? 2 : 3,
  })} ${currency}`
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function daysSince(value: string): number | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Math.floor((Date.now() - date.getTime()) / 86_400_000)
}

export function AssetPriceChart({
  ticker,
  assetCurrency,
}: {
  ticker: string
  assetCurrency: string
}) {
  const [horizon, setHorizon] = useState<PriceHistoryHorizon>('YTD')
  const [mode, setMode] = useState<PriceHistoryCurrencyMode>('EUR')

  const { data, error, isLoading } = useSWR(
    ['asset-price-history', ticker, horizon],
    () => loadAssetPriceHistory(supabase, ticker, horizon),
    swrOptions(SWR_REFRESH.SLOW),
  )

  const hasLocalPrices = useMemo(
    () => Boolean(data?.points.some((point) => point.price_local !== null)),
    [data?.points],
  )
  const localCurrency = useMemo(
    () => data?.points.find((point) => point.local_currency)?.local_currency ?? assetCurrency,
    [assetCurrency, data?.points],
  )

  const effectiveMode = hasLocalPrices ? mode : 'EUR'

  const displayPoints = useMemo(
    () => buildDisplayPriceSeries(data?.points ?? [], effectiveMode),
    [data?.points, effectiveMode],
  )

  const stats = useMemo(() => {
    if (displayPoints.length < 2) return null
    const values = displayPoints.map((point) => point.price)
    const first = displayPoints[0]
    const last = displayPoints[displayPoints.length - 1]
    const min = Math.min(...values)
    const max = Math.max(...values)
    const changePct = ((last.price / first.price) - 1) * 100
    const latestUpdatedAt = [...displayPoints]
      .reverse()
      .find((point) => point.updated_at)?.updated_at ?? null
    const sources = Array.from(new Set(displayPoints.map((point) => point.source).filter(Boolean)))
    return {
      first,
      last,
      min,
      max,
      changePct,
      latestUpdatedAt,
      source: sources.length > 1 ? `${sources[0]} +${sources.length - 1}` : sources[0] ?? 'unknown',
    }
  }, [displayPoints])

  const chart = useMemo(() => {
    if (displayPoints.length < 2) return null
    const width = 560
    const height = 210
    const paddingX = 18
    const top = 20
    const bottom = 174
    const values = displayPoints.map((point) => point.price)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const safeRange = Math.max(1, max - min)

    const getX = (index: number) => {
      const ratio = displayPoints.length > 1 ? index / (displayPoints.length - 1) : 0
      return paddingX + ratio * (width - paddingX * 2)
    }
    const getY = (value: number) => {
      const ratio = (value - min) / safeRange
      return bottom - ratio * (bottom - top)
    }

    const linePath = displayPoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${getX(index)} ${getY(point.price)}`)
      .join(' ')
    const areaPath = `${linePath} L ${getX(displayPoints.length - 1)} ${bottom} L ${getX(0)} ${bottom} Z`

    return { width, height, getX, getY, linePath, areaPath, min, max }
  }, [displayPoints])

  const currency = effectiveMode === 'LOCAL' ? localCurrency : 'EUR'
  const requestedStartDate = data?.requested_start_date ?? getPriceHistoryStartDate(horizon)
  const firstDate = stats?.first.date ?? null
  const shortHistory = Boolean(
    firstDate &&
      new Date(firstDate).getTime() - new Date(requestedStartDate).getTime() > 14 * 86_400_000,
  )
  const staleDays = stats?.last.date ? daysSince(stats.last.date) : null
  const isStale = staleDays !== null && staleDays > 7
  const renderChartSvg = (heightClass: string, idSuffix: string) => {
    if (!stats || !chart) return null
    const fillId = `assetPriceFill-${ticker.replace(/[^A-Za-z0-9]/g, '')}-${idSuffix}`
    return (
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className={`w-full ${heightClass}`}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => {
          const y = 20 + ratio * (174 - 20)
          return (
            <line
              key={ratio}
              x1="18"
              x2="542"
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity="0.08"
              className="text-slate-950 dark:text-white"
            />
          )
        })}
        <path d={chart.areaPath} fill={`url(#${fillId})`} />
        <path d={chart.linePath} fill="none" stroke="#0ea5e9" strokeWidth="2.5" />
        <circle
          cx={chart.getX(displayPoints.length - 1)}
          cy={chart.getY(stats.last.price)}
          r="4"
          fill="#0ea5e9"
          stroke="white"
          strokeWidth="1.5"
        />
        <text x="10" y="15" className="fill-slate-500 dark:fill-gray-500 text-[9px] font-mono">
          {formatPrice(chart.max, currency)}
        </text>
        <text x="10" y="198" className="fill-slate-500 dark:fill-gray-500 text-[9px] font-mono">
          {formatPrice(chart.min, currency)}
        </text>
      </svg>
    )
  }

  return (
    <div className="bg-slate-50 dark:bg-[#080A0F] rounded-2xl border-2 border-slate-200 dark:border-white/5 p-6 shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <LineChart className="w-5 h-5 text-blue-600 dark:text-[#00FF88]" />
          <div>
            <h3 className="text-sm font-black text-slate-950 dark:text-white uppercase tracking-tighter">
              Price History
            </h3>
            <p className="text-[10px] font-mono text-slate-500 dark:text-gray-500 uppercase tracking-wider">
              {stats ? `${formatDate(stats.first.date)} -> ${formatDate(stats.last.date)}` : ticker}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0A0D12] p-1">
            {HORIZONS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={horizon === item}
                onClick={() => setHorizon(item)}
                className={cn(
                  'h-7 px-3 rounded-md text-[10px] font-black uppercase tracking-wider transition-colors',
                  horizon === item
                    ? 'bg-blue-600 text-white dark:bg-[#00FF88] dark:text-black'
                    : 'text-slate-500 hover:text-slate-950 dark:text-gray-400 dark:hover:text-white',
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0A0D12] p-1">
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
                    'h-7 px-3 rounded-md text-[10px] font-black uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    effectiveMode === item.key
                      ? 'bg-blue-600 text-white dark:bg-[#00FF88] dark:text-black'
                      : 'text-slate-500 hover:text-slate-950 dark:text-gray-400 dark:hover:text-white',
                  )}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
          {stats && chart && (
            <FullscreenChartButton title={`${ticker} Price History`}>
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-white/5 dark:bg-[#080A0F]">
                  {renderChartSvg('h-auto', 'fullscreen')}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-gray-500">
                  <span>{currency}</span>
                  <span>{horizon}</span>
                  <span>{stats.source}</span>
                  <span>{formatDate(stats.first.date)} {'->'} {formatDate(stats.last.date)}</span>
                </div>
              </div>
            </FullscreenChartButton>
          )}
        </div>
      </div>

      <div className="mt-4 min-h-[270px]">
        {isLoading && (
          <div className="h-[270px] rounded-xl border border-slate-200 dark:border-white/5 bg-white dark:bg-[#0A0D12] flex items-center justify-center text-xs font-mono text-slate-500 dark:text-gray-400">
            Loading price history...
          </div>
        )}

        {error && !isLoading && (
          <div className="h-[270px] rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <div className="text-xs font-black uppercase text-red-700 dark:text-red-300">
              Price history unavailable
            </div>
            <div className="text-[10px] font-mono text-red-600/80 dark:text-red-300/80">
              {error instanceof Error ? error.message : 'Supabase query failed'}
            </div>
          </div>
        )}

        {!isLoading && !error && (!stats || !chart) && (
          <div className="h-[270px] rounded-xl border border-slate-200 dark:border-white/5 bg-white dark:bg-[#0A0D12] flex flex-col items-center justify-center gap-2 px-6 text-center">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <div className="text-xs font-black uppercase text-slate-700 dark:text-gray-300">
              Not enough price history
            </div>
            <div className="text-[10px] font-mono text-slate-500 dark:text-gray-500">
              {ticker} returned {displayPoints.length} usable point{displayPoints.length === 1 ? '' : 's'}.
            </div>
          </div>
        )}

        {!isLoading && !error && stats && chart && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl border border-slate-200 dark:border-white/5 bg-white dark:bg-[#0A0D12] p-3">
                <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-gray-500">
                  Last
                </div>
                <div className="mt-1 text-sm font-mono font-black text-slate-950 dark:text-white">
                  {formatPrice(stats.last.price, currency)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-white/5 bg-white dark:bg-[#0A0D12] p-3">
                <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-gray-500">
                  Period
                </div>
                <div
                  className={cn(
                    'mt-1 text-sm font-mono font-black',
                    stats.changePct >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400',
                  )}
                >
                  {formatPct(stats.changePct)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-white/5 bg-white dark:bg-[#0A0D12] p-3">
                <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-gray-500">
                  Min / Max
                </div>
                <div className="mt-1 text-xs font-mono font-black text-slate-950 dark:text-white">
                  {formatPrice(stats.min, currency)} / {formatPrice(stats.max, currency)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-white/5 bg-white dark:bg-[#0A0D12] p-3">
                <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-gray-500">
                  Source
                </div>
                <div className="mt-1 text-xs font-mono font-black text-slate-950 dark:text-white uppercase">
                  {stats.source}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-white/5 bg-white dark:bg-[#0A0D12] p-3">
              {renderChartSvg('h-52', 'inline')}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-gray-500">
              <span>{currency}</span>
              <span>through {formatDate(stats.last.date)}</span>
              {stats.latestUpdatedAt && <span>updated {formatDate(stats.latestUpdatedAt)}</span>}
              {!hasLocalPrices && <span className="text-amber-600 dark:text-amber-400">Local unavailable</span>}
              {shortHistory && <span className="text-amber-600 dark:text-amber-400">Short history</span>}
              {isStale && <span className="text-red-600 dark:text-red-400">Stale {staleDays}d</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
