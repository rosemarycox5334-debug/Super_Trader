"""插件运行时：增删改排序与保护（内置不可删、至少一个启用）。"""
from __future__ import annotations


def test_builtins_seeded(client):
    items = client.get("/api/plugins").json()["items"]
    ids = {p["id"] for p in items}
    assert {"quant", "experts", "watchlist", "journal"} <= ids
    assert all(p["builtin"] for p in items if p["id"] in ids & {"quant", "experts", "watchlist", "journal"})


def test_create_custom_plugin_appears(client):
    r = client.post("/api/plugins", json={"name": "龙虎榜"})
    assert r.status_code == 200
    pid = r.json()["id"]
    assert r.json()["name"] == "龙虎榜"
    assert r.json()["builtin"] is False
    listing = client.get("/api/plugins").json()["items"]
    assert any(p["id"] == pid for p in listing)


def test_rename_and_toggle(client):
    pid = client.post("/api/plugins", json={"name": "资金流"}).json()["id"]
    r = client.patch(f"/api/plugins/{pid}", json={"name": "北向资金", "enabled": False})
    assert r.json()["name"] == "北向资金"
    assert r.json()["enabled"] is False
    # enabled_only 过滤掉停用的
    enabled = client.get("/api/plugins?enabled_only=true").json()["items"]
    assert all(p["id"] != pid for p in enabled)


def test_builtin_cannot_be_deleted(client):
    r = client.delete("/api/plugins/quant")
    assert r.status_code == 409
    assert "内置" in r.json()["error"]


def test_custom_can_be_deleted(client):
    pid = client.post("/api/plugins", json={"name": "临时"}).json()["id"]
    assert client.delete(f"/api/plugins/{pid}").status_code == 200
    assert client.get(f"/api/plugins/{pid}").status_code == 404


def test_cannot_disable_last_enabled(client):
    # 停用除 quant 外的全部内置，只留 quant
    others = [p["id"] for p in client.get("/api/plugins").json()["items"]
              if p["id"] != "quant"]
    for pid in others:
        assert client.patch(f"/api/plugins/{pid}", json={"enabled": False}).status_code == 200
    r = client.patch("/api/plugins/quant", json={"enabled": False})
    assert r.status_code == 409
    assert "至少保留一个" in r.json()["error"]


def test_reorder_persists_order(client):
    order = ["journal", "watchlist", "experts", "quant"]
    client.post("/api/plugins/reorder", json={"order": order})
    items = client.get("/api/plugins").json()["items"]
    got = [p["id"] for p in items if p["id"] in order]
    assert got == order


def test_audit_records_changes(client):
    client.post("/api/plugins", json={"name": "审计测试"})
    log = client.get("/api/audit").json()["items"]
    assert any(e["action"] == "plugin.create" for e in log)
