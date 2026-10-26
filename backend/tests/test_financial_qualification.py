"""FI00 guard acceptance using synthetic inputs and fake repositories only."""
import copy
import io
import json
from pathlib import Path
import pytest
import pandas as pd
from pypdf import PdfReader
from financial_qualification import FIELDS, qualification, protect_fields, protect_performance_payload, protect_risk_payload, risk_export, has_protected_dependency
from backtest.engine import persist_results, persist_kpis
from family_office.reporting import monthly_close_csv, monthly_close_pdf
from family_office.commands import transition_decision, require_order_scope

CASES = json.loads((Path(__file__).parent / 'fixtures/financial_qualification_v1.json').read_text())

@pytest.mark.parametrize('case', CASES)
def test_no_legacy_state_or_value_qualifies(case):
    before = copy.deepcopy(case)
    proof = qualification(case['family'], case['row'])
    assert proof['state'] == 'UNQUALIFIED'
    assert proof['reason_code'] == 'CALCULATION_NOT_QUALIFIED'
    if case['family'] in FIELDS:
        safe = protect_fields(case['row'], case['family'])
        assert all(safe[k] is None for k in FIELDS[case['family']] if k in safe)
        assert safe['nav_eur'] == 200
    assert case == before

@pytest.mark.parametrize('value',[float('nan'),float('inf'),float('-inf'),True,[],{},'0x10','1_000',''])
def test_non_numeric_metadata_is_not_coverage(value):
    assert qualification('BACKTEST',{'coverage_pct':value})['coverage_pct'] is None

@pytest.mark.parametrize('family,guard',[('PORTFOLIO_PERFORMANCE',protect_performance_payload),('PORTFOLIO_RISK',protect_risk_payload)])
def test_payload_does_not_claim_ready(family,guard):
    row={'data_state':'READY',**{k:123 for k in FIELDS[family]}}
    assert guard(row)['data_state']=='PARTIAL'
    assert all(guard(row)[k] is None for k in FIELDS[family])
    assert guard({**row,'data_state':'MISSING'})['data_state']=='MISSING'

class Sink:
    def __init__(self):self.rows=[]
    def table(self,table):return self
    def upsert(self,rows,**kwargs):self.rows.append(copy.deepcopy(rows));return self
    def execute(self):return self

def test_dca_nav_is_preserved_but_returns_and_risk_are_withheld():
    sink=Sink(); frame=pd.DataFrame({'nav':[100,200],'drawdown':[0,0],'returns_daily':[0,1]},index=pd.to_datetime(['2026-01-01','2026-02-01']))
    persist_results(sink,'r','p',frame)
    rows=[x for batch in sink.rows for x in batch]
    assert [r['nav'] for r in rows]==[100,200]
    assert all(r['returns_daily'] is None and r['drawdown'] is None for r in rows)
    persist_kpis(sink,'r','p',{'cagr':1,'sharpe':99})
    assert sink.rows[-1]['cagr'] is None and sink.rows[-1]['sharpe'] is None

def test_nonfinite_nav_rejects_whole_payload_before_write():
    sink=Sink();frame=pd.DataFrame({'nav':[100,float('nan')]},index=pd.to_datetime(['2026-01-01','2026-01-02']))
    with pytest.raises(ValueError,match='NAV_NOT_FINITE'):persist_results(sink,'r','p',frame)
    assert sink.rows==[]

@pytest.mark.parametrize('dependency',[{'twr_ytd':None},{'nested':{'sharpe':0}},{'metric_family':'BACKTEST'},['twr_ytd'],{'inputs':['PORTFOLIO_RISK']}])
def test_structured_advice_dependencies_fail_closed(dependency):
    assert has_protected_dependency(dependency)
    assert not has_protected_dependency({'largest_position_pct':12,'cash_pct':5,'strategy':'weights'})

class Decisions:
    def __init__(self,dependency,status='DRAFT',source_snapshot=None):
        self.writes=[];self.dependency=dependency;self.status=status;self.source_snapshot=source_snapshot
    def first(self,table,*args,**kwargs):
        return {'id':'p' if table=='fo_portfolios' else 'd','owner_user_id':'o','portfolio_id':'p','status':self.status,'risk_context':self.dependency,'source_snapshot':self.source_snapshot}
    def update(self,*args,**kwargs):self.writes.append(args);return args[1]

def test_decision_validation_and_order_scope_cannot_bypass_guard():
    repo=Decisions({'twr_ytd':0.9})
    with pytest.raises(ValueError,match='CALCULATION_NOT_QUALIFIED'):transition_decision(repo,owner_user_id='o',decision_id='d',target_status='VALIDATED')
    with pytest.raises(ValueError,match='CALCULATION_NOT_QUALIFIED'):require_order_scope(repo,owner_user_id='o',decision_id='d',account_id='a')
    assert repo.writes==[]
    independent=Decisions({'cash_pct':5})
    transition_decision(independent,owner_user_id='o',decision_id='d',target_status='VALIDATED')
    assert len(independent.writes)==1

@pytest.mark.parametrize('field', ['risk_context', 'source_snapshot'])
@pytest.mark.parametrize('dependency', [{'twr_ytd': 0.9}, {'nested': {'sharpe': None}}])
def test_historical_export_cannot_progress_using_unqualified_kpi(field, dependency):
    repo = Decisions(dependency if field == 'risk_context' else {}, status='EXPORTED',
                     source_snapshot=dependency if field == 'source_snapshot' else None)
    before = copy.deepcopy(repo.first('fo_decisions'))
    with pytest.raises(ValueError, match='CALCULATION_NOT_QUALIFIED'):
        transition_decision(repo, owner_user_id='o', decision_id='d', target_status='EXECUTED')
    assert repo.writes == []
    assert repo.first('fo_decisions') == before
    transition_decision(repo, owner_user_id='o', decision_id='d', target_status='CANCELLED')
    assert repo.writes[0][1]['status'] == 'CANCELLED'
    assert 'executed_at' not in repo.writes[0][1]

def test_independent_export_can_still_record_execution():
    repo = Decisions({'cash_pct': 5}, status='EXPORTED')
    transition_decision(repo, owner_user_id='o', decision_id='d', target_status='EXECUTED')
    assert len(repo.writes) == 1
    assert repo.writes[0][1]['status'] == 'EXECUTED'
    assert repo.writes[0][1]['executed_at']

def test_existing_execution_can_still_be_reconciled_without_rewriting_archive():
    repo = Decisions({'twr_ytd': 0.9}, status='EXECUTED')
    transition_decision(repo, owner_user_id='o', decision_id='d', target_status='RECONCILED')
    assert repo.writes[0][1]['status'] == 'RECONCILED'
    assert 'executed_at' not in repo.writes[0][1]

def test_archived_csv_pdf_remove_values_and_generic_risk_bypass():
    close={'period_end':'2026-06-30','status':'CLOSED','nav_eur':125000,'coverage_pct':100,'checks_json':{'coverage_ready':True}}
    risk={'volatility_30d_pct':9876.54,'max_drawdown_ytd_pct':-8765.43,'details':{'leak':9876.54},'unknown_alias':8765.43,'largest_position_pct':12.5}
    perf=[{'performance_date':'2026-06-30','nav_eur':125000,'twr_mtd':9876.54,'twr_ytd':9876.54,'xirr_since_inception':9876.54}]
    before=copy.deepcopy([close,risk,perf]);kwargs=dict(positions=[],cash=[],manual_holdings=[],performance=perf,risk=risk,exceptions=[])
    csv=monthly_close_csv(close,{'name':'Synthetic'},**kwargs).decode('utf-8-sig')
    pdf=monthly_close_pdf(close,{'name':'Synthetic'},**kwargs)
    text='\n'.join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)
    assert '9876' not in csv and '8765' not in csv and '987654' not in text.replace(',','').replace(' ','')
    assert 'CALCULATION_NOT_QUALIFIED' in csv and 'NON QUALIFIE' in text
    assert '125000' in csv and '12.5' in csv
    assert 'details' not in risk_export(risk) and 'unknown_alias' not in risk_export(risk)
    assert [close,risk,perf]==before
