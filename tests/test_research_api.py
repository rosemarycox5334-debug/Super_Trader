"""Application integration contracts, without a user DB, key or model call."""
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.research import ResearchError
from backend.selection import SelectionError


def setup():
    calls=[]
    def op(name,value):
        def run(*a,**k):
            calls.append((name,a,k))
            return value
        return run
    research=SimpleNamespace(screen=op('screen',{'items':[],'as_of':'2026-11-05'}),stock_report=op('stock',{'kind':'stock'}),sector_report=op('sector',{'kind':'sector'}),submit_team=op('team',{'id':'job1','status':'queued'}))
    market=SimpleNamespace(search_symbols=op('search',{'items':[]}),sector_catalog=op('catalog',{'items':[],'total':0}))
    selection=SimpleNamespace(submit=op('select',{'id':'selection1','status':'queued'}))
    return TestClient(create_app(SimpleNamespace(research=research,market=market,selection=selection))),calls,research


def test_old_quant_screen_is_not_primary_stock_selection():
    client,calls,_=setup()
    assert client.get('/api/research/screen?style=trend').status_code==410
    assert not calls
    r=client.get('/api/research/quant-screen?style=trend&scope=sector&sector=881101.TI&limit=3')
    assert r.status_code==200
    assert calls[-1]==('screen',('trend','sector','881101.TI',3),{})
    assert client.get('/api/research/quant-screen?limit=1000').status_code==422


def test_expert_selection_defaults_to_real_market_not_grid():
    client,calls,_=setup()
    r=client.post('/api/research/select',json={'expert_ids':['buffett'],'brief':'重视长期现金流'})
    assert r.status_code==200 and r.json()=={'job':{'id':'selection1','status':'queued'}}
    assert calls[-1]==('select',(),{'scope':'market','sector':None,'expert_ids':['buffett'],'brief':'重视长期现金流','limit_per_expert':5})


@pytest.mark.parametrize('extra',[{'style':'trend'},{'horizon':10},{'min_roe':15},{'limit_per_expert':11},{'expert_ids':[]},{'scope':'local-grid'},{'brief':'a'*1001}])
def test_expert_selection_does_not_accept_old_or_hidden_prefilters(extra):
    client,calls,_=setup()
    assert client.post('/api/research/select',json=extra).status_code==422
    assert not calls


def test_stock_and_sector_use_distinct_operations():
    client,calls,_=setup()
    assert client.get('/api/research/stock?code=601088').json()['kind']=='stock'
    assert calls[-1][1]==('601088',)
    assert client.get('/api/research/sector?thscode=881101.TI').json()['kind']=='sector'
    assert calls[-1][1]==('881101.TI',)


def test_team_submit_returns_job_not_fake_completed_analysis_and_rejects_old_horizon():
    client,calls,_=setup()
    result=client.post('/api/research/team',json={'kind':'stock','code':'601088','expert_ids':['quant_expert']})
    assert result.status_code==200 and result.json()=={'job':{'id':'job1','status':'queued'}}
    assert calls[-1]==('team',('stock','601088',['quant_expert']),{})
    assert client.post('/api/research/team',json={'kind':'stock','code':'601088','horizon':10}).status_code==422
    assert client.post('/api/research/team',json={'kind':'other','code':'601088'}).status_code==422


def test_directory_search_and_bounded_sector_pages_are_same_market_methods():
    client,calls,_=setup()
    assert client.get('/api/market/search?q=神华&limit=5').status_code==200
    assert calls[-1]==('search',('神华',5),{})
    assert client.get('/api/market/sectors?tag=industry&q=农业&offset=30&limit=30').status_code==200
    assert calls[-1]==('catalog',('industry','农业',30,30),{})
    assert client.get('/api/market/sectors?offset=-1').status_code==422


def test_missing_research_model_is_explicit_error_not_empty_team():
    client,_,research=setup()
    def no_model(*args): raise ResearchError('未配置模型',status=503)
    research.submit_team=no_model
    result=client.post('/api/research/team',json={'kind':'stock','code':'601088'})
    assert result.status_code==503 and '未配置模型' in result.json()['error']
