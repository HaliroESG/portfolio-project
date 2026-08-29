from datetime import date
from decimal import Decimal

from broker_ingest.models import CanonicalTransaction
from broker_ingest.sync_transactions import upsert_canonical_transactions

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


def _sample_tx() -> CanonicalTransaction:
    return CanonicalTransaction(
        broker="FORTUNEO",
        account_id="acc-1",
        external_txn_id="ext-1",
        trade_date=date(2026, 5, 10),
        settlement_date=date(2026, 5, 12),
        symbol="CW8",
        isin="FR0010756098",
        side="BUY",
        quantity=Decimal("10"),
        price=Decimal("100.5"),
        gross_amount=Decimal("-1005"),
        fees=Decimal("1.2"),
        taxes=Decimal("0"),
        net_amount=Decimal("-1006.2"),
        currency="EUR",
        envelope="CTO",
        raw_type="BUY",
    )


def test_upsert_canonical_transactions_builds_payload_and_upserts():
    fake = _FakeSupabase()
    tx = _sample_tx()

    count = upsert_canonical_transactions(
        fake,
        [tx],
        owner_user_id=OWNER_A,
        source_file="fortuneo_2026_05.csv",
    )

    assert count == 1
    assert fake.table_obj.name == "broker_transactions"
    assert fake.table_obj.on_conflict == "owner_user_id,idempotency_key"
    payload = fake.table_obj.payloads[0]
    assert payload["owner_user_id"] == OWNER_A
    assert payload["idempotency_key"] == f"{OWNER_A}:FORTUNEO:acc-1:ext-1"
    assert payload["trade_date"] == "2026-05-10"
    assert payload["source_file"] == "fortuneo_2026_05.csv"


def test_upsert_canonical_transactions_noop_on_empty():
    fake = _FakeSupabase()
    count = upsert_canonical_transactions(fake, [], owner_user_id=OWNER_A)
    assert count == 0
    assert fake.table_obj.name is None


def test_upsert_canonical_transactions_requires_explicit_owner():
    fake = _FakeSupabase()
    try:
        upsert_canonical_transactions(fake, [_sample_tx()], owner_user_id="")
    except RuntimeError as exc:
        assert "owner_user_id is required" in str(exc)
    else:
        raise AssertionError("expected fail-closed owner validation")
