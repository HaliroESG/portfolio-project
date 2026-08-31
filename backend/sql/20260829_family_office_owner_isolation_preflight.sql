\set ON_ERROR_STOP on

-- Read-only preflight for a future authorized application. It is versioned so
-- operators can measure deterministic blockers before taking migration locks.
-- This script is never an authorization to query or mutate a provider.
begin transaction read only;

do $$
declare
  owner_count bigint;
  object_name text;
  row_count bigint;
  null_owner_count bigint;
  unknown_owner_count bigint;
  canonical_cross_owner_count bigint := 0;
  legacy_cross_owner_count bigint := 0;
  canonical_edges_checked integer := 0;
  legacy_edges_checked integer := 0;
  blocker_count bigint := 0;
  edge record;
  child_regclass regclass;
  parent_regclass regclass;
  edge_cross_owner_count bigint;
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
  select count(*) into owner_count from public.fo_owner_profiles;
  foreach object_name in array legacy_tables loop
    if to_regclass(format('public.%I', object_name)) is null then continue; end if;
    execute format('select count(*) from public.%I', object_name) into row_count;
    if not exists (
      select 1 from pg_attribute
      where attrelid = to_regclass(format('public.%I', object_name))
        and attname = 'owner_user_id' and not attisdropped
    ) then
      if row_count > 0 and owner_count <> 1 then
        blocker_count := blocker_count + row_count;
        raise notice
          'PGA-004 preflight legacy table=% rows=% missing_owner_column=%',
          object_name, row_count, row_count;
      end if;
      continue;
    end if;

    execute format(
      'select count(*) filter (where row.owner_user_id is null), '
      'count(*) filter (where row.owner_user_id is not null and profile.user_id is null) '
      'from public.%I row left join public.fo_owner_profiles profile '
      'on profile.user_id = row.owner_user_id',
      object_name
    ) into null_owner_count, unknown_owner_count;
    blocker_count := blocker_count + null_owner_count + unknown_owner_count;
    raise notice
      'PGA-004 preflight legacy table=% rows=% null_owner=% unknown_owner=%',
      object_name, row_count, null_owner_count, unknown_owner_count;
  end loop;

  for edge in
    select * from (values
      ('fo_portfolios', 'legal_entity_id', 'fo_legal_entities', 'id'),
      ('fo_accounts', 'portfolio_id', 'fo_portfolios', 'id'),
      ('fo_accounts', 'institution_id', 'fo_institutions', 'id'),
      ('fo_import_runs', 'account_id', 'fo_accounts', 'id'),
      ('fo_ledger_entries', 'account_id', 'fo_accounts', 'id'),
      ('fo_ledger_entries', 'import_run_id', 'fo_import_runs', 'id'),
      ('fo_ledger_entries', 'reversal_of_id', 'fo_ledger_entries', 'id'),
      ('fo_position_snapshots', 'portfolio_id', 'fo_portfolios', 'id'),
      ('fo_position_snapshots', 'account_id', 'fo_accounts', 'id'),
      ('fo_cash_balances_daily', 'portfolio_id', 'fo_portfolios', 'id'),
      ('fo_cash_balances_daily', 'account_id', 'fo_accounts', 'id'),
      ('fo_reconciliation_runs', 'account_id', 'fo_accounts', 'id'),
      ('fo_reconciliation_runs', 'import_run_id', 'fo_import_runs', 'id'),
      ('fo_reconciliation_items', 'run_id', 'fo_reconciliation_runs', 'id'),
      ('fo_manual_holdings', 'portfolio_id', 'fo_portfolios', 'id'),
      ('fo_manual_valuations', 'holding_id', 'fo_manual_holdings', 'id'),
      ('fo_performance_daily', 'portfolio_id', 'fo_portfolios', 'id'),
      ('fo_risk_daily', 'portfolio_id', 'fo_portfolios', 'id'),
      ('fo_ips_policies', 'portfolio_id', 'fo_portfolios', 'id'),
      ('fo_allocation_targets', 'policy_id', 'fo_ips_policies', 'id'),
      ('fo_exceptions', 'portfolio_id', 'fo_portfolios', 'id'),
      ('fo_exceptions', 'account_id', 'fo_accounts', 'id'),
      ('fo_decisions', 'portfolio_id', 'fo_portfolios', 'id'),
      ('fo_order_drafts', 'decision_id', 'fo_decisions', 'id'),
      ('fo_order_drafts', 'account_id', 'fo_accounts', 'id'),
      ('fo_order_lines', 'order_draft_id', 'fo_order_drafts', 'id'),
      ('fo_monthly_closes', 'portfolio_id', 'fo_portfolios', 'id')
    ) as edges(child_table, child_column, parent_table, parent_column)
  loop
    child_regclass := to_regclass(format('public.%I', edge.child_table));
    parent_regclass := to_regclass(format('public.%I', edge.parent_table));
    if child_regclass is null or parent_regclass is null then continue; end if;
    canonical_edges_checked := canonical_edges_checked + 1;
    execute format(
      'select count(*) from public.%I child join public.%I parent '
      'on child.%I = parent.%I where child.%I is not null '
      'and child.owner_user_id is distinct from parent.owner_user_id',
      edge.child_table, edge.parent_table,
      edge.child_column, edge.parent_column, edge.child_column
    ) into edge_cross_owner_count;
    canonical_cross_owner_count := canonical_cross_owner_count + edge_cross_owner_count;
    if edge_cross_owner_count > 0 then
      raise notice
        'PGA-004 preflight canonical edge=%.%->%.% cross_owner=%',
        edge.child_table, edge.child_column,
        edge.parent_table, edge.parent_column,
        edge_cross_owner_count;
    end if;
  end loop;

  for edge in
    select * from (values
      ('portfolio_positions', 'portfolio_id', 'portfolios', 'id'),
      ('valuation_snapshots', 'portfolio_id', 'portfolios', 'id'),
      ('governance_targets', 'portfolio_id', 'portfolios', 'id'),
      ('decision_journal', 'portfolio_id', 'portfolios', 'id'),
      ('target_portfolios', 'portfolio_id', 'portfolios', 'id'),
      ('target_envelope_weights', 'target_portfolio_id', 'target_portfolios', 'id'),
      ('broker_position_snapshot_runs', 'portfolio_id', 'portfolios', 'id'),
      ('broker_position_snapshot_items', 'run_id', 'broker_position_snapshot_runs', 'id'),
      ('broker_position_snapshot_items', 'portfolio_id', 'portfolios', 'id'),
      ('broker_reconciliation_items', 'run_id', 'broker_reconciliation_runs', 'id'),
      ('target_buckets', 'model_id', 'target_models', 'id'),
      ('target_envelope_lines', 'model_id', 'target_models', 'id'),
      ('target_model_audit_holdings', 'model_id', 'target_models', 'id')
    ) as edges(child_table, child_column, parent_table, parent_column)
  loop
    child_regclass := to_regclass(format('public.%I', edge.child_table));
    parent_regclass := to_regclass(format('public.%I', edge.parent_table));
    if child_regclass is null or parent_regclass is null
      or not exists (
        select 1 from pg_attribute
        where attrelid = child_regclass and attname = 'owner_user_id' and not attisdropped
      )
      or not exists (
        select 1 from pg_attribute
        where attrelid = parent_regclass and attname = 'owner_user_id' and not attisdropped
      )
    then
      continue;
    end if;
    legacy_edges_checked := legacy_edges_checked + 1;
    execute format(
      'select count(*) from public.%I child join public.%I parent '
      'on child.%I = parent.%I where child.%I is not null '
      'and child.owner_user_id is distinct from parent.owner_user_id',
      edge.child_table, edge.parent_table,
      edge.child_column, edge.parent_column, edge.child_column
    ) into edge_cross_owner_count;
    legacy_cross_owner_count := legacy_cross_owner_count + edge_cross_owner_count;
    if edge_cross_owner_count > 0 then
      raise notice
        'PGA-004 preflight legacy edge=%.%->%.% cross_owner=%',
        edge.child_table, edge.child_column,
        edge.parent_table, edge.parent_column,
        edge_cross_owner_count;
    end if;
  end loop;

  if canonical_edges_checked <> 27 then
    blocker_count := blocker_count + abs(27 - canonical_edges_checked);
  end if;
  blocker_count := blocker_count + canonical_cross_owner_count + legacy_cross_owner_count;
  raise notice
    'PGA-004 preflight summary owners=% canonical_edges_checked=% canonical_cross_owner=% legacy_edges_checked=% legacy_cross_owner=% blockers=%',
    owner_count, canonical_edges_checked, canonical_cross_owner_count,
    legacy_edges_checked, legacy_cross_owner_count, blocker_count;

  if blocker_count > 0 then
    raise exception
      'PGA-004 preflight refused: blockers=% canonical_edges_checked=% canonical_cross_owner=% legacy_edges_checked=% legacy_cross_owner=%',
      blocker_count, canonical_edges_checked, canonical_cross_owner_count,
      legacy_edges_checked, legacy_cross_owner_count;
  end if;
end;
$$;

select
  table_name,
  pg_total_relation_size(format('public.%I', table_name)::regclass) as total_bytes
from information_schema.tables
where table_schema = 'public'
  and table_name = any(array[
    'portfolios', 'portfolio_positions', 'valuation_snapshots',
    'governance_targets', 'decision_journal', 'target_portfolios',
    'target_envelope_weights', 'broker_transactions',
    'broker_reconciliation_runs', 'broker_reconciliation_items',
    'broker_position_snapshot_runs', 'broker_position_snapshot_items',
    'target_models', 'target_buckets', 'target_envelope_lines',
    'target_model_audit_holdings'
  ])
order by table_name;

rollback;
