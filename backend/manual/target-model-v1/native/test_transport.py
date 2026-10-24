"""Offline renderer tests + rejection by a private Unix-only PostgreSQL fixture."""
import copy,datetime as dt,importlib.util,json,os,pathlib,socket,subprocess,sys,tempfile,unittest
from unittest import mock
import transport as t
P2=pathlib.Path(__file__).resolve().parents[1]/'p2'
PG_BIN=os.environ.get('ASTROCYTE_TEST_PG_BIN')
NOW=dt.datetime(2026,10,24,8,tzinfo=dt.timezone.utc)
def binding():
 return {'project_ref':'a'*20,'host':'db.'+'a'*20+'.supabase.co','port':5432,'database':'postgres','user':'postgres',
 'system_identifier':'123456','server_version_num':170006,'catalog_sha256':'1'*64,
 'issued_at':'2026-10-24T07:00:00Z','expires_at':'2026-10-24T09:00:00Z','operation_id':'11111111-1111-4111-8111-111111111111',
 'backup_receipt_sha256':'2'*64,'restoration_receipt_sha256':'3'*64,'source_commit':'4'*40}
def build(b=None,**kw):return t.build_plan(P2,binding() if b is None else b,ca_file='/protected/ca.crt',pass_file='/protected/password',now=NOW,client_bin=pathlib.Path(PG_BIN) if PG_BIN else None,**kw)
class PlanTests(unittest.TestCase):
 def setUp(self):
  # Pure renderer fixture, not a qualified/executable client. Never used by the local SQL rehearsal.
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  binary=pathlib.Path(self.temp.name).resolve();(binary/'psql').write_bytes(b'synthetic offline unit fixture')
  original=t.load_p2
  def fixture(folder,client_bin=None):
   module,files=original(folder)
   module.BIN=binary;module.PSQL_SHA=t.digest((binary/'psql').read_bytes())
   return module,files
  patch=mock.patch.object(t,'load_p2',side_effect=fixture);patch.start();self.addCleanup(patch.stop)

 def test_native_policy_and_no_ambient_credentials(self):
  with mock.patch.dict(os.environ,{'PGOPTIONS':'-c role=evil','PGSERVICE':'evil','PGPASSWORD':'synthetic-secret'}):p=build()
  self.assertEqual(set(p['env']),{'PATH','LC_ALL','PGPASSFILE'});self.assertNotIn('synthetic-secret',json.dumps(p))
  self.assertIn('sslmode=verify-full',p['argv'][-1]);self.assertIn('ssl_min_protocol_version=TLSv1.2',p['argv'][-1]);self.assertIn('gssencmode=disable',p['argv'][-1]);self.assertIn('-X',p['argv']);self.assertIn('-w',p['argv']);self.assertFalse(p['real_execution_authorized'])
 def test_no_connection_subprocess_or_secret_read(self):
  original=pathlib.Path.read_bytes
  def read(p):
   self.assertFalse(str(p).startswith('/protected/'));return original(p)
  with mock.patch.object(socket,'socket',side_effect=AssertionError('socket forbidden')),mock.patch.object(subprocess,'run',side_effect=AssertionError('subprocess forbidden')),mock.patch.object(pathlib.Path,'read_bytes',read):p=build()
  self.assertEqual(p['status'],'PREPARED_NOT_EXECUTED')
 def test_target_rejections(self):
  cases={'host':['db.other.supabase.co','127.0.0.1','pooler.supabase.com','good host=evil'],
    'port':[6543,True,'5432'],'user':["postgres';select 1;--",'postgres\n','postgres password=x'],
    'database':['postgres\n\\!cmd','postgres service=other'],'system_identifier':['','1;DROP TABLE x'],
    'server_version_num':[170005,170006.0],'catalog_sha256':['', 'F'*64],'project_ref':['a'*19,'a'*20+'\n'],
    'source_commit':['', 'z'*40],'operation_id':['bad','11111111111141118111111111111111'],
    'backup_receipt_sha256':[''],'restoration_receipt_sha256':['']}
  for key,values in cases.items():
   for v in values:
    with self.subTest(key=key,v=v):
     b=binding();b[key]=v
     with self.assertRaises(ValueError):build(b)
 def test_time_window(self):
  for issued,expires in [('2026-10-24T08:00:01Z','2026-10-24T09:00:00Z'),('2026-10-23T00:00:00Z','2026-10-25T00:00:00Z'),('2026-10-24T07:00:00Z','2026-10-24T08:00:00Z')]:
   b=binding();b.update(issued_at=issued,expires_at=expires)
   with self.assertRaises(ValueError):build(b)
  with self.assertRaises(ValueError):t.validate_binding(binding(),NOW.replace(tzinfo=None))
 def test_exact_inventory(self):
  for change in ('missing','extra'):
   b=binding();b.pop('user') if change=='missing' else b.update(password='do-not-accept')
   with self.assertRaises(ValueError):build(b)
 def test_paths_cannot_inject(self):
  for path in ['/tmp/a b','/tmp/../a','/tmp/./a','/tmp/a\nsslmode=disable','/tmp/a\'','/tmp/a\\','relative','//tmp/a','/tmp/']:
   with self.subTest(path=path):
    with self.assertRaises(ValueError):t.safe_path(path)
  with self.assertRaises(ValueError):t.build_plan(P2,binding(),ca_file='/same',pass_file='/same',now=NOW)
 def test_source_manifest_drift(self):
  p2,files=t.load_p2(P2)
  with tempfile.TemporaryDirectory() as tmp:
   dest=pathlib.Path(tmp).resolve();(dest/'candidate').mkdir()
   for name,raw in files.items():(dest/name).write_bytes(raw)
   (dest/'package-manifest-v1.json').write_bytes((P2/'package-manifest-v1.json').read_bytes())
   (dest/'candidate/preconditions.sql').write_text('select true;')
   with self.assertRaises(ValueError):t.load_p2(dest)
 def test_sql_order_and_frozen_parts(self):
  p=build();p2,files=t.load_p2(P2);parts=json.loads(files['candidate/package.json'])['parts'];sql=p['sql']
  self.assertTrue(sql.startswith('BEGIN ISOLATION LEVEL SERIALIZABLE;'))
  cursor=sql.index(files['candidate/preconditions.sql'].decode())
  for part in parts:
   self.assertEqual(t.digest(part['sql'].encode()),part['sha256']);i=sql.index(part['sql'],cursor);self.assertGreaterEqual(i,cursor);cursor=i+len(part['sql'])
  self.assertGreater(sql.index(files['candidate/postconditions.sql'].decode(),cursor),cursor-1)
  self.assertLess(sql.index('Native target identity or TLS mismatch'),sql.index('LOCK TABLE'))
  self.assertLess(sql.index('Catalog fingerprint mismatch'),sql.index(parts[0]['sql']))
  self.assertIn('pg_stat_ssl',sql);self.assertIn('pg_control_system()',sql);self.assertTrue(sql.endswith("COMMIT; SELECT '"+p['marker']+"';"));self.assertEqual(p['sql_sha256'],t.digest(sql.encode()))
 def test_deterministic_and_target_bound(self):
  p=build();self.assertEqual(p,build());b=binding();b['operation_id']='22222222-2222-4222-8222-222222222222';q=build(b);self.assertNotEqual(p['marker'],q['marker']);self.assertNotEqual(p['sql_sha256'],q['sql_sha256'])
 def test_ambiguous_outcomes_never_retry(self):
  p=build();m=p['marker'];self.assertEqual(t.classify(0,m,m),'COMMIT_ACKNOWLEDGED_REVERIFY')
  for code,out,timeout in [(1,m,False),(None,None,False),(0,'',False),(0,m,True),(0,m+'\nextra',False),(0,'A_P2_COMMIT_'+'0'*32,False)]:
   self.assertEqual(t.classify(code,out,m,timeout=timeout),'UNKNOWN_STOP_NO_RETRY')
  with self.assertRaises(ValueError):t.classify(0,'','anything')

@unittest.skipUnless(PG_BIN, "Explicit qualified PostgreSQL 17.6 path required")
class LocalRejection(unittest.TestCase):
 def test_native_script_rejects_unencrypted_local_target_before_ddl(self):
  p2,_=t.load_p2(P2,pathlib.Path(PG_BIN));sys.modules['executor']=p2
  spec=importlib.util.spec_from_file_location('p2_fixture_helpers',P2/'candidate/test_executor.py');helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)
  cls=helpers.Rehearsal
  try:
   cls.setUpClass();fixture=cls();local=fixture.new_db();b=binding();b.update(database=local['database'],system_identifier=local['system_identifier'],catalog_sha256=local['catalog_sha256']);plan=build(b)
   before=cls.raw(local['database'],p2.CATALOG);res=cls.raw(local['database'],plan['sql'],ok=False)
   self.assertNotEqual(res.returncode,0);self.assertIn('Native target identity or TLS mismatch',res.stderr);self.assertEqual(cls.raw(local['database'],p2.CATALOG),before)
   self.assertEqual(cls.raw(local['database'],"select to_regclass('public.target_sleeve_allocations') is null"),'t')
  finally:
   cls.tearDownClass()
  self.assertFalse((cls.data/'postmaster.pid').exists())
  print(json.dumps({'private_cluster':str(cls.root),'server_stopped':True,'network_access':False}))
if __name__=='__main__':unittest.main(verbosity=2)
