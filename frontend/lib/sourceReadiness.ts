export type SourceReadiness = 'READY' | 'ERROR' | 'LOADING' | 'REVALIDATING' | 'UNAVAILABLE'

interface ReadSource {
  data: unknown
  error?: unknown
  isLoading?: boolean
  isValidating?: boolean
}

// Read SWR's flags during render so cached-data revalidations trigger a rerender.
// An empty successful array is distinct from an unresolved (undefined) response.
export function sourceReadiness(sources: ReadSource[]): SourceReadiness {
  if (sources.some((source) => source.error != null)) return 'ERROR'
  if (sources.some((source) => source.isLoading)) return 'LOADING'
  if (sources.some((source) => source.isValidating)) return 'REVALIDATING'
  if (sources.some((source) => source.data === undefined || source.data === null)) return 'UNAVAILABLE'
  return 'READY'
}

export interface PortfolioOption { id: string; name: string | null }

export function portfolioOptions(value: unknown): PortfolioOption[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  for (const row of value) {
    if (!row || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)
      || (row.name !== null && typeof row.name !== 'string')) return []
    ids.add(row.id)
  }
  return value
}

export function hasSelectedPortfolio(value: unknown, selectedId: string): boolean {
  return Boolean(selectedId) && portfolioOptions(value).some((row) => row.id === selectedId)
}
