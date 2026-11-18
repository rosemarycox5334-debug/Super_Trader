"""Offline cockpit data contracts. No production credentials, DB or network."""
from types import SimpleNamespace
from pathlib import Path
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.market import MarketService, MarketError
from backend.quant import QuantError
from backend.watchlist import WatchlistError, WatchlistService
from backend.db import Database

NOW = 1794559974.0
DAY = 86400000


def make_service(rows=None):
    calls = []
    rows = rows if rows is not None else [
        {"date_ms": int(NOW*1000)-i*DAY, "open_price": 49., "close_price": 50.,
         "high_price": 51., "low_price": 48., "volume": None, "turnover": 0}
        for i in range(10)]
    def handler(req):
        calls.append(req)
        if req.url.path.endswith('/search'):
            data = {"timestamp": None, "item": [{"thscode":"601088.SH", "name":"中国神华", "asset_type":"a-share"}]}
        else:
            assert req.url.path == '/api/a-share/prices/historical'
            assert req.url.params['thscode'] == '601088.SH'
            assert req.url.params['interval'] == '1d'
            assert int(req.url.params['end']) - int(req.url.params['start']) == 400*DAY
            data = {"timestamp": None, "item": rows}
        return httpx.Response(200, json={"code":0, "data":data})
    return MarketService(transport=httpx.MockTransport(handler), key_provider=lambda:'offline-only-secret', clock=lambda:NOW), calls


def test_history_sorted_bounded_cached_and_nulls_preserved():
    svc, calls = make_service()
    try:
        result = svc.history('601088', 5)
        assert result['adjust'] == 'forward' and result['interval'] == '1d'
        assert result['timestamp'] is None and result['fetched_at'].endswith('+08:00')
        assert len(result['items']) == 5
        assert result['items'][0]['date_ms'] < result['items'][-1]['date_ms']
        assert result['items'][0]['volume'] is None
        assert result['items'][0]['turnover'] == 0
        assert not result['cached']
        assert svc.history('601088', 5)['cached']
        assert len(calls) == 2
        assert 'offline-only-secret' not in str(result)
        assert svc.symbol('601088')['category'] == '个股'
        assert len(calls) == 2
    finally:
        svc.close()


@pytest.mark.parametrize('code,limit,adjust', [('601088,000001',5,'forward'),('601088',0,'forward'),('601088',181,'forward'),('601088',True,'forward'),('601088',5,'fake'),('http://evil',5,'forward')])
def test_history_invalid_parameters_do_not_request(code,limit,adjust):
    svc,calls=make_service()
    try:
        with pytest.raises(MarketError) as e: svc.history(code,limit,adjust)
        assert e.value.status == 400 and calls == []
    finally: svc.close()


@pytest.mark.parametrize('rows', [[{'date_ms':'bad'}], [{'date_ms':int(NOW*1000)+DAY}], [{'date_ms':int(NOW*1000), 'open_price':'50'}]])
def test_malformed_bar_is_explicit_protocol_failure(rows):
    svc,_ = make_service(rows)
    try:
        with pytest.raises(MarketError) as e: svc.history('601088',5)
        assert e.value.code == 'market_protocol'
    finally: svc.close()


def test_empty_bars_not_synthetic():
    svc,_ = make_service([])
    try: assert svc.history('601088',5)['items'] == []
    finally: svc.close()


def test_health_status_does_not_wait_for_provider_query_lock():
    svc,_ = make_service()
    svc._lock.acquire()
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            assert pool.submit(svc.status).result(timeout=1)['configured']
    finally:
        svc._lock.release(); svc.close()


def test_portable_never_scans_implicit_key_file(monkeypatch):
    monkeypatch.delenv('HITHINK_FINANCE_API_KEY',raising=False)
    monkeypatch.delenv('HITHINK_FINANCE_KEY_FILE',raising=False)
    monkeypatch.setenv('ST_PORTABLE_RUNTIME','1')
    def blocked(*a,**k): raise AssertionError('must not read any key file')
    monkeypatch.setattr(Path,'read_text',blocked)
    svc=MarketService(transport=httpx.MockTransport(lambda req:pytest.fail('no provider call')))
    try:
        assert not svc.status()['configured']
        with pytest.raises(MarketError) as e: svc.history('601088',5)
        assert e.value.code == 'market_not_configured'
    finally: svc.close()


def test_history_api_and_missing_market_are_controlled():
    svc,_ = make_service()
    try:
        app=create_app(SimpleNamespace(market=svc))
        with TestClient(app) as client:
            result=client.get('/api/market/history?code=601088&limit=5')
            assert result.status_code == 200 and len(result.json()['items']) == 5
            assert client.get('/api/market/history?code=601088&limit=10000').status_code == 422
        absent=TestClient(create_app(SimpleNamespace()))
        assert absent.get('/api/market/history?code=601088').status_code == 503
    finally: svc.close()


def test_watchlist_can_use_verified_market_symbol_without_research_data(tmp_path):
    class NoResearch:
        def resolve_symbol(self,*a): raise QuantError('research data missing', status=503)
    svc,_ = make_service()
    db=Database(tmp_path/'isolated.db')
    try:
        watch=WatchlistService(db,NoResearch(),None,None,market=svc)
        assert watch.add('601088',None)['added'] is True
        assert watch.list()[0]['name'] == '中国神华'
        assert watch.add('601088',None)['added'] is False
        watch.remove('601088','个股')
        assert watch.list() == []
        with pytest.raises(WatchlistError): watch.add('601088','ETF')
        class FundMarket:
            def fund_symbol(self, code):
                return {"code": code, "name": "纳指生物科技ETF", "category": "ETF",
                        "thscode": code + ".SH", "asset_type": "fund-etf"}
        etf = WatchlistService(db, NoResearch(), None, None, market=FundMarket())
        assert etf.add('513290','ETF')['added'] is True
        row = etf.list()[0]
        assert (row["code"], row["category"], row["name"]) == ("513290", "ETF", "纳指生物科技ETF")
    finally: db.close(); svc.close()
