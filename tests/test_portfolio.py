from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace

import pytest

from backend.db import Database
from backend.portfolio import CSI300, PortfolioService, _us
from backend.review import ReviewService


def at(day, clock="16:00:00"):
    return datetime.fromisoformat(f"2026-11-{day:02d}T{clock}+08:00")


def bar(day, open_, close, volume=500, **kwargs):
    return {"date_ms": int(at(day, "00:00:00").timestamp() * 1000), "open_price": open_,
            "close_price": close, "high_price": max(open_, close), "low_price": min(open_, close),
            "volume": volume, **kwargs}


class FakeMarket:
    def __init__(self):
        self.calls = []
        self.present_days = [16, 17, 18, 19, 20, 23]
        self.bars = {}
        self.index = [bar(day, 4000 + day, 4000 + day) for day in self.present_days]

    def trading_days(self):
        return [at(d).date().isoformat() for d in self.present_days]

    def sector_history(self, code, *, limit):
        self.calls.append((code, limit))
        return {"source": "fake index", "items": self.index}

    def history(self, code, *, limit, adjust):
        self.calls.append((code, limit, adjust))
        assert adjust == "none"
        rows = self.bars.get(code)
        if rows is None:
            raise RuntimeError("synthetic unavailable market")
        return {"source": "fake unadjusted market", "adjust": adjust, "items": rows}


class FakeExperts:
    def __init__(self, ids):
        self.ids = ids

    def list(self):
        return [{"id": key, "name": f"expert {key}", "enabled": True, "model": "fake-holding-model", "version": 2,
                 "system_prompt": "evidence only"} for key in self.ids]


class FakeModel:
    def __init__(self, *, configured=False, action="hold", malformed=False):
        self.settings = SimpleNamespace(configured=configured)
        self.action = action
        self.malformed = malformed
        self.calls = []

    def chat(self, messages, **kwargs):
        assert self.settings.configured
        data = json.loads(messages[1]["content"])
        self.calls.append((data, kwargs))
        result = [{"position_id": p["position_id"], "action": self.action, "reason": "observed loss of thesis",
                   "evidence": {"date": data["session"], "close": p["bars"][-1]["close"] + int(self.malformed)}}
                  for p in data["positions"]]
        return {"content": json.dumps({"actions": result})}


def make(tmp_path, ids=("alpha",), model=None):
    db = Database(tmp_path / "state.sqlite")
    market, experts = FakeMarket(), FakeExperts(ids)
    review = ReviewService(db, market, None)
    model = model or FakeModel()
    portfolio = PortfolioService(db, market, review, experts, model, clock=lambda: at(16, "08:00:00"))
    return db, market, review, experts, model, portfolio


def assessment(db, *, pid, code="600001", expert="alpha", recorded=None, observed=None, selected=None,
               trigger_day=17, kind="rule", verdict="triggered", eligible=None, stop=9, close=12):
    recorded = recorded or at(17)
    observed = observed or recorded
    selected = selected or at(16, "13:00:00")
    review_id = "r-" + pid
    plan = dict(plan_id=pid, expert_id=expert, expert_name=f"expert {expert}", code=code, category="个股",
                name=code, selected_at=selected.isoformat(), plan_kind=kind, entry_price=10,
                entry_direction="above", entry_note="", invalidation_price=stop, reason="frozen thesis")
    trigger = dict(date=at(trigger_day).date().isoformat(), price=close, source="rule" if kind == "rule" else "ai",
                   event="entry_price" if kind == "rule" else "entry_condition")
    ai = {"portfolio_eligible": eligible, "trigger_date": trigger["date"], "reason": "seen condition"}
    db.execute("INSERT OR IGNORE INTO selection_reviews(id,job_id) VALUES(?,?)", (review_id, "j-" + pid))
    db.execute("INSERT OR IGNORE INTO review_plan_archives VALUES(?,?)", (review_id, json.dumps([plan])))
    db.execute("""INSERT INTO review_assessments(review_id,plan_id,code,expert_id,observed_us,payload)
                   VALUES(?,?,?,?,?,?)""", (review_id, pid, code, expert, _us(recorded), json.dumps({
                       "status": verdict, "observed_at": observed.isoformat(), "trigger": trigger, "ai": ai})))


def book(service, expert="alpha"):
    return service.dashboard(expert_id=expert)["portfolios"][0]


def test_only_new_verified_triggers_and_late_detection_does_not_backdate(tmp_path):
    db, market, _, _, _, service = make(tmp_path)
    assert service.tick(now=at(16))["skipped"] == "no_pending_orders_or_positions"
    assert market.calls == []
    assessment(db, pid="legacy", selected=at(16, "07:00:00"))
    assessment(db, pid="force", kind="complex", eligible=False)
    assessment(db, pid="not-boolean", kind="complex", eligible=1)
    assessment(db, pid="unverified-rule", close=9.50)
    assessment(db, pid="early", observed=at(17, "14:00:00"))
    assessment(db, pid="future", observed=at(18))
    assessment(db, pid="ref", kind="reference", eligible=True)
    assessment(db, pid="superseded", kind="complex", eligible=True)
    assessment(db, pid="superseded", kind="complex", eligible=False, verdict="invalidated", recorded=at(18))
    assessment(db, pid="ok", kind="complex", eligible=True, observed=at(17), recorded=at(18, "01:00:00"))
    market.bars["600001"] = [bar(17, 13, 12), bar(18, 12, 13), bar(19, 11, 14), bar(20, 10, 13)]
    assert service.tick(now=at(19, "09:31:00"))["queued_entries"] == 1
    order, = book(service)["queued_orders"]
    assert order["plan_id"] == "ok" and order["decision_at"] == at(18, "01:00:00").isoformat()
    assert order["first_day"] == "2026-11-20" and not book(service)["fills"]
    assert service.tick(now=at(20, "09:29:59"))["fills"] == 0
    assert service.tick(now=at(20, "10:00:00"))["fills"] == 1
    filled = book(service)
    assert filled["fills"][0]["price"] == 10
    assert filled["open_positions"][0]["quantity"] == 2000
    assert filled["nav"] is None  # today's close was not observable yet
    assert service.tick(now=at(20))["fills"] == 0
    assert book(service)["nav"] == 106_000


def test_intraday_signal_queues_for_the_next_open_not_the_same_open(tmp_path):
    db, market, _, _, _, service = make(tmp_path)
    assessment(db, pid="noon", selected=at(17, "10:00:00"), trigger_day=17, recorded=at(17, "16:00:00"))
    market.bars["600001"] = [bar(16, 12, 12), bar(17, 12, 12), bar(18, 13, 13)]
    result = service.tick(now=at(17, "17:00:00"))
    assert result["fills"] == 0
    order = service.dashboard()["portfolios"][0]["queued_orders"][0]
    assert order["first_day"] == "2026-11-18"
    filled = service.tick(now=at(18, "09:31:00"))
    assert filled["fills"] == 1
    position = service.dashboard()["portfolios"][0]["open_positions"][0]
    assert position["entry_date"] == "2026-11-18" and position["entry_price"] == 13


def test_missing_bar_blocks_open_until_repaired_and_suspension_defers(tmp_path):
    db, market, _, _, _, service = make(tmp_path)
    assessment(db, pid="candidate")
    market.bars["600001"] = [bar(17, 12, 12), bar(19, 10, 11), bar(20, 14, 15)]
    service.tick(now=at(17))
    assert service.tick(now=at(19))["fills"] == 0
    queued, = book(service)["queued_orders"]
    assert "2026-11-18" in queued["status_reason"] and "停牌未确认" in queued["status_reason"]
    assert book(service)["nav_history"][-1]["nav"] is None
    market.bars["600001"].append(bar(18, 12, 12, volume=0))
    assert service.tick(now=at(20))["fills"] == 1
    filled, = book(service)["fills"]
    assert filled["session"] == "2026-11-19" and filled["processed_at"] == at(20).isoformat()
    assert filled["price"] == 10
    assert book(service)["nav_history"][-2]["nav"] == 102_000
    assert book(service)["nav"] == 110_000


def test_stop_and_grouped_paid_exit_with_replay_and_real_pnl(tmp_path):
    fake_model = FakeModel(configured=True, action="exit")
    db, market, review, experts, model, service = make(tmp_path, model=fake_model)
    for pid, code, stop in [("hard", "600001", 9), ("ai-1", "600002", 1), ("ai-2", "600003", 1)]:
        assessment(db, pid=pid, code=code, stop=stop)
    market.bars.update({"600001": [bar(17, 12, 12), bar(18, 10, 8), bar(19, 7, 6)],
                        "600002": [bar(17, 12, 12), bar(18, 20, 21), bar(19, 22, 23)],
                        "600003": [bar(17, 12, 12), bar(18, 20, 21), bar(19, 20, 23), bar(23, 900, 900)]})
    service.tick(now=at(17))
    assert not model.calls
    assert service.tick(now=at(18, "14:59:59"))["fills"] == 3
    assert not model.calls and book(service)["nav"] is None
    gated = service.tick(now=at(18, "15:04:59"))
    assert gated["hard_exits"] == 1 and gated["model_calls"] == 0
    assert service.tick(now=at(18))["model_exits"] == 2
    data, params = model.calls[0]
    assert params["model"] == "fake-holding-model" and params["max_tool_rounds"] == 1
    assert {p["code"] for p in data["positions"]} == {"600002", "600003"}
    assert all(row["date"] <= data["session"] for p in data["positions"] for row in p["bars"])
    pending = book(service)
    assert pending["nav"] == 98_000
    assert sorted(o["source"]["kind"] for o in pending["queued_orders"]) == ["hard_invalidation", "holding_model", "holding_model"]
    assert {o["first_day"] for o in pending["queued_orders"]} == {"2026-11-19"}
    assert pending["closed_win_rate"] is None and pending["closed_count"] == 0
    db.close()
    new_db = Database(tmp_path / "state.sqlite")
    restarted = PortfolioService(new_db, market, review, experts, model, clock=lambda: at(18, "17:00:00"))
    assert restarted.dashboard()["started_at"] == at(16, "08:00:00").isoformat()
    assert restarted.tick(now=at(18, "17:00:00"))["model_calls"] == 0 and len(model.calls) == 1
    assert restarted.tick(now=at(19))["fills"] == 3
    assert restarted.tick(now=at(19))["fills"] == 0
    closed = book(restarted)
    assert closed["closed_count"] == 3 and closed["closed_wins"] == 1
    assert closed["closed_win_rate"] == pytest.approx(1 / 3)
    assert closed["cash"] == closed["nav"] == 96_000
    assert closed["realized_pnl"] == -4_000 and closed["unrealized_pnl"] == 0
    assert closed["max_drawdown"] == pytest.approx(-.04)
    assert restarted.dashboard()["benchmark"]["code"] == CSI300


def test_unsupported_model_output_does_not_queue_or_retry_and_no_past_reviews(tmp_path):
    model = FakeModel(configured=True, action="exit", malformed=True)
    db, market, _, _, _, service = make(tmp_path, model=model)
    assessment(db, pid="p")
    market.bars["600001"] = [bar(17, 10, 11), bar(18, 11, 12), bar(19, 11, 12)]
    service.tick(now=at(17))
    service.tick(now=at(19, "11:00:00"))  # replay the eighteenth open, not an eighteenth AI call
    assert not model.calls
    assert service.tick(now=at(19))["model_calls"] == 1
    assert book(service)["holding_reviews"][0]["status"] == "invalid_response"
    assert not book(service)["queued_orders"]
    assert service.tick(now=at(19, "17:00:00"))["model_calls"] == 0
    assert len(model.calls) == 1


def test_five_slots_and_book_cash_are_isolated(tmp_path):
    db, market, _, _, _, service = make(tmp_path, ids=("alpha", "beta"))
    for i in range(1, 8):
        code = f"60000{i}"
        assessment(db, pid=f"a{i}", code=code, stop=None)
        market.bars[code] = [bar(17, 12, 12), bar(18, 20, 20), bar(19, 25, 25)]
    assessment(db, pid="b1", code="600001", expert="beta", stop=None)
    service.tick(now=at(17))
    assert service.tick(now=at(18))["fills"] == 6
    one, two = service.dashboard()["portfolios"]
    assert len(one["open_positions"]) == 5 and one["cash"] == 0
    assert {p["quantity"] for p in one["open_positions"]} == {1000}
    assert [o["status"] for o in one["order_history"]].count("rejected") == 2
    assert len(two["open_positions"]) == 1 and two["cash"] == 80_000


def test_real_close_gap_keeps_nav_null_and_refuses_new_buy_sizing(tmp_path):
    db, market, _, _, _, service = make(tmp_path)
    assessment(db, pid="p1", stop=None)
    market.bars["600001"] = [bar(17, 12, 12), {**bar(18, 10, 11), "close_price": None}, bar(19, 12, 13)]
    market.bars["600002"] = [bar(19, 11, 11)]
    service.tick(now=at(17))
    assessment(db, pid="p2", code="600002", recorded=at(18), stop=None)
    service.tick(now=at(18))
    partial = book(service)
    assert partial["nav"] is None and partial["unrealized_pnl"] is None
    assert any("真实收盘" in reason for reason in partial["warnings"])
    assert service.tick(now=at(19))["fills"] == 0
    assert "20%" in book(service)["queued_orders"][0]["status_reason"]
    market.bars["600001"][1] = bar(18, 10, 15)
    assert service.tick(now=at(20))["fills"] == 1
    assert book(service)["fills"][-1]["evidence"]["target_nav"] == 110_000
    assert book(service)["open_positions"][1]["quantity"] == 2000


def test_today_reviews_obey_global_budget_even_on_repeated_ticks(tmp_path):
    model = FakeModel(configured=True)
    ids = tuple(f"expert-{i}" for i in range(7))
    db, market, _, _, _, service = make(tmp_path, ids=ids, model=model)
    market.bars["600001"] = [bar(17, 12, 12), bar(18, 10, 12), bar(19, 11, 12)]
    market.index = []  # independent calendar is available but benchmark is not
    for i, key in enumerate(ids):
        assessment(db, pid=f"p-{i}", expert=key, stop=None)
    service.tick(now=at(17))
    assert [service.tick(now=at(18))["model_calls"] for _ in range(5)] == [2, 2, 2, 0, 0]
    assert len(model.calls) == 6
    assert service.dashboard()["benchmark"] is None
    assert all(len(p["holding_reviews"]) <= 1 for p in service.dashboard()["portfolios"])
    service.tick(now=at(19))
    assert model.calls[6][0]["positions"][0]["position_id"] == "buy:p-6"  # previously capped goes first


def test_side_specific_open_limit_defers_to_next_supported_bar(tmp_path):
    db, market, _, _, _, service = make(tmp_path)
    assessment(db, pid="p")
    market.bars["600001"] = [bar(17, 12, 12), bar(18, 11, 11, limit_up_price=11), bar(19, 12, 10)]
    service.tick(now=at(17))
    assert service.tick(now=at(18))["fills"] == 0
    assert "涨跌停" in book(service)["queued_orders"][0]["status_reason"]
    assert service.tick(now=at(19))["fills"] == 1
    assert book(service)["fills"][0]["session"] == "2026-11-19"
