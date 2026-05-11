from decimal import Decimal

from broker_ingest.fortuneo import parse_fortuneo_csv, to_idempotency_keys


def test_parse_fortuneo_csv_basic(tmp_path):
    csv_content = """trade_date,settlement_date,side,quantity,price,gross_amount,fees,taxes,net_amount,external_txn_id,currency,symbol,isin,type_operation
2026-05-01,2026-05-05,BUY,10,100.50,-1005.00,1.20,0.00,-1006.20,op-1,EUR,CW8,FR0010756098,BUY
"""
    p = tmp_path / "fortuneo.csv"
    p.write_text(csv_content, encoding="utf-8")

    txs = parse_fortuneo_csv(p, account_id="acct-1", envelope="CTO")

    assert len(txs) == 1
    tx = txs[0]
    assert tx.broker == "FORTUNEO"
    assert tx.side == "BUY"
    assert tx.quantity == Decimal("10")
    assert tx.price == Decimal("100.50")
    assert tx.net_amount == Decimal("-1006.20")
    assert tx.currency == "EUR"
    assert tx.envelope == "CTO"

    keys = to_idempotency_keys(txs)
    assert keys == ["FORTUNEO:acct-1:op-1"]


def test_parse_fortuneo_csv_fallback_net_amount(tmp_path):
    csv_content = """date_operation,date_valeur,sens,quantite,prix_unitaire,montant_brut,frais,taxes,id_operation,devise,ticker
2026-05-02,,SELL,5,102,510,2,1,op-2,EUR,EWLD
"""
    p = tmp_path / "fortuneo_alt.csv"
    p.write_text(csv_content, encoding="utf-8")

    txs = parse_fortuneo_csv(p, account_id="acct-2")
    assert len(txs) == 1
    assert txs[0].settlement_date is None
    assert txs[0].net_amount == Decimal("507")
