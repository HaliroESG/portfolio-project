from decimal import Decimal

from broker_ingest.ibkr import parse_ibkr_trades_csv


def test_parse_ibkr_trades_csv_basic(tmp_path):
    csv_content = """TradeDate,SettleDate,Buy/Sell,Quantity,TradePrice,Proceeds,Comm/Fee,Tax,TradeID,Currency,Symbol,ISIN,AssetClass
2026-05-03,2026-05-06,BUY,3,450.25,-1350.75,-1.25,0,ib-1,USD,QQQ,US46090E1038,STK
"""
    p = tmp_path / "ibkr.csv"
    p.write_text(csv_content, encoding="utf-8")

    txs = parse_ibkr_trades_csv(p, account_id="ib-acct", envelope="CTO")

    assert len(txs) == 1
    tx = txs[0]
    assert tx.broker == "IBKR"
    assert tx.external_txn_id == "ib-1"
    assert tx.side == "BUY"
    assert tx.quantity == Decimal("3")
    assert tx.price == Decimal("450.25")
    assert tx.fees == Decimal("1.25")
    assert tx.net_amount == Decimal("-1352.00")
    assert tx.currency == "USD"
    assert tx.envelope == "CTO"
