-- Lock every object exposed through the Data API. The application is private.

do $$
declare
  object_name text;
  owner_tables constant text[] := array[
    'fo_legal_entities', 'fo_portfolios', 'fo_institutions', 'fo_accounts',
    'fo_import_runs', 'fo_ledger_entries', 'fo_position_snapshots',
    'fo_cash_balances_daily', 'fo_reconciliation_runs',
    'fo_reconciliation_items', 'fo_manual_holdings', 'fo_manual_valuations',
    'fo_performance_daily', 'fo_risk_daily', 'fo_ips_policies',
    'fo_allocation_targets', 'fo_exceptions', 'fo_decisions',
    'fo_order_drafts', 'fo_order_lines', 'fo_monthly_closes', 'fo_audit_log'
  ];
begin
  -- All public tables get RLS and lose public privileges, including legacy tables.
  for object_name in
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('alter table public.%I enable row level security', object_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', object_name);
  end loop;

  -- Direct owner predicate for canonical private rows.
  foreach object_name in array owner_tables loop
    if to_regclass(format('public.%I', object_name)) is null then
      continue;
    end if;
    execute format('drop policy if exists fo_owner_read on public.%I', object_name);
    execute format(
      'create policy fo_owner_read on public.%I for select to authenticated '
      'using ((select auth.uid()) = owner_user_id)',
      object_name
    );
    execute format('grant select on table public.%I to authenticated', object_name);
  end loop;
end;
$$;

alter table public.fo_owner_profiles enable row level security;
drop policy if exists fo_owner_profile_read on public.fo_owner_profiles;
create policy fo_owner_profile_read on public.fo_owner_profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);
grant select on public.fo_owner_profiles to authenticated;

-- Authorization bootstrap data is never exposed through the Data API.
revoke all on public.fo_owner_allowlist from public, anon, authenticated;

-- Instruments and existing market/research tables are shared reference data, but
-- still only visible to the registered owner in this private application.
do $$
declare
  object_name text;
  reference_tables constant text[] := array[
    'fo_instruments', 'fo_instrument_aliases',
    'market_watch', 'currencies', 'macro_indicators', 'macro_series_points',
    'macro_regime_snapshots', 'macro_satellite_targets', 'news_feed',
    'historical_prices', 'historical_price_coverage', 'instrument_identifier_map',
    'trident_equity_universe', 'trident_financial_annual', 'trident_results',
    'trident_criterion_results', 'trident_stock_insights',
    'equity_screener_results', 'backtest_runs', 'backtest_portfolios',
    'backtest_results', 'backtest_kpis', 'support_sources',
    'investment_supports', 'support_availability', 'support_source_rows', 'etl_runs'
  ];
begin
  foreach object_name in array reference_tables loop
    if to_regclass(format('public.%I', object_name)) is null then
      continue;
    end if;
    execute format('drop policy if exists fo_registered_owner_read on public.%I', object_name);
    execute format(
      'create policy fo_registered_owner_read on public.%I for select to authenticated '
      'using (exists (select 1 from public.fo_owner_profiles profile where profile.user_id = (select auth.uid())))',
      object_name
    );
    execute format('grant select on table public.%I to authenticated', object_name);
  end loop;
end;
$$;

-- Legacy operational tables remain readable only by the owner while frontend
-- readers are migrated to the canonical contract.
do $$
declare
  object_name text;
  legacy_tables constant text[] := array[
    'portfolios', 'portfolio_positions', 'valuation_snapshots',
    'governance_targets', 'decision_journal', 'target_portfolios',
    'target_envelope_weights', 'broker_transactions',
    'broker_reconciliation_runs', 'broker_reconciliation_items',
    'broker_position_snapshot_runs', 'broker_position_snapshot_items',
    'target_models', 'target_buckets', 'target_envelope_lines',
    'target_model_audit_holdings'
  ];
begin
  foreach object_name in array legacy_tables loop
    if to_regclass(format('public.%I', object_name)) is null then
      continue;
    end if;
    execute format('drop policy if exists fo_legacy_owner_read on public.%I', object_name);
    execute format(
      'create policy fo_legacy_owner_read on public.%I for select to authenticated '
      'using (exists (select 1 from public.fo_owner_profiles profile where profile.user_id = (select auth.uid())))',
      object_name
    );
    execute format('grant select on table public.%I to authenticated', object_name);
  end loop;
end;
$$;

-- Views must inherit caller RLS. Existing views are altered defensively.
do $$
declare
  view_name text;
begin
  for view_name in
    select table_name
    from information_schema.views
    where table_schema = 'public'
  loop
    execute format('alter view public.%I set (security_invoker = true)', view_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', view_name);
    execute format('grant select on table public.%I to authenticated', view_name);
  end loop;
end;
$$;

revoke all on all sequences in schema public from public, anon, authenticated;
grant usage on schema public to authenticated;
revoke usage on schema public from anon;

-- Backend keys retain explicit access even when the project uses non-legacy keys.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
