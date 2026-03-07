from etl_stats import build_etl_stats


def test_build_etl_stats_keeps_legacy_and_adds_canonical_fields():
    stats = build_etl_stats(
        "bridge_sync",
        {
            "assets_total": 12,
            "status_ok": 7,
            "status_stale": 3,
            "status_low_confidence": 1,
            "status_partial": 1,
            "coverage_pct": 91.236,
        },
        items_total=12,
        items_success=10,
        items_failed=2,
    )

    assert stats["job_name"] == "bridge_sync"
    assert stats["stats_schema_version"] == 1
    assert stats["assets_total"] == 12
    assert stats["items_total"] == 12
    assert stats["items_success"] == 10
    assert stats["items_failed"] == 2
    assert stats["coverage_pct"] == 91.24


def test_build_etl_stats_derives_total_when_missing():
    stats = build_etl_stats(
        "macro_sync",
        {"updated": 3, "failed": 1},
    )

    assert stats["items_success"] == 3
    assert stats["items_failed"] == 1
    assert stats["items_total"] == 4


def test_build_etl_stats_clamps_invalid_values():
    stats = build_etl_stats(
        "historical_prices_sync",
        {"items_total": "-3", "items_success": "5", "coverage_pct": 138},
    )

    assert stats["items_total"] == 0
    assert stats["items_success"] == 5
    assert stats["items_failed"] == 0
    assert stats["coverage_pct"] == 100.0
