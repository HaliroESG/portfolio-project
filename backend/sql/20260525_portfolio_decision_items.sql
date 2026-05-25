-- Portfolio decision read model.
-- Additive only: imports stay backend/service-role, frontend reads this view.

alter table if exists public.portfolio_positions
  add column if not exists isin text,
  add column if not exists target_notes text;

create index if not exists idx_portfolio_positions_isin
  on public.portfolio_positions(isin);

drop view if exists public.portfolio_decision_items_latest;
drop view if exists public.trident_screener_latest;

create or replace view public.trident_screener_latest
with (security_invoker = true) as
select
  u.instrument_key,
  u.ticker,
  u.name,
  u.exchange,
  u.country,
  u.sector,
  u.industry,
  u.currency,
  u.provider,
  u.provider_symbol,
  u.provider as source_provider,
  u.source_index,
  u.source_license_note,
  u.is_active,
  r.as_of_date,
  r.latest_fiscal_year,
  r.overall_state,
  r.score,
  r.confidence,
  r.growth_score,
  r.profitability_score,
  r.capital_score,
  r.health_score,
  r.latest_roic,
  r.latest_net_debt_to_ebitda,
  r.failed_eliminators,
  r.horizons,
  r.summary,
  nullif(r.summary->>'criteria_pass', '')::integer as criteria_pass_count,
  nullif(r.summary->>'criteria_fail', '')::integer as criteria_fail_count,
  nullif(r.summary->>'criteria_missing', '')::integer as criteria_missing_count,
  greatest(u.updated_at, r.updated_at) as updated_at
from public.trident_equity_universe u
left join public.trident_results r
  on r.instrument_key = u.instrument_key
where u.is_active = true;

grant select on public.trident_screener_latest to anon, authenticated;

create or replace view public.portfolio_decision_items_latest
with (security_invoker = true) as
with latest_price_coverage as (
  select distinct on (upper(ticker))
    upper(ticker) as ticker,
    coverage_pct,
    updated_at
  from public.historical_price_coverage
  order by upper(ticker), updated_at desc nulls last
),
latest_reconciliation_items as (
  select distinct on (
    coalesce(upper(i.symbol), ''),
    coalesce(upper(i.isin), '')
  )
    upper(i.symbol) as symbol,
    upper(i.isin) as isin,
    i.state,
    r.reconciliation_date,
    greatest(i.created_at, r.created_at) as updated_at
  from public.broker_reconciliation_items i
  join public.broker_reconciliation_runs r
    on r.id = i.run_id
  order by
    coalesce(upper(i.symbol), ''),
    coalesce(upper(i.isin), ''),
    r.reconciliation_date desc,
    greatest(i.created_at, r.created_at) desc
),
base as (
  select
    p.portfolio_id,
    upper(p.ticker) as ticker,
    nullif(p.name, '') as name,
    nullif(p.instrument_type, '') as asset_class,
    upper(nullif(p.isin, '')) as isin,
    upper(coalesce(nullif(p.currency, ''), nullif(m.currency, ''), 'EUR')) as currency,
    p.quantity_current::numeric as current_quantity,
    p.target_weight_pct::numeric as target_weight_pct,
    nullif(m.last_price::numeric, 0) as market_price,
    m.last_update as price_updated_at,
    m.data_status as market_data_status,
    case
      when upper(coalesce(nullif(p.currency, ''), nullif(m.currency, ''), 'EUR')) = 'EUR' then 1::numeric
      else nullif(c.rate_to_eur::numeric, 0)
    end as fx_rate_to_eur,
    case
      when m.rsi_14 is null
        and m.macd_line is null
        and m.macd_signal is null
        and m.macd_hist is null
        and m.momentum_20 is null
        and m.trend_state is null
      then true
      else false
    end as technical_missing,
    coalesce(pc.coverage_pct, 0)::numeric as history_coverage_pct,
    tr.provider_symbol as trident_provider_symbol,
    tr.score as trident_score,
    tr.confidence as trident_confidence,
    lr.state as reconciliation_state,
    p.updated_at
  from public.portfolio_positions p
  left join public.market_watch m
    on upper(m.ticker) = upper(p.ticker)
  left join public.currencies c
    on upper(c.id) = upper(coalesce(nullif(p.currency, ''), nullif(m.currency, ''), 'EUR'))
  left join latest_price_coverage pc
    on pc.ticker = upper(p.ticker)
  left join public.trident_screener_latest tr
    on upper(tr.ticker) = upper(p.ticker)
  left join latest_reconciliation_items lr
    on lr.symbol = upper(p.ticker)
    or (p.isin is not null and lr.isin = upper(p.isin))
),
valued as (
  select
    base.*,
    case
      when current_quantity is null then null
      when current_quantity = 0 then 0::numeric
      when market_price is null or fx_rate_to_eur is null then null
      else current_quantity * market_price * fx_rate_to_eur
    end as current_value_eur,
    case
      when price_updated_at is null then 'MISSING'
      when price_updated_at < now() - interval '3 days' then 'STALE'
      else 'LIVE'
    end as price_state
  from base
),
portfolio_totals as (
  select
    portfolio_id,
    sum(coalesce(current_value_eur, 0)) as total_value_eur
  from valued
  group by portfolio_id
),
target_totals as (
  select
    portfolio_id,
    sum(coalesce(target_weight_pct, 0)) as target_total_pct
  from valued
  group by portfolio_id
),
decision_base as (
  select
    v.*,
    pt.total_value_eur,
    tt.target_total_pct,
    case
      when pt.total_value_eur > 0 and v.current_value_eur is not null
      then (v.current_value_eur / pt.total_value_eur) * 100
      else null
    end as current_weight_pct,
    case
      when pt.total_value_eur > 0 and v.current_value_eur is not null and v.target_weight_pct is not null
      then ((v.current_value_eur / pt.total_value_eur) * 100) - v.target_weight_pct
      else null
    end as drift_pct,
    case
      when pt.total_value_eur > 0 and v.current_value_eur is not null and v.target_weight_pct is not null
      then (v.target_weight_pct / 100) * pt.total_value_eur - v.current_value_eur
      else null
    end as rebalance_amount_eur,
    case
      when abs(coalesce(tt.target_total_pct, 0) - 100) > 0.05 then true
      else false
    end as target_total_invalid
  from valued v
  join portfolio_totals pt
    on pt.portfolio_id = v.portfolio_id
  join target_totals tt
    on tt.portfolio_id = v.portfolio_id
),
scored as (
  select
    d.*,
    case
      when d.target_weight_pct is null then 'TARGET_MISSING'
      when d.target_total_invalid then 'TARGET_INVALID'
      when d.current_quantity is null then 'QUANTITY_MISSING'
      when d.current_quantity <> 0 and d.market_price is null then 'PRICE_MISSING'
      when d.current_quantity <> 0 and d.fx_rate_to_eur is null then 'FX_MISSING'
      else 'READY'
    end as data_state,
    array_remove(array[
      case when d.target_weight_pct is null then 'target_missing'::text end,
      case when d.target_total_invalid then 'target_total_invalid'::text end,
      case when d.current_quantity is null then 'quantity_missing'::text end,
      case when d.current_quantity <> 0 and d.market_price is null then 'price_missing'::text end,
      case when d.current_quantity <> 0 and d.fx_rate_to_eur is null then 'fx_missing'::text end,
      case when d.price_state = 'STALE' then 'price_stale'::text end,
      case when d.technical_missing then 'technical_missing'::text end,
      case when d.trident_score is not null and d.history_coverage_pct <= 0 then 'trident_history_missing'::text end,
      case when d.reconciliation_state is not null and d.reconciliation_state <> 'MATCH' then 'reconciliation_mismatch'::text end,
      case when d.drift_pct is not null and abs(d.drift_pct) < 1 then 'in_band'::text end,
      case when d.rebalance_amount_eur is not null and abs(d.rebalance_amount_eur) < 100 then 'below_min_trade'::text end
    ], null) as reason_codes,
    greatest(
      0,
      100
      - case when d.target_weight_pct is null or d.target_total_invalid then 35 else 0 end
      - case when d.current_quantity is null then 25 else 0 end
      - case when d.current_quantity <> 0 and d.market_price is null then 35 else 0 end
      - case when d.current_quantity <> 0 and d.fx_rate_to_eur is null then 25 else 0 end
      - case when d.price_state = 'STALE' then 15 else 0 end
      - case when d.technical_missing then 10 else 0 end
      - case when d.trident_score is not null and d.history_coverage_pct <= 0 then 10 else 0 end
      - case when d.reconciliation_state is not null and d.reconciliation_state <> 'MATCH' then 20 else 0 end
    )::integer as confidence
  from decision_base d
)
select
  portfolio_id,
  ticker,
  coalesce(name, ticker) as name,
  asset_class,
  isin,
  currency,
  current_quantity,
  current_value_eur,
  current_weight_pct,
  target_weight_pct,
  drift_pct,
  rebalance_amount_eur,
  case
    when data_state <> 'READY' then 'UNAVAILABLE'
    when target_weight_pct = 0 and coalesce(current_value_eur, 0) > 0 and abs(coalesce(current_value_eur, 0)) >= 100 then 'EXIT'
    when drift_pct <= -3 and abs(coalesce(rebalance_amount_eur, 0)) >= 100 then 'BUY'
    when drift_pct >= 3 and abs(coalesce(rebalance_amount_eur, 0)) >= 100 then 'REDUCE'
    else 'HOLD'
  end as action,
  confidence,
  reason_codes,
  data_state,
  price_state,
  market_data_status,
  reconciliation_state,
  trident_provider_symbol,
  trident_score,
  trident_confidence,
  history_coverage_pct,
  target_total_pct,
  total_value_eur,
  updated_at
from scored;

grant select on public.portfolio_decision_items_latest to anon, authenticated;
