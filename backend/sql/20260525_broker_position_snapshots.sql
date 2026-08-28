-- Broker position snapshots are the official "current" portfolio source in V1.
-- Writes stay backend/service-role only; frontend reads are read-only.

create extension if not exists "pgcrypto";

alter table if exists public.portfolio_positions
  add column if not exists isin text,
  add column if not exists target_notes text,
  add column if not exists target_source text,
  add column if not exists target_source_file text,
  add column if not exists target_updated_at timestamptz,
  add column if not exists actual_source text,
  add column if not exists actual_source_accounts jsonb not null default '[]'::jsonb,
  add column if not exists actual_as_of_date date,
  add column if not exists actual_updated_at timestamptz;

create index if not exists idx_portfolio_positions_actual_as_of_date
  on public.portfolio_positions(actual_as_of_date desc);

create table if not exists public.broker_position_snapshot_runs (
  id uuid primary key default gen_random_uuid(),
  broker text not null,
  account_id text not null,
  portfolio_id text not null,
  envelope text null,
  as_of_date date not null,
  source_file text null,
  position_count integer not null default 0,
  idempotency_key text not null,
  report_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists broker_position_snapshot_runs_idempotency_key_uq
  on public.broker_position_snapshot_runs (idempotency_key);

create index if not exists broker_position_snapshot_runs_portfolio_idx
  on public.broker_position_snapshot_runs (portfolio_id, as_of_date desc, created_at desc);

create index if not exists broker_position_snapshot_runs_account_idx
  on public.broker_position_snapshot_runs (broker, account_id, envelope);

create table if not exists public.broker_position_snapshot_items (
  id bigserial primary key,
  run_id uuid not null references public.broker_position_snapshot_runs(id) on delete cascade,
  portfolio_id text not null,
  broker text not null,
  account_id text not null,
  envelope text null,
  as_of_date date not null,
  symbol text null,
  isin text null,
  name text null,
  currency text null,
  quantity numeric(24,10) not null default 0,
  average_cost numeric(24,10) null,
  source_row integer null,
  created_at timestamptz not null default now()
);

create index if not exists broker_position_snapshot_items_run_idx
  on public.broker_position_snapshot_items (run_id);

create index if not exists broker_position_snapshot_items_portfolio_symbol_idx
  on public.broker_position_snapshot_items (portfolio_id, symbol);

create index if not exists broker_position_snapshot_items_portfolio_isin_idx
  on public.broker_position_snapshot_items (portfolio_id, isin);

alter table public.broker_position_snapshot_runs enable row level security;
alter table public.broker_position_snapshot_items enable row level security;

drop policy if exists broker_position_snapshot_runs_read on public.broker_position_snapshot_runs;
create policy broker_position_snapshot_runs_read on public.broker_position_snapshot_runs
  for select to anon, authenticated using (true);

drop policy if exists broker_position_snapshot_items_read on public.broker_position_snapshot_items;
create policy broker_position_snapshot_items_read on public.broker_position_snapshot_items
  for select to anon, authenticated using (true);

drop policy if exists broker_position_snapshot_runs_service_role_write on public.broker_position_snapshot_runs;
create policy broker_position_snapshot_runs_service_role_write on public.broker_position_snapshot_runs
  for all to service_role using (true) with check (true);

drop policy if exists broker_position_snapshot_items_service_role_write on public.broker_position_snapshot_items;
create policy broker_position_snapshot_items_service_role_write on public.broker_position_snapshot_items
  for all to service_role using (true) with check (true);

grant usage on schema public to anon, authenticated, service_role;
grant select on table
  public.portfolio_positions,
  public.broker_position_snapshot_runs,
  public.broker_position_snapshot_items
to anon, authenticated;

grant select, insert, update, delete on table
  public.portfolio_positions,
  public.broker_position_snapshot_runs,
  public.broker_position_snapshot_items
to service_role;

grant usage, select on sequence
  public.portfolio_positions_id_seq,
  public.broker_position_snapshot_items_id_seq
to service_role;
