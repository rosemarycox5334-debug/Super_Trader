"""真实引擎的概率冒烟 + Super Agent 离线意图驱动插件 CRUD。

概率测试依赖本机真实数据/网格，缺失时自动跳过。
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.quant import QuantEngine
from backend.services import Services
from backend.settings import ModelSettings, Settings

GRID = Path(__file__).resolve().parents[2] / "reports" / "fullfit" / "probability_grid.json"


@pytest.fixture()
def live_client(tmp_path):
    if not GRID.exists():
        pytest.skip("缺少 probability_grid.json，跳过真实数据测试")
    settings = Settings(state_db=tmp_path / "live.db", host="127.0.0.1", port=8000,
                        model=ModelSettings(base_url="https://x/v1", api_key="",
                                            model="deepseek-chat", timeout=5))
    try:
        engine = QuantEngine()
        engine._load_grid()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"量化引擎初始化失败：{exc}")
    svc = Services(settings=settings, engine=engine)
    yield TestClient(create_app(svc))
    svc.close()


def test_live_probability_601088(live_client):
    r = live_client.get("/api/quant/probability?code=601088&category=个股&horizon=10")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"]["name"] == "中国神华"
    assert body["evaluation"]["type"] == "in_sample"
    # direction=0 时概率必须为 null
    if body["direction"] == 0:
        assert body["probability"] is None
    else:
        assert body["probability"] is not None


def test_live_grid_meta(live_client):
    status = live_client.get("/api/status").json()
    assert status["grid"]["snapshot"] == "2026-11-05"


def test_agent_offline_creates_plugin(client):
    r = client.post("/api/agent/chat", json={"message": "添加插件 龙虎榜"})
    assert r.status_code == 200
    assert any(a["tool"] == "add_plugin" for a in r.json()["actions"])
    names = [p["name"] for p in client.get("/api/plugins").json()["items"]]
    assert "龙虎榜" in names


def test_agent_offline_hide_plugin(client):
    r = client.post("/api/agent/chat", json={"message": "隐藏插件 专家团队"})
    assert any(a["tool"] == "toggle_plugin" for a in r.json()["actions"])
    experts = next(p for p in client.get("/api/plugins").json()["items"] if p["id"] == "experts")
    assert experts["enabled"] is False


def test_agent_offline_move_first(client):
    client.post("/api/agent/chat", json={"message": "把自选股排到最前"})
    items = client.get("/api/plugins").json()["items"]
    assert items[0]["id"] == "watchlist"


def test_agent_offline_probability(client):
    r = client.post("/api/agent/chat", json={"message": "601088 第10个交易日 概率"})
    assert r.status_code == 200
    assert any(a["tool"] == "quant_probability" for a in r.json()["actions"])


def _parse_sse(text):
    events = []
    for block in text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data:"):
                import json as _j
                try:
                    events.append(_j.loads(line[5:].strip()))
                except ValueError:
                    pass
    return events


def test_agent_stream_deterministic_emits_tokens_and_done(client):
    # 无模型密钥 -> 确定性路径，仍要以流式事件形式产出（token 分块 + done）
    with client.stream("POST", "/api/agent/chat/stream",
                       json={"message": "插件列表"}) as resp:
        assert resp.status_code == 200
        body = "".join(resp.iter_text())
    events = _parse_sse(body)
    types = [e["type"] for e in events]
    assert "mode" in types
    assert "token" in types          # 伪流式分块
    assert types[-1] == "done"
    done = events[-1]
    assert "reply" in done and done["mode"] == "deterministic"


def test_agent_stream_action_then_done_for_plugin(client):
    with client.stream("POST", "/api/agent/chat/stream",
                       json={"message": "添加插件 资金流向"}) as resp:
        body = "".join(resp.iter_text())
    events = _parse_sse(body)
    assert any(e["type"] == "action" and e["tool"] == "add_plugin" for e in events)
    # 真的创建了
    names = [p["name"] for p in client.get("/api/plugins").json()["items"]]
    assert "资金流向" in names
