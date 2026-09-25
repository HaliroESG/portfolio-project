-- Equity publications and reporting calendar.
-- Additive contract: backend-only writes, registered-owner reads.

create table if not exists public.equity_index_memberships (
  index_key text not null check (index_key in ('cac_40', 'sp500')),
  index_name text not null check (index_name in ('CAC 40', 'S&P 500')),
  instrument_key text not null
    references public.trident_equity_universe(instrument_key) on delete cascade,
  provider_symbol text not null,
  is_active boolean not null default true,
  source_provider text not null,
  source_url text,
  as_of_date date not null default current_date,
  updated_at timestamptz not null default now(),
  primary key (index_key, instrument_key),
  unique (index_key, provider_symbol)
);

create index if not exists equity_index_memberships_instrument_idx
  on public.equity_index_memberships (instrument_key, index_key)
  where is_active;

insert into public.equity_index_memberships (
  index_key,
  index_name,
  instrument_key,
  provider_symbol,
  source_provider
)
select
  case universe.source_index when 'CAC 40' then 'cac_40' else 'sp500' end,
  universe.source_index,
  universe.instrument_key,
  universe.provider_symbol,
  universe.provider
from public.trident_equity_universe universe
where universe.is_active = true
  and universe.source_index in ('CAC 40', 'S&P 500')
on conflict (index_key, instrument_key) do nothing;

create table if not exists public.equity_financial_interim (
  instrument_key text not null
    references public.trident_equity_universe(instrument_key) on delete cascade,
  fiscal_period_end date not null,
  fiscal_year integer not null,
  period_kind text not null
    check (period_kind in ('Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'INTERIM')),
  period_months integer check (period_months is null or period_months between 1 and 12),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  revenue numeric,
  ebitda numeric,
  operating_income numeric,
  net_income numeric,
  eps_diluted numeric,
  operating_cash_flow numeric,
  capital_expenditure numeric,
  free_cash_flow numeric,
  data_state text not null default 'PARTIAL'
    check (data_state in ('READY', 'PARTIAL', 'STALE', 'MISSING')),
  reason_codes text[] not null default '{}',
  source_provider text not null,
  source_url text,
  collected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (instrument_key, fiscal_period_end, period_kind)
);

create index if not exists equity_financial_interim_latest_idx
  on public.equity_financial_interim (instrument_key, fiscal_period_end desc);

create index if not exists equity_financial_interim_state_idx
  on public.equity_financial_interim (data_state, updated_at desc);

create table if not exists public.equity_reporting_events (
  event_key text primary key,
  instrument_key text not null
    references public.trident_equity_universe(instrument_key) on delete cascade,
  event_type text not null
    check (event_type in ('EARNINGS', 'REGULATORY_FILING')),
  event_label text,
  event_date date not null,
  event_time_utc timestamptz,
  status text not null
    check (status in ('ESTIMATED', 'CONFIRMED', 'REPORTED', 'CANCELLED')),
  fiscal_year integer,
  fiscal_period_end date,
  period_kind text
    check (period_kind is null or period_kind in ('Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'FY', 'INTERIM')),
  filing_date date,
  match_confidence text not null default 'UNKNOWN'
    check (match_confidence in ('HIGH', 'INFERRED', 'UNKNOWN')),
  source_provider text not null,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (event_key = lower(event_key))
);

create index if not exists equity_reporting_events_calendar_idx
  on public.equity_reporting_events (event_date, status)
  where status <> 'CANCELLED';

create index if not exists equity_reporting_events_instrument_idx
  on public.equity_reporting_events (instrument_key, event_date desc);

create index if not exists equity_reporting_events_period_idx
  on public.equity_reporting_events (instrument_key, fiscal_period_end)
  where fiscal_period_end is not null;

create table if not exists public.equity_reporting_event_revisions (
  id bigint generated always as identity primary key,
  event_key text not null,
  instrument_key text not null,
  previous_event_date date,
  new_event_date date,
  previous_status text,
  new_status text,
  source_provider text not null,
  changed_at timestamptz not null default now()
);

create index if not exists equity_reporting_event_revisions_event_idx
  on public.equity_reporting_event_revisions (event_key, changed_at desc);

create or replace function public.capture_equity_reporting_event_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.event_date is distinct from new.event_date
     or old.status is distinct from new.status then
    insert into public.equity_reporting_event_revisions (
      event_key,
      instrument_key,
      previous_event_date,
      new_event_date,
      previous_status,
      new_status,
      source_provider
    )
    values (
      old.event_key,
      old.instrument_key,
      old.event_date,
      new.event_date,
      old.status,
      new.status,
      new.source_provider
    );
  end if;
  return new;
end;
$$;

drop trigger if exists equity_reporting_event_revision_trigger
  on public.equity_reporting_events;
create trigger equity_reporting_event_revision_trigger
after update on public.equity_reporting_events
for each row execute function public.capture_equity_reporting_event_revision();

revoke all on function public.capture_equity_reporting_event_revision()
  from public, anon, authenticated;
grant execute on function public.capture_equity_reporting_event_revision()
  to service_role;

alter table public.equity_financial_interim enable row level security;
alter table public.equity_reporting_events enable row level security;
alter table public.equity_reporting_event_revisions enable row level security;
alter table public.equity_index_memberships enable row level security;

revoke all on public.equity_financial_interim from public, anon, authenticated;
revoke all on public.equity_reporting_events from public, anon, authenticated;
revoke all on public.equity_reporting_event_revisions from public, anon, authenticated;
revoke all on public.equity_index_memberships from public, anon, authenticated;

drop policy if exists fo_registered_owner_read on public.equity_index_memberships;
create policy fo_registered_owner_read on public.equity_index_memberships
  for select to authenticated
  using (
    exists (
      select 1
      from public.fo_owner_profiles profile
      where profile.user_id = (select auth.uid())
    )
  );

drop policy if exists fo_registered_owner_read on public.equity_financial_interim;
create policy fo_registered_owner_read on public.equity_financial_interim
  for select to authenticated
  using (
    exists (
      select 1
      from public.fo_owner_profiles profile
      where profile.user_id = (select auth.uid())
    )
  );

drop policy if exists fo_registered_owner_read on public.equity_reporting_events;
create policy fo_registered_owner_read on public.equity_reporting_events
  for select to authenticated
  using (
    exists (
      select 1
      from public.fo_owner_profiles profile
      where profile.user_id = (select auth.uid())
    )
  );

drop policy if exists fo_registered_owner_read on public.equity_reporting_event_revisions;
create policy fo_registered_owner_read on public.equity_reporting_event_revisions
  for select to authenticated
  using (
    exists (
      select 1
      from public.fo_owner_profiles profile
      where profile.user_id = (select auth.uid())
    )
  );

grant select on public.equity_financial_interim to authenticated;
grant select on public.equity_reporting_events to authenticated;
grant select on public.equity_reporting_event_revisions to authenticated;
grant select on public.equity_index_memberships to authenticated;
grant all on public.equity_financial_interim to service_role;
grant all on public.equity_reporting_events to service_role;
grant all on public.equity_reporting_event_revisions to service_role;
grant all on public.equity_index_memberships to service_role;
grant usage, select on all sequences in schema public to service_role;

create or replace view public.equity_publication_dashboard_latest
with (security_invoker = true) as
with target_universe as (
  select
    u.instrument_key,
    u.ticker,
    u.name,
    u.exchange,
    u.country,
    u.sector,
    u.industry,
    u.currency,
    u.provider_symbol,
    membership.index_name as source_index,
    u.updated_at
  from public.trident_equity_universe u
  join public.equity_index_memberships membership
    on membership.instrument_key = u.instrument_key
   and membership.is_active = true
  where u.is_active = true
    and membership.index_key in ('cac_40', 'sp500')
),
annual_ranked as (
  select
    annual.*,
    row_number() over (
      partition by annual.instrument_key
      order by annual.fiscal_period_end desc nulls last, annual.fiscal_year desc
    ) as row_rank
  from public.trident_financial_annual annual
  join target_universe target using (instrument_key)
),
interim_ranked as (
  select
    interim.*,
    row_number() over (
      partition by interim.instrument_key
      order by interim.fiscal_period_end desc, interim.updated_at desc
    ) as row_rank
  from public.equity_financial_interim interim
  join target_universe target using (instrument_key)
),
ttm_ranked as (
  select
    interim.*,
    row_number() over (
      partition by interim.instrument_key
      order by interim.fiscal_period_end desc, interim.updated_at desc
    ) as row_rank
  from public.equity_financial_interim interim
  join target_universe target using (instrument_key)
  where interim.period_months = 3
),
ttm as (
  select
    instrument_key,
    max(currency) as currency,
    sum(revenue) as revenue,
    sum(ebitda) as ebitda,
    sum(operating_income) as operating_income,
    sum(net_income) as net_income,
    sum(free_cash_flow) as free_cash_flow,
    max(fiscal_period_end) as period_end,
    count(*) = 4
      and count(distinct currency) = 1
      and max(fiscal_period_end) - min(fiscal_period_end) between 240 and 400
      as is_complete
  from ttm_ranked
  where row_rank <= 4
  group by instrument_key
)
select
  target.instrument_key,
  target.ticker,
  target.name,
  target.exchange,
  target.country,
  target.sector,
  target.industry,
  target.currency as company_currency,
  target.provider_symbol,
  target.source_index,
  annual.fiscal_year as annual_fiscal_year,
  annual.fiscal_period_end as annual_period_end,
  annual.currency as annual_currency,
  annual.revenue as annual_revenue,
  annual.ebitda as annual_ebitda,
  annual.operating_income as annual_operating_income,
  annual.net_income as annual_net_income,
  annual.eps_diluted as annual_eps_diluted,
  annual.free_cash_flow as annual_free_cash_flow,
  annual_publication.event_date as annual_published_on,
  interim.fiscal_year as interim_fiscal_year,
  interim.period_kind as interim_period_kind,
  interim.fiscal_period_end as interim_period_end,
  interim.currency as interim_currency,
  interim.revenue as interim_revenue,
  interim.ebitda as interim_ebitda,
  interim.operating_income as interim_operating_income,
  interim.net_income as interim_net_income,
  interim.eps_diluted as interim_eps_diluted,
  interim.free_cash_flow as interim_free_cash_flow,
  interim.data_state as interim_data_state,
  interim.reason_codes as interim_reason_codes,
  interim_publication.event_date as interim_published_on,
  case when ttm.is_complete then ttm.currency end as ttm_currency,
  case when ttm.is_complete then ttm.period_end end as ttm_period_end,
  case when ttm.is_complete then ttm.revenue end as ttm_revenue,
  case when ttm.is_complete then ttm.ebitda end as ttm_ebitda,
  case when ttm.is_complete then ttm.operating_income end as ttm_operating_income,
  case when ttm.is_complete then ttm.net_income end as ttm_net_income,
  case when ttm.is_complete then ttm.free_cash_flow end as ttm_free_cash_flow,
  coalesce(ttm.is_complete, false) as ttm_complete,
  insight.trailing_pe,
  insight.forward_pe,
  insight.updated_at as valuation_as_of,
  last_event.event_type as last_event_type,
  last_event.event_label as last_event_label,
  last_event.event_date as last_event_date,
  last_event.status as last_event_status,
  last_event.source_provider as last_event_source_provider,
  last_event.source_url as last_event_source_url,
  next_event.event_type as next_event_type,
  next_event.event_label as next_event_label,
  next_event.event_date as next_event_date,
  next_event.event_time_utc as next_event_time_utc,
  next_event.status as next_event_status,
  next_event.source_provider as next_event_source_provider,
  next_event.source_url as next_event_source_url,
  case
    when annual.instrument_key is null then 'MISSING'
    when annual.updated_at < now() - interval '400 days' then 'STALE'
    when interim.instrument_key is null or next_event.event_key is null then 'PARTIAL'
    when interim.data_state <> 'READY' then 'PARTIAL'
    else 'READY'
  end as data_state,
  array_remove(array[
    case when annual.instrument_key is null then 'ANNUAL_UNAVAILABLE' end,
    case when annual.updated_at < now() - interval '400 days' then 'ANNUAL_STALE' end,
    case when interim.instrument_key is null then 'INTERIM_UNAVAILABLE' end,
    case when interim.instrument_key is not null and interim.data_state <> 'READY' then 'INTERIM_PARTIAL' end,
    case when not coalesce(ttm.is_complete, false) then 'TTM_INCOMPLETE' end,
    case when next_event.event_key is null then 'NEXT_PUBLICATION_UNAVAILABLE' end,
    case when next_event.status = 'ESTIMATED' then 'PUBLICATION_DATE_ESTIMATED' end
  ], null)::text[] as reason_codes,
  greatest(
    target.updated_at,
    coalesce(annual.updated_at, 'epoch'::timestamptz),
    coalesce(interim.updated_at, 'epoch'::timestamptz),
    coalesce(insight.updated_at, 'epoch'::timestamptz),
    coalesce(last_event.updated_at, 'epoch'::timestamptz),
    coalesce(next_event.updated_at, 'epoch'::timestamptz)
  ) as updated_at
from target_universe target
left join annual_ranked annual
  on annual.instrument_key = target.instrument_key and annual.row_rank = 1
left join interim_ranked interim
  on interim.instrument_key = target.instrument_key and interim.row_rank = 1
left join ttm
  on ttm.instrument_key = target.instrument_key
left join public.trident_stock_insights insight
  on insight.instrument_key = target.instrument_key
left join lateral (
  select event.event_date
  from public.equity_reporting_events event
  where event.instrument_key = target.instrument_key
    and event.fiscal_period_end = annual.fiscal_period_end
    and event.status = 'REPORTED'
  order by
    case event.event_type when 'EARNINGS' then 0 else 1 end,
    event.event_date
  limit 1
) annual_publication on true
left join lateral (
  select event.event_date
  from public.equity_reporting_events event
  where event.instrument_key = target.instrument_key
    and event.fiscal_period_end = interim.fiscal_period_end
    and event.status = 'REPORTED'
  order by
    case event.event_type when 'EARNINGS' then 0 else 1 end,
    event.event_date
  limit 1
) interim_publication on true
left join lateral (
  select event.*
  from public.equity_reporting_events event
  where event.instrument_key = target.instrument_key
    and event.status = 'REPORTED'
    and event.event_date <= current_date
  order by event.event_date desc, event.event_time_utc desc nulls last
  limit 1
) last_event on true
left join lateral (
  select event.*
  from public.equity_reporting_events event
  where event.instrument_key = target.instrument_key
    and event.status in ('ESTIMATED', 'CONFIRMED')
    and event.event_date >= current_date
  order by event.event_date, event.event_time_utc nulls last
  limit 1
) next_event on true;

create or replace view public.equity_reporting_calendar
with (security_invoker = true) as
select
  event.event_key,
  event.instrument_key,
  universe.ticker,
  universe.name,
  universe.provider_symbol,
  membership.index_name as source_index,
  universe.currency,
  event.event_type,
  event.event_label,
  event.event_date,
  event.event_time_utc,
  event.status,
  event.fiscal_year,
  event.fiscal_period_end,
  event.period_kind,
  event.filing_date,
  event.match_confidence,
  event.source_provider,
  event.source_url,
  event.metadata,
  event.first_seen_at,
  event.last_seen_at,
  event.updated_at
from public.equity_reporting_events event
join public.trident_equity_universe universe
  on universe.instrument_key = event.instrument_key
join public.equity_index_memberships membership
  on membership.instrument_key = universe.instrument_key
 and membership.is_active = true
where universe.is_active = true
  and membership.index_key in ('cac_40', 'sp500')
  and event.status <> 'CANCELLED';

revoke all on public.equity_publication_dashboard_latest from public, anon, authenticated;
revoke all on public.equity_reporting_calendar from public, anon, authenticated;
grant select on public.equity_publication_dashboard_latest to authenticated;
grant select on public.equity_reporting_calendar to authenticated;
grant select on public.equity_publication_dashboard_latest to service_role;
grant select on public.equity_reporting_calendar to service_role;
