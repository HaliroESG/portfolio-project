import React, { useState } from 'react'
import { portfolioOptions, type SourceReadiness } from '../lib/sourceReadiness'
import type { PortfolioScope } from '../types'

const messages: Record<Exclude<SourceReadiness, 'READY'>, string> = {
  ERROR: 'Source error. Cached recommendations are hidden until the required reads recover.',
  LOADING: 'Loading sources. Recommendations are unavailable until the required reads complete.',
  REVALIDATING: 'Refreshing sources. Cached recommendations are hidden while their freshness is checked.',
  UNAVAILABLE: 'Sources or portfolio identity unavailable. No recommendation is displayed.',
}

export function SourceStateScreen({ title, state, portfolios, portfolioId, scope, onPortfolio, onScope, onRetry, overlay, onOverlay }: {
  title: string
  state: Exclude<SourceReadiness, 'READY'>
  portfolios: unknown
  portfolioId: string
  scope: PortfolioScope
  onPortfolio: (id: string) => void
  onScope: (scope: PortfolioScope) => void
  onRetry: () => Promise<unknown>
  overlay?: 'ALL' | 'STANDARD' | 'MACRO'
  onOverlay?: (overlay: 'ALL' | 'STANDARD' | 'MACRO') => void
}) {
  const [retrying, setRetrying] = useState(false)
  const options = portfolioOptions(portfolios)
  const selectionExists = options.some((row) => row.id === portfolioId)
  return (
      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
        <h1 className="text-2xl font-black text-slate-950 dark:text-white">{title}</h1>
        <p className="text-sm text-slate-600 dark:text-gray-300">Read only · Selection controls may use cached labels.</p>
        <div className="flex flex-wrap gap-4">
          <label className="text-sm text-slate-700 dark:text-gray-200">Portfolio
            <select aria-label="Portfolio" value={selectionExists ? portfolioId : ''} onChange={(event) => onPortfolio(event.target.value)} className="ml-2 rounded border p-2 text-slate-950">
              <option value="" disabled>Select a portfolio</option>
              {options.map((row) => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-700 dark:text-gray-200">Scope
            <select aria-label="Scope" value={scope} onChange={(event) => onScope(event.target.value as PortfolioScope)} className="ml-2 rounded border p-2 text-slate-950">
              <option value="PERSO">PERSO</option><option value="PRO">PRO</option>
            </select>
          </label>
        </div>
        {overlay && onOverlay && (
          <label className="text-sm text-slate-700 dark:text-gray-200">Overlay
            <select aria-label="Overlay" value={overlay} onChange={(event) => onOverlay(event.target.value as 'ALL' | 'STANDARD' | 'MACRO')} className="ml-2 rounded border p-2 text-slate-950">
              <option value="ALL">ALL</option><option value="STANDARD">STANDARD</option><option value="MACRO">MACRO</option>
            </select>
          </label>
        )}
        <section role="status" data-source-state={state} className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <h2 className="font-bold">{state}</h2>
          <p>{messages[state]}</p>
          <button type="button" disabled={retrying || state === 'LOADING' || state === 'REVALIDATING'}
            onClick={async () => {
              setRetrying(true)
              try { await onRetry() } finally { setRetrying(false) }
            }} className="mt-3 rounded border border-amber-700 px-3 py-2 font-semibold disabled:opacity-50">
            {retrying ? 'Retrying sources…' : 'Retry sources'}
          </button>
        </section>
      </main>
  )
}
