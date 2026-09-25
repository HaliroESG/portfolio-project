from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / ".github" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from check_mutation_contract import (  # noqa: E402
    ContractError,
    normalize_inputs,
)
from family_office_release_gate import (  # noqa: E402
    EXPECTED_CANDIDATE_SHA,
    EXPECTED_MIGRATION_SHA256,
    materialize_candidate,
)
from verify_backup_restore_receipt import (  # noqa: E402
    ReceiptError,
    validate_receipt,
)
from verify_family_office_local_receipt import (  # noqa: E402
    LocalReceiptError,
    validate_local_receipt,
)


def valid_local_receipt() -> dict[str, object]:
    return {
        "schema_version": "astrocyte_family_office_local_restore_receipt_v1",
        "status": "PASS",
        "started_at": "2026-08-29T16:00:00Z",
        "completed_at": "2026-08-29T16:01:00Z",
        "release_gate_sha": "a" * 40,
        "candidate_sha": EXPECTED_CANDIDATE_SHA,
        "candidate_manifest_sha256": "b" * 64,
        "migration_sha256": EXPECTED_MIGRATION_SHA256,
        "backup_sha256": "c" * 64,
        "source_fingerprint_sha256": "d" * 64,
        "restored_fingerprint_sha256": "d" * 64,
        "restore_mode": "LOCAL_ISOLATED_DATABASE",
        "postgres_major": 15,
        "rpo_seconds": 0.25,
        "rto_seconds": 0.75,
        "owner_identity_count": 2,
        "read_isolation": True,
        "write_isolation": True,
        "composite_constraints": True,
        "rls_grants_views": True,
        "rollback_verified": True,
        "unsafe_rollback_refused": True,
        "outbound_side_effects": False,
        "cleanup_status": "DELETED",
    }


class FamilyOfficeLocalReceiptTests(unittest.TestCase):
    def test_valid_local_receipt_is_non_promotable(self) -> None:
        receipt = valid_local_receipt()
        validate_local_receipt(receipt, expected_candidate_sha=EXPECTED_CANDIDATE_SHA)
        with self.assertRaises(ReceiptError):
            validate_receipt(
                receipt,
                expected_target_sha256="e" * 64,
                expected_base_sha="a" * 40,
            )

    def test_provider_mode_overclaim_fails(self) -> None:
        receipt = copy.deepcopy(valid_local_receipt())
        receipt["restore_mode"] = "ISOLATED_PROJECT"
        with self.assertRaisesRegex(LocalReceiptError, "provider-native"):
            validate_local_receipt(receipt)

    def test_fingerprint_mismatch_and_extra_fields_fail(self) -> None:
        receipt = copy.deepcopy(valid_local_receipt())
        receipt["restored_fingerprint_sha256"] = "f" * 64
        with self.assertRaisesRegex(LocalReceiptError, "fingerprint"):
            validate_local_receipt(receipt)
        receipt = copy.deepcopy(valid_local_receipt())
        receipt["provider_project"] = "forbidden"
        with self.assertRaisesRegex(LocalReceiptError, "unexpected"):
            validate_local_receipt(receipt)


class FamilyOfficeCandidateTests(unittest.TestCase):
    def test_candidate_files_materialize_from_pinned_git_objects(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            files, manifest_digest = materialize_candidate(Path(temporary))
            self.assertEqual(len(files), 5)
            self.assertEqual(len(manifest_digest), 64)
            migration = files[
                "backend/sql/20260829_family_office_owner_isolation.sql"
            ]
            self.assertIn(
                "PGA-004",
                migration.read_text(encoding="utf-8"),
            )

    def test_production_contract_pins_candidate_and_requires_mutation(self) -> None:
        raw = {
            "candidate_sha": EXPECTED_CANDIDATE_SHA,
            "migration_sha256": EXPECTED_MIGRATION_SHA256,
            "mutate_production": "true",
        }
        normalized = normalize_inputs("family-office-release", raw)
        self.assertTrue(normalized["mutate_production"])
        with self.assertRaisesRegex(ContractError, "reviewed PR12 pin"):
            normalize_inputs(
                "family-office-release",
                {**raw, "candidate_sha": "f" * 40},
            )
        with self.assertRaisesRegex(ContractError, "explicitly selected"):
            normalize_inputs(
                "family-office-release",
                {**raw, "mutate_production": "false"},
            )


if __name__ == "__main__":
    unittest.main()
