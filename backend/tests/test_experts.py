"""专家：结构化解码、弃权路径、无证据强制弃权、无密钥明确报错。"""
from __future__ import annotations

import json

import pytest

from backend.experts import ExpertError, ExpertService, _extract_json, _validate


def test_extract_json_handles_fences():
    assert _extract_json('```json\n{"vote":1}\n```') == {"vote": 1}
    assert _extract_json('垃圾前缀 {"vote": -1, "x": 2} 后缀') == {"vote": -1, "x": 2}
    assert _extract_json("not json") is None


def test_validate_forces_abstain_without_evidence():
    out = _validate({"vote": 1, "confidence": "high", "reason": "看好", "evidence": []})
    assert out["vote"] == 0
    assert out["abstained"] is True


def test_validate_keeps_vote_with_evidence():
    out = _validate({"vote": 1, "confidence": "medium", "reason": "样本足",
                     "evidence": [{"source": "quant_snapshot", "ref": "h10 prob 0.58"}]})
    assert out["vote"] == 1
    assert out["abstained"] is False
    assert out["evidence"][0]["source"] == "quant_snapshot"


def test_validate_rejects_bad_vote():
    with pytest.raises(ValueError):
        _validate({"vote": 7})


def test_seed_experts_present(client):
    items = client.get("/api/experts").json()["items"]
    ids = {e["id"] for e in items}
    assert {"buffett", "duan", "cigarbutt", "quant_expert", "price_action", "growth"} <= ids


def test_create_expert_and_same_name_never_overwrite_existing(client):
    body = {"name": "巴菲特", "system_prompt": "自定义方法论", "criteria": ["现金流"],
            "tools": ["quant_snapshot", "news_search"]}
    before = client.get("/api/experts/buffett").json()
    first = client.post("/api/experts", json=body)
    second = client.post("/api/experts", json=body)
    assert first.status_code == second.status_code == 200
    assert first.json()["id"] != second.json()["id"]
    assert first.json()["id"] != "buffett"
    assert client.get("/api/experts/buffett").json() == before
    ids = {item["id"] for item in client.get("/api/experts").json()["items"]}
    assert first.json()["id"] in ids and second.json()["id"] in ids
    patched = client.post("/api/experts", json={"id": first.json()["id"], "name": "修改后的专家"})
    assert patched.status_code == 200 and patched.json()["system_prompt"] == body["system_prompt"]


def test_delete_expert_removes_config_but_keeps_analysis_history(client, services):
    created = client.post("/api/experts", json={
        "name": "Delete Me 20261117", "system_prompt": "依据证据", "criteria": ["a"]}).json()
    services.db.execute(
        """INSERT INTO analyses(id,expert_id,symbol_code,symbol_category,horizon,vote,
                                confidence,reason,evidence,abstained,model,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("A-delete-1", created["id"], "601088", "个股", 10, 1, "medium", "历史",
         "[]", 0, "stub", "2026-11-17T00:00:00+08:00"))
    r = client.delete(f"/api/experts/{created['id']}")
    assert r.status_code == 200 and r.json() == {"deleted": created["id"]}
    assert client.get(f"/api/experts/{created['id']}").status_code == 404
    assert created["id"] not in {e["id"] for e in client.get("/api/experts").json()["items"]}
    assert services.db.query_one(
        "SELECT id FROM analyses WHERE id='A-delete-1' AND expert_id=?", (created["id"],))


def test_deleted_seed_expert_does_not_revive_after_seed_or_restart(client, services):
    before = {e["id"] for e in client.get("/api/experts").json()["items"]}
    assert client.delete("/api/experts/buffett").status_code == 200
    services.experts.ensure_seed_experts()
    services.experts.ensure_seed_experts()
    remaining = {e["id"] for e in client.get("/api/experts").json()["items"]}
    assert "buffett" not in remaining
    assert remaining == before - {"buffett"}
    assert client.get("/api/experts/buffett").status_code == 404


def test_explicit_recreate_clears_tombstone_and_unknown_delete_is_404(client):
    assert client.delete("/api/experts/buffett").status_code == 200
    restored = client.post("/api/experts", json={
        "id": "buffett", "name": "恢复的巴菲特", "system_prompt": "显式恢复"})
    assert restored.status_code == 200 and restored.json()["id"] == "buffett"
    assert client.get("/api/experts/buffett").json()["name"] == "恢复的巴菲特"
    assert client.delete("/api/experts/does-not-exist").status_code == 404


def test_symbol_only_expert_name_gets_nonempty_id(client):
    r = client.post("/api/experts", json={"name": "!!!", "system_prompt": "依据证据"})
    assert r.status_code == 200 and r.json()["id"].startswith("expert-")


def test_analyze_without_key_returns_explicit_error_not_fabrication(client):
    r = client.post("/api/experts/duan/analyze", json={"code": "601088", "horizon": 10})
    assert r.status_code == 503
    assert "密钥" in r.json()["error"]


class _StubModel:
    """假模型：按脚本返回 content，验证解码与持久化，不触网。"""

    def __init__(self, payloads):
        self._payloads = list(payloads)
        self.settings = type("S", (), {"configured": True, "model": "stub"})()

    def chat(self, messages, **kw):
        return {"content": self._payloads.pop(0), "tool_trace": [{"tool": "quant_snapshot"}], "raw": {}}


def test_analyze_with_evidence_persists(services, fake_engine):
    # 让 159603 有方向，确保快照里有可引用证据
    svc = services
    svc.experts.model = _StubModel([
        '{"vote":1,"confidence":"high","reason":"样本充足、方向明确",'
        '"evidence":[{"source":"quant_snapshot","ref":"第10根 概率0.58 样本300"}],"abstained":false}'
    ])
    res = svc.experts.analyze("quant_expert", "159603", "ETF", 10)
    assert res["vote"] == 1
    assert res["abstained"] is False
    assert res["evidence"]
    # 持久化
    rows = svc.experts.recent_analyses("159603")
    assert rows and rows[0]["vote"] == 1


def test_analyze_abstains_when_model_has_no_evidence(services):
    svc = services
    svc.experts.model = _StubModel([
        '{"vote":1,"confidence":"high","reason":"感觉会涨","evidence":[],"abstained":false}'
    ])
    res = svc.experts.analyze("buffett", "601088", "个股", 10)
    assert res["vote"] == 0
    assert res["abstained"] is True


def test_decode_retry_then_success(services):
    svc = services
    svc.experts.model = _StubModel([
        "这不是 JSON",
        '{"vote":0,"confidence":"low","reason":"缺财报证据，弃权","evidence":[],"abstained":true}',
    ])
    res = svc.experts.analyze("cigarbutt", "601088", "个股", 10)
    assert res["abstained"] is True


class _RecordingModel(_StubModel):
    def __init__(self, payloads):
        super().__init__(payloads)
        self.calls = []

    def chat(self, messages, **kw):
        self.calls.append(kw)
        return super().chat(messages, **kw)


def test_single_expert_always_gets_generic_ths_api(services):
    svc = services
    model = _RecordingModel([
        '{"vote":0,"confidence":"low","reason":"缺证据","evidence":[],"abstained":true}'])
    svc.experts.model = model
    svc.experts.analyze("buffett", "601088", "个股", 10)
    names = {tool["function"]["name"] for tool in model.calls[0]["tools"]}
    assert "ths_api" in names
    assert {"quant_snapshot", "filings_search", "news_search"} <= names


class _ToolMarket:
    def call_api(self, path, params):
        return {"available": True, "path": path, "params": params,
                "data": {"item": [{"name": "涨停甲", "continue_day_cnt": 3}]}}


def test_research_expert_can_call_ths_api_and_cite_returned_fields(services, monkeypatch):
    svc = services
    svc.experts.market = _ToolMarket()

    class ToolModel:
        settings = type("S", (), {"configured": True, "model": "stub"})()

        def chat(self, messages, **kw):
            names = {tool["function"]["name"] for tool in kw["tools"]}
            assert names == {"ths_api"}
            result = kw["tool_impls"]["ths_api"]({
                "path": "/api/a-share/special-data/limit-up-pool",
                "params": {"page": 1, "size": 3}})
            assert result["available"]
            return {"content": json.dumps({
                "vote": 1, "confidence": "high", "reason": "涨停池显示三连板",
                "abstained": False,
                "evidence": [{"source": "ths",
                              "ref": "/ths/data/calls/0/result/data/item/0/continue_day_cnt"}],
                "outlook": {k: "条件场景" for k in
                            ("short_term", "medium_term", "bull_case", "bear_case", "invalidation")},
                "risks": ["仅单日样本"]}), "tool_trace": [], "raw": {}}

    svc.experts.model = ToolModel()
    result = svc.experts.analyze_research("price_action", _research_report())
    assert result["vote"] == 1 and result["abstained"] is False
    assert result["evidence"][0]["source"] == "ths"


def test_research_expert_without_ths_call_cannot_fake_a_ths_pointer(services):
    svc = services
    svc.experts.market = _ToolMarket()
    svc.experts.model = _StubModel([json.dumps(_research_opinion(
        "ths", "/ths/data/calls/0/result/data/item/0/name"))])
    result = svc.experts.analyze_research("price_action", _research_report())
    assert result["vote"] == 0 and result["abstained"] is True


def test_team_consensus_threshold(services):
    svc = services
    # 所有专家都看涨且带证据 -> 共识 up
    svc.experts.model = _StubModel([
        '{"vote":1,"confidence":"high","reason":"ok","evidence":[{"source":"quant_snapshot","ref":"x"}],"abstained":false}'
    ] * 20)
    team = svc.experts.team_analyze("159603", "ETF", 10, threshold=0.6)
    assert team["consensus"]["decision"] == "up"
    assert team["consensus"]["support"] == 1.0


# Research uses strict source/JSONPointer validation; legacy citations above remain compatible.
def _research_report():
    return {"kind": "stock", "target": {"code": "000001", "name": "平安银行", "category": "个股"},
            "created_at": "2026-11-13T18:00:00+08:00",
            "trend": {"available": True, "data": {"ma20": 10.0, "bias": "up", "null_field": None}},
            "history": {"available": True, "data": {"items": [{"close_price": i} for i in range(10)]}},
            "quant": {"available": True, "items": [
                {"available": True, "horizon": 5, "result": {"direction": 1}},
                {"available": False, "horizon": 10, "result": {"direction": -1}}]},
            "fundamentals": {"available": True, "data": {
                "income": {"available": True, "data": {"items": [{"profit": 100}]}},
                "balance": {"available": False, "data": {"items": [{"assets": 99}]}}}},
            "news": {"available": False, "data": {"headline": "not real evidence"}}}


def _research_opinion(source="trend", ref="/trend/data/ma20"):
    return {"vote": 1, "confidence": "high", "reason": "依据均线观测", "abstained": False,
            "evidence": [{"source": source, "ref": ref}],
            "outlook": {k: "条件场景" for k in ("short_term", "medium_term", "bull_case", "bear_case", "invalidation")},
            "risks": ["内样本，未校准"]}


@pytest.mark.parametrize("source,ref", [
    ("trend", "/trend/data/ma20"), ("quant", "/quant/items/0/result/direction"),
    ("fundamentals", "/fundamentals/data/income/data/items/0/profit")])
def test_research_valid_json_pointer_evidence(source, ref):
    from backend.experts import _research_bundle, _validate_research
    result = _validate_research(_research_opinion(source, ref), _research_bundle(_research_report()))
    assert result["vote"] == 1 and result["abstained"] is False
    assert result["outlook"]["invalidation"]


@pytest.mark.parametrize("source,ref", [
    ("invented", "/trend/data/ma20"), ("trend", "/quote/data/ma20"),
    ("trend", "/trend/data/missing"), ("trend", "ma20=10"),
    ("trend", "/trend/data/null_field"), ("trend", "/trend/available"),
    ("news", "/news/data/headline"), ("quant", "/quant/items/1/result/direction"),
    ("fundamentals", "/fundamentals/data/balance/data/items/0/assets"),
    ("history", "/history/data/items/1000/close_price"),
    ("history", "/history/data/items/-1/close_price"),
    ("history", "/history/data/items/01/close_price"),
    ("history", "/history/data/items/0/bad~2escape"),
])
def test_research_missing_unavailable_or_invented_refs_force_abstention(source, ref):
    from backend.experts import _research_bundle, _validate_research
    result = _validate_research(_research_opinion(source, ref), _research_bundle(_research_report()))
    assert result["vote"] == 0 and result["abstained"] is True
    assert result["evidence"] == []


def test_research_any_bad_evidence_rejects_vote_even_with_a_valid_reference():
    from backend.experts import _research_bundle, _validate_research
    opinion = _research_opinion()
    opinion["evidence"].append({"source": "news", "ref": "/news/data/headline"})
    assert _validate_research(opinion, _research_bundle(_research_report()))["abstained"]


def test_research_bundle_is_small_and_idempotent():
    from backend.experts import _research_bundle
    bundle = _research_bundle(_research_report())
    assert len(bundle["history"]["data"]["items"]) == 5
    assert bundle["history"]["data"]["items"][0]["close_price"] == 5
    assert _research_bundle(bundle) == bundle


def test_research_analyze_one_call_no_retry_and_safe_model_errors(services):
    import json
    from backend.model_gateway import ModelError
    model = _StubModel([json.dumps(_research_opinion())])
    services.experts.model = model
    result = services.experts.analyze_research("price_action", _research_report())
    assert result["vote"] == 1 and result["model"] == "stub"
    assert services.experts.recent_analyses("000001")[0]["horizon"] == 0
    model = _StubModel(["not-json", json.dumps(_research_opinion())])
    services.experts.model = model
    with pytest.raises(ExpertError) as invalid:
        services.experts.analyze_research("price_action", _research_report())
    assert invalid.value.status == 502 and len(model._payloads) == 1
    def fail(*a, **kw):
        raise ModelError("Authorization: Bearer SECRET-KEY")
    model.chat = fail
    with pytest.raises(ExpertError) as failed:
        services.experts.analyze_research("price_action", _research_report())
    assert "SECRET" not in str(failed.value)
