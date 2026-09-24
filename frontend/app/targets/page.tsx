"use client"

import React, { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Database, FileSpreadsheet, LockKeyhole, Target } from 'lucide-react'
import { AppShell } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import {
  assessFamilyOfficeAllocation,
  buildFamilyOfficeAllocationRows,
  loadFamilyOfficeAllocationSource,
} from '../../lib/familyOfficeAllocation'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import type {
  FamilyOfficeAllocationAssessmentRow,
} from '../../lib/familyOfficeAllocation'
import type {
  PortfolioScope,
  TargetBucketRow,
  TargetEnvelopeLineRow,
  TargetModelRow,
  TargetSleeveAllocationRow,
  TargetSleeveKey,
} from '../../types'

interface PortfolioRow {
  id: string
  name: string | null
  portfolio_type: string | null
}

type RawRow = Record<string, unknown>

type DriftPriority = 'ACTION' | 'WATCH' | 'OK' | 'UNAVAILABLE'
type FreshnessState = 'FRESH' | 'STALE' | 'MISSING'

interface PositionView extends FamilyOfficeAllocationAssessmentRow {
  displayCurrency: string
  quantity: number | null
  currentValueEur: number | null
  currentWeightPct: number | null
  targetPct: number | null
  driftPct: number | null
  rebalanceAmountEur: number | null
  priority: DriftPriority
  dataState: string
  sourceLabel: string
  actualFreshness: FreshnessState
}

function readNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function formatPortfolioName(portfolio: PortfolioRow): string {
  if (portfolio.name && portfolio.name.trim()) return portfolio.name
  return `Portfolio ${portfolio.id.slice(0, 6)}`
}

function formatPercent(value: number | null, digits = 2): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value.toFixed(digits)}%`
}

function formatSignedPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} pts`
}

function formatEur(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value)
}

function formatSignedEur(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '--'
  return `${value >= 0 ? '+' : ''}${formatEur(value)}`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseScope(value: unknown): PortfolioScope | null {
  if (value === 'PERSO' || value === 'PRO') return value
  return null
}

function scopeFromPortfolioType(value: unknown): PortfolioScope | null {
  if (value === 'PERSONAL') return 'PERSO'
  if (value === 'PROFESSIONAL') return 'PRO'
  return null
}

function parseTargetModel(raw: RawRow): TargetModelRow | null {
  const id = readString(raw.id)
  const modelName = readString(raw.model_name)
  const sourceFile = readString(raw.source_file)
  const portfolioScope = parseScope(raw.portfolio_scope)
  if (!id || !modelName || !sourceFile || !portfolioScope) return null
  return {
    id,
    portfolio_scope: portfolioScope,
    model_name: modelName,
    source_file: sourceFile,
    source_kind: readString(raw.source_kind) ?? 'unknown',
    as_of_date: readString(raw.as_of_date),
    is_active: raw.is_active === true,
    target_total_pct: readNumber(raw.target_total_pct as number | string | null),
    allocation_contract_version: readString(raw.allocation_contract_version),
    reserve_floor_eur: readNumber(raw.reserve_floor_eur as number | string | null),
    reserve_excluded_from_risky_allocation: raw.reserve_excluded_from_risky_allocation === true,
    status: readString(raw.status) ?? 'UNKNOWN',
    report_json: raw.report_json && typeof raw.report_json === 'object' && !Array.isArray(raw.report_json)
      ? raw.report_json as Record<string, unknown>
      : {},
    imported_at: readString(raw.imported_at) ?? '',
    updated_at: readString(raw.updated_at) ?? '',
  }
}

function parseTargetSleeveKey(value: unknown): TargetSleeveKey | null {
  return value === 'CORE' || value === 'SATELLITE' ? value : null
}

function parseTargetSleeveAllocation(raw: RawRow): TargetSleeveAllocationRow | null {
  const id = readNumber(raw.id as number | string | null)
  const modelId = readString(raw.model_id)
  const sleeveKey = parseTargetSleeveKey(raw.sleeve_key)
  const componentLabel = readString(raw.component_label)
  const bucketKey = readString(raw.bucket_key)
  const bucketLabel = readString(raw.bucket_label)
  const targetWeight = readNumber(raw.target_weight_pct as number | string | null)
  const portfolioScope = parseScope(raw.portfolio_scope)
  if (id === null || !modelId || !portfolioScope || !sleeveKey || !componentLabel || !bucketKey || !bucketLabel || targetWeight === null) return null
  return {
    id,
    model_id: modelId,
    portfolio_scope: portfolioScope,
    sleeve_key: sleeveKey,
    component_label: componentLabel,
    bucket_key: bucketKey,
    bucket_label: bucketLabel,
    target_weight_pct: targetWeight,
    instrument_policy: readString(raw.instrument_policy),
    activation_status: readString(raw.activation_status) ?? 'UNKNOWN',
    source_sheet: readString(raw.source_sheet),
    source_row: readNumber(raw.source_row as number | string | null),
    updated_at: readString(raw.updated_at) ?? '',
  }
}

function parseTargetBucket(raw: RawRow): TargetBucketRow | null {
  const id = readNumber(raw.id as number | string | null)
  const modelId = readString(raw.model_id)
  const bucketKey = readString(raw.bucket_key)
  const bucketLabel = readString(raw.bucket_label)
  const targetWeight = readNumber(raw.target_weight_pct as number | string | null)
  const lowerBand = readNumber(raw.lower_band_pct as number | string | null)
  const upperBand = readNumber(raw.upper_band_pct as number | string | null)
  const lowerBandProvided = raw.lower_band_pct !== null && raw.lower_band_pct !== undefined
  const upperBandProvided = raw.upper_band_pct !== null && raw.upper_band_pct !== undefined
  const portfolioScope = parseScope(raw.portfolio_scope)
  if (id === null
    || !modelId
    || !portfolioScope
    || !bucketKey
    || !bucketLabel
    || targetWeight === null
    || (lowerBandProvided && lowerBand === null)
    || (upperBandProvided && upperBand === null)
  ) return null
  return {
    id,
    model_id: modelId,
    portfolio_scope: portfolioScope,
    bucket_key: bucketKey,
    bucket_label: bucketLabel,
    parent_bucket_key: readString(raw.parent_bucket_key),
    target_weight_pct: targetWeight,
    lower_band_pct: lowerBand,
    upper_band_pct: upperBand,
    source_sheet: readString(raw.source_sheet),
    source_row: readNumber(raw.source_row as number | string | null),
    updated_at: readString(raw.updated_at) ?? '',
  }
}

function parseTargetBuckets(rawRows: RawRow[]): TargetBucketRow[] {
  return rawRows.map((raw) => {
    const row = parseTargetBucket(raw)
    if (row === null) throw new Error('Target bucket contract contains an invalid row')
    return row
  })
}

function parseTargetEnvelopeLine(raw: RawRow): TargetEnvelopeLineRow | null {
  const id = readNumber(raw.id as number | string | null)
  const modelId = readString(raw.model_id)
  const envelope = readString(raw.envelope)
  const portfolioScope = parseScope(raw.portfolio_scope)
  if (id === null || !modelId || !portfolioScope || !envelope) return null
  return {
    id,
    model_id: modelId,
    portfolio_scope: portfolioScope,
    envelope,
    ticker: readString(raw.ticker),
    isin: readString(raw.isin),
    instrument: readString(raw.instrument),
    asset_class: readString(raw.asset_class),
    region: readString(raw.region),
    currency: readString(raw.currency),
    target_weight_pct: readNumber(raw.target_weight_pct as number | string | null),
    target_value_eur: readNumber(raw.target_value_eur as number | string | null),
    notes: readString(raw.notes),
    source_sheet: readString(raw.source_sheet),
    source_row: readNumber(raw.source_row as number | string | null),
    updated_at: readString(raw.updated_at) ?? '',
  }
}

function resolveFreshnessDate(value: string | null | undefined, staleAfterDays = 3): FreshnessState {
  if (!value) return 'MISSING'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'MISSING'
  const ageDays = (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)
  return ageDays > staleAfterDays ? 'STALE' : 'FRESH'
}

function freshnessClass(state: FreshnessState): string {
  if (state === 'FRESH') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
  if (state === 'STALE') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'
  return 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
}

function resolvePriority(position: FamilyOfficeAllocationAssessmentRow): DriftPriority {
  if (position.action === 'UNAVAILABLE' || position.current_value_eur === null || position.drift_pct === null) return 'UNAVAILABLE'
  if (position.action === 'BUY' || position.action === 'REDUCE' || position.action === 'EXIT') return 'ACTION'
  const absoluteDrift = Math.abs(position.drift_pct)
  if (absoluteDrift >= 1) return 'WATCH'
  return 'OK'
}

function priorityClass(priority: DriftPriority): string {
  if (priority === 'ACTION') return 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300'
  if (priority === 'WATCH') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'
  if (priority === 'OK') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
  return 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
}

export default function TargetsPage() {
  const [selectedPortfolioIdOverride, setSelectedPortfolioIdOverride] = useState<string>('')

  const { data: portfolios } = useSWR('fo-target-portfolios', async () => {
    const { data, error } = await supabase.from('fo_portfolios').select('id,name,portfolio_type').eq('status', 'ACTIVE').order('name')
    if (error) throw error
    return (data ?? []) as PortfolioRow[]
  })

  const selectedPortfolioId = selectedPortfolioIdOverride || portfolios?.[0]?.id || ''
  const selectedPortfolio = portfolios?.find((portfolio) => portfolio.id === selectedPortfolioId) ?? null
  const selectedScope = scopeFromPortfolioType(selectedPortfolio?.portfolio_type)

  const { data: allocationRows = [], error: allocationError, isLoading: allocationLoading } = useSWR(
    selectedPortfolioId ? ['fo-allocation-source', selectedPortfolioId] : null,
    async () => buildFamilyOfficeAllocationRows(await loadFamilyOfficeAllocationSource(supabase, selectedPortfolioId)),
  )

  const { data: targetModels = [], error: targetModelError, isLoading: targetModelLoading } = useSWR('target-models', async () => {
    const { data, error } = await supabase
      .from('target_models')
      .select('id,portfolio_scope,model_name,source_file,source_kind,as_of_date,is_active,target_total_pct,allocation_contract_version,reserve_floor_eur,reserve_excluded_from_risky_allocation,status,report_json,imported_at,updated_at')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
    if (error) throw error
    return ((data ?? []) as unknown as RawRow[])
      .map(parseTargetModel)
      .filter((row): row is TargetModelRow => row !== null)
  })

  const selectedTargetModel = selectedScope
    ? targetModels.find((model) => model.portfolio_scope === selectedScope) ?? null
    : null

  const {
    data: targetSleeves = [],
    error: targetSleevesError,
    isLoading: targetSleevesLoading,
  } = useSWR(
    selectedTargetModel?.portfolio_scope === 'PRO' ? ['target-sleeves', selectedTargetModel.id] : null,
    async () => {
      const { data, error } = await supabase
        .from('target_sleeve_allocations')
        .select('id,model_id,portfolio_scope,sleeve_key,component_label,bucket_key,bucket_label,target_weight_pct,instrument_policy,activation_status,source_sheet,source_row,updated_at')
        .eq('model_id', selectedTargetModel!.id)
        .order('source_row', { ascending: true })
      if (error) throw error
      return ((data ?? []) as unknown as RawRow[])
        .map(parseTargetSleeveAllocation)
        .filter((row): row is TargetSleeveAllocationRow => row !== null)
    },
  )

  const {
    data: targetBuckets = [],
    error: targetBucketsError,
    isLoading: targetBucketsLoading,
  } = useSWR(
    selectedTargetModel ? ['target-buckets', selectedTargetModel.id] : null,
    async () => {
      const { data, error } = await supabase
        .from('target_buckets')
        .select('id,model_id,portfolio_scope,bucket_key,bucket_label,parent_bucket_key,target_weight_pct,lower_band_pct,upper_band_pct,source_sheet,source_row,updated_at')
        .eq('model_id', selectedTargetModel!.id)
        .order('source_row', { ascending: true })
      if (error) throw error
      return parseTargetBuckets((data ?? []) as unknown as RawRow[])
    }
  )

  const {
    data: targetEnvelopeLinesData,
    error: targetEnvelopeLinesError,
    isLoading: targetEnvelopeLinesLoading,
  } = useSWR(
    selectedTargetModel ? ['target-envelope-lines', selectedTargetModel.id] : null,
    async () => {
      const { data, error } = await supabase
        .from('target_envelope_lines')
        .select('id,model_id,portfolio_scope,envelope,ticker,isin,instrument,asset_class,region,currency,target_weight_pct,target_value_eur,notes,source_sheet,source_row,updated_at')
        .eq('model_id', selectedTargetModel!.id)
        .order('envelope', { ascending: true })
        .order('source_row', { ascending: true })
      if (error) throw error
      return ((data ?? []) as unknown as RawRow[])
        .map(parseTargetEnvelopeLine)
        .filter((row): row is TargetEnvelopeLineRow => row !== null)
    }
  )
  const targetEnvelopeLines = useMemo(() => targetEnvelopeLinesData ?? [], [targetEnvelopeLinesData])
  const targetEnvelopeLinesReady = !selectedTargetModel
    || (!targetEnvelopeLinesLoading && !targetEnvelopeLinesError && targetEnvelopeLinesData !== undefined)

  const sourceLoading = allocationLoading
    || targetModelLoading
    || Boolean(selectedTargetModel && targetBucketsLoading)
    || Boolean(selectedTargetModel && targetEnvelopeLinesLoading)
    || Boolean(selectedTargetModel?.portfolio_scope === 'PRO' && targetSleevesLoading)
  const sourceError = allocationError ?? targetModelError ?? targetBucketsError ?? targetEnvelopeLinesError ?? targetSleevesError

  const assessment = useMemo(
    () => !sourceLoading && !sourceError && targetEnvelopeLinesReady && selectedScope
      ? assessFamilyOfficeAllocation(allocationRows, selectedTargetModel, targetEnvelopeLines, {
        expectedScope: selectedScope,
        targetBuckets,
        targetSleeves,
      })
      : {
        rows: [],
        total_value_eur: null,
        target_total_pct: selectedTargetModel?.target_total_pct ?? null,
        target_model_ready: false,
      },
    [allocationRows, selectedScope, selectedTargetModel, sourceError, sourceLoading, targetBuckets, targetEnvelopeLines, targetEnvelopeLinesReady, targetSleeves],
  )

  const positionViews = useMemo(() => assessment.rows.map((row): PositionView => ({
    ...row,
    displayCurrency: row.currency,
    quantity: row.current_quantity,
    currentValueEur: row.current_value_eur,
    currentWeightPct: row.current_weight_pct,
    targetPct: row.target_weight_pct,
    driftPct: row.drift_pct,
    rebalanceAmountEur: row.rebalance_amount_eur,
    priority: resolvePriority(row),
    dataState: row.reason_codes.length > 0 ? row.reason_codes.join(' · ') : 'READY',
    sourceLabel: `${row.envelope} · ${row.source_accounts.length} account${row.source_accounts.length > 1 ? 's' : ''}`,
    actualFreshness: resolveFreshnessDate(row.as_of_date),
  })), [assessment.rows])

  const grouped = useMemo(() => {
    const groups = new Map<string, PositionView[]>()
    positionViews.forEach((row) => {
      const key = row.instrument_type?.toUpperCase() || 'UNCLASSIFIED'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)?.push(row)
    })
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'en'))
  }, [positionViews])

  const targetStats = useMemo(() => {
    const targetable = positionViews.filter((row) => row.allocation_role !== 'PROTECTED_RESERVE')
    const configured = targetable.filter((row) => row.targetPct !== null)
    const totalTarget = configured.reduce((sum, row) => sum + (row.targetPct ?? 0), 0)
    const portfolioValueEur = assessment.total_value_eur
    const actionCount = positionViews.filter((row) => row.priority === 'ACTION').length
    const maxDrift = positionViews.reduce((max, row) => Math.max(max, Math.abs(row.driftPct ?? 0)), 0)
    const brokerFed = positionViews.length
    const staleActual = positionViews.filter((row) => row.actualFreshness === 'STALE').length
    const latestTargetUpdate = selectedTargetModel?.updated_at ?? null
    const latestTargetFile = selectedTargetModel?.source_file ?? null

    return {
      positions: positionViews.length,
      configured: configured.length,
      missing: targetable.length - configured.length,
      totalTarget,
      portfolioValueEur,
      actionCount,
      maxDrift,
      brokerFed,
      staleActual,
      latestTargetUpdate,
      latestTargetFile,
      ready: assessment.target_model_ready && targetable.length > 0 && targetable.length === configured.length,
    }
  }, [assessment.target_model_ready, assessment.total_value_eur, positionViews, selectedTargetModel])

  const snapshotStats = useMemo(() => {
    const sourceKeys = new Set(positionViews.flatMap((row) => row.source_accounts.map((account) => account.account_id)))
    const latestAsOf =
      positionViews
        .map((row) => row.as_of_date)
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
    const latestFreshness = resolveFreshnessDate(latestAsOf)
    return {
      error: sourceError?.message ?? null,
      sourceCount: sourceKeys.size,
      latestAsOf,
      latestFreshness,
    }
  }, [positionViews, sourceError])

  const { lastSync, lastSyncIso } = useMemo(() => {
    if (positionViews.length === 0) return { lastSync: '', lastSyncIso: null as string | null }
    const latest = positionViews
      .map((position) => position.updated_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]

    return {
      lastSync: latest ? new Date(latest).toLocaleTimeString('fr-FR') : '',
      lastSyncIso: latest ?? null,
    }
  }, [positionViews])

  return (
    <AppShell lastSync={lastSync} lastSyncIso={lastSyncIso} className="bg-slate-50">
      <main className="p-3 sm:p-6 lg:p-10">
        <div className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Target className="h-5 w-5 shrink-0 text-[#00FF88]" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-black uppercase tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                  Portfolio Drift
                </h1>
                <p className="mt-1 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                  Current weight vs target allocation, read from Supabase.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <div className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-200/70 px-3 py-2 dark:bg-white/10">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-400">Portfolio</span>
                <select
                  value={selectedPortfolioId}
                  onChange={(event) => setSelectedPortfolioIdOverride(event.target.value)}
                  className="max-w-[180px] bg-transparent text-[10px] font-black text-slate-900 outline-none dark:text-white"
                >
                  {(portfolios ?? []).map((portfolio) => (
                    <option key={portfolio.id} value={portfolio.id}>
                      {formatPortfolioName(portfolio)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-gray-400">
                <LockKeyhole size={12} />
                Read only
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            {[
              ['Liquid allocation', formatEur(targetStats.portfolioValueEur || null)],
              ['Positions', targetStats.positions.toString()],
              ['Configured', targetStats.configured.toString()],
              ['Missing targets', targetStats.missing.toString()],
              ['Max drift', formatPercent(targetStats.maxDrift, 2)],
              ['Actions', targetStats.actionCount.toString()],
              ['FO-fed', targetStats.brokerFed.toString()],
              ['Stale actuals', targetStats.staleActual.toString()],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white/80 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">{label}</div>
                <div className="mt-1 text-sm font-mono font-black text-slate-950 dark:text-white">{value}</div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-amber-300/70 bg-amber-50 px-4 py-3 text-xs font-mono text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/20 dark:text-amber-300">
            Targets stay read-only in the frontend. Allocation updates must come from a backend/service-role workflow or a future auth-gated route.
          </div>

          <section className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-white/10 dark:bg-[#0D1117]/70">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-700 dark:text-gray-300">Target Studio</h2>
                <p className="mt-1 text-[10px] font-mono text-slate-500 dark:text-gray-500">
                  Two-level target model: strategic buckets for decisions, envelope/instrument lines for execution.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-700 dark:border-white/10 dark:bg-black/20 dark:text-gray-300">
                Scope {selectedScope ?? 'UNKNOWN'} · bound to portfolio type
              </div>
            </div>

            {targetModelLoading ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-mono text-slate-600 dark:border-white/10 dark:bg-black/20 dark:text-gray-400">
                Loading target model…
              </div>
            ) : targetModelError ? (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-mono text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                Target model schema unavailable. Apply the base target migration and `20260921_allocation_contracts_v1.sql`, then run `import_target_model.py`.
              </div>
            ) : selectedTargetModel ? (
              <div className="mt-4 space-y-4">
                {targetEnvelopeLinesLoading && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-mono text-slate-600 dark:border-white/10 dark:bg-black/20 dark:text-gray-400">
                    Loading envelope execution lines… Allocation coverage is pending.
                  </div>
                )}
                {targetEnvelopeLinesError && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-mono text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                    Envelope execution lines are unavailable. Allocation coverage and actions remain blocked.
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <OperationMetric label="Model" value={selectedTargetModel.model_name} detail={selectedTargetModel.source_file} />
                  <OperationMetric
                    label="Target total"
                    value={formatPercent(selectedTargetModel.target_total_pct)}
                    detail={`${selectedTargetModel.status} · ${selectedTargetModel.allocation_contract_version ?? 'contract UNKNOWN'}`}
                  />
                  <OperationMetric label="Buckets" value={targetBuckets.length.toString()} detail="Strategic decision level" />
                  <OperationMetric label="Envelope lines" value={targetEnvelopeLines.length.toString()} detail="Execution level" />
                </div>

                {selectedTargetModel.portfolio_scope === 'PRO' && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-black/20">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-gray-300">
                        Native PRO allocation contract
                      </div>
                      <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                        Non activated
                      </span>
                    </div>
                    {targetSleevesError ? (
                      <div className="mt-3 text-[10px] font-mono text-amber-700 dark:text-amber-300">
                        Core / Satellite rows unavailable; PRO recommendations remain blocked.
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        {(['CORE', 'SATELLITE'] as TargetSleeveKey[]).map((sleeve) => {
                          const rows = targetSleeves.filter((row) => row.sleeve_key === sleeve)
                          const total = rows.reduce((sum, row) => sum + row.target_weight_pct, 0)
                          return (
                            <OperationMetric
                              key={sleeve}
                              label={sleeve}
                              value={formatPercent(rows.length > 0 ? total : null)}
                              detail={rows.length > 0 ? `${rows.length} verifiable regional lines` : 'UNKNOWN: no native sleeve rows'}
                              tone={rows.length > 0 ? 'ok' : 'warn'}
                            />
                          )
                        })}
                        <OperationMetric
                          label="Reserve outside risk"
                          value={formatEur(selectedTargetModel.reserve_floor_eur)}
                          detail={selectedTargetModel.reserve_excluded_from_risky_allocation
                            ? 'Excluded from risky-allocation denominator'
                            : 'UNKNOWN: exclusion contract absent'}
                          tone={selectedTargetModel.reserve_floor_eur === 120000 && selectedTargetModel.reserve_excluded_from_risky_allocation ? 'ok' : 'warn'}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                  <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-white/10">
                    <div className="border-b border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:border-white/10 dark:text-gray-500">
                      Strategic buckets
                    </div>
                    <div className="divide-y divide-slate-200 dark:divide-white/10">
                      {targetBuckets.map((bucket) => (
                        <div key={bucket.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-black text-slate-900 dark:text-white">{bucket.bucket_label}</div>
                            <div className="mt-0.5 text-[10px] font-mono text-slate-500 dark:text-gray-500">
                              {bucket.lower_band_pct !== null || bucket.upper_band_pct !== null
                                ? `${formatPercent(bucket.lower_band_pct)} - ${formatPercent(bucket.upper_band_pct)}`
                                : bucket.parent_bucket_key ?? 'direct'}
                            </div>
                          </div>
                          <div className="text-right text-sm font-mono font-black text-slate-950 dark:text-white">{formatPercent(bucket.target_weight_pct)}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-white/10">
                    <div className="border-b border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:border-white/10 dark:text-gray-500">
                      Envelope execution lines
                    </div>
                    <div className="max-h-[360px] overflow-auto">
                      <table className="min-w-[640px] w-full">
                        <thead className="bg-slate-50 dark:bg-black/20">
                          <tr>
                            {['Envelope', 'Instrument', 'ISIN/Ticker', 'Target', 'Notes'].map((header) => (
                              <th key={header} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-gray-500">{header}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                          {targetEnvelopeLines.map((line) => (
                            <tr key={line.id}>
                              <td className="p-3 text-[10px] font-mono font-bold text-slate-600 dark:text-gray-300">{line.envelope}</td>
                              <td className="max-w-[220px] p-3 text-xs font-black text-slate-900 dark:text-white">
                                <div className="truncate">{line.instrument ?? '--'}</div>
                                <div className="mt-0.5 text-[10px] font-mono font-normal text-slate-500">{line.region ?? line.asset_class ?? '--'}</div>
                              </td>
                              <td className="p-3 text-[10px] font-mono text-slate-500 dark:text-gray-400">{line.isin ?? line.ticker ?? '--'}</td>
                              <td className="p-3 text-right text-xs font-mono font-black text-slate-800 dark:text-gray-200">{formatPercent(line.target_weight_pct)}</td>
                              <td className="max-w-[180px] p-3 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                                <div className="truncate">{line.notes ?? '--'}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-mono text-slate-600 dark:border-white/10 dark:bg-black/20 dark:text-gray-400">
                {selectedScope
                  ? <>No target model imported for {selectedScope}. Run `import_target_model.py --kind {selectedScope === 'PRO' ? 'pro' : 'perso'} --dry-run`, then apply with service-role credentials.</>
                  : <>Portfolio scope is unavailable. No target model or allocation action can be selected.</>}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-white/10 dark:bg-[#0D1117]/70">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Database className="h-4 w-4 shrink-0 text-[#00FF88]" />
                <div className="min-w-0">
                  <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-700 dark:text-gray-300">Data Operations</h2>
                  <p className="mt-1 truncate text-[10px] font-mono text-slate-500 dark:text-gray-500">
                    Target model and canonical Family Office snapshots feeding the consolidated current portfolio.
                  </p>
                </div>
              </div>
              {snapshotStats.error && (
                <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                  Family Office source unavailable
                </span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OperationMetric
                icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
                label="Target Excel"
                value={formatDate(targetStats.latestTargetUpdate)}
                detail={targetStats.latestTargetFile ?? 'No target import source'}
              />
              <OperationMetric
                icon={<Database className="h-3.5 w-3.5" />}
                label="FO accounts"
                value={snapshotStats.sourceCount > 0 ? `${snapshotStats.sourceCount} source${snapshotStats.sourceCount > 1 ? 's' : ''}` : '0 source'}
                detail={snapshotStats.latestAsOf ? `Latest snapshot ${formatDate(snapshotStats.latestAsOf)}` : 'No Family Office snapshot'}
              />
              <OperationMetric
                label="Consolidation"
                value={`${targetStats.brokerFed}/${targetStats.positions}`}
                detail="Rows built exclusively from fo_* read models"
              />
              <OperationMetric
                label="Blocking states"
                value={snapshotStats.error ? 'Schema' : targetStats.staleActual > 0 ? `${targetStats.staleActual} stale` : targetStats.missing > 0 ? `${targetStats.missing} missing target` : 'Clear'}
                detail={snapshotStats.error ?? 'Freshness and target completeness checks'}
                tone={snapshotStats.error || targetStats.staleActual > 0 || targetStats.missing > 0 ? 'warn' : 'ok'}
              />
            </div>
          </section>

          <div className="space-y-5">
            {sourceLoading && (
              <EmptyState
                title="Loading allocation inputs"
                message="Canonical Family Office rows and target envelope lines are still loading. Coverage has not been assessed yet."
              />
            )}

            {!sourceLoading && sourceError && (
              <EmptyState
                title="Allocation inputs unavailable"
                message="A canonical source request failed. Coverage and allocation actions remain blocked until the source is available."
              />
            )}

            {!sourceLoading && !sourceError && grouped.length === 0 && (
              <EmptyState
                title="No portfolio positions"
                message="No positions are available for this portfolio. Target validation starts once the fo_* read models return canonical positions or cash."
              />
            )}

            {!sourceLoading && !sourceError && grouped.map(([group, rows]) => (
              <section key={group} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#0D1117]/70">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
                  <h2 className="text-sm font-black uppercase tracking-tight text-slate-950 dark:text-white">{group}</h2>
                  <span className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                    {rows.length} positions - {rows.filter((row) => (
                      row.allocation_role !== 'PROTECTED_RESERVE' && row.targetPct === null
                    )).length} missing
                  </span>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-white/10 md:hidden">
                  {rows.map((row) => (
                    <button
                      key={row.row_key}
                      type="button"
                      className="block w-full bg-white p-4 text-left dark:bg-transparent"
                      aria-label={`${row.ticker} drift details`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-950 dark:text-white">{row.name || row.ticker}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-mono text-slate-500 dark:text-gray-400">
                            <span>{row.ticker}</span>
                            <span>{row.displayCurrency}</span>
                            <span>{row.sourceLabel}</span>
                            <span>{row.dataState}</span>
                          </div>
                        </div>
                        <span className={cn('shrink-0 rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', priorityClass(row.priority))}>
                          {row.priority}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Metric label="Value" value={formatEur(row.currentValueEur)} />
                        <Metric label="Current" value={formatPercent(row.currentWeightPct)} />
                        <Metric label="Target" value={formatPercent(row.targetPct)} />
                        <Metric label="Drift" value={formatSignedPercent(row.driftPct)} />
                        <Metric label="Snapshot" value={formatDate(row.as_of_date)} />
                      </div>
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-mono font-bold text-slate-700 dark:border-white/10 dark:bg-black/20 dark:text-gray-200">
                        Rebalance: {formatSignedEur(row.rebalanceAmountEur)}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="hidden md:block">
                  <div className="overflow-x-auto">
                    <table className="min-w-[1200px] w-full">
                      <thead className="bg-slate-50 dark:bg-[#080A0F]">
                        <tr>
                          {['Asset', 'Ticker', 'Currency', 'Source', 'Qty', 'Value', 'Current %', 'Target %', 'Drift', 'Rebalance', 'State'].map((header) => (
                            <th
                              key={header}
                              className={cn(
                                'border-b border-slate-200 p-3 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:border-white/5 dark:text-gray-500',
                                ['Qty', 'Value', 'Current %', 'Target %', 'Drift', 'Rebalance'].includes(header) ? 'text-right' : 'text-left'
                              )}
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                        {rows.map((row) => (
                          <tr key={row.row_key} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-white/5">
                            <td className="p-3 text-sm font-black text-slate-950 dark:text-white">{row.name || row.ticker}</td>
                            <td className="p-3 text-sm font-mono font-bold text-slate-500 dark:text-gray-400">{row.ticker}</td>
                            <td className="p-3 text-sm font-mono text-slate-500 dark:text-gray-400">{row.displayCurrency}</td>
                            <td className="p-3">
                              <div className="flex flex-col items-start gap-1">
                                <span className="text-[10px] font-mono font-bold uppercase text-slate-600 dark:text-gray-300">{row.sourceLabel}</span>
                                <span className={cn('rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', freshnessClass(row.actualFreshness))}>
                                  {row.actualFreshness === 'MISSING' ? 'NO SNAPSHOT' : `${row.actualFreshness} ${formatDate(row.as_of_date)}`}
                                </span>
                              </div>
                            </td>
                            <td className="p-3 text-right text-sm font-mono text-slate-500 dark:text-gray-400">{row.quantity?.toLocaleString('fr-FR') ?? '--'}</td>
                            <td className="p-3 text-right text-sm font-mono font-bold text-slate-700 dark:text-gray-200">{formatEur(row.currentValueEur)}</td>
                            <td className="p-3 text-right text-sm font-mono text-slate-700 dark:text-gray-200">{formatPercent(row.currentWeightPct)}</td>
                            <td className="p-3 text-right text-sm font-mono text-slate-700 dark:text-gray-200">{formatPercent(row.targetPct)}</td>
                            <td className="p-3 text-right text-sm font-mono font-bold text-slate-700 dark:text-gray-200">{formatSignedPercent(row.driftPct)}</td>
                            <td className="p-3 text-right text-sm font-mono font-bold text-slate-700 dark:text-gray-200">{formatSignedEur(row.rebalanceAmountEur)}</td>
                            <td className="p-3">
                              <div className="flex flex-col items-start gap-1">
                                <span className={cn('rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', priorityClass(row.priority))}>
                                  {row.priority}
                                </span>
                                <span className="text-[9px] font-mono text-slate-500 dark:text-gray-500">{row.dataState}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
    </AppShell>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-black/20">
      <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">{label}</div>
      <div className="mt-1 text-xs font-mono font-black text-slate-950 dark:text-white">{value}</div>
    </div>
  )
}

function OperationMetric({
  icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon?: React.ReactNode
  label: string
  value: string
  detail: string
  tone?: 'neutral' | 'ok' | 'warn'
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-3',
        tone === 'ok'
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20'
          : tone === 'warn'
          ? 'border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20'
          : 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-black/20'
      )}
    >
      <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-mono font-black text-slate-950 dark:text-white">{value}</div>
      <div className="mt-1 line-clamp-2 text-[10px] font-mono text-slate-500 dark:text-gray-400">{detail}</div>
    </div>
  )
}
