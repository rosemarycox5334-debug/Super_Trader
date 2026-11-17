"""自选上限、journal 冻结与复盘计算、job 取消。"""
from __future__ import annotations

import time

from backend.watchlist import MAX_WATCHLIST


def test_watchlist_add_and_dedupe(client):
    assert client.post("/api/watchlist", json={"code": "601088", "category": "个股"}).json()["added"] is True
    again = client.post("/api/watchlist", json={"code": "601088", "category": "个股"}).json()
    assert again["added"] is False
    assert len(client.get("/api/watchlist").json()["items"]) == 1


def test_watchlist_cap(services):
    svc = services
    # 直接写库填满，验证服务层上限（避免逐个造标的）
    from backend.db import now_iso
    for i in range(MAX_WATCHLIST):
        svc.db.execute(
            "INSERT INTO watchlist(symbol_code,symbol_category,name,added_at) VALUES(?,?,?,?)",
            (f"X{i:05d}", "个股", "满", now_iso()))
    svc.engine._symbols[("601099", "个股")] = "新标的"
    import pytest
    from backend.watchlist import WatchlistError
    with pytest.raises(WatchlistError) as exc:
        svc.watchlist.add("601099", "个股")
    assert "上限" in str(exc.value)


def test_journal_freeze_and_immutable_signal(client):
    j = client.post("/api/journal", json={
        "code": "601088", "action": "buy", "horizon": 10, "price": 38.5,
        "reasons": {"summary": "测试理由", "votes": []},
    }).json()
    jid = j["id"]
    frozen_signal = j["signal"]
    # patch 只改 note/closed，不动 signal
    client.patch(f"/api/journal/{jid}", json={"note": "改备注", "closed": True})
    after = client.get(f"/api/journal/{jid}").json()
    assert after["signal"] == frozen_signal
    assert after["closed"] is True
    assert after["note"] == "改备注"


def test_journal_review_computes_real_return(client):
    # 回填历史进场日，fake_engine.forward_price 给出真实收益
    j = client.post("/api/journal", json={
        "code": "601088", "action": "buy", "horizon": 10, "price": 30.0,
        "entry_date": "2026-09-01",
    }).json()
    review = client.get(f"/api/journal/{j['id']}/review").json()
    assert review["return"]["available"] is True
    assert review["return"]["entry_price"] == 30.0
    assert review["return"]["exit_price"] == 33.0
    # 做多 +10%
    assert abs(review["return"]["forward_return"] - 0.1) < 1e-6
    assert review["return"]["hit"] is True
    assert "signal_drift" in review


def test_journal_review_direction_only_without_data(client):
    j = client.post("/api/journal", json={"code": "601088", "action": "buy", "horizon": 10}).json()
    review = client.get(f"/api/journal/{j['id']}/review").json()
    # 进场日默认当天（晚于数据），只做方向复盘
    assert review["return"]["available"] is False
    assert review["return"]["mode"] == "direction_only"


def test_job_cancel(services):
    import threading
    svc = services
    started = threading.Event()
    release = threading.Event()

    def slow(handle):
        started.set()
        for i in range(100):
            if handle.cancelled:
                return {"stopped_at": i}
            release.wait(timeout=0.05)
        return {"done": True}

    job_id = svc.jobs.submit("test", {}, slow, total=100)
    assert started.wait(timeout=2)
    assert svc.jobs.cancel(job_id) is True
    release.set()
    for _ in range(40):
        job = svc.jobs.get(job_id)
        if job["status"] in ("cancelled", "done", "error"):
            break
        time.sleep(0.05)
    assert svc.jobs.get(job_id)["status"] == "cancelled"


def test_cancel_unknown_job(services):
    assert services.jobs.cancel("nope") is False
