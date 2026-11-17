"""Offline sector and company evidence contracts; no credentials or network."""
import httpx
import pytest
from backend.market import MarketService, MarketError

NOW=1794570000.
DAY=86400000


def service():
    calls=[]
    fail_finance=[False]
    clock=[NOW]
    def feed(req):
        calls.append(req)
        path=req.url.path
        if path=='/api/meta/tickers/search':
            sector=req.url.params.get('asset_type')=='a-share-index'
            code=req.url.params.get('q')
            items=([{'thscode':code,'name':'板块名称','asset_type':'a-share-index'}] if sector else [{'thscode':'601088.SH','name':'中国神华','asset_type':'a-share'}])
        elif path.endswith('/ths-index-list'):
            items=[{'thscode':'881101.TI','name':'种植业与林业'},{'thscode':'881105.TI','name':'煤炭开采加工'}]
        elif path.endswith('/ths-stock-list'):
            assert req.url.params['thscode']=='881101.TI'
            items=[{'thscode':'601088.SH','ticker':'601088','name':'中国神华'},{'thscode':'000998.SZ','ticker':'000998','name':'隆平高科'},{'thscode':'601088.SH','name':'duplicate'}]
        elif path=='/api/a-share-index/prices/historical':
            assert 'adjust' not in req.url.params
            items=[{'date_ms':int(NOW*1000)-i*DAY,'open_price':50.,'high_price':52.,'low_price':49.,'close_price':51.,'volume':None} for i in range(8)]
        elif path=='/api/a-share-index/prices/snapshot':
            assert req.url.params['thscodes']=='881101.TI'
            items=[{'thscode':'881101.TI','last_price':1000.,'price_change_ratio_pct':1.2}]
        elif path=='/api/a-share/valuations/snapshot':
            assert req.url.params['thscodes']=='601088.SH'
            items=[{'thscode':'601088.SH','pe_ttm':-10.2,'pb_mrq':None}]
        elif path.startswith('/api/a-share/financials/'):
            if fail_finance[0]: return httpx.Response(200,json={'code':5002,'data':None})
            assert req.url.params['period']=='annual' and req.url.params['limit']=='2'
            items=[{'thscode':'601088.SH','fiscal_year':2025,'period_end_ms':1767110400000,'report_date_ms':1770000000000,'net_profit':None,'currency':'CNY'}]
        else:
            raise AssertionError(path)
        return httpx.Response(200,json={'code':0,'data':{'timestamp':None,'item':items}})
    m=MarketService(transport=httpx.MockTransport(feed),key_provider=lambda:'offline-test-only-secret',clock=lambda:clock[0])
    return m,calls,fail_finance,clock


def test_sector_catalog_pagination_search_and_cached_directory_resolution():
    m,calls,_,_=service()
    try:
        result=m.sector_catalog('industry',q='煤炭',limit=1)
        assert result['total']==1 and result['items'][0]['thscode']=='881105.TI'
        assert m.sector_catalog('industry',offset=1,limit=1)['cached'] is True
        quote=m.sector_snapshot('881101.ti')
        assert quote['items'][0]['code']=='881101.TI' and quote['items'][0]['timestamp'] is None
        assert [r.url.path for r in calls]==['/api/a-share-index/catalog/ths-index-list','/api/a-share-index/prices/snapshot']
        assert 'offline-test-only-secret' not in str(quote)
    finally:m.close()


def test_sector_history_is_true_index_not_adjusted_stock():
    m,calls,_,_=service()
    try:
        result=m.sector_history('881101.TI',5)
        assert result['adjust'] is None and result['interval']=='1d' and result['kind']=='sector'
        assert len(result['items'])==5 and result['items'][0]['date_ms']<result['items'][-1]['date_ms']
        assert result['items'][0]['volume'] is None
        assert calls[0].url.params['asset_type']=='a-share-index'
        assert m.sector_history('881101.TI',5)['cached'] is True
    finally:m.close()


def test_constituents_are_verified_stock_identities_and_paginated():
    m,_,_,_=service()
    try:
        first=m.sector_constituents('881101.TI',limit=1)
        assert first['total']==2 and first['has_more'] is True
        assert first['items'][0]['category']=='个股'
        second=m.sector_constituents('881101.TI',offset=1,limit=1)
        assert second['cached'] and second['items'][0]['code']=='000998'
    finally:m.close()


def test_financial_periods_and_negative_or_null_valuations_not_rewritten():
    m,_,_,_=service()
    try:
        financial=m.fundamentals('601088')
        assert financial['available'] and all(financial[k]['available'] for k in ('income','balance','cashflow'))
        assert financial['income']['data']['items'][0]['net_profit'] is None
        assert financial['income']['data']['items'][0]['fiscal_year']==2025
        values=m.valuation('601088')
        assert values['items'][0]['pe_ttm']==-10.2 and values['items'][0]['pb_mrq'] is None
        assert values['timestamp'] is None
    finally:m.close()


def test_unavailable_financial_sections_are_explicit_and_short_cached_for_recovery():
    m,calls,fail,clock=service()
    try:
        fail[0]=True
        result=m.fundamentals('601088')
        assert not result['available'] and all(not result[k]['available'] for k in ('income','balance','cashflow'))
        fail[0]=False
        assert not m.fundamentals('601088')['available']
        clock[0]+=16
        assert m.fundamentals('601088')['available']
    finally:m.close()


def test_stock_name_search_uses_real_meta_not_history_or_guessed_suffix():
    m,calls,_,_=service()
    try:
        result=m.search_symbols('神华')
        assert result['items'][0]['code']=='601088'
        assert calls[0].url.params['asset_type']=='a-share'
        assert m.search_symbols('神华')['cached']
    finally:m.close()


@pytest.mark.parametrize('method,args', [('sector_snapshot',['881101']),('sector_snapshot',['881101.BJ']),('sector_snapshot',['http://evil']),('sector_catalog',['wrong']),('sector_catalog',['industry','',-1]),('sector_history',['881101.TI',True]),('sector_constituents',['881101.TI',0,501]),('search_symbols',['']),('search_symbols',['x'*61]),('valuation',['601088,000001']),('fundamentals',['601088,000001'])])
def test_invalid_domain_inputs_never_request(method,args):
    m,calls,_,_=service()
    try:
        with pytest.raises(MarketError) as e:getattr(m,method)(*args)
        assert e.value.status==400 and not calls
    finally:m.close()


def test_index_and_stock_equal_numeric_codes_are_different_namespaces():
    seen=[]
    def wrong(req):
        seen.append(req)
        return httpx.Response(200,json={'code':0,'data':{'item':[{'thscode':'000001.SH','name':'wrong-stock','asset_type':'a-share'}]}})
    m=MarketService(transport=httpx.MockTransport(wrong),key_provider=lambda:'offline')
    try:
        with pytest.raises(MarketError) as e:m.sector_snapshot('000001.SH')
        assert e.value.code=='market_unsupported' and len(seen)==1
    finally:m.close()
