"""Build a sealed plan for native psql. This module never connects or executes SQL.

A valid plan is NOT authority to execute. Phase C must supply fresh protected
identity/recovery evidence and phase D must authorize its exact bytes separately.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import uuid

P2_MANIFEST = 'c09cd177f80cd245642519fffe7b4056de2134cc147893409161487392f77911'
P2_EXECUTOR = '2bc9028463304db252ab2d312e7489cf0d80c0c33219157defc85a65727a0fb8'
KEYS = {'project_ref','host','port','database','user','system_identifier',
        'server_version_num','catalog_sha256','issued_at','expires_at','operation_id',
        'backup_receipt_sha256','restoration_receipt_sha256','source_commit'}
SHA = re.compile(r'[0-9a-f]{64}')
NAME = re.compile(r'[a-z_][a-z0-9_]{0,62}')
PATH = re.compile(r'/[A-Za-z0-9_./-]+')

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def canonical(obj: object) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(',',':'), allow_nan=False).encode()

def load_p2(folder: Path, client_bin: Path | None = None):
    folder = Path(folder)
    if not folder.is_absolute() or folder.resolve() != folder:
        raise ValueError('P2 folder must be canonical')
    ep = folder/'candidate/executor.py'
    if ep.resolve() != ep or digest(ep.read_bytes()) != P2_EXECUTOR:
        raise ValueError('P2 loader changed')
    spec = importlib.util.spec_from_file_location('frozen_p2_for_native_plan',ep)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if client_bin is not None:
        module.configure_client(client_bin)
    return module, module.read_candidate(folder,P2_MANIFEST)

def utc(value: str) -> dt.datetime:
    if not isinstance(value,str) or not value.endswith('Z'):
        raise ValueError('UTC timestamp required')
    parsed=dt.datetime.fromisoformat(value[:-1]+'+00:00')
    if parsed.utcoffset()!=dt.timedelta(0):raise ValueError('UTC required')
    return parsed

def validate_binding(binding: dict, now: dt.datetime) -> None:
    if not isinstance(binding,dict) or set(binding)!=KEYS:
        raise ValueError('Exact target binding fields required')
    if now.tzinfo is None or now.utcoffset()!=dt.timedelta(0):
        raise ValueError('Current UTC observation required')
    if not isinstance(binding['project_ref'],str) or not re.fullmatch(r'[a-z]{20}',binding['project_ref']):
        raise ValueError('Project reference invalid')
    if binding['host']!='db.'+binding['project_ref']+'.supabase.co' or type(binding['port']) is not int or binding['port']!=5432:
        raise ValueError('Only pinned direct host and port supported; no pooler/fallback')
    for key in ('database','user'):
        if not isinstance(binding[key],str) or not NAME.fullmatch(binding[key]):
            raise ValueError('Invalid SQL identity')
    if not isinstance(binding['system_identifier'],str) or not re.fullmatch(r'[1-9][0-9]{0,19}',binding['system_identifier']):
        raise ValueError('System identifier missing')
    if type(binding['server_version_num']) is not int or binding['server_version_num']!=170006:
        raise ValueError('Unqualified server version; stop, do not coerce')
    for key in ('catalog_sha256','backup_receipt_sha256','restoration_receipt_sha256'):
        if not isinstance(binding[key],str) or not SHA.fullmatch(binding[key]):
            raise ValueError('Missing protected evidence digest')
    if not isinstance(binding['source_commit'],str) or not re.fullmatch(r'[0-9a-f]{40}',binding['source_commit']):
        raise ValueError('Versioned source commit required')
    if str(uuid.UUID(binding['operation_id']))!=binding['operation_id']:
        raise ValueError('Canonical unique operation UUID required')
    issued,expires=utc(binding['issued_at']),utc(binding['expires_at'])
    if not issued<=now<expires or expires-issued>dt.timedelta(hours=24):
        raise ValueError('Expired or overlong target evidence')

def safe_path(value: str) -> str:
    if not isinstance(value,str) or not PATH.fullmatch(value) or any(p in {'.','..'} for p in value.split('/')[1:]) or '//' in value or value.endswith('/'):
        raise ValueError('Canonical absolute credential path required')
    return value

def build_plan(folder: Path, binding: dict, *, ca_file: str, pass_file: str,
               now: dt.datetime, client_bin: Path | None = None) -> dict:
    """Pure offline renderer: does not read either credential file or the network.

    Digests provided by the caller are bindings, NOT backup or authority proofs.
    Credential ownership/mode/content, live identity and window exclusivity must
    be checked by the separately authorized operator immediately before execution.
    """
    validate_binding(binding,now)
    ca_file,pass_file=safe_path(ca_file),safe_path(pass_file)
    if ca_file==pass_file:raise ValueError('Separate CA and password files required')
    p2,files=load_p2(folder,client_bin)
    if p2.BIN is None:
        raise ValueError("Explicit qualified client path required")
    if digest((p2.BIN/'psql').read_bytes())!=p2.PSQL_SHA:
        raise ValueError('Native client drift')
    # Grammar-restricted literals: no SQL quoting, URI, shell, keyword or newline input.
    database,user,sid=binding['database'],binding['user'],binding['system_identifier']
    catalog=binding['catalog_sha256'];operation=uuid.UUID(binding['operation_id']).hex
    marker='A_P2_COMMIT_'+operation
    identity=f"""DO $identity$ BEGIN
IF current_database() <> '{database}' OR current_user <> '{user}'
 OR inet_server_addr() IS NULL OR current_setting('server_version_num') <> '170006'
 OR (SELECT system_identifier::text FROM pg_control_system()) <> '{sid}'
 OR NOT EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl IS TRUE)
 THEN RAISE EXCEPTION 'Native target identity or TLS mismatch'; END IF;
END $identity$;"""
    lock_sql='''LOCK TABLE public.target_models,public.target_buckets,public.target_envelope_lines,public.target_model_audit_holdings IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.fo_owner_profiles,public.fo_portfolios,public.fo_position_snapshots,public.fo_cash_balances_daily,public.fo_instruments IN ACCESS SHARE MODE;'''
    body=['BEGIN ISOLATION LEVEL SERIALIZABLE;',
          "SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='30s';",
          identity,lock_sql,
          "DO $catalog$ BEGIN IF ("+p2.CATALOG+") <> '"+catalog+"' THEN RAISE EXCEPTION 'Catalog fingerprint mismatch'; END IF; END $catalog$;",
          'CREATE TEMP TABLE p2_global_before ON COMMIT DROP AS '+p2.GLOBAL+';',
          files['candidate/preconditions.sql'].decode()]
    parts=json.loads(files['candidate/package.json'])['parts']
    body.extend(part['sql'] for part in parts)
    body.extend([files['candidate/postconditions.sql'].decode(),
        "DO $global$ BEGIN IF (SELECT state FROM p2_global_before) IS DISTINCT FROM ("+p2.GLOBAL+") THEN RAISE EXCEPTION 'Global role/default privilege drift'; END IF; END $global$;",
        "COMMIT; SELECT '"+marker+"';"])
    sql='\n'.join(body)
    conn=(f"host={binding['host']} port=5432 dbname={database} user={user} "
          f"sslmode=verify-full sslrootcert={ca_file} ssl_min_protocol_version=TLSv1.2 "
          "gssencmode=disable connect_timeout=10 application_name=astrocyte_schema_once")
    argv=[str(p2.BIN/'psql'),'-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse','-d',conn]
    # Entire replacement environment, never merge with os.environ.
    env={'PATH':str(p2.BIN)+':/usr/bin:/bin','LC_ALL':'C','PGPASSFILE':pass_file}
    return {'schema':'astrocyte_native_plan_v1','status':'PREPARED_NOT_EXECUTED',
        'real_execution_authorized':False,'binding':dict(binding),'binding_sha256':digest(canonical(binding)),
        'p2_package_sha256':P2_MANIFEST,'sql':sql,'sql_sha256':digest(sql.encode()),
        'argv':argv,'env':env,'client_sha256':p2.PSQL_SHA,'marker':marker,
        'io_policy':{'stdin':'sealed_sql_bytes','stdout':'private_ephemeral','stderr':'private_ephemeral',
                     'wall_timeout_seconds':75,'retry':False,'persistent_raw_logs':False}}

def classify(exit_code: int | None, stdout: str | None, marker: str, *, timeout: bool=False) -> str:
    """Process acknowledgement only, never an independent post-commit verification."""
    if not isinstance(marker,str) or not re.fullmatch(r'A_P2_COMMIT_[0-9a-f]{32}',marker):
        raise ValueError('Invalid acknowledgement binding')
    if not timeout and type(exit_code) is int and exit_code==0 and isinstance(stdout,str) and stdout.strip().splitlines()[-1:]==[marker]:
        return 'COMMIT_ACKNOWLEDGED_REVERIFY'
    return 'UNKNOWN_STOP_NO_RETRY'

if __name__=='__main__':
    print(json.dumps({'status':'OFFLINE_PLAN_BUILDER_ONLY','network_calls':0,'execution_available':False}))
