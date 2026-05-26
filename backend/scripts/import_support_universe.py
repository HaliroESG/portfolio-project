#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from pypdf import PdfReader

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = CURRENT_DIR.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

from supabase_key_guard import require_backend_supabase_key  # noqa: E402


ISIN_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{10})\b")
LEGAL_FORMS = ("ETF", "FCP", "SICAV", "FIA", "SCI", "SCPI", "OPCI", "SLP")


@dataclass(frozen=True)
class SupportRow:
    source_id: str
    isin: str
    name: str
    support_type: str
    legal_form: str | None
    manager: str | None
    sri: int | None
    performance_1y_pct: float | None
    performance_5y_pct: float | None
    asset_fee_pct: float | None
    contract_fee_pct: float | None
    total_fee_pct: float | None
    retrocession_pct: float | None
    morningstar_rating: float | None
    quantalys_rating: float | None
    metrics_state: str
    score: float | None
    score_details: dict[str, Any]
    page: int
    raw_text: str


def _clean_line(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").split())


def _parse_source_date(value: str | None) -> date | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


def _parse_percent(value: str) -> float | None:
    text = value.strip().replace("%", "").replace(" ", "").replace(",", ".")
    if text in {"", "NC", "-"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _percent_values(text: str) -> list[float]:
    values: list[float] = []
    for match in re.finditer(r"[-+]?\d+(?:[,.]\d+)?\s*%", text):
        parsed = _parse_percent(match.group(0))
        if parsed is not None:
            values.append(parsed)
    return values


def _find_sri(body: str) -> tuple[int | None, int | None, int | None]:
    # The Lucya/Cardif table places SRI immediately after manager. Avoid digits
    # embedded in fund names by preferring a one-digit risk value followed by NC,
    # a percentage, or another table metric.
    for match in re.finditer(r"\b([1-7])\b", body):
        tail = body[match.end(): match.end() + 32]
        if "NC" in tail or "%" in tail or re.search(r"\b\d+[,.]\d+\b", tail):
            return int(match.group(1)), match.start(), match.end()
    return None, None, None


def _split_name_manager(text_before_sri: str) -> tuple[str, str | None, str | None]:
    best: tuple[int, str] | None = None
    upper = f" {text_before_sri.upper()} "
    for form in LEGAL_FORMS:
        matches = list(re.finditer(rf"\b{re.escape(form)}\b", upper))
        if matches:
            match = matches[-1]
            if best is None or match.start() > best[0]:
                best = (match.start(), form)

    if best is None:
        return text_before_sri.strip(), None, None

    form_start, legal_form = best
    # form_start is on the padded upper string; subtract the leading space.
    adjusted_start = max(0, form_start - 1)
    adjusted_end = adjusted_start + len(legal_form)
    name = text_before_sri[:adjusted_end].strip()
    manager = text_before_sri[adjusted_end:].strip() or None
    return name, legal_form, manager


def _support_type(name: str, legal_form: str | None, raw_text: str) -> str:
    text = f"{name} {legal_form or ''} {raw_text}".upper()
    if "FONDS GÉNÉRAL" in text or "FONDS GENERAL" in text or "FONDS EURO" in text:
        return "FONDS_EURO"
    if "ETF" in text or "ETC" in text:
        return "ETF"
    if "SCPI" in text:
        return "SCPI"
    if "SCI" in text:
        return "SCI"
    if "OPCI" in text:
        return "OPCI"
    if "PRIVATE" in text or "SLP" in text:
        return "PRIVATE_ASSET"
    if legal_form in {"FCP", "SICAV", "FIA"}:
        return "FUND"
    return "UNKNOWN"


def _score_support(
    *,
    support_type: str,
    sri: int | None,
    total_fee_pct: float | None,
    performance_5y_pct: float | None,
) -> tuple[float | None, dict[str, Any]]:
    score = 50.0
    details: dict[str, Any] = {"basis": "fees_sri_perf_type"}

    if total_fee_pct is not None:
        fee_score = max(0.0, min(30.0, 30.0 - total_fee_pct * 10.0))
        score += fee_score
        details["fee_score"] = round(fee_score, 2)
    else:
        details["fee_missing"] = True

    if sri is not None:
        sri_score = max(0.0, (7 - sri) * 3.0)
        score += sri_score
        details["sri_score"] = round(sri_score, 2)
    else:
        details["sri_missing"] = True

    if performance_5y_pct is not None:
        perf_score = max(-10.0, min(20.0, performance_5y_pct))
        score += perf_score
        details["performance_score"] = round(perf_score, 2)
    else:
        details["performance_missing"] = True

    if support_type == "ETF":
        score += 8.0
        details["type_bonus"] = 8
    elif support_type in {"SCPI", "SCI", "OPCI", "PRIVATE_ASSET"}:
        score -= 8.0
        details["illiquidity_penalty"] = 8

    return round(max(0.0, min(100.0, score)), 2), details


def _parse_support_line(line: str, *, page: int, source_id: str) -> SupportRow | None:
    match = ISIN_RE.match(line)
    if not match:
        return None

    isin = match.group(1)
    rest = line[match.end():].strip()
    sri, sri_start, sri_end = _find_sri(rest)
    before_sri = rest[:sri_start].strip() if sri_start is not None else rest
    after_sri = rest[sri_end:].strip() if sri_end is not None else ""
    name, legal_form, manager = _split_name_manager(before_sri)
    support_type = _support_type(name, legal_form, line)
    percentages = _percent_values(after_sri)

    asset_fee_pct = percentages[0] if len(percentages) >= 1 else None
    retrocession_pct = percentages[1] if len(percentages) >= 2 and "(dont" in after_sri.lower() else None
    contract_index = next((index for index, value in enumerate(percentages[2:], start=2) if abs(value - 0.5) < 0.001), None)
    performance_1y_pct = percentages[2] if contract_index is not None and contract_index >= 4 and len(percentages) >= 3 else None
    performance_5y_pct = percentages[3] if contract_index is not None and contract_index >= 4 and len(percentages) >= 4 else None
    contract_fee_pct = percentages[contract_index] if contract_index is not None else None
    total_fee_pct = percentages[contract_index + 1] if contract_index is not None and len(percentages) > contract_index + 1 else None

    score, score_details = _score_support(
        support_type=support_type,
        sri=sri,
        total_fee_pct=total_fee_pct,
        performance_5y_pct=performance_5y_pct,
    )

    return SupportRow(
        source_id=source_id,
        isin=isin,
        name=name or isin,
        support_type=support_type,
        legal_form=legal_form,
        manager=manager,
        sri=sri,
        performance_1y_pct=performance_1y_pct,
        performance_5y_pct=performance_5y_pct,
        asset_fee_pct=asset_fee_pct,
        contract_fee_pct=contract_fee_pct,
        total_fee_pct=total_fee_pct,
        retrocession_pct=retrocession_pct,
        morningstar_rating=None,
        quantalys_rating=None,
        metrics_state="METRICS_UNAVAILABLE",
        score=score,
        score_details=score_details,
        page=page,
        raw_text=line,
    )


def parse_lucya_cardif_pdf(path: str | Path, *, source_id: str) -> dict[str, Any]:
    reader = PdfReader(str(path))
    rows: list[SupportRow] = []
    rejected: list[dict[str, Any]] = []
    seen: set[str] = set()

    for page_index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        for raw_line in text.splitlines():
            line = _clean_line(raw_line)
            if not ISIN_RE.match(line):
                continue
            parsed = _parse_support_line(line, page=page_index, source_id=source_id)
            if parsed is None:
                rejected.append({"page": page_index, "line": line, "reason": "unparsed"})
                continue
            if parsed.isin in seen:
                continue
            seen.add(parsed.isin)
            rows.append(parsed)

    return {
        "rows_read": len(rows) + len(rejected),
        "rows_accepted": len(rows),
        "rows_rejected": len(rejected),
        "accepted": rows,
        "rejected": rejected,
        "support_type_counts": {
            key: sum(1 for row in rows if row.support_type == key)
            for key in sorted({row.support_type for row in rows})
        },
    }


def _build_supabase_client() -> Any:
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    if not url:
        raise RuntimeError("SUPABASE_URL is required for --apply")
    return create_client(url, require_backend_supabase_key(os.environ))


def _row_payload(row: SupportRow) -> dict[str, Any]:
    payload = asdict(row)
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    return payload


def _chunks(rows: list[dict[str, Any]], size: int = 500):
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


def apply_supports(
    *,
    supabase_client: Any,
    source_id: str,
    source_name: str,
    source_kind: str,
    source_file: str,
    source_date: date | None,
    envelope: str,
    rows: list[SupportRow],
    report_json: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    source_payload = {
        "id": source_id,
        "source_name": source_name,
        "source_kind": source_kind,
        "provider": "Cardif" if source_kind == "lucya-cardif" else None,
        "source_file": source_file,
        "source_date": source_date.isoformat() if source_date else None,
        "report_json": report_json,
        "updated_at": now,
    }
    supabase_client.table("support_sources").upsert(source_payload, on_conflict="id").execute()

    support_payloads = [_row_payload(row) for row in rows]
    for chunk in _chunks(support_payloads):
        supabase_client.table("investment_supports").upsert(chunk, on_conflict="source_id,isin").execute()

    availability_payloads = [
        {
            "source_id": row.source_id,
            "isin": row.isin,
            "envelope": envelope,
            "available": True,
            "constraints_json": {},
            "updated_at": now,
        }
        for row in rows
    ]
    for chunk in _chunks(availability_payloads):
        supabase_client.table("support_availability").upsert(chunk, on_conflict="source_id,isin,envelope").execute()

    return {
        "source_upserted": source_id,
        "supports_upserted": len(support_payloads),
        "availability_upserted": len(availability_payloads),
    }


def run_import(
    input_path: str | Path,
    *,
    source: str,
    source_date: str | None = None,
    envelope: str = "Cardif_Lucya",
    dry_run: bool = True,
    supabase_client: Any | None = None,
) -> dict[str, Any]:
    if source != "lucya-cardif":
        raise RuntimeError("Only --source lucya-cardif is supported in V1")

    parsed_source_date = _parse_source_date(source_date)
    source_id = f"{source}:{parsed_source_date.isoformat() if parsed_source_date else 'undated'}"
    parse_report = parse_lucya_cardif_pdf(input_path, source_id=source_id)
    accepted: list[SupportRow] = parse_report["accepted"]
    report_public = {
        key: value
        for key, value in parse_report.items()
        if key not in {"accepted"}
    }
    write_report = {
        "source_upserted": None,
        "supports_upserted": 0,
        "availability_upserted": 0,
    }

    if not dry_run:
        if supabase_client is None:
            raise RuntimeError("A Supabase client is required when dry_run=False")
        write_report = apply_supports(
            supabase_client=supabase_client,
            source_id=source_id,
            source_name="Lucya Cardif support list",
            source_kind=source,
            source_file=Path(input_path).name,
            source_date=parsed_source_date,
            envelope=envelope,
            rows=accepted,
            report_json=report_public,
        )

    return {
        "ok": parse_report["rows_accepted"] > 0 and parse_report["rows_rejected"] == 0,
        "dry_run": dry_run,
        "source_id": source_id,
        "source_file": Path(input_path).name,
        "envelope": envelope,
        "rows_read": parse_report["rows_read"],
        "rows_accepted": parse_report["rows_accepted"],
        "rows_rejected": parse_report["rows_rejected"],
        "support_type_counts": parse_report["support_type_counts"],
        "sample": [asdict(row) for row in accepted[:10]],
        "rejected": parse_report["rejected"][:20],
        "write": write_report,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import insurance/PER support universe from source documents")
    parser.add_argument("--source", required=True, choices=["lucya-cardif"], help="Support universe source")
    parser.add_argument("--file", required=True, help="PDF support list")
    parser.add_argument("--source-date", default=None, help="Source date as YYYY-MM-DD")
    parser.add_argument("--envelope", default="Cardif_Lucya", help="Envelope availability label")
    parser.add_argument("--dry-run", action="store_true", help="Parse and report without writing Supabase")
    parser.add_argument("--apply", action="store_true", help="Write parsed supports to Supabase")
    args = parser.parse_args()
    if args.dry_run and args.apply:
        parser.error("--dry-run and --apply are mutually exclusive")
    if not args.dry_run and not args.apply:
        args.dry_run = True
    return args


def main() -> int:
    args = _parse_args()
    try:
        client = _build_supabase_client() if args.apply else None
        report = run_import(
            args.file,
            source=args.source,
            source_date=args.source_date,
            envelope=args.envelope,
            dry_run=args.dry_run,
            supabase_client=client,
        )
    except Exception as exc:
        report = {
            "ok": False,
            "dry_run": args.dry_run,
            "source_file": Path(args.file).name,
            "error": str(exc),
        }
    print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
