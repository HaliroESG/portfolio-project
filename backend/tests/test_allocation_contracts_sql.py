from pathlib import Path


MIGRATION = Path(__file__).resolve().parents[1] / "sql" / "20260921_allocation_contracts_v1.sql"


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_migration_defines_native_pro_sleeves_and_reserve_contract():
    sql = _sql()

    assert "create table if not exists public.target_sleeve_allocations" in sql
    assert "sleeve_key in ('CORE', 'SATELLITE')" in sql
    assert "reserve_floor_eur" in sql
    assert "reserve_excluded_from_risky_allocation" in sql
    assert "'PRO reserve outside risky allocation'" in sql
    assert "when m.status <> 'READY' then 'UNKNOWN'" in sql
    assert "m.allocation_contract_version <> 'allocation_contracts_v1'" in sql
    assert "coalesce(s.approved_line_count, 0) = 11" in sql
    assert "coalesce(b.crypto_bucket_count, 0) = 1" in sql
    assert "create or replace function public.apply_target_model_v1" in sql
    assert "grant execute on function public.apply_target_model_v1" in sql
    assert "coalesce(a.aligned_bucket_count, 0) = 6" in sql
    assert "coalesce(a.misaligned_bucket_count, 0) = 0" in sql
    assert "abs(coalesce(m.target_total_pct, 0) - 100) <= 0.05" in sql


def test_allocation_view_preserves_missing_and_unmatched_states_without_zero_filling_values():
    sql = _sql()

    assert "sum(coalesce(current_value_eur, 0))" not in sql
    assert "'UNKNOWN'" in sql
    assert "'PARTIAL'" in sql
    assert "'STALE'" in sql
    assert "'UNMATCHED'" in sql
    assert "'Unmatched positions'" in sql
    assert "when data_state <> 'READY' then 'UNAVAILABLE'" in sql
    assert "else 'PERSO'" not in sql
    assert "'Unmatched portfolio scope'" in sql
    assert "'position_scope_unmatched'" in sql


def test_crypto_is_classified_before_cash_and_regional_buckets():
    sql = _sql()

    crypto = sql.index("then 'crypto'")
    cash = sql.index("then 'cash_bonds'", crypto)
    regions = sql.index("then 'actions_pacific_ex_japan'", cash)
    assert crypto < cash < regions


def test_reserve_eligibility_is_distinct_from_cash_bonds_classification():
    sql = _sql()

    assert "end as reserve_eligible" in sql
    assert "count(*) filter (where reserve_eligible) as reserve_eligible_positions" in sql
    assert "sum(current_value_eur) filter (where reserve_eligible) as reserve_current_eur" in sql
    assert "coalesce(p.instrument_type, '') ilike '%bond%'" in sql
    assert "coalesce(p.instrument_type, '') ilike '%bill%'" in sql


def test_advice_uses_private_canonical_sources_and_never_cost_fallbacks():
    sql = _sql()

    assert "from public.fo_positions_latest p" in sql
    assert "from public.fo_cash_balances_latest c" in sql
    assert "join public.fo_portfolios po" in sql
    assert "from public.portfolio_positions" not in sql
    assert "from public.market_watch" not in sql
    assert "p.pru" not in sql
    assert "grant select on public.allocation_advice_items_latest to authenticated, service_role" in sql
    assert "grant select on public.target_sleeve_allocations to anon" not in sql
    assert "p.portfolio_id" in sql
    assert "group by portfolio_scope, portfolio_id, bucket_key" in sql
    assert "c.portfolio_id = m.portfolio_id" in sql


def test_bucket_bounds_and_non_target_rows_are_fail_closed():
    sql = _sql()

    assert "v_invalid_bucket_count" in sql
    assert "target_weight_pct::text in ('NaN', 'Infinity', '-Infinity')" in sql
    assert "'Non-target allocation: ' || c.bucket_key" in sql
    assert "0::numeric as lower_band_pct" in sql
    assert "effective_lower_band_pct" in sql
    assert "effective_upper_band_pct" in sql
