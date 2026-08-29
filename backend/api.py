from __future__ import annotations

import io
import os
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Literal

import requests
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from family_office.commands import (
    add_manual_valuation,
    bootstrap_default_book,
    create_account,
    create_manual_holding,
    execute_audited_command,
    import_broker_transactions,
    prepare_monthly_close,
    reconcile_broker_positions,
    transition_decision,
)
from family_office.reporting import monthly_close_csv, monthly_close_pdf, order_csv, order_pdf
from family_office.repository import FamilyOfficeRepository, create_service_client
from family_office.sync import rebuild_portfolio


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AuthenticatedOwner(BaseModel):
    user_id: str
    email: str | None = None


def _repository() -> FamilyOfficeRepository:
    return FamilyOfficeRepository(create_service_client())


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    return token


def authenticated_owner(
    authorization: str | None = Header(default=None),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> AuthenticatedOwner:
    token = _bearer_token(authorization)
    supabase_url = os.environ.get("SUPABASE_URL")
    secret = (
        os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_SERVICE_KEY")
        or os.environ.get("SUPABASE_KEY")
    )
    if not supabase_url or not secret:
        raise HTTPException(status_code=503, detail="Command API is not configured")
    try:
        response = requests.get(
            f"{supabase_url.rstrip('/')}/auth/v1/user",
            headers={"apikey": secret, "Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail="Authentication service unavailable") from exc
    if response.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")
    payload = response.json()
    user_id = str(payload.get("id") or "")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session identity")
    try:
        repository.require_owner(user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return AuthenticatedOwner(user_id=user_id, email=payload.get("email"))


def command_idempotency_key(
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> str:
    value = (idempotency_key or "").strip()
    if len(value) < 8 or len(value) > 160:
        raise HTTPException(status_code=400, detail="Idempotency-Key must contain 8 to 160 characters")
    return value


class BootstrapRequest(BaseModel):
    portfolio_name: str = Field(default="Patrimoine familial", min_length=2, max_length=120)


class AccountRequest(BaseModel):
    portfolio_id: str
    institution_id: str
    external_account_id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=2, max_length=120)
    envelope: Literal["PEA", "CTO", "PER", "AV", "CASH", "OTHER"]
    base_currency: str = Field(default="EUR", min_length=3, max_length=3)

    @field_validator("base_currency")
    @classmethod
    def uppercase_currency(cls, value: str) -> str:
        return value.upper()


class ManualHoldingRequest(BaseModel):
    portfolio_id: str
    holding_kind: Literal["ASSET", "LIABILITY"]
    asset_type: Literal["REAL_ESTATE", "PRIVATE_EQUITY", "INSURANCE", "PENSION", "LOAN", "OTHER"]
    name: str = Field(min_length=2, max_length=160)
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    valuation_frequency: Literal["MONTHLY", "QUARTERLY", "ANNUAL", "ON_DEMAND"] = "QUARTERLY"
    next_valuation_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("currency")
    @classmethod
    def uppercase_currency(cls, value: str) -> str:
        return value.upper()


class ManualValuationRequest(BaseModel):
    valuation_date: date
    value_local: float = Field(ge=0)
    fx_rate_to_eur: float | None = Field(default=None, gt=0)
    value_eur: float = Field(ge=0)
    source: str = Field(min_length=2, max_length=200)
    confidence: Literal["VERIFIED", "DECLARED", "ESTIMATED"] = "DECLARED"
    notes: str | None = Field(default=None, max_length=2000)


class RecalculateRequest(BaseModel):
    portfolio_id: str
    as_of_date: date | None = None


class DecisionRequest(BaseModel):
    portfolio_id: str
    title: str = Field(min_length=3, max_length=180)
    rationale: str = Field(min_length=10, max_length=5000)
    macro_context: dict[str, Any] = Field(default_factory=dict)
    risk_context: dict[str, Any] = Field(default_factory=dict)
    source_snapshot: dict[str, Any] = Field(default_factory=dict)


class DecisionTransitionRequest(BaseModel):
    status: Literal["VALIDATED", "EXPORTED", "EXECUTED", "RECONCILED", "CANCELLED"]


class OrderLineRequest(BaseModel):
    instrument_id: str
    side: Literal["BUY", "SELL"]
    quantity: float | None = Field(default=None, gt=0)
    amount_eur: float | None = Field(default=None, gt=0)
    limit_price: float | None = Field(default=None, gt=0)
    reason_codes: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def amount_or_quantity(self) -> "OrderLineRequest":
        if self.amount_eur is None and self.quantity is None:
            raise ValueError("quantity or amount_eur is required")
        return self


class OrderDraftRequest(BaseModel):
    decision_id: str
    account_id: str
    lines: list[OrderLineRequest] = Field(min_length=1)


class MonthlyCloseRequest(BaseModel):
    portfolio_id: str
    period_end: date
    finalize: bool = False


class ExceptionResolutionRequest(BaseModel):
    status: Literal["RESOLVED", "IGNORED"] = "RESOLVED"


app = FastAPI(
    title="Portfolio Family Office Command API",
    version="1.0.0",
    description="Authenticated command boundary. Supabase remains the frontend read source of truth.",
)

origins = [
    item.strip()
    for item in os.environ.get(
        "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)


@app.exception_handler(ValueError)
async def business_validation_error(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "family-office-command-api"}


@app.get("/ready")
def ready(repository: FamilyOfficeRepository = Depends(_repository)) -> dict[str, Any]:
    try:
        rows = repository.select("fo_owner_profiles", "user_id", limit=1)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Supabase contract unavailable: {exc}") from exc
    return {"status": "ready", "owner_configured": bool(rows)}


@app.post("/v1/bootstrap")
def bootstrap(
    request: BootstrapRequest,
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    command_id: str = Depends(command_idempotency_key),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> dict[str, Any]:
    return execute_audited_command(
        repository,
        owner_user_id=owner.user_id,
        command_id=command_id,
        command_type="BOOTSTRAP_DEFAULT_BOOK",
        operation=lambda: bootstrap_default_book(
            repository, owner_user_id=owner.user_id, portfolio_name=request.portfolio_name
        ),
    )


@app.post("/v1/accounts")
def add_account(
    request: AccountRequest,
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    command_id: str = Depends(command_idempotency_key),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> dict[str, Any]:
    return execute_audited_command(
        repository,
        owner_user_id=owner.user_id,
        command_id=command_id,
        command_type="CREATE_ACCOUNT",
        operation=lambda: create_account(
            repository,
            owner_user_id=owner.user_id,
            **request.model_dump(),
        ),
    )


@app.post("/v1/imports/broker")
async def import_broker(
    account_id: str = Form(...),
    broker: Literal["FORTUNEO", "IBKR"] = Form(...),
    source_file: UploadFile = File(...),
    positions_file: UploadFile | None = File(default=None),
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    command_id: str = Depends(command_idempotency_key),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> dict[str, Any]:
    suffix = Path(source_file.filename or "transactions.csv").suffix or ".csv"
    content = await source_file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty broker file")
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Broker file exceeds 15 MB")
    positions_content = await positions_file.read() if positions_file else None
    if positions_content is not None and len(positions_content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Positions file exceeds 15 MB")
    with tempfile.NamedTemporaryFile(suffix=suffix) as temporary:
        temporary.write(content)
        temporary.flush()
        positions_temporary = tempfile.NamedTemporaryFile(suffix=".csv") if positions_content else None
        if positions_temporary and positions_content:
            positions_temporary.write(positions_content)
            positions_temporary.flush()

        def operation() -> dict[str, Any]:
            transaction_result = import_broker_transactions(
                repository,
                owner_user_id=owner.user_id,
                account_id=account_id,
                broker=broker,
                source_path=Path(temporary.name),
                source_name=source_file.filename,
            )
            reconciliation_result = None
            if positions_temporary:
                reconciliation_result = reconcile_broker_positions(
                    repository,
                    owner_user_id=owner.user_id,
                    account_id=account_id,
                    broker=broker,
                    source_path=Path(positions_temporary.name),
                    source_name=positions_file.filename if positions_file else None,
                )
            return {**transaction_result, "reconciliation_result": reconciliation_result}

        try:
            return execute_audited_command(
                repository,
                owner_user_id=owner.user_id,
                command_id=command_id,
                command_type="IMPORT_BROKER_TRANSACTIONS",
                operation=operation,
            )
        finally:
            if positions_temporary:
                positions_temporary.close()


@app.post("/v1/manual-holdings")
def add_holding(
    request: ManualHoldingRequest,
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    command_id: str = Depends(command_idempotency_key),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> dict[str, Any]:
    payload = request.model_dump(mode="json", exclude_none=True)
    return execute_audited_command(
        repository,
        owner_user_id=owner.user_id,
        command_id=command_id,
        command_type="CREATE_MANUAL_HOLDING",
        operation=lambda: create_manual_holding(
            repository, owner_user_id=owner.user_id, payload=payload
        ),
    )


@app.post("/v1/manual-holdings/{holding_id}/valuations")
def add_valuation(
    holding_id: str,
    request: ManualValuationRequest,
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    command_id: str = Depends(command_idempotency_key),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> dict[str, Any]:
    payload = request.model_dump(mode="json", exclude_none=True)
    return execute_audited_command(
        repository,
        owner_user_id=owner.user_id,
        command_id=command_id,
        command_type="ADD_MANUAL_VALUATION",
        operation=lambda: add_manual_valuation(
            repository,
            owner_user_id=owner.user_id,
            holding_id=holding_id,
            payload=payload,
        ),
    )


@app.post("/v1/recalculate")
def recalculate(
    request: RecalculateRequest,
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    command_id: str = Depends(command_idempotency_key),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> dict[str, Any]:
    return execute_audited_command(
        repository,
        owner_user_id=owner.user_id,
        command_id=command_id,
        command_type="RECALCULATE_PORTFOLIO",
        operation=lambda: rebuild_portfolio(
            repository,
            owner_user_id=owner.user_id,
            portfolio_id=request.portfolio_id,
            as_of_date=request.as_of_date,
        ),
    )


@app.post("/v1/decisions")
def create_decision(
    request: DecisionRequest,
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    command_id: str = Depends(command_idempotency_key),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> dict[str, Any]:
    def operation() -> dict[str, Any]:
        portfolio = repository.first(
            "fo_portfolios", filters={"id": request.portfolio_id, "owner_user_id": owner.user_id}
        )
        if portfolio is None:
            raise ValueError("Unknown portfolio")
        decision = repository.insert(
            "fo_decisions",
            {"owner_user_id": owner.user_id, **request.model_dump()},
        )
        return {"resource_type": "decision", "resource_id": decision["id"], "decision": decision}

    return execute_audited_command(
        repository,
        owner_user_id=owner.user_id,
        command_id=command_id,
        command_type="CREATE_DECISION",
        operation=operation,
    )


@app.patch("/v1/decisions/{decision_id}")
def update_decision_status(
    decision_id: str,
    request: DecisionTransitionRequest,
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    command_id: str = Depends(command_idempotency_key),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> dict[str, Any]:
    return execute_audited_command(
        repository,
        owner_user_id=owner.user_id,
        command_id=command_id,
        command_type="TRANSITION_DECISION",
        operation=lambda: transition_decision(
            repository,
            owner_user_id=owner.user_id,
            decision_id=decision_id,
            target_status=request.status,
        ),
    )


@app.post("/v1/orders")
def create_order(
    request: OrderDraftRequest,
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    command_id: str = Depends(command_idempotency_key),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> dict[str, Any]:
    def operation() -> dict[str, Any]:
        decision = repository.first(
            "fo_decisions", filters={"id": request.decision_id, "owner_user_id": owner.user_id}
        )
        account = repository.first(
            "fo_accounts", filters={"id": request.account_id, "owner_user_id": owner.user_id}
        )
        if decision is None or decision["status"] != "VALIDATED":
            raise ValueError("A validated decision is required")
        if account is None:
            raise ValueError("Unknown account")
        gross = sum(abs(line.amount_eur or 0) for line in request.lines)
        order = repository.insert(
            "fo_order_drafts",
            {
                "owner_user_id": owner.user_id,
                "decision_id": request.decision_id,
                "account_id": request.account_id,
                "status": "VALIDATED",
                "estimated_gross_eur": gross,
            },
        )
        rows = [
            {
                "owner_user_id": owner.user_id,
                "order_draft_id": order["id"],
                **line.model_dump(exclude_none=True),
            }
            for line in request.lines
        ]
        repository.insert_many("fo_order_lines", rows)
        return {"resource_type": "order_draft", "resource_id": order["id"], "order": order, "lines": rows}

    return execute_audited_command(
        repository,
        owner_user_id=owner.user_id,
        command_id=command_id,
        command_type="CREATE_ORDER_DRAFT",
        operation=operation,
    )


@app.get("/v1/orders/{order_id}/export")
def export_order(
    order_id: str,
    format: Literal["csv", "pdf"] = "csv",
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> Response:
    order = repository.first(
        "fo_order_drafts", filters={"id": order_id, "owner_user_id": owner.user_id}
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Unknown order")
    lines = repository.select("fo_order_lines", filters={"order_draft_id": order_id})
    instruments = {row["id"]: row for row in repository.select("fo_instruments", "id,instrument_key,ticker")}
    enriched = [{**line, **instruments.get(line["instrument_id"], {})} for line in lines]
    if order["status"] not in {"EXPORTED", "EXECUTED", "RECONCILED"}:
        order = repository.update(
            "fo_order_drafts",
            {"status": "EXPORTED", "export_format": format.upper(), "exported_at": _iso_now(), "updated_at": _iso_now()},
            filters={"id": order_id},
        )
        repository.update(
            "fo_decisions",
            {"status": "EXPORTED", "updated_at": _iso_now()},
            filters={"id": order["decision_id"]},
        )
    if format == "pdf":
        return Response(
            content=order_pdf(order, enriched),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="order-{order_id}.pdf"'},
        )
    return Response(
        content=order_csv(order, enriched),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="order-{order_id}.csv"'},
    )


@app.post("/v1/monthly-closes")
def monthly_close(
    request: MonthlyCloseRequest,
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    command_id: str = Depends(command_idempotency_key),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> dict[str, Any]:
    return execute_audited_command(
        repository,
        owner_user_id=owner.user_id,
        command_id=command_id,
        command_type="MONTHLY_CLOSE",
        operation=lambda: prepare_monthly_close(
            repository,
            owner_user_id=owner.user_id,
            portfolio_id=request.portfolio_id,
            period_end=request.period_end,
            finalize=request.finalize,
        ),
    )


@app.get("/v1/monthly-closes/{close_id}/export")
def export_monthly_close(
    close_id: str,
    format: Literal["csv", "pdf"] = "pdf",
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> Response:
    close = repository.first(
        "fo_monthly_closes", filters={"id": close_id, "owner_user_id": owner.user_id}
    )
    if close is None:
        raise HTTPException(status_code=404, detail="Unknown monthly close")
    portfolio = repository.first(
        "fo_portfolios",
        filters={"id": close["portfolio_id"], "owner_user_id": owner.user_id},
    )
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Unknown portfolio")

    period_end = str(close["period_end"])
    report = dict(close.get("report_json") or {})
    payload = {
        "positions": list(report.get("positions") or []),
        "cash": list(report.get("cash") or []),
        "manual_holdings": list(report.get("manual_holdings") or []),
        "performance": list(report.get("performance") or []),
        "risk": report.get("risk"),
        "exceptions": list(report.get("exceptions") or []),
    }
    portfolio = dict(report.get("portfolio") or portfolio)
    filename = f"cloture-{period_end}"
    if format == "csv":
        return Response(
            content=monthly_close_csv(close, portfolio, **payload),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
        )
    return Response(
        content=monthly_close_pdf(close, portfolio, **payload),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}.pdf"'},
    )


@app.patch("/v1/exceptions/{exception_id}")
def resolve_exception(
    exception_id: str,
    request: ExceptionResolutionRequest,
    owner: AuthenticatedOwner = Depends(authenticated_owner),
    command_id: str = Depends(command_idempotency_key),
    repository: FamilyOfficeRepository = Depends(_repository),
) -> dict[str, Any]:
    def operation() -> dict[str, Any]:
        exception = repository.first(
            "fo_exceptions", filters={"id": exception_id, "owner_user_id": owner.user_id}
        )
        if exception is None:
            raise ValueError("Unknown exception")
        updated = repository.update(
            "fo_exceptions",
            {"status": request.status, "resolved_at": _iso_now()},
            filters={"id": exception_id},
        )
        return {"resource_type": "exception", "resource_id": exception_id, "exception": updated}

    return execute_audited_command(
        repository,
        owner_user_id=owner.user_id,
        command_id=command_id,
        command_type="RESOLVE_EXCEPTION",
        operation=operation,
    )
