export interface PanelWidthConfig {
  key: string
  defaultValue: number
  min: number
  max: number
}

export interface PanelWidthStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export const TRIDENT_DETAIL_WIDTH: PanelWidthConfig = {
  key: 'trident-detail-panel-width',
  defaultValue: 420,
  min: 380,
  max: 720,
}

export const ASSET_DRAWER_WIDTH: PanelWidthConfig = {
  key: 'asset-detail-drawer-width',
  defaultValue: 672,
  min: 560,
  max: 960,
}

export function clampPanelWidth(value: unknown, config: PanelWidthConfig): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return config.defaultValue
  return Math.round(Math.min(config.max, Math.max(config.min, parsed)))
}

export function readStoredPanelWidth(
  storage: PanelWidthStorage | null | undefined,
  config: PanelWidthConfig,
): number {
  if (!storage) return config.defaultValue
  try {
    const raw = storage.getItem(config.key)
    if (raw === null) return config.defaultValue
    return clampPanelWidth(raw, config)
  } catch {
    return config.defaultValue
  }
}

export function writeStoredPanelWidth(
  storage: PanelWidthStorage | null | undefined,
  config: PanelWidthConfig,
  value: number,
): number {
  const next = clampPanelWidth(value, config)
  if (!storage) return next
  try {
    storage.setItem(config.key, String(next))
  } catch {
    // Local persistence is convenience-only; layout must still update.
  }
  return next
}
