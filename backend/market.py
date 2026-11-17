"""Read-only Financial-API quotes, independent of quant/model credentials.

Contract: https://github.com/Hithink-Tech-Org/Financial-API/tree/main/docs/api
No historical/synthetic fallback; timestamps remain upstream snapshot timestamps.
"""
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future, TimeoutError as FutureTimeout
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import hashlib
import json
import math
import os
from pathlib import Path
import re
import threading
import time
from typing import Callable

import httpx

SOURCE = "同花顺 Financial-API"
PROVIDER = "hithink-finance"
BASE_URL = "https://fuyao.aicubes.cn"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SHANGHAI = timezone(timedelta(hours=8), "Asia/Shanghai")
WARNING = "接口快照 timestamp 为上游响应组装/数据就绪时间，不等于逐笔成交时间或交易所时间。"
_CODE = re.compile(r"^[0-9]{6}(?:\.(?:SH|SZ|BJ))?$")
_FULL = re.compile(r"^[0-9]{6}\.(?:SH|SZ|BJ)$")


class MarketError(Exception):
    """Only controlled, credential-free messages may cross the REST boundary."""

    def __init__(self, message: str, *, code: str = "market_unavailable",
                 status: int = 502, provider_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.provider_code = provider_code

    def as_dict(self) -> dict:
        body = {"error": str(self), "code": self.code}
        if self.provider_code is not None:
            body["provider_code"] = self.provider_code
        return body


def _key() -> str:
    # Resolve relative to the repository, never to an arbitrary process cwd.
    direct = os.environ.get("HITHINK_FINANCE_API_KEY", "").strip()
    if direct:
        return direct
    configured_file = os.environ.get("HITHINK_FINANCE_KEY_FILE", "").strip()
    if not configured_file and os.environ.get("ST_PORTABLE_RUNTIME") == "1":
        return ""  # Never scan neighbouring package directories for credentials.
    path = Path(configured_file) if configured_file else PROJECT_ROOT / "ths_apikey.txt"
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    try:
        return path.read_text(encoding="utf-8-sig").strip()
    except (OSError, UnicodeError, ValueError):
        return ""


def _timestamp(value):
    # bool is not an integer timestamp, and null must not become zero.
    if value is None or (type(value) is int and value >= 0):
        return value
    raise MarketError("行情响应时间戳格式无效", code="market_protocol")


def _safe(value, secrets):
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[REDACTED]")
        return value
    if isinstance(value, list):
        return [_safe(x, secrets) for x in value]
    if isinstance(value, dict):
        return {_safe(k, secrets): _safe(v, secrets) for k, v in value.items()}
    if isinstance(value, float) and not math.isfinite(value):
        raise MarketError("行情响应含无效数值", code="market_protocol")
    return value


class MarketService:
    CACHE_TTL = 15
    META_TTL = 3600
    CACHE_MAX = 128
    META_MAX = 512
    REQUEST_TIMEOUT = 8.0
    TOTAL_TIMEOUT = 25.0

    def __init__(self, *, transport: httpx.BaseTransport | None = None,
                 client: httpx.Client | None = None,
                 key_provider: Callable[[], str] | None = None,
                 clock: Callable[[], float] | None = None):
        if client is not None and transport is not None:
            raise ValueError("client and transport are mutually exclusive")
        self._client = client or httpx.Client(
            transport=transport, trust_env=False, follow_redirects=False,
            timeout=self.REQUEST_TIMEOUT)
        self._key_provider = key_provider or _key
        self._clock = clock or time.time
        # A single lock also bounds upstream concurrency and coalesces cache misses.
        # Credential reads/invalidation occur inside it, so rotation cannot race writes.
        self._lock = threading.RLock()
        self._flight_lock = threading.Lock()
        self._flights: dict[tuple, Future] = {}
        self._cache: OrderedDict = OrderedDict()
        self._metadata: OrderedDict = OrderedDict()
        self._credential_id = None
        self._closed = False

    def _read_credentials(self) -> str:
        try:
            key = self._key_provider()
            if not isinstance(key, str):
                raise ValueError()
            key = key.strip()
        except Exception:
            raise MarketError("无法读取行情凭据", code="market_credentials", status=503) from None
        return key

    def _credentials(self) -> str:
        key = self._read_credentials()
        # A change in the explicitly selected source invalidates caches as well.
        identity = (key, os.environ.get("HITHINK_FINANCE_KEY_FILE", ""),
                    bool(os.environ.get("HITHINK_FINANCE_API_KEY", "").strip()))
        digest = hashlib.sha256(repr(identity).encode()).digest()
        if digest != self._credential_id:
            self._cache.clear()
            self._metadata.clear()
            self._credential_id = digest
        return key

    @staticmethod
    def unavailable_status() -> dict:
        return {"configured": False, "source": SOURCE, "cache_ttl_seconds": 15,
                "capabilities": ["a-share-quotes", "a-share-history"]}

    def status(self) -> dict:
        # Health reads must not wait behind a 25-second upstream query: the DSH
        # connection badge and loopback identity probe depend on this endpoint.
        result = self.unavailable_status()
        acquired = self._lock.acquire(blocking=False)
        try:
            result["configured"] = bool(self._credentials() if acquired else self._read_credentials()) and not self._closed
        except MarketError:
            pass
        finally:
            if acquired:
                self._lock.release()
        return result

    @staticmethod
    def _parse(codes: str) -> tuple[str, ...]:
        if not isinstance(codes, str) or len(codes) > 600:
            raise MarketError("codes 必须包含 1..50 个非空 A 股代码", code="market_codes", status=400)
        parts = [part.strip().upper() for part in codes.split(",")]
        if not 1 <= len(parts) <= 50 or any(not _CODE.fullmatch(x) for x in parts):
            raise MarketError("codes 必须包含 1..50 个六位代码或标准 SH/SZ/BJ thscode",
                              code="market_codes", status=400)
        return tuple(dict.fromkeys(parts))

    def _get(self, path: str, params: dict, key: str, deadline: float,
             require_rows: bool = True) -> dict:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise MarketError("行情查询总时限已到，请缩小代码批次", code="market_timeout", status=504)
        try:
            response = self._client.get(
                BASE_URL + path, params=params, headers={"X-api-key": key},
                timeout=min(self.REQUEST_TIMEOUT, remaining), follow_redirects=False)
        except httpx.TimeoutException:
            raise MarketError("行情供应商请求超时", code="market_timeout", status=504) from None
        except Exception:
            # Never return/log exception text, headers, URLs, or upstream bodies.
            raise MarketError("行情供应商网络请求失败", code="market_network", status=502) from None
        if response.status_code != 200:
            status = 503 if response.status_code == 429 else 502
            code = "market_auth" if response.status_code in (401, 403) else "market_http"
            raise MarketError("行情供应商鉴权失败" if code == "market_auth" else "行情供应商 HTTP 请求失败",
                              code=code, status=status)
        try:
            envelope = response.json()
        except (ValueError, UnicodeError):
            raise MarketError("行情供应商响应不是有效 JSON", code="market_protocol") from None
        if not isinstance(envelope, dict) or type(envelope.get("code")) is not int:
            raise MarketError("行情供应商响应信封无效", code="market_protocol")
        provider_code = envelope["code"]
        if provider_code != 0:
            if provider_code in (2001, 2003, 2004):
                message, code, status = "行情供应商凭据无效或未授权", "market_auth", 502
            elif provider_code == 4001:
                message, code, status = "行情供应商限流，请稍后再试", "market_rate_limit", 503
            elif provider_code in (3001, 3004):
                message, code, status = "标的不存在或不支持 A 股行情", "market_unsupported", 422
            else:
                message, code, status = "行情供应商业务请求失败", "market_provider", 502
            raise MarketError(message, code=code, status=status, provider_code=provider_code)
        data = envelope.get("data")
        if not isinstance(data, dict):
            raise MarketError("行情供应商数据结构无效", code="market_protocol")
        if require_rows and not (isinstance(data.get("item"), list) or isinstance(data.get("items"), list)):
            raise MarketError("行情供应商数据结构无效", code="market_protocol")
        return data

    @staticmethod
    def _put(cache: OrderedDict, key, value, limit: int):
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > limit:
            cache.popitem(last=False)

    def _resolve(self, code: str, key: str, deadline: float) -> dict:
        now = self._clock()
        cached = self._metadata.get(code)
        if cached and 0 <= now - cached[0] < self.META_TTL:
            self._metadata.move_to_end(code)
            return cached[1]
        self._metadata.pop(code, None)
        data = self._get("/api/meta/tickers/search",
                         {"q": code, "asset_type": "a-share", "limit": 50}, key, deadline)
        matches = {}
        for row in data["item"]:
            if not isinstance(row, dict):
                raise MarketError("标的目录记录无效", code="market_protocol")
            full = row.get("thscode")
            if (isinstance(full, str) and _FULL.fullmatch(full)
                    and row.get("asset_type") == "a-share"
                    and (full == code if "." in code else full[:6] == code)):
                matches[full] = row
        if len(matches) != 1:
            raise MarketError("代码无法唯一解析为 A 股，请提供有效完整 thscode",
                              code="market_ambiguous" if matches else "market_unsupported", status=422)
        result = next(iter(matches.values()))
        self._put(self._metadata, code, (self._clock(), result), self.META_MAX)
        # Both aliases are safe only after unique directory resolution.
        self._put(self._metadata, result["thscode"], (self._clock(), result), self.META_MAX)
        return result

    def quotes(self, codes: str) -> dict:
        requested = self._parse(codes)
        if self._closed:
            raise MarketError("行情服务已关闭", code="market_closed", status=503)
        # Share both success and failure with callers already waiting on this batch.
        # The opaque identity prevents credential rotation from joining an old flight.
        key = self._read_credentials()
        identity = hashlib.sha256(repr((key, os.environ.get(
            "HITHINK_FINANCE_KEY_FILE", ""))).encode()).digest()
        flight_key = (requested, identity)
        with self._flight_lock:
            future = self._flights.get(flight_key)
            leader = future is None
            if leader:
                if len(self._flights) >= self.CACHE_MAX:
                    raise MarketError("行情服务繁忙，请稍后重试", code="market_busy", status=503)
                future = Future()
                self._flights[flight_key] = future
        if not leader:
            try:
                shared = deepcopy(future.result(timeout=self.TOTAL_TIMEOUT))
                shared["cached"] = True
                shared["cache_age_seconds"] = max(
                    0, self._clock() - datetime.fromisoformat(shared["fetched_at"]).timestamp())
                return shared
            except FutureTimeout:
                raise MarketError("等待行情查询超时", code="market_timeout", status=504) from None
        try:
            result = self._quotes(requested)
            future.set_result(result)
            return deepcopy(result)
        except BaseException as exc:
            future.set_exception(exc)
            raise
        finally:
            with self._flight_lock:
                self._flights.pop(flight_key, None)

    def _quotes(self, requested: tuple[str, ...]) -> dict:
        # Include time waiting for another batch in the overall budget.
        deadline = time.monotonic() + self.TOTAL_TIMEOUT
        if not self._lock.acquire(timeout=self.TOTAL_TIMEOUT):
            raise MarketError("等待行情查询超时", code="market_timeout", status=504)
        try:
            if self._closed:
                raise MarketError("行情服务已关闭", code="market_closed", status=503)
            key = self._credentials()
            if not key:
                raise MarketError("未配置同花顺 Financial-API 行情凭据", code="market_not_configured", status=503)
            now = self._clock()
            cached = self._cache.get(requested)
            if cached and 0 <= now - cached[0] < self.CACHE_TTL:
                self._cache.move_to_end(requested)
                result = deepcopy(cached[1])
                result.update(cached=True, cache_age_seconds=max(0, now - cached[0]))
                return result
            self._cache.pop(requested, None)
            metadata = [self._resolve(code, key, deadline) for code in requested]
            full_codes = list(dict.fromkeys(row["thscode"] for row in metadata))
            data = self._get("/api/a-share/prices/snapshot",
                             {"thscodes": ",".join(full_codes)}, key, deadline)
            timestamp = _timestamp(data.get("timestamp"))
            rows = {}
            for row in data["item"]:
                if not isinstance(row, dict):
                    raise MarketError("行情快照记录无效", code="market_protocol")
                full = row.get("thscode")
                if isinstance(full, str) and full in full_codes:
                    rows[full] = row
            items, missing, seen = [], [], set()
            for request_code, meta in zip(requested, metadata):
                full = meta["thscode"]
                if full not in rows:
                    missing.append(request_code)
                elif full not in seen:
                    row = deepcopy(rows[full])
                    row.update(code=full[:6], name=meta.get("name"), thscode=full,
                               timestamp=_timestamp(row.get("timestamp", timestamp)))
                    items.append(row)
                    seen.add(full)
            fetched = self._clock()
            result = {"source": SOURCE, "provider": PROVIDER, "timestamp": timestamp,
                      "fetched_at": datetime.fromtimestamp(fetched, SHANGHAI).isoformat(),
                      "cached": False, "cache_age_seconds": 0,
                      "items": items, "missing": missing, "warnings": [WARNING]}
            secrets = (key, os.environ.get("HITHINK_FINANCE_KEY_FILE", ""),
                       str(PROJECT_ROOT / "ths_apikey.txt"))
            result = _safe(result, secrets)
            self._put(self._cache, requested, (fetched, result), self.CACHE_MAX)
            return deepcopy(result)
        finally:
            self._lock.release()

    def symbol(self, code: str) -> dict:
        """Resolve an A-share identity without requiring a local research dataset."""
        parsed = self._parse(code)
        if len(parsed) != 1 or "," in code:
            raise MarketError("一次只解析一个标的", code="market_codes", status=400)
        deadline = time.monotonic() + self.TOTAL_TIMEOUT
        if not self._lock.acquire(timeout=self.TOTAL_TIMEOUT):
            raise MarketError("等待标的目录超时", code="market_timeout", status=504)
        try:
            if self._closed:
                raise MarketError("行情服务已关闭", code="market_closed", status=503)
            key = self._credentials()
            if not key:
                raise MarketError("未配置行情凭据，且本地没有此标的研究数据", code="market_not_configured", status=503)
            meta = self._resolve(parsed[0], key, deadline)
            return _safe({"code": meta["thscode"][:6], "category": "个股",
                          "name": meta.get("name") or meta["thscode"][:6], "thscode": meta["thscode"], "source": SOURCE}, (key,))
        finally:
            self._lock.release()

    def history(self, code: str, limit: int = 120, adjust: str = "forward") -> dict:
        """Bounded daily bars for the cockpit, never inserted into the quant store."""
        parsed = self._parse(code)
        if len(parsed) != 1 or "," in code:
            raise MarketError("K 线一次只查询一个标的", code="market_codes", status=400)
        if type(limit) is not int or not 5 <= limit <= 180:
            raise MarketError("K 线根数必须为 5..180", code="market_limit", status=400)
        if adjust not in ("forward", "backward", "none"):
            raise MarketError("复权方式必须为 forward/backward/none", code="market_adjust", status=400)
        deadline = time.monotonic() + self.TOTAL_TIMEOUT
        if not self._lock.acquire(timeout=self.TOTAL_TIMEOUT):
            raise MarketError("等待行情查询超时", code="market_timeout", status=504)
        try:
            if self._closed:
                raise MarketError("行情服务已关闭", code="market_closed", status=503)
            key = self._credentials()
            if not key:
                raise MarketError("未配置同花顺 Financial-API 行情凭据", code="market_not_configured", status=503)
            cache_key = ("history", parsed[0], limit, adjust)
            now = self._clock()
            cached = self._cache.get(cache_key)
            if cached and 0 <= now - cached[0] < 60:
                result = deepcopy(cached[1])
                result.update(cached=True, cache_age_seconds=max(0, now - cached[0]))
                self._cache.move_to_end(cache_key)
                return result
            meta = self._resolve(parsed[0], key, deadline)
            end = int(now * 1000)
            start = max(0, end - 400 * 86400000)
            data = self._get("/api/a-share/prices/historical", {
                "thscode": meta["thscode"], "interval": "1d", "adjust": adjust,
                "start": start, "end": end}, key, deadline)
            bars = {}
            for row in data["item"]:
                if not isinstance(row, dict) or type(row.get("date_ms")) is not int:
                    raise MarketError("日 K 线日期格式无效", code="market_protocol")
                stamp = row["date_ms"]
                if stamp < start or stamp > end:
                    raise MarketError("日 K 线日期超出请求窗口", code="market_protocol")
                for field in ("open_price", "high_price", "low_price", "close_price", "volume", "turnover"):
                    value = row.get(field)
                    if value is not None and (type(value) not in (int, float) or not math.isfinite(value)):
                        raise MarketError("日 K 线数值无效", code="market_protocol")
                bars[stamp] = deepcopy(row)
            timestamp = _timestamp(data.get("timestamp"))
            fetched = self._clock()
            result = {"source": SOURCE, "provider": PROVIDER, "code": meta["thscode"][:6],
                      "name": meta.get("name"), "thscode": meta["thscode"],
                      "interval": "1d", "adjust": adjust, "timestamp": timestamp,
                      "fetched_at": datetime.fromtimestamp(fetched, SHANGHAI).isoformat(),
                      "cached": False, "cache_age_seconds": 0,
                      "items": [bars[stamp] for stamp in sorted(bars)[-limit:]],
                      "warnings": ["日 K 来源为 Financial-API；timestamp 为序列数据就绪时间，非逐笔成交时间。",
                                   "图表复权口径不改变本地历史概率或冻结记录；缺失值不补零。"]}
            result = _safe(result, (key, os.environ.get("HITHINK_FINANCE_KEY_FILE", "")))
            self._put(self._cache, cache_key, (fetched, result), self.CACHE_MAX)
            return deepcopy(result)
        finally:
            self._lock.release()

    def _domain_cached(self, cache_key, ttl: int, loader) -> dict:
        """Share the same secure transport/cache policy for index and company data."""
        deadline = time.monotonic() + self.TOTAL_TIMEOUT
        if not self._lock.acquire(timeout=self.TOTAL_TIMEOUT):
            raise MarketError("等待数据源超时", code="market_timeout", status=504)
        try:
            if self._closed:
                raise MarketError("行情服务已关闭", code="market_closed", status=503)
            key = self._credentials()
            if not key:
                raise MarketError("未配置同花顺 Financial-API 凭据", code="market_not_configured", status=503)
            now = self._clock()
            hit = self._cache.get(cache_key)
            if hit and 0 <= now-hit[0] < (hit[2] if len(hit) > 2 else ttl):
                self._cache.move_to_end(cache_key)
                result = deepcopy(hit[1])
                result.update(cached=True, cache_age_seconds=max(0, now-hit[0]))
                return result
            result = loader(key, deadline)
            fetched = self._clock()
            result.update(source=SOURCE, provider=PROVIDER,
                          fetched_at=datetime.fromtimestamp(fetched, SHANGHAI).isoformat(),
                          cached=False, cache_age_seconds=0)
            result = _safe(result, (key, os.environ.get("HITHINK_FINANCE_KEY_FILE", "")))
            incomplete = result.get("available") is False or any(
                isinstance(value, dict) and value.get("available") is False for value in result.values())
            self._put(self._cache, cache_key, (fetched, result, min(ttl, 15) if incomplete else ttl), self.CACHE_MAX)
            return deepcopy(result)
        finally:
            self._lock.release()

    def stock_universe(self, offset: int = 0, limit: int = 1000) -> dict:
        """Actual A-share directory, never intersected with local model coverage."""
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 10000:
            raise MarketError("股票目录分页范围无效", code="market_limit", status=400)
        def load(key, deadline):
            data = self._get("/api/meta/tickers/list", {"asset_type": "a-share", "offset": offset, "limit": limit}, key, deadline)
            rows, seen = [], set()
            for row in data["item"]:
                if not isinstance(row, dict) or row.get("asset_type") != "a-share":
                    raise MarketError("A股目录返回了不匹配的资产类型", code="market_protocol")
                full = row.get("thscode")
                if not isinstance(full, str) or not _FULL.fullmatch(full) or full in seen:
                    raise MarketError("A股目录标识无效或重复", code="market_protocol")
                name = row.get("name") or full[:6]
                rows.append({"code": full[:6], "thscode": full, "name": name, "category": "个股",
                             "list_date": row.get("list_date"), "end_date": row.get("end_date"),
                             "risk_marked_name": str(name).upper().lstrip("*_ ").startswith("ST") or "退市" in str(name) or str(name).endswith("退")})
                seen.add(full)
            has_more = len(data["item"]) >= limit
            return {"items": rows, "offset": offset, "limit": limit,
                    "total": None if has_more else offset + len(rows), "has_more": has_more,
                    "timestamp": _timestamp(data.get("timestamp")),
                    "warnings": ["范围来自真实A股目录，不按本地量化覆盖或统一财务阈值预筛；目录不代表已逐股完成研究或保证可交易。"]}
        return self._domain_cached(("stock-universe", offset, limit), 600, load)

    def company_financials(self, code: str, period: str = "quarterly", limit: int = 5) -> dict:
        """Let an expert choose reporting granularity; preserve periods and nulls."""
        parsed = self._parse(code)
        if len(parsed) != 1 or "," in code or period not in ("annual", "quarterly") or type(limit) is not int or not 1 <= limit <= 8:
            raise MarketError("财务查询须为单只A股、annual/quarterly及1..8期", code="market_financials", status=400)
        def load(key, deadline):
            meta = self._resolve(parsed[0], key, deadline)
            result = {"code": meta["thscode"][:6], "thscode": meta["thscode"], "name": meta.get("name"),
                      "available": False, "period": period, "limit": limit,
                      "warnings": ["金额为原币元，基本每股收益为元/股；按实际报告期及披露日解读。季报可能是年内累计，不能当单季或错期同比；缺失不补零。"]}
            for section, endpoint in (("income", "income-statements"), ("balance", "balance-sheets"), ("cashflow", "cash-flow-statements")):
                try:
                    data = self._get("/api/a-share/financials/" + endpoint, {
                        "thscode": meta["thscode"], "period": period, "limit": limit}, key, deadline)
                    rows = []
                    for row in data["item"]:
                        if not isinstance(row, dict) or row.get("thscode") != meta["thscode"]:
                            raise MarketError("财报返回了不匹配的股票标识", code="market_protocol")
                        rows.append(deepcopy(row))
                    result[section] = {"available": bool(rows), "data": {"timestamp": _timestamp(data.get("timestamp")), "items": rows},
                                       **({} if rows else {"error": "该报表暂无披露数据"})}
                    result["available"] = result["available"] or bool(rows)
                except MarketError as exc:
                    result[section] = {"available": False, "error": str(exc), "code": exc.code}
            return result
        return self._domain_cached(("company-financials", parsed[0], period, limit), 300, load)

    def search_symbols(self, q: str, limit: int = 20) -> dict:
        if not isinstance(q, str) or not 1 <= len(q.strip()) <= 60 or type(limit) is not int or not 1 <= limit <= 50:
            raise MarketError("请输入股票代码或名称关键词，最多返回50项", code="market_search", status=400)
        query = q.strip()
        def load(key, deadline):
            data = self._get("/api/meta/tickers/search", {"q": query, "asset_type": "a-share", "limit": limit}, key, deadline)
            rows = []
            for row in data["item"]:
                if not isinstance(row, dict):
                    raise MarketError("标的目录格式无效", code="market_protocol")
                full = row.get("thscode")
                if row.get("asset_type") == "a-share" and isinstance(full, str) and _FULL.fullmatch(full):
                    rows.append({"code": full[:6], "thscode": full, "name": row.get("name"), "category": "个股"})
                    self._put(self._metadata, full, (self._clock(), row), self.META_MAX)
            return {"items": rows[:limit], "timestamp": _timestamp(data.get("timestamp")), "query": query}
        return self._domain_cached(("symbol-search", query, limit), 300, load)

    @staticmethod
    def _index_code(thscode: str) -> str:
        if not isinstance(thscode, str) or not re.fullmatch(r"[0-9]{6}\.(SH|SZ|TI)", thscode.strip().upper()):
            raise MarketError("板块须使用目录给出的完整指数 thscode", code="market_sector", status=400)
        return thscode.strip().upper()

    def _resolve_index(self, code: str, key: str, deadline: float) -> dict:
        identity = ("index", code)
        cached = self._metadata.get(identity)
        if cached and 0 <= self._clock()-cached[0] < self.META_TTL:
            self._metadata.move_to_end(identity)
            return cached[1]
        data = self._get("/api/meta/tickers/search", {
            "q": code, "asset_type": "a-share-index", "limit": 50}, key, deadline)
        matches = {row["thscode"]: row for row in data["item"]
                   if isinstance(row, dict) and row.get("thscode") == code
                   and row.get("asset_type") == "a-share-index"}
        if len(matches) != 1:
            raise MarketError("该代码未被标的目录确认是指数/板块", code="market_unsupported", status=422)
        result = next(iter(matches.values()))
        self._put(self._metadata, identity, (self._clock(), result), self.META_MAX)
        return result

    def sector_catalog(self, tag: str = "industry", q: str = "", offset: int = 0, limit: int = 30) -> dict:
        if tag not in ("industry", "cn_concept", "region", "tszs"):
            raise MarketError("不支持的板块目录分类", code="market_sector", status=400)
        if not isinstance(q, str) or len(q) > 80 or type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 100:
            raise MarketError("板块目录搜索或分页参数无效", code="market_limit", status=400)
        def load(key, deadline):
            data = self._get("/api/a-share-index/catalog/ths-index-list", {"tag": tag}, key, deadline)
            rows = []
            for row in data["item"]:
                if not isinstance(row, dict):
                    raise MarketError("板块目录格式无效", code="market_protocol")
                code = row.get("thscode")
                if not isinstance(code, str) or not re.fullmatch(r"[0-9]{6}\.(SH|SZ|TI)", code):
                    continue
                rows.append({"thscode": code, "name": row.get("name")})
                self._put(self._metadata, ("index", code),
                          (self._clock(), {"thscode": code, "name": row.get("name"), "asset_type": "a-share-index"}), self.META_MAX)
            return {"tag": tag, "timestamp": _timestamp(data.get("timestamp")), "items": rows}
        result = self._domain_cached(("sector-catalog", tag), 600, load)
        needle = q.strip().casefold()
        rows = [row for row in result["items"] if not needle or needle in str(row.get("name") or "").casefold() or needle in row["thscode"].casefold()]
        result.update(items=rows[offset:offset+limit], total=len(rows), offset=offset, limit=limit)
        return result

    def sector_snapshot(self, thscode: str) -> dict:
        code = self._index_code(thscode)
        def load(key, deadline):
            meta = self._resolve_index(code, key, deadline)
            data = self._get("/api/a-share-index/prices/snapshot", {"thscodes": code}, key, deadline)
            rows = []
            for raw in data["item"]:
                if not isinstance(raw, dict):
                    raise MarketError("板块快照格式无效", code="market_protocol")
                if raw.get("thscode") == code:
                    rows.append({**raw, "name": meta.get("name"), "code": code,
                                 "timestamp": _timestamp(raw.get("timestamp", data.get("timestamp")))})
            return {"kind": "sector", "thscode": code, "name": meta.get("name"),
                    "timestamp": _timestamp(data.get("timestamp")), "items": rows,
                    "missing": [] if rows else [code], "warnings": [WARNING]}
        return self._domain_cached(("sector-snapshot", code), 15, load)

    def sector_constituents(self, thscode: str, offset: int = 0, limit: int = 50) -> dict:
        code = self._index_code(thscode)
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 500:
            raise MarketError("成分股分页范围无效", code="market_limit", status=400)
        def load(key, deadline):
            meta = self._resolve_index(code, key, deadline)
            data = self._get("/api/a-share-index/constituents/ths-stock-list", {"thscode": code}, key, deadline)
            rows, seen = [], set()
            for row in data["item"]:
                if not isinstance(row, dict):
                    raise MarketError("成分股格式无效", code="market_protocol")
                full = row.get("thscode")
                if isinstance(full, str) and _FULL.fullmatch(full) and full not in seen:
                    rows.append({"code": full[:6], "thscode": full, "name": row.get("name"), "category": "个股"})
                    seen.add(full)
            return {"kind": "sector", "thscode": code, "name": meta.get("name"),
                    "timestamp": _timestamp(data.get("timestamp")), "items": rows}
        result = self._domain_cached(("sector-constituents", code), 600, load)
        total = len(result["items"])
        result.update(items=result["items"][offset:offset+limit], total=total,
                      offset=offset, limit=limit, has_more=offset+limit < total)
        return result

    def sector_history(self, thscode: str, limit: int = 120) -> dict:
        code = self._index_code(thscode)
        if type(limit) is not int or not 5 <= limit <= 180:
            raise MarketError("板块K线根数必须为5..180", code="market_limit", status=400)
        def load(key, deadline):
            meta = self._resolve_index(code, key, deadline)
            end = int(self._clock()*1000)
            start = max(0, end-400*86400000)
            data = self._get("/api/a-share-index/prices/historical", {
                "thscode": code, "interval": "1d", "start": start, "end": end}, key, deadline)
            bars = {}
            for row in data["item"]:
                if not isinstance(row, dict) or type(row.get("date_ms")) is not int or not start <= row["date_ms"] <= end:
                    raise MarketError("板块K线日期格式无效", code="market_protocol")
                for field in ("open_price", "high_price", "low_price", "close_price", "volume", "turnover"):
                    value = row.get(field)
                    if value is not None and (type(value) not in (int, float) or not math.isfinite(value)):
                        raise MarketError("板块K线数值无效", code="market_protocol")
                bars[row["date_ms"]] = deepcopy(row)
            return {"kind": "sector", "code": code, "thscode": code, "name": meta.get("name"),
                    "interval": "1d", "adjust": None, "timestamp": _timestamp(data.get("timestamp")),
                    "items": [bars[stamp] for stamp in sorted(bars)[-limit:]],
                    "warnings": ["指数/板块没有复权语义；日K只描述已发生的走势，不是未来路径。"]}
        return self._domain_cached(("sector-history", code, limit), 60, load)

    def valuation(self, code: str) -> dict:
        parsed = self._parse(code)
        if len(parsed) != 1 or "," in code:
            raise MarketError("一次只查询一个标的估值", code="market_codes", status=400)
        def load(key, deadline):
            meta = self._resolve(parsed[0], key, deadline)
            data = self._get("/api/a-share/valuations/snapshot", {"thscodes": meta["thscode"]}, key, deadline)
            rows = [row for row in data["item"] if isinstance(row, dict) and row.get("thscode") == meta["thscode"]]
            return {"code": meta["thscode"][:6], "thscode": meta["thscode"], "name": meta.get("name"),
                    "timestamp": _timestamp(data.get("timestamp")), "items": rows,
                    "warnings": ["估值保留TTM/MRQ及负值/null；指标数据时间不等于逐笔行情时间，不直接构成高低估结论。"]}
        return self._domain_cached(("valuation", parsed[0]), 300, load)

    def fundamentals(self, code: str) -> dict:
        parsed = self._parse(code)
        if len(parsed) != 1 or "," in code:
            raise MarketError("一次只查询一个标的财报", code="market_codes", status=400)
        def load(key, deadline):
            meta = self._resolve(parsed[0], key, deadline)
            result = {"code": meta["thscode"][:6], "thscode": meta["thscode"], "name": meta.get("name"),
                      "available": False, "warnings": ["仅最近2期年度合并报表，金额为原币元；报告期/披露日期与行情时间不同，未披露值不补零。"]}
            for section, endpoint in (("income", "income-statements"), ("balance", "balance-sheets"), ("cashflow", "cash-flow-statements")):
                try:
                    data = self._get("/api/a-share/financials/"+endpoint, {
                        "thscode": meta["thscode"], "period": "annual", "limit": 2}, key, deadline)
                    rows = [row for row in data["item"] if isinstance(row, dict) and row.get("thscode") == meta["thscode"]]
                    result[section] = {"available": bool(rows), "data": {"timestamp": _timestamp(data.get("timestamp")), "items": rows},
                                       **({} if rows else {"error": "该报表暂无披露数据"})}
                    result["available"] = result["available"] or bool(rows)
                except MarketError as exc:
                    result[section] = {"available": False, "error": str(exc), "code": exc.code}
            return result
        return self._domain_cached(("fundamentals", parsed[0]), 3600, load)

    _API_PREFIXES = {"a-share", "a-share-index", "meta", "news", "fund", "futures",
                     "options", "hk-share", "index", "calendar", "market"}
    _API_CATALOG = (
        {"path": "/api/a-share/prices/snapshot", "description": "A股最新行情快照（thscodes 批量或分页）"},
        {"path": "/api/a-share/prices/historical", "description": "A股历史K线（thscode/interval/adjust/start/end）"},
        {"path": "/api/a-share/financials/income-statements", "description": "合并利润表"},
        {"path": "/api/a-share/financials/balance-sheets", "description": "合并资产负债表"},
        {"path": "/api/a-share/financials/cash-flow-statements", "description": "合并现金流量表"},
        {"path": "/api/a-share/valuations/snapshot", "description": "估值快照"},
        {"path": "/api/a-share/special-data/limit-up-pool", "description": "涨停股票池（date_ms/page/size）"},
        {"path": "/api/a-share/special-data/limit-down-pool", "description": "跌停股票池（date_ms/page/size）"},
        {"path": "/api/a-share/special-data/limit-break-pool", "description": "炸板股票池（date_ms/page/size）"},
        {"path": "/api/a-share/special-data/limit-up-ladder", "description": "近30个交易日连板天梯"},
        {"path": "/api/a-share/special-data/limit-up-statistics", "description": "涨停强度与连板统计"},
        {"path": "/api/a-share/special-data/hot-stock-list", "description": "A股热股榜"},
        {"path": "/api/a-share/special-data/dragon-tiger-list", "description": "龙虎榜"},
        {"path": "/api/a-share/special-data/auction-snapshot", "description": "集合竞价快照"},
        {"path": "/api/a-share/capital-flow/snapshot", "description": "主力资金快照"},
        {"path": "/api/a-share-index/catalog/ths-index-list", "description": "同花顺指数目录"},
        {"path": "/api/a-share-index/prices/snapshot", "description": "板块/指数行情快照"},
        {"path": "/api/a-share-index/prices/historical", "description": "板块/指数历史K线"},
        {"path": "/api/a-share-index/constituents/ths-stock-list", "description": "指数成分股"},
        {"path": "/api/meta/tickers/search", "description": "标的检索"},
        {"path": "/api/news/stock/timeline-list", "description": "个股分时新闻"},
        {"path": "/api/news/flash/list", "description": "快讯"},
        {"path": "/api/news/notice/detail", "description": "公告详情与解读"},
    )

    @classmethod
    def api_catalog(cls) -> tuple[dict, ...]:
        return cls._API_CATALOG

    @classmethod
    def _validate_api_request(cls, path: str, params: dict | None) -> dict:
        if not isinstance(path, str) or len(path) > 300 or not path.startswith("/api/"):
            raise MarketError("接口路径必须以 /api/ 开头", code="market_path", status=400)
        if ".." in path or "//" in path or any(ch in path for ch in "?#\\ \t\r\n"):
            raise MarketError("接口路径无效", code="market_path", status=400)
        parts = path.split("/")
        if len(parts) < 3 or parts[1] != "api" or parts[2] not in cls._API_PREFIXES:
            raise MarketError("该接口类别未开放", code="market_path", status=403)
        params = {} if params is None else params
        if not isinstance(params, dict) or len(params) > 30:
            raise MarketError("params 必须是最多30个键的对象", code="market_params", status=400)
        clean = {}
        for key, value in params.items():
            if not isinstance(key, str) or not key or len(key) > 64:
                raise MarketError("参数名无效", code="market_params", status=400)
            if value is None:
                continue
            if isinstance(value, bool) or isinstance(value, int):
                clean[key] = value
            elif isinstance(value, float):
                if not math.isfinite(value):
                    raise MarketError("参数值无效", code="market_params", status=400)
                clean[key] = value
            elif isinstance(value, str) and len(value) <= 500:
                clean[key] = value
            else:
                raise MarketError("参数值只支持字符串、数字或布尔", code="market_params", status=400)
        if len(json.dumps(clean, ensure_ascii=False)) > 4000:
            raise MarketError("参数过多或过长", code="market_params", status=400)
        return clean

    @staticmethod
    def _bound_api_data(value, depth: int = 0):
        """Bound what reaches a model while preserving real field names."""
        if depth > 8:
            return None
        if isinstance(value, dict):
            items = list(value.items())[:80]
            return {str(k): MarketService._bound_api_data(v, depth + 1) for k, v in items}
        if isinstance(value, list):
            return [MarketService._bound_api_data(v, depth + 1) for v in value[:30]]
        if isinstance(value, str):
            return value[:4000]
        if isinstance(value, float) and not math.isfinite(value):
            return None
        return value if isinstance(value, (int, float, bool)) or value is None else str(value)[:4000]

    def call_api(self, path: str, params: dict | None = None) -> dict:
        """Generic read-only access to the provider's documented GET API."""
        clean = self._validate_api_request(path, params)
        deadline = time.monotonic() + self.TOTAL_TIMEOUT
        if not self._lock.acquire(timeout=self.TOTAL_TIMEOUT):
            raise MarketError("等待行情查询超时", code="market_timeout", status=504)
        try:
            if self._closed:
                raise MarketError("行情服务已关闭", code="market_closed", status=503)
            key = self._credentials()
            if not key:
                raise MarketError("未配置同花顺 Financial-API 行情凭据", code="market_not_configured", status=503)
            data = self._get(path, clean, key, deadline, require_rows=False)
            bounded = self._bound_api_data(data)
            truncated = json.dumps(data, ensure_ascii=False, default=str) != json.dumps(
                bounded, ensure_ascii=False, default=str)
            return {"available": True, "source": SOURCE, "path": path, "params": clean,
                    "data": bounded, "truncated": truncated,
                    "warnings": ["同花顺原始接口只读数据；截断时以返回数组前30条为限。",
                                 "业务字段口径以接口文档为准，不推断未返回字段。"]}
        finally:
            self._lock.release()

    def news(self, code: str, limit: int = 10) -> dict:
        parsed = self._parse(code)
        if len(parsed) != 1 or "," in code:
            raise MarketError("一次只查询一个标的新闻", code="market_codes", status=400)
        limit = max(1, min(20, int(limit)))
        def load(key, deadline):
            meta = self._resolve(parsed[0], key, deadline)
            data = self._get("/api/news/stock/timeline-list",
                             {"thscode": meta["thscode"], "offset": "first", "size": limit}, key, deadline)
            items = []
            for row in (data.get("items") or []):
                if not isinstance(row, dict):
                    continue
                items.append({
                    "id": row.get("id"), "title": row.get("title"),
                    "source": row.get("source"), "summary": row.get("summary"),
                    "publish_time_ms": row.get("publish_time_ms"),
                    "url": row.get("jump_url"),
                })
            return {"code": meta["thscode"][:6], "thscode": meta["thscode"], "name": meta.get("name"),
                    "timestamp": _timestamp(data.get("timestamp")), "items": items,
                    "source": SOURCE + " 个股分时新闻",
                    "warnings": ["新闻为第三方内容，仅作证据，不构成投资建议；发布时间与行情时间不同步。"]}
        return self._domain_cached(("news", parsed[0], limit), 60, load)

    def close(self) -> None:
        with self._lock:
            if not self._closed:
                self._closed = True
                self._cache.clear()
                self._metadata.clear()
                self._client.close()
