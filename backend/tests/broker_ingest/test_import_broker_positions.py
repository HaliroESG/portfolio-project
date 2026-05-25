from __future__ import annotations

from datetime import date

from scripts.import_broker_positions import run_import, sync_portfolio_positions_from_snapshots


class _Response:
    def __init__(self, data=None):
        self.data = data or []


class _Table:
    def __init__(self, client, name: str):
        self.client = client
        self.name = name
        self.filters = []
        self.in_filter = None
        self.operation = None
        self.payload = None

    def select(self, columns):
        self.operation = "select"
        self.columns = columns
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def in_(self, column, values):
        self.in_filter = (column, set(values))
        return self

    def order(self, column, desc=False):
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def upsert(self, payload, on_conflict):
        self.operation = "upsert"
        self.payload = payload
        self.on_conflict = on_conflict
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def _matches(self, row):
        for column, value in self.filters:
            if row.get(column) != value:
                return False
        if self.in_filter:
            column, values = self.in_filter
            if row.get(column) not in values:
                return False
        return True

    def execute(self):
        rows = self.client.rows.setdefault(self.name, [])
        if self.operation == "select":
            result = [row.copy() for row in rows if self._matches(row)]
            if self.name == "broker_position_snapshot_runs":
                result.sort(key=lambda row: (row.get("as_of_date") or "", row.get("created_at") or ""), reverse=True)
            return _Response(result)

        if self.operation == "upsert":
            key = self.on_conflict
            existing = next((row for row in rows if row.get(key) == self.payload.get(key)), None)
            if existing is None:
                new_row = self.payload.copy()
                new_row.setdefault("id", f"{self.name}-1")
                rows.append(new_row)
                return _Response([new_row.copy()])
            existing.update(self.payload)
            return _Response([existing.copy()])

        if self.operation == "insert":
            payloads = self.payload if isinstance(self.payload, list) else [self.payload]
            for payload in payloads:
                new_row = payload.copy()
                if self.name == "broker_position_snapshot_items":
                    new_row.setdefault("id", len(rows) + 1)
                rows.append(new_row)
            return _Response(payloads)

        if self.operation == "update":
            updated = []
            for row in rows:
                if self._matches(row):
                    row.update(self.payload)
                    updated.append(row.copy())
            return _Response(updated)

        if self.operation == "delete":
            kept = [row for row in rows if not self._matches(row)]
            deleted = [row for row in rows if self._matches(row)]
            self.client.rows[self.name] = kept
            return _Response(deleted)

        return _Response()


class _Supabase:
    def __init__(self):
        self.rows = {
            "broker_position_snapshot_runs": [],
            "broker_position_snapshot_items": [],
            "portfolio_positions": [],
            "instrument_identifier_map": [],
        }

    def table(self, name):
        return _Table(self, name)


def _write_positions(path, rows: str):
    path.write_text(rows, encoding="utf-8")


def test_run_import_dry_run_reports_snapshot_without_supabase(tmp_path):
    source = tmp_path / "positions.csv"
    _write_positions(
        source,
        """ticker,isin,name,quantity,average_cost,currency
MSFT,US5949181045,Microsoft,5,100,USD
""",
    )

    report = run_import(
        broker="fortuneo",
        account_id="acct-1",
        portfolio_id="main",
        positions_file=source,
        dry_run=True,
    )

    assert report["dry_run"] is True
    assert report["positions_read"] == 1
    assert report["items_persisted"] == 0
    assert report["snapshot_preview"][0]["name"] == "Microsoft"
    assert report["portfolio_sync"]["warnings"] == ["dry run: Supabase was not written"]


def test_run_import_apply_persists_snapshot_and_preserves_targets(tmp_path):
    source = tmp_path / "positions.csv"
    _write_positions(
        source,
        """ticker,isin,name,quantity,average_cost,currency
MSFT,US5949181045,Microsoft,5,100,USD
AAPL,US0378331005,Apple,2,150,USD
""",
    )
    fake = _Supabase()
    fake.rows["portfolio_positions"] = [
        {
            "portfolio_id": "main",
            "ticker": "MSFT",
            "target_weight_pct": 60,
            "quantity_current": 0,
            "actual_source": None,
        }
    ]

    report = run_import(
        broker="fortuneo",
        account_id="acct-1",
        portfolio_id="main",
        envelope="CTO",
        as_of_date=date(2026, 5, 25),
        positions_file=source,
        dry_run=False,
        supabase_client=fake,
    )

    assert report["snapshot_run_id"] == "broker_position_snapshot_runs-1"
    assert report["items_persisted"] == 2
    assert [row["ticker"] for row in report["portfolio_sync"]["updated"]] == ["MSFT"]
    assert [row["ticker"] for row in report["portfolio_sync"]["inserted"]] == ["AAPL"]

    rows = {row["ticker"]: row for row in fake.rows["portfolio_positions"]}
    assert rows["MSFT"]["target_weight_pct"] == 60
    assert rows["MSFT"]["quantity_current"] == "5"
    assert rows["MSFT"]["actual_source"] == "broker_snapshot"
    assert rows["AAPL"]["target_weight_pct"] is None if "target_weight_pct" in rows["AAPL"] else True
    assert rows["AAPL"]["quantity_current"] == "2"


def test_sync_consolidates_latest_snapshots_and_zeroes_removed_actuals():
    fake = _Supabase()
    fake.rows["broker_position_snapshot_runs"] = [
        {
            "id": "fortuneo-run",
            "broker": "FORTUNEO",
            "account_id": "fortuneo-1",
            "portfolio_id": "main",
            "envelope": "PEA",
            "as_of_date": "2026-05-25",
            "created_at": "2026-05-25T10:00:00Z",
        },
        {
            "id": "ibkr-run",
            "broker": "IBKR",
            "account_id": "ibkr-1",
            "portfolio_id": "main",
            "envelope": "CTO",
            "as_of_date": "2026-05-25",
            "created_at": "2026-05-25T10:05:00Z",
        },
    ]
    fake.rows["broker_position_snapshot_items"] = [
        {
            "run_id": "fortuneo-run",
            "portfolio_id": "main",
            "broker": "FORTUNEO",
            "account_id": "fortuneo-1",
            "envelope": "PEA",
            "as_of_date": "2026-05-25",
            "symbol": "MSFT",
            "isin": "US5949181045",
            "name": "Microsoft",
            "currency": "USD",
            "quantity": "10",
            "average_cost": "100",
            "source_row": 2,
        },
        {
            "run_id": "ibkr-run",
            "portfolio_id": "main",
            "broker": "IBKR",
            "account_id": "ibkr-1",
            "envelope": "CTO",
            "as_of_date": "2026-05-25",
            "symbol": "MSFT",
            "isin": "US5949181045",
            "name": "Microsoft",
            "currency": "USD",
            "quantity": "5",
            "average_cost": "200",
            "source_row": 2,
        },
    ]
    fake.rows["portfolio_positions"] = [
        {
            "portfolio_id": "main",
            "ticker": "MSFT",
            "target_weight_pct": 60,
            "quantity_current": "0",
            "actual_source": None,
        },
        {
            "portfolio_id": "main",
            "ticker": "ORCL",
            "target_weight_pct": 10,
            "quantity_current": "3",
            "actual_source": "broker_snapshot",
        },
    ]

    report = sync_portfolio_positions_from_snapshots(fake, portfolio_id="main")

    rows = {row["ticker"]: row for row in fake.rows["portfolio_positions"]}
    assert report["updated"] == [{"ticker": "MSFT", "quantity_current": "15"}]
    assert rows["MSFT"]["target_weight_pct"] == 60
    assert rows["MSFT"]["pru"].startswith("133.333333333")
    assert len(rows["MSFT"]["actual_source_accounts"]) == 2
    assert report["zeroed"] == [{"ticker": "ORCL", "quantity_current": "0"}]
    assert rows["ORCL"]["target_weight_pct"] == 10
    assert rows["ORCL"]["quantity_current"] == "0"
