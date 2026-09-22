#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = CURRENT_DIR.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

from supabase_key_guard import require_backend_supabase_key  # noqa: E402

ALLOCATION_CONTRACT_VERSION = "allocation_contracts_v1"
APPLY_TARGET_MODEL_RPC = "apply_target_model_v1"


@dataclass(frozen=True)
class TargetBucket:
    model_id: str
    portfolio_scope: str
    bucket_key: str
    bucket_label: str
    parent_bucket_key: str | None
    target_weight_pct: float
    lower_band_pct: float | None
    upper_band_pct: float | None
    source_sheet: str
    source_row: int


@dataclass(frozen=True)
class TargetSleeveAllocation:
    model_id: str
    portfolio_scope: str
    sleeve_key: str
    component_label: str
    bucket_key: str
    bucket_label: str
    target_weight_pct: float
    instrument_policy: str | None
    activation_status: str
    source_sheet: str
    source_row: int


@dataclass(frozen=True)
class TargetEnvelopeLine:
    model_id: str
    portfolio_scope: str
    envelope: str
    ticker: str | None
    isin: str | None
    instrument: str | None
    asset_class: str | None
    region: str | None
    currency: str | None
    target_weight_pct: float | None
    target_value_eur: float | None
    notes: str | None
    source_sheet: str
    source_row: int


@dataclass(frozen=True)
class TargetAuditHolding:
    model_id: str
    portfolio_scope: str
    envelope: str
    ticker: str | None
    isin: str | None
    instrument: str | None
    asset_class: str | None
    region: str | None
    currency: str | None
    market_value_eur: float | None
    quantity: float | None
    notes: str | None
    source_sheet: str
    source_row: int


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _clean_upper(value: Any) -> str | None:
    text = _clean_text(value)
    return text.upper().replace(" ", "") if text else None


def _read_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        if value.startswith("="):
            return None
        value = value.strip().replace("%", "").replace(",", ".")
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed


def _weight_pct(value: Any) -> float | None:
    parsed = _read_float(value)
    if parsed is None:
        return None
    return parsed * 100 if 0 <= parsed <= 1 else parsed


def _bucket_key(label: str | None) -> str:
    text = (label or "").lower()
    text = text.replace("é", "e").replace("è", "e").replace("à", "a")
    if "cash" in text or "obligation" in text:
        return "cash_bonds"
    if "crypto" in text or "bitcoin" in text or "ethereum" in text:
        return "crypto"
    if "or" == text.strip() or "gold" in text:
        return "gold"
    if "pac" in text:
        return "actions_pacific_ex_japan"
    if "japon" in text or "japan" in text:
        return "actions_japan"
    if "emerg" in text or "em " in f"{text} ":
        return "actions_emerging"
    if "europe" in text:
        return "actions_europe"
    if "us" in text or "s&p" in text or "sp 500" in text:
        return "actions_us"
    slug = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return slug or "unclassified"


def _target_model_id(kind: str) -> str:
    return f"target_model:{kind.lower()}:active"


def _header_map(values: tuple[Any, ...]) -> dict[str, int]:
    headers: dict[str, int] = {}
    for index, value in enumerate(values):
        if value is None or not str(value).strip():
            continue
        headers.setdefault(str(value).strip(), index)
    return headers


def _cell(row: tuple[Any, ...], headers: dict[str, int], name: str) -> Any:
    index = headers.get(name)
    if index is None or index >= len(row):
        return None
    return row[index]


def parse_personal_model(path: str | Path) -> dict[str, Any]:
    workbook = load_workbook(path, data_only=False)
    model_id = _target_model_id("perso")
    buckets: list[TargetBucket] = []
    envelope_lines: list[TargetEnvelopeLine] = []
    audit_holdings: list[TargetAuditHolding] = []
    warnings: list[str] = []
    rejected: list[dict[str, Any]] = []

    strategic = workbook["Strategic_Target_Perso"]
    for row_number, row in enumerate(strategic.iter_rows(min_row=2, values_only=True), start=2):
        label = _clean_text(row[0] if len(row) > 0 else None)
        target = _weight_pct(row[1] if len(row) > 1 else None)
        if not label or target is None:
            continue
        buckets.append(
            TargetBucket(
                model_id=model_id,
                portfolio_scope="PERSO",
                bucket_key=_bucket_key(label),
                bucket_label=label,
                parent_bucket_key=None,
                target_weight_pct=target,
                lower_band_pct=_weight_pct(row[2] if len(row) > 2 else None),
                upper_band_pct=_weight_pct(row[3] if len(row) > 3 else None),
                source_sheet="Strategic_Target_Perso",
                source_row=row_number,
            )
        )

    envelope = workbook["Envelope_Targets"]
    header_row = next(envelope.iter_rows(min_row=4, max_row=4, values_only=True))
    headers = _header_map(header_row)
    for row_number, row in enumerate(envelope.iter_rows(min_row=5, values_only=True), start=5):
        envelope_name = _clean_text(_cell(row, headers, "Envelope"))
        identifier = _clean_text(_cell(row, headers, "ISIN/Ticker"))
        instrument = _clean_text(_cell(row, headers, "Instrument"))
        target = _weight_pct(_cell(row, headers, "Target % (within envelope)"))
        if not envelope_name:
            continue
        if not identifier and not instrument and target is None:
            warnings.append(f"row {row_number}: optional envelope target skipped for {envelope_name}")
            continue
        if not identifier or not instrument or target is None:
            rejected.append({
                "reason": (
                    f"row {row_number}: envelope target for {envelope_name} must define "
                    "identifier, instrument, and a finite target weight"
                )
            })
            continue
        envelope_lines.append(
            TargetEnvelopeLine(
                model_id=model_id,
                portfolio_scope="PERSO",
                envelope=envelope_name,
                ticker=None if re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", identifier) else _clean_upper(identifier),
                isin=_clean_upper(identifier) if re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", identifier) else None,
                instrument=instrument,
                asset_class=None,
                region=None,
                currency="EUR",
                target_weight_pct=target,
                target_value_eur=_read_float(_cell(row, headers, "Target Value (EUR)")),
                notes=_clean_text(_cell(row, headers, "Notes")),
                source_sheet="Envelope_Targets",
                source_row=row_number,
            )
        )

    holdings = workbook["Holdings_All"]
    holding_headers = _header_map(next(holdings.iter_rows(min_row=1, max_row=1, values_only=True)))
    for row_number, row in enumerate(holdings.iter_rows(min_row=2, values_only=True), start=2):
        envelope_name = _clean_text(_cell(row, holding_headers, "Envelope"))
        if not envelope_name:
            continue
        identifier = _clean_text(_cell(row, holding_headers, "ISIN/Ticker"))
        audit_holdings.append(
            TargetAuditHolding(
                model_id=model_id,
                portfolio_scope="PERSO",
                envelope=envelope_name,
                ticker=None if identifier and re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", identifier) else _clean_upper(identifier),
                isin=_clean_upper(identifier) if identifier and re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", identifier) else None,
                instrument=_clean_text(_cell(row, holding_headers, "Instrument")),
                asset_class=_clean_text(_cell(row, holding_headers, "Asset_Class")),
                region=_clean_text(_cell(row, holding_headers, "Region")),
                currency=_clean_upper(_cell(row, holding_headers, "Currency")),
                market_value_eur=_read_float(_cell(row, holding_headers, "Market_Value_EUR")),
                quantity=None,
                notes="audit only: current official source remains broker snapshots",
                source_sheet="Holdings_All",
                source_row=row_number,
            )
        )

    return _build_report(
        kind="perso",
        source_file=Path(path).name,
        model_id=model_id,
        model_name="Personal strategic and envelope target",
        buckets=buckets,
        sleeve_allocations=[],
        envelope_lines=envelope_lines,
        audit_holdings=audit_holdings,
        warnings=warnings,
        reserve_floor_eur=None,
        reserve_excluded_from_risky_allocation=False,
        extra_rejected=rejected,
    )


def parse_pro_model(path: str | Path) -> dict[str, Any]:
    workbook = load_workbook(path, data_only=False)
    model_id = _target_model_id("pro")
    calc = workbook["Calcul_allocation_cible"]
    rejected: list[dict[str, Any]] = []
    sleeve_allocations: list[TargetSleeveAllocation] = []
    sleeve_sheet = workbook["Modele_Core_Satellite"]
    sleeve_headers = _header_map(next(sleeve_sheet.iter_rows(min_row=4, max_row=4, values_only=True)))
    for row_number, row in enumerate(sleeve_sheet.iter_rows(min_row=5, values_only=True), start=5):
        sleeve = (_clean_text(_cell(row, sleeve_headers, "Bloc")) or "").upper()
        if sleeve not in {"CORE", "SATELLITE"}:
            continue
        region = _clean_text(_cell(row, sleeve_headers, "Région"))
        weight = _weight_pct(_cell(row, sleeve_headers, "% du surplus"))
        if not region or weight is None:
            rejected.append({"reason": f"Modele_Core_Satellite row {row_number}: region and weight are required"})
            continue
        bucket_key = _bucket_key(region)
        sleeve_allocations.append(
            TargetSleeveAllocation(
                model_id=model_id,
                portfolio_scope="PRO",
                sleeve_key=sleeve,
                component_label=_clean_text(_cell(row, sleeve_headers, "Composante")) or "Unspecified",
                bucket_key=bucket_key,
                bucket_label=region,
                target_weight_pct=weight,
                instrument_policy=_clean_text(_cell(row, sleeve_headers, "Type d’instrument")),
                activation_status=_clean_text(_cell(row, sleeve_headers, "Statut")) or "UNKNOWN",
                source_sheet="Modele_Core_Satellite",
                source_row=row_number,
            )
        )

    bucket_labels = {
        "actions_us": "Actions US",
        "actions_europe": "Actions Europe",
        "actions_japan": "Actions Japon",
        "actions_pacific_ex_japan": "Actions Pacifique ex-JP",
        "actions_emerging": "Actions Emergents",
        "gold": "Or",
    }
    bucket_order = list(bucket_labels)
    aggregated_weights = {
        key: round(sum(row.target_weight_pct for row in sleeve_allocations if row.bucket_key == key), 6)
        for key in bucket_order
    }
    buckets = [
        TargetBucket(
            model_id=model_id,
            portfolio_scope="PRO",
            bucket_key=key,
            bucket_label=bucket_labels[key],
            parent_bucket_key="actions" if key != "gold" else None,
            target_weight_pct=aggregated_weights[key],
            lower_band_pct=None,
            upper_band_pct=None,
            source_sheet="Modele_Core_Satellite",
            source_row=min(row.source_row for row in sleeve_allocations if row.bucket_key == key),
        )
        for key in bucket_order
        if any(row.bucket_key == key for row in sleeve_allocations)
    ]

    core_total = round(sum(row.target_weight_pct for row in sleeve_allocations if row.sleeve_key == "CORE"), 6)
    satellite_total = round(sum(row.target_weight_pct for row in sleeve_allocations if row.sleeve_key == "SATELLITE"), 6)
    if abs(core_total - 70.0) > 0.05:
        rejected.append({"reason": f"PRO Core target must equal 70% ±0.05 ({core_total:.4f}%)"})
    if abs(satellite_total - 30.0) > 0.05:
        rejected.append({"reason": f"PRO Satellite target must equal 30% ±0.05 ({satellite_total:.4f}%)"})
    if any(row.bucket_key == "crypto" for row in sleeve_allocations):
        rejected.append({"reason": "PRO crypto allocation is forbidden"})
    expected_sleeve_weights = {
        ("CORE", "actions_us"): 28.0,
        ("CORE", "actions_europe"): 12.0,
        ("CORE", "actions_japan"): 7.0,
        ("CORE", "actions_pacific_ex_japan"): 4.0,
        ("CORE", "actions_emerging"): 9.0,
        ("CORE", "gold"): 10.0,
        ("SATELLITE", "actions_us"): 13.0,
        ("SATELLITE", "actions_europe"): 6.0,
        ("SATELLITE", "actions_japan"): 3.0,
        ("SATELLITE", "actions_pacific_ex_japan"): 1.0,
        ("SATELLITE", "actions_emerging"): 7.0,
    }
    observed_sleeve_weights: dict[tuple[str, str], float] = {}
    for row in sleeve_allocations:
        key = (row.sleeve_key, row.bucket_key)
        observed_sleeve_weights[key] = observed_sleeve_weights.get(key, 0.0) + row.target_weight_pct
    if set(observed_sleeve_weights) != set(expected_sleeve_weights):
        rejected.append({"reason": "PRO Core / Satellite bucket contract does not match the approved 11-line model"})
    for key, expected_weight in expected_sleeve_weights.items():
        observed_weight = observed_sleeve_weights.get(key)
        if observed_weight is not None and abs(observed_weight - expected_weight) > 0.05:
            rejected.append({
                "reason": (
                    f"PRO {key[0]} {key[1]} target must equal {expected_weight:.2f}% "
                    f"({observed_weight:.4f}%)"
                )
            })

    gold_weight = aggregated_weights.get("gold", 0.0)
    equity_weight = round(100.0 - gold_weight, 6)

    target_by_key = {bucket.bucket_key: bucket.target_weight_pct for bucket in buckets}
    envelope_lines: list[TargetEnvelopeLine] = []
    for row_number, row in enumerate(calc.iter_rows(min_row=16, max_row=21, values_only=True), start=16):
        label = _clean_text(row[0] if len(row) > 0 else None)
        if not label:
            continue
        key = _bucket_key(label)
        envelope_lines.append(
            TargetEnvelopeLine(
                model_id=model_id,
                portfolio_scope="PRO",
                envelope="IBKR_Core",
                ticker=_clean_upper(row[1] if len(row) > 1 else None),
                isin=_clean_upper(row[2] if len(row) > 2 else None),
                instrument=label,
                asset_class=label,
                region=label.replace("Actions ", "").replace("Or", "Gold"),
                currency="EUR",
                target_weight_pct=target_by_key.get(key),
                target_value_eur=None,
                notes="PRO target authority: Calcul_allocation_cible",
                source_sheet="Calcul_allocation_cible",
                source_row=row_number,
            )
        )

    audit_holdings: list[TargetAuditHolding] = []
    ibkr = workbook["IBKR_Positions"]
    ibkr_headers = _header_map(next(ibkr.iter_rows(min_row=5, max_row=5, values_only=True)))
    for row_number, row in enumerate(ibkr.iter_rows(min_row=6, values_only=True), start=6):
        ticker = _clean_upper(_cell(row, ibkr_headers, "Symbol"))
        if not ticker or ticker == "TOTAL":
            continue
        audit_holdings.append(
            TargetAuditHolding(
                model_id=model_id,
                portfolio_scope="PRO",
                envelope="IBKR",
                ticker=ticker,
                isin=None,
                instrument=_clean_text(_cell(row, ibkr_headers, "Description")),
                asset_class=None,
                region=None,
                currency=_clean_upper(_cell(row, ibkr_headers, "Currency")),
                market_value_eur=_read_float(_cell(row, ibkr_headers, "Market Value (EUR)")),
                quantity=_read_float(_cell(row, ibkr_headers, "Quantity")),
                notes="audit only: current official source remains broker snapshots",
                source_sheet="IBKR_Positions",
                source_row=row_number,
            )
        )

    alpheys = workbook["ALPHEYS"]
    alpheys_headers = _header_map(next(alpheys.iter_rows(min_row=5, max_row=5, values_only=True)))
    for row_number, row in enumerate(alpheys.iter_rows(min_row=6, values_only=True), start=6):
        instrument = _clean_text(_cell(row, alpheys_headers, "Instrument"))
        if not instrument or instrument.startswith("TOTAL"):
            continue
        audit_holdings.append(
            TargetAuditHolding(
                model_id=model_id,
                portfolio_scope="PRO",
                envelope="ALPHEYS",
                ticker=None,
                isin=_clean_upper(_cell(row, alpheys_headers, "ISIN")),
                instrument=instrument,
                asset_class="Produit structuré",
                region=None,
                currency="EUR",
                market_value_eur=_read_float(_cell(row, alpheys_headers, "Market Value")),
                quantity=_read_float(_cell(row, alpheys_headers, "Qty")),
                notes="structured product: manual/statement source required for refresh",
                source_sheet="ALPHEYS",
                source_row=row_number,
            )
        )

    reserve_floor_eur = _read_float(workbook["Portefeuille_cible"]["B4"].value)
    if reserve_floor_eur is None or abs(reserve_floor_eur - 120_000.0) > 0.01:
        rejected.append({"reason": f"PRO reserve floor must equal EUR 120000 ({reserve_floor_eur})"})
    return _build_report(
        kind="pro",
        source_file=Path(path).name,
        model_id=model_id,
        model_name="Professional Core / Satellite allocation target",
        buckets=buckets,
        sleeve_allocations=sleeve_allocations,
        envelope_lines=envelope_lines,
        audit_holdings=audit_holdings,
        warnings=[],
        reserve_floor_eur=reserve_floor_eur,
        reserve_excluded_from_risky_allocation=True,
        extra_rejected=rejected,
        extra_report={
            "target_authority": "Modele_Core_Satellite",
            "gold_weight_pct": gold_weight,
            "equity_weight_pct": equity_weight,
            "core_target_pct": core_total,
            "satellite_target_pct": satellite_total,
            "reserve_floor_eur": reserve_floor_eur,
            "reserve_excluded_from_risky_allocation": True,
        },
    )


def _build_report(
    *,
    kind: str,
    source_file: str,
    model_id: str,
    model_name: str,
    buckets: list[TargetBucket],
    sleeve_allocations: list[TargetSleeveAllocation],
    envelope_lines: list[TargetEnvelopeLine],
    audit_holdings: list[TargetAuditHolding],
    warnings: list[str],
    reserve_floor_eur: float | None,
    reserve_excluded_from_risky_allocation: bool,
    extra_rejected: list[dict[str, Any]] | None = None,
    extra_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    total = round(sum(bucket.target_weight_pct for bucket in buckets), 6)
    rejected = list(extra_rejected or [])
    if abs(total - 100.0) > 0.05:
        rejected.append({"reason": f"target bucket total must equal 100% ±0.05 ({total:.4f}%)"})
    bucket_keys = [bucket.bucket_key for bucket in buckets]
    if len(bucket_keys) != len(set(bucket_keys)):
        rejected.append({"reason": "target bucket keys must be unique"})
    for bucket in buckets:
        weight = bucket.target_weight_pct
        lower = bucket.lower_band_pct
        upper = bucket.upper_band_pct
        if not math.isfinite(weight) or weight < 0 or weight > 100:
            rejected.append({
                "reason": f"target bucket {bucket.bucket_key} weight must be finite and within 0%-100%"
            })
            continue
        if (lower is None) != (upper is None):
            rejected.append({
                "reason": f"target bucket {bucket.bucket_key} must define both band bounds or neither"
            })
            continue
        if lower is not None and upper is not None and (
            not math.isfinite(lower)
            or not math.isfinite(upper)
            or lower < 0
            or upper > 100
            or lower > upper
            or weight < lower
            or weight > upper
        ):
            rejected.append({
                "reason": (
                    f"target bucket {bucket.bucket_key} band must be finite, ordered, within 0%-100%, "
                    "and contain the target weight"
                )
            })
    envelope_totals: dict[str, float] = {}
    invalid_envelopes: set[str] = set()
    for line in envelope_lines:
        weight = line.target_weight_pct
        if weight is None or not math.isfinite(weight) or weight < 0 or weight > 100:
            invalid_envelopes.add(line.envelope)
            rejected.append({
                "reason": (
                    f"target envelope {line.envelope} row {line.source_row} weight must be "
                    "finite and within 0%-100%"
                )
            })
            continue
        envelope_totals[line.envelope] = envelope_totals.get(line.envelope, 0.0) + weight
    for envelope_name, envelope_total in envelope_totals.items():
        if envelope_name in invalid_envelopes:
            continue
        if abs(envelope_total - 100.0) > 0.05:
            rejected.append({
                "reason": (
                    f"target envelope {envelope_name} total must equal 100% ±0.05 "
                    f"({envelope_total:.4f}%)"
                )
            })
    if kind == "perso":
        crypto_bucket = next((bucket for bucket in buckets if bucket.bucket_key == "crypto"), None)
        if crypto_bucket is None:
            rejected.append({"reason": "PERSO crypto bucket is required and must be explicit"})
        elif (
            abs(crypto_bucket.target_weight_pct - 2.0) > 0.05
            or crypto_bucket.lower_band_pct is None
            or abs(crypto_bucket.lower_band_pct) > 0.05
            or crypto_bucket.upper_band_pct is None
            or abs(crypto_bucket.upper_band_pct - 4.0) > 0.05
        ):
            rejected.append({"reason": "PERSO crypto target must be 2% with an explicit 0%-4% band"})
    report_json = {
        "allocation_contract_version": ALLOCATION_CONTRACT_VERSION,
        "warnings": warnings,
        "rejected": rejected,
        "bucket_count": len(buckets),
        "sleeve_allocation_count": len(sleeve_allocations),
        "envelope_line_count": len(envelope_lines),
        "audit_holding_count": len(audit_holdings),
        **(extra_report or {}),
    }
    return {
        "ok": not rejected,
        "kind": kind,
        "portfolio_scope": kind.upper(),
        "model_id": model_id,
        "model_name": model_name,
        "source_file": source_file,
        "allocation_contract_version": ALLOCATION_CONTRACT_VERSION,
        "target_total_pct": total,
        "buckets": buckets,
        "sleeve_allocations": sleeve_allocations,
        "envelope_lines": envelope_lines,
        "audit_holdings": audit_holdings,
        "warnings": warnings,
        "rejected": rejected,
        "report_json": report_json,
        "reserve_floor_eur": reserve_floor_eur,
        "reserve_excluded_from_risky_allocation": reserve_excluded_from_risky_allocation,
    }


def parse_target_model(path: str | Path, *, kind: str) -> dict[str, Any]:
    if kind == "perso":
        return parse_personal_model(path)
    if kind == "pro":
        return parse_pro_model(path)
    raise RuntimeError("Unsupported --kind. Expected perso or pro.")


def _build_supabase_client() -> Any:
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    if not url:
        raise RuntimeError("SUPABASE_URL is required for --apply")
    return create_client(url, require_backend_supabase_key(os.environ))


def _payload(row: Any) -> dict[str, Any]:
    payload = asdict(row)
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    return payload


def apply_target_model(report: dict[str, Any], *, supabase_client: Any) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    model_payload = {
        "id": report["model_id"],
        "portfolio_scope": report["portfolio_scope"],
        "model_name": report["model_name"],
        "source_file": report["source_file"],
        "allocation_contract_version": report["allocation_contract_version"],
        "source_kind": report["kind"],
        "as_of_date": None,
        "is_active": True,
        "target_total_pct": report["target_total_pct"],
        "reserve_floor_eur": report["reserve_floor_eur"],
        "reserve_excluded_from_risky_allocation": report["reserve_excluded_from_risky_allocation"],
        "status": "READY" if report["ok"] else "INVALID",
        "report_json": report["report_json"],
        "updated_at": now,
    }
    bucket_payloads = [_payload(row) for row in report["buckets"]]
    sleeve_payloads = [_payload(row) for row in report["sleeve_allocations"]]
    envelope_payloads = [_payload(row) for row in report["envelope_lines"]]
    audit_payloads = [_payload(row) for row in report["audit_holdings"]]
    supabase_client.rpc(
        APPLY_TARGET_MODEL_RPC,
        {
            "p_model": model_payload,
            "p_buckets": bucket_payloads,
            "p_sleeve_allocations": sleeve_payloads,
            "p_envelope_lines": envelope_payloads,
            "p_audit_holdings": audit_payloads,
        },
    ).execute()

    return {
        "model_upserted": report["model_id"],
        "buckets_inserted": len(bucket_payloads),
        "sleeve_allocations_inserted": len(sleeve_payloads),
        "envelope_lines_inserted": len(envelope_payloads),
        "audit_holdings_inserted": len(audit_payloads),
    }


def run_import(
    input_path: str | Path,
    *,
    kind: str,
    dry_run: bool = True,
    supabase_client: Any | None = None,
) -> dict[str, Any]:
    report = parse_target_model(input_path, kind=kind)
    write_report = {
        "model_upserted": None,
        "buckets_inserted": 0,
        "sleeve_allocations_inserted": 0,
        "envelope_lines_inserted": 0,
        "audit_holdings_inserted": 0,
    }
    if not dry_run:
        if supabase_client is None:
            raise RuntimeError("A Supabase client is required when dry_run=False")
        if report["ok"]:
            write_report = apply_target_model(report, supabase_client=supabase_client)

    return {
        "ok": report["ok"],
        "dry_run": dry_run,
        "kind": report["kind"],
        "portfolio_scope": report["portfolio_scope"],
        "model_id": report["model_id"],
        "source_file": report["source_file"],
        "allocation_contract_version": report["allocation_contract_version"],
        "target_total_pct": report["target_total_pct"],
        "bucket_count": len(report["buckets"]),
        "sleeve_allocation_count": len(report["sleeve_allocations"]),
        "envelope_line_count": len(report["envelope_lines"]),
        "audit_holding_count": len(report["audit_holdings"]),
        "buckets": [asdict(row) for row in report["buckets"]],
        "sleeve_allocations": [asdict(row) for row in report["sleeve_allocations"]],
        "reserve_floor_eur": report["reserve_floor_eur"],
        "reserve_excluded_from_risky_allocation": report["reserve_excluded_from_risky_allocation"],
        "envelope_lines": [asdict(row) for row in report["envelope_lines"]],
        "warnings": report["warnings"],
        "rejected": report["rejected"],
        "write": write_report,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import two-level portfolio target models from curated Excel files")
    parser.add_argument("--kind", required=True, choices=["perso", "pro"], help="Target model workbook kind")
    parser.add_argument("--file", required=True, help="Target model .xlsx file")
    parser.add_argument("--dry-run", action="store_true", help="Validate and report without writing Supabase")
    parser.add_argument("--apply", action="store_true", help="Write target model to Supabase")
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
        report = run_import(args.file, kind=args.kind, dry_run=args.dry_run, supabase_client=client)
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
