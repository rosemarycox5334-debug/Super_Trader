"""记忆服务：抽取、去重/取代、投影预算、召回、退役、作用域、对话捕获、插件注册。"""
from __future__ import annotations

from backend.memory import MemoryService


def test_memory_builtin_plugin_registered(client):
    ids = [p["id"] for p in client.get("/api/plugins").json()["items"]]
    assert "memory" in ids
    mem = next(p for p in client.get("/api/plugins").json()["items"] if p["id"] == "memory")
    assert mem["builtin"] is True


def test_add_and_list(services):
    m = services.memory
    node = m.add("constraint", "默认用第10个交易日做研判", scope="agent")
    assert node is not None and node["kind"] == "constraint"
    items = m.list(scope="agent")
    assert any(n["id"] == node["id"] for n in items)


def test_too_short_is_ignored(services):
    assert services.memory.add("fact", "好", scope="agent") is None
    assert services.memory.add("fact", "ok", scope="agent") is None


def test_dedupe_similar(services):
    m = services.memory
    a = m.add("fact", "贵州茅台是白酒龙头", scope="agent")
    b = m.add("fact", "贵州茅台是白酒龙头。", scope="agent")  # 仅标点差异
    assert a["id"] == b["id"]  # 不新增，刷新原节点
    assert m.stats("agent")["active"] == 1


def test_constraint_supersede(services):
    m = services.memory
    old = m.add("constraint", "默认用第10个交易日", scope="agent")
    new = m.add("constraint", "默认用第20个交易日", scope="agent")
    assert old["id"] != new["id"]
    active = m.list(scope="agent")
    # 旧约束被取代退役
    assert all(n["id"] != old["id"] for n in active)
    retired = m.list(scope="agent", include_retired=True)
    old_node = next(n for n in retired if n["id"] == old["id"])
    assert old_node["retired"] is True
    assert old_node["superseded_by"] == new["id"]


def test_projection_budget_and_order(services):
    m = services.memory
    m.add("fact", "这是一条普通事实用于占位测试" * 3, scope="agent")
    m.add("constraint", "最重要的约束必须优先进入投影", scope="agent")
    proj = m.project(scope="agent", limit_bytes=200)
    # 约束优先于事实
    assert "约束" in proj
    assert proj.encode("utf-8").__len__() <= 200 + 80  # 预算 + 标题开销


def test_projection_empty_when_no_memory(services):
    assert services.memory.project(scope="empty-scope") == ""


def test_recall(services):
    m = services.memory
    m.add("fact", "宁德时代是动力电池龙头", scope="agent")
    hits = m.recall("电池", scope="agent")
    assert hits and "电池" in hits[0]["text"]


def test_scope_isolation(services):
    m = services.memory
    m.add("fact", "A 作用域的记忆内容", scope="scopeA")
    m.add("fact", "B 作用域的记忆内容", scope="scopeB")
    assert len(m.list(scope="scopeA")) == 1
    assert len(m.list(scope="scopeB")) == 1
    assert m.project(scope="scopeA").find("B 作用域") == -1


def test_capture_turn_extracts_constraint_and_action(services):
    m = services.memory
    created = m.capture_turn(
        "以后默认用第10个交易日做研判",
        "好的，已记住。",
        [{"tool": "add_plugin", "args": {"name": "龙虎榜"}}],
        scope="agent")
    kinds = {n["kind"] for n in created}
    assert "constraint" in kinds
    assert "progress" in kinds
    texts = " ".join(n["text"] for n in created)
    assert "龙虎榜" in texts


def test_clear(services):
    m = services.memory
    m.add("fact", "一条用于清空测试的记忆", scope="agent")
    assert m.stats("agent")["active"] >= 1
    n = m.clear("agent")
    assert n >= 1
    assert m.stats("agent")["active"] == 0


def test_agent_chat_captures_memory_offline(client):
    # 走确定性路径（无 key），仍应捕获约束
    client.post("/api/agent/chat", json={"message": "以后默认用第5个交易日"})
    items = client.get("/api/memory?scope=agent").json()["items"]
    assert any(n["kind"] == "constraint" and "第5个交易日" in n["text"] for n in items)


def test_memory_api_add_and_delete(client):
    node = client.post("/api/memory", json={"kind": "fact", "text": "测试记忆内容条目", "scope": "agent"}).json()
    assert node["id"].startswith("M-")
    assert client.delete(f"/api/memory/{node['id']}").status_code == 200


def test_memory_api_rejects_short_text(client):
    r = client.post("/api/memory", json={"kind": "fact", "text": "好", "scope": "agent"})
    assert r.status_code == 400
