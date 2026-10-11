import { useState } from 'react'
import { portfolioOptions } from './sourceReadiness'

// Pin the first settled identity once. List reorder/removal must not choose a
// different portfolio for the user. This guarded render update is one-time;
// React discards that render before committing dependent UI.
export function usePortfolioSelection(portfolios: unknown, ready: boolean) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const firstId = ready ? portfolioOptions(portfolios)[0]?.id : undefined
  if (selectedId === null && firstId) setSelectedId(firstId)
  return [selectedId ?? '', setSelectedId] as const
}
