'use client'

import { useState } from 'react'
import {
  clampPanelWidth,
  readStoredPanelWidth,
  writeStoredPanelWidth,
} from './panelWidth'
import type { PanelWidthConfig } from './panelWidth'

export function usePersistedPanelWidth(config: PanelWidthConfig): [number, (value: number) => void] {
  const [width, setWidthState] = useState(() => {
    if (typeof window === 'undefined') return config.defaultValue
    return readStoredPanelWidth(window.localStorage, config)
  })

  const setWidth = (value: number) => {
    const next = clampPanelWidth(value, config)
    setWidthState(next)
    if (typeof window !== 'undefined') {
      writeStoredPanelWidth(window.localStorage, config, next)
    }
  }

  return [width, setWidth]
}
