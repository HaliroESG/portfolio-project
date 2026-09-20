from __future__ import annotations

from typing import Any

import pytest

from scripts import sync_family_office as sync_script
from family_office.sync import (
    PortfolioSyncBlockedError,
    assess_portfolio_sync_readiness,
    rebuild_portfolio,
)


class ReadinessRepository:
    def __init__(self, *, complete: bool) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {
            "fo_portfolios": [
                {"id": "portfolio-1", "owner_user_id": "owner-1", "status": "ACTIVE"}
            ],
            "fo_accounts": [
                {"id": "account-1", "portfolio_id": "portfolio-1", "status": "ACTIVE"}
            ],
            "fo_positions_latest": [
                {
                    "portfolio_id": "portfolio-1",
                    "account_id": "account-1",
                    "quantity": "2",
                    "snapshot_date": "2026-09-20",
                }
            ],
            "fo_cash_balances_latest": [],
            "fo_ledger_entries": (
                [{"id": "entry-1", "account_id": "account-1"}] if complete else []
            ),
            "fo_import_runs": (
                [
                    {
                        "id": "transactions-1",
                        "account_id": "account-1",
                        "import_type": "TRANSACTIONS",
                        "status": "COMPLETED",
                        "as_of_date": "2026-09-20",
                        "rejected_count": 0,
                        "started_at": "2026-09-20T10:00:00Z",
                    },
                    {
                        "id": "positions-1",
                        "account_id": "account-1",
                        "import_type": "POSITIONS",
                        "status": "COMPLETED",
                        "as_of_date": "2026-09-20",
                        "rejected_count": 0,
                        "started_at": "2026-09-20T10:01:00Z",
                    },
                ]
                if complete
                else []
            ),
            "fo_reconciliation_runs": (
                [
                    {
                        "id": "reconciliation-1",
                        "account_id": "account-1",
                        "status": "MATCH",
                        "reconciliation_date": "2026-09-20",
                    }
                ]
                if complete
                else []
            ),
        }
        self.write_count = 0

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

    def upsert_many(self, *_args: Any, **_kwargs: Any) -> int:
        self.write_count += 1
        return 1


def test_readiness_blocks_exposed_account_without_transaction_history() -> None:
    repository = ReadinessRepository(complete=False)

    report = assess_portfolio_sync_readiness(
        repository,  # type: ignore[arg-type]
        owner_user_id="owner-1",
        portfolio_id="portfolio-1",
    )

    assert report["ready"] is False
    assert {item["code"] for item in report["accounts"][0]["blockers"]} == {
        "TRANSACTION_HISTORY_MISSING",
        "POSITION_SNAPSHOT_PROVENANCE_MISSING",
        "POSITION_RECONCILIATION_MISSING",
    }


def test_readiness_accepts_complete_import_and_matching_reconciliation() -> None:
    repository = ReadinessRepository(complete=True)

    report = assess_portfolio_sync_readiness(
        repository,  # type: ignore[arg-type]
        owner_user_id="owner-1",
        portfolio_id="portfolio-1",
    )

    assert report["ready"] is True
    assert report["blocker_count"] == 0


def test_readiness_rejects_reconciliation_older_than_current_snapshot() -> None:
    repository = ReadinessRepository(complete=True)
    repository.tables["fo_reconciliation_runs"][0]["reconciliation_date"] = "2026-09-19"

    report = assess_portfolio_sync_readiness(
        repository,  # type: ignore[arg-type]
        owner_user_id="owner-1",
        portfolio_id="portfolio-1",
    )

    assert report["ready"] is False
    assert report["accounts"][0]["blockers"] == [
        {
            "code": "POSITION_RECONCILIATION_STALE",
            "snapshot_date": "2026-09-20",
            "reconciliation_date": "2026-09-19",
        }
    ]


def test_readiness_rejects_position_import_older_than_current_snapshot() -> None:
    repository = ReadinessRepository(complete=True)
    repository.tables["fo_import_runs"][1]["as_of_date"] = "2026-09-19"

    report = assess_portfolio_sync_readiness(
        repository,  # type: ignore[arg-type]
        owner_user_id="owner-1",
        portfolio_id="portfolio-1",
    )

    assert report["ready"] is False
    assert report["accounts"][0]["blockers"] == [
        {
            "code": "POSITION_SNAPSHOT_IMPORT_STALE",
            "snapshot_date": "2026-09-20",
            "import_as_of_date": "2026-09-19",
        }
    ]


def test_readiness_rejects_mixed_current_snapshot_dates() -> None:
    repository = ReadinessRepository(complete=True)
    repository.tables["fo_positions_latest"].append(
        {
            "portfolio_id": "portfolio-1",
            "account_id": "account-1",
            "quantity": "1",
            "snapshot_date": "2026-09-19",
        }
    )

    report = assess_portfolio_sync_readiness(
        repository,  # type: ignore[arg-type]
        owner_user_id="owner-1",
        portfolio_id="portfolio-1",
    )

    assert report["ready"] is False
    assert report["accounts"][0]["blockers"] == [
        {
            "code": "POSITION_SNAPSHOT_MIXED_DATES",
            "snapshot_dates": ["2026-09-19", "2026-09-20"],
        }
    ]


def test_rebuild_stops_before_any_write_when_readiness_is_blocked() -> None:
    repository = ReadinessRepository(complete=False)

    with pytest.raises(PortfolioSyncBlockedError) as exc_info:
        rebuild_portfolio(
            repository,  # type: ignore[arg-type]
            owner_user_id="owner-1",
            portfolio_id="portfolio-1",
        )

    assert exc_info.value.readiness["ready"] is False
    assert repository.write_count == 0


@pytest.mark.parametrize(
    ("complete", "apply", "expected_status", "expected_rebuilds"),
    [
        (False, False, "BLOCKED", 0),
        (False, True, "BLOCKED", 0),
        (True, False, "READY", 0),
        (True, True, "SUCCESS", 1),
    ],
)
def test_cli_requires_apply_and_readiness(
    monkeypatch: pytest.MonkeyPatch,
    complete: bool,
    apply: bool,
    expected_status: str,
    expected_rebuilds: int,
) -> None:
    repository = ReadinessRepository(complete=complete)
    rebuilds: list[str] = []
    monkeypatch.setattr(sync_script, "create_service_client", lambda: object())
    monkeypatch.setattr(sync_script, "FamilyOfficeRepository", lambda _client: repository)
    monkeypatch.setattr(
        sync_script,
        "rebuild_portfolio",
        lambda _repository, *, owner_user_id, portfolio_id, as_of_date: (
            rebuilds.append(portfolio_id)
            or {
                "resource_type": "portfolio_calculation",
                "resource_id": portfolio_id,
                "owner_user_id": owner_user_id,
                "as_of_date": str(as_of_date) if as_of_date else None,
            }
        ),
    )

    report = sync_script.run_sync(apply=apply)

    assert report["status"] == expected_status
    assert report["mode"] == ("APPLY" if apply else "CHECK_ONLY")
    assert len(rebuilds) == expected_rebuilds
