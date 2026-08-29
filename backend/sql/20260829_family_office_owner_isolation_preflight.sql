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
    if row_count > 0 and owner_count <> 1 and not exists (
      select 1 from pg_attribute
      where attrelid = to_regclass(format('public.%I', object_name))
        and attname = 'owner_user_id' and not attisdropped
    ) then
      raise exception
        'PGA-004 preflight: public.% has % rows but ownership is ambiguous across % profiles',
        object_name, row_count, owner_count;
    end if;
  end loop;
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
