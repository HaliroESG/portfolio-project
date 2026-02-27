export type UnifiedDataState =
  | 'LOADING'
  | 'EMPTY'
  | 'STALE'
  | 'ERROR'
  | 'INSUFFICIENT_HISTORY'
  | 'OK'

export function stateFromList(params: {
  loading: boolean
  error?: unknown
  count?: number | null
}): UnifiedDataState {
  if (params.loading) return 'LOADING'
  if (params.error) return 'ERROR'
  if (!params.count || params.count <= 0) return 'EMPTY'
  return 'OK'
}

export function stateFromTimestamp(
  timestamp: string | null | undefined,
  staleAfterMinutes = 60
): UnifiedDataState {
  if (!timestamp) return 'EMPTY'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'ERROR'
  const ageMinutes = (Date.now() - date.getTime()) / 60000
  return ageMinutes > staleAfterMinutes ? 'STALE' : 'OK'
}

export function stateForTechnicalHistory(trendState: string | null | undefined): UnifiedDataState {
  if (!trendState || trendState === 'UNKNOWN') return 'INSUFFICIENT_HISTORY'
  if (trendState === 'INSUFFICIENT_HISTORY') return 'INSUFFICIENT_HISTORY'
  return 'OK'
}

export function stateLabel(state: UnifiedDataState): string {
  const labels: Record<UnifiedDataState, string> = {
    LOADING: 'Loading data…',
    EMPTY: 'No data available',
    STALE: 'Data is stale',
    ERROR: 'Data error',
    INSUFFICIENT_HISTORY: 'Insufficient history',
    OK: 'Data OK',
  }
  return labels[state]
}
