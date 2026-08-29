"use client"

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OwnerIsolationError } from './ownerIsolation'
import { supabase } from './supabase'

interface OwnerIdentityState {
  ownerUserId: string | null
  loading: boolean
  error: Error | null
}

export type OwnerIdentityClient = Pick<SupabaseClient, 'auth'>

export function useOwnerIdentity(client: OwnerIdentityClient = supabase): OwnerIdentityState {
  const [state, setState] = useState<OwnerIdentityState>({
    ownerUserId: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let active = true
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return
      const ownerUserId = data.session?.user.id ?? null
      setState({
        ownerUserId,
        loading: false,
        error: error
          ?? (ownerUserId ? null : new OwnerIsolationError('Authenticated owner identity is unavailable')),
      })
    })

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      const ownerUserId = session?.user.id ?? null
      setState({
        ownerUserId,
        loading: false,
        error: ownerUserId
          ? null
          : new OwnerIsolationError('Authenticated owner identity is unavailable'),
      })
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [client])

  return state
}
