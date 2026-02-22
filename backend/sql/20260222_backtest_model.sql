-- Backtest model: runs, portfolios, results, KPIs + RLS policies

create extension if not exists "pgcrypto";

create table if not exists public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  base_currency text not null default 'EUR',
  start_date date not null,
  end_date date not null,
  rebalance_freq text not null default 'none',
  fee_bps numeric not null default 0,
  inflation_adjusted boolean not null default false,
  config_json jsonb not null default '{}'::jsonb,
  check (start_date <= end_date),
  check (char_length(base_currency) = 3),
  check (rebalance_freq in ('none', 'daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual')),
  check (fee_bps >= 0)
);

create table if not exists public.backtest_portfolios (
  run_id uuid not null references public.backtest_runs(id) on delete cascade,
  portfolio_key text not null,
  portfolio_id text,
  preset_key text,
  label text not null,
  role text not null,
  weights_json jsonb not null default '{}'::jsonb,
  start_date_effective date,
  created_at timestamptz not null default now(),
  primary key (run_id, portfolio_key),
  check ((portfolio_id is null) <> (preset_key is null)),
  check (portfolio_key = coalesce(portfolio_id, preset_key)),
  check (role in ('target', 'current', 'preset', 'baseline'))
);

create table if not exists public.backtest_results (
  run_id uuid not null references public.backtest_runs(id) on delete cascade,
  portfolio_key text not null,
  date date not null,
  nav numeric not null,
  drawdown numeric,
  returns_daily numeric,
  primary key (run_id, portfolio_key, date),
  foreign key (run_id, portfolio_key)
    references public.backtest_portfolios(run_id, portfolio_key) on delete cascade
);

create table if not exists public.backtest_kpis (
  run_id uuid not null references public.backtest_runs(id) on delete cascade,
  portfolio_key text not null,
  cagr numeric,
  vol numeric,
  sharpe numeric,
  sortino numeric,
  max_drawdown numeric,
  calmar numeric,
  worst_year numeric,
  best_year numeric,
  primary key (run_id, portfolio_key),
  foreign key (run_id, portfolio_key)
    references public.backtest_portfolios(run_id, portfolio_key) on delete cascade
);

create index if not exists idx_backtest_runs_created_at
  on public.backtest_runs(created_at desc);
create index if not exists idx_backtest_results_run_date
  on public.backtest_results(run_id, date);
create index if not exists idx_backtest_results_run_portfolio
  on public.backtest_results(run_id, portfolio_key);

alter table public.backtest_runs enable row level security;
alter table public.backtest_portfolios enable row level security;
alter table public.backtest_results enable row level security;
alter table public.backtest_kpis enable row level security;

drop policy if exists backtest_runs_read on public.backtest_runs;
create policy backtest_runs_read on public.backtest_runs
  for select to anon, authenticated using (true);

drop policy if exists backtest_portfolios_read on public.backtest_portfolios;
create policy backtest_portfolios_read on public.backtest_portfolios
  for select to anon, authenticated using (true);

drop policy if exists backtest_results_read on public.backtest_results;
create policy backtest_results_read on public.backtest_results
  for select to anon, authenticated using (true);

drop policy if exists backtest_kpis_read on public.backtest_kpis;
create policy backtest_kpis_read on public.backtest_kpis
  for select to anon, authenticated using (true);
