"""Financial-API integration: entirely offline, no user DB or credential reads."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
import threading

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.market import MarketError, MarketService, SOURCE, _key

KEY = "offline-test-secret-never-real"
STAMP = 1784275991000


def ok(data):
    return httpx.Response(200, json={"code": 0, "message": "success", "data": data})


def meta(full="601088.SH", name="中国神华", asset="a-share"):
    return {"thscode": full, "ticker": full[:6], "name": name, "asset_type": asset}


class Feed:
    def __init__(self):
        self.calls = []
        self.meta_rows = None
        self.snapshot = {"timestamp": STAMP, "item": [
            {"thscode": "601088.SH", "ticker": "601088", "last_price": None,
             "price_change": 0, "volume": None}]}

    def __call__(self, request):
        self.calls.append(request)
        assert request.url.scheme == "https"
        assert request.url.host == "fuyao.aicubes.cn"
        assert request.headers["X-api-key"] == KEY
        assert request.extensions["timeout"]["read"] <= 8
        if request.url.path == "/api/meta/tickers/search":
            assert request.url.params["asset_type"] == "a-share"
            assert request.url.params["limit"] == "50"
            q = request.url.params["q"]
            rows = self.meta_rows if self.meta_rows is not None else [
                meta("000001.SZ", "平安银行") if q.startswith("000001") else meta()]
            return ok({"timestamp": 1, "item": rows})
        assert request.url.path == "/api/a-share/prices/snapshot"
        assert request.url.params["thscodes"]
        return ok(self.snapshot)


@pytest.fixture
def feed():
    return Feed()


@pytest.fixture
def service(feed):
    value = MarketService(transport=httpx.MockTransport(feed), key_provider=lambda: KEY)
    yield value
    value.close()


def test_contract_nulls_missing_timestamp_and_names(service, feed):
    result = service.quotes("601088,000001")
    assert result["source"] == SOURCE
    assert result["provider"] == "hithink-finance"
    assert result["timestamp"] == STAMP
    assert result["fetched_at"].endswith("+08:00")
    assert result["cached"] is False and result["cache_age_seconds"] == 0
    row = result["items"][0]
    assert row["code"] == "601088" and row["name"] == "中国神华"
    assert row["last_price"] is None and row["volume"] is None
    assert row["price_change"] == 0 and row["timestamp"] == STAMP
    assert result["missing"] == ["000001"]
    assert "不等于逐笔成交时间" in result["warnings"][0]
    assert len(feed.calls) == 3


def test_empty_snapshot_is_not_synthetic(service, feed):
    feed.snapshot = {"timestamp": None, "item": []}
    result = service.quotes("601088.SH")
    assert result["timestamp"] is None
    assert result["items"] == [] and result["missing"] == ["601088.SH"]


def test_item_timestamp_is_preserved_including_null(service, feed):
    feed.snapshot["item"][0]["timestamp"] = None
    assert service.quotes("601088")["items"][0]["timestamp"] is None


@pytest.mark.parametrize("codes", ["", " ", ",", "601088,", ",601088", "601088,,000001",
    "510300.OF", "601088.HK", "https://evil.test", "../601088", "60108", "６０１０８８",
    ",".join(["601088"] * 51)])
def test_invalid_codes_do_not_call_network(service, feed, codes):
    with pytest.raises(MarketError) as error:
        service.quotes(codes)
    assert error.value.status == 400 and error.value.code == "market_codes"
    assert not feed.calls


def test_normalization_dedup_and_full_code_is_validated(service, feed):
    service.quotes(" 601088.sh ,601088.SH")
    assert len(feed.calls) == 2
    assert feed.calls[0].url.params["q"] == "601088.SH"
    assert feed.calls[1].url.params["thscodes"] == "601088.SH"


@pytest.mark.parametrize("rows,code", [([], "market_unsupported"),
    ([meta(asset="fund-etf")], "market_unsupported"),
    ([meta("000001.SZ")], "market_unsupported"),
    ([meta("601088.SH"), meta("601088.SZ")], "market_ambiguous")])
def test_metadata_exact_match_asset_and_ambiguity(service, feed, rows, code):
    feed.meta_rows = rows
    with pytest.raises(MarketError) as error:
        service.quotes("601088")
    assert error.value.code == code and error.value.status == 422
    assert len(feed.calls) == 1


def test_full_code_does_not_select_different_exchange(service, feed):
    feed.meta_rows = [meta("601088.SZ")]
    with pytest.raises(MarketError, match="无法唯一解析"):
        service.quotes("601088.SH")


@pytest.mark.parametrize("provider_code,status,code", [(2001, 502, "market_auth"),
    (2003, 502, "market_auth"), (2004, 502, "market_auth"), (4001, 503, "market_rate_limit"),
    (3001, 422, "market_unsupported"), (3004, 422, "market_unsupported"),
    (3002, 502, "market_provider"), (5001, 502, "market_provider")])
def test_business_failure_is_not_http_success(provider_code, status, code):
    def handler(request):
        return httpx.Response(200, json={"code": provider_code, "message": KEY, "data": None})
    with MarketServiceClient(handler) as svc:
        with pytest.raises(MarketError) as error:
            svc.quotes("601088")
        assert (error.value.code, error.value.status) == (code, status)
        assert error.value.provider_code == provider_code
        assert KEY not in str(error.value.as_dict())


class MarketServiceClient:
    def __init__(self, handler, **kwargs):
        self.service = MarketService(transport=httpx.MockTransport(handler),
                                     key_provider=lambda: KEY, **kwargs)

    def __enter__(self):
        return self.service

    def __exit__(self, *args):
        self.service.close()


@pytest.mark.parametrize("status", [201, 301, 401, 403, 429, 500])
def test_http_errors_never_forward_secret_or_follow_redirect(status):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, text=KEY, headers={"location": "https://evil.test/" + KEY})
    with MarketServiceClient(handler) as svc:
        with pytest.raises(MarketError) as error:
            svc.quotes("601088")
        assert error.value.status in (502, 503)
        assert KEY not in str(error.value.as_dict())
    assert len(calls) == 1


@pytest.mark.parametrize("kind,code,status", [("timeout", "market_timeout", 504),
                                              ("network", "market_network", 502)])
def test_transport_errors_are_redacted(kind, code, status):
    def handler(request):
        cls = httpx.ReadTimeout if kind == "timeout" else httpx.ConnectError
        raise cls(KEY + " D:/private/secret.txt", request=request)
    with MarketServiceClient(handler) as svc:
        with pytest.raises(MarketError) as error:
            svc.quotes("601088")
        assert error.value.code == code and error.value.status == status
        assert KEY not in str(error.value) and "private" not in str(error.value)


@pytest.mark.parametrize("body", [{"code": "0", "data": {}}, {"code": False, "data": {}},
                                  {"code": 0, "data": None}, {"code": 0, "data": {"item": {}}}, []])
def test_malformed_envelope_rejected(body):
    with MarketServiceClient(lambda r: httpx.Response(200, json=body)) as svc:
        with pytest.raises(MarketError) as error:
            svc.quotes("601088")
        assert error.value.code == "market_protocol"


def test_invalid_json_rejected():
    with MarketServiceClient(lambda r: httpx.Response(200, text=KEY)) as svc:
        with pytest.raises(MarketError) as error:
            svc.quotes("601088")
        assert error.value.code == "market_protocol" and KEY not in str(error.value)


@pytest.mark.parametrize("stamp", [False, "1784275991000", -1, 1.5])
def test_invalid_snapshot_timestamp(service, feed, stamp):
    feed.snapshot["timestamp"] = stamp
    with pytest.raises(MarketError) as error:
        service.quotes("601088")
    assert error.value.code == "market_protocol"


def test_ttl_metadata_cache_and_copy_isolation(feed):
    now = [1000.0]
    with MarketServiceClient(feed, clock=lambda: now[0]) as svc:
        first = svc.quotes("601088")
        first["items"][0]["last_price"] = 999
        now[0] += 14
        cached = svc.quotes("601088")
        assert cached["cached"] and cached["cache_age_seconds"] == 14
        assert cached["items"][0]["last_price"] is None
        assert len(feed.calls) == 2
        now[0] += 1
        assert not svc.quotes("601088")["cached"]
        assert len(feed.calls) == 3  # metadata is reused; snapshot refreshed
        now[0] += 3601
        svc.quotes("601088")
        assert len(feed.calls) == 5


def test_caches_have_hard_limits(feed):
    with MarketServiceClient(feed) as svc:
        svc.CACHE_MAX = 2
        svc.META_MAX = 3
        svc.quotes("601088")
        svc.quotes("000001")
        svc.quotes("601088,000001")
        assert len(svc._cache) <= 2 and len(svc._metadata) <= 3
        assert ("601088",) not in svc._cache


def test_credential_rotation_invalidates_both_caches():
    keys, calls = [KEY], []
    def handler(request):
        calls.append(request)
        assert request.headers["X-api-key"] == keys[0]
        if "/meta/" in request.url.path:
            return ok({"item": [meta()]})
        return ok({"timestamp": None, "item": []})
    svc = MarketService(transport=httpx.MockTransport(handler), key_provider=lambda: keys[0])
    try:
        svc.quotes("601088")
        keys[0] = "rotated-offline-test-key"
        assert not svc.quotes("601088")["cached"]
        assert len(calls) == 4
        keys[0] = ""
        assert not svc.status()["configured"]
        assert not svc._cache and not svc._metadata
        with pytest.raises(MarketError) as error:
            svc.quotes("601088")
        assert error.value.code == "market_not_configured"
    finally:
        svc.close()


def test_singleflight_concurrency(feed):
    start = threading.Barrier(8)
    with MarketServiceClient(feed) as svc:
        def run(_):
            start.wait(timeout=5)
            return svc.quotes("601088")
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(run, range(8)))
        assert len(feed.calls) == 2
        assert sum(not result["cached"] for result in results) == 1


def test_singleflight_failure_is_shared_without_retry(monkeypatch):
    from concurrent.futures import Future
    joined = threading.Event()
    entered = threading.Event()
    calls = []

    class TrackedFuture(Future):
        def result(self, timeout=None):
            joined.set()
            return super().result(timeout)

    def handler(request):
        calls.append(request)
        entered.set()
        assert joined.wait(5)
        raise httpx.ReadTimeout(KEY, request=request)

    monkeypatch.setattr("backend.market.Future", TrackedFuture)
    with MarketServiceClient(handler) as svc:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(svc.quotes, "601088")
            assert entered.wait(5)
            second = pool.submit(svc.quotes, "601088")
            for future in (first, second):
                with pytest.raises(MarketError) as error:
                    future.result(timeout=5)
                assert error.value.code == "market_timeout"
        assert len(calls) == 1
        assert not svc._flights


def test_total_budget_is_enforced_before_next_request(feed, monkeypatch):
    ticks = iter([0, 0, 26])
    monkeypatch.setattr("backend.market.time.monotonic", lambda: next(ticks))
    with MarketServiceClient(feed) as svc:
        with pytest.raises(MarketError) as error:
            svc.quotes("601088")
        assert error.value.code == "market_timeout"
        assert len(feed.calls) == 1


def test_status_does_not_connect_or_return_key_or_path(service, feed, monkeypatch):
    monkeypatch.setenv("HITHINK_FINANCE_KEY_FILE", "D:/private/credential-file.txt")
    result = service.status()
    assert set(result) == {"configured", "source", "cache_ttl_seconds", "capabilities"}
    assert result["configured"] and result["cache_ttl_seconds"] == 15
    assert KEY not in str(result) and "private" not in str(result)
    assert feed.calls == []


def test_success_payload_also_redacts_credentials(service, feed, monkeypatch):
    monkeypatch.setenv("HITHINK_FINANCE_KEY_FILE", "D:/private/keyfile.txt")
    feed.snapshot["item"][0]["unexpected"] = KEY + " D:/private/keyfile.txt"
    result = service.quotes("601088")
    assert KEY not in str(result) and "D:/private/keyfile.txt" not in str(result)


def test_key_precedence_relative_paths_and_no_model_keys(monkeypatch, tmp_path):
    # This test uses temporary files only; never opens the repository's real key.
    monkeypatch.setattr("backend.market.PROJECT_ROOT", tmp_path)
    monkeypatch.delenv("HITHINK_FINANCE_API_KEY", raising=False)
    monkeypatch.delenv("HITHINK_FINANCE_KEY_FILE", raising=False)
    for name in ("ST_MODEL_API_KEY", "OPENAI_API_KEY", "COMMANDCODE_API_KEY"):
        monkeypatch.setenv(name, "model-only-not-market")
    assert _key() == ""
    (tmp_path / "ths_apikey.txt").write_text("default-offline", encoding="utf-8")
    assert _key() == "default-offline"
    (tmp_path / "custom.txt").write_text("\ufeffcustom-offline\n", encoding="utf-8")
    monkeypatch.setenv("HITHINK_FINANCE_KEY_FILE", "custom.txt")
    assert _key() == "custom-offline"
    monkeypatch.setenv("HITHINK_FINANCE_API_KEY", " env-offline ")
    assert _key() == "env-offline"


def test_missing_selected_file_fails_closed(monkeypatch, tmp_path):
    monkeypatch.setattr("backend.market.PROJECT_ROOT", tmp_path)
    monkeypatch.delenv("HITHINK_FINANCE_API_KEY", raising=False)
    monkeypatch.setenv("HITHINK_FINANCE_KEY_FILE", "missing.txt")
    assert _key() == ""


def test_provider_failure_and_close_safe():
    def bad_key():
        raise OSError(KEY)
    svc = MarketService(transport=httpx.MockTransport(lambda r: pytest.fail("network")),
                        key_provider=bad_key)
    assert svc.status()["configured"] is False
    with pytest.raises(MarketError) as error:
        svc.quotes("601088")
    assert KEY not in str(error.value)
    svc.close()
    svc.close()
    with pytest.raises(MarketError) as error:
        svc.quotes("601088")
    assert error.value.code == "market_closed"


def test_routes_and_legacy_fake_service_compatibility(service):
    from backend.app import create_app
    svc = SimpleNamespace(
        settings=SimpleNamespace(model=SimpleNamespace(public_status=lambda: {"configured": False})),
        engine=SimpleNamespace(grid_meta={"unchanged": True}),
        plugins=SimpleNamespace(list=lambda **kw: []))
    client = TestClient(create_app(svc))
    assert client.get("/api/status").json()["grid"] == {"unchanged": True}
    assert client.get("/api/market/status").json()["configured"] is False
    response = client.get("/api/market/quotes?codes=601088")
    assert response.status_code == 503 and response.json()["code"].startswith("market_")
    svc.market = service
    assert client.get("/api/market/status").json()["configured"] is True
    assert client.get("/api/market/quotes?codes=601088").status_code == 200
    response = client.get("/api/market/quotes")
    assert response.status_code == 400 and response.json()["code"] == "market_codes"


def test_generic_api_catalog_and_path_guards():
    from backend.market import MarketService
    catalog = {row["path"] for row in MarketService.api_catalog()}
    assert "/api/a-share/special-data/limit-up-pool" in catalog
    assert "/api/a-share/special-data/limit-down-pool" in catalog
    assert "/api/a-share/special-data/limit-break-pool" in catalog
    assert "/api/a-share/special-data/limit-up-ladder" in catalog
    assert MarketService._validate_api_request(
        "/api/a-share/prices/snapshot", {"thscodes": "601088.SH"}) == {"thscodes": "601088.SH"}
    for path in ["/api/admin/keys", "https://evil.example/api/a-share/prices/snapshot",
                 "/api/a-share/../../admin", "/api/a-share/prices/snapshot?x=1"]:
        try:
            MarketService._validate_api_request(path, {})
        except Exception as exc:
            assert getattr(exc, "status", None) in (400, 403)
        else:
            raise AssertionError(path)
    try:
        MarketService._validate_api_request("/api/a-share/prices/snapshot", {"x": {"nested": 1}})
    except Exception as exc:
        assert getattr(exc, "status", None) == 400
    else:
        raise AssertionError("nested params accepted")
