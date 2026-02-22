-- Index to quickly reuse identical backtest runs

create index if not exists idx_backtest_runs_config_hash
  on public.backtest_runs ((config_json->>'config_hash'));
