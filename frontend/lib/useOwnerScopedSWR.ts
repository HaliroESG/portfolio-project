"use client"

import useSWR, { type SWRConfiguration } from 'swr'

interface OwnerBoundValue<Data> {
  ownerUserId: string
  data: Data
}

export function ownerScopedSWRKey(
  surface: string,
  ownerUserId: string,
  ...parts: ReadonlyArray<string | number | boolean | null>
): readonly [string, string, ...ReadonlyArray<string | number | boolean | null>] {
  if (!ownerUserId) {
    throw new Error('Authenticated owner identity is unavailable')
  }
  return [`owner:${surface}`, ownerUserId, ...parts]
}

export function useOwnerScopedSWR<Data>(
  ownerUserId: string | null,
  surface: string,
  parts: ReadonlyArray<string | number | boolean | null>,
  loader: (requestedOwnerUserId: string) => Promise<Data>,
  config?: SWRConfiguration<OwnerBoundValue<Data>, Error>,
) {
  const result = useSWR<OwnerBoundValue<Data>, Error>(
    ownerUserId ? ownerScopedSWRKey(surface, ownerUserId, ...parts) : null,
    async (key) => {
      const requestedOwnerUserId = key[1]
      if (typeof requestedOwnerUserId !== 'string' || !requestedOwnerUserId) {
        throw new Error('Owner-scoped request key is invalid')
      }
      return {
        ownerUserId: requestedOwnerUserId,
        data: await loader(requestedOwnerUserId),
      }
    },
    config,
  )

  const scopedValue = result.data?.ownerUserId === ownerUserId ? result.data : undefined
  return {
    ...result,
    data: scopedValue?.data,
    requestedOwnerUserId: scopedValue?.ownerUserId ?? null,
    isLoading: !!ownerUserId && (result.isLoading || (!scopedValue && !result.error)),
  }
}
