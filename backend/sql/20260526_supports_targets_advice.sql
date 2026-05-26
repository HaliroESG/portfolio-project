-- Support universe, two-level targets, and allocation advice read models.
-- Additive only. Writes stay backend/service-role; frontend reads are read-only.

create extension if not exists "pgcrypto";

create table if not exists public.support_sources (
  id text primary key,
  source_name text not null,
  source_kind text not null,
  provider text null,
  source_quality text not null default 'COMPLETE',
  source_file text null,
  source_date date null,
  report_json jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.support_sources
  add column if not exists source_quality text not null default 'COMPLETE';

create table if not exists public.investment_supports (
  source_id text not null references public.support_sources(id) on delete cascade,
  isin text not null,
  name text not null,
  support_type text not null default 'UNKNOWN',
  legal_form text null,
  manager text null,
  sri integer null,
  performance_1y_pct numeric null,
  performance_5y_pct numeric null,
  asset_fee_pct numeric null,
  contract_fee_pct numeric null,
  total_fee_pct numeric null,
  retrocession_pct numeric null,
  morningstar_rating numeric null,
  quantalys_rating numeric null,
  computed_momentum_pct numeric null,
  computed_volatility_pct numeric null,
  computed_drawdown_pct numeric null,
  computed_beta numeric null,
  computed_alpha_pct numeric null,
  metrics_state text not null default 'METRICS_UNAVAILABLE',
  score numeric null,
  score_details jsonb not null default '{}'::jsonb,
  page integer null,
  raw_text text null,
  updated_at timestamptz not null default now(),
  primary key (source_id, isin)
);

create index if not exists investment_supports_type_idx
  on public.investment_supports (support_type, score desc nulls last);

create index if not exists investment_supports_sri_idx
  on public.investment_supports (sri);

create table if not exists public.support_availability (
  source_id text not null,
  isin text not null,
  envelope text not null,
  available boolean not null default true,
  constraints_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (source_id, isin, envelope),
  foreign key (source_id, isin) references public.investment_supports(source_id, isin) on delete cascade
);

create table if not exists public.support_source_rows (
  source_id text not null references public.support_sources(id) on delete cascade,
  external_id text not null,
  isin text null,
  name text not null,
  support_type text not null default 'UNKNOWN',
  legal_form text null,
  manager text null,
  sri integer null,
  performance_1y_pct numeric null,
  performance_5y_pct numeric null,
  asset_fee_pct numeric null,
  contract_fee_pct numeric null,
  total_fee_pct numeric null,
  retrocession_pct numeric null,
  source_quality text not null default 'IDENTIFIER_MISSING',
  identifier_state text not null default 'IDENTIFIER_MISSING',
  envelope text not null,
  score numeric null,
  score_details jsonb not null default '{}'::jsonb,
  page integer null,
  raw_text text null,
  updated_at timestamptz not null default now(),
  primary key (source_id, external_id)
);

create index if not exists support_source_rows_envelope_idx
  on public.support_source_rows (envelope, source_quality, identifier_state);

create index if not exists support_source_rows_isin_idx
  on public.support_source_rows (isin)
  where isin is not null;

create table if not exists public.target_models (
  id text primary key,
  portfolio_scope text not null check (portfolio_scope in ('PERSO', 'PRO')),
  model_name text not null,
  source_file text not null,
  source_kind text not null,
  as_of_date date null,
  is_active boolean not null default true,
  target_total_pct numeric null,
  status text not null default 'READY',
  report_json jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists target_models_scope_active_idx
  on public.target_models (portfolio_scope, is_active, updated_at desc);

create table if not exists public.target_buckets (
  id bigserial primary key,
  model_id text not null references public.target_models(id) on delete cascade,
  portfolio_scope text not null check (portfolio_scope in ('PERSO', 'PRO')),
  bucket_key text not null,
  bucket_label text not null,
  parent_bucket_key text null,
  target_weight_pct numeric not null,
  lower_band_pct numeric null,
  upper_band_pct numeric null,
  source_sheet text null,
  source_row integer null,
  updated_at timestamptz not null default now()
);

create unique index if not exists target_buckets_model_bucket_uq
  on public.target_buckets (model_id, bucket_key);

create table if not exists public.target_envelope_lines (
  id bigserial primary key,
  model_id text not null references public.target_models(id) on delete cascade,
  portfolio_scope text not null check (portfolio_scope in ('PERSO', 'PRO')),
  envelope text not null,
  ticker text null,
  isin text null,
  instrument text null,
  asset_class text null,
  region text null,
  currency text null,
  target_weight_pct numeric null,
  target_value_eur numeric null,
  notes text null,
  source_sheet text null,
  source_row integer null,
  updated_at timestamptz not null default now()
);

create index if not exists target_envelope_lines_model_idx
  on public.target_envelope_lines (model_id, envelope);

create index if not exists target_envelope_lines_isin_idx
  on public.target_envelope_lines (isin);

create table if not exists public.target_model_audit_holdings (
  id bigserial primary key,
  model_id text not null references public.target_models(id) on delete cascade,
  portfolio_scope text not null check (portfolio_scope in ('PERSO', 'PRO')),
  envelope text not null,
  ticker text null,
  isin text null,
  instrument text null,
  asset_class text null,
  region text null,
  currency text null,
  market_value_eur numeric null,
  quantity numeric null,
  notes text null,
  source_sheet text null,
  source_row integer null,
  updated_at timestamptz not null default now()
);

create index if not exists target_model_audit_holdings_model_idx
  on public.target_model_audit_holdings (model_id, envelope);

drop view if exists public.allocation_advice_items_latest;

create or replace view public.allocation_advice_items_latest
with (security_invoker = true) as
with active_models as (
  select distinct on (portfolio_scope)
    id,
    portfolio_scope,
    model_name,
    source_file,
    updated_at
  from public.target_models
  where is_active = true
  order by portfolio_scope, updated_at desc
),
position_values as (
  select
    case
      when po.name ilike 'PRO%' then 'PRO'
      when po.name ilike 'PERSO%' then 'PERSO'
      else 'PERSO'
    end as portfolio_scope,
    case
      when upper(coalesce(p.ticker, '')) in ('CASH', 'EUR', 'USD', 'CHF', 'GBP')
        or coalesce(p.instrument_type, '') ilike '%cash%'
        or coalesce(p.instrument_type, '') ilike '%bond%'
        or coalesce(p.name, '') ilike '%fonds euro%'
        or coalesce(p.name, '') ilike '%overnight%'
        or coalesce(p.name, '') ilike '%monétaire%'
        or coalesce(p.name, '') ilike '%money%'
      then 'cash_bonds'
      when coalesce(p.name, '') ilike '%gold%'
        or coalesce(p.name, '') ilike '%or%'
        or upper(coalesce(p.ticker, '')) in ('GOLD', 'GLD')
      then 'gold'
      when coalesce(p.name, '') ilike '%japan%'
        or coalesce(p.name, '') ilike '%japon%'
        or upper(coalesce(p.ticker, '')) in ('CJPU', 'EWJ')
      then 'actions_japan'
      when coalesce(p.name, '') ilike '%pacific%'
        or coalesce(p.name, '') ilike '%asia pacific%'
        or upper(coalesce(p.ticker, '')) in ('CPXJ', 'CSPXJ')
      then 'actions_pacific_ex_japan'
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
    p.portfolio_id,
    p.ticker,
    p.name,
    case
      when p.quantity_current is null then null
      when coalesce(nullif(m.last_price::numeric, 0), nullif(p.pru::numeric, 0)) is null then null
      when upper(coalesce(nullif(p.currency, ''), nullif(m.currency, ''), 'EUR')) = 'EUR'
        then p.quantity_current::numeric * coalesce(nullif(m.last_price::numeric, 0), nullif(p.pru::numeric, 0))
      when nullif(c.rate_to_eur::numeric, 0) is null then null
      else p.quantity_current::numeric * coalesce(nullif(m.last_price::numeric, 0), nullif(p.pru::numeric, 0)) * c.rate_to_eur::numeric
    end as current_value_eur
  from public.portfolio_positions p
  left join public.portfolios po
    on po.id = p.portfolio_id
  left join public.market_watch m
    on upper(m.ticker) = upper(p.ticker)
  left join public.currencies c
    on upper(c.id) = upper(coalesce(nullif(p.currency, ''), nullif(m.currency, ''), 'EUR'))
),
current_by_bucket as (
  select
    portfolio_scope,
    bucket_key,
    sum(coalesce(current_value_eur, 0)) as current_value_eur,
    count(*) filter (where current_value_eur is null) as unavailable_positions
  from position_values
  where bucket_key <> 'unmapped'
  group by portfolio_scope, bucket_key
),
portfolio_totals as (
  select
    portfolio_scope,
    sum(coalesce(current_value_eur, 0)) as total_value_eur
  from position_values
  where bucket_key <> 'unmapped'
  group by portfolio_scope
),
base as (
  select
    m.portfolio_scope,
    m.id as model_id,
    m.model_name,
    m.source_file,
    b.bucket_key,
    b.bucket_label,
    b.target_weight_pct,
    b.lower_band_pct,
    b.upper_band_pct,
    coalesce(c.current_value_eur, 0) as current_value_eur,
    coalesce(pt.total_value_eur, 0) as total_value_eur,
    coalesce(c.unavailable_positions, 0) as unavailable_positions,
    m.updated_at
  from active_models m
  join public.target_buckets b
    on b.model_id = m.id
  left join current_by_bucket c
    on c.portfolio_scope = m.portfolio_scope
    and c.bucket_key = b.bucket_key
  left join portfolio_totals pt
    on pt.portfolio_scope = m.portfolio_scope
)
select
  portfolio_scope,
  model_id,
  model_name,
  source_file,
  bucket_key,
  bucket_label,
  current_value_eur,
  case when total_value_eur > 0 then (current_value_eur / total_value_eur) * 100 else null end as current_weight_pct,
  target_weight_pct,
  case when total_value_eur > 0 then (current_value_eur / total_value_eur) * 100 - target_weight_pct else null end as drift_pct,
  case when total_value_eur > 0 then (target_weight_pct / 100) * total_value_eur - current_value_eur else null end as rebalance_amount_eur,
  case
    when total_value_eur <= 0 then 'UNAVAILABLE'
    when unavailable_positions > 0 then 'UNAVAILABLE'
    when (target_weight_pct = 0 and current_value_eur >= 100) then 'REDUCE'
    when ((current_value_eur / total_value_eur) * 100 - target_weight_pct) <= -3 then 'BUY'
    when ((current_value_eur / total_value_eur) * 100 - target_weight_pct) >= 3 then 'REDUCE'
    else 'HOLD'
  end as action,
  greatest(
    0,
    100
    - case when total_value_eur <= 0 then 40 else 0 end
    - case when unavailable_positions > 0 then 30 else 0 end
  )::integer as confidence,
  array_remove(array[
    case when total_value_eur <= 0 then 'current_total_unavailable'::text end,
    case when unavailable_positions > 0 then 'position_value_unavailable'::text end,
    case when total_value_eur > 0 and abs((current_value_eur / total_value_eur) * 100 - target_weight_pct) < 1 then 'in_band'::text end,
    case when total_value_eur > 0 and abs(((target_weight_pct / 100) * total_value_eur - current_value_eur)) < 100 then 'below_min_trade'::text end,
    'flows_first'::text
  ], null) as reason_codes,
  case
    when total_value_eur <= 0 or unavailable_positions > 0 then 'CURRENT_UNAVAILABLE'
    when ((current_value_eur / total_value_eur) * 100 - target_weight_pct) <= -3 then 'NEW_CASH_FIRST'
    when ((current_value_eur / total_value_eur) * 100 - target_weight_pct) >= 3 then 'INTERNAL_ARBITRAGE'
    else 'MONITOR'
  end as preferred_execution,
  updated_at
from base;

alter table public.support_sources enable row level security;
alter table public.investment_supports enable row level security;
alter table public.support_availability enable row level security;
alter table public.support_source_rows enable row level security;
alter table public.target_models enable row level security;
alter table public.target_buckets enable row level security;
alter table public.target_envelope_lines enable row level security;
alter table public.target_model_audit_holdings enable row level security;

drop policy if exists support_sources_read on public.support_sources;
create policy support_sources_read on public.support_sources for select to anon, authenticated using (true);
drop policy if exists investment_supports_read on public.investment_supports;
create policy investment_supports_read on public.investment_supports for select to anon, authenticated using (true);
drop policy if exists support_availability_read on public.support_availability;
create policy support_availability_read on public.support_availability for select to anon, authenticated using (true);
drop policy if exists support_source_rows_read on public.support_source_rows;
create policy support_source_rows_read on public.support_source_rows for select to anon, authenticated using (true);
drop policy if exists target_models_read on public.target_models;
create policy target_models_read on public.target_models for select to anon, authenticated using (true);
drop policy if exists target_buckets_read on public.target_buckets;
create policy target_buckets_read on public.target_buckets for select to anon, authenticated using (true);
drop policy if exists target_envelope_lines_read on public.target_envelope_lines;
create policy target_envelope_lines_read on public.target_envelope_lines for select to anon, authenticated using (true);
drop policy if exists target_model_audit_holdings_read on public.target_model_audit_holdings;
create policy target_model_audit_holdings_read on public.target_model_audit_holdings for select to anon, authenticated using (true);

drop policy if exists support_sources_service_role_write on public.support_sources;
create policy support_sources_service_role_write on public.support_sources for all to service_role using (true) with check (true);
drop policy if exists investment_supports_service_role_write on public.investment_supports;
create policy investment_supports_service_role_write on public.investment_supports for all to service_role using (true) with check (true);
drop policy if exists support_availability_service_role_write on public.support_availability;
create policy support_availability_service_role_write on public.support_availability for all to service_role using (true) with check (true);
drop policy if exists support_source_rows_service_role_write on public.support_source_rows;
create policy support_source_rows_service_role_write on public.support_source_rows for all to service_role using (true) with check (true);
drop policy if exists target_models_service_role_write on public.target_models;
create policy target_models_service_role_write on public.target_models for all to service_role using (true) with check (true);
drop policy if exists target_buckets_service_role_write on public.target_buckets;
create policy target_buckets_service_role_write on public.target_buckets for all to service_role using (true) with check (true);
drop policy if exists target_envelope_lines_service_role_write on public.target_envelope_lines;
create policy target_envelope_lines_service_role_write on public.target_envelope_lines for all to service_role using (true) with check (true);
drop policy if exists target_model_audit_holdings_service_role_write on public.target_model_audit_holdings;
create policy target_model_audit_holdings_service_role_write on public.target_model_audit_holdings for all to service_role using (true) with check (true);

grant usage on schema public to anon, authenticated, service_role;
grant select on table
  public.support_sources,
  public.investment_supports,
  public.support_availability,
  public.support_source_rows,
  public.target_models,
  public.target_buckets,
  public.target_envelope_lines,
  public.target_model_audit_holdings
to anon, authenticated;

grant select on public.allocation_advice_items_latest to anon, authenticated;

grant select, insert, update, delete on table
  public.support_sources,
  public.investment_supports,
  public.support_availability,
  public.support_source_rows,
  public.target_models,
  public.target_buckets,
  public.target_envelope_lines,
  public.target_model_audit_holdings
to service_role;

grant usage, select on sequence
  public.target_buckets_id_seq,
  public.target_envelope_lines_id_seq,
  public.target_model_audit_holdings_id_seq
to service_role;
