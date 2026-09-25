-- Remove legacy permissive policies now superseded by the private owner model.
-- Service-role access does not depend on RLS policies.

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname not like 'fo\_%' escape '\'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

-- Relationship indexes used by portfolio reads, close assembly and cascades.
create index if not exists fo_accounts_portfolio_idx
  on public.fo_accounts (portfolio_id);
create index if not exists fo_instrument_aliases_instrument_idx
  on public.fo_instrument_aliases (instrument_id);
create index if not exists fo_cash_balances_portfolio_date_idx
  on public.fo_cash_balances_daily (portfolio_id, balance_date desc);
create index if not exists fo_decisions_portfolio_created_idx
  on public.fo_decisions (portfolio_id, created_at desc);
create index if not exists fo_exceptions_account_status_idx
  on public.fo_exceptions (account_id, status) where account_id is not null;
create index if not exists fo_exceptions_portfolio_status_idx
  on public.fo_exceptions (portfolio_id, status, severity) where portfolio_id is not null;
create index if not exists fo_ips_policies_portfolio_idx
  on public.fo_ips_policies (portfolio_id);
create index if not exists fo_ledger_import_run_idx
  on public.fo_ledger_entries (import_run_id) where import_run_id is not null;
create index if not exists fo_ledger_reversal_idx
  on public.fo_ledger_entries (reversal_of_id) where reversal_of_id is not null;
create index if not exists fo_manual_holdings_portfolio_idx
  on public.fo_manual_holdings (portfolio_id, status);
create index if not exists fo_order_drafts_decision_idx
  on public.fo_order_drafts (decision_id);
create index if not exists fo_order_drafts_account_idx
  on public.fo_order_drafts (account_id);
create index if not exists fo_order_lines_order_idx
  on public.fo_order_lines (order_draft_id);
create index if not exists fo_order_lines_instrument_idx
  on public.fo_order_lines (instrument_id);
create index if not exists fo_portfolios_legal_entity_idx
  on public.fo_portfolios (legal_entity_id);
create index if not exists fo_position_snapshots_instrument_idx
  on public.fo_position_snapshots (instrument_id, snapshot_date desc);
create index if not exists fo_reconciliation_items_instrument_idx
  on public.fo_reconciliation_items (instrument_id) where instrument_id is not null;
create index if not exists fo_reconciliation_runs_import_idx
  on public.fo_reconciliation_runs (import_run_id) where import_run_id is not null;
