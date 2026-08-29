"use client"

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PortfolioScope } from '../types'
import { assertOwnerIsolation } from './ownerIsolation'
import { supabase } from './supabase'
import { useOwnerBoundState } from './useOwnerBoundState'
import { useOwnerIdentity, type OwnerIdentityClient } from './useOwnerIdentity'
import { useOwnerScopedSWR } from './useOwnerScopedSWR'

export interface TargetsPortfolioRow {
  id: string
  owner_user_id: string
  name: string | null
}

export interface TargetsPositionRow {
  owner_user_id: string
  portfolio_id: string
  ticker: string
  name: string | null
  instrument_type: string | null
  currency: string | null
  quantity_current: number | string | null
  pru: number | string | null
  target_weight_pct: number | string | null
  target_source: string | null
  target_source_file: string | null
  target_updated_at: string | null
  actual_source: string | null
  actual_source_accounts: unknown
  actual_as_of_date: string | null
  actual_updated_at: string | null
  updated_at: string | null
}

const EXTENDED_POSITION_SELECTOR = [
  'owner_user_id',
  'portfolio_id',
  'ticker',
  'name',
  'instrument_type',
  'currency',
  'quantity_current',
  'pru',
  'target_weight_pct',
  'target_source',
  'target_source_file',
  'target_updated_at',
  'actual_source',
  'actual_source_accounts',
  'actual_as_of_date',
  'actual_updated_at',
  'updated_at',
].join(',')

const LEGACY_POSITION_SELECTOR = [
  'owner_user_id',
  'portfolio_id',
  'ticker',
  'name',
  'instrument_type',
  'currency',
  'quantity_current',
  'pru',
  'target_weight_pct',
  'updated_at',
].join(',')

export function useTargetsOwnerReader(
  client: SupabaseClient = supabase,
  identityClient: OwnerIdentityClient = client,
) {
  const { ownerUserId, error: ownerError } = useOwnerIdentity(identityClient)
  const [selectedPortfolioIdOverride, setSelectedPortfolioIdOverride] = useOwnerBoundState(ownerUserId, '')
  const [selectedScope, setSelectedScope] = useOwnerBoundState<PortfolioScope>(ownerUserId, 'PERSO')

  const portfoliosResult = useOwnerScopedSWR(
    ownerUserId,
    'targets-portfolios',
    [],
    async (requestedOwnerUserId) => {
      const { data, error } = await client
        .from('portfolios')
        .select('id,owner_user_id,name')
        .eq('owner_user_id', requestedOwnerUserId)
      if (error) throw error
      const rows = (data ?? []) as TargetsPortfolioRow[]
      assertOwnerIsolation(requestedOwnerUserId, [rows])
      return rows
    },
  )

  const selectedPortfolioId = selectedPortfolioIdOverride || portfoliosResult.data?.[0]?.id || ''
  const positionsResult = useOwnerScopedSWR(
    selectedPortfolioId ? ownerUserId : null,
    'targets-positions',
    [selectedPortfolioId],
    async (requestedOwnerUserId) => {
      const { data, error } = await client
        .from('portfolio_positions')
        .select(EXTENDED_POSITION_SELECTOR)
        .eq('owner_user_id', requestedOwnerUserId)
        .eq('portfolio_id', selectedPortfolioId)
        .order('ticker', { ascending: true })
      if (error) {
        const fallback = await client
          .from('portfolio_positions')
          .select(LEGACY_POSITION_SELECTOR)
          .eq('owner_user_id', requestedOwnerUserId)
          .eq('portfolio_id', selectedPortfolioId)
          .order('ticker', { ascending: true })
        if (fallback.error) throw fallback.error
        const rows = (fallback.data ?? []) as unknown as TargetsPositionRow[]
        assertOwnerIsolation(requestedOwnerUserId, [rows])
        return rows
      }
      const rows = (data ?? []) as unknown as TargetsPositionRow[]
      assertOwnerIsolation(requestedOwnerUserId, [rows])
      return rows
    },
  )

  return {
    ownerUserId,
    ownerError,
    portfolios: portfoliosResult.data,
    portfolioError: portfoliosResult.error,
    selectedPortfolioId,
    selectedPortfolioIdOverride,
    setSelectedPortfolioIdOverride,
    selectedScope,
    setSelectedScope,
    positions: positionsResult.data,
    positionsError: positionsResult.error,
    mutatePositions: positionsResult.mutate,
  }
}
