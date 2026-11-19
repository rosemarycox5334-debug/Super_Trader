"""Bounded, read-only research: selection -> observed trend -> frozen model team.

No synthetic prices, no market-wide fitting and no implicit stock/index substitution.
Quant windows are cached grid observations, not calibrated future probabilities.
"""
from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
import math
import re
import threading
import time
from types import SimpleNamespace

from .db import now_iso
from .experts import ExpertError, _research_bundle
from .etf_evidence import etf_sections
from .quant import QuantEngine

HORIZONS = (5, 10, 20)
MIN_SAMPLES = 80
MIN_COVERAGE = 0.10
SECTOR_SAMPLE_LIMIT = 50
_CODE = re.compile(r"^[0-9]{6}(?:\.(?:SH|SZ|BJ))?$")
_SECTOR = re.compile(r"^[0-9]{6}\.[A-Z][A-Z0-9]{1,7}$")
# Listed fund vehicles share the exchange-traded fund data path.
_FUND_CATEGORIES = ("ETF", "LOF")


class ResearchError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _number(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


def _unavailable(message):
    return {"available": False, "error": message}


def _capture(fn, label):
    """Provider exception strings may contain credentials: never forward them."""
    try:
        data = fn()
        if not isinstance(data, dict):
            return _unavailable(f"{label}响应格式无效")
        if data.get("available") is False:
            return _unavailable(f"{label}暂无可用数据")
        if "items" in data:
            if not isinstance(data["items"], list) or any(not isinstance(x, dict) for x in data["items"]):
                return _unavailable(f"{label}响应格式无效")
            if not data["items"]:
                return _unavailable(f"{label}暂无可用数据")
        return {"available": True, "data": data}
    except Exception:
        return _unavailable(f"{label}暂不可用")


def _trend(history):
    if not history.get("available"):
        return _unavailable("真实日线不可用，无法描述趋势")
    try:
        # Dates must be unique and ordered; no missing OHLC is filled or invented.
        rows = history["data"].get("items", [])
        if not isinstance(rows, list):
            raise ValueError()
        by_date = {}
        for bar in rows:
            if not isinstance(bar, dict) or type(bar.get("date_ms")) is not int:
                raise ValueError()
            stamp = bar["date_ms"]
            if stamp in by_date:
                raise ValueError()
            by_date[stamp] = bar
        bars = [by_date[k] for k in sorted(by_date)]
        if len(bars) < 20:
            return _unavailable("真实日线少于20根，趋势样本不足")
        closes = [_number(b.get("close_price")) for b in bars]
        if any(c is None or c <= 0 for c in closes):
            raise ValueError()
        lows = [_number(b.get("low_price")) for b in bars[-20:]]
        highs = [_number(b.get("high_price")) for b in bars[-20:]]
        if any(v is None or v <= 0 for v in lows + highs):
            raise ValueError()
        for b in bars[-20:]:
            o, h, l, c = (_number(b.get(k)) for k in
                          ("open_price", "high_price", "low_price", "close_price"))
            if o is None or o <= 0 or not l <= min(o, c) <= max(o, c) <= h:
                raise ValueError()
        ma5 = sum(closes[-5:]) / 5
        ma20 = sum(closes[-20:]) / 20
        ma60 = sum(closes[-60:]) / 60 if len(closes) >= 60 else None
        def ema(values, period):
            alpha = 2.0 / (period + 1.0)
            out = [float(values[0])]
            for value in values[1:]:
                out.append(alpha * float(value) + (1.0 - alpha) * out[-1])
            return out
        macd = {"available": False, "error": "真实日线少于35根，无法计算MACD"}
        if len(closes) >= 35:
            ema12, ema26 = ema(closes, 12), ema(closes, 26)
            dif = [a - b for a, b in zip(ema12, ema26)]
            dea = ema(dif, 9)
            hist = [2.0 * (a - b) for a, b in zip(dif, dea)]
            series = [{"date_ms": bars[i]["date_ms"], "dif": dif[i], "dea": dea[i], "hist": hist[i]}
                      for i in range(len(bars))]
            macd = {"available": True, "dif": dif[-1], "dea": dea[-1],
                    "hist": hist[-1], "series": series,
                    "basis": "EMA12-EMA26=DIF；DIF的EMA9=DEA；柱=2*(DIF-DEA)"}
        last = closes[-1]
        bias = "up" if last > ma5 > ma20 else "down" if last < ma5 < ma20 else "range"
        volumes = [_number(b.get("volume")) for b in bars[-6:]]
        volume_ratio = None
        if len(volumes) == 6 and all(v is not None and v >= 0 for v in volumes):
            base = sum(volumes[:-1]) / 5
            if base > 0:
                volume_ratio = volumes[-1] / base
        return {"available": True, "data": {
            "bias": bias, "ma5": ma5, "ma20": ma20, "ma60": ma60,
            "return_5d_pct": (last / closes[-6] - 1) * 100,
            "return_20d_pct": (last / closes[-21] - 1) * 100 if len(closes) >= 21 else None,
            "support_20d": min(lows), "resistance_20d": max(highs),
            "volume_ratio": volume_ratio, "as_of": bars[-1]["date_ms"],
            "bars": len(bars), "description": "真实历史价量观测，不是未来价格轨迹",
            "volume_ratio_basis": "最新一根成交量/前5根平均成交量", "macd": macd,
        }}
    except (KeyError, TypeError, ValueError, ArithmeticError):
        return _unavailable("真实日线包含缺失或无效价量字段，无法计算趋势")


def _median(values):
    nums = sorted(v for v in values if v is not None)
    if not nums:
        return None
    mid = len(nums) // 2
    return nums[mid] if len(nums) % 2 else (nums[mid - 1] + nums[mid]) / 2


class ResearchService:
    CACHE_TTL = 30
    CACHE_MAX = 128

    def __init__(self, engine, market, experts, jobs, watchlist, factor_provider=None, *, review_provider=None):
        self.factor_provider = factor_provider
        self.review_provider = review_provider
        self.engine = engine
        self.market = market
        self.experts = experts
        self.jobs = jobs
        self.watchlist = watchlist
        self._cache = OrderedDict()
        self._cache_lock = threading.RLock()
        self._team_lock = threading.RLock()
        self._active_teams = {}

    @staticmethod
    def _stock_code(code):
        if not isinstance(code, str) or not _CODE.fullmatch(code.strip().upper()):
            raise ResearchError("个股代码必须为六位数字，可附.SH/.SZ/.BJ")
        return code.strip().upper()

    @staticmethod
    def _sector_code(code):
        if not isinstance(code, str) or not _SECTOR.fullmatch(code.strip().upper()):
            raise ResearchError("板块必须使用完整thscode，例如881101.TI")
        return code.strip().upper()

    def _grid(self):
        try:
            self.engine._load_grid()
            grid = self.engine._grid
            if not isinstance(grid, dict):
                raise ValueError()
            meta = self.engine.grid_meta
            return grid, meta if isinstance(meta, dict) else {}
        except Exception:
            raise ResearchError("本地量化网格不可用；未触发逐股重算", status=503) from None

    def _cached(self, key, build):
        # Coalesce concurrent misses, bound cache, and never expose mutable cache data.
        with self._cache_lock:
            now = time.monotonic()
            cached = self._cache.get(key)
            if cached and now - cached[0] < self.CACHE_TTL:
                self._cache.move_to_end(key)
                return deepcopy(cached[1])
            value = build()
            self._cache[key] = (time.monotonic(), deepcopy(value))
            self._cache.move_to_end(key)
            while len(self._cache) > self.CACHE_MAX:
                self._cache.popitem(last=False)
            return value

    def _quant(self, code, category, name, entry=None):
        try:
            grid, meta = self._grid()
            if entry is None:
                entry = grid.get((code, category))
            as_of = (entry or {}).get("as_of") or (entry or {}).get("snapshot") or meta.get("snapshot")
            rows = (entry or {}).get("rows") or []
        except ResearchError:
            rows, meta, as_of = [], {}, None
        items = []
        for horizon in HORIZONS:
            item = {"horizon": horizon, "available": False}
            try:
                raw = rows[horizon - 1] if horizon <= len(rows) else None
                if raw is None:
                    raise ValueError()
                if not isinstance(raw, (list, tuple)) or len(raw) != 5:
                    raise ValueError()
                if any(_number(x) is None for x in raw):
                    raise ValueError()
                prob, samples, direction, baseline, coverage = raw
                if direction not in (-1, 0, 1) or not 0 <= prob <= 1000 or not 0 <= baseline <= 1000:
                    raise ValueError()
                if samples < MIN_SAMPLES or not MIN_COVERAGE * 1000 <= coverage <= 1000:
                    item["error"] = "本地网格样本量或覆盖率不足"
                    items.append(item)
                    continue
                row = QuantEngine._row_from_grid(self.engine, raw)
                # Supplying empty rules avoids _assemble's optional expensive fullfit
                # enrichment. Do not claim the grid contains rule-level evidence.
                row["rules"] = []
                row["period"] = [as_of] if as_of else []
                info = SimpleNamespace(code=code, category=category, name=name)
                result = QuantEngine._assemble(self.engine, info, horizon, None, row, "grid", False).as_dict()
                result["warnings"].append("网格未存规则细节；研究接口不为补规则执行全历史重算")
                item.update(available=True, result=result, as_of=as_of)
            except Exception:
                item["error"] = "本地网格没有该窗口的有效数据；未自动重算"
            items.append(item)
        directions = [i["result"]["direction"] for i in items if i["available"]]
        agreement = ("unavailable" if not directions else "mixed" if 1 in directions and -1 in directions
                     else "bullish" if 1 in directions else "bearish" if -1 in directions else "neutral")
        return {"available": bool(directions), "as_of": as_of, "items": items,
                "legacy": True, "source": "legacy_quant_grid",
                "warnings": ["旧量化网格，不是新版LLM同规则h1–h20因子成果，不得混称最新因子准确率。"],
                "identity": {"kind": "stock", "code": code} if category == "个股" else None,
                "agreement": agreement, **({"error": "本地量化网格无可用窗口"} if not directions else {})}

    def factor_evidence(self, code, category="个股"):
        """Read only verified current persisted LLM results; never start mining.

        The provider owns data-version validation/re-evaluation. No seed/grid is
        substituted when it has no matching result, even if legacy quant exists.
        """
        bare = self._stock_code(code)[:6]
        if category not in ("个股", "ETF"):
            return _unavailable("该资产类别尚无可验证的因子成果")
        if self.factor_provider is None:
            return _unavailable("未接入新版因子成果提供者；未以旧网格或种子规则替代LLM成果")
        try:
            report = self.factor_provider.current_report(bare, timeframe="1d", category=category)
            if not isinstance(report, dict):
                return _unavailable("该标的暂无当前数据版本的已验证LLM因子成果；未启动模型挖掘")
            target, rule = report.get("target", {}), report.get("rule", {})
            if (report.get("kind") != "factor" or report.get("source") != "llm_batch"
                    or report.get("status") != "completed" or not report.get("data_version")
                    or not report.get("as_of") or not isinstance(target, dict)
                    or target.get("code") != bare or target.get("category") != category
                    or target.get("timeframe") != "1d" or target.get("target_id") != f"{category}:{bare}"
                    or not isinstance(rule, dict) or rule.get("kind") != "code" or not rule.get("id")
                    or not isinstance(report.get("metrics"), dict)):
                return _unavailable("因子成果身份、来源或当前有效状态未通过核验；未使用替代网格")
            data = deepcopy(report)
            warnings = []
            context = None
            reader = getattr(self.factor_provider, "selection_context", None)
            if callable(reader):
                try:
                    context = reader(bare, timeframe="1d", category=category)
                except Exception:
                    context = None
            if isinstance(context, dict):
                data["selection"] = context
                floor = context.get("coverage_floor")
                best = context.get("best_accuracy")
                qualified = context.get("qualified")
                if type(best) in (int, float) and type(qualified) is int:
                    warnings.append(
                        f"该规则是本标的达到覆盖率下限（{floor:.0%}）的{qualified}个候选中全样本准确率最高者；"
                        f"最高准确率{best:.2%}{'，不高于随机水平，不能视为有效方向边际' if best <= 0.5 else ''}。")
            return {"available": True, "data": data, "source": "llm_batch",
                    "as_of": report["as_of"], "warnings": warnings}
        except Exception:
            return _unavailable("当前LLM因子成果暂不可用；未回退旧网格、未发起模型调用")

    def stock_report(self, code, category: str | None = None):
        code = self._stock_code(code)
        if category not in (None, "个股", *_FUND_CATEGORIES):
            raise ResearchError("category只支持个股或上市基金（ETF/LOF）", status=400)
        report = self._cached(("stock", code, category or "auto"),
                              lambda: self._stock_report(code, category))
        # Market observations may be cached, but newly persisted/invalidated
        # factor results must not inherit the market cache's availability.
        factor = self.factor_evidence(code, report["target"].get("category", "个股"))
        accuracy = _number(factor.get("data", {}).get("metrics", {}).get("accuracy"))
        if factor.get("available") and (accuracy is None or accuracy <= 0.55):
            factor = {"available": False, "excluded": True}
            report["quant"] = {"available": False, "excluded": True, "agreement": "unavailable"}
        report["factor"] = factor
        return report

    def _stock_report(self, code, requested_category: str | None = None):
        bare = code[:6]
        warnings = ["量化为内样本历史频率，不是校准的未来概率；行情与量化截至日可能不同。",
                    "趋势仅描述真实OHLC，不生成未来K线；MA60不足60根时为null。"]
        target = {"code": bare, "name": bare, "category": requested_category or "个股",
                  "thscode": code if "." in code else None}
        category = requested_category or "个股"
        stock_identity = fund_identity = None
        stock_error = fund_error = None

        if requested_category not in _FUND_CATEGORIES:
            try:
                stock_identity = self.market.symbol(code)
                if stock_identity.get("category") != "个股" or stock_identity.get("code") != bare:
                    raise ResearchError("标的不是已核实的A股个股", status=404)
                if "." in code and stock_identity.get("thscode") != code:
                    raise ResearchError("标的交易所与请求不一致", status=404)
            except ResearchError:
                raise
            except Exception as exc:
                stock_error = exc

        if requested_category != "个股":
            try:
                fund_identity = self.market.fund_symbol(code)
                if fund_identity.get("category") not in _FUND_CATEGORIES or fund_identity.get("code") != bare:
                    fund_identity = None
                elif "." in code and fund_identity.get("thscode") != code:
                    fund_identity = None
            except Exception as exc:
                fund_error = exc

        if stock_identity and fund_identity:
            raise ResearchError("该代码同时匹配A股个股和上市基金，请从搜索结果选择资产类别", status=409)
        if stock_identity:
            category = "个股"
            target.update({k: stock_identity.get(k, target[k]) for k in target})
        elif fund_identity:
            category = fund_identity["category"]
            target.update({"category": category, **{k: fund_identity.get(k, target[k]) for k in target}})
            warnings.append(f"{category} 使用场内基金行情与前复权日线；与 A 股个股口径不同。")
        else:
            warnings.append("行情标的目录暂不可用；只按六位代码及本地网格检索，不替代为同号指数。")
            try:
                matches = [row for row in self.engine.search(bare) if row.get("code") == bare]
                if len(matches) == 1:
                    category = matches[0].get("category") or category
                    target["name"] = matches[0].get("name") or bare
                    target["category"] = category
            except Exception:
                try:
                    grid, _ = self._grid()
                    candidates = ((requested_category,) if requested_category in _FUND_CATEGORIES
                                  else ("个股", "ETF", "LOF") if not requested_category
                                  else ("个股",))
                    for candidate in candidates:
                        entry = grid.get((bare, candidate)) or {}
                        if entry:
                            category = candidate
                            target["name"] = entry.get("name") or bare
                            target["category"] = candidate
                            break
                except ResearchError:
                    pass
        if requested_category and category != requested_category:
            raise ResearchError(f"该代码不是{requested_category}，请检查资产类别", status=404)
        etf_extra = {}
        if category in _FUND_CATEGORIES:
            quote = _capture(lambda: self.market.fund_snapshot(code), "基金最新行情") if callable(getattr(self.market, "fund_snapshot", None)) else _unavailable("未接入基金行情")
            history = _capture(lambda: self.market.fund_history(code, limit=120), "基金真实日线") if callable(getattr(self.market, "fund_history", None)) else _unavailable("未接入基金日线")
            try:
                datasets = self.market.fund_research(code)
            except Exception:
                datasets = {}
            etf_extra = etf_sections(datasets, quote, history)
            fundamentals, valuation, news = (etf_extra[key] for key in ("fundamentals", "valuation", "news"))
        else:
            quote = _capture(lambda: self.market.quotes(code), "最新行情")
            history = _capture(lambda: self.market.history(code, limit=120, adjust="forward"), "真实日线")
            if callable(getattr(self.market, "company_financials", None)):
                fundamentals = _capture(lambda: self.market.company_financials(code, period="quarterly", limit=5), "已披露财务报表")
            else:
                fundamentals = (_capture(lambda: self.market.fundamentals(code), "财务报表")
                                if callable(getattr(self.market, "fundamentals", None)) else _unavailable("未接入财务报表"))
            valuation = (_capture(lambda: self.market.valuation(code), "估值")
                         if callable(getattr(self.market, "valuation", None)) else _unavailable("未接入估值"))
            news = (_capture(lambda: self.market.news(code, limit=10), "个股新闻")
                    if callable(getattr(self.market, "news", None)) else _unavailable("未接入新闻数据源"))
            if fundamentals.get("available"):
                warnings.append("财报按其报告期/披露日解读；不等同于行情快照时间，不推断未提供的ROE或行业增长。")
            if news.get("available"):
                warnings.append("新闻为第三方内容，仅作证据；发布时间与行情时间不同步，不得据此编造事实。")
        return {"kind": "stock", "target": target, "quote": quote, "history": history,
                "trend": _trend(history), "quant": self._quant(bare, category, target["name"]),
                "fundamentals": fundamentals, "valuation": valuation,
                "news": news, "warnings": warnings, "created_at": now_iso(), **etf_extra}

    def sector_report(self, thscode):
        thscode = self._sector_code(thscode)
        return self._cached(("sector", thscode), lambda: self._sector_report(thscode))

    def _sector_report(self, thscode):
        quote = _capture(lambda: self.market.sector_snapshot(thscode), "板块行情")
        history = _capture(lambda: self.market.sector_history(thscode, limit=120), "板块真实日线")
        constituents = _capture(lambda: self.market.sector_constituents(thscode, offset=0, limit=SECTOR_SAMPLE_LIMIT), "板块成分")
        name = thscode
        if quote.get("available"):
            name = (quote["data"].get("items") or [{}])[0].get("name") or thscode
        target = {"code": thscode, "thscode": thscode, "name": name, "category": "板块"}
        # Require exact complete identity. A same-number stock (or an unverified
        # same-number index) is never a substitute for a sector.
        matched = None
        local_code = thscode
        try:
            grid, _ = self._grid()
            for (candidate, category), entry in grid.items():
                if category == "指数" and (candidate == thscode or entry.get("thscode") == thscode):
                    local_code, matched = candidate, entry
                    break
        except ResearchError:
            pass
        quant = self._quant(local_code, "指数", name, matched) if matched is not None else {
            "available": False, "as_of": None, "items": [
                {"horizon": h, **_unavailable("板块没有完整thscode匹配的本地指数网格")} for h in HORIZONS],
            "agreement": "unavailable", "error": "板块无已核实的本地指数匹配；不使用同号股票"}
        if matched is not None:
            quant["identity"] = {"kind": "sector", "thscode": thscode}
        breadth = self._breadth(constituents)
        codes = []
        if constituents.get("available"):
            codes = [row.get("thscode") for row in constituents["data"].get("items", [])
                     if isinstance(row, dict) and row.get("thscode")]
        valuation = _unavailable("未接入板块估值")
        if codes and callable(getattr(self.market, "call_api", None)):
            try:
                payload = self.market.call_api("/api/a-share/valuations/snapshot",
                                               {"thscodes": ",".join(codes[:100])})
                rows = [row for row in (payload.get("data", {}).get("item") or [])
                        if isinstance(row, dict) and row.get("thscode") in codes]
                if rows:
                    fields = ("pe_ttm", "pe_mrq", "pb_mrq", "ps_ttm", "pcf_ttm")
                    valuation = {"available": True, "data": {
                        "sample_size": len(rows), "universe": len(codes),
                        "medians": {field: _median([_number(row.get(field)) for row in rows]) for field in fields},
                        "positive_counts": {field: sum(1 for row in rows if (_number(row.get(field)) or 0) > 0) for field in fields},
                        "items": deepcopy(rows[:30]),
                        "as_of": payload.get("data", {}).get("timestamp"),
                        "description": "板块成分股估值快照聚合；只代表样本成分，不是板块整体估值。"}}
                else:
                    valuation = _unavailable("板块成分估值快照暂无数据")
            except Exception:
                valuation = _unavailable("板块成分估值暂不可用")
        warnings = [f"板块广度仅为首{SECTOR_SAMPLE_LIMIT}个成分的有限样本，不代表全板块；不逐股重算量化。",
                    "价量趋势是历史观测；量化频率为内样本，行情与量化可能有不同截至日。"]
        news = (_capture(lambda: self.market.news(thscode, limit=8), "板块新闻")
                if callable(getattr(self.market, "news", None)) else _unavailable("未接入新闻数据源"))
        return {"kind": "sector", "target": target, "quote": quote, "history": history,
                "trend": _trend(history), "quant": quant, "constituents": constituents,
                "breadth": breadth, "fundamentals": _unavailable("板块不提供个股财报"),
                "valuation": valuation, "news": news,
                "warnings": warnings, "created_at": now_iso()}

    def _breadth(self, constituents):
        if not constituents.get("available"):
            return _unavailable("板块成分不可用，无法计算样本广度")
        data = constituents["data"]
        members = data.get("items", [])[:SECTOR_SAMPLE_LIMIT]
        codes = list(dict.fromkeys(m.get("thscode") or m.get("code") for m in members
                                   if isinstance(m, dict) and m.get("category") == "个股"
                                   and _CODE.fullmatch(str(m.get("thscode") or m.get("code") or ""))))
        if not codes:
            return _unavailable("没有可核实的样本成分股")
        quotes = _capture(lambda: self.market.quotes(",".join(codes)), "成分样本行情")
        if not quotes.get("available"):
            return quotes
        index = {}
        for q in quotes["data"].get("items", []):
            identity = q.get("thscode") or q.get("code")
            if identity:
                index[identity] = q
        up = down = flat = missing = 0
        for code in codes:
            q = index.get(code) or (index.get(code[:6]) if "." in code else None)
            change = _number((q or {}).get("price_change_ratio_pct"))
            if change is None:
                missing += 1
            elif change > 0:
                up += 1
            elif change < 0:
                down += 1
            else:
                flat += 1
        return {"available": True, "data": {"sample_size": len(codes),
                "total_constituents": data.get("total"), "up": up, "down": down, "flat": flat,
                "missing": missing, "sample_limit": SECTOR_SAMPLE_LIMIT, "sample_only": True,
                "timestamp": quotes["data"].get("timestamp")}}

    def screen(self, style="trend", scope="market", sector=None, limit=30):
        if style not in ("trend", "watch"):
            raise ResearchError("style必须为trend或watch")
        if scope not in ("market", "watchlist", "sector"):
            raise ResearchError("scope必须为market/watchlist/sector")
        if type(limit) is not int or not 1 <= limit <= 50:
            raise ResearchError("limit必须为1..50的整数")
        grid, meta = self._grid()
        warnings = ["仅筛选本地预算网格，不对全市场逐股拟合；未入网格不代表无机会。",
                    f"方向信号须样本量>={MIN_SAMPLES}且覆盖率>={MIN_COVERAGE:.0%}；频率不等于未来概率。"]
        allowed = None
        coverage = {"grid_stock_count": sum(1 for _, cat in grid if cat == "个股")}
        if scope == "watchlist":
            try:
                members = self.watchlist.list()
                allowed = {m["code"] for m in members if m.get("category") == "个股"}
                coverage.update(scope_members=len(allowed), scope_limit=200)
            except Exception:
                raise ResearchError("自选池暂不可用", status=503) from None
        elif scope == "sector":
            sector = self._sector_code(sector)
            result = _capture(lambda: self.market.sector_constituents(sector, offset=0, limit=SECTOR_SAMPLE_LIMIT), "板块成分")
            if not result.get("available"):
                raise ResearchError("板块成分池暂不可用", status=503)
            data = result["data"]
            members = data.get("items", [])[:SECTOR_SAMPLE_LIMIT]
            allowed = {m.get("code") or str(m.get("thscode", ""))[:6] for m in members if m.get("category") == "个股"}
            coverage.update(scope_members=len(allowed), scope_total=data.get("total"), scope_limit=SECTOR_SAMPLE_LIMIT)
            warnings.append(f"板块范围仅首{SECTOR_SAMPLE_LIMIT}个成分与本地网格的交集，不是全板块筛选。")
        pool = [(code, entry) for (code, cat), entry in grid.items()
                if cat == "个股" and (allowed is None or code in allowed)]
        coverage["grid_pool_count"] = len(pool)
        if allowed is not None:
            coverage["missing_from_grid"] = len(allowed - {code for code, _ in pool})
        items = []
        excluded_risk = 0
        for code, entry in pool:
            historical_name = str(entry.get("name") or "").strip()
            if historical_name.upper().lstrip("*_ ").startswith("ST") or "退市" in historical_name or historical_name.endswith("退"):
                excluded_risk += 1
                continue
            signals = []
            rows = entry.get("rows") or []
            for h in HORIZONS:
                raw = rows[h - 1] if h <= len(rows) else None
                if not isinstance(raw, (list, tuple)) or len(raw) != 5 or any(_number(v) is None for v in raw):
                    continue
                p, n, d, baseline, cov = raw
                if d not in (-1, 0, 1) or not 0 <= p <= 1000 or not 0 <= baseline <= 1000:
                    continue
                if n < MIN_SAMPLES or not MIN_COVERAGE * 1000 <= cov <= 1000:
                    continue
                signals.append({"horizon": h, "direction": int(d), "probability": p / 1000 if d else None,
                                "samples": int(n), "coverage": cov / 1000})
            bullish = sum(s["direction"] == 1 for s in signals)
            bearish = sum(s["direction"] == -1 for s in signals)
            if (style == "trend" and bullish >= 2 and bearish == 0) or (style == "watch" and bullish >= 1):
                items.append({"code": code, "name": entry.get("name") or code, "category": "个股",
                              "signals": signals, "bullish_count": bullish, "bearish_count": bearish,
                              "reason": "多周期正向共振，无负向窗口" if style == "trend" else "存在正向窗口，仅作偏多观察，不是买入指令",
                              "as_of": entry.get("as_of") or entry.get("snapshot") or meta.get("snapshot")})
        coverage["excluded_risk_marked"] = excluded_risk
        warnings.append(f"已按历史名称排除{excluded_risk}只带ST/退市标识的股票；不是实时风险名单，研究前仍须核对最新状态。")
        items.sort(key=lambda x: (-x["bullish_count"], x["bearish_count"],
                                 -min(s["samples"] for s in x["signals"]), x["code"]))
        return {"items": items[:limit], "total_matched": len(items), "pool_count": len(pool),
                "scope": scope, "style": style, "sector": sector, "as_of": meta.get("snapshot"),
                "source": "本地量化网格", "coverage": coverage, "warnings": warnings}

    def submit_team(self, kind, code, expert_ids=None):
        if kind not in ("stock", "sector"):
            raise ResearchError("kind必须为stock或sector")
        code = self._stock_code(code) if kind == "stock" else self._sector_code(code)
        if expert_ids is not None and (not isinstance(expert_ids, list) or not expert_ids
                                      or any(not isinstance(e, str) or not e for e in expert_ids)):
            raise ResearchError("expert_ids必须为非空专家ID数组")
        if expert_ids is not None and len(set(expert_ids)) != len(expert_ids):
            raise ResearchError("expert_ids不得重复")
        try:
            experts = ([self.experts.get(e) for e in expert_ids] if expert_ids is not None
                       else self.experts.list(enabled_only=True))
        except ExpertError as exc:
            raise ResearchError("指定专家不存在", status=exc.status) from None
        if not experts or len(experts) > 20:
            raise ResearchError("研究团队必须包含1..20位专家")
        if any(not e.get("enabled") for e in experts):
            raise ResearchError("团队包含已停用专家")
        if not getattr(getattr(self.experts.model, "settings", None), "configured", False):
            raise ResearchError("未配置模型密钥，无法提交真实专家团队", status=503)
        ids = [e["id"] for e in experts]
        team_key = (kind, code, tuple(sorted(ids)))

        def runner(handle):
            try:
                started = time.monotonic()
                if handle.cancelled:
                    return None
                if not getattr(getattr(self.experts.model, "settings", None), "configured", False):
                    raise ResearchError("模型配置不可用，任务未调用专家", status=503)
                full = self.stock_report(code) if kind == "stock" else self.sector_report(code)
                report = _research_bundle(full)
                factor_view = deepcopy(full.get("factor") or {"available": False})
                if not factor_view.get("available"):
                    # Nothing verified: expose no reason text the session could quote back.
                    factor_view = {"available": False}
                votes, errors = [], []
                direction = (factor_view.get("data", {}).get("direction")
                             if factor_view.get("available") else None)
                agreement = {1: "bullish", -1: "bearish", 0: "neutral"}.get(direction, "unavailable")
                result = {"kind": kind, "target": report["target"], "report": report,
                          "factor_view": factor_view,
                          "final_synthesis": {
                              "input": "全部专家意见 + 量化因子",
                              "quant_visible_to_experts": False,
                              "note": "专家独立判断，未看到量化因子；因子只在本层汇总后参与最终判断。"},
                          "consensus": self.experts._consensus([], 0.6, False), "votes": votes,
                          "errors": errors, "created_at": now_iso()}
                # Keep auxiliary rows out of the shared/report evidence bundle.
                # Each expert sees only its own scoped, bounded historical context.
                review_kwargs = ({} if self.review_provider is None else
                                 {"review_provider": self.review_provider})
                for i, e in enumerate(experts, 1):
                    if handle.cancelled:
                        break
                    try:
                        if time.monotonic() - started >= 1800:
                            raise ExpertError("研究团队总预算已耗尽，未调用该专家", status=504)
                        vote = self.experts.analyze_research(e["id"], deepcopy(report),
                                                            persist=True, **review_kwargs)
                    except Exception as exc:
                        status = exc.status if isinstance(exc, ExpertError) else 502
                        error = {"expert": e["id"], "name": e["name"],
                                 "error": "专家模型研判失败，未生成有效意见", "status": status}
                        errors.append(error)
                        vote = {"expert": {"id": e["id"], "name": e["name"], "tag": e.get("tag", "")},
                                "vote": 0, "abstained": True, "confidence": "low", "reason": error["error"],
                                "evidence": [], "evidence_status": "unavailable", "error": error["error"],
                                "status": status, "trade_plan": None, "trade_plan_status": "missing",
                                "outlook": {}, "risks": []}
                    votes.append(vote)
                    result["consensus"] = self.experts._consensus(votes, 0.6, False)
                    result["consensus"].update(support_label="有效票支持比例，不是成功概率",
                                               disagreement=bool(result["consensus"]["up"] and result["consensus"]["down"]),
                                               quant_agreement=agreement,
                                               quant_source="factor" if factor_view.get("available") else "unavailable",
                                               quant_note="因子仅用于汇总阶段，未提供给专家")
                    handle.progress(i, deepcopy(result))
                if errors and len(errors) == len(experts) and not handle.cancelled:
                    raise ResearchError("所有专家模型调用失败；未产生团队意见", status=502)
                return result
            except ResearchError:
                raise
            except Exception:
                raise ResearchError("研究团队任务失败；未生成有效团队意见", status=502) from None

        try:
            with self._team_lock:
                # Clean terminal entries so the deduplication map stays bounded by
                # active work, not by all historical clicks.
                for key, existing_id in list(self._active_teams.items()):
                    existing = self.jobs.get(existing_id)
                    if not existing or existing.get("status") not in ("queued", "running"):
                        self._active_teams.pop(key, None)
                if team_key in self._active_teams:
                    return self.jobs.get(self._active_teams[team_key])
                job_id = self.jobs.submit("research_team", {"kind": kind, "code": code, "expert_ids": ids}, runner, total=len(ids))
                self._active_teams[team_key] = job_id
                return self.jobs.get(job_id)
        except Exception:
            raise ResearchError("无法提交专家团队任务", status=503) from None
