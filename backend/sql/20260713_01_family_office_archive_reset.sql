-- Family Office reset: archive the current operational book before rebuilding it.
-- Market, macro, price history, screeners and backtests are intentionally preserved.

create schema if not exists family_office_archive;
revoke all on schema family_office_archive from public, anon, authenticated;

create table if not exists family_office_archive.pre_reset_rows (
  id bigint generated always as identity primary key,
  archived_at timestamptz not null default now(),
  source_table text not null,
  row_data jsonb not null
);

create table if not exists family_office_archive.reset_runs (
  id uuid primary key default gen_random_uuid(),
  reset_key text not null unique,
  archived_at timestamptz not null default now(),
  archived_counts jsonb not null default '{}'::jsonb
);

do $$
declare
  table_name text;
  archived_count bigint;
  counts jsonb := '{}'::jsonb;
  v_reset_key constant text := 'family-office-reset-2026-07-13';
  operational_tables constant text[] := array[
    'broker_reconciliation_items',
    'broker_reconciliation_runs',
    'broker_position_snapshot_items',
    'broker_position_snapshot_runs',
    'broker_transactions',
    'decision_journal',
    'governance_targets',
    'portfolio_positions',
    'valuation_snapshots',
    'target_envelope_weights',
    'target_model_audit_holdings',
    'target_envelope_lines',
    'target_buckets',
    'target_models',
    'target_portfolios',
    'portfolios'
  ];
begin
  if exists (
    select 1
    from family_office_archive.reset_runs
    where reset_runs.reset_key = v_reset_key
  ) then
    return;
  end if;

  foreach table_name in array operational_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format(
      'insert into family_office_archive.pre_reset_rows (source_table, row_data) '
      'select %L, to_jsonb(source_row) from public.%I source_row',
      table_name,
      table_name
    );
    get diagnostics archived_count = row_count;
    counts := counts || jsonb_build_object(table_name, archived_count);
  end loop;

  insert into family_office_archive.reset_runs (reset_key, archived_counts)
  values (v_reset_key, counts);

  -- Child tables are listed first. CASCADE is deliberately avoided so that
  -- research and market data can never be removed by this reset.
  foreach table_name in array operational_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;
    execute format('delete from public.%I', table_name);
  end loop;
end;
$$;

revoke all on all tables in schema family_office_archive from public, anon, authenticated;
revoke all on all sequences in schema family_office_archive from public, anon, authenticated;
