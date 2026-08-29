# Supabase backup and restore qualification

Repository checks do not prove that Supabase backup, PITR, or restore capability
exists. Provider protections, plan/retention, recovery-window evidence, restore
execution, and clone cleanup each remain separate operator gates.

## Required restore-drill receipt

Every Production data or schema mutation must carry a sanitized
astrocyte_restore_drill_receipt_v1 inside its authorization manifest. The
receipt contains hashes and operational results only; it must not contain a
project URL, database URL, token, secret, row value, or raw provider identifier.

Required fields:

    {
      "schema_version": "astrocyte_restore_drill_receipt_v1",
      "status": "PASS",
      "completed_at": "YYYY-MM-DDTHH:MM:SSZ",
      "expires_at": "YYYY-MM-DDTHH:MM:SSZ",
      "target_sha256": "<lowercase sha256 of the approved target identity>",
      "base_sha": "<exact 40-character github.sha>",
      "restore_mode": "ISOLATED_PROJECT",
      "fingerprint_match": true,
      "outbound_side_effects": false,
      "rpo_seconds": 0,
      "rto_seconds": 0,
      "cleanup_status": "DELETED"
    }

cleanup_status is restricted to DELETED, PAUSED, or
RETAINED_WITH_AUTHORITY. The validator rejects:

- missing or additional fields;
- a result other than PASS;
- an in-place restore;
- fingerprint mismatch or an outbound side effect;
- a target hash or base SHA different from the authorized run;
- a future, expired, or more-than-seven-day-old receipt;
- a validity period longer than seven days;
- RPO above 120 seconds or RTO above 7,200 seconds.

Validate a sanitized receipt locally:

    python3 .github/scripts/verify_backup_restore_receipt.py \
      --receipt-file /absolute/path/to/sanitized-receipt.json \
      --expected-target-sha256 <target-sha256> \
      --expected-base-sha <exact-main-sha>

The printed digest is the SHA-256 of canonical JSON and becomes
restore_receipt_sha256 in the mutation authorization manifest.

## Drill sequence

1. Under separate provider and cost authority, identify the exact Production
   target by a redacted SHA-256 and record the exact repository SHA.
2. Restore to an isolated project. Do not restore in place.
3. Disable outbound jobs, webhooks, queues, extensions, and integration
   credentials before functional validation.
4. Compare sanitized schema, migration, RLS/policy, extension, count, and
   aggregate fingerprints. No row values leave the provider.
5. Record observed RPO/RTO and cleanup disposition.
6. Validate and hash the receipt locally.
7. Obtain a new, separately authorized mutation manifest tied to the same
   target hash, repository SHA, normalized inputs, and receipt hash.

A backup indicator, PITR setting, successful local check, or old restore receipt
is not a substitute for this drill.
