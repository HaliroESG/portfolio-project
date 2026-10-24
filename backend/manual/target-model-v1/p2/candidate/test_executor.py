"""Synthetic PostgreSQL 17.6 tests. No network, provider or real portfolio rows."""
import json,os,subprocess,tempfile,unittest
from pathlib import Path
from unittest import mock
import executor as e

FOLDER=Path(__file__).resolve().parent.parent
MANIFEST=e.sha((FOLDER/"package-manifest-v1.json").read_bytes())
DATA=e.read_candidate(FOLDER,MANIFEST)
PACKAGE=json.loads(DATA["candidate/package.json"])
A="11111111-1111-1111-1111-111111111111"
B="22222222-2222-2222-2222-222222222222"
C="33333333-3333-3333-3333-333333333333"
PG_BIN=os.environ.get("ASTROCYTE_TEST_PG_BIN")
ENV={"PATH":(PG_BIN or "")+":/usr/bin:/bin","LC_ALL":"C"}
EXTRA = """
create schema auth;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated,service_role;
create table public.fo_owner_profiles(user_id uuid primary key);
alter table public.fo_owner_profiles enable row level security;
create policy own_profile on public.fo_owner_profiles for select to authenticated using(user_id=auth.uid());
alter table public.fo_portfolios add column owner_user_id uuid;
alter table public.fo_portfolios enable row level security;
create policy own_portfolio on public.fo_portfolios for select to authenticated using(owner_user_id=auth.uid());
alter table public.fo_position_snapshots enable row level security;
create policy own_position on public.fo_position_snapshots for select to authenticated
 using(exists(select 1 from public.fo_portfolios p where p.id=portfolio_id));
alter table public.fo_cash_balances_daily enable row level security;
create policy own_cash on public.fo_cash_balances_daily for select to authenticated
 using(exists(select 1 from public.fo_portfolios p where p.id=portfolio_id));
alter view public.fo_positions_latest set(security_invoker=true);
alter view public.fo_cash_balances_latest set(security_invoker=true);
-- A previous 16-column view exists: exercise replacement, not only creation.
create view public.allocation_advice_items_latest as
 select m.portfolio_scope,m.id as model_id,m.model_name,m.source_file,
 b.bucket_key,b.bucket_label,null::numeric as current_value_eur,
 null::numeric as current_weight_pct,b.target_weight_pct,null::numeric as drift_pct,
 null::numeric as rebalance_amount_eur,'UNAVAILABLE'::text as action,
 0::integer as confidence,array[]::text[] as reason_codes,
 'CURRENT_UNAVAILABLE'::text as preferred_execution,m.updated_at
 from public.target_models m join public.target_buckets b on b.model_id=m.id;
alter table public.target_models enable row level security;
create policy registered_owner_models on public.target_models for select to authenticated
 using(exists(select 1 from public.fo_owner_profiles p where p.user_id=auth.uid()));
create policy service_models on public.target_models for all to service_role using(true) with check(true);
alter table public.target_buckets enable row level security;
create policy registered_owner_buckets on public.target_buckets for select to authenticated
 using(exists(select 1 from public.fo_owner_profiles p where p.user_id=auth.uid()));
create policy service_buckets on public.target_buckets for all to service_role using(true) with check(true);
grant select on all tables in schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
-- Reproduce the pre-existing expansive defaults; P2 may not change them.
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
"""
@unittest.skipUnless(PG_BIN, "Explicit qualified PostgreSQL 17.6 path required; no installation or fallback")
class Rehearsal(unittest.TestCase):
 counter=0
 @classmethod
 def setUpClass(cls):
  cls.root=Path(tempfile.mkdtemp(prefix="astrocyte-p2-",dir="/private/tmp"));cls.root.chmod(0o700)
  cls.data=cls.root/"data";cls.started=False
  e.configure_client(Path(PG_BIN))
  subprocess.run([str(e.BIN/"initdb"),"-D",str(cls.data),"-U","postgres","--no-locale","--encoding=UTF8","--auth=trust"],check=True,capture_output=True,env=ENV)
  subprocess.run([str(e.BIN/"pg_ctl"),"-D",str(cls.data),"-l",str(cls.root/"server.log"),
   "-o","-k "+str(cls.root)+" -p 55439 -c listen_addresses=''","-w","start"],check=True,capture_output=True,env=ENV)
  cls.started=True
  cls.raw("postgres","create role anon; create role authenticated; create role service_role;")
  cls.sid=cls.raw("postgres","select system_identifier from pg_control_system()")
 @classmethod
 def tearDownClass(cls):
  if cls.started:
   subprocess.run([str(e.BIN/"pg_ctl"),"-D",str(cls.data),"-m","fast","-w","stop"],check=True,capture_output=True,env=ENV)
   cls.started=False
 @classmethod
 def raw(cls,db,sql,ok=True):
  r=subprocess.run([str(e.BIN/"psql"),"-X","-w","-qAt","-v","ON_ERROR_STOP=1",
   "-h",str(cls.root),"-p","55439","-U","postgres","-d",db],input=sql,text=True,capture_output=True,env=ENV,timeout=40)
  if ok and r.returncode:raise AssertionError(r.stderr)
  return r.stdout.strip() if ok else r
 def new_db(self):
  type(self).counter+=1;db="p2_case_"+str(type(self).counter).zfill(2)
  self.raw("postgres","create database "+db)
  base=PACKAGE["fixture_sql"]
  for role in ("anon","authenticated","service_role"):
   self.assertEqual(base.count("create role "+role+";"),1)
   base=base.replace("create role "+role+";","")
  self.raw(db,base+EXTRA)
  return {"purpose":"P2_SYNTHETIC_ONLY","socket":str(self.root),"data_directory":str(self.data),
   "system_identifier":self.sid,"database":db,"user":"postgres","port":55439,
   "catalog_sha256":self.raw(db,e.CATALOG)}
 def apply(self,r,*,fault=None,label="apply"):
  path=self.root/(r["database"]+"-"+label+".intent.json")
  return e.execute_local(FOLDER,MANIFEST,r,path,fail_after=fault)
 def policy_case(self,table,kind,refuse):
  r=self.new_db();db=r["database"];reader=db+"_reader";middle=db+"_middle";granted=None
  try:
   if kind in ("public","direct"):
    policy_role="public" if kind=="public" else "authenticated"
   else:
    self.raw(db,"create role "+reader);policy_role=reader
    if kind=="inherited":
     self.raw(db,"grant "+reader+" to authenticated with inherit true, set false");granted=reader
    elif kind=="transitive":
     self.raw(db,"create role "+middle+";grant "+reader+" to "+middle+" with inherit true, set false;grant "+middle+" to authenticated with inherit true, set false");granted=middle
    elif kind=="noninherited":
     self.raw(db,"grant "+reader+" to authenticated with inherit false, set false");granted=reader
    elif kind!="unrelated":raise AssertionError(kind)
    self.assertEqual(self.raw(db,"select pg_has_role('authenticated','"+reader+"','USAGE')"),"t" if refuse else "f")
   self.raw(db,"create policy "+table+"_read on public."+table+" for select to "+policy_role+" using(true)")
   r["catalog_sha256"]=self.raw(db,e.CATALOG);global_before=self.raw(db,e.GLOBAL)
   outcome=self.apply(r)
   if refuse:
    self.assertEqual(outcome["state"],"UNKNOWN_STOP_NO_RETRY")
    self.assertNotEqual(outcome["exit_code"],0)
    self.assertIn("Legacy permissive client read policy",outcome["stderr"])
    self.assertEqual(self.raw(db,e.CATALOG),r["catalog_sha256"])
    self.assertEqual(self.raw(db,"select to_regclass('public.target_sleeve_allocations') is null"),"t")
    with self.assertRaises(FileExistsError):self.apply(r)
   else:
    self.assertEqual(outcome["state"],"APPLIED_LOCAL_ONLY")
    self.raw(db,"insert into public.target_models(id,portfolio_scope,model_name,source_file) values('perso','PERSO','Synthetic','fixture'),('pro','PRO','Synthetic','fixture');"+
     "insert into public.target_buckets(model_id,portfolio_scope,bucket_key,bucket_label,target_weight_pct) values('perso','PERSO','actions_us','Synthetic',100),('pro','PRO','actions_us','Synthetic',100)")
    for relation in ("target_models","target_buckets","allocation_advice_items_latest"):
     got=self.raw(db,"begin;set local role authenticated;select set_config('request.jwt.claim.sub','"+C+"',true);select count(*) from public."+relation+";rollback").splitlines()[1:]
     self.assertEqual(got,["0"])
   self.assertEqual(self.raw(db,e.GLOBAL),global_before)
  finally:
   if granted:self.raw("postgres","revoke "+granted+" from authenticated")
 def test_inherited_policies_are_rejected(self):
  for table in ("target_models","target_buckets"):
   for kind in ("inherited","transitive"):
    with self.subTest(table=table,kind=kind):self.policy_case(table,kind,True)
 def test_direct_and_public_policies_stay_rejected(self):
  for table in ("target_models","target_buckets"):
   for kind in ("direct","public"):
    with self.subTest(table=table,kind=kind):self.policy_case(table,kind,True)
 def test_roles_without_effective_usage_do_not_open_reads(self):
  for table in ("target_models","target_buckets"):
   for kind in ("unrelated","noninherited"):
    with self.subTest(table=table,kind=kind):self.policy_case(table,kind,False)
 def test_valid_empty_contract_and_effective_acl(self):
  r=self.new_db();db=r["database"];before=self.raw(db,e.GLOBAL)
  self.assertEqual(self.apply(r)["state"],"APPLIED_LOCAL_ONLY")
  self.assertEqual(self.raw(db,e.GLOBAL),before)
  self.assertEqual(self.raw(db,"select count(*) from public.target_models"),"0")
  for role in ("anon","authenticated","service_role"):
   for privilege in ("SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER","MAINTAIN"):
    expected=role=="authenticated" and privilege=="SELECT" or role=="service_role" and privilege in ("SELECT","INSERT","UPDATE","DELETE")
    got=self.raw(db,"select has_table_privilege('"+role+"','public.target_sleeve_allocations','"+privilege+"')")
    self.assertEqual(got,"t" if expected else "f")
   for privilege in ("USAGE","SELECT","UPDATE"):
    got=self.raw(db,"select has_sequence_privilege('"+role+"','public.target_sleeve_allocations_id_seq','"+privilege+"')")
    self.assertEqual(got,"t" if role=="service_role" and privilege!="UPDATE" else "f")
  for role in ("anon","authenticated"):
   self.assertEqual(self.raw(db,"select has_function_privilege('"+role+"','public.apply_target_model_v1(jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')"),"f")
  self.assertEqual(self.raw(db,"select has_table_privilege('authenticated','public.allocation_advice_items_latest','UPDATE')"),"f")
 def test_each_component_failure_rolls_back_whole_catalog(self):
  for checkpoint in range(1,5):
   r=self.new_db()
   self.assertEqual(self.apply(r,fault=checkpoint)["state"],"UNKNOWN_STOP_NO_RETRY")
   self.assertEqual(self.raw(r["database"],e.CATALOG),r["catalog_sha256"])
 def test_incompatible_object_and_legacy_policy_fail_closed(self):
  changes=["create table public.target_sleeve_allocations(wrong integer)",
           "insert into public.target_models(id,portfolio_scope,model_name,source_file) values('existing','PERSO','Synthetic','fixture')",
           "create policy target_models_read on public.target_models for select to authenticated using(true)"]
  for change in changes:
   r=self.new_db();self.raw(r["database"],change)
   r["catalog_sha256"]=self.raw(r["database"],e.CATALOG)
   self.assertEqual(self.apply(r)["state"],"UNKNOWN_STOP_NO_RETRY")
   self.assertEqual(self.raw(r["database"],e.CATALOG),r["catalog_sha256"])
 def test_catalog_drift_and_repeat_do_not_mutate(self):
  r=self.new_db();self.raw(r["database"],"alter table public.target_models add column unknown integer")
  changed=self.raw(r["database"],e.CATALOG)
  self.assertEqual(self.apply(r)["state"],"UNKNOWN_STOP_NO_RETRY")
  self.assertEqual(self.raw(r["database"],e.CATALOG),changed)
  r=self.new_db();self.assertEqual(self.apply(r)["state"],"APPLIED_LOCAL_ONLY")
  with self.assertRaises(FileExistsError):self.apply(r)
  r["catalog_sha256"]=self.raw(r["database"],e.CATALOG)
  self.assertEqual(self.apply(r,label="second")["state"],"UNKNOWN_STOP_NO_RETRY")
  self.assertEqual(self.raw(r["database"],e.CATALOG),r["catalog_sha256"])
 def test_owner_and_portfolio_boundaries_with_unknown_models(self):
  r=self.new_db();db=r["database"];self.assertEqual(self.apply(r)["state"],"APPLIED_LOCAL_ONLY")
  self.raw(db,"insert into public.fo_owner_profiles values('"+A+"'),('"+B+"');"+
   "insert into public.fo_portfolios values('A-PERSO','PERSONAL','"+A+"'),('A-PRO','PROFESSIONAL','"+A+"'),('B-PERSO','PERSONAL','"+B+"');"+
   "insert into public.fo_cash_balances_daily(portfolio_id,account_id,balance_date,currency,balance_local,balance_eur,data_state) values"+
   "('A-PERSO','a',current_date,'EUR',100,100,'READY'),('A-PRO','a',current_date,'EUR',200,200,'READY'),('B-PERSO','b',current_date,'EUR',300,300,'READY');"+
   "insert into public.target_models(id,portfolio_scope,model_name,source_file) values('perso','PERSO','Synthetic','fixture'),('pro','PRO','Synthetic','fixture');"+
   "insert into public.target_buckets(model_id,portfolio_scope,bucket_key,bucket_label,target_weight_pct) values('perso','PERSO','actions_us','Synthetic',100),('pro','PRO','actions_us','Synthetic',100);"+
   "insert into public.target_sleeve_allocations(model_id,portfolio_scope,sleeve_key,component_label,bucket_key,bucket_label,target_weight_pct) values('pro','PRO','CORE','Synthetic','actions_us','Synthetic',70);")
  def client(uid,sql):
   return self.raw(db,"begin;set local role authenticated;select set_config('request.jwt.claim.sub','"+uid+"',true);"+sql+";rollback").splitlines()[1:]
  self.assertEqual(client(A,"select distinct portfolio_id from public.allocation_advice_items_latest where portfolio_id is not null order by portfolio_id"),["A-PERSO","A-PRO"])
  self.assertEqual(client(B,"select distinct portfolio_id from public.allocation_advice_items_latest where portfolio_id is not null order by portfolio_id"),["B-PERSO"])
  self.assertEqual(client(C,"select count(*) from public.target_sleeve_allocations"),["0"])
  self.assertEqual(client(C,"select count(*) from public.allocation_advice_items_latest"),["0"])
  self.assertEqual(client(A,"select count(*) from public.allocation_advice_items_latest where action<>'UNAVAILABLE'"),["0"])
  for sql in ("update public.target_sleeve_allocations set target_weight_pct=1","select nextval('public.target_sleeve_allocations_id_seq')"):
   self.assertNotEqual(self.raw(db,"set role authenticated;"+sql,ok=False).returncode,0)
 def test_interrupted_connection_rolls_back_and_stops(self):
  r=self.new_db();original=e.assemble
  with mock.patch.object(e,"assemble",side_effect=lambda *a,**kw:original(*a,**kw).replace("COMMIT; SELECT","SELECT pg_terminate_backend(pg_backend_pid()); COMMIT; SELECT")):
   self.assertEqual(self.apply(r)["state"],"UNKNOWN_STOP_NO_RETRY")
  self.assertEqual(self.raw(r["database"],e.CATALOG),r["catalog_sha256"])
 def test_wrong_target_and_timeout_do_not_retry(self):
  r=self.new_db()
  for bad in ({**r,"purpose":"SUPABASE"},{**r,"socket":"127.0.0.1"},{**r,"database":"postgres"},{**r,"user":"service_role"}):
   with self.assertRaises(ValueError):e.connection(bad)
  wrong={**r,"system_identifier":str(int(r["system_identifier"])+1)}
  self.assertEqual(self.apply(wrong,label="wrong-identity")["state"],"UNKNOWN_STOP_NO_RETRY")
  self.assertEqual(self.raw(r["database"],e.CATALOG),r["catalog_sha256"])
  with mock.patch.object(e.subprocess,"run",side_effect=subprocess.TimeoutExpired("psql",75)) as run:
   self.assertEqual(self.apply(r)["state"],"UNKNOWN_STOP_NO_RETRY")
   self.assertEqual(run.call_count,1)
   self.assertNotIn("PGHOST",run.call_args.kwargs["env"])
 def test_modified_package_and_sql_order_rejected(self):
  with self.assertRaises(ValueError):e.read_candidate(FOLDER,"0"*64)
  self.assertEqual(tuple(x["sha256"] for x in PACKAGE["parts"]),e.PART_HASHES)
  self.assertTrue(all(e.sha(x["sql"].encode())==x["sha256"] for x in PACKAGE["parts"]))

if __name__=="__main__":
 suite=unittest.defaultTestLoader.loadTestsFromTestCase(Rehearsal)
 result=unittest.TextTestRunner(verbosity=2).run(suite)
 print(json.dumps({"status":"PASS" if result.wasSuccessful() else "FAIL","tests":result.testsRun,
  "failures":len(result.failures),"errors":len(result.errors),"source_access":False,
  "server_stopped":not Rehearsal.started,"cluster":str(getattr(Rehearsal,"root",""))}))
 raise SystemExit(0 if result.wasSuccessful() else 1)

