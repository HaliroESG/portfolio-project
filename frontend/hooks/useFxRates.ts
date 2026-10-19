"use client"

import { useEffect } from 'react'
import useSWR from 'swr'
import type { CurrencyPair, CurrencyRateRow } from '../types'
import { supabase } from '../lib/supabase'
import { FX_CACHE_KEY, FX_RATES_SWR_KEY, loadCurrencyRates, parseFxCache } from '../lib/fxData'
import { projectLegacyFx } from '../lib/fxTrace'
import { swrOptions, SWR_REFRESH } from '../lib/swrConfig'

// One query/cache path for the two FX pages and the header. No enriched fixture
// adapter is wired here: legacy Supabase rows remain explicitly unverified.
export function useFxRates(initialRates?: CurrencyPair[]) {
  const hasInitialRates = Boolean(initialRates?.length)
  const { data: rates, isLoading, error } = useSWR<CurrencyRateRow[]>(
    hasInitialRates ? null : FX_RATES_SWR_KEY,
    () => loadCurrencyRates(supabase), swrOptions(SWR_REFRESH.SLOW))
  const { data: cached = [] } = useSWR<CurrencyRateRow[]>(error ? FX_CACHE_KEY : null, () => {
    try { return parseFxCache(window.localStorage.getItem(FX_CACHE_KEY)) } catch { return [] }
  }, { revalidateOnFocus: false, revalidateOnReconnect: false })
  useEffect(() => {
    if (!rates || error) return
    try { window.localStorage.setItem(FX_CACHE_KEY, JSON.stringify(rates)) } catch { /* Optional legacy cache. */ }
  }, [rates, error])
  const available = (hasInitialRates ? initialRates!.map(row => ({ ...row, last_update: null })) : undefined)
    ?? (error ? rates ?? cached : rates ?? [])
  const rows = available.map(row => projectLegacyFx(row))
  const usingCache = Boolean(error && rows.length)
  const loading = !hasInitialRates && isLoading && !rates && !error
  const state = usingCache ? 'CACHED' : error ? 'ERROR' : loading ? 'LOADING'
    : !rows.length ? 'EMPTY' : rows.some(row => row.status === 'CONFLICT') ? 'CONFLICT'
    : rows.some(row => row.status === 'MISSING' || row.status === 'UNKNOWN') ? 'UNKNOWN'
    : rows.some(row => row.status === 'STALE') ? 'STALE' : 'IDENTITY'
  return { rows, error, loading, usingCache, state }
}
