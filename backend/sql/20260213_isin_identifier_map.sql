-- ISIN -> Ticker mapping cache for bridge.py fallback resolution

create table if not exists public.instrument_identifier_map (
  isin text primary key,
  ticker text not null,
  source text,
  confidence numeric,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_instrument_identifier_map_ticker
  on public.instrument_identifier_map(ticker);
