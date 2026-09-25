#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import os
import re
import sys
from dataclasses import asdict, dataclass, replace
from datetime import date, datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse
from typing import Any

from pypdf import PdfReader

CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = CURRENT_DIR.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

from supabase_key_guard import require_backend_supabase_key  # noqa: E402


ISIN_CANDIDATE_RE = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b")
ISIN_AT_START_RE = re.compile(r"^([A-Z]{2}[A-Z0-9]{9}[0-9])\b")
LEGAL_FORMS = ("ETF", "FCP", "SICAV", "FIA", "SCI", "SCPI", "OPCI", "SLP")
SUPPORTED_SOURCES = ("lucya-cardif", "linxea-funds", "fortuneo-av", "linxea-web", "fortuneo-av-web")
DEFAULT_SOURCE_URLS = {
    "linxea-web": "https://www.linxea.com/assurance-vie/fonds-labellises-linxea/",
    "fortuneo-av-web": "https://mabanque.fortuneo.fr/document-assurance-vie/PERFSUPPORT",
}
COUNTRY_PREFIXES = {
    "AN", "AT", "AU", "BE", "BM", "CA", "CH", "CY", "DE", "DK", "ES",
    "FI", "FR", "GB", "HK", "IE", "IM", "IT", "JE", "JP", "LR", "LU",
    "NL", "NO", "PA", "PT", "SE", "US",
}
CURRENCY_CODES = {"EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD"}


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
    page: int | None
    raw_text: str


@dataclass(frozen=True)
class SupportSourceLine:
    source_id: str
    external_id: str
    isin: str | None
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
    source_quality: str
    identifier_state: str
    envelope: str
    score: float | None
    score_details: dict[str, Any]
    page: int | None
    raw_text: str


def _clean_line(value: str) -> str:
    normalized = (
        value
        .replace("\xa0", " ")
        .replace("ﬃ", "ffi")
        .replace("ﬀ", "ff")
        .replace("ﬁ", "fi")
        .replace("ﬂ", "fl")
    )
    return " ".join(normalized.split())


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


def _is_valid_isin(value: str | None) -> bool:
    if not value:
        return False
    isin = value.strip().upper()
    if not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", isin):
        return False
    if isin[:2] not in COUNTRY_PREFIXES:
        return False

    digits = "".join(str(ord(char) - 55) if char.isalpha() else char for char in isin)
    total = 0
    parity = len(digits) % 2
    for index, char in enumerate(digits):
        digit = int(char)
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def _valid_isins(text: str) -> list[str]:
    seen: set[str] = set()
    values: list[str] = []
    for match in ISIN_CANDIDATE_RE.finditer(text.upper()):
        isin = match.group(1)
        if isin in seen or not _is_valid_isin(isin):
            continue
        seen.add(isin)
        values.append(isin)
    return values


def _stable_external_id(*parts: str) -> str:
    body = "\n".join(parts)
    return hashlib.sha1(body.encode("utf-8")).hexdigest()[:24]


def _source_metadata(source: str) -> dict[str, str]:
    if source == "lucya-cardif":
        return {
            "source_name": "Lucya/Cardif support list",
            "provider": "Cardif",
            "source_quality": "COMPLETE",
            "default_envelope": "Lucya/Cardif",
        }
    if source == "linxea-funds":
        return {
            "source_name": "Linxea funds capture",
            "provider": "Linxea",
            "source_quality": "IDENTIFIER_MISSING",
            "default_envelope": "Linxea",
        }
    if source == "fortuneo-av":
        return {
            "source_name": "Fortuneo assurance-vie visible funds",
            "provider": "Fortuneo",
            "source_quality": "PARTIAL",
            "default_envelope": "Fortuneo AV",
        }
    if source == "linxea-web":
        return {
            "source_name": "Linxea public web support list",
            "provider": "Linxea",
            "source_quality": "PARTIAL",
            "default_envelope": "Linxea",
        }
    if source == "fortuneo-av-web":
        return {
            "source_name": "Fortuneo Vie PERFSUPPORT public list",
            "provider": "Fortuneo",
            "source_quality": "COMPLETE",
            "default_envelope": "Fortuneo AV",
        }
    supported = ", ".join(SUPPORTED_SOURCES)
    raise RuntimeError(f"Unsupported --source '{source}'. Expected one of: {supported}.")


def _source_id(source: str, source_date: date | None) -> str:
    return f"{source}:{source_date.isoformat() if source_date else 'undated'}"


def _is_url(value: str | Path | None) -> bool:
    if value is None:
        return False
    parsed = urlparse(str(value))
    return parsed.scheme in {"http", "https"}


def _location_display_name(value: str | Path) -> str:
    text = str(value)
    if not _is_url(text):
        return Path(text).name
    parsed = urlparse(text)
    return Path(parsed.path).name or parsed.netloc


def _read_binary_location(value: str | Path) -> bytes:
    if not _is_url(value):
        return Path(value).read_bytes()

    import requests

    response = requests.get(
        str(value),
        timeout=30,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; PortfolioProject/1.0; +https://github.com/HaliroESG/portfolio-project)",
            "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.8",
        },
    )
    response.raise_for_status()
    return response.content


def _read_text_location(value: str | Path) -> str:
    content = _read_binary_location(value)
    for encoding in ("utf-8", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _pdf_reader_from_location(value: str | Path) -> PdfReader:
    if _is_url(value):
        return PdfReader(BytesIO(_read_binary_location(value)))
    return PdfReader(str(value))


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


def _parse_support_line(line: str, *, page: int | None, source_id: str) -> SupportRow | None:
    match = ISIN_AT_START_RE.match(line.upper())
    if not match:
        return None

    isin = match.group(1)
    if not _is_valid_isin(isin):
        return None

    rest = line[match.end():].strip()
    sri, sri_start, sri_end = _find_sri(rest)
    before_sri = rest[:sri_start].strip() if sri_start is not None else rest
    after_sri = rest[sri_end:].strip() if sri_end is not None else ""
    name, legal_form, manager = _split_name_manager(before_sri)
    support_type = _support_type(name, legal_form, line)
    percentages = _percent_values(after_sri)

    contract_index = next(
        (
            index
            for index, value in enumerate(percentages[4:], start=4)
            if any(abs(value - expected) < 0.001 for expected in (0.5, 0.75, 0.85))
        ),
        None,
    )
    if contract_index is not None and contract_index >= 6:
        performance_1y_pct = percentages[0] if len(percentages) >= 1 else None
        performance_5y_pct = percentages[1] if len(percentages) >= 2 else None
        asset_fee_pct = percentages[2] if len(percentages) >= 3 else None
        retrocession_pct = percentages[3] if len(percentages) >= 4 and "(dont" in after_sri.lower() else None
    else:
        asset_fee_pct = percentages[0] if len(percentages) >= 1 else None
        retrocession_pct = percentages[1] if len(percentages) >= 2 and "(dont" in after_sri.lower() else None
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


def _source_line_from_support(
    row: SupportRow,
    *,
    external_id: str,
    source_quality: str,
    identifier_state: str,
    envelope: str,
) -> SupportSourceLine:
    return SupportSourceLine(
        source_id=row.source_id,
        external_id=external_id,
        isin=row.isin,
        name=row.name,
        support_type=row.support_type,
        legal_form=row.legal_form,
        manager=row.manager,
        sri=row.sri,
        performance_1y_pct=row.performance_1y_pct,
        performance_5y_pct=row.performance_5y_pct,
        asset_fee_pct=row.asset_fee_pct,
        contract_fee_pct=row.contract_fee_pct,
        total_fee_pct=row.total_fee_pct,
        retrocession_pct=row.retrocession_pct,
        source_quality=source_quality,
        identifier_state=identifier_state,
        envelope=envelope,
        score=row.score,
        score_details=row.score_details,
        page=row.page,
        raw_text=row.raw_text,
    )


def _source_line(
    *,
    source_id: str,
    envelope: str,
    name: str,
    source_quality: str,
    identifier_state: str,
    page: int | None,
    raw_text: str,
    isin: str | None = None,
    support_type: str = "UNKNOWN",
    performance_1y_pct: float | None = None,
    performance_5y_pct: float | None = None,
) -> SupportSourceLine:
    score, score_details = _score_support(
        support_type=support_type,
        sri=None,
        total_fee_pct=None,
        performance_5y_pct=performance_5y_pct,
    )
    return SupportSourceLine(
        source_id=source_id,
        external_id=_stable_external_id(source_id, isin or "", name, raw_text),
        isin=isin,
        name=name,
        support_type=support_type,
        legal_form=None,
        manager=None,
        sri=None,
        performance_1y_pct=performance_1y_pct,
        performance_5y_pct=performance_5y_pct,
        asset_fee_pct=None,
        contract_fee_pct=None,
        total_fee_pct=None,
        retrocession_pct=None,
        source_quality=source_quality,
        identifier_state=identifier_state,
        envelope=envelope,
        score=score,
        score_details=score_details,
        page=page,
        raw_text=raw_text,
    )


def parse_lucya_cardif_pdf(path: str | Path, *, source_id: str) -> dict[str, Any]:
    reader = _pdf_reader_from_location(path)
    rows: list[SupportRow] = []
    rejected: list[dict[str, Any]] = []
    seen: set[str] = set()

    for page_index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        for raw_line in text.splitlines():
            line = _clean_line(raw_line)
            candidate = ISIN_AT_START_RE.match(line.upper())
            if not candidate:
                continue
            isin = candidate.group(1)
            if not _is_valid_isin(isin):
                rejected.append({"page": page_index, "line": line, "reason": "invalid_isin_checksum_or_prefix"})
                continue
            parsed = _parse_support_line(line, page=page_index, source_id=source_id)
            if parsed is None:
                rejected.append({"page": page_index, "line": line, "reason": "unparsed"})
                continue
            if parsed.isin in seen:
                continue
            seen.add(parsed.isin)
            rows.append(parsed)

    return _parse_report(
        accepted=rows,
        source_rows=[],
        rejected=rejected,
        expected_count=None,
        source_quality="COMPLETE",
    )


def _linxea_noise_line(line: str) -> bool:
    if not line:
        return True
    lower = line.lower()
    if "linxea-app" in lower or "https://" in lower or lower.startswith("page "):
        return True
    if lower.startswith("26/05/2026"):
        return True
    if "sélec" in lower or "selectionnez" in lower or "quel est votre contrat" in lower:
        return True
    if lower in {"etf", "fonds stars", "charger plus"}:
        return True
    if lower.startswith("aperçu") or lower.startswith("nom "):
        return True
    if lower.startswith("catégorie de support") or lower.startswith("nota"):
        return True
    if "affiche 588 sur 588" in lower:
        return True
    return False


def _parse_linxea_candidate(text: str, *, source_id: str, envelope: str, page: int) -> SupportSourceLine | None:
    first_metric = re.search(r"[-+]?\d+(?:[,.]\d+)?\s*%", text)
    if not first_metric:
        return None
    name = text[:first_metric.start()].strip(" -")
    values = _percent_values(text[first_metric.start():])
    if len(name) < 3 or not values:
        return None
    parts = name.split()
    if len(parts) > 1 and parts[-1].upper() in CURRENCY_CODES:
        name = " ".join(parts[:-1]).strip()
    if not name:
        return None
    support_type = _support_type(name, None, text)
    if support_type == "UNKNOWN":
        support_type = "FUND"
    return _source_line(
        source_id=source_id,
        envelope=envelope,
        name=name,
        source_quality="IDENTIFIER_MISSING",
        identifier_state="IDENTIFIER_MISSING",
        page=page,
        raw_text=text,
        support_type=support_type,
        performance_1y_pct=values[0] if values else None,
        performance_5y_pct=values[1] if len(values) > 1 else None,
    )


def parse_linxea_funds_pdf(path: str | Path, *, source_id: str, envelope: str) -> dict[str, Any]:
    reader = _pdf_reader_from_location(path)
    source_rows: list[SupportSourceLine] = []
    rejected: list[dict[str, Any]] = []
    seen: set[str] = set()
    expected_count: int | None = None

    for page_index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        pending: list[str] = []
        for raw_line in text.splitlines():
            line = _clean_line(raw_line)
            match = re.search(r"affiche\s+(\d+)\s+sur\s+\1", line.lower())
            if match:
                expected_count = int(match.group(1))
            if _linxea_noise_line(line):
                continue
            if "%" not in line:
                pending.append(line)
                continue
            candidate = _clean_line(" ".join([*pending, line]))
            pending = []
            parsed = _parse_linxea_candidate(candidate, source_id=source_id, envelope=envelope, page=page_index)
            if parsed is None:
                rejected.append({"page": page_index, "line": candidate, "reason": "unparsed_linxea_row"})
                continue
            dedupe_key = parsed.name.lower()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            source_rows.append(parsed)

    return _parse_report(
        accepted=[],
        source_rows=source_rows,
        rejected=rejected,
        expected_count=expected_count,
        source_quality="IDENTIFIER_MISSING",
    )


def _fortuneo_noise_line(line: str) -> bool:
    noise = {
        "Fonds", "étrangers", "Obligations", "internationales", "Actions",
        "Patrimoine", "Assurance-", "vie", "M SOUDEE", "OLIVIER", "PEA", "et",
        "PEA-", "PME", "PME,", "2", "comptes", "Compte-", "titres", "Compte", "espèces", "SouscrirePEA,",
        "Especes", "compte", "+ 0,00 €", "disponibles", "Messagerie",
        "Demandes et Souscri…",
        "Découvrir", "nos", "offres", "Bourse", "PER", "Préparez", "votre",
        "retraite", "Crédit", "immobilier", "Prêt", "personnel", "Concrétisez",
        "vos", "projets", "en", "toute", "simplicitéAssurance", "emprunteur",
        "Jusqu’à", "60 %", "d’économies", "Libellé", "Code ISIN", "Catégorie",
        "AMF", "Votre patrimoine", "Parrainage", "Aide",
    }
    if not line:
        return True
    if line in noise:
        return True
    lower = line.lower()
    if line.startswith("+") and "€" in line:
        return True
    if lower.startswith("26/05/2026") or "fortuneo" in lower or "https://" in lower:
        return True
    if lower.startswith("page ") or "profil & paramètres" in lower:
        return True
    if "libellé" in lower and "code isin" in lower:
        return True
    if "retour à la valorisation" in lower or "votre quotidien" in lower:
        return True
    if "banque et assurances" in lower or "investissements" in lower:
        return True
    return False


def parse_fortuneo_av_pdf(path: str | Path, *, source_id: str, envelope: str) -> dict[str, Any]:
    reader = _pdf_reader_from_location(path)
    lines_by_page: list[tuple[int, str]] = []
    for page_index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        lines_by_page.extend((page_index, _clean_line(raw_line)) for raw_line in text.splitlines())

    accepted: list[SupportRow] = []
    source_rows: list[SupportSourceLine] = []
    rejected: list[dict[str, Any]] = []
    seen: set[str] = set()

    for index, (page_index, line) in enumerate(lines_by_page):
        isins = _valid_isins(line)
        if not isins:
            continue
        isin = isins[0]
        if isin in seen:
            continue

        name_parts: list[str] = []
        cursor = index - 1
        while cursor >= 0 and len(name_parts) < 8:
            _, previous = lines_by_page[cursor]
            if _valid_isins(previous):
                break
            if not _fortuneo_noise_line(previous):
                name_parts.append(previous)
            cursor -= 1
        name = _clean_line(" ".join(reversed(name_parts))) or isin
        support_type = _support_type(name, None, name)
        if support_type == "UNKNOWN":
            support_type = "FUND"
        score, score_details = _score_support(
            support_type=support_type,
            sri=None,
            total_fee_pct=None,
            performance_5y_pct=None,
        )
        support = SupportRow(
            source_id=source_id,
            isin=isin,
            name=name,
            support_type=support_type,
            legal_form=None,
            manager=None,
            sri=None,
            performance_1y_pct=None,
            performance_5y_pct=None,
            asset_fee_pct=None,
            contract_fee_pct=None,
            total_fee_pct=None,
            retrocession_pct=None,
            morningstar_rating=None,
            quantalys_rating=None,
            metrics_state="METRICS_UNAVAILABLE",
            score=score,
            score_details=score_details,
            page=page_index,
            raw_text=f"{name} {isin}",
        )
        seen.add(isin)
        accepted.append(support)
        source_rows.append(
            _source_line_from_support(
                support,
                external_id=_stable_external_id(source_id, isin, name),
                source_quality="PARTIAL",
                identifier_state="PARTIAL_SOURCE",
                envelope=envelope,
            )
        )

    return _parse_report(
        accepted=accepted,
        source_rows=source_rows,
        rejected=rejected,
        expected_count=None,
        source_quality="PARTIAL",
    )


def _strip_html(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", value)
    return _clean_line(html_lib.unescape(without_tags))


def parse_linxea_web_html(html_text: str, *, source_id: str, envelope: str) -> dict[str, Any]:
    accepted: list[SupportRow] = []
    source_rows: list[SupportSourceLine] = []
    rejected: list[dict[str, Any]] = []
    seen: set[str] = set()

    table_rows = re.findall(r"<tr\b[^>]*>(.*?)</tr>", html_text, flags=re.IGNORECASE | re.DOTALL)
    for row_index, raw_row in enumerate(table_rows, start=1):
        cells = [
            _strip_html(cell)
            for cell in re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", raw_row, flags=re.IGNORECASE | re.DOTALL)
        ]
        isin_index = next((index for index, cell in enumerate(cells) if _is_valid_isin(cell)), None)
        if isin_index is None:
            continue
        isin = cells[isin_index].upper()
        if isin in seen:
            continue

        if isin_index >= 2:
            name = cells[isin_index - 1]
            manager = cells[8] if len(cells) > 8 and cells[8] else None
            category = cells[9] if len(cells) > 9 and cells[9] else ""
            risk_cell = cells[11] if len(cells) > 11 else ""
        else:
            name = cells[isin_index + 1] if len(cells) > isin_index + 1 else isin
            manager = cells[isin_index + 2] if len(cells) > isin_index + 2 and cells[isin_index + 2] else None
            category = cells[isin_index + 3] if len(cells) > isin_index + 3 else ""
            risk_cell = next((cell for cell in reversed(cells) if re.fullmatch(r"[1-7]", cell)), "")

        sri = int(risk_cell) if re.fullmatch(r"[1-7]", risk_cell or "") else None
        support_type = _support_type(name, None, f"{name} {category}")
        if support_type == "UNKNOWN":
            support_type = "FUND"
        score, score_details = _score_support(
            support_type=support_type,
            sri=sri,
            total_fee_pct=None,
            performance_5y_pct=None,
        )
        support = SupportRow(
            source_id=source_id,
            isin=isin,
            name=name or isin,
            support_type=support_type,
            legal_form=None,
            manager=manager,
            sri=sri,
            performance_1y_pct=None,
            performance_5y_pct=None,
            asset_fee_pct=None,
            contract_fee_pct=None,
            total_fee_pct=None,
            retrocession_pct=None,
            morningstar_rating=None,
            quantalys_rating=None,
            metrics_state="METRICS_UNAVAILABLE",
            score=score,
            score_details=score_details,
            page=None,
            raw_text=" | ".join(cells),
        )
        seen.add(isin)
        accepted.append(support)
        source_rows.append(
            _source_line_from_support(
                support,
                external_id=_stable_external_id(source_id, isin, support.name),
                source_quality="PARTIAL",
                identifier_state="PARTIAL_SOURCE",
                envelope=envelope,
            )
        )

    for isin in _valid_isins(html_lib.unescape(re.sub(r"<[^>]+>", " ", html_text))):
        if isin in seen:
            continue
        rejected.append({"line": isin, "reason": "isin_found_outside_structured_table"})

    return _parse_report(
        accepted=accepted,
        source_rows=source_rows,
        rejected=rejected,
        expected_count=None,
        source_quality="PARTIAL",
    )


def parse_linxea_web(location: str | Path, *, source_id: str, envelope: str) -> dict[str, Any]:
    return parse_linxea_web_html(_read_text_location(location), source_id=source_id, envelope=envelope)


def _segments_by_valid_isin(text: str) -> list[str]:
    normalized = _clean_line(text)
    matches = [match for match in ISIN_CANDIDATE_RE.finditer(normalized) if _is_valid_isin(match.group(1))]
    segments: list[str] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(normalized)
        segments.append(normalized[match.start():end].strip())
    return segments


def parse_fortuneo_perfsupport_text(text: str, *, source_id: str) -> dict[str, Any]:
    accepted: list[SupportRow] = []
    rejected: list[dict[str, Any]] = []
    seen: set[str] = set()

    for segment in _segments_by_valid_isin(text):
        isin_match = ISIN_AT_START_RE.match(segment.upper())
        isin = isin_match.group(1) if isin_match else None
        if not isin or isin in seen:
            continue
        parsed = _parse_support_line(segment, page=None, source_id=source_id)
        if parsed is None:
            rejected.append({"line": segment[:500], "reason": "unparsed_fortuneo_web_row"})
            continue
        if parsed.support_type == "UNKNOWN":
            parsed = replace(parsed, support_type="FUND")
        seen.add(isin)
        accepted.append(parsed)

    return _parse_report(
        accepted=accepted,
        source_rows=[],
        rejected=rejected,
        expected_count=None,
        source_quality="COMPLETE",
    )


def parse_fortuneo_perfsupport(location: str | Path, *, source_id: str) -> dict[str, Any]:
    reader = _pdf_reader_from_location(location)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return parse_fortuneo_perfsupport_text(text, source_id=source_id)


def _parse_report(
    *,
    accepted: list[SupportRow],
    source_rows: list[SupportSourceLine],
    rejected: list[dict[str, Any]],
    expected_count: int | None,
    source_quality: str,
) -> dict[str, Any]:
    identifier_missing = sum(1 for row in source_rows if row.identifier_state == "IDENTIFIER_MISSING")
    partial_source = sum(1 for row in source_rows if row.source_quality == "PARTIAL")
    return {
        "rows_read": len(accepted) + len(source_rows) + len(rejected),
        "rows_accepted": len(accepted),
        "rows_rejected": len(rejected),
        "source_rows_accepted": len(source_rows),
        "identifier_missing": identifier_missing,
        "partial_source": partial_source,
        "expected_count": expected_count,
        "source_quality": source_quality,
        "accepted": accepted,
        "source_rows": source_rows,
        "rejected": rejected,
        "support_type_counts": {
            key: sum(1 for row in [*accepted, *source_rows] if row.support_type == key)
            for key in sorted({row.support_type for row in [*accepted, *source_rows]})
        },
        "source_quality_counts": {
            key: sum(1 for row in source_rows if row.source_quality == key)
            for key in sorted({row.source_quality for row in source_rows})
        },
        "identifier_state_counts": {
            key: sum(1 for row in source_rows if row.identifier_state == key)
            for key in sorted({row.identifier_state for row in source_rows})
        },
    }


def parse_support_source(
    path: str | Path,
    *,
    source: str,
    source_id: str,
    envelope: str,
) -> dict[str, Any]:
    if source == "lucya-cardif":
        return parse_lucya_cardif_pdf(path, source_id=source_id)
    if source == "linxea-funds":
        return parse_linxea_funds_pdf(path, source_id=source_id, envelope=envelope)
    if source == "fortuneo-av":
        return parse_fortuneo_av_pdf(path, source_id=source_id, envelope=envelope)
    if source == "linxea-web":
        return parse_linxea_web(path, source_id=source_id, envelope=envelope)
    if source == "fortuneo-av-web":
        return parse_fortuneo_perfsupport(path, source_id=source_id)
    supported = ", ".join(SUPPORTED_SOURCES)
    raise RuntimeError(f"Unsupported --source '{source}'. Expected one of: {supported}.")


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


def _source_row_payload(row: SupportSourceLine) -> dict[str, Any]:
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
    provider: str | None,
    source_quality: str,
    source_file: str,
    source_url: str | None,
    source_date: date | None,
    envelope: str,
    rows: list[SupportRow],
    source_rows: list[SupportSourceLine],
    report_json: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    source_payload = {
        "id": source_id,
        "source_name": source_name,
        "source_kind": source_kind,
        "provider": provider,
        "source_quality": source_quality,
        "source_file": source_file,
        "source_url": source_url,
        "source_date": source_date.isoformat() if source_date else None,
        "report_json": report_json,
        "updated_at": now,
    }
    supabase_client.table("support_sources").upsert(source_payload, on_conflict="id").execute()

    source_row_payloads = [_source_row_payload(row) for row in source_rows]
    for chunk in _chunks(source_row_payloads):
        supabase_client.table("support_source_rows").upsert(chunk, on_conflict="source_id,external_id").execute()

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
        "source_rows_upserted": len(source_row_payloads),
        "availability_upserted": len(availability_payloads),
    }


def run_import(
    input_path: str | Path | None = None,
    *,
    source: str,
    url: str | None = None,
    source_date: str | None = None,
    envelope: str | None = None,
    dry_run: bool = True,
    supabase_client: Any | None = None,
) -> dict[str, Any]:
    metadata = _source_metadata(source)
    parsed_source_date = _parse_source_date(source_date)
    resolved_envelope = envelope or metadata["default_envelope"]
    resolved_source_id = _source_id(source, parsed_source_date)
    input_location = url or input_path or DEFAULT_SOURCE_URLS.get(source)
    if input_location is None:
        raise RuntimeError(f"--file is required for --source {source}")
    parse_report = parse_support_source(
        input_location,
        source=source,
        source_id=resolved_source_id,
        envelope=resolved_envelope,
    )
    accepted: list[SupportRow] = parse_report["accepted"]
    source_rows: list[SupportSourceLine] = parse_report["source_rows"]
    report_public = {
        key: value
        for key, value in parse_report.items()
        if key not in {"accepted", "source_rows"}
    }
    write_report = {
        "source_upserted": None,
        "supports_upserted": 0,
        "source_rows_upserted": 0,
        "availability_upserted": 0,
    }

    if not dry_run:
        if supabase_client is None:
            raise RuntimeError("A Supabase client is required when dry_run=False")
        write_report = apply_supports(
            supabase_client=supabase_client,
            source_id=resolved_source_id,
            source_name=metadata["source_name"],
            source_kind=source,
            provider=metadata["provider"],
            source_quality=metadata["source_quality"],
            source_file=_location_display_name(input_location),
            source_url=str(input_location) if _is_url(input_location) else None,
            source_date=parsed_source_date,
            envelope=resolved_envelope,
            rows=accepted,
            source_rows=source_rows,
            report_json=report_public,
        )

    ok = (parse_report["rows_accepted"] + parse_report["source_rows_accepted"]) > 0
    return {
        "ok": ok,
        "dry_run": dry_run,
        "source_id": resolved_source_id,
        "source": source,
        "source_quality": metadata["source_quality"],
        "source_file": _location_display_name(input_location),
        "source_url": str(input_location) if _is_url(input_location) else None,
        "envelope": resolved_envelope,
        "rows_read": parse_report["rows_read"],
        "rows_accepted": parse_report["rows_accepted"],
        "source_rows_accepted": parse_report["source_rows_accepted"],
        "rows_rejected": parse_report["rows_rejected"],
        "identifier_missing": parse_report["identifier_missing"],
        "partial_source": parse_report["partial_source"],
        "expected_count": parse_report["expected_count"],
        "support_type_counts": parse_report["support_type_counts"],
        "source_quality_counts": parse_report["source_quality_counts"],
        "identifier_state_counts": parse_report["identifier_state_counts"],
        "sample": [asdict(row) for row in accepted[:10]],
        "source_row_sample": [asdict(row) for row in source_rows[:10]],
        "rejected": parse_report["rejected"][:20],
        "write": write_report,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import insurance/PER support universe from source documents or public web sources")
    parser.add_argument("--source", required=True, choices=SUPPORTED_SOURCES, help="Support universe source")
    parser.add_argument("--file", default=None, help="Local PDF/HTML support list")
    parser.add_argument("--url", default=None, help="Public web/PDF URL. Web sources use a default official URL when omitted.")
    parser.add_argument("--source-date", default=None, help="Source date as YYYY-MM-DD")
    parser.add_argument("--envelope", default=None, help="Envelope availability label")
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
            url=args.url,
            source_date=args.source_date,
            envelope=args.envelope,
            dry_run=args.dry_run,
            supabase_client=client,
        )
    except Exception as exc:
        report = {
            "ok": False,
            "dry_run": args.dry_run,
            "source_file": _location_display_name(args.url or args.file) if (args.url or args.file) else None,
            "error": str(exc),
        }
    print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
