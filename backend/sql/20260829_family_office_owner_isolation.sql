-- PGA-004: support multiple allowlisted owners and enforce owner-consistent graphs.
-- Apply only after the 20260713 Family Office core and security migrations.

begin;

create or replace function fo_private.validate_family_office_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or not exists (
    select 1
    from public.fo_owner_allowlist allowlist
    where allowlist.email = lower(trim(new.email))
      and allowlist.is_active
  ) then
    raise exception 'This email is not authorized for the private portfolio';
  end if;

  return new;
end;
$$;

-- Every owner-scoped parent needs a composite candidate key before a child can
-- reference both the owner and the parent in one indivisible constraint.
create unique index if not exists fo_legal_entities_owner_id_uq
  on public.fo_legal_entities (owner_user_id, id);
create unique index if not exists fo_portfolios_owner_id_uq
  on public.fo_portfolios (owner_user_id, id);
create unique index if not exists fo_institutions_owner_id_uq
  on public.fo_institutions (owner_user_id, id);
create unique index if not exists fo_accounts_owner_id_uq
  on public.fo_accounts (owner_user_id, id);
create unique index if not exists fo_import_runs_owner_id_uq
  on public.fo_import_runs (owner_user_id, id);
create unique index if not exists fo_ledger_entries_owner_id_uq
  on public.fo_ledger_entries (owner_user_id, id);
create unique index if not exists fo_reconciliation_runs_owner_id_uq
  on public.fo_reconciliation_runs (owner_user_id, id);
create unique index if not exists fo_manual_holdings_owner_id_uq
  on public.fo_manual_holdings (owner_user_id, id);
create unique index if not exists fo_ips_policies_owner_id_uq
  on public.fo_ips_policies (owner_user_id, id);
create unique index if not exists fo_decisions_owner_id_uq
  on public.fo_decisions (owner_user_id, id);
create unique index if not exists fo_order_drafts_owner_id_uq
  on public.fo_order_drafts (owner_user_id, id);

alter table public.fo_portfolios
  drop constraint if exists fo_portfolios_legal_entity_id_fkey,
  drop constraint if exists fo_portfolios_owner_legal_entity_fkey,
  add constraint fo_portfolios_owner_legal_entity_fkey
    foreign key (owner_user_id, legal_entity_id)
    references public.fo_legal_entities (owner_user_id, id);

alter table public.fo_accounts
  drop constraint if exists fo_accounts_portfolio_id_fkey,
  drop constraint if exists fo_accounts_institution_id_fkey,
  drop constraint if exists fo_accounts_owner_portfolio_fkey,
  drop constraint if exists fo_accounts_owner_institution_fkey,
  add constraint fo_accounts_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id),
  add constraint fo_accounts_owner_institution_fkey
    foreign key (owner_user_id, institution_id)
    references public.fo_institutions (owner_user_id, id);

alter table public.fo_import_runs
  drop constraint if exists fo_import_runs_account_id_fkey,
  drop constraint if exists fo_import_runs_owner_account_fkey,
  add constraint fo_import_runs_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id);

alter table public.fo_ledger_entries
  drop constraint if exists fo_ledger_entries_account_id_fkey,
  drop constraint if exists fo_ledger_entries_import_run_id_fkey,
  drop constraint if exists fo_ledger_entries_reversal_of_id_fkey,
  drop constraint if exists fo_ledger_entries_owner_account_fkey,
  drop constraint if exists fo_ledger_entries_owner_import_run_fkey,
  drop constraint if exists fo_ledger_entries_owner_reversal_fkey,
  add constraint fo_ledger_entries_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id),
  add constraint fo_ledger_entries_owner_import_run_fkey
    foreign key (owner_user_id, import_run_id)
    references public.fo_import_runs (owner_user_id, id),
  add constraint fo_ledger_entries_owner_reversal_fkey
    foreign key (owner_user_id, reversal_of_id)
    references public.fo_ledger_entries (owner_user_id, id);

alter table public.fo_position_snapshots
  drop constraint if exists fo_position_snapshots_portfolio_id_fkey,
  drop constraint if exists fo_position_snapshots_account_id_fkey,
  drop constraint if exists fo_position_snapshots_owner_portfolio_fkey,
  drop constraint if exists fo_position_snapshots_owner_account_fkey,
  add constraint fo_position_snapshots_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id),
  add constraint fo_position_snapshots_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id);

alter table public.fo_cash_balances_daily
  drop constraint if exists fo_cash_balances_daily_portfolio_id_fkey,
  drop constraint if exists fo_cash_balances_daily_account_id_fkey,
  drop constraint if exists fo_cash_balances_owner_portfolio_fkey,
  drop constraint if exists fo_cash_balances_owner_account_fkey,
  add constraint fo_cash_balances_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id),
  add constraint fo_cash_balances_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id);

alter table public.fo_reconciliation_runs
  drop constraint if exists fo_reconciliation_runs_account_id_fkey,
  drop constraint if exists fo_reconciliation_runs_import_run_id_fkey,
  drop constraint if exists fo_reconciliation_runs_owner_account_fkey,
  drop constraint if exists fo_reconciliation_runs_owner_import_run_fkey,
  add constraint fo_reconciliation_runs_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id),
  add constraint fo_reconciliation_runs_owner_import_run_fkey
    foreign key (owner_user_id, import_run_id)
    references public.fo_import_runs (owner_user_id, id);

alter table public.fo_reconciliation_items
  drop constraint if exists fo_reconciliation_items_run_id_fkey,
  drop constraint if exists fo_reconciliation_items_owner_run_fkey,
  add constraint fo_reconciliation_items_owner_run_fkey
    foreign key (owner_user_id, run_id)
    references public.fo_reconciliation_runs (owner_user_id, id)
    on delete cascade;

alter table public.fo_manual_holdings
  drop constraint if exists fo_manual_holdings_portfolio_id_fkey,
  drop constraint if exists fo_manual_holdings_owner_portfolio_fkey,
  add constraint fo_manual_holdings_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

alter table public.fo_manual_valuations
  drop constraint if exists fo_manual_valuations_holding_id_fkey,
  drop constraint if exists fo_manual_valuations_owner_holding_fkey,
  add constraint fo_manual_valuations_owner_holding_fkey
    foreign key (owner_user_id, holding_id)
    references public.fo_manual_holdings (owner_user_id, id)
    on delete cascade;

alter table public.fo_performance_daily
  drop constraint if exists fo_performance_daily_portfolio_id_fkey,
  drop constraint if exists fo_performance_daily_owner_portfolio_fkey,
  add constraint fo_performance_daily_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

alter table public.fo_risk_daily
  drop constraint if exists fo_risk_daily_portfolio_id_fkey,
  drop constraint if exists fo_risk_daily_owner_portfolio_fkey,
  add constraint fo_risk_daily_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

alter table public.fo_ips_policies
  drop constraint if exists fo_ips_policies_portfolio_id_fkey,
  drop constraint if exists fo_ips_policies_owner_portfolio_fkey,
  add constraint fo_ips_policies_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

alter table public.fo_allocation_targets
  drop constraint if exists fo_allocation_targets_policy_id_fkey,
  drop constraint if exists fo_allocation_targets_owner_policy_fkey,
  add constraint fo_allocation_targets_owner_policy_fkey
    foreign key (owner_user_id, policy_id)
    references public.fo_ips_policies (owner_user_id, id)
    on delete cascade;

alter table public.fo_exceptions
  drop constraint if exists fo_exceptions_portfolio_id_fkey,
  drop constraint if exists fo_exceptions_account_id_fkey,
  drop constraint if exists fo_exceptions_owner_portfolio_fkey,
  drop constraint if exists fo_exceptions_owner_account_fkey,
  add constraint fo_exceptions_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id),
  add constraint fo_exceptions_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id);

alter table public.fo_decisions
  drop constraint if exists fo_decisions_portfolio_id_fkey,
  drop constraint if exists fo_decisions_owner_portfolio_fkey,
  add constraint fo_decisions_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

alter table public.fo_order_drafts
  drop constraint if exists fo_order_drafts_decision_id_fkey,
  drop constraint if exists fo_order_drafts_account_id_fkey,
  drop constraint if exists fo_order_drafts_owner_decision_fkey,
  drop constraint if exists fo_order_drafts_owner_account_fkey,
  add constraint fo_order_drafts_owner_decision_fkey
    foreign key (owner_user_id, decision_id)
    references public.fo_decisions (owner_user_id, id)
    on delete cascade,
  add constraint fo_order_drafts_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id);

alter table public.fo_order_lines
  drop constraint if exists fo_order_lines_order_draft_id_fkey,
  drop constraint if exists fo_order_lines_owner_order_draft_fkey,
  add constraint fo_order_lines_owner_order_draft_fkey
    foreign key (owner_user_id, order_draft_id)
    references public.fo_order_drafts (owner_user_id, id)
    on delete cascade;

alter table public.fo_monthly_closes
  drop constraint if exists fo_monthly_closes_portfolio_id_fkey,
  drop constraint if exists fo_monthly_closes_owner_portfolio_fkey,
  add constraint fo_monthly_closes_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

-- The 16 legacy operational tables contain portfolio, transaction, valuation,
-- governance or target data. None is reference data: all 16 are private. Give
-- them the same explicit owner boundary as the canonical fo_* graph so the
-- still-active readers remain usable without reopening the former global read.
create or replace function fo_private.assign_legacy_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_owner uuid;
  parent_value text;
begin
  resolved_owner := new.owner_user_id;

  if resolved_owner is null and coalesce(array_length(tg_argv, 1), 0) = 3 then
    parent_value := to_jsonb(new) ->> tg_argv[1];
    if parent_value is not null then
      execute format(
        'select owner_user_id from public.%I where %I::text = $1',
        tg_argv[0], tg_argv[2]
      )
      into resolved_owner
      using parent_value;
    end if;
  end if;

  if resolved_owner is null then
    resolved_owner := auth.uid();
  end if;

  if resolved_owner is null then
    select min(profile.user_id::text)::uuid
    into resolved_owner
    from public.fo_owner_profiles profile
    having count(*) = 1;
  end if;

  if resolved_owner is null then
    raise exception
      'owner_user_id is required for legacy table % when more than one owner exists',
      tg_table_name;
  end if;

  new.owner_user_id := resolved_owner;
  return new;
end;
$$;

do $$
declare
  object_name text;
  owner_count bigint;
  sole_owner uuid;
  unowned_count bigint;
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
  select count(*), min(user_id::text)::uuid
  into owner_count, sole_owner
  from public.fo_owner_profiles;

  foreach object_name in array legacy_tables loop
    if to_regclass(format('public.%I', object_name)) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists owner_user_id uuid',
      object_name
    );
    execute format(
      'select count(*) from public.%I where owner_user_id is null',
      object_name
    ) into unowned_count;

    if unowned_count > 0 and owner_count <> 1 then
      raise exception
        'cannot deterministically assign % unowned rows in public.% with % owner profiles',
        unowned_count, object_name, owner_count;
    end if;
    if unowned_count > 0 then
      execute format(
        'update public.%I set owner_user_id = $1 where owner_user_id is null',
        object_name
      ) using sole_owner;
    end if;

    execute format(
      'alter table public.%I alter column owner_user_id set not null',
      object_name
    );
    execute format(
      'alter table public.%I drop constraint if exists %I, '
      'add constraint %I foreign key (owner_user_id) '
      'references public.fo_owner_profiles(user_id) on delete cascade',
      object_name,
      object_name || '_owner_user_id_fkey',
      object_name || '_owner_user_id_fkey'
    );
    execute format(
      'create index if not exists %I on public.%I (owner_user_id)',
      object_name || '_owner_user_id_idx', object_name
    );
    if exists (
      select 1
      from pg_attribute
      where attrelid = to_regclass(format('public.%I', object_name))
        and attname = 'id'
        and not attisdropped
    ) then
      execute format(
        'create unique index if not exists %I on public.%I (owner_user_id, id)',
        object_name || '_owner_id_uq', object_name
      );
    end if;

    execute format('drop policy if exists fo_legacy_owner_read on public.%I', object_name);
    execute format('drop policy if exists fo_legacy_private_read on public.%I', object_name);
    execute format(
      'create policy fo_legacy_private_read on public.%I for select to authenticated '
      'using ((select auth.uid()) = owner_user_id)',
      object_name
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', object_name);
    execute format('grant select on table public.%I to authenticated', object_name);
  end loop;
end;
$$;

-- Active legacy root writers use owner-composite conflict targets. Their
-- idempotency values are also owner-namespaced, so older global unique indexes
-- remain compatible while the write contract becomes explicitly tenant-safe.
do $$
declare
  table_regclass regclass;
begin
  table_regclass := to_regclass('public.broker_transactions');
  if table_regclass is not null
    and exists (
      select 1 from pg_attribute
      where attrelid = table_regclass
        and attname = 'idempotency_key' and not attisdropped
    )
  then
    create unique index if not exists broker_transactions_owner_idempotency_uq
      on public.broker_transactions (owner_user_id, idempotency_key);
  end if;

  table_regclass := to_regclass('public.broker_reconciliation_runs');
  if table_regclass is not null
    and exists (
      select 1 from pg_attribute
      where attrelid = table_regclass
        and attname = 'idempotency_key' and not attisdropped
    )
  then
    create unique index if not exists broker_reconciliation_runs_owner_idempotency_uq
      on public.broker_reconciliation_runs (owner_user_id, idempotency_key);
  end if;
end;
$$;

-- Every known legacy child-parent edge is owner-composite. The catalog-driven
-- guards let this migration cover older deployments where optional legacy
-- tables/columns are absent, while refusing a present contaminated edge.
do $$
declare
  edge record;
  child_regclass regclass;
  parent_regclass regclass;
  constraint_name text;
begin
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
        where attrelid = child_regclass and attname = edge.child_column and not attisdropped
      )
      or not exists (
        select 1 from pg_attribute
        where attrelid = parent_regclass and attname = edge.parent_column and not attisdropped
      )
    then
      continue;
    end if;

    constraint_name := edge.child_table || '_owner_' || edge.child_column || '_fkey';
    execute format(
      'alter table public.%I drop constraint if exists %I, '
      'add constraint %I foreign key (owner_user_id, %I) '
      'references public.%I (owner_user_id, %I)',
      edge.child_table, constraint_name, constraint_name,
      edge.child_column, edge.parent_table, edge.parent_column
    );
  end loop;
end;
$$;

-- Existing service-role writers can continue in a single-owner installation.
-- With multiple owners, child rows derive ownership from their parent; root
-- rows must carry owner_user_id explicitly and ambiguous writes fail closed.
do $$
declare
  trigger_row record;
  table_regclass regclass;
begin
  for trigger_row in
    select * from (values
      ('portfolios', null, null, null),
      ('portfolio_positions', 'portfolios', 'portfolio_id', 'id'),
      ('valuation_snapshots', 'portfolios', 'portfolio_id', 'id'),
      ('governance_targets', 'portfolios', 'portfolio_id', 'id'),
      ('decision_journal', 'portfolios', 'portfolio_id', 'id'),
      ('target_portfolios', 'portfolios', 'portfolio_id', 'id'),
      ('target_envelope_weights', 'target_portfolios', 'target_portfolio_id', 'id'),
      ('broker_transactions', null, null, null),
      ('broker_reconciliation_runs', null, null, null),
      ('broker_reconciliation_items', 'broker_reconciliation_runs', 'run_id', 'id'),
      ('broker_position_snapshot_runs', 'portfolios', 'portfolio_id', 'id'),
      ('broker_position_snapshot_items', 'broker_position_snapshot_runs', 'run_id', 'id'),
      ('target_models', null, null, null),
      ('target_buckets', 'target_models', 'model_id', 'id'),
      ('target_envelope_lines', 'target_models', 'model_id', 'id'),
      ('target_model_audit_holdings', 'target_models', 'model_id', 'id')
    ) as triggers(table_name, parent_table, child_column, parent_column)
  loop
    table_regclass := to_regclass(format('public.%I', trigger_row.table_name));
    if table_regclass is null then
      continue;
    end if;
    execute format(
      'drop trigger if exists fo_assign_legacy_owner on public.%I',
      trigger_row.table_name
    );
    if trigger_row.parent_table is null then
      execute format(
        'create trigger fo_assign_legacy_owner before insert or update of owner_user_id '
        'on public.%I for each row execute function fo_private.assign_legacy_owner()',
        trigger_row.table_name
      );
    else
      execute format(
        'create trigger fo_assign_legacy_owner before insert or update of owner_user_id '
        'on public.%I for each row execute function fo_private.assign_legacy_owner(%L, %L, %L)',
        trigger_row.table_name, trigger_row.parent_table,
        trigger_row.child_column, trigger_row.parent_column
      );
    end if;
  end loop;
end;
$$;

commit;
