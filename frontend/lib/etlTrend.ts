export type TrendDirection = 'UP' | 'FLAT' | 'DOWN' | 'NONE'
export type TrendBasis = 'success_rate' | 'coverage' | 'status'

export interface EtlTrendInput {
  timestamp: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  successRatePct: number | null
  coveragePct: number | null
}

export interface EtlTrendPoint {
  timestamp: string
  score: number | null
}

function percentage(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

/** Input is newest-first, as returned by the ETL reader. Points are chronological. */
export function buildEtlTrend(runs: readonly EtlTrendInput[]): {
  points: EtlTrendPoint[]
  direction: TrendDirection
  delta: number | null
  basis: TrendBasis
} {
  const recent = runs.slice(0, 8).reverse().map((run) => ({
    ...run,
    successRatePct: percentage(run.successRatePct),
    coveragePct: percentage(run.coveragePct),
  }))
  // Choose one unit for the entire series. Never substitute coverage or status
  // for an unavailable success rate (in particular, zero attempted items).
  const basis: TrendBasis = recent.some((run) => run.successRatePct !== null)
    ? 'success_rate'
    : recent.some((run) => run.coveragePct !== null) ? 'coverage' : 'status'
  const points = recent.map((run): EtlTrendPoint => ({
    timestamp: run.timestamp,
    score: basis === 'success_rate' ? run.successRatePct
      : basis === 'coverage' ? run.coveragePct
      : run.status === 'SUCCESS' ? 100 : run.status === 'FAILED' ? 0 : null,
  }))
  const scores = points.map((point) => point.score).filter((score): score is number => score !== null)
  if (scores.length < 4) return { points, direction: 'NONE', delta: null, basis }

  // Preserve the existing comparison: means of the older/newer valid halves.
  const half = Math.floor(scores.length / 2)
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const delta = mean(scores.slice(half)) - mean(scores.slice(0, half))
  return { points, direction: delta > 2 ? 'UP' : delta < -2 ? 'DOWN' : 'FLAT', delta, basis }
}
