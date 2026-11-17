"""Factor API envelopes, without touching user data or real model calls."""
from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.factors.service import FactorError

SPEC = {"op": "gt", "args": [1, 0]}


def metrics():
    return {
        "accuracy": 0.5747, "coverage": 0.0846, "evaluated": 780, "correct": 448,
        "skipped": 8430, "not_evaluated": 0, "bars": 4558, "as_of": "2026-11-05",
        "baseline": {"always_up": 0.51, "always_down": 0.49},
        "confusion": {"pred_up": {"up": 1, "flat": 0, "down": 2}, "pred_down": {"up": 2, "flat": 0, "down": 1}},
        "per_horizon": [{"h": h, "accuracy": 0.57, "evaluated": 39} for h in range(1, 21)],
    }


def setup():
    calls = []
    def record(name, value):
        def run(*a, **k):
            calls.append((name, a, k))
            return value
        return run
    factors = SimpleNamespace(
        symbol=lambda code: {"code": code[:6], "name": "中国神华"},
        evaluate_seeds=lambda code, tf="1d": [
            {"rule": {"id": "rsi_reversion", "name": "RSI 反转", "spec": SPEC, "neutral_band": 0.0}, "metrics": metrics()},
            {"rule": {"id": "trend", "name": "均线多头", "spec": SPEC, "neutral_band": 0.0}, "metrics": {**metrics(), "accuracy": 0.55}},
        ],
        rule_by_id=lambda rid: {"id": rid, "name": "指定规则", "spec": SPEC, "neutral_band": 0.0} if rid == "rsi_reversion" else None,
        evaluate_detail=lambda code, spec, tf, nb: {"metrics": metrics(), "samples": {"false_positive": [{"date": "2026-09-18", "h": 17, "ret": -0.064}], "false_negative": []}},
        bars=lambda code, tf: pd.DataFrame({"close": [1.0, 2.0]}),
    )
    app = create_app(SimpleNamespace(factors=factors))
    return TestClient(app), calls


def test_library_route_returns_mined_rules_with_real_metrics():
    calls = []

    def library(offset, limit):
        calls.append((offset, limit))
        return {"items": [{"id": "llm-1", "name": "历史规则", "accuracy": 0.58, "coverage": 0.4,
                           "targets": 12, "evaluated": 1000, "sample_quality": "normal",
                           "created_at": "2026-11-15T00:00:00+00:00"}],
                "total": 1, "offset": offset, "limit": limit, "warning": "历史分数不等于当前表现"}

    client = TestClient(create_app(SimpleNamespace(
        factors=SimpleNamespace(), factor_research=SimpleNamespace(library=library))))
    response = client.get("/api/factors/library", params={"offset": 0, "limit": 10})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1 and body["items"][0]["id"] == "llm-1"
    assert body["items"][0]["accuracy"] == 0.58 and body["items"][0]["targets"] == 12
    assert calls == [(0, 10)]


def test_stock_envelope_has_target_rule_metrics_and_bounded_rule_list():
    client, _ = setup()
    response = client.get("/api/factors/stock", params={"code": "601088"})
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "factor"
    assert body["target"] == {"code": "601088", "name": "中国神华", "category": "个股", "target_id": "个股:601088", "timeframe": "1d"}
    assert body["metrics"]["baseline"]["same_set"] == 0.51
    assert set(body["metrics"]["confusion"]) == {"up", "down"}
    assert body["as_of"] == "2026-11-05" and body["bars"] == 4558
    assert body["direction"] == 1
    assert body["rule"]["id"] == "rsi_reversion"
    assert body["metrics"]["accuracy"] == pytest.approx(0.5747)
    assert len(body["metrics"]["per_horizon"]) == 20
    assert len(body["rules"]) == 2
    assert body["rules"][0]["accuracy"] == pytest.approx(0.5747)
    assert any("全样本" in warning for warning in body["warnings"])


def test_backtest_envelope_includes_samples_and_selected_rule():
    client, _ = setup()
    response = client.get("/api/factors/backtest", params={"code": "601088", "rule_id": "rsi_reversion"})
    assert response.status_code == 200
    body = response.json()
    assert body["rule"]["id"] == "rsi_reversion" and body["rule"]["name"] == "指定规则"
    assert body["samples"]["false_positive"][0]["date"] == "2026-09-18"
    assert body["metrics"]["accuracy"] == pytest.approx(0.5747)


def test_backtest_without_rule_uses_best_seed():
    client, _ = setup()
    body = client.get("/api/factors/backtest", params={"code": "601088"}).json()
    assert body["rule"]["id"] == "rsi_reversion"
    assert "samples" in body


def test_rules_directory_is_metadata_only():
    client, _ = setup()
    body = client.get("/api/factors/rules").json()
    assert body["total"] > 10
    assert set(body["items"][0]) == {"id", "name"}
    assert all("spec" not in item for item in body["items"])


def test_unknown_rule_and_bad_timeframe_are_explicit_errors():
    client, _ = setup()
    assert client.get("/api/factors/backtest", params={"code": "601088", "rule_id": "nope"}).status_code == 404

    factors = SimpleNamespace()

    def fail(code, tf="1d"):
        raise FactorError("时间框架暂不支持: 60m", 400)

    factors = SimpleNamespace(
        symbol=lambda code: {"code": code[:6], "name": "x"},
        evaluate_seeds=fail,
    )
    bad = TestClient(create_app(SimpleNamespace(factors=factors)))
    response = bad.get("/api/factors/stock", params={"code": "601088", "timeframe": "60m"})
    assert response.status_code == 400
    assert "时间框架" in response.json()["error"]


def test_model_code_endpoint_returns_real_envelope_and_samples():
    factors = SimpleNamespace(
        symbol=lambda code: {"code": code[:6], "name": "中国神华"},
        evaluate_code=lambda code, source, tf, band: {
            **metrics(), "source_sha256": "a" * 64, "direction_now": 1,
            "lookahead_checked": [10, 20], "kind": "code",
        },
        samples_code=lambda code, source, tf, side, limit, neutral_band=0: [
            {"date": "2026-09-18", "h": 17, "ret": -0.064}
        ],
    )
    client = TestClient(create_app(SimpleNamespace(factors=factors)))
    response = client.post("/api/factors/code", json={
        "code": "601088", "source": "def factor(df):\n    return 1",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "factor"
    assert body["rule"]["id"].startswith("code:")
    assert body["source_sha256"] == "a" * 64
    assert body["lookahead_checked"] == [10, 20]
    assert body["samples"]["false_positive"][0]["date"] == "2026-09-18"
    assert body["samples"]["false_negative"][0]["h"] == 17


def test_unsafe_or_invalid_model_code_is_rejected_as_400():
    from backend.factors.sandbox import SandboxError

    def reject(code, source, tf, band):
        raise SandboxError("禁止导入模块")

    factors = SimpleNamespace(symbol=lambda code: {"code": code[:6], "name": "x"},
                              evaluate_code=reject)
    client = TestClient(create_app(SimpleNamespace(factors=factors)))
    response = client.post("/api/factors/code", json={
        "code": "601088", "source": "import os\ndef factor(df):\n    return 1",
    })
    assert response.status_code == 400
    assert "禁止导入" in response.json()["error"]
    assert client.post("/api/factors/code", json={"code": "601088"}).status_code == 422
    assert client.post("/api/factors/code", json={"code": "601088", "source": "def factor(df):\n    return 1", "timeframe": "60m"}).status_code == 422
