"""Selection review: only triggered entries earn returns; untriggered stays zero exposure."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier
import json
import tempfile
from pathlib import Path

import pytest

from backend.db import Database
from types import SimpleNamespace

from backend.review import ReviewError, ReviewService

SH = timezone(timedelta(hours=8))
START = datetime(2026, 1, 5, tzinfo=SH)


def bars(closes, start=START):
    rows = []
    day = start
    for close in closes:
        rows.append({"date_ms": int(day.timestamp() * 1000), "close_price": close,
                     "open_price": close, "high_price": close, "low_price": close, "volume": 150 if day.day == 7 else 100})
        day += timedelta(days=1)
    return rows


class FakeMarket:
    def __init__(self, series):
        self.series = series
        self.calls = []

    def history(self, code, limit=120, adjust="forward"):
        self.calls.append((code, adjust))
        return {"items": self.series.get(code, []), "timestamp": 1, "adjust": adjust}

    def fund_history(self, code, limit=120):
        return {"items": self.series.get(code, []), "timestamp": 1}

    def fund_research(self, code):
        return {"nav": {"data": {"items": []}}}


class FakeJobs:
    def __init__(self, jobs):
        self.jobs = jobs

    def get(self, job_id):
        return self.jobs.get(job_id)


def pick(code, entry_price=None, direction=None, invalidation=None, confidence="high", name="测试股", note=None):
    item = {"code": code, "name": name, "reason": "证据符合理念", "why_fit": "现金流可核实",
            "confidence": confidence, "risks": [], "missing_evidence": [],
            "evidence": [{"source_id": "s1", "ref": "/data/items/0/last_price"}]}
    if entry_price is not None:
        item["entry_price"] = entry_price
        item["entry_direction"] = direction
    if invalidation is not None:
        item["invalidation_price"] = invalidation
    if note is not None:
        item["entry_note"] = note
    return item


def job(picks, finished="2026-01-05T15:00:00+08:00"):
    experts = [{"expert": {"id": "price_action", "name": "价格行为派"},
                "picks": [p for p in picks if p.get("code") in ("000001",)]},
               {"expert": {"id": "buffett", "name": "巴菲特"},
                "picks": [p for p in picks if p.get("code") in ("000002",)]}]
    return {"id": "job-1", "status": "done", "created_at": finished, "finished_at": finished,
            "payload": {"scope": "market", "expert_ids": ["price_action", "buffett"]},
            "result": {"expert_results": experts}}


@pytest.fixture
def build():
    root = Path(tempfile.mkdtemp())
    db = Database(root / "review.sqlite")

    def make(series, picks, finished="2026-01-05T15:00:00+08:00", model=None):
        service = ReviewService(db, FakeMarket(series), FakeJobs({"job-1": job(picks, finished)}), model=model)
        return service

    yield make
    db.close()


def test_triggered_entry_returns_are_measured_from_the_trigger_bar(build):
    service = build({"000001": bars([10, 11, 13, 14, 15, 16])},
                    [pick("000001", entry_price=12.5, direction="above")])
    review = service.archive("job-1")
    detail = service.get(review["id"])
    target = detail["targets"][0]
    assert target["metrics"]["status"] == "triggered"
    assert target["metrics"]["trigger"]["date"] == "2026-01-07"
    assert target["metrics"]["windows"]["1d"] == round(14 / 13 - 1, 6)
    assert target["metrics"]["windows"]["5d"] is None
    assert detail["benchmark"]["entered"] == 1


def test_untriggered_pick_earns_no_return_and_is_counted_as_not_entered(build):
    closes = [10] * 4 + [10.2] * 20
    service = build({"000001": bars(closes)}, [pick("000001", entry_price=12.5, direction="above")])
    review = service.archive("job-1")
    metrics = service.get(review["id"])["targets"][0]["metrics"]
    assert metrics["status"] == "not_triggered"
    assert metrics["windows"] == {} and metrics["current"] is None
    assert "未入场" in metrics["reason"]


def test_invalidation_before_trigger_voids_the_pick(build):
    service = build({"000001": bars([10, 9.5, 9.0, 9.2, 9.4, 9.6])},
                    [pick("000001", entry_price=12.5, direction="above", invalidation=9.8)])
    review = service.archive("job-1")
    metrics = service.get(review["id"])["targets"][0]["metrics"]
    assert metrics["status"] == "invalidated"
    assert metrics["windows"] == {}


def test_intraday_selection_can_use_that_sessions_close(build):
    service = build({"000001": bars([10, 13, 14])}, [pick("000001", 10.5, "below")],
                    finished="2026-01-05T10:26:00+08:00")
    metrics = service.get(service.archive("job-1")["id"])["targets"][0]["metrics"]
    assert metrics["status"] == "triggered"
    assert metrics["base_date"] == "2026-01-05" and metrics["base_price"] == 10


def test_selection_after_the_close_starts_with_the_next_session(build):
    service = build({"000001": bars([10, 13])}, [pick("000001", 10.8, "below")],
                    finished="2026-01-05T15:30:00+08:00")
    metrics = service.get(service.archive("job-1")["id"])["targets"][0]["metrics"]
    assert metrics["status"] == "pending"


def test_no_condition_is_reference_only_and_explicitly_labelled(build):
    service = build({"000001": bars([10, 11, 12, 13, 14, 15])}, [pick("000001")])
    review = service.archive("job-1")
    metrics = service.get(review["id"])["targets"][0]["metrics"]
    assert metrics["status"] == "reference" and metrics["base_price"] == 10
    assert metrics["windows"]["5d"] == round(15 / 10 - 1, 6)


def test_expert_ranking_requires_ten_triggered_picks(build):
    service = build({"000001": bars([10, 11, 13, 14, 15, 16])},
                    [pick("000001", entry_price=12.5, direction="above")])
    review = service.archive("job-1")
    expert = [row for row in service.get(review["id"])["experts"] if row["expert"] == "价格行为派"][0]
    assert expert["triggered"] == 1 and expert["ranked"] is False and "rank" not in expert
    assert expert["trigger_rate"] == 1.0


def test_duplicate_archive_returns_the_same_review(build):
    service = build({"000001": bars([10, 11, 13])}, [pick("000001", entry_price=12.5, direction="above")])
    first = service.archive("job-1")
    second = service.archive("job-1")
    assert first["id"] == second["id"] and service.count() == 1


def test_unfinished_job_cannot_be_archived(build):
    service = build({"000001": bars([10, 11])}, [pick("000001")])
    service.jobs.jobs["job-1"]["status"] = "running"
    with pytest.raises(ReviewError):
        service.archive("job-1")

class FakeModel:
    def __init__(self, replies, configured=True):
        self.settings = SimpleNamespace(configured=configured, model="fake-reviewer")
        self.replies = list(replies)
        self.calls = []

    def chat(self, messages, **kwargs):
        self.calls.append({**kwargs, "input": json.loads(messages[-1]["content"])})
        return {"content": self.replies.pop(0)}


def verified_trigger():
    return json.dumps({'status':'triggered','trigger_date':'2026-01-07','trigger_price':999,
                       'confidence':'medium','reason':'放量站上12.5','all_conditions_verified':True,
                       'checks':[{'condition':'收盘站上12.5','facts':[{'date':'2026-01-07','field':'close','value':13}]},
                                 {'condition':'放量','facts':[{'date':'2026-01-06','field':'volume','value':100},
                                                             {'date':'2026-01-07','field':'volume','value':150}]}]})


def test_ai_judgment_can_trigger_a_complex_condition(build):
    real_trigger = verified_trigger()
    model = FakeModel([real_trigger, real_trigger])
    service = build({"000001": bars([10, 11, 13, 14, 15, 16])},
                    [pick("000001", 12.5, "above", note="放量站上12.5")], model=model)
    review = service.archive("job-1")
    result = service.judge(review["id"])
    assert result["judged"][0]["status"] == "triggered"
    metrics = service.get(review["id"])["targets"][0]["metrics"]
    assert metrics["status"] == "triggered"
    assert metrics["base_date"] == "2026-01-07" and metrics["base_price"] == 13
    assert metrics["ai"]["reason"] == "放量站上12.5"
    assert metrics["trigger"]["is_fill"] is False and metrics["trigger"]["price"] == 13
    assert model.calls[0]["response_format_json"] is True
    assert [row["date"] for row in model.calls[1]["input"]["bars"]] == ["2026-01-05", "2026-01-06", "2026-01-07"]
    assert model.calls[1]["input"]["observation_from"] == "2026-01-06"


def test_ai_judgment_retries_a_fake_event_date_then_closes_conservatively(build):
    model = FakeModel(['{"status":"triggered","trigger_date":"2026-02-30","confidence":"high","reason":"x"}',
                       '{"status":"not_triggered","confidence":"low","reason":"没有真实交易日满足"}'])
    service = build({"000001": bars([10, 11, 12])}, [pick("000001", note="放量突破")], model=model)
    review = service.archive("job-1")
    service.judge(review["id"])
    metrics = service.get(review["id"])["targets"][0]["metrics"]
    assert metrics["status"] == "pending" and metrics["windows"] == {}
    assert "没有真实交易日满足" in metrics["ai"]["reason"]


def test_complex_plan_never_reaching_its_price_is_pending_without_a_model_call(build):
    model = FakeModel([])
    service = build({"000001": bars([10, 11, 12])}, [pick("000001", 30, "above", note="放量突破")], model=model)
    rid = service.archive("job-1")["id"]
    assert service.get(rid)["targets"][0]["metrics"]["status"] == "pending"
    result = service.judge(rid)
    assert result["judged"] == [] and model.calls == []
    assert service.get(rid)["targets"][0]["metrics"]["status"] == "pending"


def test_intraday_bars_are_offered_for_daily_unprovable_sequencing(build):
    model = FakeModel([verified_trigger(), verified_trigger()])
    service = build({"000001": bars([10, 11, 13])}, [pick("000001", 12.5, "above", note="回踩后放量突破")], model=model)
    service._minute = SimpleNamespace(bars=lambda code, **kwargs: [
        {"datetime": "2026-01-07 09:35", "date": "2026-01-07", "open": 12.4, "high": 12.6,
         "low": 12.3, "close": 12.5, "volume": 1200},
        {"datetime": "2026-01-07 10:00", "date": "2026-01-07", "open": 12.5, "high": 13.2,
         "low": 12.5, "close": 13.0, "volume": 2600}])
    review = service.archive("job-1")
    result = service.judge(review["id"])
    assert result["judged"][0]["status"] == "triggered"
    payload = model.calls[0]["input"]
    assert payload["intraday_5m"][0]["datetime"] == "2026-01-07 09:35"
    assert payload["observation_from"] == "2026-01-06"


def test_second_judge_skips_already_judged_targets(build):
    model = FakeModel(['{"status":"not_triggered","trigger_date":null,"confidence":"high","reason":"wait"}'])
    service = build({"000001": bars([10, 11, 12])}, [pick("000001", note="放量突破")], model=model)
    review = service.archive("job-1")
    service.judge(review["id"])
    again = service.judge(review["id"])
    assert again["judged"] == [] and again["skipped"] == ["000001"]
    assert len(model.calls) == 1


def test_judge_requires_a_configured_model(build):
    model = FakeModel([], configured=False)
    service = build({"000001": bars([10, 11])}, [pick("000001", note="放量突破")], model=model)
    review = service.archive("job-1")
    with pytest.raises(ReviewError):
        service.judge(review["id"])

def test_reset_clears_reviews_without_losing_selection_history(build):
    service = build({}, [pick('000001')])
    source = job([pick('000001')])
    service.db.execute("INSERT INTO jobs(id,type,status,payload,result,created_at,finished_at) VALUES(?,?,?,?,?,?,?)",
                       ('job-1','expert_selection','done',json.dumps(source['payload']),json.dumps(source['result']),source['created_at'],source['finished_at']))
    rid = service.archive('job-1')['id']
    with pytest.raises(ReviewError):
        service.reset_history([])
    assert service.reset_history([rid]) == {'deleted_reviews':1,'excluded_source_jobs':1}
    assert service.count() == 0 and service.sync()['archived'] == []
    assert service.db.query_one("SELECT status FROM jobs WHERE id='job-1'")['status'] == 'done'
    assert service.recent_expert_picks('price_action')['000001']['times'] == 1
    assert service.recent_expert_picks('buffett') == {}


def test_delete_removes_review_and_judgments(build):
    service = build({"000001": bars([10, 11, 12])}, [pick("000001")])
    review = service.archive("job-1")
    assert service.count() == 1
    service.delete(review["id"])
    assert service.count() == 0
    with pytest.raises(ReviewError):
        service.get(review["id"])

def test_deleted_review_is_not_recreated_by_sync(build):
    service = build({"000001": bars([10, 11, 12])}, [pick("000001")])
    review = service.archive("job-1")
    service.delete(review["id"])
    service.sync()
    assert service.count() == 0

def test_low_confidence_picks_never_enter_the_review(build):
    service = build({"000001": bars([10, 11, 12]), "000002": bars([10, 11, 12])},
                    [pick("000001", confidence="low"), pick("000002", confidence="medium")])
    review = service.archive("job-1")
    detail = service.get(review["id"])
    assert [item["code"] for item in detail["targets"]] == ["000002"]
    assert any("低信心度" in warning for warning in detail["warnings"])


def test_only_low_confidence_picks_are_not_archived(build):
    service = build({"000001": bars([10, 11, 12])}, [pick("000001", confidence="low")])
    with pytest.raises(ReviewError):
        service.archive("job-1")
    assert service.count() == 0


def test_same_stock_keeps_independent_plans_and_names_are_not_ids(build):
    service = build({"000001": bars([10, 9, 13, 15, 16, 17, 18, 19, 20])}, [])
    original = service.jobs.jobs["job-1"]
    original["result"]["expert_results"] = [
        {"expert": {"id": "a", "name": "同名", "tag": " 风格 "},
         "picks": [pick("000001", 12, "above", note="收盘价≥12元")]},
        {"expert": {"id": "b", "name": "同名", "tag": "风格"},
         "picks": [pick("000001", 14, "above", invalidation=9, confidence="medium")]},
        {"expert": {"id": "c", "name": "低信心"}, "picks": [pick("000001", confidence="low")]},
    ]
    archived = service.archive("job-1")
    assert service.market.calls == []
    assert archived["target_count"] == 1 and archived["plan_count"] == 2
    original["result"]["expert_results"][0]["expert"]["name"] = "修改名称"
    original["result"]["expert_results"][0]["picks"][0]["entry_price"] = 1000
    detail = service.get(archived["id"])
    target = detail["targets"][0]
    a, b = target["plans"]
    assert a["expert_id"] == "a" and b["expert_id"] == "b" and a["plan_id"] != b["plan_id"]
    assert a["expert_name"] == b["expert_name"] == "同名" and a["expert_tag"] == " 风格 "
    assert a["entry_price"] == 12 and a["metrics"]["status"] == "triggered"
    assert b["entry_price"] == 14 and b["metrics"]["status"] == "invalidated"
    assert target["metrics"]["status"] == "multiple_plans" and target["entry_price"] is None
    assert detail["counts"]["triggered"] == detail["counts"]["invalidated"] == 1
    assert detail["benchmark"]["stock_total"] == detail["benchmark"]["windows"]["5d"]["plan_sample"] == 1
    assert [(e["expert_id"], e["samples"]) for e in detail["experts"]] == [("a", 1), ("b", 0)]
    assert service.market.calls == [("000001", "none")]
    assert service.history_context([], expert_tag=" 风格 ")[0]["expert_id"] == "a"
    assert service.history_context([], expert_tag="风格") == []


def insert_legacy(service, with_judgment=True):
    service.db.execute("INSERT INTO selection_reviews VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
        "legacy-review", "job-1", "2026-01-05", "2026-01-05", "market", None, "old",
        json.dumps(["price_action"]), json.dumps([{"code": "000001", "experts": ["old"], "entry_price": 1}]),
        "tracking", "[]"))
    if with_judgment:
        service.db.execute("INSERT INTO review_judgments VALUES(?,?,?,?,?,?,?,?,?)", (
            "legacy-review", "000001", "triggered", "2026-01-06", 999, "high", "旧合并判定", "old", "2026-01-06"))


def test_legacy_migrates_only_from_original_job_and_ignores_merged_judgment(build):
    service = build({"000001": bars([10, 11, 12])}, [pick("000001", 20, "above", note="量价配合")])
    original = service.jobs.jobs.pop("job-1")
    insert_legacy(service)
    legacy = service.get("legacy-review")
    assert legacy["legacy"] and legacy["target_count"] == 1 and legacy["plan_count"] == 0
    assert legacy["targets"][0]["metrics"]["status"] == "legacy" and legacy["experts"] == []
    assert service.judge("legacy-review")["judged"] == []
    assert service.history_context(["000001"]) == [] and service.market.calls == []
    service.jobs.jobs["job-1"] = original
    assert service.list()[0]["plan_count"] == 1  # read upgrades in place
    service.jobs.jobs.clear()
    migrated = service.get("legacy-review")
    target = migrated["targets"][0]
    assert not migrated["legacy"] and target["entry_price"] == 20
    assert target["plans"][0]["expert_id"] == "price_action"
    assert target["metrics"]["status"] == "pending" and target["metrics"]["ai"] is None


def test_intraday_selection_waits_for_the_close_then_uses_that_close(build, monkeypatch):
    service = build({"000001": bars([9, 20, 11, 20, 20], start=START - timedelta(days=1))},
                    [pick("000001", 15, "above")], finished="2026-01-05T04:00:00+00:00")
    noon = START.replace(hour=12)
    monkeypatch.setattr(service, "_now", lambda: noon)
    review = service.archive("job-1")
    target = service.get(review["id"])["targets"][0]
    assert target["entry"]["date"] == "2026-01-04" and target["entry"]["price"] == 9
    # The session is still live: its close is not a fact yet.
    assert target["metrics"]["status"] == "pending"
    monkeypatch.setattr(service, "_now", lambda: noon + timedelta(hours=4))
    metrics = service.get(review["id"])["targets"][0]["metrics"]
    assert metrics["status"] == "triggered" and metrics["base_date"] == "2026-01-05"
    assert metrics["is_fill"] is False


def test_hit_after_twenty_session_deadline_cannot_reopen_plan(build):
    service = build({"000001": bars([10] * 21 + [20])}, [pick("000001", 15, "above")])
    result = service.get(service.archive("job-1")["id"])["targets"][0]["metrics"]
    assert result["status"] == "not_triggered" and result["days_waited"] == 20


def test_ai_pending_cache_refreshes_on_new_bars_and_terminal_prefix_is_reusable(build):
    model = FakeModel(['{"status":"not_triggered","reason":"等待"}',
                       verified_trigger()])
    market = {"000001": bars([10, 11])}
    service = build(market, [pick("000001", note="放量且收盘突破")], model=model)
    rid = service.archive("job-1")["id"]
    assert service.judge(rid)["judged"][0]["status"] == "pending"
    assert service.judge(rid)["skipped"] == ["000001"]
    market["000001"] = bars([10, 11, 13])
    assert service.get(rid)["targets"][0]["metrics"]["status"] == "needs_ai"
    assert service.judge(rid)["judged"][0]["status"] == "triggered"
    market["000001"] = bars([10, 11, 13, 14])
    assert service.judge(rid)["skipped"] == ["000001"] and len(model.calls) == 2
    assert service.get(rid)["targets"][0]["metrics"]["windows"]["1d"] == round(14 / 13 - 1, 6)
    market["000001"][1]["volume"] = 999
    assert service.get(rid)["targets"][0]["metrics"]["status"] == "needs_ai"
    result = service.judge(rid)
    assert result["judged"] == [] and len(result["errors"]) == 1
    assert service.get(rid)["targets"][0]["metrics"]["status"] == "needs_ai"


def test_ai_prefix_disagreement_cannot_enter_portfolio_and_skips_simple_rules(build):
    model = FakeModel(['{"status":"triggered","trigger_date":"2026-01-06"}', '{"status":"not_triggered"}'])
    service = build({"000001": bars([10, 11, 13]), "000002": bars([10, 11, 12])},
                    [pick("000001", note="等待形态确认"), pick("000002", 11, "above")], model=model)
    rid = service.archive("job-1")["id"]
    result = service.judge(rid)
    assert result["skipped"] == ["000002"]
    assert result["judged"][0]["status"] == "ambiguous"
    assert 'portfolio_eligible' not in result['judged'][0]
    assert service.get(rid)['targets'][0]['metrics']['windows'] == {}


def test_history_cutoff_reads_only_persisted_state_without_backdating(build, monkeypatch):
    series = {"000001": bars([10, 13, 12, 14, 15, 16, 17, 18])}
    service = build(series, [pick("000001", 12, "above")])
    service.jobs.jobs["job-1"]["result"]["expert_results"][0]["expert"]["tag"] = "原始标签"
    day = START.replace(hour=16)
    monkeypatch.setattr(service, "_now", lambda: day)
    review = service.archive("job-1")
    initial = service.history_context(["000001.SZ"], expert_id="price_action")[0]
    assert initial["status"] == "pending" and initial["as_of"] is None and initial["windows"] == {}
    assert initial["expert_tag"] == "原始标签" and initial["thesis"] == "证据符合理念"
    assert initial["entry_price"] == 12 and service.market.calls == []
    assert service.history_context(["000001"], as_of="2026-01-05T07:59:59Z") == []
    assert service.history_context([], expert_tag="原始标签") == []
    day += timedelta(days=8)
    service.get(review["id"])
    assert len(service.market.calls) == 1
    latest = service.history_context(["000001"], limit=1)[0]
    assert latest["status"] == "triggered" and latest["windows"]["5d"] == round(17 / 13 - 1, 6)
    assert latest["source"] == "selection_review" and latest["trigger"]["is_fill"] is False
    assert service.history_context(["000001"], as_of="2026-01-12") == [initial]
    assert service.history_context(["000001"], as_of="bad") == []
    assert service.history_context([], expert_tag="原始标签") == [latest]
    assert service.history_context(["000001"], expert_id="buffett") == []
    assert len(service.market.calls) == 1
    day += timedelta(days=1)
    series["000001"] = bars([10] * 8)  # corrected input revokes current maturity, not past knowledge
    service.get(review["id"])
    assert service.history_context([], expert_tag="原始标签") == []
    assert service.history_context([], expert_tag="原始标签", as_of="2026-01-13") == [latest]
    service.delete(review["id"])
    assert service.history_context(["000001"]) == []


def test_sync_prioritizes_qualifying_jobs_and_tolerates_malformed_old_results(build):
    service = build({}, [])
    for i, result in enumerate([
        json.dumps(job([pick("000001", confidence="medium")])["result"]),
        json.dumps(job([pick("000001", confidence="low")])["result"]),
        '{"expert_results":["invalid",{"expert":{"id":"a"},"picks":["invalid"]}]}',
        '{not json',
    ]):
        job_id = f"job-{i+10}"
        content = job([])
        if i != 3:
            content["result"] = json.loads(result)
        service.jobs.jobs[job_id] = content
        service.db.execute("INSERT INTO jobs(id,type,status,result,created_at) VALUES(?,?,?,?,?)",
                           (job_id, "expert_selection", "done", result, f"2026-01-{i+5:02}"))
    archived = service.sync(limit=1)
    assert [r["job_id"] for r in archived["archived"]] == ["job-10"]
    assert service.sync(limit=1)["archived"] == [] and service.market.calls == []


def test_concurrent_sync_reports_single_archive_and_single_frozen_snapshot(build, monkeypatch):
    service = build({}, [pick("000001")])
    original = service.jobs.jobs["job-1"]
    service.db.execute("INSERT INTO jobs(id,type,status,result,created_at) VALUES(?,?,?,?,?)", (
        "job-1", "expert_selection", "done", json.dumps(original["result"]), original["created_at"]))
    both = Barrier(2)
    lookup = service.jobs.get

    def synchronized_lookup(job_id):
        both.wait(timeout=5)
        return lookup(job_id)

    monkeypatch.setattr(service.jobs, "get", synchronized_lookup)
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: service.sync(limit=1), range(2)))
    assert sum(len(result["archived"]) for result in results) == 1
    assert service.count() == 1 and len(service.history_context(["000001"])) == 1
    assert service.market.calls == []


def test_preclose_cached_market_bar_is_not_accepted_after_close(build, monkeypatch):
    series = {"000001": bars([10, 20])}
    service = build(series, [pick("000001", 15, "above")])
    now = START + timedelta(days=1, hours=15, seconds=1)
    monkeypatch.setattr(service, "_now", lambda: now)
    monkeypatch.setattr(service.market, "history", lambda code, **_: {
        "items": series[code], "fetched_at": (now - timedelta(seconds=2)).isoformat(), "cached": True})
    rid = service.archive("job-1")["id"]
    assert service.get(rid)["targets"][0]["metrics"]["status"] == "pending"


def test_refresh_due_is_bounded_round_robin_and_never_uses_ai(build, monkeypatch):
    model = FakeModel([])
    service = build({"000001": bars([10, 13]), "000002": bars([10, 11])},
                    [pick("000001", 12, "above"), pick("000002", note="等待结构形成")], model=model)
    monkeypatch.setattr(service, "_now", lambda: START + timedelta(days=1, hours=16))
    service.archive("job-1")
    assert service.refresh_due(max_targets=1) == {"refreshed": 1}
    assert service.history_context(["000001"])[0]["status"] == "triggered"
    assert service.history_context(["000002"])[0]["status"] == "pending"
    assert service.refresh_due(max_targets=1) == {"refreshed": 1}
    assert service.history_context(["000002"])[0]["status"] == "needs_ai"
    assert service.refresh_due(max_targets=1) == {"refreshed": 0}
    assert len(service.market.calls) == 2 and model.calls == []


def test_auto_judge_runs_once_per_trading_day_after_close(build, monkeypatch):
    reply = verified_trigger()
    model = FakeModel([reply, reply])
    service = build({"000001": bars([10, 11, 13, 14, 15, 16, 17, 18])},
                    [pick("000001", 12.5, "above", note="放量站上12.5")], model=model)
    monkeypatch.setattr(service, "_now", lambda: START + timedelta(days=6, hours=15, minutes=6))
    review = service.archive("job-1")
    # 2026-01-12 is a Monday; the last fake bar is that day's close.
    monkeypatch.setattr(service, "_now", lambda: START + timedelta(days=7, hours=15, minutes=6))
    assert service.refresh_due(max_targets=1)["refreshed"] == 1
    first = service.auto_judge_due()
    assert first["judged"] == 1 and first["date"] == "2026-01-12"
    assert len(model.calls) == 2
    second = service.auto_judge_due()
    assert second["judged"] == 0 and len(model.calls) == 2
    assert service.get(review["id"])["targets"][0]["metrics"]["status"] == "triggered"


def test_auto_judge_does_nothing_before_close_or_on_stale_bars(build, monkeypatch):
    model = FakeModel([])
    service = build({"000001": bars([10, 11, 13, 14, 15, 16, 17])},
                    [pick("000001", 12.5, "above", note="放量站上12.5")], model=model)
    monkeypatch.setattr(service, "_now", lambda: START + timedelta(days=6, hours=15, minutes=6))
    service.archive("job-1")
    service.refresh_due(max_targets=1)
    monkeypatch.setattr(service, "_now", lambda: START + timedelta(days=7, hours=14, minutes=30))
    assert service.auto_judge_due()["skipped"] == "before_close"
    # After close, but the latest completed bar is still yesterday's.
    monkeypatch.setattr(service, "_now", lambda: START + timedelta(days=7, hours=15, minutes=6))
    service.refresh_due(max_targets=1)
    assert service.auto_judge_due()["judged"] == 0
    assert model.calls == []


def test_auto_judge_skips_without_a_configured_model(build, monkeypatch):
    service = build({"000001": bars([10, 11, 13])}, [pick("000001", note="放量站上")],
                    model=FakeModel([], configured=False))
    monkeypatch.setattr(service, "_now", lambda: START + timedelta(days=7, hours=15, minutes=6))
    assert service.auto_judge_due()["skipped"] == "model_not_configured"


def test_pending_count_tracks_only_unarchived_qualifying_jobs(build):
    service = build({}, [pick('000001')])
    assert service.pending_count() == 0
    source = job([pick('000001')])
    for job_id in ('job-2', 'job-3'):
        service.jobs.jobs[job_id] = {**source, 'id': job_id}
        service.db.execute("INSERT INTO jobs(id,type,status,payload,result,created_at,finished_at) VALUES(?,?,?,?,?,?,?)",
                           (job_id, 'expert_selection', 'done', json.dumps(source['payload']),
                            json.dumps(source['result']), source['created_at'], source['finished_at']))
    assert service.pending_count() == 2
    service.sync()
    assert service.pending_count() == 0 and service.count() == 2
    service.db.execute("INSERT INTO jobs(id,type,status,payload,result,created_at,finished_at) VALUES(?,?,?,?,?,?,?)",
                       ('job-4', 'expert_selection', 'done', '{}', json.dumps({'expert_results': []}),
                        source['created_at'], source['finished_at']))
    assert service.pending_count() == 0
