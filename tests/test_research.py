"""Research contract tests. All providers/models/engine state are local fakes."""
from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from backend.db import Database
from backend.experts import ExpertService
from backend.model_gateway import ModelError
from backend.research import ResearchError, ResearchService


def entry(directions=(1, 1, 0), name="平安银行", samples=200, coverage=200):
    rows = [None] * 20
    for h, direction in zip((5, 10, 20), directions):
        rows[h - 1] = [630, samples, direction, 510, coverage]
    return {"name": name, "rows": rows}


class FakeEngine:
    def __init__(self):
        self._grid = {
            ("000001", "个股"): entry(),
            ("600001", "个股"): entry((1, -1, 0), "观察股"),
            ("600002", "个股"): entry((1, 1, 1), "样本不足", samples=2),
            ("000001", "指数"): entry((-1, -1, -1), "上证指数"),
            ("159001", "ETF"): entry((1, 1, 1), "ETF"),
        }
        self.grid_meta = {"snapshot": "2026-11-05", "generated_at": "2026-11-06"}
        self.loads = 0

    def _load_grid(self):
        self.loads += 1

    def probability(self, *a, **kw):
        raise AssertionError("research must not call fitting probability path")

    def _recompute(self, *a, **kw):
        raise AssertionError("research must not fit for rule enrichment")

    def resolve_symbol(self, *a, **kw):
        raise AssertionError("research must not scan catalog")


class FakeMarket:
    def __init__(self):
        self.calls = []
        self.fail = set()
        self.constituents = [{"code": f"{i:06}", "thscode": f"{i:06}.SZ", "name": f"股{i}", "category": "个股"}
                             for i in range(1, 51)]

    def call(self, method):
        self.calls.append(method)
        if method in self.fail:
            raise RuntimeError("provider secret-sk-DO-NOT-EXPOSE")

    def symbol(self, code):
        self.call("symbol")
        return {"code": code[:6], "name": "平安银行", "thscode": code if "." in code else code + ".SZ", "category": "个股"}

    def quotes(self, codes):
        self.call(("quotes", codes))
        self.call("quotes")
        items = []
        for i, code in enumerate(codes.split(",")):
            if i == 3:  # one missing member
                continue
            items.append({"code": code[:6], "thscode": code if "." in code else code + ".SZ",
                          "name": "平安银行", "last_price": 70.0,
                          "price_change_ratio_pct": [1, -1, 0, None][i % 4]})
        return {"items": items, "timestamp": 1000}

    def history(self, code, limit=120, adjust="forward"):
        self.call("history")
        return {"items": [{"date_ms": i * 86400000, "open_price": i + 10,
                           "close_price": i + 10, "high_price": i + 11,
                           "low_price": i + 9, "volume": 100 + i} for i in range(1, 71)],
                "timestamp": 1000, "adjust": adjust, "interval": "1d"}

    def sector_snapshot(self, thscode):
        self.call("sector_snapshot")
        return {"items": [{"thscode": thscode, "name": "银行板块", "last_price": 100}], "timestamp": 1100}

    def sector_history(self, thscode, limit=120):
        self.call("sector_history")
        return {**self.history(thscode), "adjust": None}

    def sector_constituents(self, thscode, offset=0, limit=50):
        self.call("sector_constituents")
        assert offset == 0 and limit <= 50
        return {"items": self.constituents[:limit], "total": 100, "timestamp": 1000}


class FakeJobs:
    def __init__(self):
        self.rows = {}
        self.runners = {}

    def submit(self, kind, payload, fn, total):
        jid = f"job-{len(self.rows) + 1}"
        self.rows[jid] = {"id": jid, "type": kind, "status": "queued", "payload": payload,
                          "total": total, "progress": 0, "result": None}
        self.runners[jid] = fn
        return jid

    def get(self, jid):
        return deepcopy(self.rows.get(jid))

    def run(self, jid, cancel_after=None):
        row = self.rows[jid]
        row["status"] = "running"
        handle = SimpleNamespace(cancelled=False)
        def progress(n, partial):
            row.update(progress=n, result=deepcopy(partial))
            if cancel_after and n >= cancel_after:
                handle.cancelled = True
        handle.progress = progress
        try:
            result = self.runners[jid](handle)
            row.update(status="cancelled" if handle.cancelled else "done", result=result)
        except Exception as exc:
            row.update(status="error", error=str(exc))
        return row


def opinion(vote=1, source="trend", ref="/trend/data/ma20"):
    return {"vote": vote, "confidence": "medium", "reason": "依据真实趋势及历史样本",
            "evidence": [{"source": source, "ref": ref}], "abstained": vote == 0,
            "outlook": {k: "有条件趋势，不预测某日价格" for k in
                        ("short_term", "medium_term", "bull_case", "bear_case", "invalidation")},
            "risks": ["历史频率未校准"]}


class FakeModel:
    def __init__(self, payloads=None):
        self.settings = SimpleNamespace(configured=True, model="fake-model")
        self.payloads = list(payloads or [opinion()] * 6)
        self.messages = []

    def chat(self, messages, **kwargs):
        self.messages.append(deepcopy(messages))
        assert kwargs["tools"] is None and kwargs["max_tool_rounds"] == 12
        response = self.payloads.pop(0)
        if isinstance(response, Exception):
            raise response
        return {"content": json.dumps(response, ensure_ascii=False)}


@pytest.fixture
def service(tmp_path):
    db = Database(tmp_path / "research.db")
    engine, market, jobs, model = FakeEngine(), FakeMarket(), FakeJobs(), FakeModel()
    experts = ExpertService(db, engine, model)
    watchlist = SimpleNamespace(list=lambda: [{"code": "000001", "category": "个股"},
                                             {"code": "000001", "category": "指数"}])
    svc = ResearchService(engine, market, experts, jobs, watchlist)
    yield svc
    db.close()


@pytest.mark.parametrize('risk_name', ['ST测试', '*ST测试', '_ST测试', '测试退', '退市测试'])
def test_screen_default_excludes_historically_risk_marked_names(service, risk_name):
    service.engine._grid[('600999', '个股')] = entry((1, 1, 1), risk_name, samples=1000)
    result = service.screen()
    assert not any(row['code'] == '600999' for row in result['items'])
    assert result['coverage']['excluded_risk_marked'] == 1
    assert any('不是实时风险名单' in warning for warning in result['warnings'])


def test_trend_exposes_macd_series_for_chan_structure():
    from backend.research import _trend
    items = [{"date_ms": i * 86400000, "open_price": 10 + i, "high_price": 11 + i,
              "low_price": 9 + i, "close_price": 10 + i, "volume": 1000 + i}
             for i in range(60)]
    trend = _trend({"available": True, "data": {"items": items}})
    macd = trend["data"]["macd"]
    assert macd["available"] is True
    assert len(macd["series"]) == 60
    assert {"dif", "dea", "hist"}.isdisjoint(macd["series"][0]) is False
def test_stock_fixed_contract_observed_trend_and_lightweight_grid(service):
    report = service.stock_report("000001")
    assert report["target"] == {"code": "000001", "name": "平安银行", "thscode": "000001.SZ", "category": "个股"}
    trend = report["trend"]["data"]
    assert trend["bias"] == "up"
    assert trend["ma5"] == 78
    assert trend["ma20"] == 70.5
    assert trend["ma60"] == 50.5
    assert trend["support_20d"] == 60
    assert trend["resistance_20d"] == 81
    assert trend["return_5d_pct"] == pytest.approx((80 / 75 - 1) * 100)
    assert trend["return_20d_pct"] == pytest.approx((80 / 60 - 1) * 100)
    assert trend["volume_ratio"] == pytest.approx(170 / 167)
    quant = report["quant"]
    assert quant["as_of"] == "2026-11-05" and quant["agreement"] == "bullish"
    assert [x["horizon"] for x in quant["items"]] == [5, 10, 20]
    assert quant["items"][2]["result"]["direction"] == 0
    assert quant["items"][2]["result"]["probability"] is None
    assert quant["items"][0]["result"]["evaluation"] == {"type": "in_sample", "calibrated": False}
    assert quant["items"][0]["result"]["target"]["target_date"] is None
    assert not report["fundamentals"]["available"]


def test_each_source_fails_independently_and_errors_never_leak(service):
    service.market.fail.update({"history", "symbol"})
    report = service.stock_report("000001")
    assert report["quote"]["available"] and report["quant"]["available"]
    assert not report["history"]["available"] and not report["trend"]["available"]
    assert report["target"]["name"] == "平安银行"
    assert "secret" not in json.dumps(report)


def test_report_cache_is_30s_bounded_and_copy_isolated(service, monkeypatch):
    clock = [0]
    monkeypatch.setattr("backend.research.time.monotonic", lambda: clock[0])
    first = service.stock_report("000001")
    first["quant"]["items"].clear()
    assert len(service.stock_report("000001")["quant"]["items"]) == 3
    assert service.market.calls.count("history") == 1
    clock[0] = 31
    service.stock_report("000001")
    assert service.market.calls.count("history") == 2
    service.CACHE_MAX = 2
    service.stock_report("600001")
    service.stock_report("600002")
    assert len(service._cache) == 2


@pytest.mark.parametrize("code", ["1", "00001", "000001,600001", "000001.SH.extra", "../../secrets", None, 1])
def test_stock_validation_is_controlled(service, code):
    with pytest.raises(ResearchError) as error:
        service.stock_report(code)
    assert error.value.status == 400


def test_stock_rejects_nonstock_identity_and_suffix_conflict(service):
    service.market.symbol = lambda code: {"code": "000001", "category": "指数"}
    with pytest.raises(ResearchError):
        service.stock_report("000001")
    service.market.symbol = lambda code: {"code": "000001", "category": "个股", "thscode": "000001.SZ"}
    with pytest.raises(ResearchError):
        service.stock_report("000001.SH")


def test_history_short_or_missing_close_does_not_fill(service):
    original = service.market.history
    service.market.history = lambda *a, **kw: {"items": original(*a, **kw)["items"][:19]}
    assert not service.stock_report("000001")["trend"]["available"]
    service._cache.clear()
    def missing(*a, **kw):
        data = original(*a, **kw)
        data["items"][-1]["close_price"] = None
        return data
    service.market.history = missing
    assert not service.stock_report("000001")["trend"]["available"]


def test_ma60_and_20day_return_are_null_when_insufficient_not_fabricated(service):
    original = service.market.history
    service.market.history = lambda *a, **kw: {"items": original(*a, **kw)["items"][:20]}
    trend = service.stock_report("000001")["trend"]["data"]
    assert trend["ma60"] is None and trend["return_20d_pct"] is None


def test_insufficient_grid_samples_and_missing_rows_explicit(service):
    report = service.stock_report("600002")
    assert not report["quant"]["available"]
    assert all(not x["available"] for x in report["quant"]["items"])
    report = service.stock_report("600003")
    assert report["quant"]["agreement"] == "unavailable"
    assert all("error" in x for x in report["quant"]["items"])


def test_sector_breadth_is_single_bounded_batch_not_full_fit(service):
    report = service.sector_report("881101.TI")
    assert report["target"]["category"] == "板块"
    assert not report["quant"]["available"]
    breadth = report["breadth"]["data"]
    assert breadth["sample_size"] == 50 and breadth["total_constituents"] == 100
    assert breadth["sample_only"] is True
    assert sum(breadth[k] for k in ("up", "down", "flat", "missing")) == 50
    batches = [c for c in service.market.calls if isinstance(c, tuple) and c[0] == "quotes"]
    assert len(batches) == 1 and len(batches[0][1].split(",")) == 50


def test_sector_never_uses_same_number_stock_or_unverified_index(service):
    report = service.sector_report("000001.SZ")
    assert not report["quant"]["available"]
    service._cache.clear()
    service.engine._grid[("881101", "指数")] = {**entry((-1, -1, 0), "银行板块"), "thscode": "881101.TI"}
    report = service.sector_report("881101.TI")
    assert report["quant"]["agreement"] == "bearish"
    assert report["quant"]["items"][0]["result"]["symbol"]["category"] == "指数"


def test_sector_failure_retains_other_sources_and_no_breadth_quote(service):
    service.market.fail.add("sector_constituents")
    report = service.sector_report("881101.TI")
    assert report["history"]["available"]
    assert not report["constituents"]["available"] and not report["breadth"]["available"]
    assert "quotes" not in service.market.calls


def test_screen_only_stock_and_qualified_grid_windows(service):
    screened = service.screen()
    assert [x["code"] for x in screened["items"]] == ["000001"]
    assert screened["pool_count"] == 3 and screened["total_matched"] == 1
    assert screened["items"][0]["signals"][2]["probability"] is None
    assert screened["source"] == "本地量化网格"
    watched = service.screen(style="watch")
    assert {x["code"] for x in watched["items"]} == {"000001", "600001"}
    assert service.market.calls == []


def test_screen_watchlist_sector_coverage_and_limits(service):
    assert service.screen(scope="watchlist")["pool_count"] == 1
    service.market.constituents = [{"code": "000001", "thscode": "000001.SZ", "category": "个股"},
                                   {"code": "600099", "thscode": "600099.SH", "category": "个股"}]
    screened = service.screen(scope="sector", sector="881101.TI", limit=1)
    assert screened["coverage"]["scope_total"] == 100
    assert screened["coverage"]["missing_from_grid"] == 1
    assert screened["coverage"]["scope_limit"] == 50
    assert screened["pool_count"] == 1


@pytest.mark.parametrize("kwargs", [{"style": "foo"}, {"scope": "foo"}, {"limit": 0}, {"limit": 51},
                                    {"limit": True}, {"scope": "sector"}, {"scope": "sector", "sector": "881101"}])
def test_screen_controlled_input_errors(service, kwargs):
    with pytest.raises(ResearchError):
        service.screen(**kwargs)


def test_grid_unavailable_screen_explicit_but_stock_remains_useful(service):
    service.engine._load_grid = lambda: (_ for _ in ()).throw(RuntimeError("secret"))
    with pytest.raises(ResearchError) as error:
        service.screen()
    assert error.value.status == 503
    assert "secret" not in str(error.value)
    report = service.stock_report("000001")
    assert report["history"]["available"] and not report["quant"]["available"]


def test_fundamentals_valuation_optional_real_wrappers(service):
    service.market.fundamentals = lambda code: {"available": True, "source": "fake",
        "income": {"available": True, "data": {"items": [{"report_date": "2025-12-31", "profit": 100}], "timestamp": 900}},
        "balance": {"available": False, "error": "missing"}}
    service.market.valuation = lambda code: {"items": [{"pe_ttm": 10}], "timestamp": 1000}
    report = service.stock_report("000001")
    assert report["fundamentals"]["available"] and report["valuation"]["available"]
    assert report["fundamentals"]["data"]["income"]["data"]["timestamp"] == 900
    assert not report["fundamentals"]["data"]["balance"]["available"]


def test_submit_returns_queued_job_immediately_and_deduplicates(service):
    first = service.submit_team("stock", "000001", ["price_action", "quant_expert"])
    second = service.submit_team("stock", "000001", ["quant_expert", "price_action"])
    assert first["id"] == second["id"] and first["total"] == 2
    assert not service.market.calls and not service.experts.model.messages
    result = service.jobs.run(first["id"])
    assert result["status"] == "done" and result["progress"] == 2
    assert len(result["result"]["votes"]) == 2
    assert result["result"]["consensus"]["support"] == 1
    assert result["result"]["votes"][0]["quant_alignment"] == "aligned"
    assert service.submit_team("stock", "000001", ["quant_expert", "price_action"])["id"] != first["id"]


def test_team_bundle_frozen_small_and_pointer_matches_report(service):
    job = service.submit_team("stock", "000001", ["price_action", "quant_expert"])
    result = service.jobs.run(job["id"])["result"]
    assert len(result["report"]["history"]["data"]["items"]) == 70
    assert result["report"]["history"]["data"]["returned_count"] == 70
    prompts = service.experts.model.messages
    assert prompts[0][1]["content"].split("\n冻结研究bundle", 1)[1] == prompts[1][1]["content"].split("\n冻结研究bundle", 1)[1]
    records = service.experts.recent_analyses("000001")
    assert len(records) == 2 and all(x["horizon"] == 0 for x in records)
    rows = service.experts.db.query("SELECT model FROM analyses")
    assert {r["model"] for r in rows} == {"fake-model"}


def test_cancel_checked_between_experts(service):
    job = service.submit_team("stock", "000001", ["price_action", "quant_expert"])
    result = service.jobs.run(job["id"], cancel_after=1)
    assert result["status"] == "cancelled"
    assert result["progress"] == 1 and len(service.experts.model.messages) == 1


def test_missing_key_is_503_before_job_and_rechecked_in_worker(service):
    service.experts.model.settings.configured = False
    with pytest.raises(ResearchError) as error:
        service.submit_team("stock", "000001")
    assert error.value.status == 503 and not service.jobs.rows
    service.experts.model.settings.configured = True
    job = service.submit_team("stock", "000001", ["price_action"])
    service.experts.model.settings.configured = False
    assert service.jobs.run(job["id"])["status"] == "error"
    assert not service.market.calls


def test_all_model_failures_are_error_not_fake_team_done(service):
    service.experts.model.payloads = [ModelError("secret-sk-123"), ModelError("secret-sk-123")]
    job = service.submit_team("stock", "000001", ["price_action", "quant_expert"])
    result = service.jobs.run(job["id"])
    assert result["status"] == "error"
    assert len(result["result"]["errors"]) == 2
    assert len(result["result"]["votes"]) == 2
    assert all(v["abstained"] for v in result["result"]["votes"])
    assert "secret" not in json.dumps(result)


def test_partial_failure_preserves_real_vote_and_error(service):
    service.experts.model.payloads = [opinion(), ModelError("secret")]
    job = service.submit_team("stock", "000001", ["price_action", "quant_expert"])
    result = service.jobs.run(job["id"])
    assert result["status"] == "done" and len(result["result"]["errors"]) == 1
    assert result["result"]["consensus"]["voted"] == 1
    assert "secret" not in json.dumps(result)


def test_disagreement_and_quant_alignment_are_explicit(service):
    service.experts.model.payloads = [opinion(1), opinion(-1)]
    job = service.submit_team("stock", "000001", ["price_action", "quant_expert"])
    result = service.jobs.run(job["id"])["result"]
    assert result["consensus"]["decision"] == "no_consensus"
    assert result["consensus"]["disagreement"] is True
    assert [v["quant_alignment"] for v in result["votes"]] == ["aligned", "divergent"]


@pytest.mark.parametrize("kwargs", [{"kind": "index", "code": "000001"},
    {"kind": "sector", "code": "881101"},
    {"kind": "stock", "code": "000001", "expert_ids": []},
    {"kind": "stock", "code": "000001", "expert_ids": ["price_action"] * 2},
    {"kind": "stock", "code": "000001", "expert_ids": ["nonexistent"]}])
def test_invalid_team_controlled(service, kwargs):
    with pytest.raises(ResearchError):
        service.submit_team(**kwargs)


def test_team_allows_all_enabled_experts_and_rejects_disabled(service):
    service.experts.upsert({"id": "seventh", "name": "7", "system_prompt": "test"})
    job = service.submit_team("stock", "000001")
    assert job["total"] == 7 and len(job["payload"]["expert_ids"]) == 7
    service.experts.upsert({"id": "price_action", "enabled": False})
    with pytest.raises(ResearchError):
        service.submit_team("stock", "000001", ["price_action"])


def test_long_team_budget_stops_additional_model_calls(service, monkeypatch):
    clock = [0]
    monkeypatch.setattr("backend.research.time.monotonic", lambda: clock[0])
    original = service.experts.model.chat
    def slow(*args, **kwargs):
        out = original(*args, **kwargs)
        clock[0] = 1801
        return out
    service.experts.model.chat = slow
    job = service.submit_team("stock", "000001", ["price_action", "quant_expert"])
    result = service.jobs.run(job["id"])
    assert len(service.experts.model.messages) == 1
    assert result["result"]["errors"][0]["status"] == 504
