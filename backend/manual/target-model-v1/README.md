# Target model SQL/ACL — manual, offline package

This directory is not a migration runner and is not discovered by any deployment workflow. No command here grants authority to access Supabase or activate a model.

The package preserves the four SQL parts, their order, and all pre/postconditions. The primary SQL remains in `backend/sql/20260921_allocation_contracts_v1.sql`; the three supplemental SQL files are under `sql/`. The embedded copies in `p2/candidate/package.json` are pinned for deterministic assembly. `provenance.json` maps their hashes. Historical review reports and private exports are not included.

## Validation
From the repository root, pure renderer tests (no database, no credentials):

```sh
python3.11 -m unittest discover -s backend/manual/target-model-v1/native -p 'test_transport.py'
```

The local PostgreSQL cases report SKIP unless `ASTROCYTE_TEST_PG_BIN` explicitly identifies the separately qualified PostgreSQL 17.6 binary directory. This is a test-only setting, not a provider credential. No installation, version fallback, or remote service is attempted. The rehearsal currently requires the qualified macOS client hash and `/private/tmp`; Linux PostgreSQL execution is NOT QUALIFIED by these tests. Unit tests use a non-executable synthetic client and are never evidence of runtime qualification.

With the existing qualified local runtime selected and its binary/library receipt checked separately, run both `p2/candidate/test_executor.py` and `native/test_transport.py`. The fixture creates a private Unix-socket cluster, disables TCP, and stops it after testing. It uses synthetic data only.

`transport.build_plan(..., client_bin=Path(...))` requires an explicit canonical directory and the pinned client hash. It returns a plan, never executes it. A caller must obtain fresh identity, TLS and recovery evidence and a separate exact-plan authorization before any real operation. See `native/README.md` for the inactive operational protocol.

## Delivery boundary
No Supabase read/write, activation, orders, UI redesign or deployment is part of this package. The importer changes are separately tested and remain inactive. Frontend contracts are unchanged. Historical local runtime metadata must not be copied into Git. Do not run the supplemental SQL independently or point the local rehearsal at a remote database.
