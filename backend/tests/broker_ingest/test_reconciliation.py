from datetime import date
from decimal import Decimal

from broker_ingest.models import CanonicalTransaction
from broker_ingest.reconciliation import (
    BrokerPosition,
    build_reconciliation_report,
    parse_broker_positions_csv,
)


def _tx(
    side: str,
    quantity: str,
    net_amount: str,
    symbol: str = "CW8",
    isin: str = "FR0010756098",
) -> CanonicalTransaction:
    return CanonicalTransaction(
        broker="FORTUNEO",
        account_id="acct-1",
        external_txn_id=f"{side}-{quantity}-{net_amount}",
        trade_date=date(2026, 5, 10),
        settlement_date=None,
        symbol=symbol,
        isin=isin,
        side=side,
        quantity=Decimal(quantity),
        price=None,
        gross_amount=Decimal(net_amount),
        fees=Decimal("0"),
        taxes=Decimal("0"),
        net_amount=Decimal(net_amount),
        currency="EUR",
        envelope="CTO",
        raw_type=side,
    )


def test_build_reconciliation_report_rolls_up_ledger_without_snapshot():
    report = build_reconciliation_report([
        _tx("BUY", "10", "-1000"),
        _tx("SELL", "3", "330"),
        _tx("DIVIDEND", "0", "5"),
    ])

    assert report["mode"] == "ledger_rollup"
    assert report["ignored_transaction_count"] == 1
    assert report["state_counts"] == {}
    assert report["positions"][0]["ledger_quantity"] == "7"
    assert report["positions"][0]["ledger_average_cost"] == "100"


def test_build_reconciliation_report_compares_snapshot_states():
    transactions = [
        _tx("BUY", "10", "-1000"),
        _tx("BUY", "5", "-250", symbol="EWLD", isin="FR0011869353"),
    ]

    report = build_reconciliation_report(
        transactions,
        [
            BrokerPosition(
                symbol="CW8",
                isin="FR0010756098",
                quantity=Decimal("10"),
                average_cost=Decimal("100"),
                currency="EUR",
            ),
            BrokerPosition(
                symbol="EWLD",
                isin="FR0011869353",
                quantity=Decimal("5"),
                average_cost=Decimal("51"),
                currency="EUR",
            ),
            BrokerPosition(
                symbol="QQQ",
                isin="US46090E1038",
                quantity=Decimal("2"),
                average_cost=Decimal("450"),
                currency="USD",
            ),
        ],
    )

    assert report["mode"] == "broker_snapshot"
    assert report["state_counts"]["MATCH"] == 1
    assert report["state_counts"]["MISMATCH_COST"] == 1
    assert report["state_counts"]["MISSING_IN_LEDGER"] == 1


def test_build_reconciliation_report_detects_quantity_mismatch_and_ledger_only():
    report = build_reconciliation_report(
        [_tx("BUY", "10", "-1000")],
        [
            BrokerPosition(
                symbol="CW8",
                isin="FR0010756098",
                quantity=Decimal("9"),
                average_cost=Decimal("100"),
                currency="EUR",
            )
        ],
    )

    assert report["state_counts"]["MISMATCH_QTY"] == 1
    assert report["positions"][0]["quantity_delta"] == "1"
    assert report["ledger_only"] == []

    ledger_only_report = build_reconciliation_report(
        [_tx("BUY", "10", "-1000", symbol="EWLD", isin="FR0011869353")],
        [
            BrokerPosition(
                symbol="CW8",
                isin="FR0010756098",
                quantity=Decimal("0"),
                average_cost=None,
                currency="EUR",
            )
        ],
    )
    assert ledger_only_report["ledger_only"][0]["instrument_key"] == "isin:FR0011869353"


def test_parse_broker_positions_csv_accepts_common_headers(tmp_path):
    csv_content = """ticker,isin,quantity_current,pru,devise
CW8,FR0010756098,10,100.50,EUR
"""
    path = tmp_path / "positions.csv"
    path.write_text(csv_content, encoding="utf-8")

    positions = parse_broker_positions_csv(path)

    assert len(positions) == 1
    assert positions[0].symbol == "CW8"
    assert positions[0].quantity == Decimal("10")
    assert positions[0].average_cost == Decimal("100.50")
    assert positions[0].currency == "EUR"
