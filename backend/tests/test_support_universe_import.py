from __future__ import annotations

from scripts.import_support_universe import (
    _is_valid_isin,
    _parse_linxea_candidate,
    _parse_support_line,
    parse_fortuneo_perfsupport_text,
    parse_linxea_web_html,
    run_import,
)


def test_parse_lucya_cardif_support_line_extracts_etf_metrics():
    line = (
        "LU0496786574 AMUNDI CORE S&P 500 SWAP UCITS ETF Dist ETF "
        "AMUNDI ASSET MANAGEMENT 5 NC NC 0,05% (dont 0,00%) "
        "4,06% 15,59% 0,50% 0,55% (dont 0,00%) 3,54% 15,01%"
    )

    row = _parse_support_line(line, page=7, source_id="lucya-cardif:2026-02-01")

    assert row is not None
    assert row.isin == "LU0496786574"
    assert row.support_type == "ETF"
    assert row.sri == 5
    assert row.asset_fee_pct == 0.05
    assert row.contract_fee_pct == 0.5
    assert row.total_fee_pct == 0.55
    assert row.performance_5y_pct == 15.59
    assert row.metrics_state == "METRICS_UNAVAILABLE"
    assert row.morningstar_rating is None
    assert row.quantalys_rating is None


def test_isin_validation_rejects_words_and_accepts_offshore_prefixes():
    assert _is_valid_isin("LU0496786574")
    assert _is_valid_isin("BMG0112X1056")
    assert not _is_valid_isin("AGRIBUSINESS")
    assert not _is_valid_isin("LU0496786575")


def test_parse_linxea_candidate_creates_identifier_missing_source_row():
    row = _parse_linxea_candidate(
        "Amundi Core S&P 500 Swap ETF EUR Dist 10.81% 102.22%",
        source_id="linxea-funds:2026-05-26",
        envelope="Linxea",
        page=4,
    )

    assert row is not None
    assert row.isin is None
    assert row.name == "Amundi Core S&P 500 Swap ETF EUR Dist"
    assert row.support_type == "ETF"
    assert row.performance_1y_pct == 10.81
    assert row.performance_5y_pct == 102.22
    assert row.source_quality == "IDENTIFIER_MISSING"
    assert row.identifier_state == "IDENTIFIER_MISSING"


def test_parse_linxea_web_html_extracts_partial_isin_rows():
    html = """
    <table>
      <tr>
        <td>6</td><td>Allianz Valeurs Durables RC</td><td>FR0000017329</td>
        <td>Oui</td><td></td><td></td><td></td><td></td>
        <td>Allianz Global Investors GmbH</td>
        <td>Actions Zone Euro Grandes Cap.</td>
        <td>13/10/2014</td><td>6</td>
      </tr>
    </table>
    """

    report = parse_linxea_web_html(html, source_id="linxea-web:undated", envelope="Linxea")

    assert report["rows_accepted"] == 1
    assert report["source_rows_accepted"] == 1
    assert report["source_quality"] == "PARTIAL"
    row = report["accepted"][0]
    assert row.isin == "FR0000017329"
    assert row.name == "Allianz Valeurs Durables RC"
    assert row.manager == "Allianz Global Investors GmbH"
    assert row.sri == 6


def test_parse_fortuneo_web_text_extracts_full_contract_metrics():
    text = (
        "FR0010032326 Allianz Euro High Yield RC Allianz Global Investors GmbH "
        "2 5.24% 3.90% 0.96% (dont 0.32%) 4.28% 2.94% 0.75% "
        "1.71% (dont 0.32%) 3.53% 2.19%"
    )

    report = parse_fortuneo_perfsupport_text(text, source_id="fortuneo-av-web:undated")

    assert report["rows_accepted"] == 1
    assert report["source_rows_accepted"] == 0
    row = report["accepted"][0]
    assert row.isin == "FR0010032326"
    assert row.sri == 2
    assert row.performance_1y_pct == 5.24
    assert row.performance_5y_pct == 3.90
    assert row.contract_fee_pct == 0.75
    assert row.total_fee_pct == 1.71


def test_support_import_rejects_unsupported_source(tmp_path):
    source = tmp_path / "empty.pdf"
    source.write_bytes(b"%PDF-1.4\n%%EOF")

    try:
        run_import(source, source="unknown", dry_run=True)
    except RuntimeError as exc:
        assert "Unsupported --source" in str(exc)
    else:
        raise AssertionError("unsupported source should fail")
