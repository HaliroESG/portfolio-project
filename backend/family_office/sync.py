from __future__ import annotations

from bisect import bisect_right
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Iterable

from .analytics import calculate_performance_series, calculate_risk_snapshot
from .ledger import build_book
from .models import DailyValuation, LedgerEvent, ZERO
from .repository import FamilyOfficeRepository


def _decimal(value: Any) -> Decimal:
    if value in (None, ""):
        return ZERO
    return Decimal(str(value))


def _optional_decimal(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    return Decimal(str(value))


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ledger_events(rows: Iterable[dict[str, Any]], account_portfolios: dict[str, str]) -> list[LedgerEvent]:
    events: list[LedgerEvent] = []
    for row in rows:
        account_id = str(row["account_id"])
        events.append(
            LedgerEvent(
                id=str(row["id"]),
                account_id=account_id,
                portfolio_id=account_portfolios[account_id],
                event_type=str(row["event_type"]),
                trade_date=date.fromisoformat(str(row["trade_date"])),
                currency=str(row["currency"]),
                cash_amount=_decimal(row["cash_amount"]),
                instrument_id=str(row["instrument_id"]) if row.get("instrument_id") else None,
                quantity=_decimal(row.get("quantity")),
                unit_price=_optional_decimal(row.get("unit_price")),
                gross_amount=_decimal(row.get("gross_amount")),
                fees=_decimal(row.get("fees")),
                taxes=_decimal(row.get("taxes")),
                fx_rate_to_eur=_optional_decimal(row.get("fx_rate_to_eur")),
                created_at=str(row.get("created_at") or ""),
            )
        )
    return events


def _latest_on_or_before(
    points: dict[str, list[tuple[date, Decimal]]],
    key: str,
    target_date: date,
    *,
    max_age_days: int = 7,
) -> tuple[Decimal | None, date | None]:
    series = points.get(key, [])
    if not series:
        return None, None
    dates = [point_date for point_date, _ in series]
    index = bisect_right(dates, target_date) - 1
    if index < 0:
        return None, None
    point_date, value = series[index]
    if (target_date - point_date).days > max_age_days:
        return None, point_date
    return value, point_date


def _load_market_history(
    repository: FamilyOfficeRepository,
    tickers: list[str],
    start_date: date,
) -> tuple[
    dict[str, list[tuple[date, Decimal]]],
    dict[str, list[tuple[date, Decimal]]],
    dict[str, list[tuple[date, Decimal]]],
]:
    if not tickers:
        return {}, {}, {}
    rows: list[dict[str, Any]] = []
    # PostgREST responses are capped; query one ticker at a time for deterministic pagination.
    for ticker in tickers:
        offset = 0
        while True:
            query = (
                repository.client.table("historical_prices")
                .select("ticker,date,adj_close,adj_close_local,local_currency,fx_rate_to_eur")
                .eq("ticker", ticker)
                .gte("date", start_date.isoformat())
                .order("date")
                .range(offset, offset + 999)
            )
            page = list(query.execute().data or [])
            rows.extend(page)
            if len(page) < 1000:
                break
            offset += 1000
    eur_history: dict[str, list[tuple[date, Decimal]]] = {}
    local_history: dict[str, list[tuple[date, Decimal]]] = {}
    fx_by_currency_date: dict[str, dict[date, Decimal]] = {}
    for row in rows:
        if row.get("adj_close") is None:
            continue
        ticker = str(row["ticker"]).upper()
        point_date = date.fromisoformat(str(row["date"]))
        eur_value = _decimal(row["adj_close"])
        eur_history.setdefault(ticker, []).append((point_date, eur_value))
        currency = str(row.get("local_currency") or "").upper()
        local_value = _optional_decimal(row.get("adj_close_local"))
        fx_rate = _optional_decimal(row.get("fx_rate_to_eur"))
        if currency == "EUR":
            local_value = local_value or eur_value
            fx_rate = Decimal("1")
        if local_value is not None:
            local_history.setdefault(ticker, []).append((point_date, local_value))
        if currency and fx_rate is not None:
            fx_by_currency_date.setdefault(currency, {}).setdefault(point_date, fx_rate)
    fx_history = {
        currency: sorted(points.items())
        for currency, points in fx_by_currency_date.items()
    }
    return eur_history, local_history, fx_history


def _parse_timestamp_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None


def _events_with_fx(
    events: list[LedgerEvent],
    fx_history: dict[str, list[tuple[date, Decimal]]],
    current_fx: dict[str, tuple[Decimal | None, date | None]],
    target_date: date,
) -> list[LedgerEvent]:
    enriched: list[LedgerEvent] = []
    for event in events:
        if event.currency == "EUR" and event.fx_rate_to_eur is None:
            enriched.append(replace(event, fx_rate_to_eur=Decimal("1")))
            continue
        if event.fx_rate_to_eur is not None:
            enriched.append(event)
            continue
        rate, _ = _latest_on_or_before(fx_history, event.currency, event.trade_date)
        if rate is None and event.trade_date == target_date:
            rate = current_fx.get(event.currency, (None, None))[0]
        enriched.append(replace(event, fx_rate_to_eur=rate) if rate is not None else event)
    return enriched


def _date_range(start_date: date, end_date: date) -> list[date]:
    return [start_date + timedelta(days=offset) for offset in range((end_date - start_date).days + 1)]


def _latest_reconciliation_status(
    repository: FamilyOfficeRepository,
    account_ids: list[str],
) -> dict[str, tuple[date, str]]:
    latest: dict[str, tuple[date, str]] = {}
    for account_id in account_ids:
        row = repository.first(
            "fo_reconciliation_runs",
            "account_id,reconciliation_date,status",
            filters={"account_id": account_id},
            order="reconciliation_date",
            descending=True,
        )
        if row:
            latest[account_id] = (date.fromisoformat(str(row["reconciliation_date"])), str(row["status"]))
    return latest


def _sync_exception(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    portfolio_id: str,
    exception_type: str,
    severity: str,
    title: str,
    source_ref: str,
    details: dict[str, Any],
) -> None:
    existing = repository.first(
        "fo_exceptions",
        filters={"owner_user_id": owner_user_id, "exception_type": exception_type, "source_ref": source_ref},
    )
    if existing:
        repository.update(
            "fo_exceptions",
            {"severity": severity, "status": "OPEN", "title": title, "details": details, "resolved_at": None},
            filters={"id": existing["id"]},
        )
        return
    repository.insert(
        "fo_exceptions",
        {
            "owner_user_id": owner_user_id,
            "portfolio_id": portfolio_id,
            "exception_type": exception_type,
            "severity": severity,
            "title": title,
            "source_ref": source_ref,
            "details": details,
        },
    )


def _resolve_exception(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    exception_type: str,
    source_ref: str,
) -> None:
    existing = repository.first(
        "fo_exceptions",
        filters={
            "owner_user_id": owner_user_id,
            "exception_type": exception_type,
            "source_ref": source_ref,
        },
    )
    if existing and existing.get("status") in {"OPEN", "ACKNOWLEDGED"}:
        repository.update(
            "fo_exceptions",
            {"status": "RESOLVED", "resolved_at": _iso_now()},
            filters={"id": existing["id"]},
        )


def _manual_valuation_history(
    repository: FamilyOfficeRepository,
    portfolio_id: str,
) -> tuple[list[dict[str, Any]], dict[str, list[tuple[date, Decimal]]]]:
    holdings = repository.select(
        "fo_manual_holdings", filters={"portfolio_id": portfolio_id, "status": "ACTIVE"}
    )
    history: dict[str, list[tuple[date, Decimal]]] = {}
    for holding in holdings:
        holding_id = str(holding["id"])
        rows = repository.select(
            "fo_manual_valuations",
            "valuation_date,value_eur",
            filters={"holding_id": holding_id},
            order="valuation_date",
        )
        history[holding_id] = [
            (date.fromisoformat(str(row["valuation_date"])), _decimal(row["value_eur"]))
            for row in rows
        ]
    return holdings, history


def rebuild_portfolio(
    repository: FamilyOfficeRepository,
    *,
    owner_user_id: str,
    portfolio_id: str,
    as_of_date: date | None = None,
) -> dict[str, Any]:
    target_date = as_of_date or date.today()
    portfolio = repository.first(
        "fo_portfolios", filters={"id": portfolio_id, "owner_user_id": owner_user_id}
    )
    if portfolio is None:
        raise ValueError("Unknown portfolio")
    accounts = repository.select("fo_accounts", filters={"portfolio_id": portfolio_id, "status": "ACTIVE"})
    account_ids = [str(account["id"]) for account in accounts]
    account_portfolios = {str(account["id"]): portfolio_id for account in accounts}
    ledger_rows: list[dict[str, Any]] = []
    for account_id in account_ids:
        ledger_rows.extend(
            repository.select(
                "fo_ledger_entries",
                filters={"account_id": account_id},
                order="trade_date",
            )
        )
    events = _ledger_events(ledger_rows, account_portfolios)
    instruments = repository.select("fo_instruments")
    instrument_by_id = {str(row["id"]): row for row in instruments}
    tickers = sorted(
        {
            str(row["ticker"]).upper()
            for row in instruments
            if row.get("ticker") and any(event.instrument_id == str(row["id"]) for event in events)
        }
    )
    manual_holdings, manual_history = _manual_valuation_history(repository, portfolio_id)
    source_dates = [event.trade_date for event in events]
    source_dates.extend(
        point_date
        for points in manual_history.values()
        for point_date, _ in points
    )
    start_date = min(source_dates, default=target_date)
    price_history, local_price_history, fx_history = _load_market_history(
        repository, tickers, start_date
    )
    currencies = repository.select("currencies", "id,rate_to_eur,last_update")
    current_fx = {
        str(row["id"]).upper(): (
            _optional_decimal(row.get("rate_to_eur")),
            _parse_timestamp_date(row.get("last_update")),
        )
        for row in currencies
    }
    current_fx["EUR"] = (Decimal("1"), target_date)
    events = _events_with_fx(events, fx_history, current_fx, target_date)
    reconciliation = _latest_reconciliation_status(repository, account_ids)

    valuations: list[DailyValuation] = []
    latest_position_payloads: list[dict[str, Any]] = []
    latest_cash_payloads: list[dict[str, Any]] = []
    latest_position_values: list[Decimal] = []
    latest_fx_exposed = ZERO
    latest_manual_assets = ZERO
    latest_manual_liabilities = ZERO

    for valuation_date in _date_range(start_date, target_date):
        day_events = [event for event in events if event.trade_date <= valuation_date]
        book = build_book(day_events)
        known_value = ZERO
        missing_positions = 0
        partial_positions = 0
        day_position_payloads: list[dict[str, Any]] = []
        for position in book.positions:
            instrument = instrument_by_id.get(position.instrument_id)
            ticker = str(instrument.get("ticker") or "").upper() if instrument else ""
            price_eur, price_date = _latest_on_or_before(price_history, ticker, valuation_date)
            local_price, _ = _latest_on_or_before(local_price_history, ticker, valuation_date)
            instrument_currency = str(instrument.get("currency") or "") if instrument else ""
            fx_rate, fx_date = _latest_on_or_before(fx_history, instrument_currency, valuation_date)
            if instrument_currency == "EUR":
                local_price = local_price or price_eur
                fx_rate = Decimal("1")
                fx_date = price_date
            market_value = position.quantity * price_eur if price_eur is not None else None
            if market_value is None:
                missing_positions += 1
            else:
                known_value += market_value
            recon_date, recon_status = reconciliation.get(position.account_id, (valuation_date, "NOT_CHECKED"))
            is_reconciled = recon_status == "MATCH" and recon_date <= valuation_date
            position_partial = (
                position.cost_basis_eur is None
                or (instrument_currency != "EUR" and (local_price is None or fx_rate is None))
            )
            if position_partial and market_value is not None:
                partial_positions += 1
            if market_value is None:
                data_state = "MISSING"
            elif not is_reconciled:
                data_state = "UNRECONCILED"
            elif position_partial:
                data_state = "PARTIAL"
            else:
                data_state = "READY"
            unrealized_pnl = (
                market_value - position.cost_basis_eur
                if market_value is not None and position.cost_basis_eur is not None
                else None
            )
            day_position_payloads.append(
                {
                    "owner_user_id": owner_user_id,
                    "portfolio_id": portfolio_id,
                    "account_id": position.account_id,
                    "instrument_id": position.instrument_id,
                    "snapshot_date": valuation_date.isoformat(),
                    "quantity": str(position.quantity),
                    "average_cost": str(position.average_cost) if position.average_cost is not None else None,
                    "cost_basis_eur": str(position.cost_basis_eur) if position.cost_basis_eur is not None else None,
                    "price_local": str(local_price) if local_price is not None else None,
                    "fx_rate_to_eur": str(fx_rate) if fx_rate is not None else None,
                    "market_value_eur": str(market_value) if market_value is not None else None,
                    "unrealized_pnl_eur": str(unrealized_pnl) if unrealized_pnl is not None else None,
                    "data_state": data_state,
                    "price_as_of": price_date.isoformat() if price_date else None,
                    "fx_as_of": fx_date.isoformat() if fx_date else None,
                    "reconciliation_state": recon_status,
                    "calculated_at": _iso_now(),
                }
            )

        cash_eur = ZERO
        day_cash_payloads: list[dict[str, Any]] = []
        cash_missing_fx = False
        cash_partial_fx = False
        for (account_id, currency), balance in book.cash_by_account_currency.items():
            fx_rate, fx_date = _latest_on_or_before(fx_history, currency, valuation_date)
            fx_state = "READY"
            if currency == "EUR":
                fx_rate, fx_date = Decimal("1"), valuation_date
            elif fx_rate is None and valuation_date == target_date:
                fx_rate, fx_date = current_fx.get(currency, (None, None))
                if fx_rate is not None:
                    fx_state = "STALE" if fx_date is None or (valuation_date - fx_date).days > 7 else "READY"
            balance_eur = balance * fx_rate if fx_rate is not None else None
            if balance_eur is None:
                cash_missing_fx = True
            else:
                cash_eur += balance_eur
                if fx_state != "READY":
                    cash_partial_fx = True
            day_cash_payloads.append(
                {
                    "owner_user_id": owner_user_id,
                    "portfolio_id": portfolio_id,
                    "account_id": account_id,
                    "balance_date": valuation_date.isoformat(),
                    "currency": currency,
                    "balance_local": str(balance),
                    "fx_rate_to_eur": str(fx_rate) if fx_rate is not None else None,
                    "balance_eur": str(balance_eur) if balance_eur is not None else None,
                    "data_state": fx_state if fx_rate is not None else "MISSING",
                    "calculated_at": _iso_now(),
                }
            )

        manual_assets = ZERO
        manual_liabilities = ZERO
        manual_missing = 0
        manual_stale = 0
        for holding in manual_holdings:
            holding_id = str(holding["id"])
            value_eur, _ = _latest_on_or_before(
                manual_history, holding_id, valuation_date, max_age_days=100_000
            )
            if value_eur is None:
                manual_missing += 1
                continue
            next_valuation_date = (
                date.fromisoformat(str(holding["next_valuation_date"]))
                if holding.get("next_valuation_date")
                else None
            )
            if valuation_date == target_date and next_valuation_date and next_valuation_date < target_date:
                manual_stale += 1
            if holding["holding_kind"] == "ASSET":
                manual_assets += value_eur
            else:
                manual_liabilities += value_eur

        expected_items = (
            len(book.positions)
            + len(book.cash_by_account_currency)
            + len(manual_holdings)
        )
        missing_items = missing_positions + (1 if cash_missing_fx else 0) + manual_missing
        partial_items = partial_positions + (1 if cash_partial_fx else 0) + manual_stale
        coverage_pct = (
            Decimal("0")
            if expected_items == 0
            else (
                Decimal(max(0, expected_items - missing_items - partial_items))
                / Decimal(expected_items)
                * Decimal("100")
            )
        )
        all_reconciled = all(
            reconciliation.get(account_id, (valuation_date, "NOT_CHECKED"))[1] == "MATCH"
            and reconciliation.get(account_id, (valuation_date, "NOT_CHECKED"))[0] <= valuation_date
            for account_id in account_ids
        )
        nav = known_value + cash_eur + manual_assets - manual_liabilities
        nav_value: Decimal | None = nav if expected_items > 0 and missing_items == 0 else None
        valuations.append(
            DailyValuation(
                valuation_date=valuation_date,
                nav_eur=nav_value,
                external_flow_eur=book.external_flows_eur_by_date.get(valuation_date, ZERO),
                coverage_pct=coverage_pct,
                reconciled=all_reconciled,
            )
        )
        if valuation_date == target_date:
            latest_position_payloads = day_position_payloads
            latest_cash_payloads = day_cash_payloads
            latest_position_values = [
                _decimal(payload["market_value_eur"])
                for payload in day_position_payloads
                if payload.get("market_value_eur") is not None
            ]
            latest_fx_exposed = sum(
                (
                    _decimal(payload["market_value_eur"])
                    for payload in day_position_payloads
                    if payload.get("market_value_eur") is not None
                    and instrument_by_id.get(str(payload["instrument_id"]), {}).get("currency") != "EUR"
                ),
                ZERO,
            )
            latest_manual_assets = manual_assets
            latest_manual_liabilities = manual_liabilities

    if latest_position_payloads:
        repository.upsert_many(
            "fo_position_snapshots",
            latest_position_payloads,
            "account_id,instrument_id,snapshot_date",
        )
    if latest_cash_payloads:
        repository.upsert_many(
            "fo_cash_balances_daily",
            latest_cash_payloads,
            "account_id,currency,balance_date",
        )

    performance = calculate_performance_series(valuations)
    performance_rows = [
        {
            "owner_user_id": owner_user_id,
            "portfolio_id": portfolio_id,
            "performance_date": point.performance_date.isoformat(),
            "nav_eur": str(point.nav_eur) if point.nav_eur is not None else None,
            "external_flow_eur": str(point.external_flow_eur),
            "twr_daily": str(point.twr_daily) if point.twr_daily is not None else None,
            "twr_mtd": str(point.twr_mtd) if point.twr_mtd is not None else None,
            "twr_ytd": str(point.twr_ytd) if point.twr_ytd is not None else None,
            "twr_since_inception": str(point.twr_since_inception) if point.twr_since_inception is not None else None,
            "xirr_since_inception": str(point.xirr_since_inception) if point.xirr_since_inception is not None else None,
            "coverage_pct": str(point.coverage_pct),
            "data_state": point.data_state,
            "calculated_at": _iso_now(),
        }
        for point in performance
    ]
    if performance_rows:
        repository.upsert_many("fo_performance_daily", performance_rows, "portfolio_id,performance_date")

    latest_cash_eur = sum(
        (_decimal(payload["balance_eur"]) for payload in latest_cash_payloads if payload.get("balance_eur") is not None),
        ZERO,
    )
    nav_history = [
        (valuation.valuation_date, valuation.nav_eur)
        for valuation in valuations
        if valuation.nav_eur is not None
    ]
    risk = calculate_risk_snapshot(
        nav_history,
        latest_position_values,
        latest_cash_eur,
        latest_manual_assets,
        latest_fx_exposed,
    )
    latest_performance = performance[-1] if performance else None
    risk_row = {
        "owner_user_id": owner_user_id,
        "portfolio_id": portfolio_id,
        "risk_date": target_date.isoformat(),
        **{key: str(value) if value is not None else None for key, value in risk.items()},
        "data_state": latest_performance.data_state if latest_performance else "MISSING",
        "details": {"position_count": len(latest_position_values)},
        "calculated_at": _iso_now(),
    }
    repository.upsert_many("fo_risk_daily", [risk_row], "portfolio_id,risk_date")

    for payload in latest_position_payloads:
        source_ref = f"position:{payload['account_id']}:{payload['instrument_id']}"
        if payload["data_state"] == "MISSING":
            instrument = instrument_by_id.get(str(payload["instrument_id"]), {})
            _sync_exception(
                repository,
                owner_user_id=owner_user_id,
                portfolio_id=portfolio_id,
                exception_type="PRICE_MISSING",
                severity="CRITICAL",
                title=f"Prix manquant : {instrument.get('name') or instrument.get('ticker') or payload['instrument_id']}",
                source_ref=source_ref,
                details={"snapshot_date": target_date.isoformat(), "ticker": instrument.get("ticker")},
            )
        else:
            _resolve_exception(
                repository,
                owner_user_id=owner_user_id,
                exception_type="PRICE_MISSING",
                source_ref=source_ref,
            )
        if payload["data_state"] == "PARTIAL" and payload.get("cost_basis_eur") is None:
            _sync_exception(
                repository,
                owner_user_id=owner_user_id,
                portfolio_id=portfolio_id,
                exception_type="COST_BASIS_FX_MISSING",
                severity="WARNING",
                title="PRU EUR incomplet",
                source_ref=source_ref,
                details={"snapshot_date": target_date.isoformat()},
            )
        else:
            _resolve_exception(
                repository,
                owner_user_id=owner_user_id,
                exception_type="COST_BASIS_FX_MISSING",
                source_ref=source_ref,
            )
    for payload in latest_cash_payloads:
        source_ref = f"cash:{payload['account_id']}:{payload['currency']}"
        if payload["data_state"] in {"MISSING", "STALE"}:
            _sync_exception(
                repository,
                owner_user_id=owner_user_id,
                portfolio_id=portfolio_id,
                exception_type="CASH_FX_UNAVAILABLE",
                severity="CRITICAL" if payload["data_state"] == "MISSING" else "WARNING",
                title=f"FX cash {payload['currency']} indisponible ou obsolète",
                source_ref=source_ref,
                details={"snapshot_date": target_date.isoformat(), "data_state": payload["data_state"]},
            )
        else:
            _resolve_exception(
                repository,
                owner_user_id=owner_user_id,
                exception_type="CASH_FX_UNAVAILABLE",
                source_ref=source_ref,
            )
    for account_id in account_ids:
        status = reconciliation.get(account_id, (target_date, "NOT_CHECKED"))[1]
        if status != "MATCH":
            _sync_exception(
                repository,
                owner_user_id=owner_user_id,
                portfolio_id=portfolio_id,
                exception_type="ACCOUNT_UNRECONCILED",
                severity="WARNING",
                title="Compte non rapproché",
                source_ref=f"account:{account_id}",
                details={"status": status, "as_of_date": target_date.isoformat()},
            )
        else:
            _resolve_exception(
                repository,
                owner_user_id=owner_user_id,
                exception_type="ACCOUNT_UNRECONCILED",
                source_ref=f"account:{account_id}",
            )

    for holding in manual_holdings:
        holding_id = str(holding["id"])
        value_eur, _ = _latest_on_or_before(
            manual_history, holding_id, target_date, max_age_days=100_000
        )
        next_date = (
            date.fromisoformat(str(holding["next_valuation_date"]))
            if holding.get("next_valuation_date")
            else None
        )
        source_ref = f"manual_holding:{holding_id}"
        if value_eur is None or (next_date and next_date < target_date):
            _sync_exception(
                repository,
                owner_user_id=owner_user_id,
                portfolio_id=portfolio_id,
                exception_type="MANUAL_VALUATION_INCOMPLETE",
                severity="CRITICAL" if value_eur is None else "WARNING",
                title=f"Valorisation à mettre à jour : {holding['name']}",
                source_ref=source_ref,
                details={
                    "next_valuation_date": next_date.isoformat() if next_date else None,
                    "valuation_missing": value_eur is None,
                },
            )
        else:
            _resolve_exception(
                repository,
                owner_user_id=owner_user_id,
                exception_type="MANUAL_VALUATION_INCOMPLETE",
                source_ref=source_ref,
            )

    return {
        "resource_type": "portfolio_calculation",
        "resource_id": portfolio_id,
        "portfolio_id": portfolio_id,
        "as_of_date": target_date.isoformat(),
        "position_count": len(latest_position_payloads),
        "cash_balance_count": len(latest_cash_payloads),
        "performance_point_count": len(performance_rows),
        "latest_manual_assets_eur": str(latest_manual_assets),
        "latest_manual_liabilities_eur": str(latest_manual_liabilities),
        "data_state": latest_performance.data_state if latest_performance else "MISSING",
    }
