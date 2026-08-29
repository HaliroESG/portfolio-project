"use client"

import type { SupabaseClient } from '@supabase/supabase-js'
import { assertOwnerIsolation } from './ownerIsolation'
import { supabase } from './supabase'
import { useOwnerIdentity, type OwnerIdentityClient } from './useOwnerIdentity'
import { useOwnerScopedSWR } from './useOwnerScopedSWR'

export interface GovernanceTarget {
  id: string
  portfolio_id: string
  asset_class: string
  target_pct: number
  tolerance_band: number
}

type GovernanceTargetRow = {
  id: string
  owner_user_id: string
  portfolio_id: string
  asset_class: string
  target_pct?: number | null
  target_weight_pct?: number | null
  target_weight?: number | null
  target_percent?: number | null
  tolerance_band: number
}

const GOVERNANCE_SELECTORS = [
  'id,owner_user_id,portfolio_id,asset_class,target_pct,target_weight_pct,target_weight,target_percent,tolerance_band',
  'id,owner_user_id,portfolio_id,asset_class,target_pct,tolerance_band',
  'id,owner_user_id,portfolio_id,asset_class,target_weight_pct,tolerance_band',
  'id,owner_user_id,portfolio_id,asset_class,target_weight,tolerance_band',
  'id,owner_user_id,portfolio_id,asset_class,target_percent,tolerance_band',
]

export function useGovernanceOwnerReader(
  selectedPortfolioId = 'ALL',
  client: SupabaseClient = supabase,
  identityClient: OwnerIdentityClient = client,
) {
  const { ownerUserId, error: ownerError } = useOwnerIdentity(identityClient)
  const targetsResult = useOwnerScopedSWR(
    ownerUserId,
    'governance-widget',
    [selectedPortfolioId],
    async (requestedOwnerUserId): Promise<GovernanceTarget[]> => {
      let portfolioId = selectedPortfolioId
      if (portfolioId === 'ALL') {
        const portfoliosResponse = await client
          .from('portfolios')
          .select('id,owner_user_id')
          .eq('owner_user_id', requestedOwnerUserId)
          .limit(1)
          .maybeSingle()
        if (portfoliosResponse.error) throw portfoliosResponse.error
        if (!portfoliosResponse.data) return []
        assertOwnerIsolation(requestedOwnerUserId, [[portfoliosResponse.data]])
        portfolioId = portfoliosResponse.data.id
      }

      let rows: GovernanceTargetRow[] = []
      let lastError: Error | null = null
      for (const selector of GOVERNANCE_SELECTORS) {
        const response = await client
          .from('governance_targets')
          .select(selector)
          .eq('owner_user_id', requestedOwnerUserId)
          .eq('portfolio_id', portfolioId)
        if (!response.error) {
          rows = (response.data ?? []) as unknown as GovernanceTargetRow[]
          lastError = null
          break
        }
        lastError = new Error(response.error.message)
      }
      if (lastError) throw lastError
      assertOwnerIsolation(requestedOwnerUserId, [rows])
      return rows
        .map((row) => ({
          id: row.id,
          portfolio_id: row.portfolio_id,
          asset_class: row.asset_class,
          target_pct: row.target_pct ?? row.target_weight_pct ?? row.target_weight ?? row.target_percent ?? 0,
          tolerance_band: row.tolerance_band,
        }))
        .filter((target) => Number.isFinite(target.target_pct))
    },
  )

  return {
    ownerUserId,
    ownerError,
    targets: targetsResult.data ?? [],
    targetsError: targetsResult.error,
    loading: targetsResult.isLoading,
    mutateTargets: targetsResult.mutate,
  }
}
