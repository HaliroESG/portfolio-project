"use client"

import useSWR from 'swr'
import { loadFamilyOfficeBundle } from './familyOfficeData'
import { familyOfficeSWRKey } from './ownerIsolation'
import { supabase } from './supabase'
import { useOwnerIdentity } from './useOwnerIdentity'

export function useFamilyOfficeBundle() {
  const { ownerUserId, loading: sessionLoading, error: sessionError } = useOwnerIdentity()

  const result = useSWR(
    ownerUserId ? familyOfficeSWRKey(ownerUserId) : null,
    async () => ({
      ownerUserId: ownerUserId ?? '',
      bundle: await loadFamilyOfficeBundle(supabase),
    }),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  )

  const scopedData = result.data?.ownerUserId === ownerUserId
    ? result.data.bundle
    : undefined

  return {
    ...result,
    data: scopedData,
    ownerUserId,
    error: sessionError ?? result.error,
    isLoading: sessionLoading || result.isLoading || (!!ownerUserId && !scopedData && !result.error),
  }
}
