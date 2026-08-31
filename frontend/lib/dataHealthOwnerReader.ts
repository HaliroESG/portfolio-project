"use client"

import type { SupabaseClient } from '@supabase/supabase-js'
import { assertOwnerIsolation, OwnerIsolationError } from './ownerIsolation'
import { supabase } from './supabase'
import { useOwnerIdentity, type OwnerIdentityClient } from './useOwnerIdentity'
import { useOwnerScopedSWR } from './useOwnerScopedSWR'

type ValuationCoverageRow = {
  owner_user_id: string | null
  coverage_pct: number | string | null
  created_at: string
}

function readCoverage(value: number | string | null): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function useDataHealthOwnerReader(
  client: SupabaseClient = supabase,
  identityClient: OwnerIdentityClient = client,
) {
  const { ownerUserId, error: ownerError } = useOwnerIdentity(identityClient)
  const coverageResult = useOwnerScopedSWR(
    ownerUserId,
    'data-health-valuation-coverage',
    [],
    async (requestedOwnerUserId) => {
      const { data, error } = await client
        .from('valuation_snapshots')
        .select('owner_user_id,coverage_pct,created_at')
        .eq('owner_user_id', requestedOwnerUserId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      const row = (data ?? null) as ValuationCoverageRow | null
      if (!row) return null
      if (!row.owner_user_id) throw new OwnerIsolationError('Valuation snapshot owner is missing')
      assertOwnerIsolation(requestedOwnerUserId, [[{ owner_user_id: row.owner_user_id }]])
      return readCoverage(row.coverage_pct)
    },
  )
  return {
    ownerUserId,
    ownerError,
    valuationCoveragePct: coverageResult.data ?? null,
    valuationError: coverageResult.error,
    valuationLoading: coverageResult.isLoading,
    mutateValuationCoverage: coverageResult.mutate,
  }
}
