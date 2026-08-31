from datetime import date

from broker_ingest.sync_reconciliation import persist_reconciliation_report

OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


class _FakeResponse:
    def __init__(self, data=None):
        self.data = data or []


class _FakeTable:
    def __init__(self, name):
        self.name = name
        self.operations = []

    def upsert(self, payload, on_conflict):
        self.operations.append(("upsert", payload, on_conflict))
        return self

    def delete(self):
        self.operations.append(("delete",))
        return self

    def eq(self, column, value):
        self.operations.append(("eq", column, value))
        return self

    def insert(self, payload):
        self.operations.append(("insert", payload))
        return self

    def execute(self):
        if self.name == "broker_reconciliation_runs":
            return _FakeResponse([{"id": "run-1"}])
        return _FakeResponse()


class _FakeSupabase:
    def __init__(self):
        self.tables = {}

    def table(self, name):
        table = self.tables.setdefault(name, _FakeTable(name))
        return table


def _sample_report():
    return {
        "broker": "FORTUNEO",
        "account_id": "acct-1",
        "source_file": "fortuneo.csv",
        "dry_run": False,
        "parsed_count": 2,
        "upserted_count": 2,
        "position_affecting_count": 2,
        "side_counts": {"BUY": 2},
        "currency_counts": {"EUR": 2},
        "amount_totals": {
            "gross_amount": "-1250",
            "fees": "0",
            "taxes": "0",
            "net_amount": "-1250",
        },
        "reconciliation": {
            "mode": "broker_snapshot",
            "snapshot_provided": True,
            "ignored_transaction_count": 0,
            "state_counts": {
                "MATCH": 1,
                "MISMATCH_COST": 1,
                "MISMATCH_QTY": 0,
                "MISSING_IN_LEDGER": 0,
            },
            "positions": [
                {
                    "instrument_key": "isin:FR0010756098",
                    "symbol": "CW8",
                    "isin": "FR0010756098",
                    "currency": "EUR",
                    "state": "MATCH",
                    "ledger_quantity": "10",
                    "broker_quantity": "10",
                    "quantity_delta": "0",
                    "ledger_average_cost": "100",
                    "broker_average_cost": "100",
                },
                {
                    "instrument_key": "isin:FR0011869353",
                    "symbol": "EWLD",
                    "isin": "FR0011869353",
                    "currency": "EUR",
                    "state": "MISMATCH_COST",
                    "ledger_quantity": "5",
                    "broker_quantity": "5",
                    "quantity_delta": "0",
                    "ledger_average_cost": "50",
                    "broker_average_cost": "51",
                },
            ],
            "ledger_only": [],
        },
    }


def test_persist_reconciliation_report_upserts_run_and_replaces_items():
    fake = _FakeSupabase()

    result = persist_reconciliation_report(
        fake,
        _sample_report(),
        reconciliation_date=date(2026, 5, 11),
        owner_user_id=OWNER_A,
        source_file="fortuneo.csv",
        positions_file="positions.csv",
    )

    assert result == {"run_id": "run-1", "status": "MISMATCH", "item_count": 2}

    run_ops = fake.tables["broker_reconciliation_runs"].operations
    assert run_ops[0][0] == "upsert"
    assert run_ops[0][2] == "owner_user_id,idempotency_key"
    assert run_ops[0][1]["owner_user_id"] == OWNER_A
    assert run_ops[0][1]["idempotency_key"] == f"{OWNER_A}:FORTUNEO:acct-1:2026-05-11:fortuneo.csv:positions.csv"
    assert run_ops[0][1]["status"] == "MISMATCH"

    item_ops = fake.tables["broker_reconciliation_items"].operations
    assert item_ops[0] == ("delete",)
    assert item_ops[1] == ("eq", "owner_user_id", OWNER_A)
    assert item_ops[2] == ("eq", "run_id", "run-1")
    assert item_ops[3] == ("insert", [
        {
            "owner_user_id": OWNER_A,
            "run_id": "run-1",
            "instrument_key": "isin:FR0010756098",
            "symbol": "CW8",
            "isin": "FR0010756098",
            "currency": "EUR",
            "state": "MATCH",
            "ledger_quantity": "10",
            "broker_quantity": "10",
            "quantity_delta": "0",
            "ledger_average_cost": "100",
            "broker_average_cost": "100",
            "transaction_count": None,
        },
        {
            "owner_user_id": OWNER_A,
            "run_id": "run-1",
            "instrument_key": "isin:FR0011869353",
            "symbol": "EWLD",
            "isin": "FR0011869353",
            "currency": "EUR",
            "state": "MISMATCH_COST",
            "ledger_quantity": "5",
            "broker_quantity": "5",
            "quantity_delta": "0",
            "ledger_average_cost": "50",
            "broker_average_cost": "51",
            "transaction_count": None,
        },
    ])


def test_persist_reconciliation_report_marks_rollup_not_checked():
    fake = _FakeSupabase()
    report = _sample_report()
    report["reconciliation"] = {
        "mode": "ledger_rollup",
        "snapshot_provided": False,
        "ignored_transaction_count": 0,
        "state_counts": {},
        "positions": [],
        "ledger_only": [],
    }

    result = persist_reconciliation_report(
        fake,
        report,
        reconciliation_date=date(2026, 5, 11),
        owner_user_id=OWNER_A,
        source_file="fortuneo.csv",
        positions_file=None,
    )

    assert result["status"] == "NOT_CHECKED"
    run_payload = fake.tables["broker_reconciliation_runs"].operations[0][1]
    assert run_payload["mode"] == "ledger_rollup"
    assert run_payload["position_count"] == 0
