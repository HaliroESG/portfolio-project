\set ON_ERROR_STOP on

-- Deterministic synthetic identities; this script must run only in a disposable
-- PostgreSQL 15+ database after the Family Office migrations and PGA-004 patch.
\set owner_a 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set owner_b 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

insert into auth.users (id, email, raw_user_meta_data)
values (:'owner_b', 'owner-b@example.invalid', '{"display_name":"Owner B"}'::jsonb);

do $$
begin
  if (select count(*) from public.fo_owner_profiles) <> 2 then
    raise exception 'PGA-004 expected two supported owner profiles';
  end if;
end;
$$;

insert into public.fo_legal_entities (id, owner_user_id, name, entity_type)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', :'owner_a', 'Entity A', 'PERSONAL'),
  ('bbbbbbbb-0000-4000-8000-000000000001', :'owner_b', 'Entity B', 'PERSONAL');

insert into public.fo_portfolios (id, owner_user_id, legal_entity_id, name)
values
  ('aaaaaaaa-0000-4000-8000-000000000002', :'owner_a', 'aaaaaaaa-0000-4000-8000-000000000001', 'Portfolio A'),
  ('bbbbbbbb-0000-4000-8000-000000000002', :'owner_b', 'bbbbbbbb-0000-4000-8000-000000000001', 'Portfolio B');

insert into public.fo_institutions (id, owner_user_id, name)
values
  ('aaaaaaaa-0000-4000-8000-000000000003', :'owner_a', 'Institution A'),
  ('bbbbbbbb-0000-4000-8000-000000000003', :'owner_b', 'Institution B');

insert into public.fo_accounts (
  id, owner_user_id, portfolio_id, institution_id, external_account_id, name, envelope
)
values
  (
    'aaaaaaaa-0000-4000-8000-000000000004', :'owner_a',
    'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003',
    'account-a', 'Account A', 'CTO'
  ),
  (
    'bbbbbbbb-0000-4000-8000-000000000004', :'owner_b',
    'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000003',
    'account-b', 'Account B', 'CTO'
  );

-- The legacy graph existed for A before the migration. Insert a complete B
-- graph after the migration: root rows carry B explicitly, while child rows
-- intentionally omit owner_user_id so the deterministic parent derivation is
-- exercised.
insert into public.portfolios (id, name, owner_user_id)
values ('legacy-b', 'Legacy B', :'owner_b');
insert into public.portfolio_positions (portfolio_id, ticker, name)
values ('legacy-b', 'BBB', 'Position B');
insert into public.valuation_snapshots (portfolio_id, coverage_pct)
values ('legacy-b', 92);
insert into public.governance_targets (portfolio_id, asset_class, target_pct, tolerance_band)
values ('legacy-b', 'Equity', 65, 4);
insert into public.decision_journal (portfolio_id, title)
values ('legacy-b', 'Decision B');
insert into public.target_portfolios (id, portfolio_id, name)
values ('target-b', 'legacy-b', 'Target B');
insert into public.target_envelope_weights (target_portfolio_id, envelope, target_weight_pct)
values ('target-b', 'CTO', 50);
insert into public.broker_transactions (account_id, idempotency_key, owner_user_id)
values ('account-b', 'txn-b', :'owner_b');
insert into public.broker_reconciliation_runs (id, account_id, owner_user_id)
values ('bbbbbbbb-1000-4000-8000-000000000001', 'account-b', :'owner_b');
insert into public.broker_reconciliation_items (run_id)
values ('bbbbbbbb-1000-4000-8000-000000000001');
insert into public.broker_position_snapshot_runs (id, portfolio_id, account_id)
values ('bbbbbbbb-2000-4000-8000-000000000001', 'legacy-b', 'account-b');
insert into public.broker_position_snapshot_items (run_id, portfolio_id)
values ('bbbbbbbb-2000-4000-8000-000000000001', 'legacy-b');
insert into public.target_models (id, portfolio_scope, model_name, is_active, owner_user_id)
values ('model-b', 'PRO', 'Model B', true, :'owner_b');
insert into public.target_buckets (model_id, bucket_key)
values ('model-b', 'bonds');
insert into public.target_envelope_lines (model_id, envelope)
values ('model-b', 'CTO');
insert into public.target_model_audit_holdings (model_id, instrument)
values ('model-b', 'BBB');

do $$
begin
  begin
    insert into public.fo_accounts (
      id, owner_user_id, portfolio_id, institution_id, external_account_id, name, envelope
    ) values (
      'aaaaaaaa-0000-4000-8000-000000000005',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-0000-4000-8000-000000000002',
      'aaaaaaaa-0000-4000-8000-000000000003',
      'cross-owner-account', 'Cross owner must fail', 'CTO'
    );
    raise exception 'PGA-004 cross-owner account insert was accepted';
  exception
    when foreign_key_violation then null;
  end;

  begin
    insert into public.fo_manual_holdings (
      id, owner_user_id, portfolio_id, holding_kind, asset_type, name, currency,
      valuation_frequency
    ) values (
      'aaaaaaaa-0000-4000-8000-000000000006',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-0000-4000-8000-000000000002',
      'ASSET', 'OTHER', 'Cross owner holding must fail', 'EUR', 'ANNUAL'
    );
    raise exception 'PGA-004 cross-owner holding insert was accepted';
  exception
    when foreign_key_violation then null;
  end;
end;
$$;

do $$
declare
  unsafe_owner_fk_count integer;
  owner_composite_fk_count integer;
  owner_profile_fk_count integer;
begin
  select count(*)
  into unsafe_owner_fk_count
  from pg_constraint constraint_row
  join pg_class child_table on child_table.oid = constraint_row.conrelid
  join pg_namespace child_schema on child_schema.oid = child_table.relnamespace
  join pg_class parent_table on parent_table.oid = constraint_row.confrelid
  where constraint_row.contype = 'f'
    and child_schema.nspname = 'public'
    and child_table.relname like 'fo\_%' escape '\'
    and parent_table.relname like 'fo\_%' escape '\'
    and parent_table.relname <> 'fo_owner_profiles'
    and exists (
      select 1 from pg_attribute
      where attrelid = child_table.oid and attname = 'owner_user_id' and not attisdropped
    )
    and exists (
      select 1 from pg_attribute
      where attrelid = parent_table.oid and attname = 'owner_user_id' and not attisdropped
    )
    and not (
      (select attnum from pg_attribute where attrelid = child_table.oid and attname = 'owner_user_id') = any(constraint_row.conkey)
      and
      (select attnum from pg_attribute where attrelid = parent_table.oid and attname = 'owner_user_id') = any(constraint_row.confkey)
    );

  if unsafe_owner_fk_count <> 0 then
    raise exception 'PGA-004 found % owner-scoped foreign keys without composite ownership', unsafe_owner_fk_count;
  end if;

  select count(*) into owner_composite_fk_count
  from pg_constraint constraint_row
  join pg_class child_table on child_table.oid = constraint_row.conrelid
  join pg_namespace child_schema on child_schema.oid = child_table.relnamespace
  join pg_class parent_table on parent_table.oid = constraint_row.confrelid
  where constraint_row.contype = 'f'
    and child_schema.nspname = 'public'
    and child_table.relname like 'fo\_%' escape '\'
    and parent_table.relname like 'fo\_%' escape '\'
    and parent_table.relname <> 'fo_owner_profiles'
    and (select attnum from pg_attribute where attrelid = child_table.oid and attname = 'owner_user_id') = any(constraint_row.conkey)
    and (select attnum from pg_attribute where attrelid = parent_table.oid and attname = 'owner_user_id') = any(constraint_row.confkey);

  select count(*) into owner_profile_fk_count
  from pg_constraint constraint_row
  join pg_class child_table on child_table.oid = constraint_row.conrelid
  join pg_namespace child_schema on child_schema.oid = child_table.relnamespace
  join pg_class parent_table on parent_table.oid = constraint_row.confrelid
  where constraint_row.contype = 'f'
    and child_schema.nspname = 'public'
    and child_table.relname like 'fo\_%' escape '\'
    and parent_table.relname = 'fo_owner_profiles';

  if owner_composite_fk_count <> 27 then
    raise exception 'PGA-004 expected 27 canonical owner-composite FKs, found %', owner_composite_fk_count;
  end if;
  if owner_profile_fk_count <> 22 then
    raise exception 'PGA-004 expected 22 canonical direct owner-profile FKs, found %', owner_profile_fk_count;
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.portfolio_positions (portfolio_id, ticker, name, owner_user_id)
    values (
      'legacy-b', 'CROSS', 'Cross owner legacy position',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
    raise exception 'PGA-004 legacy cross-owner portfolio reference was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.target_buckets (model_id, bucket_key, owner_user_id)
    values (
      'model-b', 'cross-owner',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
    raise exception 'PGA-004 legacy cross-owner target model reference was accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);

do $$
declare
  object_name text;
  visible_count bigint;
begin
  if (select count(*) from public.fo_owner_profiles) <> 1 then
    raise exception 'Owner A profile RLS isolation failed';
  end if;
  if (select count(*) from public.fo_portfolios) <> 1 then
    raise exception 'Owner A portfolio RLS isolation failed';
  end if;
  if exists (
    select 1 from public.fo_portfolios
    where owner_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) then
    raise exception 'Owner A can read Owner B portfolio';
  end if;

  for object_name in select unnest(array[
    'portfolios', 'portfolio_positions', 'valuation_snapshots',
    'governance_targets', 'decision_journal', 'target_portfolios',
    'target_envelope_weights', 'broker_transactions',
    'broker_reconciliation_runs', 'broker_reconciliation_items',
    'broker_position_snapshot_runs', 'broker_position_snapshot_items',
    'target_models', 'target_buckets', 'target_envelope_lines',
    'target_model_audit_holdings'
  ]) loop
    execute format('select count(*) from public.%I', object_name) into visible_count;
    if visible_count <> 1 then
      raise exception 'Owner A expected exactly one visible row in %, found %', object_name, visible_count;
    end if;
    execute format(
      'select count(*) from public.%I where owner_user_id <> $1', object_name
    ) into visible_count using 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
    if visible_count <> 0 then
      raise exception 'Owner A saw a foreign row in %', object_name;
    end if;
  end loop;

  if (select count(*) from public.legacy_portfolio_rows) <> 1
    or exists (select 1 from public.legacy_portfolio_rows where portfolio_id = 'legacy-b') then
    raise exception 'Owner A legacy security-invoker view isolation failed';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', :'owner_b', false);

do $$
declare
  view_name text;
  object_name text;
  visible_count bigint;
begin
  if (select count(*) from public.fo_owner_profiles) <> 1 then
    raise exception 'Owner B profile RLS isolation failed';
  end if;
  if (select count(*) from public.fo_portfolios) <> 1 then
    raise exception 'Owner B portfolio RLS isolation failed';
  end if;
  if exists (
    select 1 from public.fo_portfolios
    where owner_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) then
    raise exception 'Owner B can read Owner A portfolio';
  end if;

  for object_name in select unnest(array[
    'portfolios', 'portfolio_positions', 'valuation_snapshots',
    'governance_targets', 'decision_journal', 'target_portfolios',
    'target_envelope_weights', 'broker_transactions',
    'broker_reconciliation_runs', 'broker_reconciliation_items',
    'broker_position_snapshot_runs', 'broker_position_snapshot_items',
    'target_models', 'target_buckets', 'target_envelope_lines',
    'target_model_audit_holdings'
  ]) loop
    execute format('select count(*) from public.%I', object_name) into visible_count;
    if visible_count <> 1 then
      raise exception 'Owner B expected exactly one visible row in %, found %', object_name, visible_count;
    end if;
    execute format(
      'select count(*) from public.%I where owner_user_id <> $1', object_name
    ) into visible_count using 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid;
    if visible_count <> 0 then
      raise exception 'Owner B saw a foreign row in %', object_name;
    end if;
  end loop;

  if (select count(*) from public.legacy_portfolio_rows) <> 1
    or exists (select 1 from public.legacy_portfolio_rows where portfolio_id = 'legacy-a') then
    raise exception 'Owner B legacy security-invoker view isolation failed';
  end if;

  for view_name in
    select table_name from information_schema.views where table_schema = 'public'
  loop
    execute format('select 1 from public.%I limit 1', view_name);
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = view_name
        and column_name = 'owner_user_id'
    ) then
      execute format(
        'select count(*) from public.%I where owner_user_id <> $1', view_name
      ) into visible_count using 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid;
      if visible_count <> 0 then
        raise exception 'Owner B saw Owner A through view %', view_name;
      end if;
    end if;
  end loop;
end;
$$;

reset role;

do $$
declare
  table_count integer;
begin
  select count(*) into table_count
  from pg_class table_row
  join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
  where schema_row.nspname = 'public'
    and table_row.relkind in ('r', 'p')
    and not table_row.relrowsecurity;
  if table_count <> 0 then
    raise exception 'PGA-004 found % public tables without RLS', table_count;
  end if;

  select count(*) into table_count
  from pg_class table_row
  join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
  where schema_row.nspname = 'public'
    and table_row.relkind in ('r', 'p')
    and has_table_privilege('anon', table_row.oid, 'SELECT');
  if table_count <> 0 then
    raise exception 'PGA-004 found % anon-readable public tables', table_count;
  end if;

  select count(*) into table_count
  from pg_class table_row
  join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
  where schema_row.nspname = 'public'
    and table_row.relkind in ('r', 'p')
    and (
      has_table_privilege('authenticated', table_row.oid, 'INSERT')
      or has_table_privilege('authenticated', table_row.oid, 'UPDATE')
      or has_table_privilege('authenticated', table_row.oid, 'DELETE')
    );
  if table_count <> 0 then
    raise exception 'PGA-004 found % authenticated-writable public tables', table_count;
  end if;

  if not has_table_privilege('authenticated', 'public.portfolios', 'SELECT') then
    raise exception 'PGA-004 owner-scoped legacy table is no longer readable';
  end if;
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.portfolios'::regclass
      and polname = 'fo_legacy_private_read'
  ) then
    raise exception 'PGA-004 owner-scoped legacy policy missing';
  end if;
end;
$$;

select 'PGA-004 PostgreSQL owner isolation tests: PASS' as result;
