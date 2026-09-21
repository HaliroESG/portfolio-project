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
              status text not null default 'READY',
              is_active boolean not null default true,
              updated_at timestamptz not null default now()
            );
            create table public.target_buckets (
              id bigserial primary key,
              model_id text not null references public.target_models(id) on delete cascade,
              portfolio_scope text not null,
              bucket_key text not null,
              bucket_label text not null,
              target_weight_pct numeric not null,
              lower_band_pct numeric,
              upper_band_pct numeric
            );
            create table public.portfolios (id text primary key, name text);
            create table public.portfolio_positions (
              id bigserial primary key,
              portfolio_id text not null,
              ticker text,
              name text,
              instrument_type text,
              currency text,
              quantity_current numeric,
              pru numeric,
              actual_as_of_date date
            );
            create table public.market_watch (ticker text, last_price numeric, currency text);
            create table public.currencies (id text, rate_to_eur numeric);
            """
        )
        sql("", file=MIGRATION)
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
          public.target_models,
          public.portfolio_positions,
          public.portfolios,
          public.market_watch,
          public.currencies
        restart identity cascade;
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
        insert into public.portfolios values ('p1', 'PERSO Main'), ('p2', 'PRO Main');
        insert into public.portfolio_positions
          (portfolio_id, ticker, name, instrument_type, currency, quantity_current, pru, actual_as_of_date)
        values
          ('p1', 'AAPL', 'Apple', 'Equity', 'EUR', 10, 100, current_date),
          ('p2', 'AAPL', 'Apple', 'Equity', 'EUR', 10, 100, current_date);
        """
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
        insert into public.portfolios values ('p1', 'PERSO Main'), ('p2', 'PRO Main');
        insert into public.portfolio_positions
          (portfolio_id, ticker, name, instrument_type, currency, quantity_current, pru, actual_as_of_date)
        values
          ('p1', 'AAPL', 'Apple', 'Equity', 'EUR', 10, 100, current_date),
          ('p2', 'AAPL', 'Apple', 'Equity', 'EUR', 10, 100, current_date);
        """
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
    pg_sql(
        """
        update public.target_models set status = 'INVALID' where id = 'perso';
        insert into public.portfolios values ('p1', 'PERSO Main');
        insert into public.portfolio_positions
          (portfolio_id, ticker, name, instrument_type, currency, quantity_current, pru, actual_as_of_date)
        values ('p1', 'BTC', 'Bitcoin', 'Crypto asset', 'EUR', 1, 50000, current_date);
        """
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
    pg_sql(
        """
        insert into public.portfolios values ('p1', 'Household Main');
        insert into public.portfolio_positions
          (portfolio_id, ticker, name, instrument_type, currency, quantity_current, pru, actual_as_of_date)
        values ('p1', 'BTC', 'Bitcoin', 'Crypto asset', 'EUR', 1, 50000, current_date);
        """
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
    pg_sql(
        """
        insert into public.portfolios values ('p1', 'PRO Main');
        insert into public.portfolio_positions
          (portfolio_id, ticker, name, instrument_type, currency, quantity_current, pru, actual_as_of_date)
        values
          ('p1', 'BOND', 'Generic Corporate Bond', 'Bond', 'EUR', 150000, 1, current_date),
          ('p1', 'AAPL', 'Apple', 'Equity', 'EUR', 10, 100, current_date);
        """
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

    pg_sql(
        """
        insert into public.portfolio_positions
          (portfolio_id, ticker, name, instrument_type, currency, quantity_current, pru, actual_as_of_date)
        values ('p1', 'EUBILL', 'EU Treasury Bill', 'T-Bill', 'EUR', 120000, 1, current_date);
        """
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
        delete from public.portfolio_positions where ticker = 'EUBILL';
        """
    )
    pg_sql(
        """
        insert into public.portfolio_positions
          (portfolio_id, ticker, name, instrument_type, currency, quantity_current, pru, actual_as_of_date)
        values ('p1', 'XEON', 'XEON overnight money market', 'ETF', 'EUR', 120000, 1, current_date);
        """
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
