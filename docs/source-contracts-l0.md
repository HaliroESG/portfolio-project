# L0 — Source contracts and offline fixtures

18 October 2026. **Local candidate, not independently accepted or deployed.**

## Scope and architecture

Supports the source-reliability roadmap (L0) and BACKLOG BL-002/003/009/015.
This is a logical contract, **not a deployed Supabase schema or row**.
The architecture remains backend → Supabase → frontend. No existing ETL,
Supabase reader, route, command, scheduler or projection imports this module.
Backend writes: zero. Supabase changes: zero. Frontend runtime changes: zero.

Files:
- backend/source_contracts.py: three pure entry points.
- backend/tests/fixtures/source_contracts_v1.json: ten wholly synthetic cases.
- backend/tests/test_source_contracts.py: six L0 acceptance scenarios and boundaries.
- backend/tests/source_contracts_offline_guard.py: optional pre-collection network tripwire.
- frontend/types.ts: SourceObservationV1, matching the logical output.
- frontend/scripts/test-source-contracts.mjs: actual Python outputs type-checked in memory.
- backend/.gitignore: exception for that exact synthetic fixture, not all JSON files.

The scope marker OFFLINE_SYNTHETIC is compulsory and preserved in every output.
No live input, provider callable, database client, URL or runtime integration is exposed.
This is not an enforcement boundary for arbitrary untrusted Python: use the network-denied
test process below. References are bounded opaque identifiers, not document URLs.
They describe supplied evidence; the normalizer does not fetch or certify it.

## API

normalize_observation(raw, now=..., policy=...) returns a new logical envelope.
It neither mutates its inputs nor reads environment variables or system time.

- Numeric JSON values must be finite; booleans/strings/NaN/Infinity are rejected.
  Missing remains null. Zero/negative values remain valid outside FX; FX is strictly >0.
- Values are bounded to ±(2^53 − 1), the JavaScript safe-integer range. Python
  integers outside that range are rejected with UNSAFE_NUMBER before float coercion;
  out-of-range floats are rejected too. Even exactly representable larger integers
  are deliberately outside this conservative shared domain. In-range fractional
  binary64 values remain supported; this does not promise arbitrary decimal precision.
  SourceObservationV1 documents the bound but its TypeScript number type cannot enforce it.
- Units are explicit: EUR_PER_UNIT, PERCENT, PERCENTAGE_POINTS, BASIS_POINTS,
  INDEX_POINTS, RATIO, CURRENCY. No conversion is inferred.
  CURRENCY requires a three-letter currency label for complete quality.
  L0 validates the label shape, not membership of an official currency registry.
- Civil dates remain dates; no midnight is fabricated. A timezone-bearing timestamp is
  normalized to UTC. Naive times, invalid dates and unknown offset -00:00 are rejected.
  A timestamp's observed_date is its UTC date, not an inferred issuer local date.
- Collection and observation dates are separate. A future observation/collection, a
  period ending after observation, missing date or incompatible policy is non-qualified.
- Monthly/quarterly/annual observations need explicit period boundaries.
  L0 does not certify fiscal continuity, consecutive quarters or TTM.
- Derived values need a formula reference and input references. Their presence does
  not prove numerical correctness; no financial formula is executed in L0.
- Missing provenance yields an explicit reason, not a fabricated source.
- observation_id identifies the source/instrument/date/period slot; revision_id also
  binds value, unit, nature and derivation/provenance. Recollection does not change
  those IDs; a changed value changes revision_id. Duplicate resolution is deferred.

### States and freshness

All applicable reason codes remain visible. Primary state precedence is
MISSING (value null) → UNKNOWN → STALE → PARTIAL → VALIDATED.
STALE can coexist with incomplete metadata in reasons; do not discard those reasons.
VALIDATED means **synthetic contract consistency**, not verified market facts,
legal source rights, publication status, tactical readiness or permission to act.

A fixture freshness policy supplies identity, provider, cadence, version,
evaluation day and a minimum source date. It must match the observation and the
injected UTC day. Absence/mismatch gives UNKNOWN. It is a supplied date floor,
not a universal 72-hour TTL and not an implemented market calendar.
source_age_calendar_days is explicitly calendar-day age, not trading-session age.
collection_age_seconds is separate and cannot rejuvenate an old observation.
An FX policy without a calendar reference remains UNKNOWN. The reference alone is
metadata, not calendar verification; actual calendars/SLA need L1/L2 qualification.

### Rights

assess_rights(decision, provider=..., usage=..., now=...) evaluates one **synthetic**
decision for COLLECT, STORE, REPLAY or DISPLAY. Default is inadmissible; status,
provider, usage and half-open validity interval [from, until) must match.
An admissible COLLECT fixture does not grant STORE, DISPLAY or REPLAY.
operational_authority is always false, even for an admissible fixture.
No production rights registry is read or changed. Rights evidence validation and
human operational authority remain separate future gates.

### Failure rehearsal

replay_fixture(attempts, now=..., max_attempts=..., policy=..., previous=...) consumes
preloaded outcomes, not real calls. Integer budget 1..5; at most 32 supplied outcomes.
NETWORK_ERROR, TIMEOUT and RATE_LIMITED consume attempts. SCHEMA_CHANGED or an
invalid success payload stops. Empty/insufficient outcomes and exhausted budgets
have distinct reasons. PREPARED means normalization finished, not data qualified.
A previous complete observation may remain as last_known, with original dates and
freshness reevaluated; current failure is separate. Incomplete previous input is rejected.
Current and previous must refer to the same series, provider, frequency and unit;
a different instrument cannot be used as its last-known value.
When a previous point exists, an older source observation fails with OBSERVATION_REGRESSION.
Missing observation chronology, or DATE/TIMESTAMP precision on the same UTC day,
fails with OBSERVATION_ORDER_UNKNOWN; no midnight is invented. Two timestamps
are compared as UTC instants. Equal observation slots may carry a revised value.
Periods must be identical or disjoint and advancing. An older disjoint period
fails with PERIOD_REGRESSION even if collected/published later; missing or unequal
overlapping periods fail with PERIOD_ORDER_UNKNOWN. Bounds are inclusive.
These failures return FAILED, current=null and the original dated last_known;
earlier retry reasons remain visible. This is a current-point rehearsal, not a
historical-correction selector: historical revisions need a separate future path.
Without a previous point there is no chronology comparison; PREPARED still means
normalization only, and a stale/partial/unknown quality is never upgraded.
No retry executor, sleep, database mutation, etl_runs or target update exists.

## Tests and acceptance mapping

| Scenario | Evidence exercised |
| --- | --- |
| T00-01 | Pure import with environment/client access forbidden; network tripwire |
| T00-02 | Synthetic success preparation without client creation/mutations |
| T00-03 | Missing, unverified, denied, expired, future and usage-specific rights |
| T00-04 | Date precision, future/old/missing data, finite values, units, provenance |
| T00-05 | Stable replay/IDs, revision changes, no input mutation, sanitized errors |
| T00-06 | Bounded injected failures; dated last-known value; invalid budgets |

From backend, using installed local dependencies:
```sh
env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin \
  PYTHONPATH=.:tests PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 \
  /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  python3.11 -B -m pytest -q -p source_contracts_offline_guard tests/test_source_contracts.py
```

The macOS policy denies OS network operations; the pytest plugin additionally blocks
Python attempts before collection. The tests also install a per-test tripwire for
ordinary pytest runs. No dependencies are installed by these commands.

From frontend: npm run test:source-contracts (requires local Python 3.11 and TypeScript).
It normalizes the shared JSON with Python, verifies the resulting literals satisfy
SourceObservationV1, then verifies four deliberately invalid types are rejected.
It emits no files and does not import the app. Run under the same network-denied policy
for an OS-level guarantee. This dedicated command is not silently added to existing
CI: Python availability and the future review/delivery gate must be addressed first.

Existing backend regression suite is also exercised under network denial, excluding
test_allocation_contracts_postgres.py (unrelated local PostgreSQL integration).
Frontend lint/type checks and existing offline test:frontend remain required.
The live smoke:supabase and all provider/runtime checks are NOT RUN in L0.

## Remaining gates

1. Inspect the exact uncommitted diff and local evidence, then obtain an authorized
   fresh independent review. No SHIP claimed by the implementer.
2. Commit/push/PR/CI only under their applicable delivery authority.
3. L1/L2/L3: adapt existing producers/readers with physical contract verification,
   source/calendar/unit conventions and rights. Do not wire synthetic fixtures in runtime.
4. Supabase writes, command/tactical activation and deployment remain closed.

No production data reliability issue is claimed repaired by L0 alone.
