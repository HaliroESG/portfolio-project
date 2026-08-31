#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from broker_ingest.models import CanonicalTransaction  # noqa: E402
from broker_ingest.sync_reconciliation import persist_reconciliation_report  # noqa: E402
from broker_ingest.sync_transactions import upsert_canonical_transactions  # noqa: E402
from scripts.import_target_model import (  # noqa: E402
    TargetAuditHolding,
    TargetBucket,
    TargetEnvelopeLine,
    apply_target_model,
)

OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")


def _identifier(value: str) -> str:
    if not IDENTIFIER.fullmatch(value):
        raise RuntimeError(f"unsafe SQL identifier: {value}")
    return f'"{value}"'


def _encoded_json(value: Any) -> str:
    raw = json.dumps(value, separators=(",", ":"), default=str).encode("utf-8")
    encoded = base64.b64encode(raw).decode("ascii")
    return f"convert_from(decode('{encoded}', 'base64'), 'UTF8')::json"


class _Response:
    def __init__(self, data: list[dict[str, Any]] | None = None):
        self.data = data or []


class _PostgresTable:
    def __init__(self, client: "_PostgresClient", name: str):
        self.client = client
        self.name = name
        self.operation: str | None = None
        self.payload: Any = None
        self.on_conflict: str | None = None
        self.filters: list[tuple[str, Any]] = []

    def upsert(self, payload: Any, on_conflict: str):
        self.operation = "upsert"
        self.payload = payload
        self.on_conflict = on_conflict
        return self

    def insert(self, payload: Any):
        self.operation = "insert"
        self.payload = payload
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def eq(self, column: str, value: Any):
        self.filters.append((column, value))
        return self

    def execute(self) -> _Response:
        table = _identifier(self.name)
        if self.operation in {"insert", "upsert"}:
            rows = self.payload if isinstance(self.payload, list) else [self.payload]
            if not rows:
                return _Response()
            columns = list(rows[0])
            if any(list(row) != columns for row in rows):
                raise RuntimeError("writer payload columns are inconsistent")
            column_sql = ", ".join(_identifier(column) for column in columns)
            json_sql = _encoded_json(rows)
            conflict_sql = ""
            if self.operation == "upsert":
                conflict_columns = [part.strip() for part in (self.on_conflict or "").split(",")]
                if not all(conflict_columns):
                    raise RuntimeError("upsert conflict target is required")
                assignments = [column for column in columns if column not in conflict_columns]
                update_sql = ", ".join(
                    f"{_identifier(column)} = excluded.{_identifier(column)}"
                    for column in assignments
                )
                conflict_sql = (
                    f" on conflict ({', '.join(_identifier(column) for column in conflict_columns)})"
                    f" do update set {update_sql}"
                )
            sql = (
                "with incoming as ("
                f"select {column_sql} from json_populate_recordset(null::public.{table}, {json_sql})"
                "), written as ("
                f"insert into public.{table} ({column_sql}) select {column_sql} from incoming"
                f"{conflict_sql} returning *"
                ") select coalesce(json_agg(row_to_json(written)), '[]'::json) from written;"
            )
            return _Response(self.client.json_query(sql))

        if self.operation == "delete":
            clauses = []
            for column, value in self.filters:
                encoded = base64.b64encode(str(value).encode("utf-8")).decode("ascii")
                clauses.append(
                    f"{_identifier(column)}::text = convert_from(decode('{encoded}', 'base64'), 'UTF8')"
                )
            where = " and ".join(clauses) if clauses else "false"
            self.client.execute(f"delete from public.{table} where {where};")
            return _Response()

        raise RuntimeError("unsupported fake Supabase operation")


class _PostgresClient:
    def __init__(self, psql: str, socket: str, database: str):
        self.command = [psql, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", socket, "-U", "postgres", "-d", database]

    def table(self, name: str) -> _PostgresTable:
        return _PostgresTable(self, name)

    def execute(self, sql: str) -> str:
        result = subprocess.run(
            self.command,
            input=sql,
            text=True,
            check=True,
            capture_output=True,
            env={**os.environ, "PGOPTIONS": "-c client_min_messages=warning"},
        )
        return result.stdout.strip()

    def json_query(self, sql: str) -> list[dict[str, Any]]:
        output = self.execute(sql)
        return json.loads(output or "[]")

    def scalar(self, sql: str) -> str:
        return self.execute(sql).splitlines()[-1]


def _transaction() -> CanonicalTransaction:
    return CanonicalTransaction(
        broker="FORTUNEO",
        account_id="shared-account",
        external_txn_id="shared-transaction",
        trade_date=date(2026, 8, 29),
        settlement_date=None,
        symbol="AAA",
        isin=None,
        side="BUY",
        quantity=Decimal("1"),
        price=Decimal("10"),
        gross_amount=Decimal("-10"),
        fees=Decimal("0"),
        taxes=Decimal("0"),
        net_amount=Decimal("-10"),
        currency="EUR",
        envelope="CTO",
        raw_type="BUY",
    )


def _reconciliation_report() -> dict[str, Any]:
    return {
        "broker": "FORTUNEO",
        "account_id": "shared-account",
        "source_file": "transactions.csv",
        "parsed_count": 1,
        "reconciliation": {
            "mode": "broker_snapshot",
            "snapshot_provided": True,
            "state_counts": {"MATCH": 1},
            "positions": [{
                "instrument_key": "ticker:AAA",
                "symbol": "AAA",
                "isin": None,
                "currency": "EUR",
                "state": "MATCH",
                "ledger_quantity": "1",
                "broker_quantity": "1",
                "quantity_delta": "0",
                "ledger_average_cost": "10",
                "broker_average_cost": "10",
                "transaction_count": 1,
            }],
            "ledger_only": [],
        },
    }


def _target_report() -> dict[str, Any]:
    return {
        "ok": True,
        "kind": "perso",
        "portfolio_scope": "PERSO",
        "model_id": "target_model:perso:active",
        "model_name": "Synthetic target",
        "source_file": "synthetic.xlsx",
        "target_total_pct": 100,
        "report_json": {"synthetic": True},
        "buckets": [TargetBucket(
            model_id="target_model:perso:active",
            portfolio_scope="PERSO",
            bucket_key="equity",
            bucket_label="Equity",
            parent_bucket_key=None,
            target_weight_pct=100,
            lower_band_pct=None,
            upper_band_pct=None,
            source_sheet="synthetic",
            source_row=1,
        )],
        "envelope_lines": [TargetEnvelopeLine(
            model_id="target_model:perso:active",
            portfolio_scope="PERSO",
            envelope="CTO",
            ticker="AAA",
            isin=None,
            instrument="AAA",
            asset_class="Equity",
            region="EU",
            currency="EUR",
            target_weight_pct=100,
            target_value_eur=None,
            notes=None,
            source_sheet="synthetic",
            source_row=1,
        )],
        "audit_holdings": [TargetAuditHolding(
            model_id="target_model:perso:active",
            portfolio_scope="PERSO",
            envelope="CTO",
            ticker="AAA",
            isin=None,
            instrument="AAA",
            asset_class="Equity",
            region="EU",
            currency="EUR",
            market_value_eur=10,
            quantity=1,
            notes=None,
            source_sheet="synthetic",
            source_row=1,
        )],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--psql", required=True)
    parser.add_argument("--socket", required=True)
    parser.add_argument("--database", required=True)
    args = parser.parse_args()
    client = _PostgresClient(args.psql, args.socket, args.database)

    for owner in (OWNER_A, OWNER_B):
        upsert_canonical_transactions(
            client,
            [_transaction()],
            owner_user_id=owner,
            source_file="transactions.csv",
        )
        persist_reconciliation_report(
            client,
            _reconciliation_report(),
            reconciliation_date=date(2026, 8, 29),
            owner_user_id=owner,
            source_file="transactions.csv",
            positions_file="positions.csv",
        )
        apply_target_model(
            _target_report(),
            supabase_client=client,
            owner_user_id=owner,
        )

    # Replaying A exercises the composite conflict and owner-filtered replacement.
    upsert_canonical_transactions(
        client,
        [_transaction()],
        owner_user_id=OWNER_A,
        source_file="transactions.csv",
    )
    apply_target_model(_target_report(), supabase_client=client, owner_user_id=OWNER_A)

    assertions = {
        "transactions": "select count(*) from public.broker_transactions where account_id = 'shared-account'",
        "transaction_owners": "select count(distinct owner_user_id) from public.broker_transactions where account_id = 'shared-account'",
        "reconciliation_runs": "select count(*) from public.broker_reconciliation_runs where account_id = 'shared-account'",
        "reconciliation_item_owners": "select count(distinct owner_user_id) from public.broker_reconciliation_items where instrument_key = 'ticker:AAA'",
        "target_models": "select count(*) from public.target_models where source_file = 'synthetic.xlsx'",
        "target_model_owners": "select count(distinct owner_user_id) from public.target_models where source_file = 'synthetic.xlsx'",
        "target_bucket_owners": "select count(distinct owner_user_id) from public.target_buckets where bucket_key = 'equity'",
    }
    observed = {name: int(client.scalar(sql)) for name, sql in assertions.items()}
    if any(value != 2 for value in observed.values()):
        raise RuntimeError(f"owner-scoped writer collision test failed: {observed}")

    print("PGA-004 actual writers A/B and collision replay: PASS")
    print(json.dumps(observed, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
