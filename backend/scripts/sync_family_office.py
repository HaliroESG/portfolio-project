#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date

CURRENT_DIR = os.path.dirname(__file__)
BACKEND_ROOT = os.path.dirname(CURRENT_DIR)
sys.path.append(BACKEND_ROOT)

from family_office.repository import FamilyOfficeRepository, create_service_client  # noqa: E402
from family_office.sync import (  # noqa: E402
    PortfolioSyncBlockedError,
    assess_portfolio_sync_readiness,
    rebuild_portfolio,
)


def run_sync(
    as_of_date: date | None = None,
    *,
    apply: bool = False,
) -> dict[str, object]:
    repository = FamilyOfficeRepository(create_service_client())
    portfolios = repository.select("fo_portfolios", filters={"status": "ACTIVE"})
    results: list[dict[str, object]] = []
    errors: list[dict[str, str]] = []
    readiness_reports: list[dict[str, object]] = []
    for portfolio in portfolios:
        owner_user_id = str(portfolio["owner_user_id"])
        portfolio_id = str(portfolio["id"])
        try:
            readiness = assess_portfolio_sync_readiness(
                repository,
                owner_user_id=owner_user_id,
                portfolio_id=portfolio_id,
            )
            readiness_reports.append(readiness)
            if not readiness["ready"] or not apply:
                continue
            results.append(
                rebuild_portfolio(
                    repository,
                    owner_user_id=owner_user_id,
                    portfolio_id=portfolio_id,
                    as_of_date=as_of_date,
                )
            )
        except PortfolioSyncBlockedError as exc:
            readiness_reports.append(exc.readiness)
        except Exception as exc:
            errors.append({"portfolio_id": portfolio_id, "error": str(exc)})
    blocked_count = sum(1 for report in readiness_reports if not report["ready"])
    status = (
        "FAILED"
        if errors
        else "BLOCKED"
        if blocked_count
        else "SUCCESS"
        if apply
        else "READY"
    )
    return {
        "status": status,
        "mode": "APPLY" if apply else "CHECK_ONLY",
        "portfolio_count": len(portfolios),
        "blocked_portfolio_count": blocked_count,
        "readiness": readiness_reports,
        "results": results,
        "errors": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild Family Office positions, performance and risk")
    parser.add_argument("--as-of-date", default=None)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist rebuild outputs; omitted by default for a read-only readiness check",
    )
    args = parser.parse_args()
    report = run_sync(
        date.fromisoformat(args.as_of_date) if args.as_of_date else None,
        apply=args.apply,
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    if report["status"] in {"FAILED", "BLOCKED"}:
        raise SystemExit(2 if report["status"] == "BLOCKED" else 1)


if __name__ == "__main__":
    main()
