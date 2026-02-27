export const SWR_DEDUPING_MS = 15_000
export const SWR_FOCUS_REVALIDATE = false

export const SWR_REFRESH = {
  SLOW: 300_000,
  MEDIUM: 180_000,
  FAST: 60_000,
} as const

export function swrOptions(refreshInterval: number) {
  return {
    refreshInterval,
    revalidateOnFocus: SWR_FOCUS_REVALIDATE,
    dedupingInterval: SWR_DEDUPING_MS,
  }
}
