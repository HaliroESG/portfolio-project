"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Signal } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  calculateMACD,
  calculateMomentum,
  calculateRSI,
  resolveTrendState,
  TrendState,
} from '../lib/technicalIndicators'
import { cn } from '../lib/utils'

interface SnapshotRow {
  snapshot_date: string | null
  total_value_eur: number | null
  created_at: string | null
}

interface TrendPoint {
  date: string
  value: number
  macd: number | null
  signal: number | null
  hist: number | null
  rsi: number | null
  momentum: number | null
  trendState: TrendState
  trendChanged: boolean
}

interface NormalizedPoint {
  date: string
  value: number
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function formatValue(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return value.toFixed(digits)
}

export function PortfolioTrendPanel() {
  const [rows, setRows] = useState<SnapshotRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchSnapshots() {
      try {
        const { data, error } = await supabase
          .from('valuation_snapshots')
          .select('snapshot_date, total_value_eur, created_at')
          .order('created_at', { ascending: true })
          .limit(240)

        if (error) throw error
        setRows((data ?? []) as SnapshotRow[])
      } catch (err) {
        console.error('Error fetching valuation snapshots:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchSnapshots()
  }, [])

  const points = useMemo(() => {
    const normalized: NormalizedPoint[] = rows
      .filter((row) => {
        return Boolean(row.created_at && row.total_value_eur !== null && row.total_value_eur > 0)
      })
      .map((row) => ({
        date: row.snapshot_date ?? row.created_at ?? '',
        value: row.total_value_eur ?? 0,
      }))
      .filter((row): row is NormalizedPoint => {
        return row.date.length > 0 && Number.isFinite(row.value) && row.value > 0
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    const values = normalized.map((item) => item.value)
    const { macdLine, signalLine, histogram } = calculateMACD(values)
    const rsi = calculateRSI(values)
    const momentum = calculateMomentum(values, 20)

    return normalized.map((item, index) => {
      const trendState = resolveTrendState(
        macdLine[index] ?? null,
        signalLine[index] ?? null,
        rsi[index] ?? null,
        momentum[index] ?? null,
        60,
      )
      const previousState = index > 0 ? resolveTrendState(
        macdLine[index - 1] ?? null,
        signalLine[index - 1] ?? null,
        rsi[index - 1] ?? null,
        momentum[index - 1] ?? null,
        60,
      ) : null

      return {
        date: item.date,
        value: item.value,
        macd: macdLine[index] ?? null,
        signal: signalLine[index] ?? null,
        hist: histogram[index] ?? null,
        rsi: rsi[index] ?? null,
        momentum: momentum[index] ?? null,
        trendState,
        trendChanged: previousState !== null && previousState !== trendState,
      } as TrendPoint
    })
  }, [rows])

  const latest = points[points.length - 1]
  const previous = points[points.length - 2]

  const chart = useMemo(() => {
    if (points.length < 2) return null

    const width = 560
    const height = 190
    const paddingX = 18
    const top = 18
    const bottom = 164
    const values = points.map((point) => point.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const safeRange = Math.max(1, max - min)

    const getX = (index: number) => {
      const ratio = points.length > 1 ? index / (points.length - 1) : 0
      return paddingX + ratio * (width - paddingX * 2)
    }

    const getY = (value: number) => {
      const ratio = (value - min) / safeRange
      return bottom - ratio * (bottom - top)
    }

    const linePath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${getX(index)} ${getY(point.value)}`)
      .join(' ')

    const areaPath = `${linePath} L ${getX(points.length - 1)} ${bottom} L ${getX(0)} ${bottom} Z`

    return { width, height, getX, getY, linePath, areaPath, min, max }
  }, [points])

  if (loading) {
    return (
      <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl p-6">
        <div className="text-sm font-black text-slate-500 dark:text-gray-400 uppercase tracking-wider">
          Portfolio Momentum
        </div>
        <div className="mt-4 text-xs text-slate-500 dark:text-gray-400">Loading trend data...</div>
      </div>
    )
  }

  if (!latest || !chart) {
    return (
      <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl p-6">
        <div className="text-sm font-black text-slate-500 dark:text-gray-400 uppercase tracking-wider">
          Portfolio Momentum
        </div>
        <div className="mt-4 text-xs text-slate-500 dark:text-gray-400">Not enough valuation history.</div>
      </div>
    )
  }

  const trendTone =
    latest.trendState === 'BULLISH'
      ? 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-950/30 border-green-300 dark:border-green-800/60'
      : latest.trendState === 'BEARISH'
        ? 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-950/30 border-red-300 dark:border-red-800/60'
        : 'text-slate-700 dark:text-gray-300 bg-slate-100 dark:bg-slate-800/40 border-slate-300 dark:border-slate-700/70'

  const changesCount = points.filter((point) => point.trendChanged).length

  return (
    <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-black text-slate-950 dark:text-white uppercase tracking-tighter">
            Portfolio Momentum
          </h3>
          <p className="text-[10px] font-mono text-slate-500 dark:text-gray-500 uppercase tracking-wider">
            MACD + RSI(60) + Momentum(20)
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-black uppercase tracking-wider',
            trendTone,
          )}
        >
          <Signal className="w-3 h-3" />
          {latest.trendState}
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#080A0F] p-3">
        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="w-full h-44">
          <defs>
            <linearGradient id="portfolioTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={chart.areaPath} fill="url(#portfolioTrendFill)" />
          <path d={chart.linePath} fill="none" stroke="#2563eb" strokeWidth="2.5" />

          {points.map((point, index) => {
            if (!point.trendChanged) return null
            const x = chart.getX(index)
            const y = chart.getY(point.value)
            const markerColor = point.trendState === 'BULLISH' ? '#10b981' : '#ef4444'
            return (
              <circle
                key={`${point.date}-${index}`}
                cx={x}
                cy={y}
                r="3.5"
                fill={markerColor}
                stroke="white"
                strokeWidth="1.2"
              />
            )
          })}

          <text x="10" y="14" className="fill-slate-500 dark:fill-gray-500 text-[9px] font-mono">
            {formatValue(chart.max, 0)} EUR
          </text>
          <text x="10" y="184" className="fill-slate-500 dark:fill-gray-500 text-[9px] font-mono">
            {formatValue(chart.min, 0)} EUR
          </text>
          <text x="14" y="174" className="fill-slate-500 dark:fill-gray-500 text-[8px] font-mono">
            {formatDate(points[0].date)}
          </text>
          <text x={chart.width - 56} y="174" className="fill-slate-500 dark:fill-gray-500 text-[8px] font-mono">
            {formatDate(latest.date)}
          </text>
        </svg>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-white/5 p-3 bg-slate-50 dark:bg-[#080A0F]">
          <div className="text-[9px] font-black text-slate-500 dark:text-gray-500 uppercase tracking-wider">
            MACD Hist
          </div>
          <div className="mt-1 flex items-center gap-1">
            {latest.hist !== null && latest.hist >= 0 ? (
              <ArrowUpRight className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
            ) : (
              <ArrowDownRight className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            )}
            <span
              className={cn(
                'text-sm font-mono font-black',
                latest.hist !== null && latest.hist >= 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400',
              )}
            >
              {formatValue(latest.hist)}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/5 p-3 bg-slate-50 dark:bg-[#080A0F]">
          <div className="text-[9px] font-black text-slate-500 dark:text-gray-500 uppercase tracking-wider">
            RSI 14 (60)
          </div>
          <div className="mt-1 text-sm font-mono font-black text-slate-950 dark:text-white">
            {formatValue(latest.rsi)}
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700/60 overflow-hidden">
            <div
              className={cn(
                'h-full transition-all',
                (latest.rsi ?? 0) >= 60 ? 'bg-green-500' : 'bg-amber-500',
              )}
              style={{ width: `${Math.max(0, Math.min(100, latest.rsi ?? 0))}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/5 p-3 bg-slate-50 dark:bg-[#080A0F]">
          <div className="text-[9px] font-black text-slate-500 dark:text-gray-500 uppercase tracking-wider">
            Momentum 20d
          </div>
          <div
            className={cn(
              'mt-1 text-sm font-mono font-black',
              (latest.momentum ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
            )}
          >
            {(latest.momentum ?? 0) >= 0 ? '+' : ''}
            {formatValue(latest.momentum)}%
          </div>
          <div className="mt-2 text-[9px] font-mono text-slate-500 dark:text-gray-500">
            {changesCount} trend changes détectés
          </div>
        </div>
      </div>

      <div className="mt-3 text-[9px] font-mono text-slate-500 dark:text-gray-500">
        Dernier changement: {latest.trendChanged ? `au ${formatDate(latest.date)}` : 'aucun sur la dernière observation'}
        {previous && !latest.trendChanged ? ` · état stable depuis ${formatDate(previous.date)}` : ''}
      </div>

      <div className="mt-1 text-[9px] font-mono text-slate-400 dark:text-gray-600">
        Signal = MACD cross + RSI(60) + Momentum.
      </div>
    </div>
  )
}
