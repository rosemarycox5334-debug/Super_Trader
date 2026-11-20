"""FastAPI 应用：REST + SSE，托管前端 SPA。

所有计算走后端；前端只做展示。密钥只在服务端，/api/status 只暴露「是否配置」。
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .experts import ExpertError
from .factors.sandbox import SandboxError
from .factors.service import FactorError
from .journal import JournalError
from .market import MarketError, MarketService
from .plugins import PluginError
from .quant import QuantError
from .research import ResearchError
from .selection import SelectionError
from .services import Services
from .review import ReviewError
from .watchlist import WatchlistError

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = PROJECT_ROOT / "web" / "app"


# ------------------------------------------------------------------ 请求模型
class PluginCreate(BaseModel):
    name: str
    icon: str | None = None
    kind: str | None = "custom"
    permissions: list[str] | None = None
    config: dict | None = None
    enabled: bool | None = True


class PluginPatch(BaseModel):
    name: str | None = None
    icon: str | None = None
    enabled: bool | None = None
    order: int | None = None
    config: dict | None = None
    permissions: list[str] | None = None


class ReorderBody(BaseModel):
    order: list[str]


class ExpertBody(BaseModel):
    id: str | None = None
    name: str | None = None
    tag: str | None = None
    system_prompt: str | None = None
    criteria: list[str] | None = None
    tools: list[str] | None = None
    model: str | None = None
    temperature: float | None = None
    abstain_policy: str | None = None
    enabled: bool | None = None


class AnalyzeBody(BaseModel):
    code: str
    category: str | None = None
    horizon: int = 10


class TeamBody(BaseModel):
    code: str
    category: str | None = None
    horizon: int = 10
    threshold: float = 0.6
    require_unanimous: bool = False
    expert_ids: list[str] | None = None


class ResearchTeamBody(BaseModel):
    model_config = {"extra": "forbid"}
    kind: Literal["stock", "sector"]
    code: str
    expert_ids: list[str] | None = None


class SelectionBody(BaseModel):
    model_config = {"extra": "forbid"}
    scope: Literal["market", "watchlist", "sector"] = "market"
    sector: str | None = None
    expert_ids: list[str] | None = Field(None, min_length=1, max_length=20)
    brief: str = Field("", max_length=1000)
    limit_per_expert: int = Field(5, ge=1, le=10)


class FactorResearchBody(BaseModel):
    model_config = {"extra": "forbid"}
    scope: Literal["all", "targets"] = "all"
    targets: list[str] | None = None
    timeframe: Literal["1d"] = "1d"
    workers: int = Field(4, ge=1, le=8, strict=True, description="评测进程数（并行分片）1–8")
    max_trials: int = Field(5, ge=1, strict=True, description="新尝试规则数（评测次数），不设上限")
    max_model_calls: int | None = Field(None, ge=1, strict=True, description="可选兼容字段；不传表示模型调用不限")
    minutes: float | None = Field(None, gt=0, description="可选兼容字段；不传表示研究时间不限")
    brief: str = Field("", max_length=2000)


class CodeFactorBody(BaseModel):
    model_config = {"extra": "forbid"}
    code: str
    source: str = Field(..., min_length=1, max_length=20000)
    timeframe: Literal["1d"] = "1d"
    neutral_band: float = Field(0.0, ge=0, le=5)


class WatchAddBody(BaseModel):
    code: str
    category: str | None = None


class WatchAnalyzeBody(BaseModel):
    horizon: int = 10
    threshold: float = 0.6
    with_experts: bool = True


class JournalCreate(BaseModel):
    code: str
    category: str | None = None
    action: str
    expert: str | None = "团队"
    horizon: int | None = 10
    entry_date: str | None = None
    signal: dict | None = None
    reasons: dict | None = None
    price: float | None = None
    note: str | None = ""


class JournalPatch(BaseModel):
    note: str | None = None
    closed: bool | None = None
    price: float | None = None


class ChatBody(BaseModel):
    message: str


class MemoryAddBody(BaseModel):
    kind: str = "fact"
    text: str
    scope: str = "agent"
    subject: str | None = None
    importance: float = 1.0


_FACTOR_WARNINGS = [
    "全样本回测，未做样本外验证；历史频率不是未来概率。",
    "同一时间框架内 h=1..20 共用同一条规则、一个方向；中性窗口不计入分母。",
]


def _factor_service(svc):
    service = getattr(svc, "factors", None)
    if service is None:
        raise FactorError("因子服务未启用", 503)
    return service


def _factor_direction(factors, code: str, timeframe: str, rule: dict) -> int:
    from .factors.dsl import evaluate_spec

    frame = factors.bars(code, timeframe)
    scores = evaluate_spec(rule["spec"], frame, validate=False)
    if not len(scores):
        return 0
    from .factors.targets import direction_from_scores
    directions = direction_from_scores(scores, rule.get("neutral_band", 0.0))
    return int(directions[-1]) if len(directions) else 0


def _factor_payload(identity: dict, timeframe: str, rule: dict, metrics: dict,
                    direction: int, rules: list | None = None,
                    samples: dict | None = None) -> dict:
    metrics = dict(metrics)
    baseline = dict(metrics.get("baseline") or {})
    # 前端契约：always_up = 全窗口单边基准，same_set = 与规则相同的评估集基准。
    # 服务层的 always_up 实际是在评估集上算的，这里映射回契约语义。
    if "same_set" not in baseline:
        baseline["same_set"] = baseline.get("always_up")
    if baseline.get("all_window_up_rate") is not None:
        baseline["always_up"] = baseline["all_window_up_rate"]
    if "all_window_down_rate" in baseline:
        baseline["same_set_down"] = baseline.get("always_down")
        baseline["always_down"] = baseline["all_window_down_rate"]
    metrics["baseline"] = baseline
    confusion = dict(metrics.get("confusion") or {})
    # Engine keys describe predicted rows; the public/UI contract uses up/down.
    metrics["confusion"] = {
        "up": dict(confusion.get("up") or confusion.get("pred_up") or {}),
        "down": dict(confusion.get("down") or confusion.get("pred_down") or {}),
    }
    payload = {
        "kind": "factor",
        "target": {"code": identity["code"], "name": identity.get("name") or identity["code"],
                   "category": identity.get("category") or "个股",
                   "target_id": (identity.get("category") or "个股") + ":" + identity["code"],
                   "timeframe": timeframe},
        "as_of": metrics.get("as_of"),
        "bars": metrics.get("bars"),
        "direction": direction,
        "rule": {"id": rule["id"], "name": rule["name"],
                 "kind": rule.get("kind", "seed"), "neutral_band": rule.get("neutral_band", 0)},
        "source": "seed_reference" if rule.get("kind", "seed") == "seed" else "code_ad_hoc",
        "metrics": metrics,
        "rules": rules or [],
        "warnings": list(_FACTOR_WARNINGS) + (["当前为种子规则参考，不是已完成的LLM挖掘成果；请到批量挖掘启动自主研究。"] if rule.get("kind", "seed") == "seed" else []),
    }
    if samples is not None:
        payload["samples"] = samples
    return payload


def create_app(services: Services | None = None) -> FastAPI:
    from contextlib import asynccontextmanager
    from fastapi.concurrency import run_in_threadpool

    svc = services or Services()

    @asynccontextmanager
    async def lifespan(app):
        if services is None:
            svc.start_review_maintenance()
        try:
            yield
        finally:
            if services is None:
                await run_in_threadpool(svc.close)

    app = FastAPI(title="Super Agent 投研工作台", version="1.0", lifespan=lifespan)
    app.state.services = svc

    @app.middleware("http")
    async def reject_cross_site_writes(request: Request, call_next):
        # Loopback alone does not stop a malicious webpage from starting paid jobs.
        if request.method not in ("GET", "HEAD"):
            from urllib.parse import urlsplit
            from fastapi.responses import JSONResponse
            origin = request.headers.get("origin")
            blocked = request.headers.get("sec-fetch-site") == "cross-site"
            if origin:
                try:
                    parsed = urlsplit(origin)
                    blocked = blocked or parsed.scheme not in ("http", "https") or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
                except ValueError:
                    blocked = True
            if blocked:
                return JSONResponse(status_code=403, content={"error": "拒绝跨站写入或启动付费研究；请使用本机应用或受信任的同源代理。"})
        return await call_next(request)

    # -------------------------------------------------------------- 异常翻译
    @app.exception_handler(PluginError)
    @app.exception_handler(QuantError)
    @app.exception_handler(ExpertError)
    @app.exception_handler(WatchlistError)
    @app.exception_handler(JournalError)
    @app.exception_handler(ResearchError)
    @app.exception_handler(SelectionError)
    @app.exception_handler(FactorError)
    @app.exception_handler(SandboxError)
    async def _domain_error(_request: Request, exc):  # noqa: ANN001
        return PlainResponseError(exc)

    def PlainResponseError(exc):  # noqa: N802
        from fastapi.responses import JSONResponse
        status = getattr(exc, "status", 400)
        return JSONResponse(status_code=status, content={"error": str(exc)})

    @app.exception_handler(MarketError)
    async def _market_error(_request: Request, exc: MarketError):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=exc.status, content=exc.as_dict())

    # -------------------------------------------------------------- 只读行情（不依赖量化/模型密钥）
    @app.get("/api/market/status")
    def market_status():
        market = getattr(svc, "market", None)
        return market.status() if market is not None else MarketService.unavailable_status()

    @app.get("/api/market/quotes")
    def market_quotes(codes: str = ""):
        market = getattr(svc, "market", None)
        if market is None:
            raise MarketError("行情服务未启用", code="market_not_configured", status=503)
        return market.quotes(codes)

    @app.get("/api/market/history")
    def market_history(code: str, limit: int = Query(120, ge=5, le=180),
                       adjust: str = "forward"):
        market = getattr(svc, "market", None)
        if market is None:
            raise MarketError("行情服务未启用", code="market_not_configured", status=503)
        return market.history(code, limit, adjust)

    @app.get("/api/market/search")
    def market_search(q: str, limit: int = Query(20, ge=1, le=50)):
        return svc.market.search_symbols(q, limit)

    @app.get("/api/market/sectors")
    def market_sectors(tag: str = "industry", q: str = "",
                       offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100)):
        return svc.market.sector_catalog(tag, q, offset, limit)

    # -------------------------------------------------------------- 人类投资流程
    @app.get("/api/research/screen")
    def research_screen_moved():
        raise ResearchError("选股已改为专家自主研究。请显式POST /api/research/select选择专家；不再用本地量化候选作为选股入口。", status=410)

    @app.get("/api/research/quant-screen")
    def research_quant_screen(style: str = "trend", scope: str = "market", sector: str | None = None,
                              limit: int = Query(30, ge=1, le=50)):
        return svc.research.screen(style, scope, sector, limit)

    @app.post("/api/research/select")
    def research_select(body: SelectionBody):
        return {"job": svc.selection.submit(**body.model_dump())}

    @app.get("/api/research/stock")
    def research_stock(code: str, category: str | None = None):
        return svc.research.stock_report(code, category) if category else svc.research.stock_report(code)

    @app.get("/api/research/sector")
    def research_sector(thscode: str):
        return svc.research.sector_report(thscode)

    @app.post("/api/research/team")
    def research_team(body: ResearchTeamBody):
        return {"job": svc.research.submit_team(body.kind, body.code, body.expert_ids)}

    # -------------------------------------------------------------- 量化因子预测
    @app.get("/api/factors/universe")
    def factor_universe():
        return svc.factor_research.universe()

    @app.post("/api/factors/research")
    def factor_research_start(body: FactorResearchBody):
        return {"job": svc.factor_research.submit(**body.model_dump())}

    @app.get("/api/factors/results")
    def factor_research_results(job_id: str | None = None, offset: int = Query(0, ge=0),
                                limit: int = Query(50, ge=1, le=200), q: str = ""):
        return svc.factor_research.results(job_id=job_id, offset=offset, limit=limit, q=q)

    @app.get("/api/factors/research/{job_id}/transcript")
    def factor_research_transcript(job_id: str, after: int = Query(0, ge=0),
                                   limit: int = Query(200, ge=1, le=500)):
        return svc.factor_research.transcript(job_id, after, limit)

    @app.get("/api/factors/stock")
    def factor_stock(code: str, timeframe: str = "1d",
                     category: Literal["个股", "ETF", "指数"] = "个股"):
        factors = _factor_service(svc)
        provider = getattr(svc, "factor_research", None)
        if provider is not None:
            report = provider.current_report(code, timeframe, category)
            if report is not None:
                return report
        if category != "个股":
            raise FactorError("该类别尚无已挖掘规则；请先运行批量挖掘，不使用同号个股代替。", 404)
        identity = factors.symbol(code)
        results = factors.evaluate_seeds(code, timeframe)
        if not results:
            raise FactorError("没有可用的种子规则", 503)
        best = results[0]
        rule, metrics = best["rule"], dict(best["metrics"])
        rules = [{"id": row["rule"]["id"], "name": row["rule"]["name"],
                  "accuracy": row["metrics"]["accuracy"],
                  "coverage": row["metrics"]["coverage"]} for row in results[:10]]
        return _factor_payload(identity, timeframe, rule, metrics,
                               _factor_direction(factors, code, timeframe, rule), rules)

    @app.get("/api/factors/library")
    def factor_library(offset: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
        return svc.factor_research.library(offset=offset, limit=limit)

    @app.get("/api/factors/rules")
    def factor_rules():
        from .factors.seed_pool import discovery_rules

        items = [{"id": rule["id"], "name": rule["name"]} for rule in discovery_rules()]
        if getattr(svc, "factor_research", None) is not None:
            items += [dict(row) for row in svc.db.query("SELECT id,name FROM factor_research_rules ORDER BY created_at DESC,id LIMIT 2000")]
        return {"items": items, "total": len(items)}

    @app.get("/api/factors/backtest")
    def factor_backtest(code: str, rule_id: str | None = None, timeframe: str = "1d",
                        category: Literal["个股", "ETF", "指数"] = "个股"):
        factors = _factor_service(svc)
        provider = getattr(svc, "factor_research", None)
        if provider is not None:
            if rule_id and provider.rule(rule_id) is not None:
                return provider.evaluate_saved(code, rule_id, timeframe, category)
            if not rule_id:
                report = provider.current_report(code, timeframe, category)
                if report is not None:
                    return report
        if category != "个股":
            raise FactorError("该类别尚无匹配挖掘成果；不以同号个股代替。", 404)
        identity = factors.symbol(code)
        rule = factors.rule_by_id(rule_id) if rule_id else None
        if rule_id and rule is None:
            raise FactorError("规则不存在", 404)
        if rule is None:
            results = factors.evaluate_seeds(code, timeframe)
            if not results:
                raise FactorError("没有可用的种子规则", 503)
            rule = results[0]["rule"]
        detail = factors.evaluate_detail(code, rule["spec"], timeframe,
                                        rule.get("neutral_band", 0.0))
        return _factor_payload(identity, timeframe, rule, dict(detail["metrics"]),
                               _factor_direction(factors, code, timeframe, rule),
                               samples=detail.get("samples"))

    @app.post("/api/factors/code")
    def factor_code(body: CodeFactorBody):
        factors = _factor_service(svc)
        identity = factors.symbol(body.code)
        metrics = factors.evaluate_code(body.code, body.source, body.timeframe,
                                        body.neutral_band)
        samples = {
            side: factors.samples_code(body.code, body.source, body.timeframe, side, 5,
                                      neutral_band=body.neutral_band)
            for side in ("false_positive", "false_negative")
        }
        rule = {"id": "code:" + metrics["source_sha256"][:12],
                "kind": "code", "neutral_band": body.neutral_band,
                "name": "模型自写代码",
                "source_sha256": metrics["source_sha256"]}
        direction = int(metrics.get("direction_now", 0) or 0)
        payload = _factor_payload(identity, body.timeframe, rule, metrics, direction,
                                  samples=samples)
        payload["source_sha256"] = metrics["source_sha256"]
        payload["lookahead_checked"] = metrics.get("lookahead_checked", [])
        return payload

    # -------------------------------------------------------------- 状态
    @app.get("/api/status")
    def status():
        return {
            "ok": True,
            "model": svc.settings.model.public_status(),
            "grid": svc.engine.grid_meta,
            "plugins_enabled": len(svc.plugins.list(enabled_only=True)),
            "capabilities": {
                **getattr(svc.engine, "capabilities", {}),
                "backend_ready": True,
                "market_configured": bool(getattr(svc, "market", None) and svc.market.status()["configured"]),
                "model_configured": bool(svc.settings.model.public_status().get("configured")),
            },
        }

    @app.get("/api/audit")
    def audit(limit: int = 100):
        return {"items": svc.db.audit_log(limit)}

    # -------------------------------------------------------------- 搜索
    @app.get("/api/symbols/search")
    def search(q: str = "", limit: int = 20):
        return {"items": svc.engine.search(q, limit)}

    # -------------------------------------------------------------- 插件
    @app.get("/api/plugins")
    def list_plugins(enabled_only: bool = False):
        return {"items": svc.plugins.list(enabled_only=enabled_only)}

    @app.post("/api/plugins")
    def create_plugin(body: PluginCreate):
        return svc.plugins.create(body.model_dump(exclude_none=True))

    @app.get("/api/plugins/{plugin_id}")
    def get_plugin(plugin_id: str):
        return svc.plugins.get(plugin_id)

    @app.patch("/api/plugins/{plugin_id}")
    def patch_plugin(plugin_id: str, body: PluginPatch):
        return svc.plugins.update(plugin_id, body.model_dump(exclude_none=True))

    @app.delete("/api/plugins/{plugin_id}")
    def delete_plugin(plugin_id: str):
        svc.plugins.delete(plugin_id)
        return {"deleted": plugin_id}

    @app.post("/api/plugins/reorder")
    def reorder_plugins(body: ReorderBody):
        return {"items": svc.plugins.reorder(body.order)}

    # -------------------------------------------------------------- 量化
    @app.get("/api/quant/probability")
    def probability(code: str, category: str | None = None, horizon: int | None = None,
                    date: str | None = None, recompute: bool = False):
        res = svc.engine.probability(code, category, horizon=horizon, target_date=date,
                                     recompute=recompute)
        return res.as_dict()

    # -------------------------------------------------------------- 专家
    @app.get("/api/experts")
    def list_experts(enabled_only: bool = False):
        return {"items": svc.experts.list(enabled_only=enabled_only)}

    @app.post("/api/experts")
    def upsert_expert(body: ExpertBody):
        return svc.experts.upsert(body.model_dump(exclude_none=True))

    @app.get("/api/experts/{expert_id}")
    def get_expert(expert_id: str):
        return svc.experts.get(expert_id)

    @app.delete("/api/experts/{expert_id}")
    def delete_expert(expert_id: str):
        return svc.experts.delete(expert_id)

    @app.post("/api/experts/{expert_id}/analyze")
    def analyze_expert(expert_id: str, body: AnalyzeBody):
        return svc.experts.analyze(expert_id, body.code, body.category, body.horizon)

    @app.post("/api/experts/team/analyze")
    def team_analyze(body: TeamBody):
        return svc.experts.team_analyze(
            body.code, body.category, body.horizon, threshold=body.threshold,
            require_unanimous=body.require_unanimous, expert_ids=body.expert_ids)

    @app.get("/api/analyses")
    def analyses(code: str | None = None, limit: int = 50):
        return {"items": svc.experts.recent_analyses(code, limit)}

    # -------------------------------------------------------------- 自选
    @app.get("/api/portfolios")
    def list_expert_portfolios():
        return svc.portfolio.dashboard()

    @app.get("/api/reviews")
    def list_reviews():
        svc.review.sync(limit=8)
        return {"items": svc.review.list(), "pending_archive": svc.review.pending_count()}

    @app.post("/api/reviews/sync")
    def sync_reviews():
        return svc.review.sync()

    @app.delete("/api/reviews/{review_id}")
    def delete_review(review_id: str):
        try:
            return svc.review.delete(review_id)
        except ReviewError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from None

    @app.post("/api/reviews/{review_id}/judge")
    def judge_review(review_id: str, body: dict | None = None):
        try:
            body = body or {}
            codes = body.get("codes")
            plan_ids = body.get("plan_ids")
            for name, values in (("codes", codes), ("plan_ids", plan_ids)):
                if name in body and (not isinstance(values, list) or not values or len(values) > 200
                                     or any(not isinstance(value, str) or not value or len(value) > 160 for value in values)):
                    raise ReviewError(f"{name} 须为非空字符串数组（最多 200 项）")
            return svc.review.judge(review_id, codes=codes, force=body.get("force") is True, plan_ids=plan_ids)
        except ReviewError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from None

    @app.get("/api/reviews/{review_id}")
    def get_review(review_id: str):
        try:
            return svc.review.get(review_id)
        except ReviewError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from None

    @app.get("/api/watchlist")
    def list_watchlist():
        return {"items": svc.watchlist.list(), "max": 200}

    @app.post("/api/watchlist")
    def add_watchlist(body: WatchAddBody):
        return svc.watchlist.add(body.code, body.category)

    @app.delete("/api/watchlist")
    def remove_watchlist(code: str, category: str):
        svc.watchlist.remove(code, category)
        return {"removed": {"code": code, "category": category}}

    @app.post("/api/watchlist/analyze")
    def analyze_watchlist(body: WatchAnalyzeBody):
        job_id = svc.watchlist.submit_analyze(body.horizon, body.threshold, body.with_experts)
        return {"job": svc.jobs.get(job_id)}

    # -------------------------------------------------------------- Jobs
    @app.get("/api/jobs")
    def list_jobs(limit: int = 50):
        return {"items": svc.jobs.list(limit)}

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        job = svc.jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job 不存在")
        return job

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: str):
        ok = svc.jobs.cancel(job_id)
        return {"cancelled": ok, "job": svc.jobs.get(job_id)}

    @app.get("/api/jobs/{job_id}/stream")
    async def stream_job(job_id: str):
        async def gen():
            last = None
            while True:
                job = svc.jobs.get(job_id)
                if job is None:
                    yield _sse({"error": "job 不存在"})
                    return
                snapshot = (job["status"], job["progress"], job["total"])
                if snapshot != last:
                    yield _sse(job)
                    last = snapshot
                if job["status"] in ("done", "error", "cancelled", "interrupted"):
                    return
                await asyncio.sleep(0.4)
        return StreamingResponse(gen(), media_type="text/event-stream")

    # -------------------------------------------------------------- 操盘记录
    @app.get("/api/journal")
    def list_journal(expert: str | None = None, closed: bool | None = None):
        return {"items": svc.journal.list(expert=expert, closed=closed)}

    @app.post("/api/journal")
    def create_journal(body: JournalCreate):
        return svc.journal.create(body.model_dump(exclude_none=True))

    @app.get("/api/journal/export")
    def export_journal(fmt: str = "json", expert: str | None = None):
        filters = {k: v for k, v in {"expert": expert}.items() if v is not None}
        if fmt == "csv":
            return PlainTextResponse(svc.journal.export_csv(**filters),
                                     media_type="text/csv")
        return {"items": svc.journal.export_json(**filters)}

    @app.get("/api/journal/{jid}")
    def get_journal(jid: str):
        return svc.journal.get(jid)

    @app.patch("/api/journal/{jid}")
    def patch_journal(jid: str, body: JournalPatch):
        return svc.journal.update_note(jid, note=body.note, closed=body.closed,
                                       price=body.price)

    @app.delete("/api/journal/{jid}")
    def delete_journal(jid: str):
        svc.journal.delete(jid)
        return {"deleted": jid}

    @app.get("/api/journal/{jid}/review")
    def review_journal(jid: str):
        return svc.journal.review(jid)

    # -------------------------------------------------------------- Super Agent
    @app.post("/api/agent/chat")
    def agent_chat(body: ChatBody):
        return svc.agent.chat(body.message)

    @app.post("/api/agent/chat/stream")
    async def agent_chat_stream(body: ChatBody):
        # agent.chat_stream 是同步生成器（内含阻塞的模型流/工具调用），
        # 放到线程里逐事件取出，经队列转交给异步 SSE，避免阻塞事件循环。
        import queue
        import threading

        q: "queue.Queue" = queue.Queue(maxsize=256)
        SENTINEL = object()

        def produce():
            try:
                for ev in svc.agent.chat_stream(body.message):
                    q.put(ev)
            except Exception as exc:  # noqa: BLE001  流式异常也要让前端收到
                q.put({"type": "error", "error": str(exc)})
            finally:
                q.put(SENTINEL)

        threading.Thread(target=produce, daemon=True).start()

        async def gen():
            loop = asyncio.get_event_loop()
            while True:
                ev = await loop.run_in_executor(None, q.get)
                if ev is SENTINEL:
                    return
                yield _sse(ev)

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache",
                                          "X-Accel-Buffering": "no"})

    # -------------------------------------------------------------- 记忆
    @app.get("/api/memory")
    def list_memory(scope: str = "agent", include_retired: bool = False, limit: int = 200):
        return {"items": svc.memory.list(scope=scope, include_retired=include_retired, limit=limit),
                "stats": svc.memory.stats(scope)}

    @app.post("/api/memory")
    def add_memory(body: MemoryAddBody):
        node = svc.memory.add(body.kind, body.text, scope=body.scope,
                              subject=body.subject, importance=body.importance)
        if node is None:
            raise HTTPException(status_code=400, detail="文本过短或无意义，未记录")
        return node

    @app.get("/api/memory/stats")
    def memory_stats(scope: str = "agent"):
        return svc.memory.stats(scope)

    @app.get("/api/memory/recall")
    def recall_memory(q: str, scope: str = "agent", limit: int = 20):
        return {"items": svc.memory.recall(q, scope=scope, limit=limit)}

    @app.delete("/api/memory/{node_id}")
    def delete_memory(node_id: str):
        svc.memory.delete(node_id)
        return {"deleted": node_id}

    @app.post("/api/memory/clear")
    def clear_memory(scope: str = "agent"):
        n = svc.memory.clear(scope)
        return {"cleared": n, "scope": scope}

    # -------------------------------------------------------------- 前端
    if WEB_DIR.exists():
        app.mount("/assets", StaticFiles(directory=str(WEB_DIR / "assets")), name="assets")

        @app.get("/")
        def index():
            idx = WEB_DIR / "index.html"
            if idx.exists():
                return FileResponse(str(idx))
            raise HTTPException(status_code=404, detail="前端未构建")

    return app


def _sse(obj) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False, default=str)}\n\n"
