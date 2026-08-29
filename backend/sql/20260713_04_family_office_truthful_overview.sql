-- A consolidated NAV must never silently treat an unknown component as zero.

create or replace view public.fo_portfolio_overview_latest
with (security_invoker = true)
as
with position_totals as (
  select
    portfolio_id,
    count(*) as item_count,
    coalesce(sum(market_value_eur), 0) as liquid_assets_eur,
    bool_or(market_value_eur is null or data_state = 'MISSING') as has_missing
  from public.fo_positions_latest
  group by portfolio_id
),
cash_totals as (
  select
    portfolio_id,
    count(*) as item_count,
    coalesce(sum(balance_eur), 0) as cash_eur,
    bool_or(balance_eur is null or data_state = 'MISSING') as has_missing
  from public.fo_cash_balances_latest
  group by portfolio_id
),
manual_totals as (
  select
    portfolio_id,
    count(*) filter (where status = 'ACTIVE') as item_count,
    coalesce(sum(value_eur) filter (where status = 'ACTIVE' and holding_kind = 'ASSET'), 0) as manual_assets_eur,
    coalesce(sum(value_eur) filter (where status = 'ACTIVE' and holding_kind = 'LIABILITY'), 0) as liabilities_eur,
    bool_or(status = 'ACTIVE' and value_eur is null) as has_missing
  from public.fo_manual_valuations_latest
  group by portfolio_id
)
select
  portfolio.owner_user_id,
  portfolio.id as portfolio_id,
  portfolio.name as portfolio_name,
  portfolio.portfolio_type,
  portfolio.base_currency,
  portfolio.benchmark_symbol,
  coalesce(position_value.liquid_assets_eur, 0) as liquid_assets_eur,
  coalesce(cash_value.cash_eur, 0) as cash_eur,
  coalesce(manual_value.manual_assets_eur, 0) as manual_assets_eur,
  coalesce(manual_value.liabilities_eur, 0) as liabilities_eur,
  case
    when coalesce(position_value.item_count, 0)
       + coalesce(cash_value.item_count, 0)
       + coalesce(manual_value.item_count, 0) = 0 then null
    when coalesce(position_value.has_missing, false)
      or coalesce(cash_value.has_missing, false)
      or coalesce(manual_value.has_missing, false) then null
    else coalesce(position_value.liquid_assets_eur, 0)
       + coalesce(cash_value.cash_eur, 0)
       + coalesce(manual_value.manual_assets_eur, 0)
       - coalesce(manual_value.liabilities_eur, 0)
  end as net_asset_value_eur,
  performance.twr_mtd,
  performance.twr_ytd,
  performance.xirr_since_inception,
  coalesce(performance.coverage_pct, 0::numeric(7,4)) as coverage_pct,
  coalesce(performance.data_state, 'MISSING') as performance_state,
  risk.volatility_30d_pct,
  risk.max_drawdown_ytd_pct,
  risk.largest_position_pct,
  (select count(*) from public.fo_exceptions exception where exception.portfolio_id = portfolio.id and exception.status in ('OPEN', 'ACKNOWLEDGED')) as open_exception_count,
  greatest(
    coalesce((select max(position.calculated_at) from public.fo_positions_latest position where position.portfolio_id = portfolio.id), portfolio.updated_at),
    coalesce((select max(cash.calculated_at) from public.fo_cash_balances_latest cash where cash.portfolio_id = portfolio.id), portfolio.updated_at),
    portfolio.updated_at
  ) as updated_at
from public.fo_portfolios portfolio
left join position_totals position_value on position_value.portfolio_id = portfolio.id
left join cash_totals cash_value on cash_value.portfolio_id = portfolio.id
left join manual_totals manual_value on manual_value.portfolio_id = portfolio.id
left join lateral (
  select item.*
  from public.fo_performance_daily item
  where item.portfolio_id = portfolio.id
  order by item.performance_date desc
  limit 1
) performance on true
left join lateral (
  select item.*
  from public.fo_risk_daily item
  where item.portfolio_id = portfolio.id
  order by item.risk_date desc
  limit 1
) risk on true
where portfolio.status = 'ACTIVE';

revoke all on public.fo_portfolio_overview_latest from public, anon;
grant select on public.fo_portfolio_overview_latest to authenticated, service_role;

create or replace function fo_private.prevent_closed_month_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'CLOSED' then
    raise exception 'A closed monthly report is immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists fo_monthly_closes_immutable on public.fo_monthly_closes;
create trigger fo_monthly_closes_immutable
before update or delete on public.fo_monthly_closes
for each row execute function fo_private.prevent_closed_month_mutation();
