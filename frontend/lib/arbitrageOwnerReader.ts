"use client"

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PortfolioDecisionAction } from '../types'
import { assertOwnerIsolation } from './ownerIsolation'
import { supabase } from './supabase'
import { useOwnerBoundState } from './useOwnerBoundState'
import { useOwnerIdentity, type OwnerIdentityClient } from './useOwnerIdentity'
import { useOwnerScopedSWR } from './useOwnerScopedSWR'

export interface ArbitragePortfolioRow {
  id: string
  owner_user_id: string
  name: string | null
}

export type ArbitrageRawDecisionRow = Record<string, unknown>

export const ARBITRAGE_DECISION_SELECTOR = [
  'portfolio_id',
  'ticker',
  'name',
  'asset_class',
  'isin',
  'currency',
  'current_quantity',
  'current_value_eur',
  'current_weight_pct',
  'target_weight_pct',
  'drift_pct',
  'rebalance_amount_eur',
  'action',
  'confidence',
  'reason_codes',
  'data_state',
  'price_state',
  'market_data_status',
  'reconciliation_state',
  'trident_provider_symbol',
  'trident_score',
  'trident_confidence',
  'history_coverage_pct',
  'target_total_pct',
  'total_value_eur',
  'updated_at',
].join(',')

export function useArbitrageOwnerReader(
  client: SupabaseClient = supabase,
  identityClient: OwnerIdentityClient = client,
) {
  const { ownerUserId, error: ownerError } = useOwnerIdentity(identityClient)
  const [selectedPortfolioIdOverride, setSelectedPortfolioIdOverride] = useOwnerBoundState(ownerUserId, '')
  const [actionFilter, setActionFilter] = useOwnerBoundState<'ALL' | PortfolioDecisionAction>(ownerUserId, 'ALL')

  const portfoliosResult = useOwnerScopedSWR(
    ownerUserId,
    'arbitrage-portfolios',
    [],
    async (requestedOwnerUserId) => {
      const { data, error } = await client
        .from('portfolios')
        .select('id,owner_user_id,name')
        .eq('owner_user_id', requestedOwnerUserId)
      if (error) throw error
      const rows = (data ?? []) as ArbitragePortfolioRow[]
      assertOwnerIsolation(requestedOwnerUserId, [rows])
      return rows
    },
  )

  const selectedPortfolioId = selectedPortfolioIdOverride || portfoliosResult.data?.[0]?.id || ''
  const decisionsResult = useOwnerScopedSWR(
    selectedPortfolioId ? ownerUserId : null,
    'arbitrage-portfolio-decision-items',
    [selectedPortfolioId],
    async () => {
      const { data, error } = await client
        .from('portfolio_decision_items_latest')
        .select(ARBITRAGE_DECISION_SELECTOR)
        .eq('portfolio_id', selectedPortfolioId)
      if (error) throw error
      return (data ?? []) as unknown as ArbitrageRawDecisionRow[]
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
    actionFilter,
    setActionFilter,
    rawDecisionRows: decisionsResult.data ?? [],
    decisionError: decisionsResult.error,
    decisionsLoading: decisionsResult.isLoading,
    mutateDecisions: decisionsResult.mutate,
  }
}
