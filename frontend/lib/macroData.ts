import type { SupabaseClient } from '@supabase/supabase-js'

export type MacroDirection = 'UP' | 'DOWN'

export interface MacroIndicatorRow {
  id: string
  name: string | null
  value: number | null
  change_pct: number | null
  last_update: string | null
  threshold_amber: number | null
  threshold_red: number | null
  direction: MacroDirection | null
  pillar: string | null
}

export const MACRO_INDICATORS_SWR_KEY = 'macro-indicators-v1'
export const MACRO_INDICATORS_REFRESH_MS = 60000

const EXTENDED_SELECTOR =
  'id,name,value,change_pct,last_update,threshold_amber,threshold_red,direction,pillar'
const FALLBACK_SELECTOR = 'id,name,value,change_pct,last_update'

type JsonRecord = Record<string, unknown>

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function parseDirection(value: unknown): MacroDirection | null {
  const normalized = readString(value)?.toUpperCase()
  if (normalized === 'UP' || normalized === 'DOWN') return normalized
  return null
}

function parseMacroIndicatorRow(raw: JsonRecord): MacroIndicatorRow | null {
  const id = readString(raw.id)
  if (!id) return null

  return {
    id,
    name: readString(raw.name),
    value: readNumber(raw.value),
    change_pct: readNumber(raw.change_pct),
    last_update: readString(raw.last_update),
    threshold_amber: readNumber(raw.threshold_amber),
    threshold_red: readNumber(raw.threshold_red),
    direction: parseDirection(raw.direction),
    pillar: readString(raw.pillar),
  }
}

export async function loadMacroIndicators(supabase: SupabaseClient): Promise<MacroIndicatorRow[]> {
  const selectors = [EXTENDED_SELECTOR, FALLBACK_SELECTOR]

  for (const selector of selectors) {
    const { data, error } = await supabase.from('macro_indicators').select(selector)
    if (error) continue

    return ((data ?? []) as unknown as JsonRecord[])
      .map(parseMacroIndicatorRow)
      .filter((row): row is MacroIndicatorRow => row !== null)
  }

  return []
}
