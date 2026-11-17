from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from backend.app import create_app

@pytest.mark.parametrize('headers',[{'Origin':'https://evil.example'},{'Origin':'null'},{'Origin':'http://localhost.evil.example'},{'Sec-Fetch-Site':'cross-site'},{'Origin':'file://'}])
def test_unrelated_webpage_cannot_start_paid_factor_job(headers):
    calls=[]
    svc=SimpleNamespace(factor_research=SimpleNamespace(submit=lambda **kwargs:calls.append(kwargs)))
    response=TestClient(create_app(svc)).post('/api/factors/research',json={},headers=headers)
    assert response.status_code==403 and not calls

@pytest.mark.parametrize('headers',[{}, {'Origin':'http://127.0.0.1:8000'},{'Origin':'http://localhost:57621'}])
def test_local_app_and_server_side_tools_can_submit(headers):
    calls=[]
    def submit(**kwargs):calls.append(kwargs);return {'id':'test-job','status':'queued'}
    svc=SimpleNamespace(factor_research=SimpleNamespace(submit=submit))
    response=TestClient(create_app(svc)).post('/api/factors/research',json={},headers=headers)
    assert response.status_code==200 and calls[0]['scope']=='all'
