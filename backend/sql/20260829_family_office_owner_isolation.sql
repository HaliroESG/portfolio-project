-- PGA-004: support multiple allowlisted owners and enforce owner-consistent graphs.
-- Apply only after the 20260713 Family Office core and security migrations.

begin;

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

  return new;
end;
$$;

-- Every owner-scoped parent needs a composite candidate key before a child can
-- reference both the owner and the parent in one indivisible constraint.
create unique index if not exists fo_legal_entities_owner_id_uq
  on public.fo_legal_entities (owner_user_id, id);
create unique index if not exists fo_portfolios_owner_id_uq
  on public.fo_portfolios (owner_user_id, id);
create unique index if not exists fo_institutions_owner_id_uq
  on public.fo_institutions (owner_user_id, id);
create unique index if not exists fo_accounts_owner_id_uq
  on public.fo_accounts (owner_user_id, id);
create unique index if not exists fo_import_runs_owner_id_uq
  on public.fo_import_runs (owner_user_id, id);
create unique index if not exists fo_ledger_entries_owner_id_uq
  on public.fo_ledger_entries (owner_user_id, id);
create unique index if not exists fo_reconciliation_runs_owner_id_uq
  on public.fo_reconciliation_runs (owner_user_id, id);
create unique index if not exists fo_manual_holdings_owner_id_uq
  on public.fo_manual_holdings (owner_user_id, id);
create unique index if not exists fo_ips_policies_owner_id_uq
  on public.fo_ips_policies (owner_user_id, id);
create unique index if not exists fo_decisions_owner_id_uq
  on public.fo_decisions (owner_user_id, id);
create unique index if not exists fo_order_drafts_owner_id_uq
  on public.fo_order_drafts (owner_user_id, id);

alter table public.fo_portfolios
  drop constraint if exists fo_portfolios_legal_entity_id_fkey,
  drop constraint if exists fo_portfolios_owner_legal_entity_fkey,
  add constraint fo_portfolios_owner_legal_entity_fkey
    foreign key (owner_user_id, legal_entity_id)
    references public.fo_legal_entities (owner_user_id, id);

alter table public.fo_accounts
  drop constraint if exists fo_accounts_portfolio_id_fkey,
  drop constraint if exists fo_accounts_institution_id_fkey,
  drop constraint if exists fo_accounts_owner_portfolio_fkey,
  drop constraint if exists fo_accounts_owner_institution_fkey,
  add constraint fo_accounts_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id),
  add constraint fo_accounts_owner_institution_fkey
    foreign key (owner_user_id, institution_id)
    references public.fo_institutions (owner_user_id, id);

alter table public.fo_import_runs
  drop constraint if exists fo_import_runs_account_id_fkey,
  drop constraint if exists fo_import_runs_owner_account_fkey,
  add constraint fo_import_runs_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id);

alter table public.fo_ledger_entries
  drop constraint if exists fo_ledger_entries_account_id_fkey,
  drop constraint if exists fo_ledger_entries_import_run_id_fkey,
  drop constraint if exists fo_ledger_entries_reversal_of_id_fkey,
  drop constraint if exists fo_ledger_entries_owner_account_fkey,
  drop constraint if exists fo_ledger_entries_owner_import_run_fkey,
  drop constraint if exists fo_ledger_entries_owner_reversal_fkey,
  add constraint fo_ledger_entries_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id),
  add constraint fo_ledger_entries_owner_import_run_fkey
    foreign key (owner_user_id, import_run_id)
    references public.fo_import_runs (owner_user_id, id),
  add constraint fo_ledger_entries_owner_reversal_fkey
    foreign key (owner_user_id, reversal_of_id)
    references public.fo_ledger_entries (owner_user_id, id);

alter table public.fo_position_snapshots
  drop constraint if exists fo_position_snapshots_portfolio_id_fkey,
  drop constraint if exists fo_position_snapshots_account_id_fkey,
  drop constraint if exists fo_position_snapshots_owner_portfolio_fkey,
  drop constraint if exists fo_position_snapshots_owner_account_fkey,
  add constraint fo_position_snapshots_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id),
  add constraint fo_position_snapshots_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id);

alter table public.fo_cash_balances_daily
  drop constraint if exists fo_cash_balances_daily_portfolio_id_fkey,
  drop constraint if exists fo_cash_balances_daily_account_id_fkey,
  drop constraint if exists fo_cash_balances_owner_portfolio_fkey,
  drop constraint if exists fo_cash_balances_owner_account_fkey,
  add constraint fo_cash_balances_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id),
  add constraint fo_cash_balances_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id);

alter table public.fo_reconciliation_runs
  drop constraint if exists fo_reconciliation_runs_account_id_fkey,
  drop constraint if exists fo_reconciliation_runs_import_run_id_fkey,
  drop constraint if exists fo_reconciliation_runs_owner_account_fkey,
  drop constraint if exists fo_reconciliation_runs_owner_import_run_fkey,
  add constraint fo_reconciliation_runs_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id),
  add constraint fo_reconciliation_runs_owner_import_run_fkey
    foreign key (owner_user_id, import_run_id)
    references public.fo_import_runs (owner_user_id, id);

alter table public.fo_reconciliation_items
  drop constraint if exists fo_reconciliation_items_run_id_fkey,
  drop constraint if exists fo_reconciliation_items_owner_run_fkey,
  add constraint fo_reconciliation_items_owner_run_fkey
    foreign key (owner_user_id, run_id)
    references public.fo_reconciliation_runs (owner_user_id, id)
    on delete cascade;

alter table public.fo_manual_holdings
  drop constraint if exists fo_manual_holdings_portfolio_id_fkey,
  drop constraint if exists fo_manual_holdings_owner_portfolio_fkey,
  add constraint fo_manual_holdings_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

alter table public.fo_manual_valuations
  drop constraint if exists fo_manual_valuations_holding_id_fkey,
  drop constraint if exists fo_manual_valuations_owner_holding_fkey,
  add constraint fo_manual_valuations_owner_holding_fkey
    foreign key (owner_user_id, holding_id)
    references public.fo_manual_holdings (owner_user_id, id)
    on delete cascade;

alter table public.fo_performance_daily
  drop constraint if exists fo_performance_daily_portfolio_id_fkey,
  drop constraint if exists fo_performance_daily_owner_portfolio_fkey,
  add constraint fo_performance_daily_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

alter table public.fo_risk_daily
  drop constraint if exists fo_risk_daily_portfolio_id_fkey,
  drop constraint if exists fo_risk_daily_owner_portfolio_fkey,
  add constraint fo_risk_daily_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

alter table public.fo_ips_policies
  drop constraint if exists fo_ips_policies_portfolio_id_fkey,
  drop constraint if exists fo_ips_policies_owner_portfolio_fkey,
  add constraint fo_ips_policies_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

alter table public.fo_allocation_targets
  drop constraint if exists fo_allocation_targets_policy_id_fkey,
  drop constraint if exists fo_allocation_targets_owner_policy_fkey,
  add constraint fo_allocation_targets_owner_policy_fkey
    foreign key (owner_user_id, policy_id)
    references public.fo_ips_policies (owner_user_id, id)
    on delete cascade;

alter table public.fo_exceptions
  drop constraint if exists fo_exceptions_portfolio_id_fkey,
  drop constraint if exists fo_exceptions_account_id_fkey,
  drop constraint if exists fo_exceptions_owner_portfolio_fkey,
  drop constraint if exists fo_exceptions_owner_account_fkey,
  add constraint fo_exceptions_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id),
  add constraint fo_exceptions_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id);

alter table public.fo_decisions
  drop constraint if exists fo_decisions_portfolio_id_fkey,
  drop constraint if exists fo_decisions_owner_portfolio_fkey,
  add constraint fo_decisions_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

alter table public.fo_order_drafts
  drop constraint if exists fo_order_drafts_decision_id_fkey,
  drop constraint if exists fo_order_drafts_account_id_fkey,
  drop constraint if exists fo_order_drafts_owner_decision_fkey,
  drop constraint if exists fo_order_drafts_owner_account_fkey,
  add constraint fo_order_drafts_owner_decision_fkey
    foreign key (owner_user_id, decision_id)
    references public.fo_decisions (owner_user_id, id)
    on delete cascade,
  add constraint fo_order_drafts_owner_account_fkey
    foreign key (owner_user_id, account_id)
    references public.fo_accounts (owner_user_id, id);

alter table public.fo_order_lines
  drop constraint if exists fo_order_lines_order_draft_id_fkey,
  drop constraint if exists fo_order_lines_owner_order_draft_fkey,
  add constraint fo_order_lines_owner_order_draft_fkey
    foreign key (owner_user_id, order_draft_id)
    references public.fo_order_drafts (owner_user_id, id)
    on delete cascade;

alter table public.fo_monthly_closes
  drop constraint if exists fo_monthly_closes_portfolio_id_fkey,
  drop constraint if exists fo_monthly_closes_owner_portfolio_fkey,
  add constraint fo_monthly_closes_owner_portfolio_fkey
    foreign key (owner_user_id, portfolio_id)
    references public.fo_portfolios (owner_user_id, id);

-- Legacy operational tables do not carry an owner identity. They cannot be
-- safely exposed after enabling multiple owners, so their authenticated read
-- path is removed until a separate owner-aware migration exists. Shared market
-- and research reference tables keep their existing registered-owner policy.
do $$
declare
  object_name text;
  legacy_tables constant text[] := array[
    'portfolios', 'portfolio_positions', 'valuation_snapshots',
    'governance_targets', 'decision_journal', 'target_portfolios',
    'target_envelope_weights', 'broker_transactions',
    'broker_reconciliation_runs', 'broker_reconciliation_items',
    'broker_position_snapshot_runs', 'broker_position_snapshot_items',
    'target_models', 'target_buckets', 'target_envelope_lines',
    'target_model_audit_holdings'
  ];
begin
  foreach object_name in array legacy_tables loop
    if to_regclass(format('public.%I', object_name)) is null then
      continue;
    end if;
    execute format('drop policy if exists fo_legacy_owner_read on public.%I', object_name);
    execute format('revoke all on table public.%I from authenticated', object_name);
  end loop;
end;
$$;

commit;
