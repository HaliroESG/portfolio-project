-- Canonical broker transaction ledger (BL-010 foundation)
create extension if not exists "pgcrypto";

create table if not exists public.broker_transactions (
  id bigserial primary key,
  broker text not null,
  account_id text not null,
  external_txn_id text not null,
  idempotency_key text not null,
  trade_date date not null,
  settlement_date date null,
  symbol text null,
  isin text null,
  side text not null,
  quantity numeric(24,10) not null default 0,
  price numeric(24,10) null,
  gross_amount numeric(24,10) not null default 0,
  fees numeric(24,10) not null default 0,
  taxes numeric(24,10) not null default 0,
  net_amount numeric(24,10) not null default 0,
  currency text not null,
  envelope text null,
  raw_type text null,
  source_file text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists broker_transactions_idempotency_key_uq
  on public.broker_transactions (idempotency_key);

create index if not exists broker_transactions_trade_date_idx
  on public.broker_transactions (trade_date desc);

create index if not exists broker_transactions_symbol_idx
  on public.broker_transactions (symbol);

create table if not exists public.broker_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  broker text not null,
  account_id text not null,
  reconciliation_date date not null,
  source_file text null,
  positions_file text null,
  mode text not null check (mode in ('broker_snapshot', 'ledger_rollup')),
  status text not null check (status in ('MATCH', 'MISMATCH', 'NOT_CHECKED')),
  parsed_count integer not null default 0,
  position_count integer not null default 0,
  state_counts jsonb not null default '{}'::jsonb,
  report_json jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists broker_reconciliation_runs_idempotency_key_uq
  on public.broker_reconciliation_runs (idempotency_key);

create index if not exists broker_reconciliation_runs_date_idx
  on public.broker_reconciliation_runs (reconciliation_date desc);

create index if not exists broker_reconciliation_runs_account_idx
  on public.broker_reconciliation_runs (broker, account_id);

create table if not exists public.broker_reconciliation_items (
  id bigserial primary key,
  run_id uuid not null references public.broker_reconciliation_runs(id) on delete cascade,
  instrument_key text not null,
  symbol text null,
  isin text null,
  currency text null,
  state text not null check (
    state in (
      'MATCH',
      'MISMATCH_QTY',
      'MISMATCH_COST',
      'MISSING_IN_LEDGER',
      'LEDGER_ONLY',
      'NOT_CHECKED'
    )
  ),
  ledger_quantity numeric(24,10) null,
  broker_quantity numeric(24,10) null,
  quantity_delta numeric(24,10) null,
  ledger_average_cost numeric(24,10) null,
  broker_average_cost numeric(24,10) null,
  transaction_count integer null,
  created_at timestamptz not null default now()
);

create index if not exists broker_reconciliation_items_run_idx
  on public.broker_reconciliation_items (run_id);

create index if not exists broker_reconciliation_items_state_idx
  on public.broker_reconciliation_items (state);
