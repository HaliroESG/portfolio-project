"use client"

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPortfolioAggregation } from './portfolioData'
import { swrOptions, SWR_REFRESH } from './swrConfig'
import { supabase } from './supabase'
import { useOwnerBoundState } from './useOwnerBoundState'
import { useOwnerIdentity, type OwnerIdentityClient } from './useOwnerIdentity'
import { useOwnerScopedSWR } from './useOwnerScopedSWR'

export function usePortfolioAggregationOwnerReader(
  client: SupabaseClient = supabase,
  identityClient: OwnerIdentityClient = client,
) {
  const { ownerUserId, loading: ownerLoading, error: ownerError } = useOwnerIdentity(identityClient)
  const [selectedPortfolioId, setSelectedPortfolioId] = useOwnerBoundState(ownerUserId, 'ALL')
  const result = useOwnerScopedSWR(
    ownerUserId,
    'geo-portfolio-aggregation',
    [],
    (requestedOwnerUserId) => loadPortfolioAggregation(client, requestedOwnerUserId),
    swrOptions(SWR_REFRESH.SLOW),
  )
  return {
    ownerUserId,
    ownerError,
    selectedPortfolioId,
    setSelectedPortfolioId,
    portfolioBundle: result.data,
    bundleError: result.error,
    loading: ownerLoading || result.isLoading,
    mutateAggregation: result.mutate,
  }
}
