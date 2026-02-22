-- Allow multiple roles (target/current) for the same portfolio_id

alter table if exists public.backtest_portfolios
  drop constraint if exists backtest_portfolios_portfolio_key_check;

alter table if exists public.backtest_portfolios
  add constraint backtest_portfolios_portfolio_key_nonempty
  check (char_length(portfolio_key) > 0);
