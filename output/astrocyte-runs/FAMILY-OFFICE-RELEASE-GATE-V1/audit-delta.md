# ASTROCYTE Family Office release gate — audit delta

Date: 2026-08-29

## Authority and immutable inputs

- Controller thread: `01a048fb-6d82-7363-be6a-781ed87229b0`
- Workstream: `portfolio-astrocyte-family-office-release-gate-v1-01a04e52`
- Required base: `3828d6d7851958f6e832896ce908c60097f67f90`
- Release-gate code commit bound to the local receipt: `ccfc0960812ce90deccfc01434da457e1e6934ce`
- Reviewed source head after the bounded CI correction: `bc1d9f6eacbbe28dccd4b4bb19fe0987ed7ac91b`
- PR12 candidate: `c01eb33878e4030975144c5b0ae98e9bdf31ea04`
- PR12 was read through pinned Git objects only; it was not modified, merged, or copied into this branch.

## Expected and actual impact

- Backend writes: none. New Python tooling creates only disposable local PostgreSQL databases and a sanitized receipt.
- Supabase schema/data: none. No remote migration, provider clone, provider credential, runtime, or configuration was accessed.
- Frontend typed reads/UI: no functional change. Existing readers were validated; no contract shape was changed on this branch.
- GitHub: one new workflow contract with secret-free `validate` and `prepare` jobs. Its `mutate-production` job is manual, disabled by default, protected by `Production`, requires the existing authorization contract, and terminates with the explicit HTTP 503 refusal. It contains no provider command or credential.

## Delta

- Pin the exact PR12 commit and five exact source artifacts by Git blob SHA-1 and SHA-256.
- Reproduce a PostgreSQL 15+ logical backup and restore into fresh, isolated local databases.
- Verify source/restore fingerprints, two-owner read isolation, authenticated write refusal, composite constraints, RLS/grants/views, unsafe rollback refusal, and safe rollback.
- Emit and strictly validate a non-promotable `LOCAL_ISOLATED_DATABASE` receipt.
- Add workflow parity and negative tests preserving the `ISOLATED_PROJECT` Production boundary.
- Require full read-only Git history in the transversal contract workflow so the exact pinned PR12 object is available; no fetched object is executed without the existing commit/blob/content checks.
- Document the absent HMAC key, independent issuer, and Production gates without inventing configuration.

## Explicit non-delta

- No GitHub environment, secret, variable, branch protection, or repository configuration change.
- No Supabase, Vercel, provider, web, Preview, runtime, deployment, dispatch, or merge action.
- No activation command and no replacement for provider-native restore evidence.
