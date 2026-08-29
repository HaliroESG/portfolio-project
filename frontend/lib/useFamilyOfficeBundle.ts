"use client"

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { loadFamilyOfficeBundle } from './familyOfficeData'
import { familyOfficeSWRKey, OwnerIsolationError } from './ownerIsolation'
import { supabase } from './supabase'

export function useFamilyOfficeBundle() {
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [sessionError, setSessionError] = useState<Error | null>(null)

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        setSessionError(error)
      } else if (!data.session?.user.id) {
        setSessionError(new OwnerIsolationError('Authenticated owner identity is unavailable'))
      } else {
        setOwnerUserId(data.session.user.id)
      }
      setSessionLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setOwnerUserId(session?.user.id ?? null)
      setSessionError(
        session?.user.id
          ? null
          : new OwnerIsolationError('Authenticated owner identity is unavailable'),
      )
      setSessionLoading(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

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
