"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { BacktestChart, LineSeries } from '../../components/BacktestChart'
import { DrawdownChart } from '../../components/DrawdownChart'
import { KpiComparisonTable } from '../../components/KpiComparisonTable'
import { PortfolioSelectGrid, PortfolioCard } from '../../components/PortfolioSelectGrid'
import { DataStateBadge, DataState } from '../../components/DataStateBadge'
import { BacktestKpi, BacktestPortfolio, BacktestResult, BacktestRun } from '../../types'

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

function formatDate(value: string | null | undefined): string {
  if (!value) return '--'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('fr-FR')
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return `${value.toFixed(2)}%`
}

function countBusinessDays(start: string, end: string): number {
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0
  let count = 0
  const current = new Date(startDate)
  while (current <= endDate) {
    const day = current.getDay()
    if (day !== 0 && day !== 6) count += 1
    current.setDate(current.getDate() + 1)
  }
  return count
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function fetchResultsForPortfolio(runId: string, portfolioKey: string): Promise<BacktestResult[]> {
  const pageSize = 5000
  let offset = 0
  const results: BacktestResult[] = []

  while (true) {
    const { data, error } = await supabase
      .from('backtest_results')
      .select('run_id,portfolio_key,date,nav,drawdown,returns_daily')
      .eq('run_id', runId)
      .eq('portfolio_key', portfolioKey)
      .order('date', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    const batch = (data ?? []) as BacktestResult[]
    results.push(
      ...batch.map((row) => ({
        ...row,
        nav: parseNumeric(row.nav) ?? 0,
        drawdown: parseNumeric(row.drawdown),
        returns_daily: parseNumeric(row.returns_daily),
      }))
    )
    if (batch.length < pageSize) break
    offset += pageSize
  }

  return results
}

function computeDataState(loading: boolean, runs: BacktestRun[], selectedRun?: BacktestRun | null): DataState {
  if (loading) return 'LOADING'
  if (!runs || runs.length === 0) return 'NO_DATA'
  if (!selectedRun?.created_at) return 'STALE'
  const created = new Date(selectedRun.created_at)
  if (Number.isNaN(created.getTime())) return 'STALE'
  const ageMinutes = (Date.now() - created.getTime()) / 60000
  if (ageMinutes <= 1440) return 'LIVE'
  return 'STALE'
}

function buildCommonDates(resultsByKey: Record<string, BacktestResult[]>, keys: string[]): string[] {
  if (keys.length === 0) return []
  const base = resultsByKey[keys[0]]?.map((row) => row.date) ?? []
  if (base.length === 0) return []
  let common = new Set(base)
  for (const key of keys.slice(1)) {
    const dates = resultsByKey[key]?.map((row) => row.date) ?? []
    const next = new Set(dates)
    common = new Set(Array.from(common).filter((date) => next.has(date)))
  }
  return Array.from(common).sort()
}

function downsampleSeries(dates: string[], series: LineSeries[], maxPoints = 1200): { dates: string[]; series: LineSeries[] } {
  if (dates.length <= maxPoints) return { dates, series }
  const stride = Math.ceil(dates.length / maxPoints)
  const indices = dates.map((_, index) => index).filter((index) => index % stride === 0 || index === dates.length - 1)
  const nextDates = indices.map((index) => dates[index])
  const nextSeries = series.map((s) => ({
    ...s,
    values: indices.map((index) => s.values[index] ?? s.values[s.values.length - 1] ?? 0),
  }))
  return { dates: nextDates, series: nextSeries }
}

export default function BacktestPage() {
  const [runs, setRuns] = useState<BacktestRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>('')
  const [portfolios, setPortfolios] = useState<BacktestPortfolio[]>([])
  const [results, setResults] = useState<Record<string, BacktestResult[]>>({})
  const [kpis, setKpis] = useState<Record<string, BacktestKpi>>({})
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchRuns() {
      setLoading(true)
      setError(null)
      try {
        const { data, error } = await supabase
          .from('backtest_runs')
          .select('id,name,created_at,base_currency,start_date,end_date,rebalance_freq,fee_bps,inflation_adjusted,config_json')
          .order('created_at', { ascending: false })
        if (error) throw error
        const rows = (data ?? []) as BacktestRun[]
        setRuns(rows)
        if (rows.length > 0) {
          setSelectedRunId((prev) => prev || rows[0].id)
        }
      } catch (err) {
        console.error('Backtest runs fetch error', err)
        setError('Unable to load backtest runs.')
      } finally {
        setLoading(false)
      }
    }

    fetchRuns()
  }, [])

  useEffect(() => {
    if (!selectedRunId) return
    async function fetchRunData() {
      setLoading(true)
      setError(null)
      try {
        const { data: portfolioRows, error: portfolioError } = await supabase
          .from('backtest_portfolios')
          .select('run_id,portfolio_key,portfolio_id,preset_key,label,role,weights_json,start_date_effective,created_at')
          .eq('run_id', selectedRunId)
          .order('role', { ascending: true })
          .order('label', { ascending: true })
        if (portfolioError) throw portfolioError

        const { data: kpiRows, error: kpiError } = await supabase
          .from('backtest_kpis')
          .select('run_id,portfolio_key,cagr,vol,sharpe,sortino,max_drawdown,calmar,worst_year,best_year')
          .eq('run_id', selectedRunId)
        if (kpiError) throw kpiError

        const portfolioList = (portfolioRows ?? []) as BacktestPortfolio[]
        const kpiMap: Record<string, BacktestKpi> = {}
        ;(kpiRows ?? []).forEach((row) => {
          const kpi = row as BacktestKpi
          kpi.cagr = parseNumeric(kpi.cagr)
          kpi.vol = parseNumeric(kpi.vol)
          kpi.sharpe = parseNumeric(kpi.sharpe)
          kpi.sortino = parseNumeric(kpi.sortino)
          kpi.max_drawdown = parseNumeric(kpi.max_drawdown)
          kpi.calmar = parseNumeric(kpi.calmar)
          kpi.worst_year = parseNumeric(kpi.worst_year)
          kpi.best_year = parseNumeric(kpi.best_year)
          kpiMap[kpi.portfolio_key] = kpi
        })

        const resultsByKey: Record<string, BacktestResult[]> = {}
        await Promise.all(
          portfolioList.map(async (portfolio) => {
            resultsByKey[portfolio.portfolio_key] = await fetchResultsForPortfolio(
              selectedRunId,
              portfolio.portfolio_key
            )
          })
        )

        setPortfolios(portfolioList)
        setKpis(kpiMap)
        setResults(resultsByKey)
        setSelectedKeys(portfolioList.map((portfolio) => portfolio.portfolio_key))
      } catch (err) {
        console.error('Backtest run fetch error', err)
        setError('Unable to load backtest run data.')
      } finally {
        setLoading(false)
      }
    }

    fetchRunData()
  }, [selectedRunId])

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  )

  const runConfig = useMemo<Record<string, unknown>>(() => {
    if (!selectedRun || typeof selectedRun.config_json !== 'object' || selectedRun.config_json === null) {
      return {}
    }
    return selectedRun.config_json as Record<string, unknown>
  }, [selectedRun])

  const dateMode = typeof runConfig.date_mode === 'string' ? runConfig.date_mode : null

  const dataState = useMemo(
    () => computeDataState(loading, runs, selectedRun),
    [loading, runs, selectedRun]
  )

  const portfoliosWithCoverage = useMemo(() => {
    if (!selectedRun) return []
    const runStart = selectedRun.start_date
    const runEnd = selectedRun.end_date
    return portfolios.map((portfolio) => {
      const actualDays = results[portfolio.portfolio_key]?.length ?? 0
      const effectiveStart = portfolio.start_date_effective || runStart
      const expectedStart = dateMode === 'common_start' ? effectiveStart : runStart
      const expectedDays = countBusinessDays(expectedStart, runEnd)
      const coveragePct = expectedDays > 0 ? (actualDays / expectedDays) * 100 : null
      return {
        portfolio_key: portfolio.portfolio_key,
        label: portfolio.label,
        role: portfolio.role,
        coveragePct,
        start_date_requested: runStart,
        start_date_effective: effectiveStart,
        end_date: runEnd,
      } as PortfolioCard
    })
  }, [portfolios, results, selectedRun])

  const selectedPortfolios = useMemo(() => {
    return portfolios.filter((portfolio) => selectedKeys.includes(portfolio.portfolio_key))
  }, [portfolios, selectedKeys])

  const chartPayload = useMemo(() => {
    if (!selectedRun) return { dates: [], navSeries: [], ddSeries: [] }
    const keys = selectedPortfolios.map((p) => p.portfolio_key)
    const commonDates = buildCommonDates(results, keys)
    if (commonDates.length === 0) return { dates: [], navSeries: [], ddSeries: [] }
    const navSeries: LineSeries[] = []
    const ddSeries: LineSeries[] = []

    keys.forEach((key, index) => {
      const data = results[key] ?? []
      const map = new Map(data.map((row) => [row.date, row]))
      const navValues = commonDates.map((date) => map.get(date)?.nav ?? 0)
      const ddValues = commonDates.map((date) => map.get(date)?.drawdown ?? 0)
      const portfolio = portfolios.find((p) => p.portfolio_key === key)
      navSeries.push({
        key,
        label: portfolio?.label ?? key,
        role: portfolio?.role ?? 'preset',
        color: CHART_COLORS[index % CHART_COLORS.length],
        values: navValues,
      })
      ddSeries.push({
        key,
        label: portfolio?.label ?? key,
        role: portfolio?.role ?? 'preset',
        color: CHART_COLORS[index % CHART_COLORS.length],
        values: ddValues,
      })
    })
    const navDownsampled = downsampleSeries(commonDates, navSeries)
    const ddDownsampled = downsampleSeries(commonDates, ddSeries)
    return { dates: navDownsampled.dates, navSeries: navDownsampled.series, ddSeries: ddDownsampled.series }
  }, [results, selectedPortfolios, portfolios, selectedRun])

  const anyCoverageGap = portfoliosWithCoverage
    .filter((p) => selectedKeys.includes(p.portfolio_key))
    .some((p) => p.coveragePct !== null && p.coveragePct < 95)

  const holdingPortfolioKey = selectedPortfolios[0]?.portfolio_key
  const holdingWeights = useMemo(() => {
    if (!holdingPortfolioKey) return []
    const portfolio = portfolios.find((p) => p.portfolio_key === holdingPortfolioKey)
    const weights = (portfolio?.weights_json ?? {}) as Record<string, unknown>
    return Object.entries(weights)
      .map(([ticker, weight]) => ({ ticker, weight: parseNumeric(weight) ?? 0 }))
      .sort((a, b) => b.weight - a.weight)
  }, [holdingPortfolioKey, portfolios])

  const lastSync = selectedRun?.created_at
    ? new Date(selectedRun.created_at).toLocaleTimeString('fr-FR')
    : undefined

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#080A0F] transition-colors duration-500">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header lastSync={lastSync} />
        <main className="flex-1 p-10 overflow-y-auto">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-950 dark:text-white">
                  Backtest Run
                </h1>
                <p className="text-xs font-mono text-slate-500 dark:text-gray-400">
                  Simulations target/current + presets · EUR base
                </p>
              </div>
              <DataStateBadge state={dataState} />
            </div>

            {error && (
              <div className="rounded-2xl border border-red-300 bg-red-50 p-3 text-sm font-mono text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 rounded-lg bg-slate-200/70 dark:bg-white/10 px-3 py-2">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400">Run</span>
                <select
                  value={selectedRunId}
                  onChange={(event) => setSelectedRunId(event.target.value)}
                  className="bg-transparent text-[10px] font-black text-slate-900 dark:text-white outline-none"
                >
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.name}
                    </option>
                  ))}
                </select>
              </div>
              {selectedRun && (
                <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                  <span>Requested {formatDate(selectedRun.start_date)} → {formatDate(selectedRun.end_date)}</span>
                  <span>Rebalance {selectedRun.rebalance_freq}</span>
                  <span>Fees {selectedRun.fee_bps} bps</span>
                  <span>Inflation {selectedRun.inflation_adjusted ? 'yes' : 'no'}</span>
                </div>
              )}
            </div>

            {selectedRun && (
              <div className="rounded-3xl border-2 border-slate-200 dark:border-white/5 bg-white dark:bg-[#0D1117]/50 shadow-2xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400">
                      Parameters
                    </div>
                    <div className="mt-2 text-sm font-mono text-slate-700 dark:text-gray-300">
                      Initial {typeof runConfig.initial_cash === 'number' ? runConfig.initial_cash : 0} EUR ·
                      DCA {typeof runConfig.recurring_cash === 'number' ? runConfig.recurring_cash : 0} EUR ·
                      Mode {dateMode ?? 'n/a'}
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                    Created {formatDate(selectedRun.created_at)}
                  </div>
                </div>
              </div>
            )}

            <PortfolioSelectGrid
              portfolios={portfoliosWithCoverage}
              selectedKeys={selectedKeys}
              onToggle={(portfolioKey) => {
                setSelectedKeys((prev) =>
                  prev.includes(portfolioKey)
                    ? prev.filter((key) => key !== portfolioKey)
                    : [...prev, portfolioKey]
                )
              }}
            />

            {anyCoverageGap && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm font-mono text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
                Coverage gaps detected. Consider running with <span className="font-black">common_start</span> to align histories.
              </div>
            )}

            {chartPayload.dates.length === 0 ? (
              <div className="rounded-3xl border-2 border-slate-200 dark:border-white/5 bg-white dark:bg-[#0D1117]/50 shadow-2xl p-6 text-sm font-mono text-slate-500 dark:text-gray-400">
                No backtest results for this run.
              </div>
            ) : (
              <div className="space-y-6">
                <BacktestChart dates={chartPayload.dates} series={chartPayload.navSeries} />
                <DrawdownChart dates={chartPayload.dates} series={chartPayload.ddSeries} />
                <KpiComparisonTable
                  portfolios={selectedPortfolios.map((portfolio) => ({
                    portfolio_key: portfolio.portfolio_key,
                    label: portfolio.label,
                    role: portfolio.role,
                  }))}
                  kpis={kpis}
                />
              </div>
            )}

            <div className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b-2 border-slate-200 dark:border-white/5 flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-tighter text-slate-950 dark:text-white">
                  Holdings (selected)
                </h2>
                <span className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                  {holdingPortfolioKey ?? 'n/a'}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-[#080A0F]">
                    <tr>
                      <th className="p-4 text-left text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                        Ticker
                      </th>
                      <th className="p-4 text-right text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                        Weight
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdingWeights.length === 0 && (
                      <tr>
                        <td colSpan={2} className="p-4 text-sm text-slate-500 dark:text-gray-400">
                          No holdings data.
                        </td>
                      </tr>
                    )}
                    {holdingWeights.map((holding) => (
                      <tr key={holding.ticker} className="border-b border-slate-200/60 dark:border-white/5">
                        <td className="p-4 text-[11px] font-mono text-slate-700 dark:text-gray-200">
                          {holding.ticker}
                        </td>
                        <td className="p-4 text-right text-[11px] font-mono text-slate-900 dark:text-gray-200">
                          {formatPct(holding.weight)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
