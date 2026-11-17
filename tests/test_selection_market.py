"""Real-universe and expert-chosen reporting contracts, without network or keys."""
import httpx
import pytest
from backend.market import MarketService,MarketError


def make_service():
    calls=[]
    def feed(request):
        calls.append(request)
        if request.url.path=='/api/meta/tickers/list':
            assert request.url.params['asset_type']=='a-share'
            offset=int(request.url.params['offset']); limit=int(request.url.params['limit'])
            all_rows=[{'thscode':'600001.SH','asset_type':'a-share','name':'普通股票','list_date':'2020-01-01'}, {'thscode':'600002.SH','asset_type':'a-share','name':'*ST风险股票','end_date':None}, {'thscode':'920001.BJ','asset_type':'a-share','name':'未覆盖新股票'}]
            rows=all_rows[offset:offset+limit]
        elif request.url.path=='/api/meta/tickers/search':
            rows=[{'thscode':'600001.SH','asset_type':'a-share','name':'普通股票'}]
        else:
            assert request.url.path.startswith('/api/a-share/financials/')
            rows=[{'thscode':'600001.SH','fiscal_year':2026,'fiscal_period':'Q3','period':request.url.params['period'],'report_date_ms':1793380000000,'period_end_ms':1790697600000,'currency':'CNY','net_profit':None,'operating_income':100.}]
        return httpx.Response(200,json={'code':0,'data':{'timestamp':None,'item':rows}})
    market=MarketService(transport=httpx.MockTransport(feed),key_provider=lambda:'offline-secret')
    return market,calls


def test_directory_keeps_stock_without_quant_and_risk_names_not_a_prefilter():
    market,calls=make_service()
    try:
        result=market.stock_universe(limit=10000)
        assert [row['code'] for row in result['items']]==['600001','600002','920001']
        assert result['items'][1]['risk_marked_name'] is True
        assert result['total']==3 and not result['has_more']
        assert market.stock_universe(limit=10000)['cached'] is True
        assert len(calls)==1
        assert 'offline-secret' not in str(result)
    finally:market.close()


def test_universe_reports_unknown_total_until_complete_page_and_uses_raw_offset():
    market,_=make_service()
    try:
        first=market.stock_universe(limit=2)
        assert first['total'] is None and first['has_more']
        last=market.stock_universe(offset=2,limit=2)
        assert last['total']==3 and not last['has_more']
    finally:market.close()


def test_expert_can_request_quarterly_or_multiyear_annual_reports_without_fabricated_metrics():
    market,calls=make_service()
    try:
        quarterly=market.company_financials('600001')
        assert quarterly['available'] and quarterly['period']=='quarterly' and quarterly['limit']==5
        assert quarterly['income']['data']['items'][0]['net_profit'] is None
        assert all(r.url.params['period']=='quarterly' for r in calls[1:])
        assert market.company_financials('600001')['cached']
        annual=market.company_financials('600001',period='annual',limit=8)
        assert annual['period']=='annual' and annual['limit']==8
        assert calls[-1].url.params['period']=='annual' and calls[-1].url.params['limit']=='8'
    finally:market.close()


@pytest.mark.parametrize('method,kwargs',[('stock_universe',{'limit':True}),('stock_universe',{'offset':-1}),('stock_universe',{'limit':10001}),('company_financials',{'code':'600001,600002'}),('company_financials',{'code':'600001','period':'invented'}),('company_financials',{'code':'600001','limit':9}),('company_financials',{'code':'600001','limit':True})])
def test_bad_arguments_do_not_fetch(method,kwargs):
    market,calls=make_service()
    try:
        with pytest.raises(MarketError):getattr(market,method)(**kwargs)
        assert not calls
    finally:market.close()
