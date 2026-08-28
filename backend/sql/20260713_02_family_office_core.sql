-- Canonical Family Office register. Backend/service-role writes only.

create extension if not exists pgcrypto;

create schema if not exists fo_private;
revoke all on schema fo_private from public, anon, authenticated;

create table if not exists public.fo_owner_allowlist (
  email text primary key check (email = lower(trim(email))),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.fo_owner_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  base_currency text not null default 'EUR' check (base_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function fo_private.validate_family_office_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or not exists (
    select 1
    from public.fo_owner_allowlist allowlist
    where allowlist.email = lower(trim(new.email))
      and allowlist.is_active
  ) then
    raise exception 'This email is not authorized for the private portfolio';
  end if;

  if exists (select 1 from public.fo_owner_profiles) then
    raise exception 'The private portfolio already has an owner';
  end if;

  return new;
end;
$$;

create or replace function fo_private.register_family_office_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fo_owner_profiles (user_id, email, display_name)
  values (
    new.id,
    lower(trim(new.email)),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists fo_validate_owner_before_insert on auth.users;
create trigger fo_validate_owner_before_insert
before insert on auth.users
for each row execute function fo_private.validate_family_office_user();

drop trigger if exists fo_register_owner_after_insert on auth.users;
create trigger fo_register_owner_after_insert
after insert on auth.users
for each row execute function fo_private.register_family_office_owner();

create table if not exists public.fo_legal_entities (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  name text not null,
  entity_type text not null check (entity_type in ('PERSONAL', 'COMPANY', 'TRUST', 'ASSOCIATION', 'OTHER')),
  tax_country text not null default 'FR' check (char_length(tax_country) = 2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, name)
);

create table if not exists public.fo_portfolios (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  legal_entity_id uuid not null references public.fo_legal_entities(id),
  name text not null,
  portfolio_type text not null default 'PERSONAL' check (portfolio_type in ('PERSONAL', 'PROFESSIONAL')),
  base_currency text not null default 'EUR' check (base_currency ~ '^[A-Z]{3}$'),
  benchmark_symbol text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, name)
);

create table if not exists public.fo_institutions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  name text not null,
  institution_type text not null default 'BROKER' check (institution_type in ('BROKER', 'BANK', 'INSURER', 'CUSTODIAN', 'OTHER')),
  country_code text check (country_code is null or char_length(country_code) = 2),
  created_at timestamptz not null default now(),
  unique (owner_user_id, name)
);

create table if not exists public.fo_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  portfolio_id uuid not null references public.fo_portfolios(id),
  institution_id uuid not null references public.fo_institutions(id),
  external_account_id text not null,
  name text not null,
  envelope text not null check (envelope in ('PEA', 'CTO', 'PER', 'AV', 'CASH', 'OTHER')),
  base_currency text not null default 'EUR' check (base_currency ~ '^[A-Z]{3}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED')),
  opened_on date,
  closed_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, external_account_id)
);

create table if not exists public.fo_instruments (
  id uuid primary key default gen_random_uuid(),
  instrument_key text not null unique,
  isin text,
  ticker text,
  name text not null,
  instrument_type text not null check (instrument_type in ('EQUITY', 'ETF', 'FUND', 'BOND', 'COMMODITY', 'CRYPTO', 'CASH', 'REAL_ESTATE', 'PRIVATE_EQUITY', 'OTHER')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  country_code text,
  sector text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fo_instruments_isin_uq
  on public.fo_instruments (isin) where isin is not null;
create index if not exists fo_instruments_ticker_idx on public.fo_instruments (ticker);

create table if not exists public.fo_instrument_aliases (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.fo_instruments(id) on delete cascade,
  provider text not null,
  provider_symbol text not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_symbol)
);

create table if not exists public.fo_import_runs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  account_id uuid not null references public.fo_accounts(id),
  source_kind text not null check (source_kind in ('FORTUNEO', 'IBKR', 'MANUAL', 'LINXEA')),
  import_type text not null check (import_type in ('TRANSACTIONS', 'POSITIONS', 'VALUATIONS')),
  source_file text,
  source_sha256 text not null,
  as_of_date date,
  status text not null check (status in ('PENDING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  row_count integer not null default 0 check (row_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  report_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (account_id, import_type, source_sha256)
);

create table if not exists public.fo_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  account_id uuid not null references public.fo_accounts(id),
  import_run_id uuid references public.fo_import_runs(id),
  external_entry_id text,
  reversal_of_id uuid references public.fo_ledger_entries(id),
  event_type text not null check (event_type in ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'INTEREST', 'FEE', 'TAX', 'FX', 'CORPORATE_ACTION', 'ADJUSTMENT')),
  trade_date date not null,
  settlement_date date,
  instrument_id uuid references public.fo_instruments(id),
  quantity numeric(28,10) not null default 0,
  unit_price numeric(28,10),
  gross_amount numeric(28,10) not null default 0,
  fees numeric(28,10) not null default 0,
  taxes numeric(28,10) not null default 0,
  cash_amount numeric(28,10) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate_to_eur numeric(28,12) check (fx_rate_to_eur is null or fx_rate_to_eur > 0),
  description text,
  source_payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check (event_type not in ('BUY', 'SELL') or instrument_id is not null),
  check (reversal_of_id is null or event_type = 'ADJUSTMENT')
);

create index if not exists fo_ledger_account_date_idx on public.fo_ledger_entries (account_id, trade_date, created_at);
create index if not exists fo_ledger_instrument_idx on public.fo_ledger_entries (instrument_id, trade_date) where instrument_id is not null;

create or replace function fo_private.prevent_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'fo_ledger_entries is append-only; insert a reversal entry instead';
end;
$$;

drop trigger if exists fo_ledger_entries_immutable on public.fo_ledger_entries;
create trigger fo_ledger_entries_immutable
before update or delete on public.fo_ledger_entries
for each row execute function fo_private.prevent_ledger_mutation();

create table if not exists public.fo_position_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  portfolio_id uuid not null references public.fo_portfolios(id),
  account_id uuid not null references public.fo_accounts(id),
  instrument_id uuid not null references public.fo_instruments(id),
  snapshot_date date not null,
  quantity numeric(28,10) not null,
  average_cost numeric(28,10),
  cost_basis_eur numeric(28,10),
  price_local numeric(28,10),
  fx_rate_to_eur numeric(28,12),
  market_value_eur numeric(28,10),
  unrealized_pnl_eur numeric(28,10),
  data_state text not null check (data_state in ('READY', 'PARTIAL', 'STALE', 'MISSING', 'UNRECONCILED')),
  price_as_of date,
  fx_as_of date,
  reconciliation_state text not null default 'NOT_CHECKED' check (reconciliation_state in ('MATCH', 'MISMATCH', 'NOT_CHECKED')),
  calculated_at timestamptz not null default now(),
  unique (account_id, instrument_id, snapshot_date)
);

create index if not exists fo_position_snapshots_latest_idx
  on public.fo_position_snapshots (portfolio_id, snapshot_date desc);

create table if not exists public.fo_cash_balances_daily (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  portfolio_id uuid not null references public.fo_portfolios(id),
  account_id uuid not null references public.fo_accounts(id),
  balance_date date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  balance_local numeric(28,10) not null,
  fx_rate_to_eur numeric(28,12),
  balance_eur numeric(28,10),
  data_state text not null check (data_state in ('READY', 'PARTIAL', 'STALE', 'MISSING', 'UNRECONCILED')),
  calculated_at timestamptz not null default now(),
  unique (account_id, currency, balance_date)
);

create table if not exists public.fo_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  account_id uuid not null references public.fo_accounts(id),
  import_run_id uuid references public.fo_import_runs(id),
  reconciliation_date date not null,
  status text not null check (status in ('MATCH', 'MISMATCH', 'NOT_CHECKED')),
  state_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (account_id, reconciliation_date, import_run_id)
);

create table if not exists public.fo_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  run_id uuid not null references public.fo_reconciliation_runs(id) on delete cascade,
  instrument_id uuid references public.fo_instruments(id),
  state text not null check (state in ('MATCH', 'MISMATCH_QTY', 'MISMATCH_COST', 'MISSING_IN_LEDGER', 'LEDGER_ONLY', 'NOT_CHECKED')),
  ledger_quantity numeric(28,10),
  broker_quantity numeric(28,10),
  quantity_delta numeric(28,10),
  ledger_average_cost numeric(28,10),
  broker_average_cost numeric(28,10),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fo_reconciliation_items_run_idx on public.fo_reconciliation_items (run_id, state);

create table if not exists public.fo_manual_holdings (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  portfolio_id uuid not null references public.fo_portfolios(id),
  holding_kind text not null check (holding_kind in ('ASSET', 'LIABILITY')),
  asset_type text not null check (asset_type in ('REAL_ESTATE', 'PRIVATE_EQUITY', 'INSURANCE', 'PENSION', 'LOAN', 'OTHER')),
  name text not null,
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  valuation_frequency text not null default 'QUARTERLY' check (valuation_frequency in ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'ON_DEMAND')),
  next_valuation_date date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fo_manual_valuations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  holding_id uuid not null references public.fo_manual_holdings(id) on delete cascade,
  valuation_date date not null,
  value_local numeric(28,10) not null check (value_local >= 0),
  fx_rate_to_eur numeric(28,12) check (fx_rate_to_eur is null or fx_rate_to_eur > 0),
  value_eur numeric(28,10) not null check (value_eur >= 0),
  source text not null,
  confidence text not null default 'DECLARED' check (confidence in ('VERIFIED', 'DECLARED', 'ESTIMATED')),
  notes text,
  created_at timestamptz not null default now(),
  unique (holding_id, valuation_date)
);

create table if not exists public.fo_performance_daily (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  portfolio_id uuid not null references public.fo_portfolios(id),
  performance_date date not null,
  nav_eur numeric(28,10),
  external_flow_eur numeric(28,10) not null default 0,
  twr_daily numeric(18,10),
  twr_mtd numeric(18,10),
  twr_ytd numeric(18,10),
  twr_since_inception numeric(18,10),
  xirr_since_inception numeric(18,10),
  benchmark_daily numeric(18,10),
  benchmark_ytd numeric(18,10),
  allocation_effect_eur numeric(28,10),
  selection_effect_eur numeric(28,10),
  fx_effect_eur numeric(28,10),
  coverage_pct numeric(7,4) check (coverage_pct between 0 and 100),
  data_state text not null check (data_state in ('READY', 'PARTIAL', 'STALE', 'MISSING', 'UNRECONCILED')),
  calculated_at timestamptz not null default now(),
  unique (portfolio_id, performance_date)
);

create table if not exists public.fo_risk_daily (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  portfolio_id uuid not null references public.fo_portfolios(id),
  risk_date date not null,
  volatility_30d_pct numeric(12,6),
  max_drawdown_ytd_pct numeric(12,6),
  largest_position_pct numeric(12,6),
  top10_concentration_pct numeric(12,6),
  fx_exposure_pct numeric(12,6),
  cash_pct numeric(12,6),
  illiquid_pct numeric(12,6),
  data_state text not null check (data_state in ('READY', 'PARTIAL', 'STALE', 'MISSING', 'UNRECONCILED')),
  details jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  unique (portfolio_id, risk_date)
);

create table if not exists public.fo_ips_policies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  portfolio_id uuid not null references public.fo_portfolios(id),
  name text not null,
  effective_from date not null,
  effective_to date,
  core_target_pct numeric(7,4) not null default 70 check (core_target_pct between 0 and 100),
  satellite_target_pct numeric(7,4) not null default 30 check (satellite_target_pct between 0 and 100),
  minimum_cash_pct numeric(7,4) not null default 5 check (minimum_cash_pct between 0 and 100),
  drift_tolerance_pct numeric(7,4) not null default 3 check (drift_tolerance_pct between 0 and 100),
  constraints_json jsonb not null default '{}'::jsonb,
  status text not null default 'ACTIVE' check (status in ('DRAFT', 'ACTIVE', 'RETIRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (core_target_pct + satellite_target_pct = 100)
);

create table if not exists public.fo_allocation_targets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  policy_id uuid not null references public.fo_ips_policies(id) on delete cascade,
  bucket_key text not null,
  bucket_label text not null,
  target_weight_pct numeric(7,4) not null check (target_weight_pct between 0 and 100),
  lower_band_pct numeric(7,4) check (lower_band_pct between 0 and 100),
  upper_band_pct numeric(7,4) check (upper_band_pct between 0 and 100),
  preferred_envelope text check (preferred_envelope is null or preferred_envelope in ('PEA', 'CTO', 'PER', 'AV', 'CASH', 'OTHER')),
  created_at timestamptz not null default now(),
  unique (policy_id, bucket_key)
);

create table if not exists public.fo_exceptions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  portfolio_id uuid references public.fo_portfolios(id),
  account_id uuid references public.fo_accounts(id),
  exception_type text not null,
  severity text not null check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  status text not null default 'OPEN' check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED')),
  title text not null,
  details jsonb not null default '{}'::jsonb,
  source_ref text,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (owner_user_id, exception_type, source_ref)
);

create index if not exists fo_exceptions_open_idx
  on public.fo_exceptions (owner_user_id, severity, detected_at desc)
  where status in ('OPEN', 'ACKNOWLEDGED');

create table if not exists public.fo_decisions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  portfolio_id uuid not null references public.fo_portfolios(id),
  title text not null,
  rationale text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'VALIDATED', 'EXPORTED', 'EXECUTED', 'RECONCILED', 'CANCELLED')),
  macro_context jsonb not null default '{}'::jsonb,
  risk_context jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  executed_at timestamptz,
  reconciled_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.fo_order_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  decision_id uuid not null references public.fo_decisions(id) on delete cascade,
  account_id uuid not null references public.fo_accounts(id),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'VALIDATED', 'EXPORTED', 'EXECUTED', 'RECONCILED', 'CANCELLED')),
  estimated_gross_eur numeric(28,10),
  estimated_fees_eur numeric(28,10),
  export_format text check (export_format is null or export_format in ('CSV', 'PDF')),
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fo_order_lines (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  order_draft_id uuid not null references public.fo_order_drafts(id) on delete cascade,
  instrument_id uuid not null references public.fo_instruments(id),
  side text not null check (side in ('BUY', 'SELL')),
  quantity numeric(28,10),
  amount_eur numeric(28,10),
  limit_price numeric(28,10),
  reason_codes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  check (quantity is not null or amount_eur is not null)
);

create table if not exists public.fo_monthly_closes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.fo_owner_profiles(user_id) on delete cascade,
  portfolio_id uuid not null references public.fo_portfolios(id),
  period_end date not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'BLOCKED', 'CLOSED')),
  nav_eur numeric(28,10),
  coverage_pct numeric(7,4),
  open_exception_count integer not null default 0,
  reconciliation_state text not null default 'NOT_CHECKED' check (reconciliation_state in ('MATCH', 'MISMATCH', 'NOT_CHECKED')),
  checks_json jsonb not null default '{}'::jsonb,
  report_json jsonb not null default '{}'::jsonb,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (portfolio_id, period_end)
);

create table if not exists public.fo_audit_log (
  id bigint generated always as identity primary key,
  owner_user_id uuid references public.fo_owner_profiles(user_id) on delete set null,
  command_id text not null,
  command_type text not null,
  resource_type text,
  resource_id text,
  status text not null check (status in ('ACCEPTED', 'COMPLETED', 'FAILED')),
  before_state jsonb,
  after_state jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (owner_user_id, command_id, status)
);

create index if not exists fo_audit_log_owner_created_idx on public.fo_audit_log (owner_user_id, created_at desc);

create or replace view public.fo_positions_latest
with (security_invoker = true)
as
select distinct on (position.owner_user_id, position.account_id, position.instrument_id)
  position.id,
  position.owner_user_id,
  position.portfolio_id,
  position.account_id,
  position.instrument_id,
  instrument.instrument_key,
  instrument.isin,
  instrument.ticker,
  instrument.name,
  instrument.instrument_type,
  instrument.currency,
  position.snapshot_date,
  position.quantity,
  position.average_cost,
  position.cost_basis_eur,
  position.price_local,
  position.fx_rate_to_eur,
  position.market_value_eur,
  position.unrealized_pnl_eur,
  position.data_state,
  position.price_as_of,
  position.fx_as_of,
  position.reconciliation_state,
  position.calculated_at
from public.fo_position_snapshots position
join public.fo_instruments instrument on instrument.id = position.instrument_id
order by position.owner_user_id, position.account_id, position.instrument_id, position.snapshot_date desc, position.calculated_at desc;

create or replace view public.fo_cash_balances_latest
with (security_invoker = true)
as
select distinct on (cash.owner_user_id, cash.account_id, cash.currency)
  cash.*
from public.fo_cash_balances_daily cash
order by cash.owner_user_id, cash.account_id, cash.currency, cash.balance_date desc, cash.calculated_at desc;

create or replace view public.fo_manual_valuations_latest
with (security_invoker = true)
as
select distinct on (holding.owner_user_id, holding.id)
  holding.owner_user_id,
  holding.portfolio_id,
  holding.id as holding_id,
  holding.holding_kind,
  holding.asset_type,
  holding.name,
  holding.currency,
  holding.valuation_frequency,
  holding.next_valuation_date,
  holding.status,
  valuation.valuation_date,
  valuation.value_local,
  valuation.fx_rate_to_eur,
  valuation.value_eur,
  valuation.source,
  valuation.confidence,
  valuation.created_at
from public.fo_manual_holdings holding
left join public.fo_manual_valuations valuation on valuation.holding_id = holding.id
order by holding.owner_user_id, holding.id, valuation.valuation_date desc nulls last, valuation.created_at desc nulls last;

create or replace view public.fo_portfolio_overview_latest
with (security_invoker = true)
as
select
  portfolio.owner_user_id,
  portfolio.id as portfolio_id,
  portfolio.name as portfolio_name,
  portfolio.portfolio_type,
  portfolio.base_currency,
  portfolio.benchmark_symbol,
  coalesce((select sum(position.market_value_eur) from public.fo_positions_latest position where position.portfolio_id = portfolio.id), 0) as liquid_assets_eur,
  coalesce((select sum(cash.balance_eur) from public.fo_cash_balances_latest cash where cash.portfolio_id = portfolio.id), 0) as cash_eur,
  coalesce((select sum(manual.value_eur) from public.fo_manual_valuations_latest manual where manual.portfolio_id = portfolio.id and manual.holding_kind = 'ASSET'), 0) as manual_assets_eur,
  coalesce((select sum(manual.value_eur) from public.fo_manual_valuations_latest manual where manual.portfolio_id = portfolio.id and manual.holding_kind = 'LIABILITY'), 0) as liabilities_eur,
  coalesce((select sum(position.market_value_eur) from public.fo_positions_latest position where position.portfolio_id = portfolio.id), 0)
    + coalesce((select sum(cash.balance_eur) from public.fo_cash_balances_latest cash where cash.portfolio_id = portfolio.id), 0)
    + coalesce((select sum(manual.value_eur) from public.fo_manual_valuations_latest manual where manual.portfolio_id = portfolio.id and manual.holding_kind = 'ASSET'), 0)
    - coalesce((select sum(manual.value_eur) from public.fo_manual_valuations_latest manual where manual.portfolio_id = portfolio.id and manual.holding_kind = 'LIABILITY'), 0) as net_asset_value_eur,
  (select performance.twr_mtd from public.fo_performance_daily performance where performance.portfolio_id = portfolio.id order by performance.performance_date desc limit 1) as twr_mtd,
  (select performance.twr_ytd from public.fo_performance_daily performance where performance.portfolio_id = portfolio.id order by performance.performance_date desc limit 1) as twr_ytd,
  (select performance.xirr_since_inception from public.fo_performance_daily performance where performance.portfolio_id = portfolio.id order by performance.performance_date desc limit 1) as xirr_since_inception,
  (select performance.coverage_pct from public.fo_performance_daily performance where performance.portfolio_id = portfolio.id order by performance.performance_date desc limit 1) as coverage_pct,
  (select performance.data_state from public.fo_performance_daily performance where performance.portfolio_id = portfolio.id order by performance.performance_date desc limit 1) as performance_state,
  (select risk.volatility_30d_pct from public.fo_risk_daily risk where risk.portfolio_id = portfolio.id order by risk.risk_date desc limit 1) as volatility_30d_pct,
  (select risk.max_drawdown_ytd_pct from public.fo_risk_daily risk where risk.portfolio_id = portfolio.id order by risk.risk_date desc limit 1) as max_drawdown_ytd_pct,
  (select risk.largest_position_pct from public.fo_risk_daily risk where risk.portfolio_id = portfolio.id order by risk.risk_date desc limit 1) as largest_position_pct,
  (select count(*) from public.fo_exceptions exception where exception.portfolio_id = portfolio.id and exception.status in ('OPEN', 'ACKNOWLEDGED')) as open_exception_count,
  greatest(
    coalesce((select max(position.calculated_at) from public.fo_positions_latest position where position.portfolio_id = portfolio.id), portfolio.updated_at),
    coalesce((select max(cash.calculated_at) from public.fo_cash_balances_latest cash where cash.portfolio_id = portfolio.id), portfolio.updated_at),
    portfolio.updated_at
  ) as updated_at
from public.fo_portfolios portfolio
where portfolio.status = 'ACTIVE';

create or replace view public.fo_operations_inbox
with (security_invoker = true)
as
select
  exception.id,
  exception.owner_user_id,
  exception.portfolio_id,
  exception.account_id,
  exception.exception_type,
  exception.severity,
  exception.status,
  exception.title,
  exception.details,
  exception.source_ref,
  exception.detected_at,
  exception.resolved_at
from public.fo_exceptions exception
where exception.status in ('OPEN', 'ACKNOWLEDGED')
union all
select
  holding.id,
  holding.owner_user_id,
  holding.portfolio_id,
  null::uuid,
  'VALUATION_DUE',
  case when holding.next_valuation_date < current_date then 'WARNING' else 'INFO' end,
  'OPEN',
  'Valorisation à mettre à jour : ' || holding.name,
  jsonb_build_object('next_valuation_date', holding.next_valuation_date, 'asset_type', holding.asset_type),
  'manual_holding:' || holding.id::text,
  now(),
  null::timestamptz
from public.fo_manual_holdings holding
where holding.status = 'ACTIVE'
  and holding.next_valuation_date is not null
  and holding.next_valuation_date <= current_date + 14;
