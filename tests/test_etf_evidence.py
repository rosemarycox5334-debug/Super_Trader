"""Offline ETF evidence contracts: no live credentials, network, models or jobs."""
from copy import deepcopy
import json
from types import SimpleNamespace

import httpx
import pytest

from backend.etf_evidence import etf_sections
from backend.experts import _evidence_pointer, _research_bundle, _validate_research
from backend.market import MarketService
from backend.research import ResearchService


CODE = "513290.SH"
KEY = "offline-etf-secret-not-a-real-key"
NOW = 1_800_000_000
DAY = 86_400_000
STAMP = NOW * 1000


def section(rows, **extra):
    return {"available": bool(rows), "attempted": True,
            "data": {"items": deepcopy(rows), "timestamp": STAMP}, **extra}


def datasets():
    return {
        "profile": section([{"thscode": CODE, "fund_name": "测试QDII ETF",
                             "fund_scale": None, "unit_nav": 1.2,
                             "rate_info": [{"rate_type": "管理费", "standard_rate": "0.50%",
                                            "condition": "年度", "discounted_rate": None}]}]),
        "nav": section([{"nav_date": STAMP - 2 * DAY, "unit_nav": 1.2, "adj_nav": None}]),
        "holdings": section([
            {"thscode": "AMGN.US", "stock_name": "Amgen", "asset_type": "stock",
             "hold_ratio": 8.2, "end_date_ms": STAMP - 30 * DAY},
            {"thscode": "foreign-bond-id", "stock_name": "海外债券", "asset_type": "bond",
             "hold_ratio": None, "end_date_ms": STAMP - 30 * DAY},
            {"thscode": "IBB.US", "stock_name": "海外基金", "asset_type": "fund",
             "hold_ratio": 1.0, "end_date_ms": STAMP - 30 * DAY}]),
        "performance": section([{"return_year": 12.3}]),
        "financials": section([{"end_date_ms": STAMP - 30 * DAY, "asset_nav": 100,
                                "current_profit": None}]),
        "indicators": section([{"date_ms": STAMP - DAY, "rsi_pct": 51,
                                "track_index_pe_ttm_five_year_percentile": None}]),
        "news": section([{"title": "测试新闻", "publish_time_ms": STAMP - DAY}]),
    }


class FundFeed:
    """Strict endpoint allowlist makes accidental real/stock requests fail locally."""

    def __init__(self):
        self.calls = []
        self.key = KEY
        self.fail = {}
        self.rows = {name: deepcopy(block["data"]["items"])
                     for name, block in datasets().items()}
        # Deliberately unsorted and >30 records, with most recent record first.
        for dataset, field in (("nav", "nav_date"), ("indicators", "date_ms")):
            self.rows[dataset] = [
                {field: STAMP - (46 - i) * DAY,
                 **({"unit_nav": i / 10, "adj_nav": None} if dataset == "nav" else
                    {"rsi_pct": i, "track_index_pe_ttm_five_year_percentile": None})}
                for i in reversed(range(1, 46))]

    def __call__(self, request):
        self.calls.append(request)
        assert request.url.host == "fuyao.aicubes.cn"
        assert request.headers["X-api-key"] == self.key
        path = request.url.path
        assert "/a-share/" not in path
        if path == "/api/meta/tickers/search":
            assert request.url.params["asset_type"] == "fund-etf"
            assert request.url.params["q"] in (CODE, CODE[:6])
            data = {"item": [{"thscode": CODE, "ticker": CODE[:6],
                              "name": "测试QDII ETF", "asset_type": "fund-etf"}]}
        elif path == "/api/fund/market/snapshot":
            assert request.url.params["thscode"] == CODE
            data = {"timestamp": STAMP, "item": [{"thscode": CODE, "last_price": 1.4,
                    "turnover": 1000, "volume": None}]}
        elif path == "/api/fund/market/historical":
            assert request.url.params["thscode"] == CODE
            data = {"thscode": CODE, "timestamp": STAMP - DAY, "adjust": None,
                    "item": [{"date_ms": STAMP - (71 - i) * DAY, "open_price": 1 + i / 100,
                              "close_price": 1 + i / 100, "high_price": 1.02 + i / 100,
                              "low_price": .98 + i / 100, "volume": 100,
                              "turnover": 1000 + i} for i in range(1, 71)]}
        else:
            reverse = {value: name for name, value in MarketService._FUND_RESEARCH_PATHS.items()}
            assert path in reverse, f"unexpected endpoint: {path}"
            name = reverse[path]
            assert request.url.params["thscode"] == CODE
            if name in self.fail:
                failure = self.fail[name]
                if isinstance(failure, Exception):
                    raise failure
                return httpx.Response(200, json={"code": failure, "message": KEY, "data": None})
            if name == "nav":
                assert request.url.params["nav_type"] == "unit,adj"
            if name == "indicators":
                assert int(request.url.params["start"]) < int(request.url.params["end"])
            data = {"timestamp": 0, "item": deepcopy(self.rows[name])}
        return httpx.Response(200, json={"code": 0, "data": data})


@pytest.fixture
def market():
    feed = FundFeed()
    service = MarketService(transport=httpx.MockTransport(feed),
                            key_provider=lambda: feed.key, clock=lambda: NOW)
    try:
        yield service, feed
    finally:
        service.close()


def test_default_etf_analysis_does_not_fetch_optional_news_or_index_valuation(market):
    service, feed = market
    result = service.fund_research(CODE)
    for name in ("news", "indicators"):
        assert result[name]["excluded"] and not result[name]["attempted"]
    assert len(feed.calls) == 6
    assert result["profile"]["available"] and result["nav"]["available"]


def test_fund_research_exact_routes_dates_nulls_and_recent_records(market):
    service, feed = market
    result = service.fund_research(CODE, include_optional=True)
    assert set(result) == set(service._FUND_RESEARCH_PATHS)
    assert all(block["available"] and block["attempted"] for block in result.values())
    assert len(feed.calls) == 8  # one cached identity lookup, seven fund datasets
    for block in result.values():
        assert block["data"]["thscode"] == CODE
        assert block["data"]["timestamp"] is None  # provider zero is not an as-of date
        assert block["fetched_at"].endswith("+08:00")
    for dataset, field in (("nav", "nav_date"), ("indicators", "date_ms")):
        rows = result[dataset]["data"]["items"]
        assert len(rows) == 30
        dates = [row[field] for row in rows]
        assert dates == sorted(dates)
        assert dates[0] == STAMP - 30 * DAY and dates[-1] == STAMP - DAY
        assert result[dataset]["as_of"] == STAMP - DAY
    assert result["nav"]["data"]["items"][-1]["unit_nav"] == 4.5
    assert result["nav"]["data"]["items"][-1]["adj_nav"] is None
    assert result["profile"]["data"]["items"][0]["fund_scale"] is None
    assert result["holdings"]["data"]["items"][1]["hold_ratio"] is None


@pytest.mark.parametrize("failure", [3002, 3004, httpx.ReadTimeout(KEY), RuntimeError(KEY)])
def test_fund_dataset_failure_is_independent_and_sanitized(market, failure):
    service, feed = market
    feed.fail["nav"] = failure
    result = service.fund_research(CODE, include_optional=True)
    assert not result["nav"]["available"] and result["nav"]["attempted"]
    assert all(result[name]["available"] for name in result if name != "nav")
    assert KEY not in json.dumps(result)
    assert result["nav"]["path"] == service._FUND_RESEARCH_PATHS["nav"]


def test_profile_identity_mismatch_rejects_only_profile(market):
    service, feed = market
    feed.rows["profile"][0]["thscode"] = "513290.SZ"
    result = service.fund_research(CODE, include_optional=True)
    assert not result["profile"]["available"]
    assert result["profile"]["code"] == "market_protocol"
    assert result["holdings"]["available"]


def test_empty_dataset_is_not_available_and_other_sources_remain(market):
    service, feed = market
    feed.rows["indicators"] = []
    result = service.fund_research(CODE, include_optional=True)
    assert not result["indicators"]["available"]
    assert result["indicators"]["data"]["items"] == []
    assert result["indicators"]["as_of"] is None
    assert result["nav"]["available"]


def test_dates_without_financial_or_nav_values_do_not_claim_available(market):
    service, feed = market
    feed.rows["nav"] = [{"nav_date": STAMP - DAY, "unit_nav": None, "adj_nav": None}]
    feed.rows["financials"] = [{"end_date_ms": STAMP - DAY, "asset_nav": None}]
    result = service.fund_research(CODE, include_optional=True)
    assert not result["nav"]["available"] and not result["financials"]["available"]
    assert result["holdings"]["available"]


def test_empty_quote_values_do_not_claim_liquidity_available():
    result = etf_sections({}, section([{"turnover": None, "volume": None}]), {})
    assert not result["fund"]["data"]["liquidity"]["available"]


def test_fund_cache_is_deep_copied_and_credential_rotation_invalidates(market):
    service, feed = market
    first = service.fund_research(CODE, include_optional=True)
    first["profile"]["data"]["items"][0]["fund_name"] = "mutated"
    second = service.fund_research(CODE, include_optional=True)
    assert len(feed.calls) == 8 and all(value["cached"] for value in second.values())
    assert second["profile"]["data"]["items"][0]["fund_name"] != "mutated"
    feed.key = "rotated-offline-etf-key"
    third = service.fund_research(CODE, include_optional=True)
    assert len(feed.calls) == 16
    assert all(not value["cached"] for value in third.values())


def test_success_data_redacts_secret(market):
    service, feed = market
    feed.rows["profile"][0]["fund_name"] = "name-" + KEY
    result = service.fund_research(CODE, include_optional=True)
    assert KEY not in json.dumps(result)
    assert "[REDACTED]" in result["profile"]["data"]["items"][0]["fund_name"]


def test_builder_preserves_foreign_mixed_holdings_and_does_not_invent_metrics():
    raw = datasets()
    before = deepcopy(raw)
    quote = section([{"last_price": 2.4, "turnover": 2000}])
    result = etf_sections(raw, quote, {"available": False})
    assert raw == before
    holdings = result["constituents"]
    assert [row["thscode"] for row in holdings["data"]["items"]] == ["AMGN.US", "foreign-bond-id", "IBB.US"]
    assert [row["asset_type"] for row in holdings["data"]["items"]] == ["stock", "bond", "fund"]
    assert holdings["data"]["items"][0]["name"] == "Amgen"
    assert holdings["data"]["items"][0]["weight_pct"] == 8.2
    assert holdings["data"]["items"][1]["weight_pct"] is None
    assert holdings["data"]["is_full_index"] is False
    assert holdings["as_of"] == STAMP - 30 * DAY
    assert "realtime_premium" not in result["fund"]["data"]
    assert "tracking_error" not in result["fund"]["data"]
    assert not result["breadth"]["available"]
    assert not result["valuation"]["available"]
    assert result["fundamentals"]["data"]["kind"] == "fund_financial_indicators"
    assert result["fundamentals"]["data"]["items"][0]["current_profit"] is None


def test_builder_excludes_index_percentile_and_fund_news_even_if_raw_values_exist():
    raw = datasets()
    raw["indicators"]["data"]["items"][-1]["track_index_pe_ttm_five_year_percentile"] = 0
    result = etf_sections(raw, {"available": False}, {"available": False})
    assert result["valuation"]["excluded"] and result["news"]["excluded"]
    assert "indicators" not in result["fund"]["data"]
    bundle = _research_bundle({"kind": "stock", "target": {"code": "513290", "category": "ETF"}, **result})
    assert "valuation" not in bundle and "news" not in bundle
    assert bundle["analysis_policy"]["ignore_missing_excluded"]
    assert not _evidence_pointer(bundle, "valuation", "/valuation/data/items/0/track_index_pe_ttm_five_year_percentile")


def test_fund_evidence_survives_idempotent_bundle_and_checks_nested_availability():
    extra = etf_sections(datasets(), {}, {})
    report = {"kind": "stock", "target": {"code": "513290", "category": "ETF"}, **extra}
    bundle = _research_bundle(report)
    assert _research_bundle(bundle) == bundle
    pointer = "/fund/data/profile/data/items/0/rate_info/0/standard_rate"
    assert _evidence_pointer(bundle, "fund", pointer)
    assert _evidence_pointer(bundle, "constituents", "/constituents/data/items/0/thscode")
    assert not _evidence_pointer(bundle, "fund", "/fund/data/profile/data/items/0/fund_scale")
    assert not _evidence_pointer(bundle, "fund", "/fund/data/realtime_premium/data/value")
    bundle["fund"]["data"]["profile"]["available"] = False
    assert not _evidence_pointer(bundle, "fund", pointer)
    opinion = {"vote": 1, "confidence": "high", "reason": "test", "abstained": False,
               "evidence": [{"source": "fund", "ref": pointer}],
               "outlook": {key: "conditional" for key in
                           ("short_term", "medium_term", "bull_case", "bear_case", "invalidation")},
               "risks": []}
    validated = _validate_research(opinion, bundle, strict=False)
    assert validated["vote"] == 0 and validated["abstained"]


class LofFeed:
    """161128 is a listed LOF, not an ETF: the fund identity must not be invented."""

    def __init__(self):
        self.calls = []

    def __call__(self, request):
        self.calls.append(request)
        assert request.url.host == "fuyao.aicubes.cn"
        assert request.url.path == "/api/meta/tickers/search"
        rows = ([{"thscode": "161128.SZ", "ticker": "161128", "name": "标普信息科技LOF",
                  "asset_type": "fund-lof"}] if request.url.params["asset_type"] == "fund-lof" else [])
        return httpx.Response(200, json={"code": 0, "data": {"timestamp": STAMP, "item": rows}})


def test_listed_lof_resolves_with_its_own_category():
    feed = LofFeed()
    service = MarketService(transport=httpx.MockTransport(feed), key_provider=lambda: KEY,
                            clock=lambda: NOW)
    try:
        meta = service.fund_symbol("161128")
        assert meta["category"] == "LOF" and meta["thscode"] == "161128.SZ"
        assert [r.url.params["asset_type"] for r in feed.calls] == ["fund-etf", "fund-lof"]
        assert service.fund_symbol("161128")["category"] == "LOF"  # cached identity
        assert len(feed.calls) == 2
    finally:
        service.close()


class EmptyEngine:
    _grid = {}
    grid_meta = {}

    def _load_grid(self):
        pass

    def probability(self, *args, **kwargs):
        raise AssertionError("must not recompute")


class FactorProvider:
    def __init__(self):
        self.calls = []
        self.report = {"kind": "factor", "source": "llm_batch", "status": "completed",
                       "data_version": "offline-v1", "as_of": "2026-11-16",
                       "target": {"code": "513290", "category": "ETF", "target_id": "ETF:513290", "timeframe": "1d"},
                       "rule": {"kind": "code", "id": "verified-rule"}, "metrics": {"accuracy": .6}}

    def current_report(self, code, **kwargs):
        self.calls.append((code, kwargs))
        return deepcopy(self.report)

    def submit(self, *args, **kwargs):
        raise AssertionError("must not launch factor research")


def research_service(market, provider=None):
    def forbidden(*args, **kwargs):
        raise AssertionError("models and jobs are forbidden")
    return ResearchService(EmptyEngine(), market, SimpleNamespace(analyze=forbidden),
                           SimpleNamespace(submit=forbidden), SimpleNamespace(list=lambda: []),
                           factor_provider=provider)


def test_etf_report_integrates_fund_evidence_without_any_a_share_request(market):
    service, feed = market
    provider = FactorProvider()
    report = research_service(service, provider).stock_report(CODE, category="ETF")
    assert report["target"]["thscode"] == CODE and report["target"]["category"] == "ETF"
    assert report["quote"]["available"] and report["history"]["available"]
    assert report["trend"]["available"] and report["fund"]["available"]
    assert report["constituents"]["available"] and report["news"]["excluded"]
    assert report["valuation"]["excluded"]
    assert not any(request.url.path in ("/api/fund/news/article-list", "/api/fund/performance/indicators-historical") for request in feed.calls)
    assert report["factor"]["available"]
    assert report["fundamentals"]["data"]["kind"] == "fund_financial_indicators"
    assert provider.calls == [("513290", {"timeframe": "1d", "category": "ETF"})]
    assert not any("/a-share/" in request.url.path for request in feed.calls)


@pytest.mark.parametrize("change", [
    {"category": "个股", "target_id": "个股:513290"},
    {"target_id": "个股:513290"}, {"code": "510300"}, {"timeframe": "1w"},
])
def test_etf_factor_evidence_rejects_wrong_category_or_identity(change):
    provider = FactorProvider()
    provider.report["target"].update(change)
    result = research_service(SimpleNamespace(), provider).factor_evidence(CODE, "ETF")
    assert not result["available"] and "data" not in result
    assert provider.calls == [("513290", {"timeframe": "1d", "category": "ETF"})]
