from __future__ import annotations

import copy
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from check_mutation_contract import (  # noqa: E402
    ContractError,
    authorization_signature,
    manifest_sha256,
    normalize_inputs,
    replay_artifact_name,
    validate_contract,
    validate_replay_artifacts,
)
from verify_backup_restore_receipt import (  # noqa: E402
    ReceiptError,
    receipt_sha256,
    strict_json_loads,
    validate_receipt,
)


NOW = datetime(2026, 8, 29, 10, 0, tzinfo=timezone.utc)
RUN_SHA = "b" * 40
TARGET_SHA256 = "a" * 64
HMAC_KEY = "test-only-hmac-key-material-32-bytes-minimum"
NONCE = "d" * 32
RECEIPT_ID = "restore-drill-20260829-0001"


def valid_receipt() -> dict[str, object]:
    return {
        "schema_version": "astrocyte_restore_drill_receipt_v1",
        "status": "PASS",
        "completed_at": "2026-08-29T09:00:00Z",
        "expires_at": "2026-08-30T09:00:00Z",
        "target_sha256": TARGET_SHA256,
        "base_sha": RUN_SHA,
        "restore_mode": "ISOLATED_PROJECT",
        "fingerprint_match": True,
        "outbound_side_effects": False,
        "rpo_seconds": 90,
        "rto_seconds": 3600,
        "cleanup_status": "PAUSED",
    }


def valid_case() -> tuple[dict[str, object], dict[str, str]]:
    raw_inputs = {
        "apply_schema": "true",
        "run_trident_etl": "false",
    }
    receipt = valid_receipt()
    manifest = {
        "schema_version": "astrocyte_mutation_authorization_v2",
        "issuer": "ASTROCYTE_CONTROL_CENTER_V1",
        "repository": "HaliroESG/portfolio-project",
        "workflow": "trident-supabase",
        "ref": "refs/heads/main",
        "run_sha": RUN_SHA,
        "controller_ref": "PROGRAM-CONTROLLER-V3/PGA-003",
        "issued_at": "2026-08-29T09:30:00Z",
        "expires_at": "2026-08-29T18:00:00Z",
        "target_sha256": TARGET_SHA256,
        "restore_receipt_sha256": receipt_sha256(receipt),
        "restore_receipt": receipt,
        "inputs": normalize_inputs("trident-supabase", raw_inputs),
        "nonce": NONCE,
        "receipt_id": RECEIPT_ID,
    }
    return manifest, raw_inputs


def check(manifest: dict[str, object], raw_inputs: dict[str, str]) -> None:
    validate_contract(
        manifest,
        expected_manifest_sha256=manifest_sha256(manifest),
        signature=authorization_signature(manifest, HMAC_KEY),
        hmac_key=HMAC_KEY,
        expected_nonce=NONCE,
        expected_receipt_id=RECEIPT_ID,
        workflow="trident-supabase",
        repository="HaliroESG/portfolio-project",
        workflow_ref=(
            "HaliroESG/portfolio-project/.github/workflows/"
            "trident-supabase.yml@refs/heads/main"
        ),
        event_name="workflow_dispatch",
        ref="refs/heads/main",
        run_sha=RUN_SHA,
        raw_inputs=raw_inputs,
        now=NOW,
    )


class MutationContractTests(unittest.TestCase):
    def test_valid_contract(self) -> None:
        manifest, inputs = valid_case()
        check(manifest, inputs)

    def test_non_main_ref_fails(self) -> None:
        manifest, inputs = valid_case()
        with self.assertRaisesRegex(ContractError, "refs/heads/main"):
            validate_contract(
                manifest,
                expected_manifest_sha256=manifest_sha256(manifest),
                signature=authorization_signature(manifest, HMAC_KEY),
                hmac_key=HMAC_KEY,
                expected_nonce=NONCE,
                expected_receipt_id=RECEIPT_ID,
                workflow="trident-supabase",
                repository="HaliroESG/portfolio-project",
                workflow_ref=(
                    "HaliroESG/portfolio-project/.github/workflows/"
                    "trident-supabase.yml@refs/heads/main"
                ),
                event_name="workflow_dispatch",
                ref="refs/heads/feature",
                run_sha=RUN_SHA,
                raw_inputs=inputs,
                now=NOW,
            )

    def test_run_sha_mismatch_fails(self) -> None:
        manifest, inputs = valid_case()
        with self.assertRaisesRegex(ContractError, "run SHA"):
            validate_contract(
                manifest,
                expected_manifest_sha256=manifest_sha256(manifest),
                signature=authorization_signature(manifest, HMAC_KEY),
                hmac_key=HMAC_KEY,
                expected_nonce=NONCE,
                expected_receipt_id=RECEIPT_ID,
                workflow="trident-supabase",
                repository="HaliroESG/portfolio-project",
                workflow_ref=(
                    "HaliroESG/portfolio-project/.github/workflows/"
                    "trident-supabase.yml@refs/heads/main"
                ),
                event_name="workflow_dispatch",
                ref="refs/heads/main",
                run_sha="c" * 40,
                raw_inputs=inputs,
                now=NOW,
            )

    def test_expired_authorization_fails(self) -> None:
        manifest, inputs = valid_case()
        manifest["expires_at"] = "2026-08-29T09:59:59Z"
        with self.assertRaisesRegex(ContractError, "expired"):
            check(manifest, inputs)

    def test_controller_ref_must_be_normalized(self) -> None:
        manifest, inputs = valid_case()
        manifest["controller_ref"] = " controller ref "
        with self.assertRaisesRegex(ContractError, "controller_ref"):
            check(manifest, inputs)

    def test_manifest_hash_mismatch_fails(self) -> None:
        manifest, inputs = valid_case()
        with self.assertRaisesRegex(ContractError, "manifest hash mismatch"):
            validate_contract(
                manifest,
                expected_manifest_sha256="f" * 64,
                signature=authorization_signature(manifest, HMAC_KEY),
                hmac_key=HMAC_KEY,
                expected_nonce=NONCE,
                expected_receipt_id=RECEIPT_ID,
                workflow="trident-supabase",
                repository="HaliroESG/portfolio-project",
                workflow_ref=(
                    "HaliroESG/portfolio-project/.github/workflows/"
                    "trident-supabase.yml@refs/heads/main"
                ),
                event_name="workflow_dispatch",
                ref="refs/heads/main",
                run_sha=RUN_SHA,
                raw_inputs=inputs,
                now=NOW,
            )

    def test_missing_restore_receipt_fails(self) -> None:
        manifest, inputs = valid_case()
        del manifest["restore_receipt"]
        with self.assertRaisesRegex(ContractError, "manifest fields mismatch"):
            check(manifest, inputs)

    def test_disallowed_workflow_fails(self) -> None:
        manifest, inputs = valid_case()
        manifest["workflow"] = "bootstrap-private-owner"
        with self.assertRaisesRegex(ContractError, "not authorized"):
            validate_contract(
                manifest,
                expected_manifest_sha256=manifest_sha256(manifest),
                signature=authorization_signature(manifest, HMAC_KEY),
                hmac_key=HMAC_KEY,
                expected_nonce=NONCE,
                expected_receipt_id=RECEIPT_ID,
                workflow="bootstrap-private-owner",
                repository="HaliroESG/portfolio-project",
                workflow_ref=(
                    "HaliroESG/portfolio-project/.github/workflows/"
                    "bootstrap-private-owner.yml@refs/heads/main"
                ),
                event_name="workflow_dispatch",
                ref="refs/heads/main",
                run_sha=RUN_SHA,
                raw_inputs=inputs,
                now=NOW,
            )

    def test_non_normalized_inputs_fail(self) -> None:
        manifest, inputs = valid_case()
        inputs["apply_schema"] = "TRUE"
        with self.assertRaisesRegex(ContractError, "exactly true or false"):
            check(manifest, inputs)

    def test_input_tampering_fails(self) -> None:
        manifest, inputs = valid_case()
        manifest["inputs"] = {
            "apply_schema": False,
            "run_trident_etl": True,
        }
        with self.assertRaisesRegex(ContractError, "normalized run inputs"):
            check(manifest, inputs)

    def test_forgeable_authority_and_replay_fail(self) -> None:
        manifest, inputs = valid_case()
        with self.assertRaisesRegex(ContractError, "signature is invalid"):
            validate_contract(
                manifest,
                expected_manifest_sha256=manifest_sha256(manifest),
                signature="f" * 64,
                hmac_key=HMAC_KEY,
                expected_nonce=NONCE,
                expected_receipt_id=RECEIPT_ID,
                workflow="trident-supabase",
                repository="HaliroESG/portfolio-project",
                workflow_ref=(
                    "HaliroESG/portfolio-project/.github/workflows/"
                    "trident-supabase.yml@refs/heads/main"
                ),
                event_name="workflow_dispatch",
                ref="refs/heads/main",
                run_sha=RUN_SHA,
                raw_inputs=inputs,
                now=NOW,
            )
        name = replay_artifact_name(RECEIPT_ID, NONCE)
        with self.assertRaisesRegex(ContractError, "already consumed"):
            validate_replay_artifacts(
                "claim",
                [{"name": name, "expired": False, "workflow_run": {"id": 41}}],
                expected_name=name,
                run_id="42",
            )

    def test_pre_provider_revalidation_rejects_expired_authority(self) -> None:
        manifest, inputs = valid_case()
        check(manifest, inputs)
        with self.assertRaisesRegex(ContractError, "expired"):
            validate_contract(
                manifest,
                expected_manifest_sha256=manifest_sha256(manifest),
                signature=authorization_signature(manifest, HMAC_KEY),
                hmac_key=HMAC_KEY,
                expected_nonce=NONCE,
                expected_receipt_id=RECEIPT_ID,
                workflow="trident-supabase",
                repository="HaliroESG/portfolio-project",
                workflow_ref=(
                    "HaliroESG/portfolio-project/.github/workflows/"
                    "trident-supabase.yml@refs/heads/main"
                ),
                event_name="workflow_dispatch",
                ref="refs/heads/main",
                run_sha=RUN_SHA,
                raw_inputs=inputs,
                now=datetime(2026, 8, 29, 18, 0, 1, tzinfo=timezone.utc),
            )


class RestoreReceiptTests(unittest.TestCase):
    def test_valid_receipt(self) -> None:
        validate_receipt(
            valid_receipt(),
            expected_target_sha256=TARGET_SHA256,
            expected_base_sha=RUN_SHA,
            now=NOW,
        )

    def test_stale_receipt_fails(self) -> None:
        receipt = valid_receipt()
        receipt["completed_at"] = "2026-08-20T09:00:00Z"
        receipt["expires_at"] = "2026-08-30T09:00:00Z"
        with self.assertRaisesRegex(ReceiptError, "stale"):
            validate_receipt(
                receipt,
                expected_target_sha256=TARGET_SHA256,
                expected_base_sha=RUN_SHA,
                now=NOW,
            )

    def test_target_mismatch_fails(self) -> None:
        with self.assertRaisesRegex(ReceiptError, "target"):
            validate_receipt(
                valid_receipt(),
                expected_target_sha256="c" * 64,
                expected_base_sha=RUN_SHA,
                now=NOW,
            )

    def test_failed_receipt_fails(self) -> None:
        receipt = valid_receipt()
        receipt["status"] = "FAIL"
        with self.assertRaisesRegex(ReceiptError, "PASS"):
            validate_receipt(
                receipt,
                expected_target_sha256=TARGET_SHA256,
                expected_base_sha=RUN_SHA,
                now=NOW,
            )

    def test_side_effect_receipt_fails(self) -> None:
        receipt = copy.deepcopy(valid_receipt())
        receipt["outbound_side_effects"] = True
        with self.assertRaisesRegex(ReceiptError, "zero outbound"):
            validate_receipt(
                receipt,
                expected_target_sha256=TARGET_SHA256,
                expected_base_sha=RUN_SHA,
                now=NOW,
            )

    def test_nonfinite_restore_metrics_fail(self) -> None:
        with self.assertRaisesRegex(ReceiptError, "non-standard JSON constant"):
            strict_json_loads('{"rpo_seconds":NaN}')
        receipt = valid_receipt()
        receipt["rto_seconds"] = float("inf")
        with self.assertRaisesRegex(ReceiptError, "non-negative number"):
            validate_receipt(
                receipt,
                expected_target_sha256=TARGET_SHA256,
                expected_base_sha=RUN_SHA,
                now=NOW,
            )


if __name__ == "__main__":
    unittest.main()
