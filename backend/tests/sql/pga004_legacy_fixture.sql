\set ON_ERROR_STOP on

-- Synthetic legacy graph used only by run_pga004_pg15.sh. It models every
-- table named by the migration and every child-parent edge used by active UI
-- readers. No provider or Supabase instance is involved.
create table public.portfolios (
  id text primary key,
  name text not null
);
create table public.portfolio_positions (
  id bigserial primary key,
  portfolio_id text not null references public.portfolios(id),
  ticker text not null,
  name text,
  quantity_current numeric not null default 0,
  unique (portfolio_id, ticker)
);
create table public.valuation_snapshots (
  id bigserial primary key,
  portfolio_id text not null references public.portfolios(id),
  coverage_pct numeric,
  created_at timestamptz not null default now()
);
create table public.governance_targets (
  id bigserial primary key,
  portfolio_id text not null references public.portfolios(id),
  asset_class text not null,
  target_pct numeric not null,
  tolerance_band numeric not null
);
create table public.decision_journal (
  id bigserial primary key,
  portfolio_id text not null references public.portfolios(id),
  title text not null
);
create table public.target_portfolios (
  id text primary key,
  portfolio_id text not null references public.portfolios(id),
  name text not null
);
create table public.target_envelope_weights (
  id bigserial primary key,
  target_portfolio_id text not null references public.target_portfolios(id),
  envelope text not null,
  target_weight_pct numeric not null
);
create table public.broker_transactions (
  id bigserial primary key,
  broker text,
  account_id text not null,
  external_txn_id text,
  idempotency_key text not null unique,
  trade_date date,
  settlement_date date,
  symbol text,
  isin text,
  side text,
  quantity numeric,
  price numeric,
  gross_amount numeric,
  fees numeric,
  taxes numeric,
  net_amount numeric,
  currency text,
  envelope text,
  raw_type text,
  source_file text
);
create table public.broker_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  broker text,
  account_id text not null,
  reconciliation_date date,
  source_file text,
  positions_file text,
  mode text,
  status text,
  parsed_count integer,
  position_count integer,
  state_counts jsonb,
  report_json jsonb,
  idempotency_key text unique,
  updated_at timestamptz
);
create table public.broker_reconciliation_items (
  id bigserial primary key,
  run_id uuid not null references public.broker_reconciliation_runs(id),
  instrument_key text,
  symbol text,
  isin text,
  currency text,
  state text,
  ledger_quantity numeric,
  broker_quantity numeric,
  quantity_delta numeric,
  ledger_average_cost numeric,
  broker_average_cost numeric,
  transaction_count integer
);
create table public.broker_position_snapshot_runs (
  id uuid primary key,
  portfolio_id text not null references public.portfolios(id),
  account_id text not null
);
create table public.broker_position_snapshot_items (
  id bigserial primary key,
  run_id uuid not null references public.broker_position_snapshot_runs(id),
  portfolio_id text not null references public.portfolios(id)
);
create table public.target_models (
  id text primary key,
  portfolio_scope text not null,
  model_name text not null,
  source_file text,
  source_kind text,
  as_of_date date,
  is_active boolean not null default true,
  target_total_pct numeric,
  status text,
  report_json jsonb,
  updated_at timestamptz
);
create table public.target_buckets (
  id bigserial primary key,
  model_id text not null references public.target_models(id),
  portfolio_scope text,
  bucket_key text not null,
  bucket_label text,
  parent_bucket_key text,
  target_weight_pct numeric,
  lower_band_pct numeric,
  upper_band_pct numeric,
  source_sheet text,
  source_row integer,
  updated_at timestamptz
);
create table public.target_envelope_lines (
  id bigserial primary key,
  model_id text not null references public.target_models(id),
  portfolio_scope text,
  envelope text not null,
  ticker text,
  isin text,
  instrument text,
  asset_class text,
  region text,
  currency text,
  target_weight_pct numeric,
  target_value_eur numeric,
  notes text,
  source_sheet text,
  source_row integer,
  updated_at timestamptz
);
create table public.target_model_audit_holdings (
  id bigserial primary key,
  model_id text not null references public.target_models(id),
  portfolio_scope text,
  envelope text,
  ticker text,
  isin text,
  instrument text not null,
  asset_class text,
  region text,
  currency text,
  market_value_eur numeric,
  quantity numeric,
  notes text,
  source_sheet text,
  source_row integer,
  updated_at timestamptz
);

create view public.legacy_portfolio_rows
with (security_invoker = true) as
select owner_source.id as portfolio_id, owner_source.name
from public.portfolios owner_source;

insert into public.fo_owner_allowlist (email, is_active)
values ('owner-a@example.invalid', true), ('owner-b@example.invalid', true);
insert into auth.users (id, email, raw_user_meta_data)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'owner-a@example.invalid',
  '{"display_name":"Owner A"}'::jsonb
);

insert into public.portfolios values ('legacy-a', 'Legacy A');
insert into public.portfolio_positions (portfolio_id, ticker, name) values ('legacy-a', 'AAA', 'Position A');
insert into public.valuation_snapshots (portfolio_id, coverage_pct) values ('legacy-a', 91);
insert into public.governance_targets (portfolio_id, asset_class, target_pct, tolerance_band) values ('legacy-a', 'Equity', 60, 5);
insert into public.decision_journal (portfolio_id, title) values ('legacy-a', 'Decision A');
insert into public.target_portfolios values ('target-a', 'legacy-a', 'Target A');
insert into public.target_envelope_weights (target_portfolio_id, envelope, target_weight_pct) values ('target-a', 'PEA', 50);
insert into public.broker_transactions (account_id, idempotency_key) values ('account-a', 'txn-a');
insert into public.broker_reconciliation_runs (id, account_id, idempotency_key)
values ('aaaaaaaa-1000-4000-8000-000000000001', 'account-a', 'reconciliation-a');
insert into public.broker_reconciliation_items (run_id) values ('aaaaaaaa-1000-4000-8000-000000000001');
insert into public.broker_position_snapshot_runs values ('aaaaaaaa-2000-4000-8000-000000000001', 'legacy-a', 'account-a');
insert into public.broker_position_snapshot_items (run_id, portfolio_id) values ('aaaaaaaa-2000-4000-8000-000000000001', 'legacy-a');
insert into public.target_models (id, portfolio_scope, model_name, is_active)
values ('model-a', 'PERSO', 'Model A', true);
insert into public.target_buckets (model_id, bucket_key) values ('model-a', 'equity');
insert into public.target_envelope_lines (model_id, envelope) values ('model-a', 'PEA');
insert into public.target_model_audit_holdings (model_id, instrument) values ('model-a', 'AAA');
