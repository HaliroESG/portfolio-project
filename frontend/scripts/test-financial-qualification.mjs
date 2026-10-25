import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
const require=createRequire(import.meta.url)
const root=path.resolve(import.meta.dirname,'..')
const source=fs.readFileSync(path.join(root,'lib/financialQualification.ts'),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const mod={exports:{}};new Function('exports','require','module',compiled)(mod.exports,require,mod)
const q=mod.exports
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'../backend/tests/fixtures/financial_qualification_v1.json')))
const py=spawnSync('python3.11',['-B','-c',`import sys,json;sys.path.insert(0,'tests');from source_contracts_offline_guard import install;install();from financial_qualification import qualification;print(json.dumps([qualification(c['family'],c['row']) for c in json.load(sys.stdin)],allow_nan=False))`],{cwd:path.join(root,'../backend'),env:{PATH:process.env.PATH},input:JSON.stringify(fixtures),encoding:'utf8'})
assert.equal(py.status,0,py.stderr)
assert.deepEqual(fixtures.map(c=>q.financialQualification(c.family,c.row)),JSON.parse(py.stdout))
for(const x of [NaN,Infinity,-Infinity,{},[],false,'0x10','1_000',''])assert.equal(q.finiteNumber(x),null)
const legacy={overview:[{portfolio_id:'perso',twr_ytd:42,volatility_30d_pct:8,nav_eur:200}],performance:[{portfolio_id:'perso',nav_eur:200,twr_ytd:42},{portfolio_id:'pro',nav_eur:null,twr_ytd:99}],decisions:[{risk_context:{inputs:['sharpe']}}],closes:[{status:'CLOSED',report_json:{performance:[{twr_ytd:42}],risk:{details:{sharpe:5},max_drawdown_ytd_pct:-8,largest_position_pct:12.5}}}],positions:[{market_value_eur:200}],cash:[{balance_eur:20}]}
const saved=JSON.stringify(legacy)
for(let i=0;i<2;i++){
 const safe=q.protectFamilyOfficeBundle(i?q.protectFamilyOfficeBundle(legacy):legacy)
 assert.equal(safe.overview[0].twr_ytd,null);assert.equal(safe.overview[0].nav_eur,200)
 assert.equal(safe.performance[1].portfolio_id,'pro');assert.equal(safe.performance[1].nav_eur,null)
 assert.equal(safe.decisions[0].financial_dependency_blocked,true)
 assert.equal(safe.closes[0].status,'CLOSED');assert.equal(safe.closes[0].report_json.risk.details,undefined)
 assert.equal(safe.closes[0].report_json.risk.largest_position_pct,12.5)
 assert.equal(safe.positions,legacy.positions);assert.equal(safe.cash,legacy.cash)
}
assert.equal(JSON.stringify(legacy),saved)
for(const family of Object.keys(q.PROTECTED_FIELDS)) for(const value of [0,-1,NaN,Infinity,null,999]){
 const row=Object.fromEntries(q.PROTECTED_FIELDS[family].map(k=>[k,value]));assert.ok(Object.values(q.protectFields(row,family)).every(v=>v===null))
}
for(const page of ['app/page.tsx','app/portfolios/page.tsx','app/operations/page.tsx','app/decisions/page.tsx']) assert.match(fs.readFileSync(path.join(root,page),'utf8'),/protectFamilyOfficeBundle\(cachedData\)/)
console.log('PASS: 31 cross-language fixtures, nonfinite values, legacy cached receipts, idempotence, immutable archives, scope identities and independent positions/cash')

// Exercise actual page reducers, including holes off the downsampling grid.
for (const file of ['app/backtest/page.tsx', 'app/compare/CompareClient.tsx']) {
 const content=fs.readFileSync(path.join(root,file),'utf8')
 const ast=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['downsampleSeries','buildCommonDates'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n')
 const js=ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const {downsampleSeries,buildCommonDates}=new Function(js+'; return {downsampleSeries,buildCommonDates}')()
 const dates=Array.from({length:1501},(_,i)=>String(i).padStart(4,'0'))
 for(const hole of [749,750,751]) {
  const values=dates.map((_,i)=>i===hole?null:1000+i)
  const reduced=downsampleSeries(dates,[{key:'a',values}])
  const index=reduced.dates.indexOf(dates[hole]);assert(index>0)
  assert.equal(reduced.series[0].values[index],null)
  assert.equal(reduced.dates[index-1],dates[hole-1]);assert.equal(reduced.dates[index+1],dates[hole+1])
 }
 assert.deepEqual(buildCommonDates({a:[{date:'01'},{date:'03'}],b:[{date:'01'},{date:'02'},{date:'03'}]},['a','b']),['01','02','03'])
 const allMissing=downsampleSeries(dates,[{values:dates.map(()=>null)}]);assert(allMissing.series[0].values.every(x=>x===null))
}
console.log('PASS: actual page reducers retain sampled/unsampled gaps and missing dates')
