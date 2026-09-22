-- Local additive contract for approved PERSO/PRO target models.
-- This migration is intentionally deployment-neutral: applying it remains a separate governed action.

alter table if exists public.target_models
  add column if not exists allocation_contract_version text null,
  add column if not exists reserve_floor_eur numeric null,
  add column if not exists reserve_excluded_from_risky_allocation boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'target_models_reserve_floor_non_negative'
      and conrelid = 'public.target_models'::regclass
  ) then
    alter table public.target_models
      add constraint target_models_reserve_floor_non_negative
      check (reserve_floor_eur is null or reserve_floor_eur >= 0);
  end if;
end $$;

create table if not exists public.target_sleeve_allocations (
  id bigserial primary key,
  model_id text not null references public.target_models(id) on delete cascade,
  portfolio_scope text not null check (portfolio_scope in ('PERSO', 'PRO')),
  sleeve_key text not null check (sleeve_key in ('CORE', 'SATELLITE')),
  component_label text not null,
  bucket_key text not null,
  bucket_label text not null,
  target_weight_pct numeric not null check (target_weight_pct >= 0 and target_weight_pct <= 100),
  instrument_policy text null,
  activation_status text not null default 'UNKNOWN',
  source_sheet text null,
  source_row integer null,
  updated_at timestamptz not null default now()
);

create unique index if not exists target_sleeve_allocations_model_sleeve_bucket_uq
  on public.target_sleeve_allocations (model_id, sleeve_key, bucket_key);

create index if not exists target_sleeve_allocations_model_idx
  on public.target_sleeve_allocations (model_id, sleeve_key, source_row);

alter table public.target_sleeve_allocations enable row level security;

drop policy if exists target_sleeve_allocations_read on public.target_sleeve_allocations;
create policy target_sleeve_allocations_read on public.target_sleeve_allocations
  for select to authenticated using (true);

drop policy if exists target_sleeve_allocations_service_role_write on public.target_sleeve_allocations;
create policy target_sleeve_allocations_service_role_write on public.target_sleeve_allocations
  for all to service_role using (true) with check (true);

revoke all on public.target_sleeve_allocations from public, anon;
grant select on public.target_sleeve_allocations to authenticated;
grant select, insert, update, delete on public.target_sleeve_allocations to service_role;
grant usage, select on sequence public.target_sleeve_allocations_id_seq to service_role;

create or replace function public.apply_target_model_v1(
  p_model jsonb,
  p_buckets jsonb,
  p_sleeve_allocations jsonb,
  p_envelope_lines jsonb,
  p_audit_holdings jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_model_id text := p_model ->> 'id';
  v_scope text := p_model ->> 'portfolio_scope';
  v_bucket_count integer;
  v_bucket_total numeric;
  v_crypto_count integer;
  v_crypto_ready_count integer;
  v_sleeve_count integer;
  v_approved_sleeve_count integer;
  v_core_total numeric;
  v_satellite_total numeric;
  v_aligned_bucket_count integer;
  v_misaligned_bucket_count integer;
  v_invalid_child_count integer;
  v_invalid_bucket_count integer;
  v_invalid_envelope_count integer;
  v_invalid_envelope_total_count integer;
begin
  if jsonb_typeof(p_model) is distinct from 'object'
    or jsonb_typeof(p_buckets) is distinct from 'array'
    or jsonb_typeof(p_sleeve_allocations) is distinct from 'array'
    or jsonb_typeof(p_envelope_lines) is distinct from 'array'
    or jsonb_typeof(p_audit_holdings) is distinct from 'array'
  then
    raise exception 'allocation contract RPC payload shape is invalid';
  end if;
  if coalesce(v_model_id, '') = '' or v_scope is null or v_scope not in ('PERSO', 'PRO') then
    raise exception 'allocation contract model identity is invalid';
  end if;
  if p_model ->> 'allocation_contract_version' is distinct from 'allocation_contracts_v1'
    or p_model ->> 'status' is distinct from 'READY'
    or coalesce((p_model ->> 'is_active')::boolean, false) is not true
  then
    raise exception 'allocation contract model is not READY for v1 activation';
  end if;

  select count(*)
  into v_invalid_child_count
  from (
    select model_id, portfolio_scope
    from jsonb_to_recordset(p_buckets) as x(model_id text, portfolio_scope text)
    union all
    select model_id, portfolio_scope
    from jsonb_to_recordset(p_sleeve_allocations) as x(model_id text, portfolio_scope text)
    union all
    select model_id, portfolio_scope
    from jsonb_to_recordset(p_envelope_lines) as x(model_id text, portfolio_scope text)
    union all
    select model_id, portfolio_scope
    from jsonb_to_recordset(p_audit_holdings) as x(model_id text, portfolio_scope text)
  ) child
  where child.model_id is distinct from v_model_id
    or child.portfolio_scope is distinct from v_scope;
  if v_invalid_child_count > 0 then
    raise exception 'allocation contract child identity does not match its model';
  end if;

  select
    count(*),
    coalesce(sum(target_weight_pct), 0),
    count(*) filter (where bucket_key = 'crypto'),
    count(*) filter (
      where bucket_key = 'crypto'
        and abs(target_weight_pct - 2) <= 0.05
        and lower_band_pct is not null
        and abs(lower_band_pct) <= 0.05
        and upper_band_pct is not null
        and abs(upper_band_pct - 4) <= 0.05
    )
  into v_bucket_count, v_bucket_total, v_crypto_count, v_crypto_ready_count
  from jsonb_to_recordset(p_buckets) as x(
    bucket_key text,
    target_weight_pct numeric,
    lower_band_pct numeric,
    upper_band_pct numeric
  );
  select count(*)
  into v_invalid_bucket_count
  from jsonb_to_recordset(p_buckets) as x(
    target_weight_pct numeric,
    lower_band_pct numeric,
    upper_band_pct numeric
  )
  where target_weight_pct is null
    or target_weight_pct::text in ('NaN', 'Infinity', '-Infinity')
    or target_weight_pct < 0
    or target_weight_pct > 100
    or (lower_band_pct is null) <> (upper_band_pct is null)
    or lower_band_pct::text in ('NaN', 'Infinity', '-Infinity')
    or upper_band_pct::text in ('NaN', 'Infinity', '-Infinity')
    or lower_band_pct < 0
    or upper_band_pct > 100
    or lower_band_pct > upper_band_pct
    or target_weight_pct < lower_band_pct
    or target_weight_pct > upper_band_pct;
  if v_invalid_bucket_count > 0 then
    raise exception 'allocation contract target bucket weights or bands are invalid';
  end if;
  select count(*)
  into v_invalid_envelope_count
  from jsonb_to_recordset(p_envelope_lines) as x(
    envelope text,
    target_weight_pct numeric
  )
  where coalesce(trim(envelope), '') = ''
    or target_weight_pct is null
    or target_weight_pct::text in ('NaN', 'Infinity', '-Infinity')
    or target_weight_pct < 0
    or target_weight_pct > 100;
  if jsonb_array_length(p_envelope_lines) = 0 or v_invalid_envelope_count > 0 then
    raise exception 'allocation contract envelope target weights are invalid';
  end if;
  select count(*)
  into v_invalid_envelope_total_count
  from (
    select envelope, sum(target_weight_pct) as target_total_pct
    from jsonb_to_recordset(p_envelope_lines) as x(
      envelope text,
      target_weight_pct numeric
    )
    group by envelope
  ) envelope_totals
  where abs(target_total_pct - 100) > 0.05;
  if v_invalid_envelope_total_count > 0 then
    raise exception 'allocation contract target lines must total 100 percent per envelope';
  end if;
  if abs(v_bucket_total - 100) > 0.05
    or abs(coalesce((p_model ->> 'target_total_pct')::numeric, 0) - 100) > 0.05
  then
    raise exception 'allocation contract target buckets must total 100 percent';
  end if;

  if v_scope = 'PERSO' then
    if v_crypto_count <> 1 or v_crypto_ready_count <> 1 then
      raise exception 'PERSO crypto contract must be exactly 2 percent with a 0-4 band';
    end if;
  else
    if coalesce((p_model ->> 'reserve_excluded_from_risky_allocation')::boolean, false) is not true
      or abs(coalesce((p_model ->> 'reserve_floor_eur')::numeric, 0) - 120000) > 0.01
    then
      raise exception 'PRO reserve contract must exclude exactly EUR 120000 from risky allocation';
    end if;

    select
      count(*),
      count(*) filter (
        where
          (sleeve_key = 'CORE' and bucket_key = 'actions_us' and abs(target_weight_pct - 28) <= 0.05)
          or (sleeve_key = 'CORE' and bucket_key = 'actions_europe' and abs(target_weight_pct - 12) <= 0.05)
          or (sleeve_key = 'CORE' and bucket_key = 'actions_japan' and abs(target_weight_pct - 7) <= 0.05)
          or (sleeve_key = 'CORE' and bucket_key = 'actions_pacific_ex_japan' and abs(target_weight_pct - 4) <= 0.05)
          or (sleeve_key = 'CORE' and bucket_key = 'actions_emerging' and abs(target_weight_pct - 9) <= 0.05)
          or (sleeve_key = 'CORE' and bucket_key = 'gold' and abs(target_weight_pct - 10) <= 0.05)
          or (sleeve_key = 'SATELLITE' and bucket_key = 'actions_us' and abs(target_weight_pct - 13) <= 0.05)
          or (sleeve_key = 'SATELLITE' and bucket_key = 'actions_europe' and abs(target_weight_pct - 6) <= 0.05)
          or (sleeve_key = 'SATELLITE' and bucket_key = 'actions_japan' and abs(target_weight_pct - 3) <= 0.05)
          or (sleeve_key = 'SATELLITE' and bucket_key = 'actions_pacific_ex_japan' and abs(target_weight_pct - 1) <= 0.05)
          or (sleeve_key = 'SATELLITE' and bucket_key = 'actions_emerging' and abs(target_weight_pct - 7) <= 0.05)
      ),
      coalesce(sum(target_weight_pct) filter (where sleeve_key = 'CORE'), 0),
      coalesce(sum(target_weight_pct) filter (where sleeve_key = 'SATELLITE'), 0)
    into v_sleeve_count, v_approved_sleeve_count, v_core_total, v_satellite_total
    from jsonb_to_recordset(p_sleeve_allocations) as x(
      sleeve_key text,
      bucket_key text,
      target_weight_pct numeric
    );

    with sleeve_bucket_totals as (
      select bucket_key, sum(target_weight_pct) as target_weight_pct
      from jsonb_to_recordset(p_sleeve_allocations) as x(bucket_key text, target_weight_pct numeric)
      group by bucket_key
    ),
    bucket_rows as (
      select bucket_key, target_weight_pct
      from jsonb_to_recordset(p_buckets) as x(bucket_key text, target_weight_pct numeric)
    ),
    alignment as (
      select
        count(*) filter (
          where s.bucket_key is not null
            and b.bucket_key is not null
            and abs(s.target_weight_pct - b.target_weight_pct) <= 0.05
        ) as aligned_bucket_count,
        count(*) filter (
          where s.bucket_key is null
            or b.bucket_key is null
            or abs(s.target_weight_pct - b.target_weight_pct) > 0.05
        ) as misaligned_bucket_count
      from sleeve_bucket_totals s
      full outer join bucket_rows b using (bucket_key)
    )
    select aligned_bucket_count, misaligned_bucket_count
    into v_aligned_bucket_count, v_misaligned_bucket_count
    from alignment;

    if v_sleeve_count <> 11
      or v_approved_sleeve_count <> 11
      or abs(v_core_total - 70) > 0.05
      or abs(v_satellite_total - 30) > 0.05
      or v_bucket_count <> 6
      or v_aligned_bucket_count <> 6
      or v_misaligned_bucket_count <> 0
    then
      raise exception 'PRO Core/Satellite and strategic bucket contracts are inconsistent';
    end if;
  end if;

  insert into public.target_models (
    id,
    portfolio_scope,
    model_name,
    source_file,
    allocation_contract_version,
    source_kind,
    as_of_date,
    is_active,
    target_total_pct,
    reserve_floor_eur,
    reserve_excluded_from_risky_allocation,
    status,
    report_json,
    updated_at
  ) values (
    v_model_id,
    v_scope,
    p_model ->> 'model_name',
    p_model ->> 'source_file',
    p_model ->> 'allocation_contract_version',
    p_model ->> 'source_kind',
    nullif(p_model ->> 'as_of_date', '')::date,
    (p_model ->> 'is_active')::boolean,
    (p_model ->> 'target_total_pct')::numeric,
    nullif(p_model ->> 'reserve_floor_eur', '')::numeric,
    coalesce((p_model ->> 'reserve_excluded_from_risky_allocation')::boolean, false),
    p_model ->> 'status',
    coalesce(p_model -> 'report_json', '{}'::jsonb),
    coalesce(nullif(p_model ->> 'updated_at', '')::timestamptz, now())
  )
  on conflict (id) do update set
    portfolio_scope = excluded.portfolio_scope,
    model_name = excluded.model_name,
    source_file = excluded.source_file,
    allocation_contract_version = excluded.allocation_contract_version,
    source_kind = excluded.source_kind,
    as_of_date = excluded.as_of_date,
    is_active = excluded.is_active,
    target_total_pct = excluded.target_total_pct,
    reserve_floor_eur = excluded.reserve_floor_eur,
    reserve_excluded_from_risky_allocation = excluded.reserve_excluded_from_risky_allocation,
    status = excluded.status,
    report_json = excluded.report_json,
    updated_at = excluded.updated_at;

  delete from public.target_buckets where model_id = v_model_id;
  delete from public.target_sleeve_allocations where model_id = v_model_id;
  delete from public.target_envelope_lines where model_id = v_model_id;
  delete from public.target_model_audit_holdings where model_id = v_model_id;

  insert into public.target_buckets (
    model_id, portfolio_scope, bucket_key, bucket_label, parent_bucket_key,
    target_weight_pct, lower_band_pct, upper_band_pct, source_sheet, source_row, updated_at
  )
  select
    model_id, portfolio_scope, bucket_key, bucket_label, parent_bucket_key,
    target_weight_pct, lower_band_pct, upper_band_pct, source_sheet, source_row, coalesce(updated_at, now())
  from jsonb_to_recordset(p_buckets) as x(
    model_id text, portfolio_scope text, bucket_key text, bucket_label text,
    parent_bucket_key text, target_weight_pct numeric, lower_band_pct numeric,
    upper_band_pct numeric, source_sheet text, source_row integer, updated_at timestamptz
  );

  insert into public.target_sleeve_allocations (
    model_id, portfolio_scope, sleeve_key, component_label, bucket_key, bucket_label,
    target_weight_pct, instrument_policy, activation_status, source_sheet, source_row, updated_at
  )
  select
    model_id, portfolio_scope, sleeve_key, component_label, bucket_key, bucket_label,
    target_weight_pct, instrument_policy, activation_status, source_sheet, source_row, coalesce(updated_at, now())
  from jsonb_to_recordset(p_sleeve_allocations) as x(
    model_id text, portfolio_scope text, sleeve_key text, component_label text,
    bucket_key text, bucket_label text, target_weight_pct numeric, instrument_policy text,
    activation_status text, source_sheet text, source_row integer, updated_at timestamptz
  );

  insert into public.target_envelope_lines (
    model_id, portfolio_scope, envelope, ticker, isin, instrument, asset_class, region,
    currency, target_weight_pct, target_value_eur, notes, source_sheet, source_row, updated_at
  )
  select
    model_id, portfolio_scope, envelope, ticker, isin, instrument, asset_class, region,
    currency, target_weight_pct, target_value_eur, notes, source_sheet, source_row, coalesce(updated_at, now())
  from jsonb_to_recordset(p_envelope_lines) as x(
    model_id text, portfolio_scope text, envelope text, ticker text, isin text,
    instrument text, asset_class text, region text, currency text, target_weight_pct numeric,
    target_value_eur numeric, notes text, source_sheet text, source_row integer, updated_at timestamptz
  );

  insert into public.target_model_audit_holdings (
    model_id, portfolio_scope, envelope, ticker, isin, instrument, asset_class, region,
    currency, market_value_eur, quantity, notes, source_sheet, source_row, updated_at
  )
  select
    model_id, portfolio_scope, envelope, ticker, isin, instrument, asset_class, region,
    currency, market_value_eur, quantity, notes, source_sheet, source_row, coalesce(updated_at, now())
  from jsonb_to_recordset(p_audit_holdings) as x(
    model_id text, portfolio_scope text, envelope text, ticker text, isin text,
    instrument text, asset_class text, region text, currency text, market_value_eur numeric,
    quantity numeric, notes text, source_sheet text, source_row integer, updated_at timestamptz
  );

  return jsonb_build_object(
    'model_upserted', v_model_id,
    'buckets_inserted', jsonb_array_length(p_buckets),
    'sleeve_allocations_inserted', jsonb_array_length(p_sleeve_allocations),
    'envelope_lines_inserted', jsonb_array_length(p_envelope_lines),
    'audit_holdings_inserted', jsonb_array_length(p_audit_holdings)
  );
end;
$$;

revoke all on function public.apply_target_model_v1(jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_target_model_v1(jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;

drop view if exists public.allocation_advice_items_latest;

create view public.allocation_advice_items_latest
with (security_invoker = true) as
with active_models as (
  select distinct on (portfolio_scope)
    id,
    portfolio_scope,
    model_name,
    source_file,
    status,
    target_total_pct,
    allocation_contract_version,
    reserve_floor_eur,
    reserve_excluded_from_risky_allocation,
    updated_at
  from public.target_models
  where is_active = true
  order by portfolio_scope, updated_at desc
),
bucket_contracts as (
  select
    model_id,
    count(*) as bucket_count,
    sum(target_weight_pct) as target_total_pct,
    count(*) filter (
      where target_weight_pct is null
        or target_weight_pct::text in ('NaN', 'Infinity', '-Infinity')
        or target_weight_pct < 0
        or target_weight_pct > 100
        or (lower_band_pct is null) <> (upper_band_pct is null)
        or lower_band_pct::text in ('NaN', 'Infinity', '-Infinity')
        or upper_band_pct::text in ('NaN', 'Infinity', '-Infinity')
        or lower_band_pct < 0
        or upper_band_pct > 100
        or lower_band_pct > upper_band_pct
        or target_weight_pct < lower_band_pct
        or target_weight_pct > upper_band_pct
    ) as invalid_bucket_count,
    count(*) filter (where bucket_key = 'crypto') as crypto_bucket_count,
    bool_or(
      bucket_key = 'crypto'
      and abs(target_weight_pct - 2) <= 0.05
      and lower_band_pct is not null
      and abs(lower_band_pct) <= 0.05
      and upper_band_pct is not null
      and abs(upper_band_pct - 4) <= 0.05
    ) as crypto_contract_ready
  from public.target_buckets
  group by model_id
),
sleeve_contracts as (
  select
    model_id,
    count(*) as sleeve_line_count,
    count(*) filter (
      where
        (sleeve_key = 'CORE' and bucket_key = 'actions_us' and abs(target_weight_pct - 28) <= 0.05)
        or (sleeve_key = 'CORE' and bucket_key = 'actions_europe' and abs(target_weight_pct - 12) <= 0.05)
        or (sleeve_key = 'CORE' and bucket_key = 'actions_japan' and abs(target_weight_pct - 7) <= 0.05)
        or (sleeve_key = 'CORE' and bucket_key = 'actions_pacific_ex_japan' and abs(target_weight_pct - 4) <= 0.05)
        or (sleeve_key = 'CORE' and bucket_key = 'actions_emerging' and abs(target_weight_pct - 9) <= 0.05)
        or (sleeve_key = 'CORE' and bucket_key = 'gold' and abs(target_weight_pct - 10) <= 0.05)
        or (sleeve_key = 'SATELLITE' and bucket_key = 'actions_us' and abs(target_weight_pct - 13) <= 0.05)
        or (sleeve_key = 'SATELLITE' and bucket_key = 'actions_europe' and abs(target_weight_pct - 6) <= 0.05)
        or (sleeve_key = 'SATELLITE' and bucket_key = 'actions_japan' and abs(target_weight_pct - 3) <= 0.05)
        or (sleeve_key = 'SATELLITE' and bucket_key = 'actions_pacific_ex_japan' and abs(target_weight_pct - 1) <= 0.05)
        or (sleeve_key = 'SATELLITE' and bucket_key = 'actions_emerging' and abs(target_weight_pct - 7) <= 0.05)
    ) as approved_line_count,
    sum(target_weight_pct) filter (where sleeve_key = 'CORE') as core_total_pct,
    sum(target_weight_pct) filter (where sleeve_key = 'SATELLITE') as satellite_total_pct
  from public.target_sleeve_allocations
  group by model_id
),
sleeve_bucket_totals as (
  select
    model_id,
    bucket_key,
    sum(target_weight_pct) as target_weight_pct
  from public.target_sleeve_allocations
  group by model_id, bucket_key
),
bucket_sleeve_alignment as (
  select
    coalesce(s.model_id, b.model_id) as model_id,
    count(*) filter (
      where s.bucket_key is not null
        and b.bucket_key is not null
        and abs(s.target_weight_pct - b.target_weight_pct) <= 0.05
    ) as aligned_bucket_count,
    count(*) filter (
      where s.bucket_key is null
        or b.bucket_key is null
        or abs(s.target_weight_pct - b.target_weight_pct) > 0.05
    ) as misaligned_bucket_count
  from sleeve_bucket_totals s
  full outer join public.target_buckets b
    on b.model_id = s.model_id and b.bucket_key = s.bucket_key
  group by coalesce(s.model_id, b.model_id)
),
model_contracts as (
  select
    m.*,
    case
      when m.status <> 'READY' then 'UNKNOWN'
      when m.allocation_contract_version <> 'allocation_contracts_v1'
        or m.allocation_contract_version is null
      then 'UNKNOWN'
      when m.portfolio_scope = 'PERSO'
        and abs(coalesce(m.target_total_pct, 0) - 100) <= 0.05
        and abs(coalesce(b.target_total_pct, 0) - 100) <= 0.05
        and coalesce(b.invalid_bucket_count, 0) = 0
        and coalesce(b.crypto_bucket_count, 0) = 1
        and coalesce(b.crypto_contract_ready, false)
      then 'READY'
      when m.portfolio_scope = 'PRO'
        and m.reserve_excluded_from_risky_allocation
        and abs(coalesce(m.reserve_floor_eur, 0) - 120000) <= 0.01
        and abs(coalesce(m.target_total_pct, 0) - 100) <= 0.05
        and abs(coalesce(b.target_total_pct, 0) - 100) <= 0.05
        and coalesce(b.invalid_bucket_count, 0) = 0
        and coalesce(b.bucket_count, 0) = 6
        and coalesce(s.sleeve_line_count, 0) = 11
        and coalesce(s.approved_line_count, 0) = 11
        and abs(coalesce(s.core_total_pct, 0) - 70) <= 0.05
        and abs(coalesce(s.satellite_total_pct, 0) - 30) <= 0.05
        and coalesce(a.aligned_bucket_count, 0) = 6
        and coalesce(a.misaligned_bucket_count, 0) = 0
      then 'READY'
      else 'UNKNOWN'
    end as model_contract_state,
    case
      when m.status <> 'READY' then 'target_model_status_not_ready'
      when m.allocation_contract_version <> 'allocation_contracts_v1'
        or m.allocation_contract_version is null
      then 'target_model_contract_version_missing'
      when m.portfolio_scope = 'PERSO' and not (
        abs(coalesce(m.target_total_pct, 0) - 100) <= 0.05
        and abs(coalesce(b.target_total_pct, 0) - 100) <= 0.05
        and coalesce(b.invalid_bucket_count, 0) = 0
        and coalesce(b.crypto_bucket_count, 0) = 1
        and coalesce(b.crypto_contract_ready, false)
      ) then 'perso_model_contract_incomplete'
      when m.portfolio_scope = 'PRO' and not (
        m.reserve_excluded_from_risky_allocation
        and abs(coalesce(m.reserve_floor_eur, 0) - 120000) <= 0.01
        and abs(coalesce(m.target_total_pct, 0) - 100) <= 0.05
        and abs(coalesce(b.target_total_pct, 0) - 100) <= 0.05
        and coalesce(b.invalid_bucket_count, 0) = 0
        and coalesce(b.bucket_count, 0) = 6
        and coalesce(s.sleeve_line_count, 0) = 11
        and coalesce(s.approved_line_count, 0) = 11
        and abs(coalesce(s.core_total_pct, 0) - 70) <= 0.05
        and abs(coalesce(s.satellite_total_pct, 0) - 30) <= 0.05
        and coalesce(a.aligned_bucket_count, 0) = 6
        and coalesce(a.misaligned_bucket_count, 0) = 0
      ) then 'pro_model_contract_incomplete'
      else null
    end as model_contract_reason
  from active_models m
  left join bucket_contracts b on b.model_id = m.id
  left join sleeve_contracts s on s.model_id = m.id
  left join bucket_sleeve_alignment a on a.model_id = m.id
),
canonical_holdings as (
  select
    case
      when po.portfolio_type = 'PERSONAL' then 'PERSO'
      when po.portfolio_type = 'PROFESSIONAL' then 'PRO'
      else null
    end as portfolio_scope,
    p.portfolio_id,
    p.ticker,
    p.name,
    p.instrument_type,
    p.currency,
    case
      when p.price_as_of is null or p.fx_as_of is null then null
      else least(p.snapshot_date, p.price_as_of, p.fx_as_of)
    end as actual_as_of_date,
    p.data_state,
    p.market_value_eur as current_value_eur
  from public.fo_positions_latest p
  join public.fo_portfolios po on po.id = p.portfolio_id

  union all

  select
    case
      when po.portfolio_type = 'PERSONAL' then 'PERSO'
      when po.portfolio_type = 'PROFESSIONAL' then 'PRO'
      else null
    end as portfolio_scope,
    c.portfolio_id,
    'CASH_' || upper(c.currency) as ticker,
    'Cash ' || upper(c.currency) as name,
    'CASH'::text as instrument_type,
    c.currency,
    c.balance_date as actual_as_of_date,
    c.data_state,
    c.balance_eur as current_value_eur
  from public.fo_cash_balances_latest c
  join public.fo_portfolios po on po.id = c.portfolio_id
),
position_values_raw as (
  select
    p.portfolio_scope,
    p.portfolio_id,
    case
      when coalesce(p.instrument_type, '') ilike '%crypto%'
        or coalesce(p.instrument_type, '') ilike '%digital asset%'
        or coalesce(p.name, '') ~* '(^|[^a-z])(bitcoin|ethereum|crypto)([^a-z]|$)'
        or upper(coalesce(p.ticker, '')) in ('BTC', 'BTC-EUR', 'BTC-USD', 'ETH', 'ETH-EUR', 'ETH-USD')
      then 'crypto'
      when upper(coalesce(p.ticker, '')) in ('CASH', 'EUR', 'USD', 'CHF', 'GBP', 'XEON')
        or coalesce(p.instrument_type, '') ilike '%cash%'
        or coalesce(p.instrument_type, '') ilike '%bond%'
        or coalesce(p.instrument_type, '') ilike '%bill%'
        or coalesce(p.name, '') ilike '%fonds euro%'
        or coalesce(p.name, '') ilike '%overnight%'
        or coalesce(p.name, '') ilike '%monétaire%'
        or coalesce(p.name, '') ilike '%money market%'
      then 'cash_bonds'
      when coalesce(p.name, '') ilike '%gold%'
        or coalesce(p.name, '') ~* '(^|[^a-z])(or)([^a-z]|$)'
        or upper(coalesce(p.ticker, '')) in ('GOLD', 'GLD')
      then 'gold'
      when coalesce(p.name, '') ilike '%pacific%'
        or coalesce(p.name, '') ilike '%asia pacific%'
        or upper(coalesce(p.ticker, '')) in ('CPXJ', 'CSPXJ')
      then 'actions_pacific_ex_japan'
      when coalesce(p.name, '') ilike '%japan%'
        or coalesce(p.name, '') ilike '%japon%'
        or upper(coalesce(p.ticker, '')) in ('CJPU', 'EWJ')
      then 'actions_japan'
      when coalesce(p.name, '') ilike '%emerging%'
        or coalesce(p.name, '') ilike '%emerg%'
        or coalesce(p.name, '') ilike '%india%'
        or upper(coalesce(p.ticker, '')) in ('EIMI', 'NDIA')
      then 'actions_emerging'
      when coalesce(p.name, '') ilike '%europe%'
        or coalesce(p.name, '') ilike '%stoxx%'
        or coalesce(p.name, '') ilike '%cac%'
        or coalesce(p.name, '') ilike '%dax%'
        or upper(coalesce(p.ticker, '')) in ('AI', 'AIR', 'ASML', 'ASM', 'DSY', 'EL', 'MC', 'RI', 'SK', 'VIE', 'DG', 'IMAE', 'MEU')
      then 'actions_europe'
      when coalesce(p.name, '') ilike '%s&p%'
        or coalesce(p.name, '') ilike '%sp 500%'
        or coalesce(p.name, '') ilike '%nasdaq%'
        or upper(coalesce(p.ticker, '')) in ('CSPX', 'AAPL', 'MSFT', 'ORCL', 'IWQU')
      then 'actions_us'
      else 'unmapped'
    end as bucket_key,
    case
      when upper(coalesce(p.currency, '')) = 'EUR'
        and (
          coalesce(p.instrument_type, '') ilike '%cash%'
          or upper(coalesce(p.ticker, '')) in ('CASH', 'CASH_EUR', 'EUR', 'XEON')
          or coalesce(p.name, '') ~* '(^|[^a-z])(revolut|bank account|compte bancaire|overnight|monétaire|money market|xeon)([^a-z]|$)'
          or (
            (coalesce(p.instrument_type, '') ilike '%bill%' or coalesce(p.name, '') ilike '%bill%')
            and coalesce(p.name, '') ~* '(^|[^a-z])(eu|euro|european)[ -]?(treasury[ -]?)?bills?([^a-z]|$)'
          )
        )
      then true
      else false
    end as reserve_eligible,
    p.actual_as_of_date,
    p.data_state,
    p.current_value_eur
  from canonical_holdings p
),
current_by_bucket as (
  select
    portfolio_scope,
    portfolio_id,
    bucket_key,
    sum(current_value_eur) as current_value_eur,
    count(*) as position_count,
    count(*) filter (
      where current_value_eur is null
        or data_state in ('PARTIAL', 'MISSING', 'UNRECONCILED')
    ) as unavailable_positions,
    count(*) filter (
      where data_state = 'STALE'
        or actual_as_of_date is null
        or actual_as_of_date < current_date - 3
    ) as stale_positions
  from position_values_raw
  where portfolio_scope is not null
  group by portfolio_scope, portfolio_id, bucket_key
),
scope_stats as (
  select
    portfolio_scope,
    portfolio_id,
    count(*) as position_count,
    sum(current_value_eur) as known_total_value_eur,
    count(*) filter (
      where current_value_eur is null
        or data_state in ('PARTIAL', 'MISSING', 'UNRECONCILED')
    ) as unavailable_positions,
    count(*) filter (
      where data_state = 'STALE'
        or actual_as_of_date is null
        or actual_as_of_date < current_date - 3
    ) as stale_positions,
    count(*) filter (where bucket_key = 'unmapped') as unmatched_positions,
    count(*) filter (where reserve_eligible) as reserve_eligible_positions,
    count(*) filter (
      where reserve_eligible
        and (current_value_eur is null or data_state in ('PARTIAL', 'MISSING', 'UNRECONCILED'))
    ) as reserve_unavailable_positions,
    count(*) filter (
      where reserve_eligible
        and (data_state = 'STALE' or actual_as_of_date is null or actual_as_of_date < current_date - 3)
    ) as reserve_stale_positions,
    sum(current_value_eur) filter (where reserve_eligible) as reserve_current_eur
  from position_values_raw
  where portfolio_scope is not null
  group by portfolio_scope, portfolio_id
),
unmatched_scope_stats as (
  select
    count(*) as position_count,
    sum(current_value_eur) as known_total_value_eur,
    count(*) filter (
      where current_value_eur is null
        or data_state in ('PARTIAL', 'MISSING', 'UNRECONCILED')
    ) as unavailable_positions
  from position_values_raw
  where portfolio_scope is null
),
model_scope as (
  select
    m.*,
    s.portfolio_id,
    coalesce(s.position_count, 0) as position_count,
    coalesce(s.unavailable_positions, 0) as unavailable_positions,
    coalesce(s.stale_positions, 0) as stale_positions,
    coalesce(s.unmatched_positions, 0) as unmatched_positions,
    coalesce(u.position_count, 0) as unmatched_scope_positions,
    coalesce(s.reserve_eligible_positions, 0) as reserve_eligible_positions,
    coalesce(s.reserve_unavailable_positions, 0) as reserve_unavailable_positions,
    coalesce(s.reserve_stale_positions, 0) as reserve_stale_positions,
    s.reserve_current_eur,
    case
      when coalesce(u.position_count, 0) > 0 then 'PARTIAL'
      when coalesce(s.position_count, 0) = 0 then 'UNKNOWN'
      when coalesce(s.unavailable_positions, 0) = coalesce(s.position_count, 0) then 'UNKNOWN'
      when coalesce(s.unavailable_positions, 0) > 0 then 'PARTIAL'
      when coalesce(s.unmatched_positions, 0) > 0 then 'PARTIAL'
      when coalesce(s.stale_positions, 0) > 0 then 'STALE'
      else 'READY'
    end as scope_data_state,
    case
      when m.portfolio_scope <> 'PRO' then 'READY'
      when m.model_contract_state <> 'READY' then 'UNKNOWN'
      when coalesce(s.reserve_eligible_positions, 0) = 0 then 'UNKNOWN'
      when coalesce(s.reserve_unavailable_positions, 0) > 0 then 'PARTIAL'
      when s.reserve_current_eur < m.reserve_floor_eur then 'PARTIAL'
      when coalesce(s.reserve_stale_positions, 0) > 0 then 'STALE'
      else 'READY'
    end as reserve_state,
    case
      when coalesce(u.position_count, 0) > 0
        or coalesce(s.position_count, 0) = 0
        or coalesce(s.unavailable_positions, 0) > 0
      then null
      else s.known_total_value_eur
    end as total_value_eur,
    case
      when m.model_contract_state <> 'READY'
        or coalesce(u.position_count, 0) > 0
        or coalesce(s.position_count, 0) = 0
        or coalesce(s.unavailable_positions, 0) > 0
      then null
      when m.portfolio_scope <> 'PRO' then s.known_total_value_eur
      when coalesce(s.reserve_eligible_positions, 0) = 0
        or coalesce(s.reserve_unavailable_positions, 0) > 0
        or s.reserve_current_eur < m.reserve_floor_eur
      then null
      else s.known_total_value_eur - m.reserve_floor_eur
    end as allocatable_total_eur,
    u.known_total_value_eur as unmatched_scope_value_eur,
    coalesce(u.unavailable_positions, 0) as unmatched_scope_unavailable_positions
  from model_contracts m
  left join scope_stats s on s.portfolio_scope = m.portfolio_scope
  cross join unmatched_scope_stats u
),
allocatable_current_by_bucket as (
  select
    c.*,
    case
      when c.portfolio_scope = 'PRO' and c.bucket_key = 'cash_bonds'
      then greatest(
        0::numeric,
        c.current_value_eur - least(coalesce(m.reserve_current_eur, 0), coalesce(m.reserve_floor_eur, 0))
      )
      else c.current_value_eur
    end as allocatable_current_value_eur
  from current_by_bucket c
  join model_scope m
    on m.portfolio_scope = c.portfolio_scope and m.portfolio_id = c.portfolio_id
),
target_rows as (
  select
    m.portfolio_scope,
    m.portfolio_id,
    m.id as model_id,
    m.model_name,
    m.source_file,
    b.bucket_key,
    b.bucket_label,
    case
      when c.position_count is not null then c.allocatable_current_value_eur
      when m.model_contract_state = 'READY' and m.scope_data_state in ('READY', 'STALE') then 0::numeric
      else null
    end as current_value_eur,
    b.target_weight_pct,
    b.lower_band_pct,
    b.upper_band_pct,
    case
      when m.model_contract_state <> 'READY' then 'UNKNOWN'
      when m.scope_data_state = 'UNKNOWN' then 'UNKNOWN'
      when m.scope_data_state = 'PARTIAL' then 'PARTIAL'
      when m.scope_data_state = 'STALE' then 'STALE'
      when m.reserve_state = 'UNKNOWN' then 'UNKNOWN'
      when m.reserve_state = 'PARTIAL' then 'PARTIAL'
      when m.reserve_state = 'STALE' then 'STALE'
      when coalesce(c.unavailable_positions, 0) > 0 then 'PARTIAL'
      when coalesce(c.stale_positions, 0) > 0 then 'STALE'
      else 'READY'
    end as data_state,
    coalesce(c.position_count, 0) as bucket_position_count,
    coalesce(c.unavailable_positions, 0) as bucket_unavailable_positions,
    m.position_count,
    m.unavailable_positions,
    m.unmatched_positions,
    m.unmatched_scope_positions,
    m.total_value_eur,
    m.allocatable_total_eur,
    m.reserve_floor_eur,
    m.reserve_current_eur,
    m.reserve_eligible_positions,
    m.reserve_state,
    m.model_contract_state,
    m.model_contract_reason,
    m.updated_at
  from model_scope m
  join public.target_buckets b on b.model_id = m.id
  left join allocatable_current_by_bucket c
    on c.portfolio_scope = m.portfolio_scope
    and c.portfolio_id = m.portfolio_id
    and c.bucket_key = b.bucket_key
),
non_target_rows as (
  select
    m.portfolio_scope,
    m.portfolio_id,
    m.id as model_id,
    m.model_name,
    m.source_file,
    c.bucket_key,
    'Non-target allocation: ' || c.bucket_key as bucket_label,
    c.allocatable_current_value_eur as current_value_eur,
    0::numeric as target_weight_pct,
    0::numeric as lower_band_pct,
    0::numeric as upper_band_pct,
    case
      when m.model_contract_state <> 'READY' then 'UNKNOWN'
      when m.scope_data_state = 'UNKNOWN' then 'UNKNOWN'
      when m.scope_data_state = 'PARTIAL' then 'PARTIAL'
      when m.scope_data_state = 'STALE' then 'STALE'
      when m.reserve_state = 'UNKNOWN' then 'UNKNOWN'
      when m.reserve_state = 'PARTIAL' then 'PARTIAL'
      when m.reserve_state = 'STALE' then 'STALE'
      when c.unavailable_positions > 0 then 'PARTIAL'
      when c.stale_positions > 0 then 'STALE'
      else 'READY'
    end as data_state,
    c.position_count as bucket_position_count,
    c.unavailable_positions as bucket_unavailable_positions,
    m.position_count,
    m.unavailable_positions,
    m.unmatched_positions,
    m.unmatched_scope_positions,
    m.total_value_eur,
    m.allocatable_total_eur,
    m.reserve_floor_eur,
    m.reserve_current_eur,
    m.reserve_eligible_positions,
    m.reserve_state,
    m.model_contract_state,
    m.model_contract_reason,
    m.updated_at
  from model_scope m
  join allocatable_current_by_bucket c
    on c.portfolio_scope = m.portfolio_scope and c.portfolio_id = m.portfolio_id
  where c.bucket_key <> 'unmapped'
    and (c.allocatable_current_value_eur is null or c.allocatable_current_value_eur <> 0)
    and not exists (
      select 1
      from public.target_buckets b
      where b.model_id = m.id and b.bucket_key = c.bucket_key
    )
),
unmatched_rows as (
  select
    m.portfolio_scope,
    m.portfolio_id,
    m.id as model_id,
    m.model_name,
    m.source_file,
    'unmapped'::text as bucket_key,
    'Unmatched positions'::text as bucket_label,
    c.current_value_eur,
    0::numeric as target_weight_pct,
    null::numeric as lower_band_pct,
    null::numeric as upper_band_pct,
    'UNMATCHED'::text as data_state,
    c.position_count as bucket_position_count,
    c.unavailable_positions as bucket_unavailable_positions,
    m.position_count,
    m.unavailable_positions,
    m.unmatched_positions,
    m.unmatched_scope_positions,
    m.total_value_eur,
    m.allocatable_total_eur,
    m.reserve_floor_eur,
    m.reserve_current_eur,
    m.reserve_eligible_positions,
    m.reserve_state,
    m.model_contract_state,
    m.model_contract_reason,
    m.updated_at
  from model_scope m
  join current_by_bucket c
    on c.portfolio_scope = m.portfolio_scope
    and c.portfolio_id = m.portfolio_id
    and c.bucket_key = 'unmapped'
),
unmatched_scope_rows as (
  select
    m.portfolio_scope,
    m.portfolio_id,
    m.id as model_id,
    m.model_name,
    m.source_file,
    'unmatched_scope'::text as bucket_key,
    'Unmatched portfolio scope'::text as bucket_label,
    m.unmatched_scope_value_eur as current_value_eur,
    0::numeric as target_weight_pct,
    null::numeric as lower_band_pct,
    null::numeric as upper_band_pct,
    'UNMATCHED'::text as data_state,
    m.unmatched_scope_positions as bucket_position_count,
    m.unmatched_scope_unavailable_positions as bucket_unavailable_positions,
    m.position_count,
    m.unavailable_positions,
    m.unmatched_positions,
    m.unmatched_scope_positions,
    m.total_value_eur,
    m.allocatable_total_eur,
    m.reserve_floor_eur,
    m.reserve_current_eur,
    m.reserve_eligible_positions,
    m.reserve_state,
    m.model_contract_state,
    m.model_contract_reason,
    m.updated_at
  from model_scope m
  where m.unmatched_scope_positions > 0
),
model_contract_rows as (
  select
    m.portfolio_scope,
    m.portfolio_id,
    m.id as model_id,
    m.model_name,
    m.source_file,
    'model_contract'::text as bucket_key,
    'Target model contract'::text as bucket_label,
    null::numeric as current_value_eur,
    null::numeric as target_weight_pct,
    null::numeric as lower_band_pct,
    null::numeric as upper_band_pct,
    'UNKNOWN'::text as data_state,
    0::bigint as bucket_position_count,
    0::bigint as bucket_unavailable_positions,
    m.position_count,
    m.unavailable_positions,
    m.unmatched_positions,
    m.unmatched_scope_positions,
    m.total_value_eur,
    null::numeric as allocatable_total_eur,
    m.reserve_floor_eur,
    m.reserve_current_eur,
    m.reserve_eligible_positions,
    m.reserve_state,
    m.model_contract_state,
    m.model_contract_reason,
    m.updated_at
  from model_scope m
  where m.model_contract_state <> 'READY'
),
reserve_rows as (
  select
    m.portfolio_scope,
    m.portfolio_id,
    m.id as model_id,
    m.model_name,
    m.source_file,
    'pro_reserve'::text as bucket_key,
    'PRO reserve outside risky allocation'::text as bucket_label,
    m.reserve_current_eur as current_value_eur,
    null::numeric as target_weight_pct,
    null::numeric as lower_band_pct,
    null::numeric as upper_band_pct,
    case when m.model_contract_state = 'READY' then m.reserve_state else 'UNKNOWN' end as data_state,
    m.reserve_eligible_positions as bucket_position_count,
    m.reserve_unavailable_positions as bucket_unavailable_positions,
    m.position_count,
    m.unavailable_positions,
    m.unmatched_positions,
    m.unmatched_scope_positions,
    m.total_value_eur,
    m.allocatable_total_eur,
    m.reserve_floor_eur,
    m.reserve_current_eur,
    m.reserve_eligible_positions,
    m.reserve_state,
    m.model_contract_state,
    m.model_contract_reason,
    m.updated_at
  from model_scope m
  where m.portfolio_scope = 'PRO'
),
advice_base as (
  select * from target_rows
  union all select * from non_target_rows
  union all select * from unmatched_rows
  union all select * from unmatched_scope_rows
  union all select * from model_contract_rows
  union all select * from reserve_rows
),
advice_with_bounds as (
  select
    advice_base.*,
    coalesce(lower_band_pct, target_weight_pct - 3) as effective_lower_band_pct,
    coalesce(upper_band_pct, target_weight_pct + 3) as effective_upper_band_pct
  from advice_base
)
select
  portfolio_scope,
  portfolio_id,
  model_id,
  model_name,
  source_file,
  bucket_key,
  bucket_label,
  current_value_eur,
  case
    when data_state = 'READY' and target_weight_pct is not null and allocatable_total_eur > 0
    then (current_value_eur / allocatable_total_eur) * 100
    else null
  end as current_weight_pct,
  target_weight_pct,
  case
    when data_state = 'READY' and target_weight_pct is not null and allocatable_total_eur > 0
    then (current_value_eur / allocatable_total_eur) * 100 - target_weight_pct
    else null
  end as drift_pct,
  case
    when data_state = 'READY' and target_weight_pct is not null and allocatable_total_eur > 0
    then (target_weight_pct / 100) * allocatable_total_eur - current_value_eur
    else null
  end as rebalance_amount_eur,
  case
    when data_state <> 'READY' then 'UNAVAILABLE'
    when target_weight_pct is null then 'HOLD'
    when allocatable_total_eur is null or allocatable_total_eur <= 0 then 'UNAVAILABLE'
    when target_weight_pct = 0 and current_value_eur >= 100 then 'REDUCE'
    when target_weight_pct = 0 then 'HOLD'
    when abs((target_weight_pct / 100) * allocatable_total_eur - current_value_eur) < 100 then 'HOLD'
    when (current_value_eur / allocatable_total_eur) * 100 < effective_lower_band_pct then 'BUY'
    when (current_value_eur / allocatable_total_eur) * 100 > effective_upper_band_pct then 'REDUCE'
    else 'HOLD'
  end as action,
  greatest(
    0,
    100
    - case when data_state = 'UNKNOWN' then 50 else 0 end
    - case when data_state = 'PARTIAL' then 35 else 0 end
    - case when data_state = 'STALE' then 25 else 0 end
    - case when data_state = 'UNMATCHED' then 60 else 0 end
    - case when model_contract_state <> 'READY' then 50 else 0 end
    - case when reserve_state <> 'READY' then 20 else 0 end
  )::integer as confidence,
  array_remove(array[
    case when model_contract_state <> 'READY' then model_contract_reason end,
    case when data_state = 'UNKNOWN' then 'current_value_unknown'::text end,
    case when data_state = 'PARTIAL' then 'current_value_partial'::text end,
    case when data_state = 'STALE' then 'current_value_stale'::text end,
    case when data_state = 'UNMATCHED' and bucket_key = 'unmatched_scope' then 'position_scope_unmatched'::text end,
    case when data_state = 'UNMATCHED' and bucket_key = 'unmapped' then 'position_unmatched'::text end,
    case when bucket_unavailable_positions > 0 then 'position_value_unavailable'::text end,
    case when unmatched_positions > 0 and bucket_key <> 'unmapped' then 'scope_contains_unmatched_positions'::text end,
    case when unmatched_scope_positions > 0 and bucket_key <> 'unmatched_scope' then 'scope_contains_unmatched_portfolio'::text end,
    case when reserve_state = 'UNKNOWN' then 'pro_reserve_unknown'::text end,
    case when reserve_state = 'PARTIAL' and reserve_current_eur < reserve_floor_eur then 'pro_reserve_below_floor'::text end,
    case when reserve_state = 'PARTIAL' and (reserve_current_eur is null or reserve_current_eur >= reserve_floor_eur) then 'pro_reserve_partial'::text end,
    case when reserve_state = 'STALE' then 'pro_reserve_stale'::text end,
    case when data_state = 'READY' and target_weight_pct is not null and allocatable_total_eur > 0
      and (current_value_eur / allocatable_total_eur) * 100 between effective_lower_band_pct and effective_upper_band_pct
      then 'in_band'::text end,
    case when data_state = 'READY' and target_weight_pct is not null and allocatable_total_eur > 0
      and abs((target_weight_pct / 100) * allocatable_total_eur - current_value_eur) < 100 then 'below_min_trade'::text end,
    case
      when target_weight_pct is not null and bucket_key not in ('unmapped', 'unmatched_scope')
      then 'flows_first'::text
    end
  ], null) as reason_codes,
  case
    when data_state <> 'READY' or allocatable_total_eur is null then 'CURRENT_UNAVAILABLE'
    when target_weight_pct is null then 'MONITOR'
    when target_weight_pct = 0 and current_value_eur >= 100 then 'INTERNAL_ARBITRAGE'
    when target_weight_pct = 0 then 'MONITOR'
    when abs((target_weight_pct / 100) * allocatable_total_eur - current_value_eur) < 100 then 'MONITOR'
    when (current_value_eur / allocatable_total_eur) * 100 < effective_lower_band_pct then 'NEW_CASH_FIRST'
    when (current_value_eur / allocatable_total_eur) * 100 > effective_upper_band_pct then 'INTERNAL_ARBITRAGE'
    else 'MONITOR'
  end as preferred_execution,
  data_state,
  model_contract_state,
  model_contract_reason,
  bucket_position_count,
  bucket_unavailable_positions,
  position_count,
  unavailable_positions,
  unmatched_positions,
  unmatched_scope_positions,
  total_value_eur,
  allocatable_total_eur,
  reserve_floor_eur,
  reserve_current_eur,
  reserve_eligible_positions,
  reserve_state,
  updated_at
from advice_with_bounds;

revoke all on public.allocation_advice_items_latest from public, anon;
grant select on public.allocation_advice_items_latest to authenticated, service_role;
