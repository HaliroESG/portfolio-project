-- Phase 3 - Portfolio book model (positions, PRU, target weights, multi-portfolio)

alter table if exists public.market_watch
  add column if not exists quantity_buy numeric,
  add column if not exists pru numeric,
  add column if not exists target_weight_pct numeric,
  add column if not exists portfolio_id text;

create table if not exists public.portfolio_positions (
  id bigserial primary key,
  portfolio_id text not null,
  ticker text not null,
  name text,
  instrument_type text,
  currency text,
  quantity_buy numeric,
  quantity_current numeric not null default 0,
  pru numeric,
  target_weight_pct numeric,
  geo_coverage jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portfolio_id, ticker)
);

create index if not exists idx_market_watch_portfolio_id on public.market_watch(portfolio_id);
create index if not exists idx_portfolio_positions_portfolio_id on public.portfolio_positions(portfolio_id);
create index if not exists idx_portfolio_positions_ticker on public.portfolio_positions(ticker);
