-- Open equity screener read model.
-- Additive schema: backend/service-role writes normalized rows, frontend reads the latest view.

create table if not exists public.equity_screener_results (
  instrument_key text primary key references public.trident_equity_universe(instrument_key) on delete cascade,
  as_of_date date not null,
  ticker text not null,
  name text,
  exchange text,
  country text,
  sector text,
  industry text,
  currency text,
  provider text not null,
  provider_symbol text,
  source_index text,
  themes text[] not null default '{}',
  latest_fiscal_year integer,
  financial_currency text,
  valuation_currency text,
  market_cap numeric,
  revenue numeric,
  free_cash_flow numeric,
  fcf_margin numeric,
  fcf_yield numeric,
  revenue_cagr_3y numeric,
  revenue_cagr_5y numeric,
  forecast_revenue_growth numeric,
  trailing_pe numeric,
  forward_pe numeric,
  latest_roic numeric,
  latest_net_debt_to_ebitda numeric,
  target_upside numeric,
  recommendation_key text,
  analyst_count integer,
  trident_score numeric,
  trident_state text,
  quality_value_score numeric not null default 0,
  valuation_tag text not null default 'INSUFFICIENT_DATA'
    check (valuation_tag in ('POTENTIAL_VALUE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA')),
  score_details jsonb not null default '{}'::jsonb,
  data_state text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (currency is null or char_length(currency) = 3),
  check (financial_currency is null or char_length(financial_currency) = 3),
  check (valuation_currency is null or char_length(valuation_currency) = 3),
  check (quality_value_score >= 0 and quality_value_score <= 100)
);

create index if not exists equity_screener_results_score_idx
  on public.equity_screener_results (quality_value_score desc, market_cap desc nulls last);

create index if not exists equity_screener_results_filters_idx
  on public.equity_screener_results (country, sector, valuation_tag);

create index if not exists equity_screener_results_themes_idx
  on public.equity_screener_results using gin (themes);

create index if not exists equity_screener_results_updated_idx
  on public.equity_screener_results (updated_at desc);

alter table public.equity_screener_results enable row level security;

drop policy if exists equity_screener_results_read on public.equity_screener_results;
create policy equity_screener_results_read on public.equity_screener_results
  for select to anon, authenticated using (true);

grant select on public.equity_screener_results to anon, authenticated;
grant all on public.equity_screener_results to service_role;

drop view if exists public.equity_screener_latest;

create or replace view public.equity_screener_latest
with (security_invoker = true) as
select
  instrument_key,
  as_of_date,
  ticker,
  name,
  exchange,
  country,
  sector,
  industry,
  currency,
  provider,
  provider_symbol,
  source_index,
  themes,
  latest_fiscal_year,
  financial_currency,
  valuation_currency,
  market_cap,
  revenue,
  free_cash_flow,
  fcf_margin,
  fcf_yield,
  revenue_cagr_3y,
  revenue_cagr_5y,
  forecast_revenue_growth,
  trailing_pe,
  forward_pe,
  latest_roic,
  latest_net_debt_to_ebitda,
  target_upside,
  recommendation_key,
  analyst_count,
  trident_score,
  trident_state,
  quality_value_score,
  valuation_tag,
  score_details,
  data_state,
  updated_at
from public.equity_screener_results;

grant select on public.equity_screener_latest to anon, authenticated;
