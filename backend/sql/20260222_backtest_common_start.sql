-- Store requested vs effective dates + diagnostics for backtest runs (Mode A common_start)

alter table if exists public.backtest_runs
  add column if not exists requested_start_date date,
  add column if not exists requested_end_date date,
  add column if not exists start_date_effective date,
  add column if not exists end_date_effective date,
  add column if not exists data_mode text default 'common_start',
  add column if not exists diagnostics_json jsonb default '{}'::jsonb;
