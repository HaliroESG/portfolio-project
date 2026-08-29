from datetime import date

from scripts.import_broker_transactions import run_import

OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


class _FakeTable:
    def __init__(self):
        self.name = None
        self.payloads = None
        self.on_conflict = None

    def upsert(self, payloads, on_conflict):
        self.payloads = payloads
        self.on_conflict = on_conflict
        return self

    def execute(self):
        return {"status": "ok"}


class _FakeSupabase:
    def __init__(self):
        self.table_obj = _FakeTable()

    def table(self, name):
        self.table_obj.name = name
        return self.table_obj


class _PersistFakeResponse:
    def __init__(self, data=None):
        self.data = data or []


class _PersistFakeTable:
    def __init__(self, name):
        self.name = name
        self.operations = []

    def upsert(self, payloads, on_conflict):
        self.operations.append(("upsert", payloads, on_conflict))
        return self

    def delete(self):
        self.operations.append(("delete",))
        return self

    def eq(self, column, value):
        self.operations.append(("eq", column, value))
        return self

    def insert(self, payloads):
        self.operations.append(("insert", payloads))
        return self

    def execute(self):
        if self.name == "broker_reconciliation_runs":
            return _PersistFakeResponse([{"id": "run-1"}])
        return _PersistFakeResponse()


class _PersistFakeSupabase:
    def __init__(self):
        self.tables = {}

    def table(self, name):
        table = self.tables.setdefault(name, _PersistFakeTable(name))
        return table


def _write_fortuneo_csv(path):
    path.write_text(
        """trade_date,settlement_date,side,quantity,price,gross_amount,fees,taxes,net_amount,external_txn_id,currency,symbol,isin,type_operation
2026-05-01,2026-05-05,BUY,10,100.50,-1005.00,1.20,0.00,-1006.20,op-1,EUR,CW8,FR0010756098,BUY
""",
        encoding="utf-8",
    )


def test_run_import_dry_run_skips_supabase_and_reports_metrics(tmp_path):
    source = tmp_path / "fortuneo.csv"
    _write_fortuneo_csv(source)

    report = run_import(
        broker="fortuneo",
        source_file=source,
        account_id="acct-1",
        envelope="CTO",
        dry_run=True,
    )

    assert report["dry_run"] is True
    assert report["parsed_count"] == 1
    assert report["upserted_count"] == 0
    assert report["side_counts"] == {"BUY": 1}
    assert report["currency_counts"] == {"EUR": 1}
    assert report["reconciliation"]["mode"] == "ledger_rollup"


def test_run_import_apply_upserts_with_source_filename(tmp_path):
    source = tmp_path / "fortuneo.csv"
    _write_fortuneo_csv(source)
    fake = _FakeSupabase()

    report = run_import(
        broker="fortuneo",
        source_file=source,
        account_id="acct-1",
        envelope="CTO",
        dry_run=False,
        supabase_client=fake,
        owner_user_id=OWNER_A,
    )

    assert report["dry_run"] is False
    assert report["upserted_count"] == 1
    assert fake.table_obj.name == "broker_transactions"
    assert fake.table_obj.on_conflict == "owner_user_id,idempotency_key"
    assert fake.table_obj.payloads[0]["source_file"] == "fortuneo.csv"
    assert fake.table_obj.payloads[0]["owner_user_id"] == OWNER_A
    assert fake.table_obj.payloads[0]["idempotency_key"] == f"{OWNER_A}:FORTUNEO:acct-1:op-1"


def test_run_import_can_compare_positions_snapshot(tmp_path):
    source = tmp_path / "fortuneo.csv"
    positions = tmp_path / "positions.csv"
    _write_fortuneo_csv(source)
    positions.write_text(
        """symbol,isin,quantity,average_cost,currency
CW8,FR0010756098,10,101.00,EUR
""",
        encoding="utf-8",
    )

    report = run_import(
        broker="fortuneo",
        source_file=source,
        account_id="acct-1",
        dry_run=True,
        positions_file=positions,
    )

    assert report["reconciliation"]["mode"] == "broker_snapshot"
    assert report["reconciliation"]["state_counts"]["MISMATCH_COST"] == 1


def test_run_import_can_persist_reconciliation_when_applying(tmp_path):
    source = tmp_path / "fortuneo.csv"
    positions = tmp_path / "positions.csv"
    _write_fortuneo_csv(source)
    positions.write_text(
        """symbol,isin,quantity,average_cost,currency
CW8,FR0010756098,10,100.62,EUR
""",
        encoding="utf-8",
    )
    fake = _PersistFakeSupabase()

    report = run_import(
        broker="fortuneo",
        source_file=source,
        account_id="acct-1",
        dry_run=False,
        positions_file=positions,
        persist_reconciliation=True,
        reconciliation_date=date(2026, 5, 11),
        supabase_client=fake,
        owner_user_id=OWNER_A,
    )

    assert report["reconciliation_persisted"] == {
        "run_id": "run-1",
        "status": "MATCH",
        "item_count": 1,
    }
    assert fake.tables["broker_transactions"].operations[0][0] == "upsert"
    run_payload = fake.tables["broker_reconciliation_runs"].operations[0][1]
    assert run_payload["idempotency_key"] == f"{OWNER_A}:FORTUNEO:acct-1:2026-05-11:fortuneo.csv:positions.csv"


def test_run_import_rejects_reconciliation_persistence_in_dry_run(tmp_path):
    source = tmp_path / "fortuneo.csv"
    positions = tmp_path / "positions.csv"
    _write_fortuneo_csv(source)
    positions.write_text("symbol,isin,quantity\nCW8,FR0010756098,10\n", encoding="utf-8")

    try:
        run_import(
            broker="fortuneo",
            source_file=source,
            account_id="acct-1",
            dry_run=True,
            positions_file=positions,
            persist_reconciliation=True,
        )
    except RuntimeError as exc:
        assert "requires dry_run=False" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")
