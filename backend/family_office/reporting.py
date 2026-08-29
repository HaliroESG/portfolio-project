from __future__ import annotations

import csv
import io
import textwrap
from datetime import date
from typing import Any

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def order_csv(order: dict[str, Any], lines: list[dict[str, Any]]) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["order_id", "instrument", "side", "quantity", "amount_eur", "limit_price", "reason_codes"])
    for line in lines:
        writer.writerow(
            [
                order["id"],
                line.get("instrument_key") or line.get("ticker") or line["instrument_id"],
                line["side"],
                line.get("quantity"),
                line.get("amount_eur"),
                line.get("limit_price"),
                "|".join(line.get("reason_codes") or []),
            ]
        )
    return output.getvalue().encode("utf-8")


def order_pdf(order: dict[str, Any], lines: list[dict[str, Any]]) -> bytes:
    output = io.BytesIO()
    document = canvas.Canvas(output, pagesize=A4)
    width, height = A4
    y = height - 54
    document.setFont("Helvetica-Bold", 16)
    document.drawString(48, y, "Ordre brouillon - Family Office")
    y -= 28
    document.setFont("Helvetica", 9)
    document.drawString(48, y, f"Ordre: {order['id']}")
    y -= 16
    document.drawString(48, y, f"Statut: {order['status']} | Généré le {date.today().isoformat()}")
    y -= 28
    document.setFont("Helvetica-Bold", 9)
    document.drawString(48, y, "Instrument")
    document.drawString(245, y, "Sens")
    document.drawRightString(355, y, "Quantité")
    document.drawRightString(465, y, "Montant EUR")
    document.drawRightString(width - 48, y, "Limite")
    y -= 14
    document.line(48, y, width - 48, y)
    y -= 16
    document.setFont("Helvetica", 8)
    for line in lines:
        if y < 65:
            document.showPage()
            y = height - 54
        instrument = str(line.get("instrument_key") or line.get("ticker") or line["instrument_id"])
        document.drawString(48, y, instrument[:34])
        document.drawString(245, y, str(line["side"]))
        document.drawRightString(355, y, str(line.get("quantity") or "-"))
        document.drawRightString(465, y, str(line.get("amount_eur") or "-"))
        document.drawRightString(width - 48, y, str(line.get("limit_price") or "-"))
        y -= 17
    document.setFont("Helvetica-Oblique", 8)
    document.drawString(48, 36, "Document de préparation uniquement. Aucun ordre n'est transmis au courtier.")
    document.save()
    return output.getvalue()


def _csv_section(writer: Any, title: str, headers: list[str], rows: list[list[Any]]) -> None:
    writer.writerow([])
    writer.writerow([title])
    writer.writerow(headers)
    writer.writerows(rows)


def monthly_close_csv(
    close: dict[str, Any],
    portfolio: dict[str, Any],
    *,
    positions: list[dict[str, Any]],
    cash: list[dict[str, Any]],
    manual_holdings: list[dict[str, Any]],
    performance: list[dict[str, Any]],
    risk: dict[str, Any] | None,
    exceptions: list[dict[str, Any]],
) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["report_type", "FAMILY_OFFICE_MONTHLY_CLOSE"])
    writer.writerow(["portfolio", portfolio["name"]])
    writer.writerow(["period_end", close["period_end"]])
    writer.writerow(["status", close["status"]])
    writer.writerow(["nav_eur", close.get("nav_eur")])
    writer.writerow(["coverage_pct", close.get("coverage_pct")])
    writer.writerow(["generated_on", date.today().isoformat()])

    checks = close.get("checks_json") or {}
    _csv_section(
        writer,
        "CONTROLS",
        ["control", "passed"],
        [[key, bool(value)] for key, value in sorted(checks.items())],
    )
    _csv_section(
        writer,
        "POSITIONS",
        [
            "account_id",
            "instrument_key",
            "name",
            "currency",
            "quantity",
            "average_cost",
            "price_local",
            "market_value_eur",
            "unrealized_pnl_eur",
            "data_state",
            "reconciliation_state",
        ],
        [
            [
                row.get("account_id"),
                row.get("instrument_key"),
                row.get("name"),
                row.get("currency"),
                row.get("quantity"),
                row.get("average_cost"),
                row.get("price_local"),
                row.get("market_value_eur"),
                row.get("unrealized_pnl_eur"),
                row.get("data_state"),
                row.get("reconciliation_state"),
            ]
            for row in positions
        ],
    )
    _csv_section(
        writer,
        "CASH",
        ["account_id", "currency", "balance_local", "fx_rate_to_eur", "balance_eur", "data_state"],
        [
            [
                row.get("account_id"),
                row.get("currency"),
                row.get("balance_local"),
                row.get("fx_rate_to_eur"),
                row.get("balance_eur"),
                row.get("data_state"),
            ]
            for row in cash
        ],
    )
    _csv_section(
        writer,
        "DECLARATIVE_ASSETS_AND_LIABILITIES",
        ["kind", "asset_type", "name", "valuation_date", "value_eur", "confidence", "source"],
        [
            [
                row.get("holding_kind"),
                row.get("asset_type"),
                row.get("name"),
                row.get("valuation_date"),
                row.get("value_eur"),
                row.get("confidence"),
                row.get("source"),
            ]
            for row in manual_holdings
        ],
    )
    _csv_section(
        writer,
        "PERFORMANCE",
        [
            "date",
            "nav_eur",
            "external_flow_eur",
            "twr_daily",
            "twr_mtd",
            "twr_ytd",
            "twr_since_inception",
            "xirr_since_inception",
            "coverage_pct",
            "data_state",
        ],
        [
            [
                row.get("performance_date"),
                row.get("nav_eur"),
                row.get("external_flow_eur"),
                row.get("twr_daily"),
                row.get("twr_mtd"),
                row.get("twr_ytd"),
                row.get("twr_since_inception"),
                row.get("xirr_since_inception"),
                row.get("coverage_pct"),
                row.get("data_state"),
            ]
            for row in performance
        ],
    )
    _csv_section(
        writer,
        "RISK",
        ["metric", "value"],
        [[key, value] for key, value in sorted((risk or {}).items()) if key not in {"id", "owner_user_id"}],
    )
    _csv_section(
        writer,
        "OPEN_EXCEPTIONS_AT_EXPORT",
        ["severity", "exception_type", "title", "status", "detected_at"],
        [
            [
                row.get("severity"),
                row.get("exception_type"),
                row.get("title"),
                row.get("status"),
                row.get("detected_at"),
            ]
            for row in exceptions
        ],
    )
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def _number(value: Any, *, percent: bool = False) -> str:
    if value is None:
        return "--"
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return str(value)
    return f"{numeric * 100:.2f}%" if percent else f"{numeric:,.2f}"


def monthly_close_pdf(
    close: dict[str, Any],
    portfolio: dict[str, Any],
    *,
    positions: list[dict[str, Any]],
    cash: list[dict[str, Any]],
    manual_holdings: list[dict[str, Any]],
    performance: list[dict[str, Any]],
    risk: dict[str, Any] | None,
    exceptions: list[dict[str, Any]],
) -> bytes:
    output = io.BytesIO()
    document = canvas.Canvas(output, pagesize=A4)
    width, height = A4
    y = height - 48

    def ensure_space(required: float = 24) -> None:
        nonlocal y
        if y >= 48 + required:
            return
        document.setFont("Helvetica-Oblique", 7)
        document.drawString(42, 28, "Registre Family Office - document de pilotage, sans transmission d'ordre")
        document.showPage()
        y = height - 48

    def heading(label: str) -> None:
        nonlocal y
        ensure_space(34)
        y -= 8
        document.setFont("Helvetica-Bold", 10)
        document.drawString(42, y, label)
        y -= 6
        document.line(42, y, width - 42, y)
        y -= 14

    def line(label: str, value: Any, *, bold: bool = False) -> None:
        nonlocal y
        ensure_space(18)
        document.setFont("Helvetica", 8)
        document.drawString(42, y, label[:42])
        document.setFont("Helvetica-Bold" if bold else "Helvetica", 8)
        document.drawRightString(width - 42, y, str(value)[:70])
        y -= 14

    document.setFont("Helvetica-Bold", 16)
    document.drawString(42, y, "Cloture mensuelle - Family Office")
    y -= 22
    document.setFont("Helvetica", 9)
    document.drawString(42, y, f"{portfolio['name']} | Periode {close['period_end']} | {close['status']}")
    y -= 25

    heading("Synthese patrimoniale")
    line("Actif net (EUR)", _number(close.get("nav_eur")), bold=True)
    line("Couverture de donnees", f"{_number(close.get('coverage_pct'))}%")
    line("Exceptions ouvertes", close.get("open_exception_count", 0))
    line("Rapprochement", close.get("reconciliation_state", "NOT_CHECKED"))

    latest_performance = performance[-1] if performance else {}
    heading("Performance et risque")
    line("TWR mensuel", _number(latest_performance.get("twr_mtd"), percent=True))
    line("TWR depuis janvier", _number(latest_performance.get("twr_ytd"), percent=True))
    line("XIRR depuis origine", _number(latest_performance.get("xirr_since_inception"), percent=True))
    line("Volatilite 30 jours", f"{_number((risk or {}).get('volatility_30d_pct'))}%")
    line("Drawdown maximum YTD", f"{_number((risk or {}).get('max_drawdown_ytd_pct'))}%")
    line("Premiere position", f"{_number((risk or {}).get('largest_position_pct'))}%")

    heading("Controles de cloture")
    for key, passed in sorted((close.get("checks_json") or {}).items()):
        line(key.replace("_", " ").title(), "OK" if passed else "BLOQUANT", bold=not passed)

    heading(f"Positions liquides ({len(positions)})")
    for row in positions:
        ensure_space(18)
        label = str(row.get("name") or row.get("instrument_key") or "Instrument")
        state = f"{row.get('data_state', '--')}/{row.get('reconciliation_state', '--')}"
        document.setFont("Helvetica", 8)
        document.drawString(42, y, textwrap.shorten(label, width=52, placeholder="..."))
        document.drawRightString(width - 145, y, state[:24])
        document.setFont("Helvetica-Bold", 8)
        document.drawRightString(width - 42, y, f"{_number(row.get('market_value_eur'))} EUR")
        y -= 14

    heading(f"Liquidites ({len(cash)})")
    for row in cash:
        line(
            f"{row.get('currency', '--')} | {row.get('data_state', '--')}",
            f"{_number(row.get('balance_eur'))} EUR",
        )

    heading(f"Actifs et passifs declaratifs ({len(manual_holdings)})")
    for row in manual_holdings:
        line(
            textwrap.shorten(str(row.get("name") or "Actif"), width=44, placeholder="..."),
            f"{_number(row.get('value_eur'))} EUR | {row.get('confidence') or '--'}",
        )

    heading(f"Exceptions ouvertes a l'export ({len(exceptions)})")
    for row in exceptions:
        line(
            f"{row.get('severity', '--')} | {row.get('exception_type', '--')}",
            textwrap.shorten(str(row.get("title") or ""), width=58, placeholder="..."),
        )

    ensure_space(30)
    document.setFont("Helvetica-Oblique", 7)
    document.drawString(42, 28, "Registre Family Office - document de pilotage, sans transmission d'ordre")
    document.save()
    return output.getvalue()
