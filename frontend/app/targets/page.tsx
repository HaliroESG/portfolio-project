"use client"

import React, { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { EmptyState } from '../../components/EmptyState'
import { supabase } from '../../lib/supabase'
import { LockKeyhole, Target } from 'lucide-react'

interface PortfolioRow {
  id: string
  name: string | null
}

interface PositionRow {
  portfolio_id: string
  ticker: string
  name: string | null
  instrument_type: string | null
  currency: string | null
  quantity_current: number | null
  target_weight_pct: number | null
  updated_at: string | null
}

interface PositionDraft extends PositionRow {
  targetDraft: string
}

function formatPortfolioName(portfolio: PortfolioRow): string {
  if (portfolio.name && portfolio.name.trim()) return portfolio.name
  return `Portfolio ${portfolio.id.slice(0, 6)}`
}

export default function TargetsPage() {
  const [selectedPortfolioIdOverride, setSelectedPortfolioIdOverride] = useState<string>('')

  const { data: portfolios } = useSWR('portfolios', async () => {
    const { data, error } = await supabase.from('portfolios').select('id,name')
    if (error) throw error
    return (data ?? []) as PortfolioRow[]
  })

  const selectedPortfolioId = selectedPortfolioIdOverride || portfolios?.[0]?.id || ''

  const { data: positions } = useSWR(
    selectedPortfolioId ? ['positions', selectedPortfolioId] : null,
    async () => {
      const { data, error } = await supabase
        .from('portfolio_positions')
        .select('portfolio_id,ticker,name,instrument_type,currency,quantity_current,target_weight_pct,updated_at')
        .eq('portfolio_id', selectedPortfolioId)
        .order('ticker', { ascending: true })
      if (error) throw error
      return (data ?? []) as PositionRow[]
    }
  )

  const drafts = useMemo(() => {
    const nextDrafts: Record<string, PositionDraft> = {}
    ;(positions ?? []).forEach((row) => {
      nextDrafts[row.ticker] = {
        ...row,
        targetDraft:
          row.target_weight_pct !== null && row.target_weight_pct !== undefined
            ? row.target_weight_pct.toFixed(2)
            : '',
      }
    })
    return nextDrafts
  }, [positions])

  const grouped = useMemo(() => {
    const groups = new Map<string, PositionDraft[]>()
    Object.values(drafts).forEach((row) => {
      const key = row.instrument_type?.toUpperCase() || 'UNCLASSIFIED'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)?.push(row)
    })
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'en'))
  }, [drafts])

  const targetStats = useMemo(() => {
    const rows = Object.values(drafts)
    const configured = rows.filter((row) => row.targetDraft.trim() !== '' && Number.isFinite(Number.parseFloat(row.targetDraft)))
    const totalTarget = configured.reduce((sum, row) => sum + Number.parseFloat(row.targetDraft), 0)

    return {
      positions: rows.length,
      configured: configured.length,
      missing: rows.length - configured.length,
      totalTarget,
      ready: rows.length > 0 && rows.length === configured.length && Math.abs(totalTarget - 100) <= 0.05,
    }
  }, [drafts])

  const { lastSync, lastSyncIso } = useMemo(() => {
    if (!positions || positions.length === 0) return { lastSync: '', lastSyncIso: null as string | null }
    const latest = positions
      .map((position) => position.updated_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]

    return {
      lastSync: latest ? new Date(latest).toLocaleTimeString('fr-FR') : '',
      lastSyncIso: latest ?? null,
    }
  }, [positions])

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#080A0F] transition-colors duration-500">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header lastSync={lastSync} lastSyncIso={lastSyncIso} />
        <main className="flex-1 p-10 overflow-y-auto">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Target className="text-[#00FF88]" />
                <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-950 dark:text-white">Target Allocation</h1>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-lg bg-slate-200/70 dark:bg-white/10 px-3 py-2">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400">Portfolio</span>
                  <select
                    value={selectedPortfolioId}
                    onChange={(event) => setSelectedPortfolioIdOverride(event.target.value)}
                    className="bg-transparent text-[10px] font-black text-slate-900 dark:text-white outline-none"
                  >
                    {(portfolios ?? []).map((portfolio) => (
                      <option key={portfolio.id} value={portfolio.id}>
                        {formatPortfolioName(portfolio)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-2 bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-gray-400 border border-slate-300 dark:border-white/10">
                  <LockKeyhole size={12} />
                  Read only
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                ['Positions', targetStats.positions.toString()],
                ['Configured', targetStats.configured.toString()],
                ['Missing targets', targetStats.missing.toString()],
                ['Total target', `${targetStats.totalTarget.toFixed(2)}%`],
                ['State', targetStats.ready ? 'READY' : 'NOT READY'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/[0.03] px-4 py-3">
                  <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">{label}</div>
                  <div className="mt-1 text-sm font-mono font-black text-slate-950 dark:text-white">{value}</div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-amber-300/70 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-xs font-mono text-amber-800 dark:text-amber-300">
              Targets are read-only in the frontend. Updates must come from a backend/service-role workflow or a future auth-gated route.
            </div>

            <div className="space-y-6">
              {grouped.length === 0 && (
                <EmptyState
                  title="No portfolio positions"
                  message="No positions are available for this portfolio. Target validation starts once Supabase returns portfolio_positions rows."
                />
              )}
              {grouped.map(([group, rows]) => (
                <div key={group} className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden">
                  <div className="px-6 py-4 border-b-2 border-slate-200 dark:border-white/5 flex items-center justify-between">
                    <h2 className="text-sm font-black uppercase tracking-tighter text-slate-950 dark:text-white">{group}</h2>
                    <span className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                      {rows.length} positions - {rows.filter((row) => row.targetDraft.trim() === '').length} missing
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 dark:bg-[#080A0F]">
                        <tr>
                          <th className="p-4 text-left text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">Asset</th>
                          <th className="p-4 text-left text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">Ticker</th>
                          <th className="p-4 text-left text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">Currency</th>
                          <th className="p-4 text-right text-[10px] font-black text-slate-950 dark:text-gray-500 uppercase tracking-widest border-b border-slate-200 dark:border-white/5">Target %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                        {rows.map((row) => (
                          <tr key={row.ticker} className="hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors">
                            <td className="p-4 text-sm font-black text-slate-950 dark:text-white">{row.name || row.ticker}</td>
                            <td className="p-4 text-sm font-mono font-bold text-slate-500 dark:text-gray-400">{row.ticker}</td>
                            <td className="p-4 text-sm font-mono text-slate-500 dark:text-gray-400">{row.currency || '--'}</td>
                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <input
                                  type="number"
                                  value={row.targetDraft}
                                  readOnly
                                  disabled
                                  className="w-24 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-[#0A0D12] px-2 py-1 text-right text-sm font-mono font-bold text-slate-500 dark:text-gray-500 cursor-not-allowed"
                                  placeholder="--"
                                  min={0}
                                  max={100}
                                  step={0.1}
                                />
                                <span className="text-xs font-mono text-slate-400 dark:text-gray-500">%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
