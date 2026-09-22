from __future__ import annotations

import shutil
import socket
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path

import pytest


MIGRATION = Path(__file__).resolve().parents[1] / "sql" / "20260921_allocation_contracts_v1.sql"


def _postgres_15_bin() -> Path:
    candidates = [
        Path("/opt/homebrew/opt/postgresql@15/bin"),
        Path("/usr/local/opt/postgresql@15/bin"),
    ]
    postgres = shutil.which("postgres")
    if postgres:
        candidates.append(Path(postgres).parent)
    for candidate in candidates:
        executable = candidate / "postgres"
        if not executable.exists():
            continue
        version = subprocess.run(
            [str(executable), "--version"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        if "PostgreSQL) 15." in version:
            return candidate
    pytest.skip("PostgreSQL 15 binaries are required for allocation contract integration tests")


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


@contextmanager
def _temporary_postgres():
    pg_bin = _postgres_15_bin()
    root = Path(tempfile.mkdtemp(prefix="allocation-contracts-", dir="/tmp"))
    data = root / "data"
    port = _free_port()
    subprocess.run(
        [str(pg_bin / "initdb"), "-D", str(data), "--no-locale", "--encoding=UTF8"],
        check=True,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        [
            str(pg_bin / "pg_ctl"),
            "-D",
            str(data),
            "-o",
            f"-k {root} -p {port} -c listen_addresses=''",
            "-w",
            "start",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    def sql(statement: str, *, file: Path | None = None) -> list[str]:
        command = [
            str(pg_bin / "psql"),
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-h",
            str(root),
            "-p",
            str(port),
            "-At",
            "-F",
            "|",
            "postgres",
        ]
        if file is not None:
            command.extend(["-f", str(file)])
            statement = ""
        result = subprocess.run(
            command,
            input=statement,
            check=True,
            capture_output=True,
            text=True,
        )
        return [line for line in result.stdout.splitlines() if line]

    try:
        sql(
            """
            create role anon;
            create role authenticated;
            create role service_role;
            create table public.target_models (
              id text primary key,
              portfolio_scope text not null,
              model_name text not null,
              source_file text not null,
              source_kind text not null default 'test',
              as_of_date date,
              status text not null default 'READY',
              is_active boolean not null default true,
              target_total_pct numeric,
              report_json jsonb not null default '{}'::jsonb,
              imported_at timestamptz not null default now(),
              updated_at timestamptz not null default now()
            );
            create table public.target_buckets (
              id bigserial primary key,
              model_id text not null references public.target_models(id) on delete cascade,
              portfolio_scope text not null,
              bucket_key text not null,
              bucket_label text not null,
              parent_bucket_key text,
              target_weight_pct numeric not null,
              lower_band_pct numeric,
              upper_band_pct numeric,
              source_sheet text,
              source_row integer,
              updated_at timestamptz not null default now()
            );
            create unique index target_buckets_model_bucket_uq
              on public.target_buckets (model_id, bucket_key);
            create table public.target_envelope_lines (
              id bigserial primary key,
              model_id text not null references public.target_models(id) on delete cascade,
              portfolio_scope text not null,
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
              updated_at timestamptz not null default now()
            );
            create table public.target_model_audit_holdings (
              id bigserial primary key,
              model_id text not null references public.target_models(id) on delete cascade,
              portfolio_scope text not null,
              envelope text not null,
              ticker text,
              isin text,
              instrument text,
              asset_class text,
              region text,
              currency text,
              market_value_eur numeric,
              quantity numeric,
              notes text,
              source_sheet text,
              source_row integer,
              updated_at timestamptz not null default now()
            );
            create table public.fo_portfolios (
              id text primary key,
              portfolio_type text not null
            );
            create table public.fo_instruments (
              id text primary key,
              instrument_key text not null,
              isin text,
              ticker text,
              name text not null,
              instrument_type text not null,
              currency text not null
            );
            create table public.fo_position_snapshots (
              id bigserial primary key,
              portfolio_id text not null,
              account_id text not null,
              instrument_id text not null,
              snapshot_date date not null,
              quantity numeric,
              average_cost numeric,
              cost_basis_eur numeric,
              price_local numeric,
              fx_rate_to_eur numeric,
              market_value_eur numeric,
              unrealized_pnl_eur numeric,
              data_state text not null,
              price_as_of date,
              fx_as_of date,
              reconciliation_state text not null default 'MATCH',
              calculated_at timestamptz not null default now()
            );
            create table public.fo_cash_balances_daily (
              id bigserial primary key,
              portfolio_id text not null,
              account_id text not null,
              balance_date date not null,
              currency text not null,
              balance_local numeric not null,
              fx_rate_to_eur numeric,
              balance_eur numeric,
              data_state text not null,
              calculated_at timestamptz not null default now()
            );
            create view public.fo_positions_latest as
            select
              fo_position_snapshots.id, null::text as owner_user_id, portfolio_id, account_id, instrument_id,
              instrument_key, isin, ticker, name, instrument_type, currency,
              snapshot_date, quantity, average_cost, cost_basis_eur, price_local,
              fx_rate_to_eur, market_value_eur, unrealized_pnl_eur, data_state,
              price_as_of, fx_as_of, reconciliation_state, calculated_at
            from public.fo_position_snapshots
            join public.fo_instruments on fo_instruments.id = fo_position_snapshots.instrument_id;
            create view public.fo_cash_balances_latest as
            select id, null::text as owner_user_id, portfolio_id, account_id, balance_date,
              currency, balance_local, fx_rate_to_eur, balance_eur, data_state, calculated_at
            from public.fo_cash_balances_daily;
            """
        )
        sql("", file=MIGRATION)
        sql(
            """
            grant usage on schema public to authenticated, service_role;
            grant select on public.target_models, public.target_buckets,
              public.fo_portfolios, public.fo_instruments, public.fo_position_snapshots,
              public.fo_cash_balances_daily, public.fo_positions_latest,
              public.fo_cash_balances_latest to authenticated, service_role;
            """
        )
        yield sql
    finally:
        subprocess.run(
            [str(pg_bin / "pg_ctl"), "-D", str(data), "-m", "fast", "stop"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture(scope="module")
def pg_sql():
    with _temporary_postgres() as sql:
        yield sql


def _reset(sql):
    sql(
        """
        truncate table public.target_sleeve_allocations,
          public.target_buckets,
          public.target_envelope_lines,
          public.target_model_audit_holdings,
          public.target_models,
          public.fo_position_snapshots,
          public.fo_cash_balances_daily,
          public.fo_instruments,
          public.fo_portfolios
        restart identity cascade;
        """
    )


def _literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _insert_position(
    sql,
    *,
    portfolio_id: str,
    portfolio_type: str,
    ticker: str,
    name: str,
    instrument_type: str,
    market_value_eur: str,
    currency: str = "EUR",
    data_state: str = "READY",
    as_of: str = "current_date",
    price_as_of: str | None = None,
    fx_as_of: str | None = None,
):
    instrument_id = f"{portfolio_id}:{ticker}"
    price_date = price_as_of or as_of
    fx_date = fx_as_of or as_of
    sql(
        f"""
        insert into public.fo_portfolios (id, portfolio_type)
        values ({_literal(portfolio_id)}, {_literal(portfolio_type)})
        on conflict (id) do nothing;
        insert into public.fo_instruments
          (id, instrument_key, ticker, name, instrument_type, currency)
        values (
          {_literal(instrument_id)}, {_literal(instrument_id)}, {_literal(ticker)},
          {_literal(name)}, {_literal(instrument_type)}, {_literal(currency)}
        )
        on conflict (id) do nothing;
        insert into public.fo_position_snapshots
          (portfolio_id, account_id, instrument_id, snapshot_date, quantity,
           average_cost, price_local, fx_rate_to_eur, market_value_eur, data_state,
           price_as_of, fx_as_of, reconciliation_state)
        values (
          {_literal(portfolio_id)}, {_literal(portfolio_id + ':account')}, {_literal(instrument_id)},
          {as_of}, 1, 999, null, 1, {market_value_eur}, {_literal(data_state)},
          {price_date}, {fx_date}, 'MATCH'
        );
        """
    )


def _insert_cash(
    sql,
    *,
    portfolio_id: str,
    portfolio_type: str,
    balance_eur: str,
    data_state: str = "READY",
    as_of: str = "current_date",
):
    sql(
        f"""
        insert into public.fo_portfolios (id, portfolio_type)
        values ({_literal(portfolio_id)}, {_literal(portfolio_type)})
        on conflict (id) do nothing;
        insert into public.fo_cash_balances_daily
          (portfolio_id, account_id, balance_date, currency, balance_local,
           fx_rate_to_eur, balance_eur, data_state)
        values (
          {_literal(portfolio_id)}, {_literal(portfolio_id + ':cash')}, {as_of},
          'EUR', {balance_eur}, 1, {balance_eur}, {_literal(data_state)}
        );
        """
    )


def _insert_valid_perso_contract(sql):
    sql(
        """
        insert into public.target_models
          (id, portfolio_scope, model_name, source_file, status, allocation_contract_version)
        values ('perso', 'PERSO', 'Perso', 'perso.xlsx', 'READY', 'allocation_contracts_v1');
        insert into public.target_buckets
          (model_id, portfolio_scope, bucket_key, bucket_label, target_weight_pct, lower_band_pct, upper_band_pct)
        values
          ('perso', 'PERSO', 'actions_us', 'Actions US', 98, null, null),
          ('perso', 'PERSO', 'crypto', 'Crypto', 2, 0, 4);
        """
    )


def _insert_valid_pro_contract(sql):
    sql(
        """
        insert into public.target_models
          (id, portfolio_scope, model_name, source_file, status, allocation_contract_version, reserve_floor_eur, reserve_excluded_from_risky_allocation)
        values ('pro', 'PRO', 'Pro', 'pro.xlsx', 'READY', 'allocation_contracts_v1', 120000, true);
        insert into public.target_buckets
          (model_id, portfolio_scope, bucket_key, bucket_label, target_weight_pct)
        values
          ('pro', 'PRO', 'actions_us', 'Actions US', 41),
          ('pro', 'PRO', 'actions_europe', 'Actions Europe', 18),
          ('pro', 'PRO', 'actions_japan', 'Actions Japan', 10),
          ('pro', 'PRO', 'actions_pacific_ex_japan', 'Actions Pacific ex-Japan', 5),
          ('pro', 'PRO', 'actions_emerging', 'Actions Emerging', 16),
          ('pro', 'PRO', 'gold', 'Gold', 10);
        insert into public.target_sleeve_allocations
          (model_id, portfolio_scope, sleeve_key, component_label, bucket_key, bucket_label, target_weight_pct, activation_status)
        values
          ('pro', 'PRO', 'CORE', 'Index', 'actions_us', 'US', 28, 'NOT_ACTIVATED'),
          ('pro', 'PRO', 'CORE', 'Index', 'actions_europe', 'Europe', 12, 'NOT_ACTIVATED'),
          ('pro', 'PRO', 'CORE', 'Index', 'actions_japan', 'Japan', 7, 'NOT_ACTIVATED'),
          ('pro', 'PRO', 'CORE', 'Index', 'actions_pacific_ex_japan', 'Pacific', 4, 'NOT_ACTIVATED'),
          ('pro', 'PRO', 'CORE', 'Index', 'actions_emerging', 'Emerging', 9, 'NOT_ACTIVATED'),
          ('pro', 'PRO', 'CORE', 'Gold', 'gold', 'Gold', 10, 'NOT_ACTIVATED'),
          ('pro', 'PRO', 'SATELLITE', 'Quality', 'actions_us', 'US', 13, 'NOT_ACTIVATED'),
          ('pro', 'PRO', 'SATELLITE', 'Quality', 'actions_europe', 'Europe', 6, 'NOT_ACTIVATED'),
          ('pro', 'PRO', 'SATELLITE', 'Quality', 'actions_japan', 'Japan', 3, 'NOT_ACTIVATED'),
          ('pro', 'PRO', 'SATELLITE', 'Quality', 'actions_pacific_ex_japan', 'Pacific', 1, 'NOT_ACTIVATED'),
          ('pro', 'PRO', 'SATELLITE', 'Quality', 'actions_emerging', 'Emerging', 7, 'NOT_ACTIVATED');
        """
    )


def test_pre_import_models_cannot_emit_ready_advice(pg_sql):
    _reset(pg_sql)
    pg_sql(
        """
        insert into public.target_models (id, portfolio_scope, model_name, source_file, status)
        values
          ('perso-old', 'PERSO', 'Old Perso', 'old-perso.xlsx', 'READY'),
          ('pro-old', 'PRO', 'Old Pro', 'old-pro.xlsx', 'READY');
        insert into public.target_buckets
          (model_id, portfolio_scope, bucket_key, bucket_label, target_weight_pct)
        values
          ('perso-old', 'PERSO', 'actions_us', 'Actions US', 100),
          ('pro-old', 'PRO', 'actions_us', 'Actions US', 100);
        """
    )
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PERSONAL", ticker="AAPL",
        name="Apple", instrument_type="EQUITY", market_value_eur="1000",
    )
    _insert_position(
        pg_sql, portfolio_id="p2", portfolio_type="PROFESSIONAL", ticker="AAPL",
        name="Apple", instrument_type="EQUITY", market_value_eur="1000",
    )

    perso_rows = pg_sql(
        """
        select data_state, action, model_contract_state, model_contract_reason
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PERSO' and bucket_key = 'actions_us';
        """
    )

    pro_rows = pg_sql(
        """
        select data_state, action, model_contract_state, model_contract_reason
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PRO' and bucket_key = 'actions_us';
        """
    )
    contract_rows = pg_sql(
        """
        select portfolio_scope, data_state, action, model_contract_reason
        from public.allocation_advice_items_latest
        where bucket_key = 'model_contract'
        order by portfolio_scope;
        """
    )

    assert perso_rows == ["UNKNOWN|UNAVAILABLE|UNKNOWN|target_model_contract_version_missing"]
    assert pro_rows == ["UNKNOWN|UNAVAILABLE|UNKNOWN|target_model_contract_version_missing"]
    assert contract_rows == [
        "PERSO|UNKNOWN|UNAVAILABLE|target_model_contract_version_missing",
        "PRO|UNKNOWN|UNAVAILABLE|target_model_contract_version_missing",
    ]


def test_current_contract_version_does_not_bypass_shape_qualification(pg_sql):
    _reset(pg_sql)
    pg_sql(
        """
        insert into public.target_models
          (id, portfolio_scope, model_name, source_file, status, allocation_contract_version)
        values
          ('perso-incomplete', 'PERSO', 'Perso', 'perso.xlsx', 'READY', 'allocation_contracts_v1'),
          ('pro-incomplete', 'PRO', 'Pro', 'pro.xlsx', 'READY', 'allocation_contracts_v1');
        insert into public.target_buckets
          (model_id, portfolio_scope, bucket_key, bucket_label, target_weight_pct)
        values
          ('perso-incomplete', 'PERSO', 'actions_us', 'Actions US', 100),
          ('pro-incomplete', 'PRO', 'actions_us', 'Actions US', 100);
        """
    )
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PERSONAL", ticker="AAPL",
        name="Apple", instrument_type="EQUITY", market_value_eur="1000",
    )
    _insert_position(
        pg_sql, portfolio_id="p2", portfolio_type="PROFESSIONAL", ticker="AAPL",
        name="Apple", instrument_type="EQUITY", market_value_eur="1000",
    )

    rows = pg_sql(
        """
        select portfolio_scope, model_contract_reason, data_state, action
        from public.allocation_advice_items_latest
        where bucket_key = 'actions_us'
        order by portfolio_scope;
        """
    )

    assert rows == [
        "PERSO|perso_model_contract_incomplete|UNKNOWN|UNAVAILABLE",
        "PRO|pro_model_contract_incomplete|UNKNOWN|UNAVAILABLE",
    ]


def test_model_status_must_be_ready_even_when_contract_rows_are_complete(pg_sql):
    _reset(pg_sql)
    _insert_valid_perso_contract(pg_sql)
    pg_sql("update public.target_models set status = 'INVALID' where id = 'perso';")
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PERSONAL", ticker="BTC",
        name="Bitcoin", instrument_type="CRYPTO", market_value_eur="50000",
    )

    rows = pg_sql(
        """
        select data_state, action, model_contract_state, model_contract_reason
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PERSO' and bucket_key = 'crypto';
        """
    )

    assert rows == ["UNKNOWN|UNAVAILABLE|UNKNOWN|target_model_status_not_ready"]


def test_unmatched_portfolio_scope_is_visible_and_never_counted_as_perso(pg_sql):
    _reset(pg_sql)
    _insert_valid_perso_contract(pg_sql)
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="OTHER", ticker="BTC",
        name="Bitcoin", instrument_type="CRYPTO", market_value_eur="50000",
    )

    target = pg_sql(
        """
        select current_value_eur, data_state, action, unmatched_scope_positions,
          array_to_string(reason_codes, ',')
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PERSO' and bucket_key = 'crypto';
        """
    )
    unmatched = pg_sql(
        """
        select current_value_eur, data_state, action, array_to_string(reason_codes, ',')
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PERSO' and bucket_key = 'unmatched_scope';
        """
    )

    assert target == ["|PARTIAL|UNAVAILABLE|1|current_value_partial,scope_contains_unmatched_portfolio,flows_first"]
    assert unmatched == ["50000|UNMATCHED|UNAVAILABLE|position_scope_unmatched"]


def test_generic_bond_is_not_pro_reserve_but_eu_bill_and_xeon_are(pg_sql):
    _reset(pg_sql)
    _insert_valid_pro_contract(pg_sql)
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PROFESSIONAL", ticker="BOND",
        name="Generic Corporate Bond", instrument_type="BOND", market_value_eur="150000",
    )
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PROFESSIONAL", ticker="AAPL",
        name="Apple", instrument_type="EQUITY", market_value_eur="1000",
    )

    before = pg_sql(
        """
        select reserve_current_eur, reserve_eligible_positions, reserve_state, action,
          allocatable_total_eur, array_to_string(reason_codes, ',')
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PRO' and bucket_key = 'pro_reserve';
        """
    )
    assert before == ["|0|UNKNOWN|UNAVAILABLE||current_value_unknown,pro_reserve_unknown"]

    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PROFESSIONAL", ticker="EUBILL",
        name="EU Treasury Bill", instrument_type="BOND", market_value_eur="120000",
    )
    eu_bill = pg_sql(
        """
        select reserve_current_eur, reserve_eligible_positions, reserve_state, action,
          allocatable_total_eur
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PRO' and bucket_key = 'pro_reserve';
        """
    )
    assert eu_bill == ["120000|1|READY|HOLD|151000"]

    pg_sql(
        """
        delete from public.fo_position_snapshots where instrument_id = 'p1:EUBILL';
        delete from public.fo_instruments where id = 'p1:EUBILL';
        """
    )
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PROFESSIONAL", ticker="XEON",
        name="XEON overnight money market", instrument_type="ETF", market_value_eur="120000",
    )
    after = pg_sql(
        """
        select reserve_current_eur, reserve_eligible_positions, reserve_state, action,
          allocatable_total_eur
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PRO' and bucket_key = 'pro_reserve';
        """
    )
    assert after == ["120000|1|READY|HOLD|151000"]


def test_pro_bucket_weights_must_equal_aggregated_sleeves(pg_sql):
    _reset(pg_sql)
    _insert_valid_pro_contract(pg_sql)
    pg_sql(
        """
        update public.target_buckets
        set target_weight_pct = case
          when bucket_key = 'actions_us' then 42
          when bucket_key = 'actions_europe' then 17
          else target_weight_pct
        end
        where model_id = 'pro';
        """
    )
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PROFESSIONAL", ticker="XEON",
        name="XEON overnight money market", instrument_type="ETF", market_value_eur="120000",
    )
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PROFESSIONAL", ticker="AAPL",
        name="Apple", instrument_type="EQUITY", market_value_eur="1000",
    )

    rows = pg_sql(
        """
        select model_contract_state, model_contract_reason, data_state, action
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PRO' and bucket_key = 'actions_us';
        """
    )

    assert rows == ["UNKNOWN|pro_model_contract_incomplete|UNKNOWN|UNAVAILABLE"]


def test_atomic_rpc_rolls_back_parent_and_children_on_mid_apply_failure(pg_sql):
    _reset(pg_sql)
    _insert_valid_perso_contract(pg_sql)
    pg_sql(
        """
        do $test$
        begin
          perform public.apply_target_model_v1(
            '{
              "id":"perso",
              "portfolio_scope":"PERSO",
              "model_name":"Replacement",
              "source_file":"replacement.xlsx",
              "allocation_contract_version":"allocation_contracts_v1",
              "source_kind":"perso",
              "is_active":true,
              "target_total_pct":100,
              "reserve_floor_eur":null,
              "reserve_excluded_from_risky_allocation":false,
              "status":"READY",
              "report_json":{}
            }'::jsonb,
            '[
              {"model_id":"perso","portfolio_scope":"PERSO","bucket_key":"actions_us","bucket_label":"US 1","target_weight_pct":49,"source_sheet":"test","source_row":1},
              {"model_id":"perso","portfolio_scope":"PERSO","bucket_key":"actions_us","bucket_label":"US 2","target_weight_pct":49,"source_sheet":"test","source_row":2},
              {"model_id":"perso","portfolio_scope":"PERSO","bucket_key":"crypto","bucket_label":"Crypto","target_weight_pct":2,"lower_band_pct":0,"upper_band_pct":4,"source_sheet":"test","source_row":3}
            ]'::jsonb,
            '[]'::jsonb,
            '[
              {"model_id":"perso","portfolio_scope":"PERSO","envelope":"PEA","ticker":"AAPL","target_weight_pct":100}
            ]'::jsonb,
            '[]'::jsonb
          );
        exception when unique_violation then
          null;
        end
        $test$;
        """
    )

    model = pg_sql("select source_file from public.target_models where id = 'perso';")
    buckets = pg_sql(
        """
        select bucket_key, target_weight_pct
        from public.target_buckets
        where model_id = 'perso'
        order by bucket_key;
        """
    )

    assert model == ["perso.xlsx"]
    assert buckets == ["actions_us|98", "crypto|2"]


def test_private_allocation_contract_objects_are_not_readable_by_anon(pg_sql):
    _reset(pg_sql)
    _insert_valid_perso_contract(pg_sql)

    with pytest.raises(subprocess.CalledProcessError):
        pg_sql("set role anon; select count(*) from public.target_sleeve_allocations;")
    with pytest.raises(subprocess.CalledProcessError):
        pg_sql("set role anon; select count(*) from public.allocation_advice_items_latest;")

    assert pg_sql(
        "set role authenticated; select count(*) from public.target_sleeve_allocations;"
    ) == ["SET", "0"]
    assert pg_sql(
        "set role service_role; select count(*) from public.allocation_advice_items_latest;"
    ) == ["SET", "2"]


def test_canonical_market_value_is_required_and_average_cost_is_never_a_fallback(pg_sql):
    _reset(pg_sql)
    _insert_valid_perso_contract(pg_sql)
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PERSONAL", ticker="AAPL",
        name="Apple", instrument_type="EQUITY", market_value_eur="null",
    )

    rows = pg_sql(
        """
        select current_value_eur, data_state, action,
          array_to_string(reason_codes, ',')
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PERSO' and bucket_key = 'actions_us';
        """
    )

    assert rows == ["|UNKNOWN|UNAVAILABLE|current_value_unknown,position_value_unavailable,flows_first"]


def test_pro_non_target_bond_is_explicit_and_eu_bill_is_not_unmatched(pg_sql):
    _reset(pg_sql)
    _insert_valid_pro_contract(pg_sql)
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PROFESSIONAL", ticker="BOND",
        name="Generic Corporate Bond", instrument_type="BOND", market_value_eur="150000",
    )
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PROFESSIONAL", ticker="EUBILL",
        name="EU Treasury Bill", instrument_type="BOND", market_value_eur="120000",
    )
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PROFESSIONAL", ticker="AAPL",
        name="Apple", instrument_type="EQUITY", market_value_eur="1000",
    )

    rows = pg_sql(
        """
        select bucket_key, current_value_eur, target_weight_pct, unmatched_positions,
          action, data_state
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PRO' and bucket_key = 'cash_bonds';
        """
    )

    assert rows == ["cash_bonds|150000|0|0|REDUCE|READY"]


def test_rpc_rejects_out_of_range_bucket_before_replacing_existing_contract(pg_sql):
    _reset(pg_sql)
    _insert_valid_perso_contract(pg_sql)

    with pytest.raises(subprocess.CalledProcessError):
        pg_sql(
            """
            select public.apply_target_model_v1(
              '{
                "id":"perso","portfolio_scope":"PERSO","model_name":"Invalid",
                "source_file":"invalid.xlsx","allocation_contract_version":"allocation_contracts_v1",
                "source_kind":"perso","is_active":true,"target_total_pct":100,
                "reserve_floor_eur":null,"reserve_excluded_from_risky_allocation":false,
                "status":"READY","report_json":{}
              }'::jsonb,
              '[
                {"model_id":"perso","portfolio_scope":"PERSO","bucket_key":"actions_us","bucket_label":"US","target_weight_pct":150},
                {"model_id":"perso","portfolio_scope":"PERSO","bucket_key":"crypto","bucket_label":"Crypto","target_weight_pct":-50,"lower_band_pct":0,"upper_band_pct":4}
              ]'::jsonb,
              '[]'::jsonb,
              '[{"model_id":"perso","portfolio_scope":"PERSO","envelope":"PEA","ticker":"AAPL","target_weight_pct":100}]'::jsonb,
              '[]'::jsonb
            );
            """
        )

    assert pg_sql("select source_file from public.target_models where id = 'perso';") == ["perso.xlsx"]
    assert pg_sql(
        "select bucket_key, target_weight_pct from public.target_buckets where model_id = 'perso' order by bucket_key;"
    ) == ["actions_us|98", "crypto|2"]


def test_rpc_rejects_invalid_envelope_weights_before_replacing_existing_contract(pg_sql):
    _reset(pg_sql)
    _insert_valid_perso_contract(pg_sql)

    with pytest.raises(subprocess.CalledProcessError):
        pg_sql(
            """
            select public.apply_target_model_v1(
              '{
                "id":"perso","portfolio_scope":"PERSO","model_name":"Invalid",
                "source_file":"invalid-envelope.xlsx","allocation_contract_version":"allocation_contracts_v1",
                "source_kind":"perso","is_active":true,"target_total_pct":100,
                "reserve_floor_eur":null,"reserve_excluded_from_risky_allocation":false,
                "status":"READY","report_json":{}
              }'::jsonb,
              '[
                {"model_id":"perso","portfolio_scope":"PERSO","bucket_key":"actions_us","bucket_label":"US","target_weight_pct":98},
                {"model_id":"perso","portfolio_scope":"PERSO","bucket_key":"crypto","bucket_label":"Crypto","target_weight_pct":2,"lower_band_pct":0,"upper_band_pct":4}
              ]'::jsonb,
              '[]'::jsonb,
              '[
                {"model_id":"perso","portfolio_scope":"PERSO","envelope":"PEA","ticker":"AAPL","target_weight_pct":150},
                {"model_id":"perso","portfolio_scope":"PERSO","envelope":"PEA","ticker":"BTC","target_weight_pct":-50}
              ]'::jsonb,
              '[]'::jsonb
            );
            """
        )

    assert pg_sql("select source_file from public.target_models where id = 'perso';") == ["perso.xlsx"]


def test_position_valuation_freshness_uses_oldest_price_or_fx_date(pg_sql):
    _reset(pg_sql)
    _insert_valid_perso_contract(pg_sql)
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PERSONAL", ticker="AAPL",
        name="Apple", instrument_type="EQUITY", market_value_eur="98000",
        price_as_of="current_date - 10", fx_as_of="current_date",
    )
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PERSONAL", ticker="BTC",
        name="Bitcoin", instrument_type="CRYPTO", market_value_eur="2000",
    )

    rows = pg_sql(
        """
        select data_state, action, array_to_string(reason_codes, ',')
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PERSO' and bucket_key = 'actions_us';
        """
    )

    assert rows == ["STALE|UNAVAILABLE|current_value_stale,flows_first"]


def test_advice_actions_use_configured_bucket_bands(pg_sql):
    _reset(pg_sql)
    _insert_valid_perso_contract(pg_sql)
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PERSONAL", ticker="AAPL",
        name="Apple", instrument_type="EQUITY", market_value_eur="95500",
    )
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PERSONAL", ticker="BTC",
        name="Bitcoin", instrument_type="CRYPTO", market_value_eur="4500",
    )

    rows = pg_sql(
        """
        select bucket_key, round(current_weight_pct, 2), action,
          preferred_execution, array_to_string(reason_codes, ',')
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PERSO' and bucket_key in ('actions_us', 'crypto')
        order by bucket_key;
        """
    )

    assert rows == [
        "actions_us|95.50|HOLD|MONITOR|in_band,flows_first",
        "crypto|4.50|REDUCE|INTERNAL_ARBITRAGE|flows_first",
    ]


def test_advice_holds_when_band_breach_is_below_minimum_trade(pg_sql):
    _reset(pg_sql)
    _insert_valid_perso_contract(pg_sql)
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PERSONAL", ticker="AAPL",
        name="Apple", instrument_type="EQUITY", market_value_eur="955",
    )
    _insert_position(
        pg_sql, portfolio_id="p1", portfolio_type="PERSONAL", ticker="BTC",
        name="Bitcoin", instrument_type="CRYPTO", market_value_eur="45",
    )

    rows = pg_sql(
        """
        select round(current_weight_pct, 2), action, preferred_execution,
          array_to_string(reason_codes, ',')
        from public.allocation_advice_items_latest
        where portfolio_scope = 'PERSO' and bucket_key = 'crypto';
        """
    )

    assert rows == ["4.50|HOLD|MONITOR|below_min_trade,flows_first"]
