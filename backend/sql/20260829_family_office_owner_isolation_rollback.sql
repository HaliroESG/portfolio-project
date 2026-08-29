\set ON_ERROR_STOP on

-- Guarded post-commit rollback for an explicitly authorized maintenance
-- window. It refuses to collapse a database that already contains two owner
-- profiles. This file is evidence of reversibility; it is not auto-applied.
begin;

do $$
begin
  if (select count(*) from public.fo_owner_profiles) > 1 then
    raise exception 'PGA-004 rollback refused: more than one owner profile exists';
  end if;
end;
$$;

do $$
declare
  edge record;
begin
  for edge in
    select * from (values
      ('fo_portfolios', 'fo_portfolios_owner_legal_entity_fkey', 'fo_portfolios_legal_entity_id_fkey', 'legal_entity_id', 'fo_legal_entities', 'id', false),
      ('fo_accounts', 'fo_accounts_owner_portfolio_fkey', 'fo_accounts_portfolio_id_fkey', 'portfolio_id', 'fo_portfolios', 'id', false),
      ('fo_accounts', 'fo_accounts_owner_institution_fkey', 'fo_accounts_institution_id_fkey', 'institution_id', 'fo_institutions', 'id', false),
      ('fo_import_runs', 'fo_import_runs_owner_account_fkey', 'fo_import_runs_account_id_fkey', 'account_id', 'fo_accounts', 'id', false),
      ('fo_ledger_entries', 'fo_ledger_entries_owner_account_fkey', 'fo_ledger_entries_account_id_fkey', 'account_id', 'fo_accounts', 'id', false),
      ('fo_ledger_entries', 'fo_ledger_entries_owner_import_run_fkey', 'fo_ledger_entries_import_run_id_fkey', 'import_run_id', 'fo_import_runs', 'id', false),
      ('fo_ledger_entries', 'fo_ledger_entries_owner_reversal_fkey', 'fo_ledger_entries_reversal_of_id_fkey', 'reversal_of_id', 'fo_ledger_entries', 'id', false),
      ('fo_position_snapshots', 'fo_position_snapshots_owner_portfolio_fkey', 'fo_position_snapshots_portfolio_id_fkey', 'portfolio_id', 'fo_portfolios', 'id', false),
      ('fo_position_snapshots', 'fo_position_snapshots_owner_account_fkey', 'fo_position_snapshots_account_id_fkey', 'account_id', 'fo_accounts', 'id', false),
      ('fo_cash_balances_daily', 'fo_cash_balances_owner_portfolio_fkey', 'fo_cash_balances_daily_portfolio_id_fkey', 'portfolio_id', 'fo_portfolios', 'id', false),
      ('fo_cash_balances_daily', 'fo_cash_balances_owner_account_fkey', 'fo_cash_balances_daily_account_id_fkey', 'account_id', 'fo_accounts', 'id', false),
      ('fo_reconciliation_runs', 'fo_reconciliation_runs_owner_account_fkey', 'fo_reconciliation_runs_account_id_fkey', 'account_id', 'fo_accounts', 'id', false),
      ('fo_reconciliation_runs', 'fo_reconciliation_runs_owner_import_run_fkey', 'fo_reconciliation_runs_import_run_id_fkey', 'import_run_id', 'fo_import_runs', 'id', false),
      ('fo_reconciliation_items', 'fo_reconciliation_items_owner_run_fkey', 'fo_reconciliation_items_run_id_fkey', 'run_id', 'fo_reconciliation_runs', 'id', true),
      ('fo_manual_holdings', 'fo_manual_holdings_owner_portfolio_fkey', 'fo_manual_holdings_portfolio_id_fkey', 'portfolio_id', 'fo_portfolios', 'id', false),
      ('fo_manual_valuations', 'fo_manual_valuations_owner_holding_fkey', 'fo_manual_valuations_holding_id_fkey', 'holding_id', 'fo_manual_holdings', 'id', true),
      ('fo_performance_daily', 'fo_performance_daily_owner_portfolio_fkey', 'fo_performance_daily_portfolio_id_fkey', 'portfolio_id', 'fo_portfolios', 'id', false),
      ('fo_risk_daily', 'fo_risk_daily_owner_portfolio_fkey', 'fo_risk_daily_portfolio_id_fkey', 'portfolio_id', 'fo_portfolios', 'id', false),
      ('fo_ips_policies', 'fo_ips_policies_owner_portfolio_fkey', 'fo_ips_policies_portfolio_id_fkey', 'portfolio_id', 'fo_portfolios', 'id', false),
      ('fo_allocation_targets', 'fo_allocation_targets_owner_policy_fkey', 'fo_allocation_targets_policy_id_fkey', 'policy_id', 'fo_ips_policies', 'id', true),
      ('fo_exceptions', 'fo_exceptions_owner_portfolio_fkey', 'fo_exceptions_portfolio_id_fkey', 'portfolio_id', 'fo_portfolios', 'id', false),
      ('fo_exceptions', 'fo_exceptions_owner_account_fkey', 'fo_exceptions_account_id_fkey', 'account_id', 'fo_accounts', 'id', false),
      ('fo_decisions', 'fo_decisions_owner_portfolio_fkey', 'fo_decisions_portfolio_id_fkey', 'portfolio_id', 'fo_portfolios', 'id', false),
      ('fo_order_drafts', 'fo_order_drafts_owner_decision_fkey', 'fo_order_drafts_decision_id_fkey', 'decision_id', 'fo_decisions', 'id', true),
      ('fo_order_drafts', 'fo_order_drafts_owner_account_fkey', 'fo_order_drafts_account_id_fkey', 'account_id', 'fo_accounts', 'id', false),
      ('fo_order_lines', 'fo_order_lines_owner_order_draft_fkey', 'fo_order_lines_order_draft_id_fkey', 'order_draft_id', 'fo_order_drafts', 'id', true),
      ('fo_monthly_closes', 'fo_monthly_closes_owner_portfolio_fkey', 'fo_monthly_closes_portfolio_id_fkey', 'portfolio_id', 'fo_portfolios', 'id', false)
    ) as edges(child_table, composite_name, simple_name, child_column, parent_table, parent_column, cascade_delete)
  loop
    execute format(
      'alter table public.%I drop constraint if exists %I, drop constraint if exists %I, '
      'add constraint %I foreign key (%I) references public.%I (%I)%s',
      edge.child_table, edge.composite_name, edge.simple_name, edge.simple_name,
      edge.child_column, edge.parent_table, edge.parent_column,
      case when edge.cascade_delete then ' on delete cascade' else '' end
    );
  end loop;
end;
$$;

drop index if exists public.fo_legal_entities_owner_id_uq;
drop index if exists public.fo_portfolios_owner_id_uq;
drop index if exists public.fo_institutions_owner_id_uq;
drop index if exists public.fo_accounts_owner_id_uq;
drop index if exists public.fo_import_runs_owner_id_uq;
drop index if exists public.fo_ledger_entries_owner_id_uq;
drop index if exists public.fo_reconciliation_runs_owner_id_uq;
drop index if exists public.fo_manual_holdings_owner_id_uq;
drop index if exists public.fo_ips_policies_owner_id_uq;
drop index if exists public.fo_decisions_owner_id_uq;
drop index if exists public.fo_order_drafts_owner_id_uq;
drop index if exists public.broker_transactions_owner_idempotency_uq;
drop index if exists public.broker_reconciliation_runs_owner_idempotency_uq;

do $$
declare
  object_name text;
  edge_name text;
  legacy_tables constant text[] := array[
    'portfolios', 'portfolio_positions', 'valuation_snapshots',
    'governance_targets', 'decision_journal', 'target_portfolios',
    'target_envelope_weights', 'broker_transactions',
    'broker_reconciliation_runs', 'broker_reconciliation_items',
    'broker_position_snapshot_runs', 'broker_position_snapshot_items',
    'target_models', 'target_buckets', 'target_envelope_lines',
    'target_model_audit_holdings'
  ];
  legacy_edge_names constant text[] := array[
    'portfolio_positions_owner_portfolio_id_fkey',
    'valuation_snapshots_owner_portfolio_id_fkey',
    'governance_targets_owner_portfolio_id_fkey',
    'decision_journal_owner_portfolio_id_fkey',
    'target_portfolios_owner_portfolio_id_fkey',
    'target_envelope_weights_owner_target_portfolio_id_fkey',
    'broker_position_snapshot_runs_owner_portfolio_id_fkey',
    'broker_position_snapshot_items_owner_run_id_fkey',
    'broker_position_snapshot_items_owner_portfolio_id_fkey',
    'broker_reconciliation_items_owner_run_id_fkey',
    'target_buckets_owner_model_id_fkey',
    'target_envelope_lines_owner_model_id_fkey',
    'target_model_audit_holdings_owner_model_id_fkey'
  ];
begin
  foreach edge_name in array legacy_edge_names loop
    for object_name in
      select table_name from information_schema.table_constraints
      where table_schema = 'public' and constraint_name = edge_name
    loop
      execute format('alter table public.%I drop constraint %I', object_name, edge_name);
    end loop;
  end loop;

  foreach object_name in array legacy_tables loop
    if to_regclass(format('public.%I', object_name)) is null then continue; end if;
    execute format('drop trigger if exists fo_assign_legacy_owner on public.%I', object_name);
    execute format('drop policy if exists fo_legacy_private_read on public.%I', object_name);
    execute format('alter table public.%I drop constraint if exists %I', object_name, object_name || '_owner_user_id_fkey');
    execute format('drop index if exists public.%I', object_name || '_owner_id_uq');
    execute format('drop index if exists public.%I', object_name || '_owner_user_id_idx');
    execute format('alter table public.%I drop column if exists owner_user_id', object_name);
    execute format(
      'create policy fo_legacy_owner_read on public.%I for select to authenticated '
      'using (exists (select 1 from public.fo_owner_profiles profile '
      'where profile.user_id = (select auth.uid())))',
      object_name
    );
    execute format('grant select on table public.%I to authenticated', object_name);
  end loop;
end;
$$;

create or replace function fo_private.validate_family_office_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or not exists (
    select 1 from public.fo_owner_allowlist allowlist
    where allowlist.email = lower(trim(new.email)) and allowlist.is_active
  ) then
    raise exception 'This email is not authorized for the private portfolio';
  end if;
  if exists (select 1 from public.fo_owner_profiles) then
    raise exception 'The private portfolio already has an owner';
  end if;
  return new;
end;
$$;

drop function if exists fo_private.assign_legacy_owner();

commit;
