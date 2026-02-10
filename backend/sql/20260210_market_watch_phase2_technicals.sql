-- Phase 2 - Technical indicators for market_watch
-- Run in Supabase SQL editor before/with backend rollout.

alter table if exists public.market_watch
  add column if not exists macd_line double precision,
  add column if not exists macd_signal double precision,
  add column if not exists macd_hist double precision,
  add column if not exists rsi_14 double precision,
  add column if not exists momentum_20 double precision,
  add column if not exists trend_state text,
  add column if not exists trend_changed boolean default false;

create index if not exists idx_market_watch_trend_state on public.market_watch(trend_state);
