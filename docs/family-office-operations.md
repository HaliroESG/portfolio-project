# Family Office Operations Runbook

## Trust boundary

- Supabase is the runtime read source of truth.
- Only the Python command API and backend jobs write canonical `fo_*` data.
- The browser uses a publishable key plus an authenticated owner session.
- `anon` has no table grants. `authenticated` is read-only and owner-scoped through RLS.
- The ledger is append-only. Corrections must be represented by reversal or adjustment entries.
- Orders are drafts exported to CSV/PDF; no broker order is transmitted.

## Production configuration

Use `configs/prod/family-office.env.example` as the variable inventory. Never put a backend secret in `frontend/.env.local` or a `NEXT_PUBLIC_*` variable.

Command API:

```bash
cd backend
SUPABASE_URL=... \
SUPABASE_SECRET_KEY=... \
FRONTEND_ORIGINS=https://portfolio.example.com \
uvicorn api:app --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
NEXT_PUBLIC_SUPABASE_URL=... \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
NEXT_PUBLIC_COMMAND_API_URL=https://portfolio-api.example.com \
npm run dev
```

## Owner bootstrap

The application intentionally supports one owner. The allowlist is not exposed through the Data API.

```bash
cd backend
SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
python3.11 scripts/bootstrap_family_office_owner.py \
  --email owner@example.com \
  --redirect-to https://portfolio.example.com/auth/callback
```

The script allowlists the email and sends a Supabase invite. The owner then uses the magic-link login screen. The first application bootstrap creates the personal entity, EUR portfolio, Fortuneo/IBKR institutions and the Core-Satellite 70/30 policy.

## First portfolio load

1. Create each account in Administration with its real external account identifier and envelope.
2. Import a Fortuneo or IBKR transaction CSV in Operations.
3. Include a canonical positions CSV when available to run reconciliation immediately.
4. Resolve identifier and reconciliation exceptions.
5. Recalculate the portfolio.
6. Compare NAV, cash, quantities and PRU against the broker statement before relying on performance.

Expected transaction headers:

- Fortuneo canonical export: `trade_date`, `settlement_date`, `side`, `quantity`, `price`, `gross_amount`, `fees`, `taxes`, `net_amount`, `currency`, `symbol` or `isin`, `external_txn_id`.
- IBKR trade export: `TradeID`, `TradeDate`, `SettleDate`, `Symbol`, `ISIN`, `Buy/Sell`, `Quantity`, `TradePrice`, `Proceeds`, `Comm/Fee`, `Tax`, `Currency`, `AssetClass`.
- Position reconciliation: `symbol` or `isin`, `quantity`, optional `average_cost`, `currency`, `name`.

Every import stores the original filename, SHA-256, counts and rejection report. A rerun is idempotent.

## Data states

- `READY`: complete and reconciled for the requested calculation.
- `PARTIAL`: the NAV can be valued but a non-NAV field such as EUR cost basis is incomplete, or an input is stale.
- `UNRECONCILED`: values exist but the broker snapshot has not matched the ledger.
- `STALE`: a dated value exists outside its freshness window.
- `MISSING`: a required component cannot be valued. Consolidated NAV is `NULL`, never zero-filled.

Historical performance does not bridge returns across a day whose NAV is unknown. Non-EUR transaction cost and external-flow conversion require a dated FX rate.

## Daily control

1. Import new broker transactions and the latest positions snapshot.
2. Review the Operations inbox, beginning with `CRITICAL` exceptions.
3. Recalculate after reconciliation.
4. Confirm position, price, FX and calculation dates separately.
5. Review concentration, drawdown, cash and FX exposure.

The scheduled refresh runs `family_office_sync` after market, macro and news refreshes. A failed portfolio is reported without stopping all other portfolios.

## Monthly close

1. Recalculate explicitly at month end when the period snapshot is not present.
2. Prepare the close in Operations.
3. Confirm coverage is 100%, performance is `READY`, reconciliation is `MATCH` and no critical exception is open.
4. Finalize the close.
5. Export the frozen CSV/PDF report and compare it to broker statements.

A `CLOSED` row is immutable at the database trigger level. The report embeds positions, cash, manual assets/liabilities, performance, risk and exceptions as of `period_end`.

## Recovery and archive

- The legacy operational reset is archived in the unexposed `family_office_archive` schema.
- The reset key `family-office-reset-2026-07-13` makes the migration idempotent.
- Market, macro, historical prices, screeners, research and backtests are outside that reset.
- Do not delete historical prices to address the Supabase quota without a separately approved retention policy.

## Validation gates

```bash
cd backend
python3.11 -m pytest -q
python3.11 -m py_compile api.py family_office/*.py scripts/sync_family_office.py

cd ../frontend
npm run lint
npx tsc --noEmit
npm run build
npm run smoke:supabase
```

The private Supabase smoke must use `SUPABASE_SMOKE_KEY` with a backend secret. Browser tests use the publishable key and an owner session.

## Current external blocker

Postgres is healthy and approximately 216 MiB, but the Supabase Data API can still return `402 exceed_db_size_quota` after a previous Free-plan overage. This cannot be fixed by deleting the operational register. Wait for the platform quota refresh or resolve it in Supabase billing/support, then rerun schema check and smoke before production use.
