"use client"

import React, { useMemo } from 'react'
import useSWR from 'swr'
import {
  Building2,
  ExternalLink,
  Globe2,
  Info,
  Newspaper,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { loadTridentStockInsight } from '../lib/tridentInsights'
import { SWR_REFRESH, swrOptions } from '../lib/swrConfig'
import { cn } from '../lib/utils'
import type { TridentStockInsightRow } from '../types'

function formatMarketCap(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  const abs = Math.abs(value)
  const unit = abs >= 1_000_000_000_000 ? 'T' : abs >= 1_000_000_000 ? 'B' : abs >= 1_000_000 ? 'M' : 'K'
  const divisor =
    unit === 'T' ? 1_000_000_000_000 :
    unit === 'B' ? 1_000_000_000 :
    unit === 'M' ? 1_000_000 :
    1_000
  const scaled = value / divisor
  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2
  return `${scaled.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${unit}${currency ? ` ${currency}` : ''}`
}

function formatPrice(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return `${value.toLocaleString('fr-FR', {
    minimumFractionDigits: value >= 100 ? 2 : 3,
    maximumFractionDigits: value >= 100 ? 2 : 3,
  })} ${currency ?? ''}`.trim()
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '--'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '--'
  return parsed.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function stateClass(state: string): string {
  if (state === 'STALE' || state === 'SHORT_HISTORY') {
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'
  }
  if (state.includes('UNAVAILABLE') || state === 'NO_PRICE_HISTORY') {
    return 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
  }
  return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300'
}

function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    AI_SUMMARY_UNAVAILABLE: 'AI brief not configured',
    AI_SUMMARY_FAILED: 'AI brief failed',
    NEWS_UNAVAILABLE: 'No recent news found',
    PROFILE_UNAVAILABLE: 'Profile unavailable',
    CONSENSUS_UNAVAILABLE: 'Consensus unavailable',
    NO_PRICE_HISTORY: 'No price history',
    SHORT_HISTORY: 'Short price history',
    STALE: 'Price data stale',
  }
  return labels[state] ?? state.replaceAll('_', ' ').toLowerCase()
}

function yahooUrl(ticker: string, providerSymbol: string | null | undefined): string {
  const symbol = providerSymbol?.trim() || ticker
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`
}

function sourceUrl(insight: TridentStockInsightRow | null, ticker: string, providerSymbol: string | null | undefined): string {
  return insight?.source_url ?? yahooUrl(ticker, providerSymbol)
}

function targetUpside(insight: TridentStockInsightRow): number | null {
  if (!insight.latest_price || !insight.target_mean_price || insight.latest_price <= 0) return null
  return ((insight.target_mean_price / insight.latest_price) - 1) * 100
}

function trendPhrase(value: string | null | undefined): string {
  if (!value) return 'Trend unavailable'
  if (value === 'BULLISH') return 'Bullish trend'
  if (value === 'BEARISH') return 'Bearish trend'
  if (value === 'NEUTRAL') return 'Neutral trend'
  return 'Trend unclear'
}

function ma200Phrase(value: string | null | undefined): string | null {
  if (value === 'ABOVE') return 'price is above MA200'
  if (value === 'BELOW') return 'price is below MA200'
  return null
}

function momentumPhrase(label: string, value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  if (value > 0) return `${label} momentum is positive (${formatPct(value)})`
  if (value < 0) return `${label} momentum is negative (${formatPct(value)})`
  return `${label} momentum is flat`
}

function buildTrendExplanation(insight: TridentStockInsightRow, upside: number | null): string {
  const facts = [
    ma200Phrase(insight.ma200_state),
    momentumPhrase('3M', insight.momentum_3m_pct),
    momentumPhrase('12M', insight.momentum_12m_pct),
  ].filter((fact): fact is string => Boolean(fact))

  const slope = insight.regression_slope_pct
  if (slope !== null && slope !== undefined && !Number.isNaN(slope)) {
    facts.push(`regression slope is ${formatPct(slope)}/year`)
  }

  const core = facts.length > 0
    ? `${trendPhrase(insight.trend_state)}: ${facts.join(', ')}.`
    : `${trendPhrase(insight.trend_state)}: price facts are insufficient for a fuller explanation.`

  const zScore = insight.regression_z_score
  const zSentence = zScore === null || zScore === undefined || Number.isNaN(zScore)
    ? ''
    : ` Z-score ${zScore >= 0 ? '+' : ''}${zScore.toFixed(2)}σ indicates the stock is ${zScore >= 0 ? 'above' : 'below'} its historical regression channel.`

  const consensusSentence = upside === null
    ? ''
    : ` Analyst target implies ${formatPct(upside)} upside/downside from the latest price.`

  return `${core}${zSentence}${consensusSentence}`
}

function dataNotes(states: string[]): Array<{ state: string; label: string }> {
  return states
    .filter((state) => state !== 'READY')
    .map((state) => ({ state, label: stateLabel(state) }))
}

function InsightMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 dark:border-white/10 dark:bg-black/20">
      <div className="text-[8px] font-black uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 truncate text-xs font-black tabular-nums text-slate-950 dark:text-white">{value}</div>
    </div>
  )
}

function pendingInsightTone(status: string | undefined): string {
  if (status === 'SCHEMA_PENDING') {
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300'
  }
  return 'border-slate-300 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
}

function pendingInsightLabel(status: string | undefined): string {
  if (status === 'SCHEMA_PENDING') return 'Insights schema pending'
  return 'Insights sync pending'
}

export function TridentCompanyInsight({
  instrumentKey,
  ticker,
  providerSymbol,
}: {
  instrumentKey: string
  ticker: string
  providerSymbol: string | null
}) {
  const { data, error, isLoading } = useSWR(
    ['trident-stock-insight-v1', instrumentKey],
    () => loadTridentStockInsight(supabase, instrumentKey),
    swrOptions(SWR_REFRESH.SLOW),
  )
  const insight = data?.insight ?? null
  const summary = insight?.ai_trend_summary ?? null
  const yahoo = sourceUrl(insight, ticker, providerSymbol)
  const upside = useMemo(() => (insight ? targetUpside(insight) : null), [insight])
  const trendExplanation = useMemo(() => (insight ? buildTrendExplanation(insight, upside) : null), [insight, upside])
  const notes = useMemo(() => dataNotes(insight?.data_state ?? []), [insight?.data_state])

  if (isLoading) {
    return (
      <section className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-600 dark:border-white/10 dark:bg-black/20 dark:text-gray-300">
        Loading company insight.
      </section>
    )
  }

  if (error) {
    return (
      <section className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
        Company insight unavailable for {ticker}.
      </section>
    )
  }

  if (!insight) {
    const pendingStatus = data?.status

    return (
      <section className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-black/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-700 dark:text-gray-300">
              <Building2 className="h-4 w-4 text-blue-600 dark:text-[#00FF88]" />
              Company Insight
            </div>
            <span className={cn('mt-2 inline-flex rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', pendingInsightTone(pendingStatus))}>
              {pendingInsightLabel(pendingStatus)}
            </span>
            <div className="mt-2 text-xs font-semibold text-slate-600 dark:text-gray-300">
              {data?.message ?? 'Insights sync pending for this instrument.'}
            </div>
          </div>
          <a
            href={yahoo}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-slate-300 px-2 text-[10px] font-black uppercase tracking-wider text-slate-700 transition hover:bg-white dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Yahoo
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </section>
    )
  }

  return (
    <section className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-black/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-700 dark:text-gray-300">
            <Building2 className="h-4 w-4 text-blue-600 dark:text-[#00FF88]" />
            Company Insight
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-500">
            <span>{insight.source_provider}</span>
            <span>updated {formatDate(insight.updated_at)}</span>
            {insight.ai_model && <span>{insight.ai_model}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {insight.website && (
            <a
              href={insight.website}
              target="_blank"
              rel="noreferrer"
              aria-label={`${ticker} website`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:bg-white dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
            >
              <Globe2 className="h-4 w-4" />
            </a>
          )}
          <a
            href={yahoo}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 px-2 text-[10px] font-black uppercase tracking-wider text-slate-700 transition hover:bg-white dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Yahoo
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-black/20">
        <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Consensus</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <InsightMetric label="Mkt Cap" value={formatMarketCap(insight.market_cap, insight.price_currency)} />
          <InsightMetric label="Rating" value={insight.recommendation_key ?? '--'} />
          <InsightMetric label="Target" value={formatPrice(insight.target_mean_price, insight.price_currency)} />
          <InsightMetric label="Upside" value={formatPct(upside)} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <InsightMetric label="Analysts" value={insight.number_of_analyst_opinions?.toString() ?? '--'} />
          <InsightMetric label="Mean score" value={insight.recommendation_mean === null ? '--' : insight.recommendation_mean?.toFixed(2) ?? '--'} />
        </div>
      </div>

      <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-black/20">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
          <TrendingUp className="h-3.5 w-3.5" />
          Trend facts
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <InsightMetric label="Trend" value={insight.trend_state ?? '--'} />
          <InsightMetric label="Slope" value={formatPct(insight.regression_slope_pct)} />
          <InsightMetric label="Z-score" value={insight.regression_z_score === null ? '--' : `${insight.regression_z_score >= 0 ? '+' : ''}${insight.regression_z_score.toFixed(2)}σ`} />
          <InsightMetric label="MA200" value={insight.ma200_state ?? '--'} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <InsightMetric label="3M" value={formatPct(insight.momentum_3m_pct)} />
          <InsightMetric label="12M" value={formatPct(insight.momentum_12m_pct)} />
        </div>
        {trendExplanation && (
          <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold leading-relaxed text-slate-700 dark:border-[#00FF88]/20 dark:bg-[#00FF88]/10 dark:text-gray-200">
            {trendExplanation}
          </p>
        )}
      </div>

      {summary ? (
        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs font-semibold leading-relaxed text-slate-700 dark:border-[#00FF88]/20 dark:bg-[#00FF88]/10 dark:text-gray-200">
          <div className="mb-1 flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-blue-700 dark:text-[#00FF88]">
            <Sparkles className="h-3.5 w-3.5" />
            AI trend brief
          </div>
          {summary}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-[10px] font-bold text-slate-500 dark:border-white/10 dark:bg-black/20 dark:text-gray-400">
          <Info className="h-3.5 w-3.5" />
          AI brief not configured; deterministic trend facts remain visible.
        </div>
      )}

      {insight.business_summary && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-black/20">
          <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Business</div>
          <p className="line-clamp-3 text-xs font-semibold leading-relaxed text-slate-600 dark:text-gray-300">
            {insight.business_summary}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 dark:text-gray-300">
              Full business summary
            </summary>
            <p className="mt-2 text-xs font-semibold leading-relaxed text-slate-600 dark:text-gray-300">
              {insight.business_summary}
            </p>
          </details>
        </div>
      )}

      {insight.news_items.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
            <Newspaper className="h-3.5 w-3.5" />
            Recent drivers
          </div>
          {insight.news_items.slice(0, 3).map((item) => (
            <a
              key={item.url}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border border-slate-200 bg-white px-3 py-2 transition hover:bg-slate-50 dark:border-white/10 dark:bg-black/20 dark:hover:bg-white/5"
            >
              <div className="line-clamp-2 text-xs font-bold leading-snug text-slate-800 dark:text-gray-200">
                {item.title}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-500">
                <span>{item.source ?? 'source unknown'}</span>
                <span>{formatDate(item.published_at)}</span>
                {item.impact_level && <span>{item.impact_level}</span>}
              </div>
            </a>
          ))}
        </div>
      )}

      {insight.news_items.length === 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-[10px] font-bold text-slate-500 dark:border-white/10 dark:bg-black/20 dark:text-gray-400">
          <Newspaper className="h-3.5 w-3.5" />
          No recent news found; explanation relies on price facts and analyst consensus only.
        </div>
      )}

      {notes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {notes.slice(0, 5).map((note) => (
            <span
              key={note.state}
              className={cn('rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', stateClass(note.state))}
            >
              {note.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-500">
        <span>Price history {stateLabel(insight.price_history_state ?? 'UNKNOWN')}</span>
      </div>
    </section>
  )
}
