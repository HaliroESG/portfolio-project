// Display policy only. A fresh collection timestamp is not proof of a fresh market observation.
export type ObservationState = 'READY' | 'MISSING' | 'UNKNOWN' | 'STALE'
export const MARKET_READER_MAX_AGE_MS = 72 * 60 * 60 * 1000

export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function sourceTimestamp(value: unknown, now = Date.now()): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(value)) return null
  const civil = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(civil.getTime()) || civil.toISOString().slice(0, 10) !== value.slice(0, 10)) return null
  const time = Date.parse(value)
  return Number.isFinite(time) && time <= now ? value : null
}

export function latestSourceTimestamp(values: unknown[], now = Date.now()): string | null {
  return values.reduce<string | null>((latest, value) => {
    const valid = sourceTimestamp(value, now)
    return valid && (!latest || Date.parse(valid) > Date.parse(latest)) ? valid : latest
  }, null)
}

export function observationState(value: number | null | undefined, timestamp: unknown, now = Date.now()): ObservationState {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'MISSING'
  const valid = sourceTimestamp(timestamp, now)
  if (!valid) return 'UNKNOWN'
  return now - Date.parse(valid) > MARKET_READER_MAX_AGE_MS ? 'STALE' : 'READY'
}
