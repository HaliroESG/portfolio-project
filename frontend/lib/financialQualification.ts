import type { BacktestKpi, BacktestResult, FinancialKpiQualification } from '../types'
import type { FamilyOfficeBundle } from './familyOfficeData'

// Presentation counterpart of backend/financial_qualification.py. Shared fixtures
// check both implementations. No financial calculation version is admitted here.
export const FINANCIAL_KPI_POLICY = 'fi03-protect-v1'
export const FINANCIAL_KPI_REASON = 'CALCULATION_NOT_QUALIFIED'
export const FINANCIAL_KPI_MESSAGE = 'Calcul et historique non qualifiés : indicateur indisponible.'
export const PROTECTED_FIELDS = {
  PORTFOLIO_PERFORMANCE: ['twr_daily', 'twr_mtd', 'twr_ytd', 'twr_since_inception', 'xirr_since_inception', 'benchmark_daily', 'benchmark_ytd'],
  PORTFOLIO_RISK: ['volatility_30d_pct', 'max_drawdown_ytd_pct'],
  BACKTEST: ['drawdown', 'returns_daily', 'cagr', 'vol', 'sharpe', 'sortino', 'max_drawdown', 'calmar', 'worst_year', 'best_year'],
} as const

export function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function financialQualification(family: string, input: object = {}): FinancialKpiQualification {
  const row = input as Record<string, unknown>
  return {
    policy_version: FINANCIAL_KPI_POLICY,
    state: 'UNQUALIFIED',
    reason_code: FINANCIAL_KPI_REASON,
    message: FINANCIAL_KPI_MESSAGE,
    metric_family: Object.hasOwn(PROTECTED_FIELDS, family) ? family as keyof typeof PROTECTED_FIELDS : 'UNKNOWN',
    calculation_version: text(row.calculation_version),
    portfolio_id: text(row.portfolio_id || row.portfolio_key),
    run_id: text(row.run_id),
    window_start: text(row.start_date),
    window_end: text(row.end_date || row.performance_date || row.risk_date || row.period_end || row.date),
    calculated_at: text(row.calculated_at),
    coverage_pct: finiteNumber(row.coverage_pct),
  }
}

export function protectFields<T extends object>(input: T, family: keyof typeof PROTECTED_FIELDS): T {
  const row = { ...input } as Record<string, unknown>
  for (const key of PROTECTED_FIELDS[family]) if (Object.hasOwn(row, key)) row[key] = null
  return row as T
}

export function hasProtectedDependency(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasProtectedDependency)
  if (typeof value === 'string') return Object.values(PROTECTED_FIELDS).flat().some(key => key === value) || Object.hasOwn(PROTECTED_FIELDS, value)
  if (!value || typeof value !== 'object') return false
  const protectedKeys: readonly string[] = Object.values(PROTECTED_FIELDS).flat()
  return Object.entries(value).some(([key, item]) =>
    protectedKeys.includes(key)
    || (key === 'metric_family' && typeof item === 'string' && Object.hasOwn(PROTECTED_FIELDS, item))
    || hasProtectedDependency(item))
}

export function protectBacktestKpi(row: BacktestKpi): BacktestKpi {
  return { ...protectFields(row, 'BACKTEST'), financial_qualification: financialQualification('BACKTEST', row) }
}

export function protectBacktestResult(row: BacktestResult): BacktestResult {
  return { ...row, nav: finiteNumber(row.nav), drawdown: null, returns_daily: null }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function riskExport(value: unknown): Record<string, unknown> {
  const row = record(value)
  const keys = ['portfolio_id', 'risk_date', 'calculated_at', 'data_state', 'volatility_30d_pct', 'max_drawdown_ytd_pct', 'largest_position_pct', 'top10_concentration_pct', 'cash_pct', 'illiquid_pct', 'fx_exposure_pct']
  const safe = protectFields(Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])), 'PORTFOLIO_RISK')
  if (safe.data_state === 'READY') safe.data_state = 'PARTIAL'
  return safe
}

export function protectFamilyOfficeBundle(bundle: FamilyOfficeBundle): FamilyOfficeBundle {
  // Applied at the read boundary AND render boundary: a pre-populated/stale SWR
  // object is not trusted as a qualification receipt. Source objects stay intact.
  return {
    ...bundle,
    overview: bundle.overview.map(row => ({
      ...protectFields(protectFields(row, 'PORTFOLIO_PERFORMANCE'), 'PORTFOLIO_RISK'),
      financial_qualification: [financialQualification('PORTFOLIO_PERFORMANCE', row), financialQualification('PORTFOLIO_RISK', row)],
    })),
    performance: bundle.performance.map(row => ({
      ...protectFields(row, 'PORTFOLIO_PERFORMANCE'),
      nav_eur: finiteNumber(row.nav_eur),
      financial_qualification: [financialQualification('PORTFOLIO_PERFORMANCE', row)],
    })),
    decisions: bundle.decisions.map(row => ({
      ...row,
      financial_dependency_blocked: hasProtectedDependency([row.risk_context, row.source_snapshot]),
    })),
    closes: bundle.closes.map(row => {
      const report = record(row.report_json)
      return {
        ...row,
        financial_qualification: [financialQualification('PORTFOLIO_PERFORMANCE', row)],
        report_json: {
          ...report,
          performance: Array.isArray(report.performance) ? report.performance.map(item => protectFields(record(item), 'PORTFOLIO_PERFORMANCE')) : [],
          risk: riskExport(report.risk),
        },
      }
    }),
  }
}
