"""FakeModel uses real tools/source and real subprocess evaluation; no paid API."""
from types import SimpleNamespace
import threading

import pandas as pd
import pytest

from backend.db import Database
from backend.jobs import JobManager
from backend.factors.research import FactorResearchService, FactorResearchError
from backend.factors.service import FactorService
from tests.test_factor_batch import make_csv, UP, DOWN


class FakeModel:
    settings = SimpleNamespace(configured=True, timeout=30)

    def __init__(self, sources=None):
        self.sources = sources or [UP, DOWN]
        self.calls = 0
        self.tool_results = []
        self.messages = []

    def chat(self, messages, *, tools, tool_impls, before_round, timeout, **kwargs):
        self.messages = messages
        assert "write_rule" in [t["function"]["name"] for t in tools]
        assert callable(timeout)
        before_round()
        self.calls += 1
        for i, source in enumerate(self.sources):
            rule = tool_impls["write_rule"]({"source": source, "name": f"自主{i}"})
            self.tool_results.append(rule)
            if "rule_id" in rule:
                self.tool_results.append(tool_impls["evaluate_rule"]({"rule_id": rule["rule_id"]}))
        tool_impls["finish"]({"note": "真实工具完成"})
        # ModelClient always starts another round after tool calls. Service must
        # intercept finish rather than send another paid request or call it failure.
        before_round()
        return {"content": "fake accuracy 100% MUST NOT BE PARSED"}


@pytest.fixture
def setup(tmp_path):
    root = tmp_path / "data"
    make_csv(root, code="000001")
    make_csv(root, code="000002", falling=True)
    make_csv(root, "ETF", code="000001")
    make_csv(root, "指数", code="000001", n=20)
    db = Database(tmp_path / "state.sqlite")
    jobs = JobManager(db, max_workers=1)
    model = FakeModel()
    service = FactorResearchService(FactorService(root), model, jobs, db)
    yield root, db, jobs, model, service
    jobs._pool.shutdown(wait=True)
    db.close()


def flush(jobs, job):
    jobs._pool.submit(lambda: None).result(timeout=60)
    return jobs.get(job["id"])


def test_all_scope_real_tools_independent_winners_and_envelope(setup):
    root, db, jobs, model, service = setup
    assert service.current_report("000001") is None
    assert service.universe()["total"] == 4
    assert model.calls == 0
    job = flush(jobs, service.submit())
    assert job["status"] == "done", job
    result = job["result"]
    assert result["kind"] == "factor_research"
    assert result["phase"]["name"] == "finished"
    assert result["counters"]["targets_evaluated"] == 6
    assert result["counters"]["targets_skipped"] == 2
    assert result["counters"]["trials_completed"] == 2
    assert result["target_status_counts"] == {"completed": 3, "skipped": 1}
    assert len(result["activity"]) <= 20
    assert "items" not in result
    up = service.current_report("000001")
    down = service.current_report("000002")
    assert up["rule"]["id"] != down["rule"]["id"]
    for report, direction in ((up, 1), (down, -1)):
        assert report["direction"] == direction
        assert report["metrics"]["accuracy"] == 1.
        assert len(report["metrics"]["per_horizon20"]) == 20
        assert set(report["metrics"]["confusion"]) == {"up", "down"}
        assert report["metrics"]["baseline"]["always_up"] in (0., 1.)
        assert report["source"] == "llm_batch"
        assert report["target"]["timeframe"] == "1d"
        assert report["samples"] is not None
    assert service.current_report("000001", category="ETF")["target"]["target_id"] == "ETF:000001"
    saved = service.rule(up["rule"]["id"])
    assert saved["source"] == UP
    assert saved["source_sha256"]
    page = service.results(job["id"], offset=1, limit=2)
    assert page["total"] == 4 and len(page["items"]) == 2
    assert service.results(q="合成")["total"] == 4
    assert service.results(q="%")["total"] == 0


def test_explicit_targets_scope_only(setup):
    _, _, jobs, model, service = setup
    job = flush(jobs, service.submit(scope="targets", targets=["ETF:000001"]))
    assert job["result"]["scope_total"] == 1
    assert job["result"]["universe"]["total"] == 4
    assert service.results(job["id"])["total"] == 1
    assert service.current_report("000001") is None
    with pytest.raises(FactorResearchError):
        service.submit(targets=["ETF:000001"])
    with pytest.raises(FactorResearchError):
        service.submit(scope="targets", targets=["000001"])


def test_null_does_not_claim_best_and_errors_preserve_old(setup):
    _, db, jobs, model, service = setup
    flush(jobs, service.submit())
    old = service.current_report("000001")["rule"]["id"]
    model.sources = ["def factor(df):\n return F.zeros(len(df))", "def factor(df):\n return missing"]
    job = flush(jobs, service.submit(brief="无效候选"))
    assert service.current_report("000001")["rule"]["id"] == old
    assert job["result"]["counters"]["best_updates"] == 0
    assert job["result"]["counters"]["targets_failed"] == 3
    trial = db.query_one("SELECT report FROM factor_research_trials WHERE job_id=? AND status='completed'", (job["id"],))
    assert '"accuracy": null' in trial["report"]


def test_sqlite_restart_and_version_reassessment(setup):
    root, db, jobs, model, service = setup
    flush(jobs, service.submit())
    before = service.current_report("000001")
    again = FactorResearchService(FactorService(root), model, jobs, db)
    assert again.current_report("000001")["data_version"] == before["data_version"]
    reopened = Database(db.path)
    try:
        restored = FactorResearchService(FactorService(root), model, jobs, reopened)
        assert restored.current_report("000001")["rule"]["id"] == before["rule"]["id"]
        assert restored.rule(before["rule"]["id"])["source"] == UP
    finally:
        reopened.close()
    path = root / "个股" / "000001_合成.csv"
    df = pd.read_csv(path)
    df["close"] = df["close"].iloc[::-1].to_numpy()
    df["open"], df["high"], df["low"] = df["close"], df["close"]+1, df["close"]*.9
    df.to_csv(path, index=False)
    # Paged current results honestly invalidate old accuracy until reassessment.
    assert next(r for r in again.results()["items"] if r["target_id"] == "个股:000001")["status"] == "stale"
    after = again.current_report("000001")
    assert after["data_version"] != before["data_version"]
    assert after["metrics"]["accuracy"] == 0.
    assert after["rule"]["id"] == before["rule"]["id"]
    assert db.query_one("SELECT COUNT(*) n FROM factor_research_best WHERE target_id='个股:000001'")["n"] == 2
    assert model.calls == 1


def test_missing_model_key_no_job(setup):
    _, db, jobs, model, service = setup
    model.settings = SimpleNamespace(configured=False)
    with pytest.raises(FactorResearchError) as err:
        service.submit()
    assert err.value.status == 503
    assert db.query_one("SELECT COUNT(*) n FROM jobs")["n"] == 0


def test_active_dedupe_and_cancel(setup):
    _, _, jobs, model, service = setup
    entered, release = threading.Event(), threading.Event()
    def chat(*a, before_round, tool_impls, **kw):
        before_round()
        entered.set()
        release.wait(timeout=10)
        rule = tool_impls["write_rule"]({"source": UP, "name": "取消后不写"})
        assert "error" in rule
        before_round()
    model.chat = chat
    one = service.submit()
    assert entered.wait(timeout=5)
    two = service.submit()
    assert one["id"] == two["id"]
    jobs.cancel(one["id"])
    release.set()
    result = flush(jobs, one)
    assert result["status"] == "cancelled"
    assert result["result"]["phase"]["name"] == "cancelled"
    assert result["result"]["target_status_counts"]["unprocessed"] == 4


def test_model_budget_and_minutes_are_not_success(setup):
    _, _, jobs, model, service = setup
    def chat(*a, before_round, **kw):
        before_round()
        before_round()
    model.chat = chat
    job = flush(jobs, service.submit(max_model_calls=1))
    assert job["status"] == "error"
    assert job["result"]["phase"]["name"] == "budget_exhausted"
    job = flush(jobs, service.submit(minutes=.00000001))
    assert job["status"] == "error"
    assert job["result"]["phase"]["name"] == "budget_exhausted"


def test_zero_new_scope_no_fake_result(setup):
    _, _, jobs, model, service = setup
    model.sources = ["def factor(df):\n return F.zeros(len(df))"]
    job = flush(jobs, service.submit())
    assert job["status"] == "done"
    assert service.current_report("000001") is None
    assert all(r["accuracy"] is None for r in service.results()["items"])
    assert job["result"]["valid_backtests"] == 0
    assert any("没有任何含有效窗口" in w for w in job["result"]["warnings"])


def test_last_model_round_finish_is_not_budget_failure(setup):
    from backend.model_gateway import ModelError
    _, _, jobs, model, service = setup
    def chat(*a, before_round, tool_impls, **kw):
        before_round()
        rule = tool_impls["write_rule"]({"source": UP, "name": "末轮规则"})
        tool_impls["evaluate_rule"]({"rule_id": rule["rule_id"]})
        tool_impls["finish"]({})
        raise ModelError("工具调用轮数超限", code="tool_round_limit")
    model.chat = chat
    job = flush(jobs, service.submit(max_model_calls=1))
    assert job["status"] == "done"
    assert job["result"]["phase"]["name"] == "finished"
    assert job["result"]["counters"]["model_calls"] == 1


def test_tool_calls_are_not_capped_and_outputs_stay_bounded(setup):
    _, _, jobs, model, service = setup
    def chat(*a, before_round, tool_impls, **kw):
        before_round()
        for _ in range(service.MAX_TOOL_CALLS + 5):
            result = tool_impls["universe_profile"]({})
            assert len(str(result)) < 3000
            assert result["remaining_seconds"] is None  # no time limit configured
        before_round()
    model.chat = chat
    job = flush(jobs, service.submit())
    assert job["status"] == "done"
    assert job["result"]["phase"]["name"] == "finished"
    assert any("未调用finish" in warning for warning in job["result"]["warnings"])
    assert job["result"]["counters"]["model_calls"] == 2
    assert len(job["result"]["activity"]) <= 20
    assert len(job["result"]["errors"]) <= 50


def test_subset_trial_is_followed_by_automatic_full_validation(setup):
    _, _, jobs, model, service = setup
    def chat(*a, before_round, tool_impls, **kw):
        before_round()
        rule = tool_impls["write_rule"]({"source": UP, "name": "显式子集候选"})
        tool_impls["evaluate_rule"]({"rule_id": rule["rule_id"], "targets": ["ETF:000001"]})
        tool_impls["finish"]({})
        before_round()
    model.chat = chat
    job = flush(jobs, service.submit())
    assert job["status"] == "done"
    result = job["result"]
    # The subset trial does not claim full coverage by itself, but the service
    # now guarantees one local full-scope pass of the best candidate afterwards.
    assert result["scope_coverage_complete"] is True
    assert result["target_status_counts"].get("unprocessed", 0) == 0
    assert not any(e.get("status") == "skipped" for e in result["errors"])
    final = result["final_validation"]
    assert final["automatic"] is True and final["mode"] == "full"
    assert final["total"] == 3 and final["already_done"] == 1
    assert final["completed"] + final["skipped"] == 3
    # The automatic pass is local compute, never a paid trial or model call.
    assert result["counters"]["trials_completed"] == 1
    assert result["counters"]["model_calls"] == 1


def test_full_scope_trial_does_not_need_a_second_automatic_pass(setup):
    _, _, jobs, model, service = setup
    job = flush(jobs, service.submit())
    assert job["status"] == "done"
    assert job["result"]["scope_coverage_complete"] is True
    assert "final_validation" not in job["result"]


def test_research_memory_survives_database_reopen_and_rule_can_be_modified(setup):
    root, db, jobs, model, service = setup
    model.sources = [UP, "def factor(df):\n return missing"]
    first = flush(jobs, service.submit())
    for i in range(12):
        db.execute("INSERT INTO factor_research_notes(job_id,note,created_at) VALUES(?,?,?)",
                   (first["id"], f"持久笔记{i}", "2026-11-14"))
    reopened = Database(db.path)
    resumed_jobs = JobManager(reopened, max_workers=1)
    try:
        restored = FactorResearchService(FactorService(root), model, resumed_jobs, reopened)
        memory = restored.research_memory()
        assert len(memory["notes"]) == 10
        assert memory["notes"][0]["note"] == "持久笔记11"
        assert len(memory["rules"]) == 2
        assert all("source" not in rule for rule in memory["rules"])
        assert any(rule["trials"]["failed"] == 3 for rule in memory["rules"])
        assert any(rule["trials"]["completed"] == 3 for rule in memory["rules"])
        def chat(messages, *, before_round, tool_impls, **kw):
            before_round()
            history = tool_impls["research_memory"]({})
            prior = next(r for r in history["rules"] if r["trials"]["completed"])
            details = tool_impls["rule_details"]({"rule_id": prior["id"]})
            assert details["rule"]["source"] == UP and details["executed"] is False
            changed = details["rule"]["source"] + "\n# autonomous continuation"
            rule = tool_impls["write_rule"]({"source": changed, "name": "自主延续旧源码"})
            evaluated = tool_impls["evaluate_rule"]({"rule_id": rule["rule_id"]})
            assert evaluated["completed"] == 3 and evaluated["failed"] == 0
            tool_impls["finish"]({"note": "读取旧规则后真实改写评估"})
            before_round()
        model.chat = chat
        second = flush(resumed_jobs, restored.submit(brief="DB重建后连续研究"))
        assert second["status"] == "done"
        assert second["result"]["counters"]["rules_written"] == 1
    finally:
        resumed_jobs._pool.shutdown(wait=True)
        reopened.close()


def test_research_note_claim_is_not_accuracy_evidence(setup):
    _, _, jobs, model, service = setup
    def chat(messages, *, before_round, tool_impls, **kw):
        assert "research_memory" in messages[0]["content"]
        assert "笔记是未经验证" in messages[0]["content"]
        before_round()
        tool_impls["save_note"]({"note": "accuracy=100%，未来必涨，此句没有评估证据"})
        memory = tool_impls["research_memory"]({})
        assert memory["rules"] == []
        assert memory["notes"][0]["is_metric_evidence"] is False
        assert "accuracy" not in memory["notes"][0]
        tool_impls["finish"]({})
        before_round()
    model.chat = chat
    job = flush(jobs, service.submit())
    assert job["status"] == "done"
    assert service.current_report("000001") is None
    assert all(item["accuracy"] is None for item in service.results()["items"])


def test_every_tool_reports_actual_remaining_budgets_including_errors(setup):
    _, _, jobs, model, service = setup
    seen = []
    def chat(messages, *, before_round, tool_impls, **kw):
        before_round()
        def remember(name, args, calls, trials):
            value = tool_impls[name](args)
            seen.append(value)
            assert value["remaining_model_calls"] == calls
            assert value["remaining_trials"] == trials
            assert 0 < value["remaining_seconds"] <= 60
            return value
        remember("universe_profile", {}, 2, 2)
        remember("research_memory", {}, 2, 2)
        bad = remember("rule_details", {"rule_id": "unknown"}, 2, 2)
        assert bad["status"] == 404
        rule = remember("write_rule", {"source": UP, "name": "预算验证"}, 2, 2)
        remember("rule_details", {"rule_id": rule["rule_id"]}, 2, 2)
        before_round()
        remember("evaluate_rule", {"rule_id": rule["rule_id"]}, 1, 1)
        remember("inspect_errors", {}, 1, 1)
        remember("save_note", {"note": "预算观察，不是准确率"}, 1, 1)
        remember("inspect_targets", {"limit": 1}, 1, 1)
        remember("finish", {}, 1, 1)
        before_round()
    model.chat = chat
    job = flush(jobs, service.submit(max_model_calls=3, max_trials=2, minutes=1))
    assert job["status"] == "done"
    assert job["result"]["counters"]["model_calls"] == 2
    assert job["result"]["counters"]["trials_completed"] == 1
    assert len(seen) == 10
    assert seen[-1]["remaining_seconds"] <= seen[0]["remaining_seconds"]


def test_rule_summary_is_persisted_and_exposed_without_extra_calls(setup):
    _, _, jobs, model, service = setup
    def chat(messages, *, before_round, tool_impls, **kw):
        before_round()
        rule = tool_impls["write_rule"]({"source": UP, "name": "带说明的规则",
                                         "summary": "趋势跟随：价格高于20日均线时看涨。"})
        assert rule["summary"] == "趋势跟随：价格高于20日均线时看涨。"
        tool_impls["evaluate_rule"]({"rule_id": rule["rule_id"], "targets": ["个股:000001"]})
        tool_impls["finish"]({})
        before_round()
    model.chat = chat
    job = flush(jobs, service.submit())
    assert job["status"] == "done"
    library = service.library(limit=50)
    target = next(item for item in library["items"] if item["name"] == "带说明的规则")
    assert target["summary"] == "趋势跟随：价格高于20日均线时看涨。"
    assert job["result"]["counters"]["model_calls"] == 1


def test_finish_rejected_until_written_rules_are_evaluated(setup):
    _, _, jobs, model, service = setup
    def chat(messages, *, before_round, tool_impls, **kw):
        before_round()
        rule = tool_impls["write_rule"]({"source": UP, "name": "必须先评测"})
        first = tool_impls["finish"]({})
        assert first["finished"] is False and "没有评测" in first["error"]
        tool_impls["evaluate_rule"]({"rule_id": rule["rule_id"], "targets": ["个股:000001"]})
        second = tool_impls["finish"]({})
        assert second["finished"] is True
        before_round()
    model.chat = chat
    job = flush(jobs, service.submit())
    assert job["status"] == "done"
    assert job["result"]["counters"]["trials_completed"] == 1


def test_finish_in_same_batch_does_not_discard_later_tool_calls(setup):
    _, _, jobs, model, service = setup
    def chat(messages, *, before_round, tool_impls, **kw):
        before_round()
        rule = tool_impls["write_rule"]({"source": UP, "name": "同批finish"})
        tool_impls["finish"]({})
        # A model may put finish before evaluate in one assistant message.
        tool_impls["evaluate_rule"]({"rule_id": rule["rule_id"], "targets": ["个股:000001"]})
        before_round()
    model.chat = chat
    job = flush(jobs, service.submit())
    assert job["status"] == "done"
    assert job["result"]["counters"]["trials_completed"] == 1
    assert job["result"]["counters"]["targets_evaluated"] >= 1


def test_missing_finish_is_a_warning_not_a_failed_job(setup):
    _, _, jobs, model, service = setup
    def chat(messages, *, before_round, tool_impls, **kw):
        before_round()
        rule = tool_impls["write_rule"]({"source": UP, "name": "忘记finish"})
        tool_impls["evaluate_rule"]({"rule_id": rule["rule_id"]})
        before_round()
    model.chat = chat
    job = flush(jobs, service.submit())
    assert job["status"] == "done"
    assert job["result"]["counters"]["trials_completed"] == 1
    assert any("未调用finish" in warning for warning in job["result"]["warnings"])


def test_large_trial_and_minute_budgets_are_accepted(setup):
    _, _, _, model, service = setup
    model.settings = SimpleNamespace(configured=False, timeout=30)
    with pytest.raises(FactorResearchError) as exc:
        service.submit(max_trials=100000, minutes=100000000)
    # Validation passed; the request only fails later on the missing model key.
    assert exc.value.status == 503


def test_model_calls_are_unlimited_by_default(setup):
    _, _, jobs, model, service = setup
    def chat(messages, *, before_round, tool_impls, **kw):
        for _ in range(6):
            before_round()
        tool_impls["finish"]({})
        before_round()
    model.chat = chat
    job = flush(jobs, service.submit(max_trials=1, minutes=2))
    assert job["status"] == "done"
    assert job["result"]["counters"]["model_calls"] >= 6


def test_min_coverage_floor_blocks_low_coverage_best(setup):
    _, _, jobs, model, service = setup
    low = ("def factor(df):\n"
           "    idx = arange(len(df))\n"
           "    return np.where(idx % 50 == 0, 1.0, 0.0)\n")
    model.sources = [low]
    first = flush(jobs, service.submit())
    assert first["status"] == "done"
    assert service.current_report("000001") is None
    assert service.db.query_one("SELECT COUNT(*) n FROM factor_research_best")["n"] == 0
    model.sources = [UP]
    flush(jobs, service.submit())
    assert service.current_report("000001") is not None


def test_library_puts_rules_with_few_qualified_targets_after_ranked(setup):
    _, _, _jobs, _model, service = setup
    stamp = "2026-11-17T00:00:00Z"
    for rule_id, name in (("r-big", "五标的因子"), ("r-small", "单标的因子")):
        service.db.execute("""INSERT INTO factor_research_rules
            (id,name,source,source_sha256,created_at) VALUES(?,?,?,?,?)""",
            (rule_id, name, "def factor(df):\n    return 1.0\n", rule_id * 8, stamp))
    service.db.execute("""INSERT INTO factor_research_rule_stats
        (rule_id,evaluated,correct,skipped,qualified_sum,qualified_count,qualified_cov_sum,updated_at)
        VALUES('r-big',100,60,0,3.0,5,0.5,?)""", (stamp,))
    service.db.execute("""INSERT INTO factor_research_rule_stats
        (rule_id,evaluated,correct,skipped,qualified_sum,qualified_count,qualified_cov_sum,updated_at)
        VALUES('r-small',100,90,0,0.9,1,0.9,?)""", (stamp,))
    items = service.library(limit=10)["items"]
    ids = [item["id"] for item in items]
    assert ids.index("r-big") < ids.index("r-small")
    big = next(item for item in items if item["id"] == "r-big")
    assert big["qualified_targets"] == 5 and big["accuracy"] == 0.6


def test_library_orders_rules_by_top_accuracy(setup):
    _, _, jobs, model, service = setup
    model.sources = [DOWN]
    flush(jobs, service.submit())
    model.sources = [UP]
    flush(jobs, service.submit())
    items = service.library(limit=50)["items"]
    tops = [item["top_accuracy"]["accuracy"] for item in items if item["top_accuracy"]]
    assert len(tops) == 2
    assert tops == sorted(tops, reverse=True)
    first = service.library(offset=0, limit=1)["items"][0]
    assert first["top_accuracy"]["accuracy"] == max(tops)


def test_library_and_leaderboard_expose_real_aggregates(setup):
    _, _, jobs, model, service = setup
    flush(jobs, service.submit())
    library = service.library()
    assert library["total"] >= 2
    assert len(library["items"]) == library["total"]
    measured = [item for item in library["items"] if item["accuracy"] is not None]
    assert measured and all(0 <= item["accuracy"] <= 1 for item in measured)
    assert all(item["targets"] >= 1 and item["evaluated"] > 0 for item in measured)
    top = service.leaderboard(limit=5, min_evaluated=0)
    assert top["items"][0]["evaluated"] > 0
    assert top["items"][0]["accuracy"] == max(item["accuracy"] for item in top["items"])


def test_next_job_receives_previous_best_summary_without_extra_calls(setup):
    import json
    _, _, jobs, model, service = setup
    first = flush(jobs, service.submit())
    assert first["status"] == "done"
    calls_before = model.calls
    flush(jobs, service.submit())
    payload = json.loads(model.messages[1]["content"])
    best = payload["history_best"]
    assert best and set(best[0]) >= {"id", "name", "accuracy", "evaluated", "coverage"}
    assert model.calls > calls_before  # another research run, but no hidden extra calls

