from trident_screener import FinancialRecord, compute_trident_for_instrument


def build_records(
    *,
    years: range = range(2015, 2026),
    roic_override: float | None = None,
    debt_multiple: float = 1.0,
    interest_coverage: float = 20.0,
) -> list[FinancialRecord]:
    records: list[FinancialRecord] = []
    for index, year in enumerate(years):
        revenue = 100.0 * (1.15 ** index)
        eps = 1.0 * (1.18 ** index)
        gross_profit = revenue * 0.52
        operating_income = revenue * 0.24
        net_income = revenue * 0.19
        free_cash_flow = revenue * 0.16
        target_roic = roic_override if roic_override is not None else 0.24
        invested_capital = operating_income / target_roic
        total_equity = net_income / 0.20
        capital_employed = operating_income / 0.22
        ebitda = operating_income * 1.2
        total_debt = total_equity * 0.2 if debt_multiple <= 1 else total_equity * 0.8
        records.append(
            FinancialRecord(
                instrument_key="csv:pass",
                fiscal_year=year,
                currency="USD",
                revenue=revenue,
                eps_diluted=eps,
                free_cash_flow=free_cash_flow,
                gross_profit=gross_profit,
                operating_income=operating_income,
                net_income=net_income,
                invested_capital=invested_capital,
                total_equity=total_equity,
                capital_employed=capital_employed,
                ebitda=ebitda,
                net_debt=ebitda * debt_multiple,
                interest_expense=operating_income / interest_coverage,
                total_debt=total_debt,
                shares_diluted=100.0 - index,
            )
        )
    return records


def criterion_rows(result, horizon: int, key: str):
    return [
        row
        for row in result.criterion_rows
        if row["horizon_years"] == horizon and row["criterion_key"] == key
    ]


def test_complete_company_passes_trident():
    result = compute_trident_for_instrument("csv:pass", build_records())

    assert result.result_row["overall_state"] == "PASS"
    assert result.result_row["score"] == 100
    assert result.result_row["confidence"] == 100
    assert result.result_row["horizons"]["10"]["status"] == "complete"
    assert criterion_rows(result, 10, "roic")[0]["status"] == "pass"


def test_partial_data_keeps_missing_visible_without_frontend_guessing():
    result = compute_trident_for_instrument("csv:partial", build_records(years=range(2025, 2026)))

    assert result.result_row["overall_state"] == "PARTIAL"
    assert result.result_row["confidence"] < 100
    assert result.result_row["horizons"]["3"]["status"] == "missing"
    assert criterion_rows(result, 3, "revenue_cagr")[0]["status"] == "missing"


def test_roic_failure_is_eliminating():
    result = compute_trident_for_instrument("csv:low-roic", build_records(roic_override=0.08))

    assert result.result_row["overall_state"] == "FAIL"
    assert "roic" in result.result_row["failed_eliminators"]
    roic_rows = criterion_rows(result, 5, "roic")
    assert roic_rows[0]["status"] == "fail"
    assert roic_rows[0]["is_eliminating"] is True


def test_highly_indebted_company_fails_health_criteria():
    result = compute_trident_for_instrument(
        "csv:debt",
        build_records(debt_multiple=4.2, interest_coverage=6.0),
    )

    assert result.result_row["overall_state"] == "FAIL"
    assert result.result_row["latest_net_debt_to_ebitda"] > 3
    assert criterion_rows(result, 1, "net_debt_to_ebitda")[0]["status"] == "fail"
    assert criterion_rows(result, 1, "interest_coverage")[0]["status"] == "fail"
    assert criterion_rows(result, 1, "debt_to_equity")[0]["status"] == "fail"
