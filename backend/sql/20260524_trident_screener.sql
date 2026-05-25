-- Trident global equity screener
-- Additive schema. Supabase remains the runtime source of truth for frontend reads.

create table if not exists public.trident_equity_universe (
  instrument_key text primary key,
  ticker text not null,
  name text,
  exchange text,
  country text,
  sector text,
  industry text,
  currency text,
  isin text,
  provider text not null,
  provider_symbol text not null,
  source_license_note text,
  source_index text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  check (instrument_key = lower(instrument_key)),
  check (currency is null or char_length(currency) = 3)
);

create unique index if not exists trident_equity_universe_provider_symbol_idx
  on public.trident_equity_universe (provider, provider_symbol);

create index if not exists trident_equity_universe_search_idx
  on public.trident_equity_universe (ticker, name);

create index if not exists trident_equity_universe_filters_idx
  on public.trident_equity_universe (country, exchange, sector);

alter table public.trident_equity_universe
  add column if not exists source_index text;

create index if not exists trident_equity_universe_source_index_idx
  on public.trident_equity_universe (provider, source_index);

create table if not exists public.trident_financial_annual (
  instrument_key text not null references public.trident_equity_universe(instrument_key) on delete cascade,
  fiscal_year integer not null,
  fiscal_period_end date,
  currency text,
  revenue numeric,
  eps_diluted numeric,
  free_cash_flow numeric,
  gross_profit numeric,
  operating_income numeric,
  net_income numeric,
  invested_capital numeric,
  total_equity numeric,
  capital_employed numeric,
  ebitda numeric,
  net_debt numeric,
  interest_expense numeric,
  total_debt numeric,
  shares_diluted numeric,
  provider text not null,
  source_url text,
  updated_at timestamptz not null default now(),
  primary key (instrument_key, fiscal_year),
  check (currency is null or char_length(currency) = 3)
);

create index if not exists trident_financial_annual_year_idx
  on public.trident_financial_annual (instrument_key, fiscal_year desc);

create table if not exists public.trident_results (
  instrument_key text primary key references public.trident_equity_universe(instrument_key) on delete cascade,
  as_of_date date not null,
  latest_fiscal_year integer,
  overall_state text not null check (overall_state in ('QUALIFIED', 'WATCHLIST', 'REJECTED', 'NO_DATA')),
  score numeric not null default 0,
  confidence numeric not null default 0,
  growth_score numeric not null default 0,
  profitability_score numeric not null default 0,
  capital_score numeric not null default 0,
  health_score numeric not null default 0,
  latest_roic numeric,
  latest_net_debt_to_ebitda numeric,
  failed_eliminators text[] not null default '{}',
  horizons jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (score >= 0 and score <= 100),
  check (confidence >= 0 and confidence <= 100)
);

alter table public.trident_results
  drop constraint if exists trident_results_overall_state_check;

update public.trident_results
set overall_state = case overall_state
  when 'PASS' then 'QUALIFIED'
  when 'PARTIAL' then 'WATCHLIST'
  when 'FAIL' then 'REJECTED'
  else overall_state
end
where overall_state in ('PASS', 'PARTIAL', 'FAIL');

alter table public.trident_results
  add constraint trident_results_overall_state_check
  check (overall_state in ('QUALIFIED', 'WATCHLIST', 'REJECTED', 'NO_DATA'));

create index if not exists trident_results_score_idx
  on public.trident_results (score desc, confidence desc);

create index if not exists trident_results_state_idx
  on public.trident_results (overall_state);

create index if not exists trident_results_roic_idx
  on public.trident_results (latest_roic desc nulls last);

create table if not exists public.trident_criterion_results (
  instrument_key text not null references public.trident_equity_universe(instrument_key) on delete cascade,
  horizon_years integer not null check (horizon_years in (1, 3, 5, 10)),
  criterion_key text not null,
  category text not null check (category in ('growth', 'profitability', 'capital', 'health')),
  label text not null,
  status text not null check (status in ('pass', 'fail', 'missing', 'not_applicable')),
  actual numeric,
  threshold numeric,
  comparator text,
  is_eliminating boolean not null default false,
  reason text,
  updated_at timestamptz not null default now(),
  primary key (instrument_key, horizon_years, criterion_key)
);

create index if not exists trident_criterion_results_lookup_idx
  on public.trident_criterion_results (instrument_key, horizon_years, category);

create index if not exists trident_criterion_results_status_idx
  on public.trident_criterion_results (status, category);

alter table public.trident_equity_universe enable row level security;
alter table public.trident_financial_annual enable row level security;
alter table public.trident_results enable row level security;
alter table public.trident_criterion_results enable row level security;

drop policy if exists trident_equity_universe_read on public.trident_equity_universe;
create policy trident_equity_universe_read on public.trident_equity_universe
  for select to anon, authenticated using (true);

drop policy if exists trident_financial_annual_read on public.trident_financial_annual;
create policy trident_financial_annual_read on public.trident_financial_annual
  for select to anon, authenticated using (true);

drop policy if exists trident_results_read on public.trident_results;
create policy trident_results_read on public.trident_results
  for select to anon, authenticated using (true);

drop policy if exists trident_criterion_results_read on public.trident_criterion_results;
create policy trident_criterion_results_read on public.trident_criterion_results
  for select to anon, authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on table
  public.trident_equity_universe,
  public.trident_financial_annual,
  public.trident_results,
  public.trident_criterion_results
to anon, authenticated;

drop view if exists public.trident_screener_latest;

create or replace view public.trident_screener_latest
with (security_invoker = true) as
select
  u.instrument_key,
  u.ticker,
  u.name,
  u.exchange,
  u.country,
  u.sector,
  u.industry,
  u.currency,
  u.provider,
  u.provider_symbol,
  u.provider as source_provider,
  u.source_index,
  u.source_license_note,
  u.is_active,
  r.as_of_date,
  r.latest_fiscal_year,
  r.overall_state,
  r.score,
  r.confidence,
  r.growth_score,
  r.profitability_score,
  r.capital_score,
  r.health_score,
  r.latest_roic,
  r.latest_net_debt_to_ebitda,
  r.failed_eliminators,
  r.horizons,
  r.summary,
  nullif(r.summary->>'criteria_pass', '')::integer as criteria_pass_count,
  nullif(r.summary->>'criteria_fail', '')::integer as criteria_fail_count,
  nullif(r.summary->>'criteria_missing', '')::integer as criteria_missing_count,
  greatest(u.updated_at, r.updated_at) as updated_at
from public.trident_equity_universe u
left join public.trident_results r
  on r.instrument_key = u.instrument_key
where u.is_active = true;

grant select on public.trident_screener_latest to anon, authenticated;
