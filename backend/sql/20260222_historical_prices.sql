-- Historical prices storage for backtests (base currency EUR)

create table if not exists public.historical_prices (
  ticker text not null,
  date date not null,
  adj_close numeric not null,
  currency text not null default 'EUR',
  source text not null default 'yfinance',
  updated_at timestamptz not null default now(),
  primary key (ticker, date),
  check (char_length(currency) = 3)
);

create index if not exists idx_historical_prices_ticker_date
  on public.historical_prices(ticker, date desc);

create table if not exists public.historical_price_coverage (
  ticker text primary key,
  requested_start_date date not null,
  requested_end_date date not null,
  earliest_date date,
  coverage_pct numeric,
  used_proxy boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists idx_historical_price_coverage_updated_at
  on public.historical_price_coverage(updated_at desc);
