export type SourceReadiness = 'READY' | 'ERROR' | 'LOADING' | 'REVALIDATING' | 'UNAVAILABLE'

interface ReadSource {
  data: unknown
  error?: unknown
  isLoading?: boolean
  isValidating?: boolean
}

export interface NamedReadSource { label: string; source: ReadSource }
export interface SourceFailure {
  label: string
  code: 'SCHEMA_UNAVAILABLE' | 'ACCESS_REQUIRED' | 'READ_FAILED'
  message: string
}

// Only fixed explanations reach the UI, never raw database errors, URLs or IDs.
export function sourceFailures(sources: NamedReadSource[]): SourceFailure[] {
  return sources.flatMap<SourceFailure>(({ label, source }) => {
    if (source.error == null) return []
    const code = typeof source.error === 'object' && 'code' in source.error
      ? source.error.code : null
    if (typeof code === 'string' && ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code)) {
      return [{ label, code: 'SCHEMA_UNAVAILABLE' as const, message: 'The expected data contract is unavailable. A separately reviewed schema update may be required; no replacement calculation is used.' }]
    }
    if (typeof code === 'string' && ['42501', '28000', 'PGRST301', 'PGRST302', 'PGRST303'].includes(code)) {
      return [{ label, code: 'ACCESS_REQUIRED' as const, message: 'Access could not be verified. Check the signed-in session and read permissions; recommendations remain hidden.' }]
    }
    return [{ label, code: 'READ_FAILED' as const, message: 'The read failed. No cached recommendation is used; retry once the source is available.' }]
  })
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
