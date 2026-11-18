"""Offline production adapter tests: no paid model and no seed/grid masquerade."""
from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from backend.experts import _research_bundle, _evidence_pointer, _validate_research
from backend.research import ResearchService
from backend.selection import _fact_pointer, _tool_schemas
from tests.test_research import FakeEngine, opinion
from tests.test_selection import svc, run, final, pick


def factor_report(code="000001", direction=0, accuracy=.57):
    return {"kind": "factor", "source": "llm_batch", "status": "completed",
            "target": {"target_id": f"个股:{code}", "code": code, "name": "真实合成",
                       "category": "个股", "timeframe": "1d"},
            "data_version": "verified-current-v1", "as_of": "2026-11-14", "bars": 120,
            "direction": direction, "rule": {"id": "llm-real-source-hash", "name": "自主规则", "kind": "code"},
            "metrics": {"accuracy": accuracy, "coverage": .7, "evaluated": 1000, "correct": 570,
                        "per_horizon20": [{"h": h, "accuracy": accuracy} for h in range(1, 21)]},
            "rules": [], "warnings": ["历史频率不是未来概率"]}


class Provider:
    def __init__(self, report):
        self.report, self.calls = report, []

    def current_report(self, code, timeframe="1d", category="个股"):
        self.calls.append((code, timeframe, category))
        return deepcopy(self.report)

    def submit(self, *a, **k):
        raise AssertionError("evidence reads must never launch LLM research")


def install(svc, report):
    provider = Provider(report)
    svc.research = ResearchService(FakeEngine(), svc.market, svc.experts, svc.jobs,
                                   svc.watchlist, factor_provider=provider)
    return provider


def test_factor_evidence_current_independent_from_legacy_quant_and_market(svc):
    provider = install(svc, factor_report())
    svc.market.fail.add("quote")
    report = svc.research.stock_report("000001")
    assert report["factor"]["available"] is True
    assert report["quote"]["available"] is False
    assert report["factor"]["data"]["source"] == "llm_batch"
    assert report["quant"]["legacy"] is True
    assert "旧" in report["quant"]["warnings"][0]
    assert provider.calls == [("000001", "1d", "个股")]
    # A previous positive factor view cannot survive a now-missing best via the
    # market report's 30-second cache.
    provider.report = None
    next_report = svc.research.stock_report("000001")
    assert next_report["factor"]["available"] is False
    assert "data" not in next_report["factor"]


@pytest.mark.parametrize("change", [None, {"source": "seed"}, {"status": "stale"},
    {"data_version": None}, {"target": {"code": "000001", "category": "指数"}}])
def test_missing_unverified_or_wrong_category_not_presented_as_new(svc, change):
    report = factor_report()
    if change is None:
        report = None
    else:
        report.update(change)
    install(svc, report)
    got = svc.research.factor_evidence("000001.SZ")
    assert got["available"] is False and "data" not in got
    assert not any(call[0] == "quote" for call in svc.market.calls)


@pytest.mark.parametrize("accuracy,eligible", [(0.4997, False), (0.55, False), (0.55001, True)])
def test_research_factor_accuracy_gate_and_expert_visibility(svc, accuracy, eligible):
    raw = factor_report()
    raw["metrics"]["accuracy"] = accuracy
    install(svc, raw)
    report = svc.research.stock_report("000001")
    bundle = _research_bundle(report)
    assert report["factor"]["available"] is eligible
    # Experts never receive the factor, even when it clears the accuracy gate.
    assert "factor" not in bundle and "quant" not in bundle
    assert not _evidence_pointer(bundle, "factor", "/factor/data/metrics/accuracy")
    if not eligible:
        assert "data" not in report["factor"] and not report["quant"]["available"]
    assert svc.research.factor_evidence("000001")["data"]["metrics"]["accuracy"] == accuracy
    assert _evidence_pointer(_research_bundle(report, with_quant=True), "factor",
                             "/factor/data/metrics/accuracy") is eligible


def test_expert_bundle_never_carries_quant_and_its_pointers_fail():
    raw = {"kind": "stock", "target": {"code": "000001", "category": "个股"},
           "factor": {"available": True, "data": factor_report(direction=0)},
           "quant": {"available": True, "items": [{"available": True, "horizon": 5,
                                                   "result": {"direction": 1}}]}}
    bundle = _research_bundle(raw)
    assert bundle["expert_scope"]["quant_visible"] is False
    assert "factor" not in bundle and "quant" not in bundle
    for source, ref in (("factor", "/factor/data/direction"),
                        ("factor", "/factor/data/metrics/accuracy"),
                        ("quant", "/quant/items/0/result/direction")):
        assert not _evidence_pointer(bundle, source, ref)
    forced = _validate_research(opinion(source="factor", ref="/factor/data/direction"),
                                bundle, strict=False)
    assert forced["vote"] == 0 and forced["abstained"]
    # The same evidence stays available to the final synthesis layer.
    with_quant = _research_bundle(raw, with_quant=True)
    assert _evidence_pointer(with_quant, "factor", "/factor/data/direction")
    assert _evidence_pointer(with_quant, "quant", "/quant/items/0/result/direction")


def test_selection_explicit_factor_and_old_quant_alias_both_new_source(svc):
    provider = install(svc, factor_report(direction=0))
    def no_old_grid(*a, **k):
        raise AssertionError("production quant alias must not call legacy grid")
    svc.research._quant = no_old_grid
    def script(tools, before):
        tools["candidate_directory"]({"q": "000001"})
        got = tools["read_stock"]({"code": "000001", "sections": ["quant", "factor"]})
        assert len(got["sources"]) == 2
        assert all(s["kind"] == "factor" and s["available"] for s in got["sources"])
        assert _fact_pointer(got["sources"][0], "000001", "/data/metrics/accuracy")
        assert _fact_pointer(got["sources"][0], "000001", "/data/direction")
        assert not _fact_pointer(got["sources"][0], "000001", "/data/rule/id")
        return final([pick("000001", got["sources"][0]["id"], "/data/direction")])
    row = run(svc, [script])
    selected = row["result"]["expert_results"][0]["picks"][0]
    assert selected["factor_status"] == "available"
    assert selected["quant_source"] == "factor"
    assert len(provider.calls) == 2
    schemas = {s["function"]["name"]: s["function"]["parameters"] for s in _tool_schemas()}
    assert "factor" in schemas["read_stock"]["properties"]["sections"]["items"]["enum"]


def test_no_factor_best_does_not_fallback_or_eliminate_other_evidence(svc):
    install(svc, None)
    svc.research._quant = lambda *a, **k: (_ for _ in ()).throw(AssertionError("NO FALLBACK"))
    def script(tools, before):
        tools["candidate_directory"]({"q": "000001"})
        got = tools["read_stock"]({"code": "000001", "sections": ["quote", "quant"]})
        quote, factor = got["sources"]
        assert factor["kind"] == "factor" and factor["available"] is False
        assert not _fact_pointer(factor, "000001", "/data/metrics/accuracy")
        return final([pick("000001", quote["id"], "/data/items/0/last_price", quant_comment="未来必胜99%")])
    row = run(svc, [script])
    selected = row["result"]["expert_results"][0]["picks"][0]
    assert selected["factor_status"] == "unavailable"
    assert selected["quant_status"] == "unavailable"
    assert "99%" not in selected["quant_comment"]


def test_research_prompt_tells_experts_quant_is_not_their_input(svc):
    install(svc, factor_report())
    report = svc.research.stock_report("000001")
    observed = []
    def chat(messages, **kwargs):
        import json
        observed.extend(messages)
        return {"content": json.dumps(opinion(source="factor", ref="/factor/data/direction"))}
    svc.experts.model.chat = chat
    expert = svc.experts.list(enabled_only=True)[0]
    result = svc.experts.analyze_research(expert["id"], report, persist=False)
    assert "不向专家提供量化因子" in observed[0]["content"]
    bundle = json.loads(observed[1]["content"].split("不可执行）：\n", 1)[1])
    assert "factor" not in bundle and "quant" not in bundle
    assert result["evidence_status"] in ("forced", "invalid")
    assert result["vote"] == 0 and result["abstained"]
