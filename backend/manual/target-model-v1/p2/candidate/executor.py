"""Pinned, offline-only SQL/ACL rehearsal. No remote adapter or ambient credentials."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

FILES = ("candidate/README.md", "candidate/executor.py", "candidate/package.json",
         "candidate/postconditions.sql", "candidate/preconditions.sql", "candidate/test_executor.py")
PART_HASHES = (
 "1a33510cd41de6e82da04fc978b17e0f1b2ee503c2f43199fa7c19b31f48d1dd",
 "070954c316d241caceb9e4615867b19f613b4a9f19549317064cfc2d1f0fdf35", "b793fc4e12bc2dbc80c6c15cef6dcbb742b9fdb2667d5ad621e6ee353f815f9d",
 "0fb8c64ec8878d48e289e8f72874046992f84e410848c41c1f853c45cbf02995")
BIN: Path | None = None
PSQL_SHA = "1f4a63f18865d26ef3b421cca2df6336fb1ea53fc69cc164f2705f64aa5f6053"
def configure_client(binary_directory: Path) -> None:
    """Select the already-qualified client explicitly; never read ambient credentials."""
    global BIN
    path = Path(binary_directory)
    if (not path.is_absolute() or path.resolve() != path
            or hashlib.sha256((path / "psql").read_bytes()).hexdigest() != PSQL_SHA):
        raise ValueError("Explicit qualified PostgreSQL client required")
    BIN = path

# Catalog-only fingerprint: no business row or credential values are returned.
CATALOG = """
SELECT encode(sha256(convert_to(jsonb_build_object(
'relations',(SELECT jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relowner,c.relrowsecurity,
 c.relforcerowsecurity,c.relacl,c.reloptions,CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid) END)
 ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace='public'::regnamespace),
'columns',(SELECT jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),
 a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum)
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped),
'constraints',(SELECT jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid))
 ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE connamespace='public'::regnamespace),
'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid::regclass::text)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relnamespace='public'::regnamespace),
'policies',(SELECT jsonb_agg(jsonb_build_array(polrelid::regclass::text,polname,polcmd,polpermissive,
 polroles,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polrelid::regclass::text,polname)
 FROM pg_policy WHERE polrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)),
'functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,p.proowner,p.proacl,pg_get_functiondef(p.oid))
 ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('public','auth') AND p.prokind='f'),
'roles',(SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,
 rolcanlogin,rolreplication,rolbypassrls,rolconfig) ORDER BY rolname) FROM pg_roles),
'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),
'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d)
)::text,'UTF8')),'hex')
"""
GLOBAL = """
SELECT jsonb_build_object(
'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM pg_roles r),
'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),
'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY oid) FROM pg_default_acl d)) AS state
"""
def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def read_candidate(folder: Path, manifest_sha256: str) -> dict[str, bytes]:
    folder = folder.resolve()
    raw = (folder / "package-manifest-v1.json").read_bytes()
    if sha(raw) != manifest_sha256:
        raise ValueError("Package manifest mismatch")
    rows = json.loads(raw)["files"]
    if len(rows) != len(FILES) or {r["path"] for r in rows} != set(FILES):
        raise ValueError("Package inventory mismatch")
    result = {}
    for row in rows:
        path = folder / row["path"]
        if path.resolve() != path or not path.is_file():
            raise ValueError("Aliased or missing package file")
        data = path.read_bytes()
        if sha(data) != row["sha256"]:
            raise ValueError("Package file mismatch")
        result[row["path"]] = data
    package = json.loads(result["candidate/package.json"])
    if tuple(x["sha256"] for x in package["parts"]) != PART_HASHES:
        raise ValueError("SQL component order or provenance mismatch")
    for part in package["parts"]:
        if sha(part["sql"].encode()) != part["sha256"]:
            raise ValueError("SQL bytes changed")
    return result

def connection(receipt: dict) -> list[str]:
    if receipt.get("purpose") != "P2_SYNTHETIC_ONLY":
        raise ValueError("Only isolated synthetic rehearsal is supported")
    socket = Path(receipt["socket"])
    data = Path(receipt["data_directory"])
    if (not str(socket).startswith("/private/tmp/astrocyte-p2-")
        or socket.resolve() != socket or not socket.is_dir()
        or socket.stat().st_uid != os.getuid() or socket.stat().st_mode & 0o077
        or data.resolve() != data or data != socket / "data"
        or not (data / "postmaster.pid").is_file()):
        raise ValueError("Private local cluster binding rejected")
    if (not re.fullmatch(r"p2_case_[0-9]{2}", receipt["database"])
        or receipt.get("user") != "postgres" or receipt.get("port") != 55439
        or not re.fullmatch(r"[0-9]+", receipt["system_identifier"])
        or not re.fullmatch(r"[0-9a-f]{64}", receipt["catalog_sha256"])):
        raise ValueError("Target identity rejected")
    if BIN is None or BIN.resolve() != BIN or sha((BIN / "psql").read_bytes()) != PSQL_SHA:
        raise ValueError("Pinned PostgreSQL client changed")
    return [str(BIN/"psql"),"-X","-w","-qAt","-v","ON_ERROR_STOP=1",
            "-h",str(socket),"-p","55439","-U","postgres","-d",receipt["database"]]

def assemble(files: dict[str, bytes], receipt: dict, *, fail_after: int | None = None) -> str:
    # Fault injection only adds a deliberate SQL error; it never skips a check.
    if fail_after not in (None, 1, 2, 3, 4):
        raise ValueError("Invalid failure checkpoint")
    catalog = receipt["catalog_sha256"]
    sid = receipt["system_identifier"]
    database = receipt["database"]
    if not re.fullmatch(r"[0-9a-f]{64}",catalog) or not re.fullmatch(r"[0-9]+",sid) or not re.fullmatch(r"p2_case_[0-9]{2}",database):
        raise ValueError("Invalid SQL binding")
    body = ["BEGIN ISOLATION LEVEL SERIALIZABLE;",
            "SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='30s';",
            "LOCK TABLE public.target_models,public.target_buckets,public.target_envelope_lines,public.target_model_audit_holdings IN ACCESS EXCLUSIVE MODE;",
            "LOCK TABLE public.fo_owner_profiles,public.fo_portfolios,public.fo_position_snapshots,public.fo_cash_balances_daily,public.fo_instruments IN ACCESS SHARE MODE;",
            "DO $identity$ BEGIN IF current_database() <> '"+database+"' OR current_user <> 'postgres' OR inet_server_addr() IS NOT NULL OR current_setting('server_version_num') <> '170006' OR (SELECT system_identifier::text FROM pg_control_system()) <> '"+sid+"' THEN RAISE EXCEPTION 'Local target identity mismatch'; END IF; IF ("+CATALOG+") <> '"+catalog+"' THEN RAISE EXCEPTION 'Catalog fingerprint mismatch'; END IF; END $identity$;",
            "CREATE TEMP TABLE p2_global_before ON COMMIT DROP AS "+GLOBAL+";",
            files["candidate/preconditions.sql"].decode()]
    for i, part in enumerate(json.loads(files["candidate/package.json"])["parts"],1):
        body.append(part["sql"])
        if fail_after == i:
            body.append("SELECT 1/0; -- deliberate offline rollback test")
    body.extend([files["candidate/postconditions.sql"].decode(),
                 "DO $global$ BEGIN IF (SELECT state FROM p2_global_before) IS DISTINCT FROM ("+GLOBAL+") THEN RAISE EXCEPTION 'Global role/default privilege drift'; END IF; END $global$;",
                 "COMMIT; SELECT 'P2_APPLIED_LOCAL_ONLY';"])
    return "\n".join(body)

def execute_local(folder: Path, manifest_sha256: str, receipt: dict, intent: Path,
                  *, fail_after: int | None = None) -> dict:
    files = read_candidate(folder, manifest_sha256)
    cmd = connection(receipt)
    sql = assemble(files, receipt, fail_after=fail_after)
    # Consumption is write-once. Never retry after an uncertain outcome.
    with intent.open("x",encoding="utf8") as f:
        os.chmod(intent,0o600)
        json.dump({"state":"CONSUMED","package_sha256":manifest_sha256,
                   "database":receipt["database"],"system_identifier":receipt["system_identifier"],
                   "sql_sha256":sha(sql.encode())},f)
        f.flush();os.fsync(f.fileno())
    state = "UNKNOWN_STOP_NO_RETRY"
    try:
        result = subprocess.run(cmd,input=sql,text=True,capture_output=True,timeout=75,
                                env={"PATH":str(BIN)+":/usr/bin:/bin","LC_ALL":"C"})
        if result.returncode == 0 and result.stdout.strip().splitlines()[-1:] == ["P2_APPLIED_LOCAL_ONLY"]:
            state = "APPLIED_LOCAL_ONLY"
        outcome = {"state":state,"exit_code":result.returncode,"package_sha256":manifest_sha256,
                   "stderr":result.stderr[-1600:],"source_access":False}
    except (subprocess.TimeoutExpired, OSError) as error:
        outcome = {"state":state,"error_type":type(error).__name__,"package_sha256":manifest_sha256,
                   "source_access":False}
    with intent.with_suffix(".outcome.json").open("x",encoding="utf8") as f:
        json.dump(outcome,f)
    return outcome

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--folder",type=Path,default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--manifest-sha256",required=True)
    args = parser.parse_args()
    files = read_candidate(args.folder,args.manifest_sha256)
    print(json.dumps({"status":"VERIFIED_NOT_EXECUTED","parts":len(json.loads(files["candidate/package.json"])["parts"]),
                      "supabase_adapter":False,"activation":False}))
if __name__ == "__main__":
    main()

