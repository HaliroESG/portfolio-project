#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PG_BIN="${PGA004_PG_BIN:-/opt/homebrew/opt/postgresql@15/bin}"
for executable in initdb pg_ctl createdb psql postgres; do
  if [[ ! -x "$PG_BIN/$executable" ]]; then
    printf 'BLOCKED: PostgreSQL 15+ executable missing: %s/%s\n' "$PG_BIN" "$executable" >&2
    exit 2
  fi
done

TMP_ROOT="$(mktemp -d /tmp/pga004-pg15.XXXXXX)"
PG_DATA="$TMP_ROOT/data"
PG_SOCKET="$TMP_ROOT/socket"
mkdir -p "$PG_SOCKET"

cleanup() {
  if [[ -d "$PG_DATA" ]]; then
    "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop >/dev/null 2>&1 || true
  fi
  case "$TMP_ROOT" in
    /tmp/pga004-pg15.*) rm -rf -- "$TMP_ROOT" ;;
    *) printf 'Refusing unsafe cleanup target: %s\n' "$TMP_ROOT" >&2; exit 1 ;;
  esac
}
trap cleanup EXIT

"$PG_BIN/initdb" -D "$PG_DATA" -A trust -U postgres >/dev/null
"$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-k $PG_SOCKET -h ''" -w start >/dev/null

psql_db() {
  local database="$1"
  shift
  "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$PG_SOCKET" -U postgres -d "$database" "$@"
}

bootstrap() {
  local database="$1"
  "$PG_BIN/createdb" -h "$PG_SOCKET" -U postgres "$database"
  psql_db "$database" <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end;
$$;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
SQL
  psql_db "$database" -f "$REPO_ROOT/backend/sql/20260713_02_family_office_core.sql" >/dev/null
}

apply_security_and_patch() {
  local database="$1"
  psql_db "$database" -f "$REPO_ROOT/backend/sql/20260713_03_family_office_security.sql" >/dev/null
  psql_db "$database" -f "$REPO_ROOT/backend/sql/20260713_04_family_office_truthful_overview.sql" >/dev/null
  psql_db "$database" -f "$REPO_ROOT/backend/sql/20260713_05_family_office_policy_cleanup_indexes.sql" >/dev/null
  psql_db "$database" -f "$REPO_ROOT/backend/sql/20260829_family_office_owner_isolation_preflight.sql" >/dev/null
  psql_db "$database" -f "$REPO_ROOT/backend/sql/20260829_family_office_owner_isolation.sql" >/dev/null
}

printf 'postgres_version='
"$PG_BIN/postgres" --version

bootstrap clean_graph
apply_security_and_patch clean_graph
psql_db clean_graph <<'SQL'
insert into public.fo_owner_allowlist (email, is_active)
values ('owner-a@example.invalid', true), ('owner-b@example.invalid', true);
insert into auth.users (id, email, raw_user_meta_data)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner-a@example.invalid', '{}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner-b@example.invalid', '{}');
insert into public.fo_legal_entities (id, owner_user_id, name, entity_type)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Entity A', 'PERSONAL'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Entity B', 'PERSONAL');
insert into public.fo_portfolios (id, owner_user_id, legal_entity_id, name)
values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000001', 'Portfolio A'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-4000-8000-000000000001', 'Portfolio B');
do $$
declare composite_count bigint; direct_count bigint;
begin
  select count(*) into composite_count
  from pg_constraint c
  join pg_class child on child.oid = c.conrelid
  join pg_class parent on parent.oid = c.confrelid
  join pg_namespace n on n.oid = child.relnamespace
  where c.contype = 'f' and n.nspname = 'public'
    and child.relname like 'fo\_%' escape '\'
    and parent.relname like 'fo\_%' escape '\'
    and parent.relname <> 'fo_owner_profiles'
    and (select attnum from pg_attribute where attrelid = child.oid and attname = 'owner_user_id') = any(c.conkey)
    and (select attnum from pg_attribute where attrelid = parent.oid and attname = 'owner_user_id') = any(c.confkey);
  select count(*) into direct_count
  from pg_constraint c
  join pg_class child on child.oid = c.conrelid
  join pg_class parent on parent.oid = c.confrelid
  join pg_namespace n on n.oid = child.relnamespace
  where c.contype = 'f' and n.nspname = 'public'
    and child.relname like 'fo\_%' escape '\'
    and parent.relname = 'fo_owner_profiles';
  if composite_count <> 27 or direct_count <> 22 then
    raise exception 'expected 27 composite and 22 direct owner-profile FKs, got % and %', composite_count, direct_count;
  end if;
  begin
    insert into public.fo_portfolios (owner_user_id, legal_entity_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-000000000001', 'Cross owner');
    raise exception 'clean graph accepted a cross-owner reference';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select 'PGA-004 clean canonical graph: PASS' as result;
SQL

bootstrap legacy_16_graph
psql_db legacy_16_graph -f "$REPO_ROOT/backend/tests/sql/pga004_legacy_fixture.sql" >/dev/null
apply_security_and_patch legacy_16_graph
psql_db legacy_16_graph -f "$REPO_ROOT/backend/tests/sql/pga004_owner_isolation_test.sql"
python3.11 "$REPO_ROOT/backend/tests/sql/pga004_writer_pg_test.py" \
  --psql "$PG_BIN/psql" \
  --socket "$PG_SOCKET" \
  --database legacy_16_graph

bootstrap rollback_graph
psql_db rollback_graph -f "$REPO_ROOT/backend/tests/sql/pga004_legacy_fixture.sql" >/dev/null
apply_security_and_patch rollback_graph
psql_db rollback_graph -f "$REPO_ROOT/backend/sql/20260829_family_office_owner_isolation_rollback.sql" >/dev/null
psql_db rollback_graph <<'SQL'
do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.portfolios'::regclass
      and attname = 'owner_user_id' and not attisdropped
  ) then
    raise exception 'legacy owner column remained after rollback';
  end if;
  if to_regclass('public.fo_accounts_owner_id_uq') is not null then
    raise exception 'canonical composite index remained after rollback';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fo_accounts'::regclass
      and conname = 'fo_accounts_portfolio_id_fkey'
  ) then
    raise exception 'canonical simple FK was not restored';
  end if;
  if position(
    'already has an owner'
    in pg_get_functiondef('fo_private.validate_family_office_user()'::regprocedure)
  ) = 0 then
    raise exception 'singleton guard was not restored';
  end if;
end;
$$;
select 'PGA-004 guarded post-commit rollback: PASS' as result;
SQL

bootstrap contaminated_graph
psql_db contaminated_graph <<'SQL' >/dev/null
insert into public.fo_owner_allowlist (email, is_active)
values ('owner-a@example.invalid', true), ('owner-b@example.invalid', true);
insert into auth.users (id, email, raw_user_meta_data)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner-a@example.invalid', '{}');
alter table auth.users disable trigger fo_validate_owner_before_insert;
insert into auth.users (id, email, raw_user_meta_data)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner-b@example.invalid', '{}');
alter table auth.users enable trigger fo_validate_owner_before_insert;
insert into public.fo_legal_entities (id, owner_user_id, name, entity_type)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Entity A', 'PERSONAL'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Entity B', 'PERSONAL');
insert into public.fo_portfolios (id, owner_user_id, legal_entity_id, name)
values
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-4000-8000-000000000001', 'Portfolio A'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-4000-8000-000000000001', 'Portfolio B');
insert into public.fo_institutions (id, owner_user_id, name)
values ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Institution A');
insert into public.fo_accounts (
  id, owner_user_id, portfolio_id, institution_id, external_account_id, name, envelope
) values (
  'aaaaaaaa-0000-4000-8000-000000000004',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-0000-4000-8000-000000000002',
  'aaaaaaaa-0000-4000-8000-000000000003',
  'cross-owner', 'Contaminated', 'CTO'
);
SQL
psql_db contaminated_graph -f "$REPO_ROOT/backend/sql/20260713_03_family_office_security.sql" >/dev/null
psql_db contaminated_graph -f "$REPO_ROOT/backend/sql/20260713_04_family_office_truthful_overview.sql" >/dev/null
psql_db contaminated_graph -f "$REPO_ROOT/backend/sql/20260713_05_family_office_policy_cleanup_indexes.sql" >/dev/null

set +e
psql_db contaminated_graph -f "$REPO_ROOT/backend/sql/20260829_family_office_owner_isolation_preflight.sql" >"$TMP_ROOT/contaminated-preflight.log" 2>&1
contaminated_preflight_exit=$?
set -e
if [[ "$contaminated_preflight_exit" -eq 0 ]]; then
  printf 'FAIL: contaminated preflight unexpectedly succeeded\n' >&2
  exit 1
fi
if ! rg -q 'canonical_cross_owner=1' "$TMP_ROOT/contaminated-preflight.log"; then
  printf 'FAIL: contaminated preflight did not report the canonical cross-owner count\n' >&2
  exit 1
fi
printf 'contaminated_preflight_exit=%s canonical_cross_owner=1\n' "$contaminated_preflight_exit"

set +e
psql_db contaminated_graph -f "$REPO_ROOT/backend/sql/20260829_family_office_owner_isolation.sql" >"$TMP_ROOT/contaminated.log" 2>&1
contaminated_exit=$?
set -e
if [[ "$contaminated_exit" -eq 0 ]]; then
  printf 'FAIL: contaminated migration unexpectedly succeeded\n' >&2
  exit 1
fi
printf 'contaminated_migration_exit=%s\n' "$contaminated_exit"
psql_db contaminated_graph <<'SQL'
do $$
begin
  if to_regclass('public.fo_accounts_owner_id_uq') is not null then
    raise exception 'new index was not rolled back atomically';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fo_accounts'::regclass
      and conname = 'fo_accounts_portfolio_id_fkey'
  ) then
    raise exception 'original simple FK was not restored atomically';
  end if;
  if position(
    'already has an owner'
    in pg_get_functiondef('fo_private.validate_family_office_user()'::regprocedure)
  ) = 0 then
    raise exception 'singleton owner guard was not restored atomically';
  end if;
end;
$$;
select 'PGA-004 contaminated graph atomic rollback: PASS' as result;
SQL

bootstrap legacy_preflight_contaminated
psql_db legacy_preflight_contaminated -f "$REPO_ROOT/backend/tests/sql/pga004_legacy_fixture.sql" >/dev/null
psql_db legacy_preflight_contaminated <<'SQL' >/dev/null
alter table auth.users disable trigger fo_validate_owner_before_insert;
insert into auth.users (id, email, raw_user_meta_data)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner-b@example.invalid', '{}');
alter table auth.users enable trigger fo_validate_owner_before_insert;
do $$
declare object_name text;
begin
  foreach object_name in array array[
    'portfolios', 'portfolio_positions', 'valuation_snapshots',
    'governance_targets', 'decision_journal', 'target_portfolios',
    'target_envelope_weights', 'broker_transactions',
    'broker_reconciliation_runs', 'broker_reconciliation_items',
    'broker_position_snapshot_runs', 'broker_position_snapshot_items',
    'target_models', 'target_buckets', 'target_envelope_lines',
    'target_model_audit_holdings'
  ] loop
    execute format('alter table public.%I add column owner_user_id uuid', object_name);
    execute format(
      'update public.%I set owner_user_id = %L::uuid',
      object_name, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
  end loop;
end;
$$;
update public.portfolio_positions
set owner_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
where ticker = 'AAA';
update public.broker_transactions
set owner_user_id = null;
insert into public.broker_transactions (account_id, idempotency_key, owner_user_id)
values ('account-unknown', 'txn-unknown', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
SQL
set +e
psql_db legacy_preflight_contaminated -f "$REPO_ROOT/backend/sql/20260829_family_office_owner_isolation_preflight.sql" >"$TMP_ROOT/legacy-contaminated-preflight.log" 2>&1
legacy_preflight_exit=$?
set -e
if [[ "$legacy_preflight_exit" -eq 0 ]]; then
  printf 'FAIL: legacy contaminated preflight unexpectedly succeeded\n' >&2
  exit 1
fi
if ! rg -q 'legacy_edges_checked=13 legacy_cross_owner=1' "$TMP_ROOT/legacy-contaminated-preflight.log"; then
  printf 'FAIL: legacy contaminated preflight did not report 13 edges and one cross-owner row\n' >&2
  exit 1
fi
if ! rg -q 'null_owner=1' "$TMP_ROOT/legacy-contaminated-preflight.log"; then
  printf 'FAIL: legacy contaminated preflight did not report the NULL owner row\n' >&2
  exit 1
fi
if ! rg -q 'unknown_owner=1' "$TMP_ROOT/legacy-contaminated-preflight.log"; then
  printf 'FAIL: legacy contaminated preflight did not report the unknown owner row\n' >&2
  exit 1
fi
printf 'legacy_contaminated_preflight_exit=%s legacy_edges_checked=13 legacy_cross_owner=1 null_owner=1 unknown_owner=1\n' "$legacy_preflight_exit"

printf 'cleanup_contract=ephemeral_cluster_and_exact_tmp_prefix\n'
