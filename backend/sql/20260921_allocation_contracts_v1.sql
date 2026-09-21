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
  for select to anon, authenticated using (true);

drop policy if exists target_sleeve_allocations_service_role_write on public.target_sleeve_allocations;
create policy target_sleeve_allocations_service_role_write on public.target_sleeve_allocations
  for all to service_role using (true) with check (true);

grant select on public.target_sleeve_allocations to anon, authenticated;
grant select, insert, update, delete on public.target_sleeve_allocations to service_role;
grant usage, select on sequence public.target_sleeve_allocations_id_seq to service_role;

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
    sum(target_weight_pct) as target_total_pct,
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
model_contracts as (
  select
    m.*,
    case
      when m.status <> 'READY' then 'UNKNOWN'
      when m.allocation_contract_version <> 'allocation_contracts_v1'
        or m.allocation_contract_version is null
      then 'UNKNOWN'
      when m.portfolio_scope = 'PERSO'
        and abs(coalesce(b.target_total_pct, 0) - 100) <= 0.05
        and coalesce(b.crypto_bucket_count, 0) = 1
        and coalesce(b.crypto_contract_ready, false)
      then 'READY'
      when m.portfolio_scope = 'PRO'
        and m.reserve_excluded_from_risky_allocation
        and abs(coalesce(m.reserve_floor_eur, 0) - 120000) <= 0.01
        and abs(coalesce(b.target_total_pct, 0) - 100) <= 0.05
        and coalesce(s.sleeve_line_count, 0) = 11
        and coalesce(s.approved_line_count, 0) = 11
        and abs(coalesce(s.core_total_pct, 0) - 70) <= 0.05
        and abs(coalesce(s.satellite_total_pct, 0) - 30) <= 0.05
      then 'READY'
      else 'UNKNOWN'
    end as model_contract_state,
    case
      when m.status <> 'READY' then 'target_model_status_not_ready'
      when m.allocation_contract_version <> 'allocation_contracts_v1'
        or m.allocation_contract_version is null
      then 'target_model_contract_version_missing'
      when m.portfolio_scope = 'PERSO' and not (
        abs(coalesce(b.target_total_pct, 0) - 100) <= 0.05
        and coalesce(b.crypto_bucket_count, 0) = 1
        and coalesce(b.crypto_contract_ready, false)
      ) then 'perso_model_contract_incomplete'
      when m.portfolio_scope = 'PRO' and not (
        m.reserve_excluded_from_risky_allocation
        and abs(coalesce(m.reserve_floor_eur, 0) - 120000) <= 0.01
        and abs(coalesce(b.target_total_pct, 0) - 100) <= 0.05
        and coalesce(s.sleeve_line_count, 0) = 11
        and coalesce(s.approved_line_count, 0) = 11
        and abs(coalesce(s.core_total_pct, 0) - 70) <= 0.05
        and abs(coalesce(s.satellite_total_pct, 0) - 30) <= 0.05
      ) then 'pro_model_contract_incomplete'
      else null
    end as model_contract_reason
  from active_models m
  left join bucket_contracts b on b.model_id = m.id
  left join sleeve_contracts s on s.model_id = m.id
),
position_values_raw as (
  select
    case
      when po.name ilike 'PRO%' then 'PRO'
      when po.name ilike 'PERSO%' then 'PERSO'
      else null
    end as portfolio_scope,
    case
      when coalesce(p.instrument_type, '') ilike '%crypto%'
        or coalesce(p.instrument_type, '') ilike '%digital asset%'
        or coalesce(p.name, '') ~* '(^|[^a-z])(bitcoin|ethereum|crypto)([^a-z]|$)'
        or upper(coalesce(p.ticker, '')) in ('BTC', 'BTC-EUR', 'BTC-USD', 'ETH', 'ETH-EUR', 'ETH-USD')
      then 'crypto'
      when upper(coalesce(p.ticker, '')) in ('CASH', 'EUR', 'USD', 'CHF', 'GBP', 'XEON')
        or coalesce(p.instrument_type, '') ilike '%cash%'
        or coalesce(p.instrument_type, '') ilike '%bond%'
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
      when upper(coalesce(p.ticker, '')) in ('CASH', 'EUR', 'USD', 'CHF', 'GBP', 'XEON')
        or coalesce(p.instrument_type, '') ilike '%cash%'
        or coalesce(p.name, '') ~* '(^|[^a-z])(revolut|bank account|compte bancaire|overnight|monétaire|money market|xeon)([^a-z]|$)'
        or (
          (coalesce(p.instrument_type, '') ilike '%bill%' or coalesce(p.name, '') ilike '%bill%')
          and upper(coalesce(nullif(p.currency, ''), nullif(m.currency, ''), '')) = 'EUR'
          and coalesce(p.name, '') ~* '(^|[^a-z])(eu|euro|european)[ -]?(treasury[ -]?)?bills?([^a-z]|$)'
        )
      then true
      else false
    end as reserve_eligible,
    p.actual_as_of_date,
    case
      when p.quantity_current is null then null
      when coalesce(nullif(m.last_price::numeric, 0), nullif(p.pru::numeric, 0)) is null then null
      when upper(coalesce(nullif(p.currency, ''), nullif(m.currency, ''), 'EUR')) = 'EUR'
        then p.quantity_current::numeric * coalesce(nullif(m.last_price::numeric, 0), nullif(p.pru::numeric, 0))
      when nullif(c.rate_to_eur::numeric, 0) is null then null
      else p.quantity_current::numeric * coalesce(nullif(m.last_price::numeric, 0), nullif(p.pru::numeric, 0)) * c.rate_to_eur::numeric
    end as current_value_eur
  from public.portfolio_positions p
  left join public.portfolios po on po.id::text = p.portfolio_id
  left join public.market_watch m on upper(m.ticker) = upper(p.ticker)
  left join public.currencies c
    on upper(c.id) = upper(coalesce(nullif(p.currency, ''), nullif(m.currency, ''), 'EUR'))
),
current_by_bucket as (
  select
    portfolio_scope,
    bucket_key,
    sum(current_value_eur) as current_value_eur,
    count(*) as position_count,
    count(*) filter (where current_value_eur is null) as unavailable_positions,
    count(*) filter (where actual_as_of_date is null or actual_as_of_date < current_date - 3) as stale_positions
  from position_values_raw
  where portfolio_scope is not null
  group by portfolio_scope, bucket_key
),
scope_stats as (
  select
    portfolio_scope,
    count(*) as position_count,
    sum(current_value_eur) as known_total_value_eur,
    count(*) filter (where current_value_eur is null) as unavailable_positions,
    count(*) filter (where actual_as_of_date is null or actual_as_of_date < current_date - 3) as stale_positions,
    count(*) filter (where bucket_key = 'unmapped') as unmatched_positions,
    count(*) filter (where reserve_eligible) as reserve_eligible_positions,
    count(*) filter (where reserve_eligible and current_value_eur is null) as reserve_unavailable_positions,
    count(*) filter (where reserve_eligible and (actual_as_of_date is null or actual_as_of_date < current_date - 3)) as reserve_stale_positions,
    sum(current_value_eur) filter (where reserve_eligible) as reserve_current_eur
  from position_values_raw
  where portfolio_scope is not null
  group by portfolio_scope
),
unmatched_scope_stats as (
  select
    count(*) as position_count,
    sum(current_value_eur) as known_total_value_eur,
    count(*) filter (where current_value_eur is null) as unavailable_positions
  from position_values_raw
  where portfolio_scope is null
),
model_scope as (
  select
    m.*,
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
target_rows as (
  select
    m.portfolio_scope,
    m.id as model_id,
    m.model_name,
    m.source_file,
    b.bucket_key,
    b.bucket_label,
    case
      when c.position_count is not null then c.current_value_eur
      when m.model_contract_state = 'READY' and m.scope_data_state in ('READY', 'STALE') then 0::numeric
      else null
    end as current_value_eur,
    b.target_weight_pct,
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
  left join current_by_bucket c
    on c.portfolio_scope = m.portfolio_scope and c.bucket_key = b.bucket_key
),
unmatched_rows as (
  select
    m.portfolio_scope,
    m.id as model_id,
    m.model_name,
    m.source_file,
    'unmapped'::text as bucket_key,
    'Unmatched positions'::text as bucket_label,
    c.current_value_eur,
    0::numeric as target_weight_pct,
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
    on c.portfolio_scope = m.portfolio_scope and c.bucket_key = 'unmapped'
),
unmatched_scope_rows as (
  select
    m.portfolio_scope,
    m.id as model_id,
    m.model_name,
    m.source_file,
    'unmatched_scope'::text as bucket_key,
    'Unmatched portfolio scope'::text as bucket_label,
    m.unmatched_scope_value_eur as current_value_eur,
    0::numeric as target_weight_pct,
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
    m.id as model_id,
    m.model_name,
    m.source_file,
    'model_contract'::text as bucket_key,
    'Target model contract'::text as bucket_label,
    null::numeric as current_value_eur,
    null::numeric as target_weight_pct,
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
    m.id as model_id,
    m.model_name,
    m.source_file,
    'pro_reserve'::text as bucket_key,
    'PRO reserve outside risky allocation'::text as bucket_label,
    m.reserve_current_eur as current_value_eur,
    null::numeric as target_weight_pct,
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
  union all select * from unmatched_rows
  union all select * from unmatched_scope_rows
  union all select * from model_contract_rows
  union all select * from reserve_rows
)
select
  portfolio_scope,
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
    when ((current_value_eur / allocatable_total_eur) * 100 - target_weight_pct) <= -3 then 'BUY'
    when ((current_value_eur / allocatable_total_eur) * 100 - target_weight_pct) >= 3 then 'REDUCE'
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
      and abs((current_value_eur / allocatable_total_eur) * 100 - target_weight_pct) < 1 then 'in_band'::text end,
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
    when ((current_value_eur / allocatable_total_eur) * 100 - target_weight_pct) <= -3 then 'NEW_CASH_FIRST'
    when ((current_value_eur / allocatable_total_eur) * 100 - target_weight_pct) >= 3 then 'INTERNAL_ARBITRAGE'
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
from advice_base;

grant select on public.allocation_advice_items_latest to anon, authenticated;
