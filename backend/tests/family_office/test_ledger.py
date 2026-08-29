from datetime import date
from decimal import Decimal

from family_office.ledger import build_book
from family_office.models import LedgerEvent


def event(
    event_id: str,
    event_type: str,
    cash: str,
    *,
    quantity: str = "0",
    gross: str = "0",
    instrument_id: str | None = None,
    currency: str = "EUR",
    fx: str | None = None,
    event_date: date = date(2026, 1, 2),
) -> LedgerEvent:
    return LedgerEvent(
        id=event_id,
        account_id="account-1",
        portfolio_id="portfolio-1",
        event_type=event_type,
        trade_date=event_date,
        currency=currency,
        cash_amount=Decimal(cash),
        instrument_id=instrument_id,
        quantity=Decimal(quantity),
        gross_amount=Decimal(gross),
        fx_rate_to_eur=Decimal(fx) if fx else None,
    )


def test_book_replays_moving_average_cost_and_cash() -> None:
    book = build_book(
        [
            event("deposit", "DEPOSIT", "1000"),
            event("buy-1", "BUY", "-400", quantity="4", gross="400", instrument_id="asset-1"),
            event("buy-2", "BUY", "-240", quantity="2", gross="240", instrument_id="asset-1"),
            event("sell", "SELL", "260", quantity="2", gross="260", instrument_id="asset-1"),
        ]
    )

    assert book.cash_by_account_currency[("account-1", "EUR")] == Decimal("620")
    assert len(book.positions) == 1
    position = book.positions[0]
    assert position.quantity == Decimal("4")
    expected_average_cost = Decimal("640") / Decimal("6")
    expected_realized_pnl = Decimal("260") - (expected_average_cost * Decimal("2"))
    assert abs(position.average_cost - expected_average_cost) <= Decimal("1e-25")
    assert abs(position.realized_pnl_local - expected_realized_pnl) <= Decimal("1e-25")
    assert abs((position.cost_basis_eur or Decimal("0")) - expected_average_cost * 4) <= Decimal("1e-24")
    assert abs((position.realized_pnl_eur or Decimal("0")) - expected_realized_pnl) <= Decimal("1e-25")
    assert book.external_flows_eur_by_date[date(2026, 1, 2)] == Decimal("1000")


def test_book_exposes_missing_flow_fx_and_negative_position() -> None:
    book = build_book(
        [
            event("deposit-usd", "DEPOSIT", "100", currency="USD"),
            event("sell", "SELL", "100", quantity="1", gross="100", instrument_id="asset-1"),
        ]
    )
    codes = {warning["code"] for warning in book.warnings}
    assert codes == {"FLOW_FX_MISSING", "NEGATIVE_POSITION"}


def test_book_tracks_eur_cost_only_when_trade_fx_is_known() -> None:
    complete = build_book(
        [event("buy-usd", "BUY", "-100", quantity="1", gross="100", instrument_id="asset-1", currency="USD", fx="0.9")]
    )
    incomplete = build_book(
        [event("buy-usd", "BUY", "-100", quantity="1", gross="100", instrument_id="asset-1", currency="USD")]
    )

    assert complete.positions[0].cost_basis_eur == Decimal("90.0")
    assert incomplete.positions[0].cost_basis_eur is None
