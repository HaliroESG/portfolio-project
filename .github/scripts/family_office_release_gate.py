#!/usr/bin/env python3
"""Run a provider-free Family Office backup, restore, migration and rollback drill."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from verify_family_office_local_receipt import (
    LocalReceiptError,
    canonical_json,
    validate_local_receipt,
)


ROOT = Path(__file__).resolve().parents[2]
CANDIDATE_MANIFEST = ROOT / ".github" / "family-office-candidate-v1.json"
EXPECTED_CANDIDATE_SHA = "c01eb33878e4030975144c5b0ae98e9bdf31ea04"
EXPECTED_MIGRATION_SHA256 = (
    "5ca9423c2a4eb367d764b3c8830fb6ba2d38bb91f7b70f545576e618928932cf"
)
BASE_SQL = (
    ROOT / "backend/sql/20260713_02_family_office_core.sql",
    ROOT / "backend/sql/20260713_03_family_office_security.sql",
    ROOT / "backend/sql/20260713_04_family_office_truthful_overview.sql",
    ROOT / "backend/sql/20260713_05_family_office_policy_cleanup_indexes.sql",
)
PG_EXECUTABLES = (
    "initdb",
    "pg_ctl",
    "createdb",
    "pg_dump",
    "pg_restore",
    "psql",
    "postgres",
)
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
BLOB_RE = re.compile(r"^[0-9a-f]{40}$")


class GateError(RuntimeError):
    """Raised when the local release gate must fail closed."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _stage(name: str) -> None:
    print(f"stage={name}", flush=True)


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _run(
    command: list[str],
    *,
    input_text: str | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment.update({"LC_ALL": "C", "PGOPTIONS": "-c client_min_messages=warning"})
    try:
        return subprocess.run(
            command,
            cwd=ROOT,
            env=environment,
            input=input_text,
            text=True,
            capture_output=True,
            check=check,
            timeout=180,
        )
    except FileNotFoundError as exc:
        raise GateError(f"required executable is missing: {Path(command[0]).name}") from exc
    except subprocess.TimeoutExpired as exc:
        raise GateError(f"local step timed out: {Path(command[0]).name}") from exc
    except subprocess.CalledProcessError as exc:
        diagnostic_lines = [
            line.strip()
            for line in (exc.stderr or "").splitlines()
            if line.strip()
        ]
        diagnostic = " | ".join(diagnostic_lines[-4:]) if diagnostic_lines else "no diagnostic"
        diagnostic = re.sub(r"/tmp/astrocyte-family-office-[^ :]+", "<tmp>", diagnostic)
        if len(diagnostic) > 240:
            diagnostic = diagnostic[:237] + "..."
        raise GateError(
            f"local step failed: {Path(command[0]).name}: {diagnostic}"
        ) from exc


def _git(*arguments: str) -> str:
    return _run(["git", *arguments]).stdout.strip()


def _load_candidate_manifest() -> tuple[dict[str, Any], bytes]:
    raw = CANDIDATE_MANIFEST.read_bytes()
    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise GateError("candidate manifest is invalid JSON") from exc
    if not isinstance(manifest, dict):
        raise GateError("candidate manifest must be an object")
    if set(manifest) != {
        "schema_version",
        "candidate_sha",
        "candidate_branch",
        "files",
    }:
        raise GateError("candidate manifest fields changed")
    if manifest["schema_version"] != "astrocyte_family_office_candidate_v1":
        raise GateError("candidate manifest schema changed")
    if manifest["candidate_sha"] != EXPECTED_CANDIDATE_SHA:
        raise GateError("Family Office candidate SHA changed")
    files = manifest["files"]
    if not isinstance(files, dict) or len(files) != 5:
        raise GateError("candidate file inventory changed")
    migration = files.get("backend/sql/20260829_family_office_owner_isolation.sql")
    if not isinstance(migration, dict) or migration.get("sha256") != EXPECTED_MIGRATION_SHA256:
        raise GateError("candidate migration digest changed")
    return manifest, raw


def materialize_candidate(destination: Path) -> tuple[dict[str, Path], str]:
    manifest, raw_manifest = _load_candidate_manifest()
    candidate_sha = manifest["candidate_sha"]
    if not SHA_RE.fullmatch(candidate_sha):
        raise GateError("candidate SHA is malformed")
    try:
        object_type = _git("cat-file", "-t", candidate_sha)
    except GateError as exc:
        raise GateError(
            "pinned PR12 commit is unavailable; fetch the exact commit without changing the pin"
        ) from exc
    if object_type != "commit":
        raise GateError("pinned PR12 object is not a commit")

    materialized: dict[str, Path] = {}
    for relative_path, contract in sorted(manifest["files"].items()):
        if (
            not isinstance(relative_path, str)
            or relative_path.startswith("/")
            or ".." in Path(relative_path).parts
            or not isinstance(contract, dict)
            or set(contract) != {"git_blob_sha1", "sha256"}
        ):
            raise GateError("candidate file contract is unsafe")
        blob_sha1 = contract["git_blob_sha1"]
        digest = contract["sha256"]
        if not isinstance(blob_sha1, str) or not BLOB_RE.fullmatch(blob_sha1):
            raise GateError("candidate blob SHA-1 is malformed")
        if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
            raise GateError("candidate SHA-256 is malformed")
        observed_blob = _git("rev-parse", f"{candidate_sha}:{relative_path}")
        if observed_blob != blob_sha1:
            raise GateError(f"candidate blob mismatch: {relative_path}")
        content = _run(["git", "cat-file", "blob", observed_blob]).stdout.encode("utf-8")
        if _sha256(content) != digest:
            raise GateError(f"candidate content digest mismatch: {relative_path}")
        output = destination / relative_path
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(content)
        materialized[relative_path] = output
    return materialized, _sha256(raw_manifest)


def _find_pg_bin() -> tuple[Path, int]:
    candidates: list[Path] = []
    configured = os.environ.get("FAMILY_OFFICE_PG_BIN")
    if configured:
        candidates.append(Path(configured))
    candidates.append(Path("/opt/homebrew/opt/postgresql@15/bin"))
    psql = shutil.which("psql")
    if psql:
        candidates.append(Path(psql).resolve().parent)

    for candidate in candidates:
        if not all((candidate / executable).is_file() for executable in PG_EXECUTABLES):
            continue
        version = _run([str(candidate / "postgres"), "--version"]).stdout.strip()
        match = re.search(r"PostgreSQL\)\s+(\d+)", version)
        if not match:
            match = re.search(r"PostgreSQL\s+(\d+)", version)
        if match and int(match.group(1)) >= 15:
            return candidate, int(match.group(1))
    raise GateError(
        "BLOCKED: PostgreSQL 15+ server/client tools are required; "
        "set FAMILY_OFFICE_PG_BIN to their bin directory"
    )


class LocalPostgres:
    def __init__(self, pg_bin: Path, root: Path):
        self.pg_bin = pg_bin
        self.root = root
        self.data = root / "data"
        self.socket = root / "socket"
        self.started = False

    def executable(self, name: str) -> str:
        return str(self.pg_bin / name)

    def start(self) -> None:
        self.socket.mkdir(parents=True)
        _run([self.executable("initdb"), "-D", str(self.data), "-A", "trust", "-U", "postgres"])
        _run(
            [
                self.executable("pg_ctl"),
                "-D",
                str(self.data),
                "-l",
                str(self.root / "postgres.log"),
                "-o",
                f"-k {self.socket} -h ''",
                "-w",
                "start",
            ]
        )
        self.started = True

    def stop(self) -> None:
        if self.started:
            _run(
                [self.executable("pg_ctl"), "-D", str(self.data), "-m", "fast", "-w", "stop"],
            )
            self.started = False

    def createdb(self, database: str) -> None:
        _run(
            [
                self.executable("createdb"),
                "-h",
                str(self.socket),
                "-U",
                "postgres",
                database,
            ]
        )

    def psql(
        self,
        database: str,
        *,
        sql: str | None = None,
        file: Path | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        command = [
            self.executable("psql"),
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-h",
            str(self.socket),
            "-U",
            "postgres",
            "-d",
            database,
        ]
        if file:
            command.extend(["-f", str(file)])
        return _run(command, input_text=sql, check=check)

    def dump(self, database: str, output: Path) -> None:
        _run(
            [
                self.executable("pg_dump"),
                "-h",
                str(self.socket),
                "-U",
                "postgres",
                "-Fc",
                "--no-owner",
                "--file",
                str(output),
                database,
            ]
        )

    def restore(self, database: str, backup: Path) -> None:
        _run(
            [
                self.executable("pg_restore"),
                "-h",
                str(self.socket),
                "-U",
                "postgres",
                "--no-owner",
                "--exit-on-error",
                "--dbname",
                database,
                str(backup),
            ]
        )

    def fingerprint(self, database: str) -> str:
        schema = _run(
            [
                self.executable("pg_dump"),
                "-h",
                str(self.socket),
                "-U",
                "postgres",
                "--schema-only",
                "--no-owner",
                database,
            ]
        ).stdout
        stable_schema = "\n".join(
            line
            for line in schema.splitlines()
            if not line.startswith(
                ("-- Dumped from", "-- Dumped by", "\\restrict", "\\unrestrict")
            )
        )
        data = _run(
            [
                self.executable("pg_dump"),
                "-h",
                str(self.socket),
                "-U",
                "postgres",
                "--data-only",
                "--inserts",
                "--rows-per-insert=1",
                "--no-owner",
                database,
            ]
        ).stdout
        stable_data = "\n".join(
            line
            for line in data.splitlines()
            if not line.startswith(
                ("-- Dumped from", "-- Dumped by", "\\restrict", "\\unrestrict")
            )
        )
        tables = self.psql(
            database,
            sql=(
                "select quote_ident(schemaname)||'.'||quote_ident(tablename) "
                "from pg_tables where schemaname in ('auth','public','release_gate') "
                "order by 1;"
            ),
        ).stdout.splitlines()
        counts: dict[str, int] = {}
        for table in tables:
            count = self.psql(database, sql=f"select count(*) from {table};").stdout.strip()
            counts[table] = int(count)
        payload = canonical_json(
            {
                "schema_sha256": _sha256(stable_schema.encode("utf-8")),
                "data_sha256": _sha256(stable_data.encode("utf-8")),
                "table_counts": counts,
            }
        )
        return _sha256(payload.encode("utf-8"))


BOOTSTRAP_SQL = """
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
"""

MARKER_SQL = """
create schema release_gate;
revoke all on schema release_gate from public, anon, authenticated;
create table release_gate.source_marker (seeded_at timestamptz not null);
insert into release_gate.source_marker values (clock_timestamp());
"""

WRITE_ATTEMPTS = (
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "write-a"),
    ("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "write-b"),
)


def _seed_source(
    cluster: LocalPostgres,
    database: str,
    candidate: dict[str, Path],
) -> None:
    cluster.createdb(database)
    cluster.psql(database, sql=BOOTSTRAP_SQL)
    cluster.psql(database, file=BASE_SQL[0])
    cluster.psql(database, file=candidate["backend/tests/sql/pga004_legacy_fixture.sql"])
    for sql_file in BASE_SQL[1:]:
        cluster.psql(database, file=sql_file)
    cluster.psql(database, sql=MARKER_SQL)


def _apply_candidate(
    cluster: LocalPostgres,
    database: str,
    candidate: dict[str, Path],
) -> None:
    cluster.psql(
        database,
        file=candidate["backend/sql/20260829_family_office_owner_isolation_preflight.sql"],
    )
    cluster.psql(
        database,
        file=candidate["backend/sql/20260829_family_office_owner_isolation.sql"],
    )


def _verify_write_refusal(cluster: LocalPostgres, database: str) -> None:
    for owner, suffix in WRITE_ATTEMPTS:
        result = cluster.psql(
            database,
            sql=(
                "set role authenticated; "
                f"select set_config('request.jwt.claim.sub','{owner}',false); "
                "insert into public.portfolios (id,name,owner_user_id) "
                f"values ('{suffix}','forbidden','{owner}');"
            ),
            check=False,
        )
        if result.returncode == 0 or "permission denied" not in result.stderr.lower():
            raise GateError("authenticated write refusal was not proven")
    counts = cluster.psql(
        database,
        sql=(
            "select count(*) from public.portfolios "
            "where id in ('write-a','write-b');"
        ),
    ).stdout.strip()
    if counts != "0":
        raise GateError("a forbidden authenticated write contaminated the isolate")


def _verify_rollback(
    cluster: LocalPostgres,
    database: str,
    candidate: dict[str, Path],
) -> None:
    rollback = candidate["backend/sql/20260829_family_office_owner_isolation_rollback.sql"]
    cluster.psql(database, file=rollback)
    result = cluster.psql(
        database,
        sql=(
            "select "
            "not exists (select 1 from pg_attribute "
            "where attrelid='public.portfolios'::regclass "
            "and attname='owner_user_id' and not attisdropped) "
            "and to_regclass('public.fo_accounts_owner_id_uq') is null "
            "and exists (select 1 from pg_constraint "
            "where conrelid='public.fo_accounts'::regclass "
            "and conname='fo_accounts_portfolio_id_fkey');"
        ),
    ).stdout.strip()
    if result != "t":
        raise GateError("guarded rollback did not restore the pre-migration contract")


def _run_drill(receipt_file: Path) -> dict[str, Any]:
    started_at = _utc_now()
    release_gate_sha = _git("rev-parse", "HEAD")
    if not SHA_RE.fullmatch(release_gate_sha):
        raise GateError("release gate HEAD is not an exact Git SHA")
    pg_bin, postgres_major = _find_pg_bin()

    result: dict[str, Any] = {}
    with tempfile.TemporaryDirectory(
        prefix="astrocyte-family-office-gate-", dir="/tmp"
    ) as temporary:
        temporary_path = Path(temporary)
        candidate_dir = temporary_path / "candidate"
        candidate, candidate_manifest_sha256 = materialize_candidate(candidate_dir)
        backup = temporary_path / "family-office-pre-migration.dump"
        cluster = LocalPostgres(pg_bin, temporary_path / "postgres")
        try:
            _stage("postgres_start")
            cluster.start()
            _stage("source_seed")
            _seed_source(cluster, "family_office_source", candidate)
            _stage("source_fingerprint")
            source_fingerprint = cluster.fingerprint("family_office_source")
            seed_completed = time.monotonic()
            _stage("logical_backup")
            cluster.dump("family_office_source", backup)
            backup_completed = time.monotonic()
            backup_sha256 = _sha256(backup.read_bytes())

            _stage("isolated_restore")
            cluster.createdb("family_office_isolated")
            restore_started = time.monotonic()
            cluster.restore("family_office_isolated", backup)
            _stage("restored_fingerprint")
            restored_fingerprint = cluster.fingerprint("family_office_isolated")
            restore_completed = time.monotonic()
            if restored_fingerprint != source_fingerprint:
                raise GateError("logical backup/restore fingerprint mismatch")

            _stage("candidate_migration")
            _apply_candidate(cluster, "family_office_isolated", candidate)
            _stage("owner_isolation")
            isolation_result = cluster.psql(
                "family_office_isolated",
                file=candidate["backend/tests/sql/pga004_owner_isolation_test.sql"],
            )
            if "PGA-004 PostgreSQL owner isolation tests: PASS" not in isolation_result.stdout:
                raise GateError("candidate A/B isolation test did not produce PASS")
            _stage("write_isolation")
            _verify_write_refusal(cluster, "family_office_isolated")

            _stage("unsafe_rollback_refusal")
            unsafe_rollback = cluster.psql(
                "family_office_isolated",
                file=candidate["backend/sql/20260829_family_office_owner_isolation_rollback.sql"],
                check=False,
            )
            if (
                unsafe_rollback.returncode == 0
                or "more than one owner profile exists" not in unsafe_rollback.stderr
            ):
                raise GateError("unsafe multi-owner rollback was not refused")

            _stage("rollback_restore")
            cluster.createdb("family_office_rollback")
            cluster.restore("family_office_rollback", backup)
            _stage("rollback_apply")
            _apply_candidate(cluster, "family_office_rollback", candidate)
            _stage("rollback_verify")
            _verify_rollback(cluster, "family_office_rollback", candidate)

            result = {
                "schema_version": "astrocyte_family_office_local_restore_receipt_v1",
                "status": "PASS",
                "started_at": started_at,
                "release_gate_sha": release_gate_sha,
                "candidate_sha": EXPECTED_CANDIDATE_SHA,
                "candidate_manifest_sha256": candidate_manifest_sha256,
                "migration_sha256": EXPECTED_MIGRATION_SHA256,
                "backup_sha256": backup_sha256,
                "source_fingerprint_sha256": source_fingerprint,
                "restored_fingerprint_sha256": restored_fingerprint,
                "restore_mode": "LOCAL_ISOLATED_DATABASE",
                "postgres_major": postgres_major,
                "rpo_seconds": round(backup_completed - seed_completed, 6),
                "rto_seconds": round(restore_completed - restore_started, 6),
                "owner_identity_count": 2,
                "read_isolation": True,
                "write_isolation": True,
                "composite_constraints": True,
                "rls_grants_views": True,
                "rollback_verified": True,
                "unsafe_rollback_refused": True,
                "outbound_side_effects": False,
            }
        finally:
            _stage("cleanup")
            cluster.stop()

    result["completed_at"] = _utc_now()
    result["cleanup_status"] = "DELETED"
    try:
        validated = validate_local_receipt(
            result,
            expected_candidate_sha=EXPECTED_CANDIDATE_SHA,
        )
    except LocalReceiptError as exc:
        raise GateError(str(exc)) from exc
    receipt_file.parent.mkdir(parents=True, exist_ok=True)
    receipt_file.write_text(
        json.dumps(validated, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    return validated


def preflight() -> tuple[int, str]:
    manifest, _ = _load_candidate_manifest()
    with tempfile.TemporaryDirectory(
        prefix="astrocyte-family-office-preflight-", dir="/tmp"
    ) as temporary:
        materialize_candidate(Path(temporary))
    _, postgres_major = _find_pg_bin()
    for path in BASE_SQL:
        if not path.is_file():
            raise GateError(f"required base SQL is missing: {path.relative_to(ROOT)}")
    return postgres_major, manifest["candidate_sha"]


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight", action="store_true")
    mode.add_argument("--run", action="store_true")
    parser.add_argument("--receipt-file")
    args = parser.parse_args()
    try:
        if args.preflight:
            postgres_major, candidate_sha = preflight()
            print(
                "Family Office release gate preflight PASS "
                f"postgres_major={postgres_major} candidate_sha={candidate_sha}"
            )
            return 0
        if not args.receipt_file:
            raise GateError("--receipt-file is required with --run")
        receipt = _run_drill(Path(args.receipt_file).resolve())
        print(
            "Family Office local release gate PASS "
            f"candidate_sha={receipt['candidate_sha']} "
            "restore_mode=LOCAL_ISOLATED_DATABASE outbound_side_effects=false"
        )
        return 0
    except GateError as exc:
        parser.error(str(exc))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
