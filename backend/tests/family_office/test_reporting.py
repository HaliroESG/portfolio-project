from pydantic import ValidationError

from api import OrderLineRequest, health
from family_office.reporting import monthly_close_csv, monthly_close_pdf


def monthly_payload() -> dict:
    return {
        "close": {
            "period_end": "2026-06-30",
            "status": "CLOSED",
            "nav_eur": 125000,
            "coverage_pct": 100,
            "open_exception_count": 0,
            "reconciliation_state": "MATCH",
            "checks_json": {"coverage_ready": True, "critical_exceptions_clear": True},
        },
        "portfolio": {"name": "Patrimoine familial"},
        "positions": [
            {
                "account_id": "account-1",
                "instrument_key": "FR0000000001",
                "name": "Quality Equity",
                "currency": "EUR",
                "quantity": 10,
                "market_value_eur": 10000,
                "data_state": "READY",
                "reconciliation_state": "MATCH",
            }
        ],
        "cash": [
            {
                "account_id": "account-1",
                "currency": "EUR",
                "balance_local": 5000,
                "balance_eur": 5000,
                "data_state": "READY",
            }
        ],
        "manual_holdings": [],
        "performance": [
            {
                "performance_date": "2026-06-30",
                "nav_eur": 125000,
                "external_flow_eur": 0,
                "twr_mtd": 0.01,
                "twr_ytd": 0.04,
                "xirr_since_inception": 0.05,
                "coverage_pct": 100,
                "data_state": "READY",
            }
        ],
        "risk": {
            "risk_date": "2026-06-30",
            "volatility_30d_pct": 8.2,
            "max_drawdown_ytd_pct": -3.1,
            "largest_position_pct": 12.5,
        },
        "exceptions": [],
    }


def test_monthly_close_exports_include_controls_and_positions() -> None:
    payload = monthly_payload()
    csv_content = monthly_close_csv(payload.pop("close"), payload.pop("portfolio"), **payload)
    decoded = csv_content.decode("utf-8-sig")

    assert "FAMILY_OFFICE_MONTHLY_CLOSE" in decoded
    assert "CONTROLS" in decoded
    assert "Quality Equity" in decoded


def test_monthly_close_pdf_is_a_valid_pdf() -> None:
    payload = monthly_payload()
    pdf_content = monthly_close_pdf(payload.pop("close"), payload.pop("portfolio"), **payload)

    assert pdf_content.startswith(b"%PDF")
    assert len(pdf_content) > 1000


def test_order_line_requires_quantity_or_amount() -> None:
    try:
        OrderLineRequest(instrument_id="instrument-1", side="BUY")
    except ValidationError:
        pass
    else:
        raise AssertionError("Order line without quantity or amount must be rejected")

    assert OrderLineRequest(
        instrument_id="instrument-1", side="BUY", amount_eur=1000
    ).amount_eur == 1000


def test_health_contract() -> None:
    assert health() == {"status": "ok", "service": "family-office-command-api"}
