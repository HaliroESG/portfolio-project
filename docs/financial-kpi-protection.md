# FI00/FI03 conservative KPI publication guard

This release admits **no financially qualified calculation version**. Collection READY, reconciliation, finite numbers, coverage100, a cached receipt or a recent observation never qualify a return or risk statistic. The operational source schema is unchanged; qualification metadata is derived in readers, or written only within existing JSON payload fields. No SQL migration and no source/provider access belong to this lot.

## Protected consumer graph
- Family Office sync publishes null TWR daily/MTD/YTD/inception, XIRR and benchmark return; risk volatility30d and drawdownYTD also null. Legacy computation code remains unqualified, not fixed by this release.
- Backtest persistence withholds returns, drawdowns and comparative KPIs. Nonfinite NAV aborts the payload before any write. Finite NAV remains descriptive wealth including flows, never a return.
- Family Office loader AND render boundaries reapply the guard. The versioned SWR key isolates the previous policy cache. Portfolio identities are preserved, not recombined. This does not certify authentication/session isolation for unrelated wealth fields.
- Backtest/comparison readers and KPI components independently guard legacy results. No zero drawdown curve replaces unavailable risk. NAV null observations break paths; a missing calendar date remains unknown coverage, not a claimed trading-day calendar.
- Journal validation, export, execution-status transition and order scope block structured dependencies on protected metric keys, families and explicit metric identifiers. Independent weights/concentration remain subject to their existing owner/data gates. Free-text rationale is not parsed as a financial formula.
- New monthly close finalization cannot use READY alone. Existing CLOSED snapshots are preserved; current CSV/PDF export copies withhold protected values and discard the generic risk JSON dump. The archive status is explicitly historical, not current financial qualification.

## P01–P16 acceptance map
P01/P02: legacy READY/100%, unknown/malformed versions and receipts always abstain.
P03: zero, negative, null and nonfinite values never become qualified or implicit zero.
P04: synthetic DCA NAV100→200 retains wealth but removes the spurious100% return.
P05/P06/P07: no price/FX fill, session window or XIRR input can qualify a calculation; unknown version/window remain explicit. Existing autonomous formula tests do not qualify the published portfolio indicators.
P08/P09: every named consumer guards values, tables have no numeric comparison/color signal, withheld drawdown has no plot, finite NAV remains distinct with gaps.
P10: prepopulated legacy bundle and repeated guard retain portfolio identities and abstention; unrelated session security is not expanded here.
P11: structured dependent advice validation/order creation blocked; independent weights preserved.
P12/P13: CSV/PDF current interpretation guard archived values without mutating snapshots; finalization blocked on unqualified calculations.
P14: existing nullable SQL columns only; frontend derived metadata is never added to selectors. Types retain nullable NAV and KPI values.
P15: positions, cash, research/screener, publications and individual-asset regression are outside the changed financial-return perimeter. Existing regression tests remain required.
P16: offline fixtures/fake repositories only; no Supabase smoke, runtime, activation, CI or deployment. Command locks remain unchanged.

## Qualification limits
A successful test proves conservative withholding and retained independent behavior, not corrected financial calculations, real account coverage, live security or production readiness. Future FI03 calculation qualification requires separate evidence and explicit approval; do not promote this guard into a financial certification.
