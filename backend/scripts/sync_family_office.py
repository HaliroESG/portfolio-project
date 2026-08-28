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
from family_office.sync import rebuild_portfolio  # noqa: E402


def run_sync(as_of_date: date | None = None) -> dict[str, object]:
    repository = FamilyOfficeRepository(create_service_client())
    portfolios = repository.select("fo_portfolios", filters={"status": "ACTIVE"})
    results: list[dict[str, object]] = []
    errors: list[dict[str, str]] = []
    for portfolio in portfolios:
        try:
            results.append(
                rebuild_portfolio(
                    repository,
                    owner_user_id=str(portfolio["owner_user_id"]),
                    portfolio_id=str(portfolio["id"]),
                    as_of_date=as_of_date,
                )
            )
        except Exception as exc:
            errors.append({"portfolio_id": str(portfolio["id"]), "error": str(exc)})
    return {
        "status": "FAILED" if errors else "SUCCESS",
        "portfolio_count": len(portfolios),
        "results": results,
        "errors": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild Family Office positions, performance and risk")
    parser.add_argument("--as-of-date", default=None)
    args = parser.parse_args()
    report = run_sync(date.fromisoformat(args.as_of_date) if args.as_of_date else None)
    print(json.dumps(report, indent=2, sort_keys=True))
    if report["status"] == "FAILED":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
