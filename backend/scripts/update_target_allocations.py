#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

from supabase import create_client


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from supabase_key_guard import require_backend_supabase_key  # noqa: E402


@dataclass(frozen=True)
class TargetAllocation:
    portfolio_id: str
    ticker: str
    target_weight_pct: float


def _read_text(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8")


def _entries_from_payload(payload: Any) -> tuple[str | None, list[Mapping[str, Any]]]:
    if isinstance(payload, list):
        return None, payload
    if isinstance(payload, dict):
        default_portfolio_id = payload.get("portfolio_id")
        entries = payload.get("allocations") or payload.get("positions") or payload.get("targets")
        if isinstance(entries, list):
            return str(default_portfolio_id) if default_portfolio_id else None, entries
    raise ValueError("Expected a JSON list or an object with allocations/positions/targets.")


def parse_allocations(payload: Any) -> list[TargetAllocation]:
    default_portfolio_id, entries = _entries_from_payload(payload)
    allocations: list[TargetAllocation] = []
    seen: set[tuple[str, str]] = set()

    for index, raw in enumerate(entries):
        if not isinstance(raw, Mapping):
            raise ValueError(f"Entry #{index + 1} must be an object.")

        portfolio_id = str(raw.get("portfolio_id") or default_portfolio_id or "").strip()
        ticker = str(raw.get("ticker") or "").strip().upper()
        raw_weight = raw.get("target_weight_pct", raw.get("target_pct", raw.get("weight_pct")))

        if not portfolio_id:
            raise ValueError(f"Entry #{index + 1} is missing portfolio_id.")
        if not ticker:
            raise ValueError(f"Entry #{index + 1} is missing ticker.")
        try:
            target_weight_pct = float(raw_weight)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Entry #{index + 1} has an invalid target weight.") from exc
        if target_weight_pct < 0 or target_weight_pct > 100:
            raise ValueError(f"Entry #{index + 1} target weight must be between 0 and 100.")

        key = (portfolio_id, ticker)
        if key in seen:
            raise ValueError(f"Duplicate allocation for {portfolio_id}/{ticker}.")
        seen.add(key)
        allocations.append(TargetAllocation(portfolio_id, ticker, target_weight_pct))

    if not allocations:
        raise ValueError("No target allocations provided.")
    return allocations


def validate_allocation_totals(
    allocations: Iterable[TargetAllocation],
    *,
    allow_partial: bool = False,
    tolerance: float = 0.05,
) -> dict[str, float]:
    totals: dict[str, float] = {}
    for allocation in allocations:
        totals[allocation.portfolio_id] = totals.get(allocation.portfolio_id, 0.0) + allocation.target_weight_pct

    if not allow_partial:
        invalid = {
            portfolio_id: total
            for portfolio_id, total in totals.items()
            if abs(total - 100.0) > tolerance
        }
        if invalid:
            formatted = ", ".join(f"{portfolio_id}={total:.2f}%" for portfolio_id, total in invalid.items())
            raise ValueError(f"Target allocations must sum to 100% per portfolio ({formatted}).")

    return totals


def build_update_payload(target_weight_pct: float) -> dict[str, Any]:
    return {
        "target_weight_pct": target_weight_pct,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def update_allocations(supabase: Any, allocations: list[TargetAllocation], *, dry_run: bool = False) -> dict[str, Any]:
    updated: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []

    for allocation in allocations:
        payload = build_update_payload(allocation.target_weight_pct)
        if dry_run:
            updated.append({
                "portfolio_id": allocation.portfolio_id,
                "ticker": allocation.ticker,
                "target_weight_pct": allocation.target_weight_pct,
                "dry_run": True,
            })
            continue

        response = (
            supabase.table("portfolio_positions")
            .update(payload)
            .eq("portfolio_id", allocation.portfolio_id)
            .eq("ticker", allocation.ticker)
            .execute()
        )
        rows = response.data or []
        if rows:
            updated.append({
                "portfolio_id": allocation.portfolio_id,
                "ticker": allocation.ticker,
                "target_weight_pct": allocation.target_weight_pct,
            })
        else:
            missing.append({
                "portfolio_id": allocation.portfolio_id,
                "ticker": allocation.ticker,
                "reason": "portfolio_positions row not found",
            })

    return {
        "ok": len(missing) == 0,
        "updated": updated,
        "missing": missing,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Update target allocations via backend Supabase credentials.")
    parser.add_argument("input", help="JSON file path, or '-' for stdin.")
    parser.add_argument("--allow-partial", action="store_true", help="Allow payloads that do not sum to 100% per portfolio.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print the planned updates without writing.")
    args = parser.parse_args()

    try:
        payload = json.loads(_read_text(args.input))
        allocations = parse_allocations(payload)
        totals = validate_allocation_totals(allocations, allow_partial=args.allow_partial)
        url = os.environ.get("SUPABASE_URL")
        if not url:
            raise ValueError("Missing SUPABASE_URL.")
        key = require_backend_supabase_key(os.environ)
        supabase = create_client(url, key)
        result = update_allocations(supabase, allocations, dry_run=args.dry_run)
        result.update({
            "portfolio_totals": totals,
            "dry_run": args.dry_run,
            "allow_partial": args.allow_partial,
        })
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        return 2

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
