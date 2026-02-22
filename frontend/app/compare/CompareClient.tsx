"use client"

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { BacktestChart, LineSeries } from '../../components/BacktestChart'
import { DrawdownChart } from '../../components/DrawdownChart'
import { KpiComparisonTable } from '../../components/KpiComparisonTable'
import { PortfolioSelectGrid, PortfolioCard } from '../../components/PortfolioSelectGrid'
import { DataStateBadge, DataState } from '../../components/DataStateBadge'
import { BacktestKpi, BacktestPortfolio, BacktestResult, BacktestRun, CompareSelection } from '../../types'

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

function base64UrlEncode(value: string): string {
  const base64 = btoa(unescape(encodeURIComponent(value)))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): string | null {
  try {
    let base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const pad = base64.length % 4
    if (pad) {
      base64 += '='.repeat(4 - pad)
    }
    return decodeURIComponent(escape(atob(base64)))
  } catch {
    return null
  }
}

function normalizeSelection(selection: CompareSelection): CompareSelection {
  const sorted = [...selection.portfolios].sort((a, b) => {
    const keyCompare = a.key.localeCompare(b.key, 'en')
    if (keyCompare !== 0) return keyCompare
    return a.role.localeCompare(b.role, 'en')
  })
  return {
    runId: selection.runId,
    portfolios: sorted,
  }
}

function encodeSelection(selection: CompareSelection): string {
  const normalized = normalizeSelection(selection)
  return base64UrlEncode(JSON.stringify(normalized))
}

function decodeSelection(encoded: string): CompareSelection | null {
  const raw = base64UrlDecode(encoded)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as CompareSelection
    if (!parsed || typeof parsed.runId !== 'string' || !Array.isArray(parsed.portfolios)) {
      return null
    }
    const portfolios = parsed.portfolios
      .filter((item) => item && typeof item.key === 'string' && typeof item.role === 'string')
      .map((item) => ({ key: item.key, role: item.role }))
    if (portfolios.length === 0) return null
    return { runId: parsed.runId, portfolios }
  } catch {
    return null
  }
}

function parseLegacySelection(searchParams: URLSearchParams): CompareSelection | null {
  const runId = searchParams.get('run')
  if (!runId) return null
  const portfolios = searchParams.getAll('p').map((raw) => {
    const [role, ...rest] = raw.split(':')
    const key = rest.join(':')
    return { key, role }
  }).filter((item) => item.key && item.role)
  if (portfolios.length === 0) return null
  return { runId, portfolios }
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

export default function CompareClient() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const skipUrlSync = useRef(false)
  const [runs, setRuns] = useState<BacktestRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>('')
  const [portfolios, setPortfolios] = useState<BacktestPortfolio[]>([])
  const [results, setResults] = useState<Record<string, BacktestResult[]>>({})
  const [kpis, setKpis] = useState<Record<string, BacktestKpi>>({})
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string>('')
  const [pendingSelection, setPendingSelection] = useState<CompareSelection | null>(null)

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
    if (!searchParams) return
    const encoded = searchParams.get('s')
    const decoded = encoded ? decodeSelection(encoded) : null
    const legacy = decoded ? null : parseLegacySelection(searchParams)
    const selection = decoded ?? legacy
    if (!selection) return
    skipUrlSync.current = true
    setPendingSelection(selection)
    if (selection.runId) {
      setSelectedRunId(selection.runId)
    }
  }, [searchParams])

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

        const defaultTarget = portfolioList.find((p) => p.role === 'target')?.portfolio_key
        const defaultBaseline = portfolioList.find((p) => p.role === 'baseline')?.portfolio_key
        const defaults = [defaultTarget, defaultBaseline].filter(Boolean) as string[]
        setSelectedKeys(defaults.length > 0 ? defaults : portfolioList.map((p) => p.portfolio_key))
      } catch (err) {
        console.error('Backtest run fetch error', err)
        setError('Unable to load backtest run data.')
      } finally {
        setLoading(false)
      }
    }

    fetchRunData()
  }, [selectedRunId])

  useEffect(() => {
    if (!pendingSelection || portfolios.length === 0) return
    const available = new Set(portfolios.map((p) => p.portfolio_key))
    const filtered = pendingSelection.portfolios.filter((p) => available.has(p.key))
    if (filtered.length > 0) {
      setSelectedKeys(filtered.map((p) => p.key))
    }
    setPendingSelection(null)
  }, [pendingSelection, portfolios])

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

  const lastSync = selectedRun?.created_at
    ? new Date(selectedRun.created_at).toLocaleTimeString('fr-FR')
    : undefined

  const shareLink = useMemo(() => {
    if (typeof window === 'undefined') return ''
    if (!selectedRunId || selectedKeys.length === 0) return ''
    const selection: CompareSelection = {
      runId: selectedRunId,
      portfolios: selectedKeys.map((key) => {
        const role = portfolios.find((p) => p.portfolio_key === key)?.role ?? 'preset'
        return { key, role }
      }),
    }
    const encoded = encodeSelection(selection)
    const params = new URLSearchParams()
    params.set('run', selectedRunId)
    params.set('s', encoded)
    selection.portfolios.forEach((item) => {
      params.append('p', `${item.role}:${item.key}`)
    })
    return `${window.location.origin}${pathname}?${params.toString()}`
  }, [selectedRunId, selectedKeys, portfolios, pathname])

  useEffect(() => {
    if (!selectedRunId || selectedKeys.length === 0 || !searchParams) return
    if (skipUrlSync.current) {
      skipUrlSync.current = false
      return
    }
    const selection: CompareSelection = {
      runId: selectedRunId,
      portfolios: selectedKeys.map((key) => {
        const role = portfolios.find((p) => p.portfolio_key === key)?.role ?? 'preset'
        return { key, role }
      }),
    }
    const encoded = encodeSelection(selection)
    const params = new URLSearchParams()
    params.set('run', selectedRunId)
    params.set('s', encoded)
    selection.portfolios.forEach((item) => {
      params.append('p', `${item.role}:${item.key}`)
    })
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [selectedRunId, selectedKeys, portfolios, router, pathname, searchParams])

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
                  Compare Portfolios
                </h1>
                <p className="text-xs font-mono text-slate-500 dark:text-gray-400">
                  Target vs presets · Multi-portfolio comparison
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
              <button
                onClick={async () => {
                  if (!shareLink) return
                  try {
                    await navigator.clipboard.writeText(shareLink)
                    setCopyStatus('Link copied')
                    setTimeout(() => setCopyStatus(''), 1600)
                  } catch (err) {
                    console.error('Clipboard error', err)
                    setCopyStatus('Copy failed')
                    setTimeout(() => setCopyStatus(''), 1600)
                  }
                }}
                className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors bg-[#00FF88] text-black hover:bg-[#00e07b]"
              >
                Copy share link
              </button>
              {selectedRun && (
                <div className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                  Requested {formatDate(selectedRun.start_date)} → {formatDate(selectedRun.end_date)}
                </div>
              )}
            </div>

            {copyStatus && (
              <div className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                {copyStatus}
              </div>
            )}

            {anyCoverageGap && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm font-mono text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
                Coverage gaps detected. Consider running with <span className="font-black">common_start</span> to align histories.
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

            {chartPayload.dates.length === 0 ? (
              <div className="rounded-3xl border-2 border-slate-200 dark:border-white/5 bg-white dark:bg-[#0D1117]/50 shadow-2xl p-6 text-sm font-mono text-slate-500 dark:text-gray-400">
                No comparison data available.
              </div>
            ) : (
              <div className="space-y-6">
                <BacktestChart dates={chartPayload.dates} series={chartPayload.navSeries} title="Performance (NAV)" />
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
          </div>
        </main>
      </div>
    </div>
  )
}
