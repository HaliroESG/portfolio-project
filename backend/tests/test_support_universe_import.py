from __future__ import annotations

from scripts.import_support_universe import (
    _is_valid_isin,
    _parse_linxea_candidate,
    _parse_support_line,
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


def test_support_import_rejects_unsupported_source(tmp_path):
    source = tmp_path / "empty.pdf"
    source.write_bytes(b"%PDF-1.4\n%%EOF")

    try:
        run_import(source, source="unknown", dry_run=True)
    except RuntimeError as exc:
        assert "Unsupported --source" in str(exc)
    else:
        raise AssertionError("unsupported source should fail")
