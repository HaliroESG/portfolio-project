-- Trident stock insights read model.
-- Backend/service-role writes only; frontend reads explicit profile/consensus/trend states.

create table if not exists public.trident_stock_insights (
  instrument_key text primary key,
  ticker text not null,
  provider_symbol text,
  name text,
  business_summary text,
  website text,
  market_cap numeric,
  trailing_pe numeric,
  forward_pe numeric,
  recommendation_key text,
  recommendation_mean numeric,
  target_mean_price numeric,
  target_high_price numeric,
  target_low_price numeric,
  number_of_analyst_opinions integer,
  latest_price numeric,
  price_currency text,
  regression_slope_pct numeric,
  regression_z_score numeric,
  ma200_state text,
  momentum_3m_pct numeric,
  momentum_12m_pct numeric,
  trend_state text,
  trend_reason_codes text[] not null default '{}',
  price_history_state text,
  news_items jsonb not null default '[]'::jsonb,
  ai_trend_summary text,
  ai_summary_state text not null default 'AI_SUMMARY_UNAVAILABLE',
  ai_model text,
  source_provider text not null default 'yfinance',
  source_url text,
  data_state text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create index if not exists idx_trident_stock_insights_ticker
  on public.trident_stock_insights(upper(ticker));

create index if not exists idx_trident_stock_insights_updated_at
  on public.trident_stock_insights(updated_at desc);

alter table public.trident_stock_insights enable row level security;

drop policy if exists "read trident stock insights" on public.trident_stock_insights;
create policy "read trident stock insights"
  on public.trident_stock_insights
  for select
  to anon, authenticated
  using (true);

grant select on public.trident_stock_insights to anon, authenticated;
grant all on public.trident_stock_insights to service_role;
