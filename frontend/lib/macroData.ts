import type { SupabaseClient } from '@supabase/supabase-js'
import { isSelectorSchemaError } from './supabaseSelectorErrors'
import { finiteNumber, sourceTimestamp } from './readerState'
import type { MacroIndicatorRow } from '../types'
export type { MacroIndicatorRow } from '../types'

export type MacroDirection = 'UP' | 'DOWN'

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
    return finiteNumber(value.replace(',', '.'))
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
    last_update: sourceTimestamp(raw.last_update),
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
    if (error) {
      if (selector === EXTENDED_SELECTOR && isSelectorSchemaError(error)) continue
      throw new Error('Macro indicator read failed')
    }

    return ((data ?? []) as unknown as JsonRecord[])
      .map(parseMacroIndicatorRow)
      .filter((row): row is MacroIndicatorRow => row !== null)
  }

  throw new Error('Macro indicator read failed')
}
