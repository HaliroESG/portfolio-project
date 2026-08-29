\set ON_ERROR_STOP on

-- Deterministic synthetic identities; this script must run only in a disposable
-- PostgreSQL 15+ database after the Family Office migrations and PGA-004 patch.
\set owner_a 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set owner_b 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

insert into public.fo_owner_allowlist (email, is_active)
values
  ('owner-a@example.invalid', true),
  ('owner-b@example.invalid', true);

insert into auth.users (id, email, raw_user_meta_data)
values
  (:'owner_a', 'owner-a@example.invalid', '{"display_name":"Owner A"}'::jsonb),
  (:'owner_b', 'owner-b@example.invalid', '{"display_name":"Owner B"}'::jsonb);

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
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);

do $$
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
end;
$$;

select set_config('request.jwt.claim.sub', :'owner_b', false);

do $$
declare
  view_name text;
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

  for view_name in
    select table_name from information_schema.views where table_schema = 'public'
  loop
    execute format('select 1 from public.%I limit 1', view_name);
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

  if has_table_privilege('authenticated', 'public.portfolios', 'SELECT') then
    raise exception 'PGA-004 legacy unscoped table remains authenticated-readable';
  end if;
end;
$$;

select 'PGA-004 PostgreSQL owner isolation tests: PASS' as result;
