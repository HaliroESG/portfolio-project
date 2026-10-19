import type { EquityScreenerRow, TridentScreenerRow } from '../types'

/** Read-only union: neither ticker nor company name is an identity. */
export interface ResearchInstrument {
  key: string
  identity: EquityScreenerRow | TridentScreenerRow
  equity: EquityScreenerRow | null
  trident: TridentScreenerRow | null
  /** Price storage is symbol-keyed, unlike the canonical research readers. */
  priceTicker: string | null
  priceFallbackSymbol: string | null
  issues: string[]
}

export const RESEARCH_TABS = ['summary', 'quality', 'valuation', 'history', 'publications', 'insights', 'sources'] as const
export type ResearchTab = typeof RESEARCH_TABS[number]
export const RESEARCH_PRESETS = ['ALL', 'ESN_UNIVERSE', 'IT_SERVICES_VALUE', 'FCF_COMPOUNDERS', 'QUALITY_VALUE', 'MOMENTUM_TREND', 'SECTOR_BOOMS'] as const
export type ResearchPreset = typeof RESEARCH_PRESETS[number]
export const RESEARCH_SORTS = ['company', 'score', 'roic', 'debt', 'pe', 'yield', 'margin', 'growth', 'marketCap', 'target'] as const
export type ResearchSort = typeof RESEARCH_SORTS[number]
export const PAGE_SIZE = 50
export interface ResearchState {
  query: string; country: string; sector: string; exchange: string; theme: string; state: string; tag: string
  preset: ResearchPreset; view: 'all' | 'top'; minScore: string; maxPe: string; minYield: string
  sort: ResearchSort; direction: 'asc' | 'desc'; page: number
  instrument: string; tab: ResearchTab; horizon: 1 | 3 | 5 | 10
}
export const DEFAULT_RESEARCH_STATE: ResearchState = {
  query: '', country: '', sector: '', exchange: '', theme: '', state: '', tag: '', preset: 'ALL', view: 'all',
  minScore: '', maxPe: '', minYield: '', sort: 'score', direction: 'desc', page: 1, instrument: '', tab: 'summary', horizon: 5,
}
const owns = <T extends string>(values: readonly T[], value: string | null): value is T => values.includes(value as T)
const boundedNumber = (value: string | null, min: number, max: number): string => {
  if (!value?.trim()) return ''
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? String(n) : ''
}
export function readResearchState(params: URLSearchParams): ResearchState {
  const out = { ...DEFAULT_RESEARCH_STATE }
  for (const key of ['query', 'country', 'sector', 'exchange', 'theme', 'state', 'tag', 'instrument'] as const) out[key] = (params.get(key) ?? '').slice(0, 300)
  if (owns(RESEARCH_PRESETS, params.get('preset'))) out.preset = params.get('preset') as ResearchPreset
  if (owns(RESEARCH_SORTS, params.get('sort'))) out.sort = params.get('sort') as ResearchSort
  if (owns(RESEARCH_TABS, params.get('tab'))) out.tab = params.get('tab') as ResearchTab
  if (params.get('view') === 'top') out.view = 'top'
  if (params.get('direction') === 'asc') out.direction = 'asc'
  out.minScore = boundedNumber(params.get('minScore'), 0, 100)
  out.maxPe = boundedNumber(params.get('maxPe'), 0, 10000)
  out.minYield = boundedNumber(params.get('minYield'), -100, 10000)
  out.page = Math.max(1, Math.floor(Number(boundedNumber(params.get('page'), 1, 100000)) || 1))
  const horizon = Number(params.get('horizon'))
  if ([1, 3, 5, 10].includes(horizon)) out.horizon = horizon as ResearchState['horizon']
  return out
}
export function researchHref(state: ResearchState): string {
  const params = new URLSearchParams()
  for (const key of Object.keys(DEFAULT_RESEARCH_STATE) as Array<keyof ResearchState>) {
    if (state[key] !== DEFAULT_RESEARCH_STATE[key]) params.set(key, String(state[key]))
  }
  return `/research${params.size ? `?${params}` : ''}`
}

export function joinResearchRows(equityRows: EquityScreenerRow[], tridentRows: TridentScreenerRow[], readersAvailable = false): ResearchInstrument[] {
  const groups = new Map<string, { equity: EquityScreenerRow[]; trident: TridentScreenerRow[] }>()
  const symbol = (value: string | null) => value?.trim().toUpperCase() ?? ''
  const owners = new Map<string, Set<string | null>>()
  for (const [kind, rows] of [['equity', equityRows], ['trident', tridentRows]] as const) {
    for (const row of rows) {
      // Record every claim before quarantine can discard a conflicting/duplicate
      // row. An unidentified claimant cannot prove exclusive symbol ownership.
      const claimant = row.instrument_key.trim() ? row.instrument_key : null
      for (const value of [row.ticker, row.provider_symbol]) {
        const normalized = symbol(value)
        if (!normalized) continue
        const keys = owners.get(normalized) ?? new Set<string | null>()
        keys.add(claimant); owners.set(normalized, keys)
      }
      if (claimant === null) continue
      const group = groups.get(row.instrument_key) ?? { equity: [], trident: [] }
      if (kind === 'equity') group.equity.push(row as EquityScreenerRow)
      else group.trident.push(row as TridentScreenerRow)
      groups.set(row.instrument_key, group)
    }
  }
  const joined = Array.from(groups, ([key, group]) => {
    let equity = group.equity.length === 1 ? group.equity[0] : null
    let trident = group.trident.length === 1 ? group.trident[0] : null
    const issues: string[] = []
    if (group.equity.length > 1) issues.push('Doublon dans le lecteur valorisation : chiffres masqués')
    if (group.trident.length > 1) issues.push('Doublon dans le lecteur Trident : critères masqués')
    if (equity && trident) {
      const conflict = (['ticker', 'currency', 'exchange', 'provider_symbol', 'provider', 'country'] as const).some(field =>
        equity![field] && trident![field] && equity![field] !== trident![field])
      if (conflict) {
        issues.push('Identité contradictoire entre les lecteurs : rapprochement suspendu')
        equity = null
        trident = null
      }
    }
    if (!group.equity.length) issues.push('Valorisation non disponible')
    if (!group.trident.length) issues.push('Critères Trident non disponibles')
    const identity = equity ?? trident ?? group.equity[0] ?? group.trident[0]
    return { key, identity, equity, trident, issues }
  }).sort((a, b) => a.key.localeCompare(b.key))
  return joined.map(row => {
    const providerSymbol = symbol(row.identity.provider_symbol)
    const unique = (value: string) => Boolean(value) && owners.get(value)?.size === 1 && owners.get(value)?.has(row.key)
    // A failed reader can hide another share class: local ticker uniqueness is
    // never a price identity proof. Require both readers and the explicit source
    // symbol; do not retry a shorter/ambiguous ticker if this history is absent.
    const priceTicker = readersAvailable && (row.equity || row.trident) && unique(providerSymbol) ? providerSymbol : null
    const issues = [...row.issues]
    if (!readersAvailable) issues.push('Historique suspendu : identité des cours non vérifiable avec un lecteur indisponible')
    if (providerSymbol && !unique(providerSymbol)) issues.push('Historique suspendu : symbole de cours revendiqué par plusieurs identités ou non attribué')
    return { ...row, issues, priceTicker, priceFallbackSymbol: null }
  })
}

export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
export function primaryScore(row: ResearchInstrument): number | null {
  const n = row.equity?.quality_value_score
  return finite(n) && n >= 0 && n <= 100 ? n : null
}
/** A backend classification is not a current source/rights attestation. */
export function qualification(row: ResearchInstrument): { label: string; reason: string; tone: 'warning' | 'neutral' | 'danger' } {
  if (row.issues.some(issue => issue.includes('masqués') || issue.includes('suspendu'))) return { label: 'À vérifier', reason: row.issues.join(' · '), tone: 'danger' }
  if (row.trident?.overall_state === 'REJECTED') return { label: 'Écartée · historique', reason: 'État calculé par Trident. Consulter les critères éliminatoires et leur date.', tone: 'danger' }
  if (row.trident?.overall_state === 'QUALIFIED') return { label: 'Qualifiée · historique', reason: 'Qualification backend uniquement. Fraîcheur et droits des sources non attestés pour la Top Quality actuelle.', tone: 'warning' }
  if (row.trident?.overall_state === 'WATCHLIST') return { label: 'À examiner', reason: 'Classement WATCHLIST du backend ; les données absentes ne sont pas des critères échoués.', tone: 'warning' }
  return { label: 'Non évaluée', reason: 'Aucune admissibilité Trident disponible pour cet instrument.', tone: 'neutral' }
}
export function observationDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}
export function observationLabel(value: string | null | undefined, now = new Date()): string {
  const day = observationDate(value)
  if (!day) return 'Date non attestée'
  if (day > now.toISOString().slice(0, 10)) return 'Date future · à vérifier'
  return `Observé le ${day.split('-').reverse().join('/')}`
}

function strategyScore(row: EquityScreenerRow, key: string): number | null {
  const scores = row.score_details.strategy_scores
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return null
  const value = (scores as Record<string, unknown>)[key]
  return finite(value) ? value : null
}
const strategyTag = (row: EquityScreenerRow, key: string) => Array.isArray(row.score_details.strategy_tags) && row.score_details.strategy_tags.includes(key)
/** Legacy exploratory presets, not qualification or investment instructions. */
export function matchesResearchPreset(row: EquityScreenerRow | null, preset: ResearchPreset): boolean {
  if (preset === 'ALL') return true
  if (!row) return false
  const it = row.themes.includes('IT_SERVICES')
  const momentum = strategyTag(row, 'MOMENTUM_TREND') || (strategyScore(row, 'MOMENTUM_TREND') ?? 0) >= 60 || (
    row.ma200_state === 'ABOVE' && (row.regression_slope_pct ?? -Infinity) > 0 &&
    (row.momentum_3m_pct ?? -Infinity) > 0 && (row.momentum_12m_pct ?? -Infinity) > 0 && (row.regression_z_score ?? 0) < 3.5)
  if (preset === 'ESN_UNIVERSE') return it
  if (preset === 'IT_SERVICES_VALUE') return it && row.valuation_tag === 'POTENTIAL_VALUE'
  if (preset === 'MOMENTUM_TREND') return momentum
  if (preset === 'FCF_COMPOUNDERS') return strategyTag(row, 'FCF_COMPOUNDER') || (strategyScore(row, 'FCF_COMPOUNDER') ?? 0) >= 60 || ((row.fcf_yield ?? 0) >= 0.03 && (row.revenue_cagr_3y ?? 0) >= 0.03)
  if (preset === 'QUALITY_VALUE') return row.valuation_tag !== 'EXPENSIVE' && (strategyTag(row, 'QUALITY_VALUE') || (strategyScore(row, 'QUALITY_VALUE') ?? 0) >= 55 || (row.quality_value_score ?? -Infinity) >= 55)
  return strategyTag(row, 'SECTOR_BOOM') || (strategyScore(row, 'SECTOR_BOOM') ?? 0) >= 60 || (row.themes.some(t => t === 'SOFTWARE' || t === 'SEMICONDUCTOR') && (row.revenue_cagr_3y ?? 0) >= 0.08 && momentum)
}
export function researchMetric(row: ResearchInstrument, key: Exclude<ResearchSort, 'company'>): number | null {
  const q = row.equity
  if (key === 'score') return primaryScore(row)
  const value = key === 'roic' ? q?.latest_roic ?? row.trident?.latest_roic
    : key === 'debt' ? q?.latest_net_debt_to_ebitda ?? row.trident?.latest_net_debt_to_ebitda
      : key === 'pe' ? q?.forward_pe : key === 'yield' ? q?.fcf_yield : key === 'margin' ? q?.fcf_margin
        : key === 'growth' ? q?.revenue_cagr_3y : key === 'marketCap' ? q?.market_cap_usd : q?.target_upside
  return finite(value) ? value : null
}
export function filterResearch(rows: ResearchInstrument[], state: ResearchState): ResearchInstrument[] {
  // The legacy views do not expose current rights + freshness qualification.
  // Never manufacture a Top Quality list from a score or a license note.
  if (state.view === 'top') return []
  const query = state.query.trim().toLocaleLowerCase('fr')
  return rows.filter(row => {
    const id = row.identity, q = row.equity
    if (query && ![id.ticker, id.name, id.industry, id.provider_symbol].some(v => v?.toLocaleLowerCase('fr').includes(query))) return false
    if (state.country && id.country !== state.country || state.sector && id.sector !== state.sector || state.exchange && id.exchange !== state.exchange) return false
    if (state.theme && !q?.themes.includes(state.theme)) return false
    if (state.state && row.trident?.overall_state !== state.state) return false
    if (state.tag && q?.valuation_tag !== state.tag) return false
    if (!matchesResearchPreset(q, state.preset)) return false
    const score = primaryScore(row), pe = researchMetric(row, 'pe'), yieldValue = researchMetric(row, 'yield')
    if (state.minScore !== '' && (score === null || score < Number(state.minScore))) return false
    if (state.maxPe !== '' && (pe === null || pe <= 0 || pe > Number(state.maxPe))) return false
    if (state.minYield !== '' && (yieldValue === null || yieldValue * 100 < Number(state.minYield))) return false
    return true
  }).sort((a, b) => {
    let result = 0
    if (state.sort === 'company') result = (a.identity.name ?? a.identity.ticker).localeCompare(b.identity.name ?? b.identity.ticker, 'fr') * (state.direction === 'asc' ? 1 : -1)
    else {
      const av = researchMetric(a, state.sort), bv = researchMetric(b, state.sort)
      result = av === null && bv === null ? 0 : av === null ? 1 : bv === null ? -1 : (av - bv) * (state.direction === 'asc' ? 1 : -1)
    }
    return result || a.key.localeCompare(b.key)
  })
}

export function safeSourceUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null
  } catch { return null }
}
