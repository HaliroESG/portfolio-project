-- Global macro strategy pilotage read model.
-- Additive only: backend/service-role writes, frontend reads explicit states.

create extension if not exists "pgcrypto";

drop view if exists public.macro_allocation_advice_latest;
drop view if exists public.macro_satellite_targets_latest;
drop view if exists public.macro_series_latest;

create table if not exists public.macro_series_points (
  series_id text not null,
  as_of_date date not null,
  name text not null,
  value numeric null,
  previous_value numeric null,
  change_abs numeric null,
  change_pct numeric null,
  frequency text not null default 'UNKNOWN',
  source_provider text not null,
  source_url text null,
  data_state text not null default 'UNKNOWN',
  reason_codes text[] not null default '{}'::text[],
  collected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (series_id, as_of_date),
  check (data_state in ('READY', 'PARTIAL', 'STALE', 'UNKNOWN', 'MISSING'))
);

create index if not exists macro_series_points_latest_idx
  on public.macro_series_points (series_id, as_of_date desc, updated_at desc);

create table if not exists public.macro_regime_snapshots (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null unique,
  regime text not null,
  regime_state text not null default 'UNKNOWN',
  confidence integer not null default 0,
  growth_signal text not null default 'UNKNOWN',
  inflation_signal text not null default 'UNKNOWN',
  liquidity_signal text not null default 'UNKNOWN',
  growth_score numeric null,
  inflation_score numeric null,
  liquidity_score numeric null,
  evidence jsonb not null default '{}'::jsonb,
  reason_codes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (regime in ('REFLATION', 'GOLDILOCKS', 'STAGFLATION', 'DEFLATION', 'UNKNOWN')),
  check (regime_state in ('READY', 'PARTIAL', 'STALE', 'UNKNOWN')),
  check (growth_signal in ('UP', 'DOWN', 'UNKNOWN')),
  check (inflation_signal in ('UP', 'DOWN', 'UNKNOWN')),
  check (liquidity_signal in ('LOOSE', 'NEUTRAL', 'TIGHT', 'UNKNOWN')),
  check (confidence >= 0 and confidence <= 100)
);

create index if not exists macro_regime_snapshots_latest_idx
  on public.macro_regime_snapshots (as_of_date desc, updated_at desc);

create table if not exists public.macro_satellite_targets (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.macro_regime_snapshots(id) on delete cascade,
  as_of_date date not null,
  regime text not null,
  bucket_key text not null,
  bucket_label text not null,
  instrument_symbol text null,
  instrument_name text null,
  target_weight_pct numeric not null,
  effective_weight_pct numeric not null,
  satellite_weight_pct numeric not null default 30,
  recommended_envelope text not null default 'CTO',
  trend_ticker text null,
  trend_state text not null default 'UNKNOWN',
  ma200_status text null,
  data_state text not null default 'UNKNOWN',
  is_blocked boolean not null default false,
  reason_codes text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  unique (snapshot_id, bucket_key),
  check (regime in ('REFLATION', 'GOLDILOCKS', 'STAGFLATION', 'DEFLATION', 'UNKNOWN')),
  check (target_weight_pct >= 0 and target_weight_pct <= 100),
  check (effective_weight_pct >= 0 and effective_weight_pct <= 100),
  check (satellite_weight_pct >= 0 and satellite_weight_pct <= 100),
  check (recommended_envelope in ('CTO', 'PEA', 'PER', 'CASH')),
  check (trend_state in ('BULLISH', 'BEARISH', 'NEUTRAL', 'UNKNOWN', 'INSUFFICIENT_HISTORY', 'NOT_APPLICABLE')),
  check (ma200_status in ('above', 'below') or ma200_status is null),
  check (data_state in ('READY', 'BLOCKED_TREND', 'TREND_UNKNOWN', 'REGIME_UNKNOWN', 'REGIME_PARTIAL', 'UNKNOWN'))
);

create index if not exists macro_satellite_targets_snapshot_idx
  on public.macro_satellite_targets (snapshot_id, bucket_key);

create index if not exists macro_satellite_targets_latest_idx
  on public.macro_satellite_targets (as_of_date desc, regime, bucket_key);

alter table public.macro_series_points enable row level security;
alter table public.macro_regime_snapshots enable row level security;
alter table public.macro_satellite_targets enable row level security;

drop policy if exists macro_series_points_read on public.macro_series_points;
create policy macro_series_points_read on public.macro_series_points
  for select to anon, authenticated using (true);

drop policy if exists macro_regime_snapshots_read on public.macro_regime_snapshots;
create policy macro_regime_snapshots_read on public.macro_regime_snapshots
  for select to anon, authenticated using (true);

drop policy if exists macro_satellite_targets_read on public.macro_satellite_targets;
create policy macro_satellite_targets_read on public.macro_satellite_targets
  for select to anon, authenticated using (true);

create or replace view public.macro_series_latest
with (security_invoker = true) as
select distinct on (series_id)
  series_id,
  as_of_date,
  name,
  value,
  previous_value,
  change_abs,
  change_pct,
  frequency,
  source_provider,
  source_url,
  data_state,
  reason_codes,
  collected_at,
  updated_at
from public.macro_series_points
order by series_id, as_of_date desc, updated_at desc;

create or replace view public.macro_satellite_targets_latest
with (security_invoker = true) as
with latest_snapshot as (
  select id
  from public.macro_regime_snapshots
  order by as_of_date desc, updated_at desc
  limit 1
)
select
  t.id,
  t.snapshot_id,
  t.as_of_date,
  t.regime,
  r.regime_state,
  r.confidence as regime_confidence,
  t.bucket_key,
  t.bucket_label,
  t.instrument_symbol,
  t.instrument_name,
  t.target_weight_pct,
  t.effective_weight_pct,
  t.satellite_weight_pct,
  t.recommended_envelope,
  t.trend_ticker,
  t.trend_state,
  t.ma200_status,
  t.data_state,
  t.is_blocked,
  t.reason_codes,
  t.updated_at
from public.macro_satellite_targets t
join latest_snapshot ls on ls.id = t.snapshot_id
join public.macro_regime_snapshots r on r.id = t.snapshot_id
order by t.bucket_key;

create or replace view public.macro_allocation_advice_latest
with (security_invoker = true) as
with latest_targets as (
  select *
  from public.macro_satellite_targets_latest
),
position_values as (
  select
    p.portfolio_id,
    case
      when upper(coalesce(p.ticker, '')) in ('CPER', 'COPX', 'COPA', 'HG=F')
        or coalesce(p.name, '') ilike '%copper%'
        or coalesce(p.name, '') ilike '%cuivre%'
      then 'copper'
      when upper(coalesce(p.ticker, '')) in ('XLE', 'VDE', 'XOP', 'IXC')
        or coalesce(p.name, '') ilike '%energy%'
        or coalesce(p.name, '') ilike '%energie%'
        or coalesce(p.name, '') ilike '%énergie%'
      then 'energy'
      when upper(coalesce(p.ticker, '')) in ('EEM', 'IEMG', 'EIMI', 'EMIM', 'NDIA')
        or coalesce(p.name, '') ilike '%emerging%'
        or coalesce(p.name, '') ilike '%emerg%'
        or coalesce(p.name, '') ilike '%india%'
      then 'emerging_equities'
      when upper(coalesce(p.ticker, '')) in ('QQQ', 'XLK', 'CNDX', 'UST', 'NASD')
        or coalesce(p.name, '') ilike '%nasdaq%'
        or coalesce(p.name, '') ilike '%technology%'
        or coalesce(p.name, '') ilike '%technolog%'
      then 'technology'
      when upper(coalesce(p.ticker, '')) in ('HYG', 'JNK', 'IHYG', 'HYLD')
        or coalesce(p.name, '') ilike '%high yield%'
      then 'high_yield'
      when upper(coalesce(p.ticker, '')) in ('GLD', 'IAU', 'PHAU', 'SGLD', 'GOLD')
        or coalesce(p.name, '') ilike '%gold%'
        or coalesce(p.name, '') ilike '%physique or%'
      then 'gold'
      when upper(coalesce(p.ticker, '')) in ('DBC', 'BCOM', 'GSG', 'COMT')
        or coalesce(p.name, '') ilike '%commodity%'
        or coalesce(p.name, '') ilike '%commodities%'
        or coalesce(p.name, '') ilike '%matiere%'
        or coalesce(p.name, '') ilike '%matière%'
      then 'commodities'
      when upper(coalesce(p.ticker, '')) in ('TLT', 'EDV', 'GOVZ', 'DTLA')
        or coalesce(p.name, '') ilike '%20+ year treasury%'
        or coalesce(p.name, '') ilike '%long treasury%'
        or coalesce(p.name, '') ilike '%treasury 20%'
      then 'long_treasury'
      when upper(coalesce(p.ticker, '')) in ('CASH', 'EUR', 'USD', 'SHY', 'BIL')
        or coalesce(p.instrument_type, '') ilike '%cash%'
        or coalesce(p.instrument_type, '') ilike '%money%'
        or coalesce(p.name, '') ilike '%cash%'
        or coalesce(p.name, '') ilike '%monetaire%'
        or coalesce(p.name, '') ilike '%monétaire%'
      then 'cash'
      else null
    end as bucket_key,
    p.ticker,
    case
      when p.quantity_current is null then null
      when coalesce(nullif(m.last_price::numeric, 0), nullif(p.pru::numeric, 0)) is null then null
      when upper(coalesce(nullif(p.currency, ''), nullif(m.currency, ''), 'EUR')) = 'EUR'
        then p.quantity_current::numeric * coalesce(nullif(m.last_price::numeric, 0), nullif(p.pru::numeric, 0))
      when nullif(c.rate_to_eur::numeric, 0) is null then null
      else p.quantity_current::numeric
        * coalesce(nullif(m.last_price::numeric, 0), nullif(p.pru::numeric, 0))
        * c.rate_to_eur::numeric
    end as current_value_eur,
    greatest(p.updated_at, m.last_update) as updated_at
  from public.portfolio_positions p
  left join public.market_watch m on upper(m.ticker) = upper(p.ticker)
  left join public.currencies c
    on upper(c.id) = upper(coalesce(nullif(p.currency, ''), nullif(m.currency, ''), 'EUR'))
),
portfolio_totals as (
  select
    portfolio_id,
    sum(coalesce(current_value_eur, 0)) as total_value_eur,
    max(updated_at) as updated_at
  from position_values
  group by portfolio_id
),
current_by_bucket as (
  select
    portfolio_id,
    bucket_key,
    sum(coalesce(current_value_eur, 0)) as current_value_eur
  from position_values
  where bucket_key is not null
  group by portfolio_id, bucket_key
),
portfolios_with_value as (
  select portfolio_id
  from portfolio_totals
  where total_value_eur > 0
),
decision_base as (
  select
    p.portfolio_id,
    t.snapshot_id,
    t.as_of_date,
    t.regime,
    t.regime_state,
    t.regime_confidence,
    t.bucket_key,
    t.bucket_label,
    t.instrument_symbol,
    t.instrument_name,
    t.recommended_envelope,
    t.target_weight_pct as model_target_weight_pct,
    t.effective_weight_pct as target_weight_pct,
    coalesce(cb.current_value_eur, 0)::numeric as current_value_eur,
    pt.total_value_eur,
    case
      when pt.total_value_eur > 0 then (coalesce(cb.current_value_eur, 0) / pt.total_value_eur) * 100
      else null
    end as current_weight_pct,
    case
      when pt.total_value_eur > 0 then ((coalesce(cb.current_value_eur, 0) / pt.total_value_eur) * 100) - t.effective_weight_pct
      else null
    end as drift_pct,
    case
      when pt.total_value_eur > 0 then (t.effective_weight_pct / 100) * pt.total_value_eur - coalesce(cb.current_value_eur, 0)
      else null
    end as rebalance_amount_eur,
    t.trend_ticker,
    t.trend_state,
    t.ma200_status,
    t.data_state as macro_data_state,
    t.is_blocked,
    t.reason_codes as macro_reason_codes,
    greatest(t.updated_at, pt.updated_at) as updated_at
  from portfolios_with_value p
  cross join latest_targets t
  join portfolio_totals pt on pt.portfolio_id = p.portfolio_id
  left join current_by_bucket cb
    on cb.portfolio_id = p.portfolio_id
   and cb.bucket_key = t.bucket_key
)
select
  portfolio_id,
  snapshot_id,
  as_of_date,
  regime,
  regime_state,
  bucket_key,
  bucket_label,
  instrument_symbol,
  instrument_name,
  recommended_envelope,
  model_target_weight_pct,
  target_weight_pct,
  current_value_eur,
  current_weight_pct,
  drift_pct,
  rebalance_amount_eur,
  case
    when total_value_eur is null or total_value_eur <= 0 then 'UNAVAILABLE'
    when macro_data_state in ('TREND_UNKNOWN', 'REGIME_UNKNOWN', 'UNKNOWN') then 'UNAVAILABLE'
    when macro_data_state = 'BLOCKED_TREND' and current_value_eur >= 100 then 'REDUCE'
    when macro_data_state = 'BLOCKED_TREND' then 'HOLD'
    when abs(coalesce(rebalance_amount_eur, 0)) < 100 then 'HOLD'
    when rebalance_amount_eur > 0 then 'BUY'
    when rebalance_amount_eur < 0 then 'REDUCE'
    else 'HOLD'
  end as action,
  greatest(
    0,
    least(
      100,
      coalesce(regime_confidence, 0)
      - case when macro_data_state in ('TREND_UNKNOWN', 'UNKNOWN') then 25 else 0 end
      - case when macro_data_state = 'REGIME_PARTIAL' then 10 else 0 end
      - case when macro_data_state = 'BLOCKED_TREND' then 15 else 0 end
    )
  )::integer as confidence,
  macro_data_state as data_state,
  array_remove(array_cat(
    coalesce(macro_reason_codes, '{}'::text[]),
    array[
      case when total_value_eur is null or total_value_eur <= 0 then 'portfolio_value_missing'::text end,
      case when abs(coalesce(rebalance_amount_eur, 0)) < 100 then 'below_min_trade'::text end
    ]
  ), null) as reason_codes,
  trend_ticker,
  trend_state,
  ma200_status,
  is_blocked,
  total_value_eur,
  updated_at
from decision_base;

grant select on public.macro_series_points to anon, authenticated;
grant select on public.macro_regime_snapshots to anon, authenticated;
grant select on public.macro_satellite_targets to anon, authenticated;
grant select on public.macro_series_latest to anon, authenticated;
grant select on public.macro_satellite_targets_latest to anon, authenticated;
grant select on public.macro_allocation_advice_latest to anon, authenticated;
