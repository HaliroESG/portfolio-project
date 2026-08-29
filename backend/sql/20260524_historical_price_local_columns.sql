-- Add optional local price fields for portfolio asset price charts.
-- adj_close remains the canonical EUR series used by backtests.

alter table public.historical_prices
  add column if not exists adj_close_local numeric,
  add column if not exists local_currency text,
  add column if not exists fx_rate_to_eur numeric;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'historical_prices_local_currency_len'
      and conrelid = 'public.historical_prices'::regclass
  ) then
    alter table public.historical_prices
      add constraint historical_prices_local_currency_len
      check (local_currency is null or char_length(local_currency) = 3);
  end if;
end $$;
