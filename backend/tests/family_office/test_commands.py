import pytest
from datetime import date
from typing import Any

from family_office.commands import VALID_DECISION_TRANSITIONS, prepare_monthly_close


class CloseRepository:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {
            "fo_monthly_closes": [],
            "fo_portfolios": [{"id": "portfolio-1", "owner_user_id": "owner-1", "name": "Patrimoine"}],
            "fo_performance_daily": [
                {"portfolio_id": "portfolio-1", "performance_date": "2026-06-30", "nav_eur": "100000", "coverage_pct": "100", "data_state": "READY"},
                {"portfolio_id": "portfolio-1", "performance_date": "2026-07-12", "nav_eur": "110000", "coverage_pct": "100", "data_state": "READY"},
            ],
            "fo_risk_daily": [
                {"portfolio_id": "portfolio-1", "risk_date": "2026-06-30", "volatility_30d_pct": "8"},
                {"portfolio_id": "portfolio-1", "risk_date": "2026-07-12", "volatility_30d_pct": "9"},
            ],
            "fo_position_snapshots": [
                {"id": "position-1", "portfolio_id": "portfolio-1", "instrument_id": "instrument-1", "snapshot_date": "2026-06-30", "market_value_eur": "90000", "reconciliation_state": "MATCH"}
            ],
            "fo_instruments": [{"id": "instrument-1", "instrument_key": "ticker:TEST", "ticker": "TEST", "name": "Test"}],
            "fo_cash_balances_daily": [{"id": "cash-1", "portfolio_id": "portfolio-1", "balance_date": "2026-06-30", "balance_eur": "10000"}],
            "fo_manual_holdings": [],
            "fo_exceptions": [],
        }

    def select(
        self,
        table: str,
        columns: str = "*",
        *,
        filters: dict[str, Any] | None = None,
        order: str | None = None,
        descending: bool = False,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        del columns
        rows = [
            dict(row)
            for row in self.tables.get(table, [])
            if all(row.get(key) == value for key, value in (filters or {}).items())
        ]
        if order:
            rows.sort(key=lambda row: row.get(order) or "", reverse=descending)
        return rows[:limit] if limit is not None else rows

    def first(self, table: str, columns: str = "*", **kwargs: Any) -> dict[str, Any] | None:
        rows = self.select(table, columns, limit=1, **kwargs)
        return rows[0] if rows else None

    def upsert_many(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> int:
        del on_conflict
        payload = {"id": "close-1", "created_at": "2026-07-13T00:00:00Z", **rows[0]}
        self.tables[table] = [payload]
        return 1


def test_decision_workflow_requires_validation_before_export() -> None:
    assert "VALIDATED" in VALID_DECISION_TRANSITIONS["DRAFT"]
    assert "EXPORTED" not in VALID_DECISION_TRANSITIONS["DRAFT"]
    assert VALID_DECISION_TRANSITIONS["RECONCILED"] == set()


@pytest.mark.parametrize(
    ("source", "target", "allowed"),
    [
        ("DRAFT", "CANCELLED", True),
        ("VALIDATED", "EXPORTED", True),
        ("EXPORTED", "RECONCILED", False),
        ("EXECUTED", "RECONCILED", True),
    ],
)
def test_decision_transitions(source: str, target: str, allowed: bool) -> None:
    assert (target in VALID_DECISION_TRANSITIONS[source]) is allowed


def test_monthly_close_freezes_period_end_data() -> None:
    repository = CloseRepository()

    result = prepare_monthly_close(
        repository,  # type: ignore[arg-type]
        owner_user_id="owner-1",
        portfolio_id="portfolio-1",
        period_end=date(2026, 6, 30),
        finalize=True,
    )

    close = result["monthly_close"]
    assert close["status"] == "CLOSED"
    assert close["nav_eur"] == "100000"
    assert close["report_json"]["performance"][0]["performance_date"] == "2026-06-30"
    assert close["report_json"]["risk"]["risk_date"] == "2026-06-30"
