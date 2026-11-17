"""概率接口：direction=0 概率为 null、日期越界、未知代码、口径字段。"""
from __future__ import annotations


def test_direction_zero_returns_null_probability(client):
    r = client.get("/api/quant/probability?code=601088&category=个股&horizon=10")
    assert r.status_code == 200
    body = r.json()
    assert body["direction"] == 0
    assert body["probability"] is None
    assert body["baseline_up"] is not None
    assert body["evaluation"]["type"] == "in_sample"
    assert body["evaluation"]["calibrated"] is False


def test_direction_nonzero_has_probability_and_rules(client):
    r = client.get("/api/quant/probability?code=159603&category=ETF&horizon=10")
    body = r.json()
    assert body["direction"] == 1
    assert body["probability"] is not None
    assert body["rules"], "有方向时应带命中规则"
    assert "method" in body


def test_unknown_code_404(client):
    r = client.get("/api/quant/probability?code=999999&horizon=10")
    assert r.status_code == 404
    assert "error" in r.json()


def test_date_before_snapshot_rejected(client):
    r = client.get("/api/quant/probability?code=601088&category=个股&date=2026-11-03")
    assert r.status_code == 400


def test_must_provide_horizon_or_date(client):
    r = client.get("/api/quant/probability?code=601088&category=个股")
    assert r.status_code == 400


def test_future_date_resolves(client):
    r = client.get("/api/quant/probability?code=601088&category=个股&date=2026-11-12")
    assert r.status_code == 200
    assert r.json()["target"]["target_date"] is not None
