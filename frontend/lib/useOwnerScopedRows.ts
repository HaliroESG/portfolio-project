import { useCallback, useLayoutEffect, useRef, useState } from 'react'

interface OwnerScopedRowsState<Row> {
  ownerUserId: string
  rows: Row[]
  loaded: boolean
  error: Error | null
}

export function useOwnerScopedRows<Row>(
  ownerUserId: string,
  loadRows: (ownerUserId: string) => Promise<Row[]>,
) {
  const generation = useRef(0)
  const currentOwner = useRef(ownerUserId)
  const [state, setState] = useState<OwnerScopedRowsState<Row>>({
    ownerUserId,
    rows: [],
    loaded: false,
    error: null,
  })

  useLayoutEffect(() => {
    generation.current += 1
    currentOwner.current = ownerUserId
  }, [ownerUserId])

  const load = useCallback(async () => {
    const requestedOwner = ownerUserId
    const requestedGeneration = generation.current + 1
    generation.current = requestedGeneration
    setState({ ownerUserId: requestedOwner, rows: [], loaded: false, error: null })
    try {
      const rows = await loadRows(requestedOwner)
      if (
        generation.current !== requestedGeneration
        || currentOwner.current !== requestedOwner
      ) return
      setState({ ownerUserId: requestedOwner, rows, loaded: true, error: null })
    } catch (caught) {
      if (
        generation.current !== requestedGeneration
        || currentOwner.current !== requestedOwner
      ) return
      setState({
        ownerUserId: requestedOwner,
        rows: [],
        loaded: true,
        error: caught instanceof Error ? caught : new Error('Owner-scoped read failed'),
      })
    }
  }, [loadRows, ownerUserId])

  const isCurrentOwner = state.ownerUserId === ownerUserId
  return {
    rows: isCurrentOwner ? state.rows : [],
    loaded: isCurrentOwner ? state.loaded : false,
    error: isCurrentOwner ? state.error : null,
    load,
  }
}
