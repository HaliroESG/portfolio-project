-- Canonical broker transaction ledger (BL-010 foundation)
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
