import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { protectFamilyOfficeBundle } from './financialQualification'
import type {
  FamilyOfficeAccountRow,
  FamilyOfficeCashRow,
  FamilyOfficeDecisionRow,
  FamilyOfficeInstitutionRow,
  FamilyOfficeManualHoldingRow,
  FamilyOfficeMonthlyCloseRow,
  FamilyOfficeOperationRow,
  FamilyOfficeOverviewRow,
  FamilyOfficePerformanceRow,
  FamilyOfficePortfolioRow,
  FamilyOfficePositionRow,
} from '../types'

const OVERVIEW_COLUMNS = 'owner_user_id,portfolio_id,portfolio_name,portfolio_type,base_currency,benchmark_symbol,liquid_assets_eur,cash_eur,manual_assets_eur,liabilities_eur,net_asset_value_eur,twr_mtd,twr_ytd,xirr_since_inception,coverage_pct,performance_state,volatility_30d_pct,max_drawdown_ytd_pct,largest_position_pct,open_exception_count,updated_at'
const POSITION_COLUMNS = 'id,owner_user_id,portfolio_id,account_id,instrument_id,instrument_key,isin,ticker,name,instrument_type,currency,snapshot_date,quantity,average_cost,cost_basis_eur,price_local,fx_rate_to_eur,market_value_eur,unrealized_pnl_eur,data_state,price_as_of,fx_as_of,reconciliation_state,calculated_at'
const CASH_COLUMNS = 'id,owner_user_id,portfolio_id,account_id,balance_date,currency,balance_local,fx_rate_to_eur,balance_eur,data_state,calculated_at'
const OPERATION_COLUMNS = 'id,owner_user_id,portfolio_id,account_id,exception_type,severity,status,title,details,source_ref,detected_at,resolved_at'
const MANUAL_COLUMNS = 'owner_user_id,portfolio_id,holding_id,holding_kind,asset_type,name,currency,valuation_frequency,next_valuation_date,status,valuation_date,value_local,fx_rate_to_eur,value_eur,source,confidence,created_at'
const PERFORMANCE_COLUMNS = 'portfolio_id,performance_date,nav_eur,external_flow_eur,twr_daily,twr_mtd,twr_ytd,twr_since_inception,xirr_since_inception,benchmark_daily,benchmark_ytd,coverage_pct,data_state,calculated_at'

export interface FamilyOfficeBundle {
  schemaState: 'READY' | 'SCHEMA_PENDING'
  portfolios: FamilyOfficePortfolioRow[]
  overview: FamilyOfficeOverviewRow[]
  accounts: FamilyOfficeAccountRow[]
  institutions: FamilyOfficeInstitutionRow[]
  positions: FamilyOfficePositionRow[]
  cash: FamilyOfficeCashRow[]
  manualHoldings: FamilyOfficeManualHoldingRow[]
  operations: FamilyOfficeOperationRow[]
  performance: FamilyOfficePerformanceRow[]
  decisions: FamilyOfficeDecisionRow[]
  closes: FamilyOfficeMonthlyCloseRow[]
}

function isMissingSchemaError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const message = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase()
  return message.includes('42p01') || message.includes('pgrst205') || message.includes('does not exist')
}

export async function loadFamilyOfficeBundle(supabase: SupabaseClient): Promise<FamilyOfficeBundle> {
  const results = await Promise.all([
    supabase.from('fo_portfolios').select('id,owner_user_id,legal_entity_id,name,portfolio_type,base_currency,benchmark_symbol,status,created_at,updated_at').order('name'),
    supabase.from('fo_portfolio_overview_latest').select(OVERVIEW_COLUMNS).order('portfolio_name'),
    supabase.from('fo_accounts').select('id,owner_user_id,portfolio_id,institution_id,external_account_id,name,envelope,base_currency,status,opened_on,closed_on,created_at,updated_at').order('name'),
    supabase.from('fo_institutions').select('id,owner_user_id,name,institution_type,country_code,created_at').order('name'),
    supabase.from('fo_positions_latest').select(POSITION_COLUMNS).order('market_value_eur', { ascending: false, nullsFirst: false }),
    supabase.from('fo_cash_balances_latest').select(CASH_COLUMNS).order('balance_eur', { ascending: false, nullsFirst: false }),
    supabase.from('fo_manual_valuations_latest').select(MANUAL_COLUMNS).order('name'),
    supabase.from('fo_operations_inbox').select(OPERATION_COLUMNS).order('detected_at', { ascending: false }),
    supabase.from('fo_performance_daily').select(PERFORMANCE_COLUMNS).order('performance_date', { ascending: true }).limit(1500),
    supabase.from('fo_decisions').select('id,owner_user_id,portfolio_id,title,rationale,status,macro_context,risk_context,source_snapshot,created_at,validated_at,executed_at,reconciled_at,updated_at').order('created_at', { ascending: false }).limit(100),
    supabase.from('fo_monthly_closes').select('id,owner_user_id,portfolio_id,period_end,status,nav_eur,coverage_pct,open_exception_count,reconciliation_state,checks_json,report_json,closed_at,created_at').order('period_end', { ascending: false }).limit(36),
  ])

  const firstError = results.find((result) => result.error)?.error ?? null
  if (firstError) {
    if (isMissingSchemaError(firstError)) {
      return {
        schemaState: 'SCHEMA_PENDING', portfolios: [], overview: [], accounts: [], institutions: [],
        positions: [], cash: [], manualHoldings: [], operations: [], performance: [], decisions: [], closes: [],
      }
    }
    throw firstError
  }

  return protectFamilyOfficeBundle({
    schemaState: 'READY',
    portfolios: (results[0].data ?? []) as FamilyOfficePortfolioRow[],
    overview: (results[1].data ?? []) as FamilyOfficeOverviewRow[],
    accounts: (results[2].data ?? []) as FamilyOfficeAccountRow[],
    institutions: (results[3].data ?? []) as FamilyOfficeInstitutionRow[],
    positions: (results[4].data ?? []) as FamilyOfficePositionRow[],
    cash: (results[5].data ?? []) as FamilyOfficeCashRow[],
    manualHoldings: (results[6].data ?? []) as FamilyOfficeManualHoldingRow[],
    operations: (results[7].data ?? []) as FamilyOfficeOperationRow[],
    performance: (results[8].data ?? []) as FamilyOfficePerformanceRow[],
    decisions: (results[9].data ?? []) as FamilyOfficeDecisionRow[],
    closes: (results[10].data ?? []) as FamilyOfficeMonthlyCloseRow[],
  })
}

export const FAMILY_OFFICE_SWR_KEY = 'family-office-bundle-fi03-protect-v1'
export const FAMILY_OFFICE_REFRESH_MS = 60_000

/** Verify the subject before selecting a cache; auth event payloads are not evidence. */
export function useFamilyOfficeBundle(supabase: SupabaseClient) {
  const pathname = usePathname()
  const [session, setSession] = useState<{ path: string; owner?: string; error?: Error } | null>(null)
  useEffect(() => {
    let alive = true, generation = 0
    const verify = () => {
      const request = ++generation
      setSession(null)
      // Auth callbacks must return before another SDK auth call can take its lock.
      void Promise.resolve().then(() => supabase.auth.getUser()).then(({ data, error }) => {
        if (!alive || request !== generation) return
        setSession(error || !data.user
          ? { path: pathname, error: new Error('Session non vérifiable. Aucune donnée affichée.') }
          : { path: pathname, owner: data.user.id })
      }).catch(() => {
        if (alive && request === generation) setSession({ path: pathname, error: new Error('Session non vérifiable. Aucune donnée affichée.') })
      })
    }
    verify()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event !== 'INITIAL_SESSION') verify()
    })
    window.addEventListener('focus', verify)
    return () => { alive = false; generation++; subscription.unsubscribe(); window.removeEventListener('focus', verify) }
  }, [pathname, supabase])
  // A route change invalidates the old scope synchronously, before the effect runs.
  const owner = session?.path === pathname ? session.owner : undefined
  const result = useSWR(owner ? [FAMILY_OFFICE_SWR_KEY, owner, pathname] : null, async () => {
    const verifyOwner = async () => {
      const { data, error } = await supabase.auth.getUser()
      if (error || !owner || data.user?.id !== owner) throw new Error('Session modifiée. Rechargez la page.')
    }
    await verifyOwner()
    const bundle = await loadFamilyOfficeBundle(supabase)
    await verifyOwner()
    const owned = [bundle.portfolios, bundle.overview, bundle.accounts, bundle.institutions,
      bundle.positions, bundle.cash, bundle.manualHoldings, bundle.operations, bundle.decisions, bundle.closes]
    const portfolios = new Set(bundle.portfolios.map(row => row.id))
    if (owned.some(rows => rows.some(row => row.owner_user_id !== owner)) || bundle.performance.some(row => !portfolios.has(row.portfolio_id))) {
      throw new Error('Données hors périmètre de la session. Aucune donnée affichée.')
    }
    return bundle
  }, { refreshInterval: FAMILY_OFFICE_REFRESH_MS, keepPreviousData: false, shouldRetryOnError: false })
  return { ...result, data: owner && !result.error ? result.data : undefined,
    error: session?.path === pathname ? session.error ?? result.error : undefined,
    isLoading: session?.path !== pathname || (!session.error && (!owner || result.isLoading)) }
}
