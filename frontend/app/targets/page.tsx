"use client"

import React, { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Sidebar } from '../../components/Sidebar'
import { Header } from '../../components/Header'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { Save, Target } from 'lucide-react'

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
}

interface PositionDraft extends PositionRow {
  targetDraft: string
}

function formatPortfolioName(portfolio: PortfolioRow): string {
  if (portfolio.name && portfolio.name.trim()) return portfolio.name
  return `Portfolio ${portfolio.id.slice(0, 6)}`
}

export default function TargetsPage() {
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>('')
  const [drafts, setDrafts] = useState<Record<string, PositionDraft>>({})
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const { data: portfolios } = useSWR('portfolios', async () => {
    const { data, error } = await supabase.from('portfolios').select('id,name')
    if (error) throw error
    return (data ?? []) as PortfolioRow[]
  })

  useEffect(() => {
    if (!portfolios || portfolios.length === 0) return
    if (selectedPortfolioId) return
    setSelectedPortfolioId(portfolios[0].id)
  }, [portfolios, selectedPortfolioId])

  const { data: positions, mutate } = useSWR(
    selectedPortfolioId ? ['positions', selectedPortfolioId] : null,
    async () => {
      const { data, error } = await supabase
        .from('portfolio_positions')
        .select('portfolio_id,ticker,name,instrument_type,currency,quantity_current,target_weight_pct')
        .eq('portfolio_id', selectedPortfolioId)
        .order('ticker', { ascending: true })
      if (error) throw error
      return (data ?? []) as PositionRow[]
    }
  )

  useEffect(() => {
    if (!positions) return
    const nextDrafts: Record<string, PositionDraft> = {}
    positions.forEach((row) => {
      nextDrafts[row.ticker] = {
        ...row,
        targetDraft:
          row.target_weight_pct !== null && row.target_weight_pct !== undefined
            ? row.target_weight_pct.toFixed(2)
            : '',
      }
    })
    setDrafts(nextDrafts)
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

  const totalTarget = useMemo(() => {
    return Object.values(drafts).reduce((sum, row) => {
      const value = Number.parseFloat(row.targetDraft)
      return sum + (Number.isFinite(value) ? value : 0)
    }, 0)
  }, [drafts])

  const handleDraftChange = (ticker: string, value: string) => {
    setDrafts((prev) => {
      const current = prev[ticker]
      if (!current) return prev
      return { ...prev, [ticker]: { ...current, targetDraft: value } }
    })
  }

  const handleSave = async () => {
    if (!positions || positions.length === 0) return
    setSaving(true)
    setStatusMessage('')

    try {
      const updates = Object.values(drafts)
        .map((row) => {
          const nextValue = row.targetDraft.trim() === '' ? null : Number.parseFloat(row.targetDraft)
          const currentValue = row.target_weight_pct
          const normalizedNext = nextValue !== null && Number.isFinite(nextValue) ? nextValue : null
          const normalizedCurrent = currentValue !== null && currentValue !== undefined ? currentValue : null

          const changed = normalizedNext !== normalizedCurrent
          if (!changed) return null

          return {
            portfolio_id: row.portfolio_id,
            ticker: row.ticker,
            target_weight_pct: normalizedNext,
          }
        })
        .filter((item): item is { portfolio_id: string; ticker: string; target_weight_pct: number | null } => item !== null)

      for (const update of updates) {
        const { error } = await supabase
          .from('portfolio_positions')
          .update({ target_weight_pct: update.target_weight_pct })
          .eq('portfolio_id', update.portfolio_id)
          .eq('ticker', update.ticker)
        if (error) throw error
      }

      setStatusMessage(updates.length > 0 ? 'Targets saved.' : 'No changes to save.')
      mutate()
    } catch (error) {
      console.error('Error saving targets', error)
      setStatusMessage('Save failed. Check RLS policies or Supabase permissions.')
    } finally {
      setSaving(false)
    }
  }

  const lastSync = useMemo(() => {
    if (!positions || positions.length === 0) return ''
    return new Date().toLocaleTimeString('fr-FR')
  }, [positions])

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#080A0F] transition-colors duration-500">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Header lastSync={lastSync} />
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
                    onChange={(event) => setSelectedPortfolioId(event.target.value)}
                    className="bg-transparent text-[10px] font-black text-slate-900 dark:text-white outline-none"
                  >
                    {(portfolios ?? []).map((portfolio) => (
                      <option key={portfolio.id} value={portfolio.id}>
                        {formatPortfolioName(portfolio)}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={cn(
                    'px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-2',
                    saving
                      ? 'bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-gray-500'
                      : 'bg-[#00FF88] text-black hover:bg-[#00e07b]'
                  )}
                >
                  <Save size={12} />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-gray-400">
              <span>Total target: {totalTarget.toFixed(2)}%</span>
              {statusMessage && <span>{statusMessage}</span>}
            </div>

            <div className="space-y-6">
              {grouped.map(([group, rows]) => (
                <div key={group} className="bg-white dark:bg-[#0D1117]/50 rounded-3xl border-2 border-slate-200 dark:border-white/5 shadow-2xl overflow-hidden">
                  <div className="px-6 py-4 border-b-2 border-slate-200 dark:border-white/5 flex items-center justify-between">
                    <h2 className="text-sm font-black uppercase tracking-tighter text-slate-950 dark:text-white">{group}</h2>
                    <span className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                      {rows.length} positions
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
                                  onChange={(event) => handleDraftChange(row.ticker, event.target.value)}
                                  className="w-24 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0A0D12] px-2 py-1 text-right text-sm font-mono font-bold text-slate-950 dark:text-white"
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
