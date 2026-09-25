export type FreshnessState = 'LIVE' | 'STALE' | 'MISSING'

export interface FreshnessResult {
  state: FreshnessState
  ageMinutes: number | null
  label: string
  isMarketClosedGrace: boolean
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function formatAge(ageMinutes: number | null): string {
  if (ageMinutes === null) return 'N/A'
  if (ageMinutes < 90) return `${Math.max(0, Math.round(ageMinutes))}m ago`
  const hours = ageMinutes / 60
  if (hours < 48) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function isWeekendGrace(now: Date, timestamp: Date): boolean {
  const day = now.getDay()
  if (day !== 0 && day !== 6 && !(day === 1 && now.getHours() < 12)) return false

  const ageMs = now.getTime() - timestamp.getTime()
  if (ageMs < 0 || ageMs > 4 * DAY_MS) return false

  const sourceDay = timestamp.getDay()
  return sourceDay === 5 || sourceDay === 6 || sourceDay === 0
}

export function resolveFreshness(
  timestampIso: string | null | undefined,
  staleAfterMinutes = 60,
  options: { marketAware?: boolean } = {}
): FreshnessResult {
  if (!timestampIso) {
    return { state: 'MISSING', ageMinutes: null, label: 'N/A', isMarketClosedGrace: false }
  }

  const timestamp = new Date(timestampIso)
  if (Number.isNaN(timestamp.getTime())) {
    return { state: 'MISSING', ageMinutes: null, label: 'N/A', isMarketClosedGrace: false }
  }

  const now = new Date()
  const diffMs = now.getTime() - timestamp.getTime()
  const ageMinutes = Math.max(0, Math.round(diffMs / MINUTE_MS))
  const isMarketClosedGrace = Boolean(options.marketAware && isWeekendGrace(now, timestamp))
  const state = ageMinutes <= staleAfterMinutes || isMarketClosedGrace ? 'LIVE' : 'STALE'

  return {
    state,
    ageMinutes,
    label: formatAge(ageMinutes),
    isMarketClosedGrace,
  }
}

export function formatSyncTime(timestampIso: string | null | undefined, fallback?: string): string {
  if (!timestampIso) return fallback || '--:--:--'
  const parsed = new Date(timestampIso)
  if (Number.isNaN(parsed.getTime())) return fallback || '--:--:--'
  return parsed.toLocaleTimeString('fr-FR')
}
