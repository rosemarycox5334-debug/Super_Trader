"""自选股服务：增删查（上限 200）+ 批量研判（量化 + 专家共识，走 job）。"""
from __future__ import annotations

from types import SimpleNamespace

from .db import Database, now_iso
from .experts import ExpertError, ExpertService
from .jobs import JobHandle, JobManager
from .quant import QuantEngine, QuantError

MAX_WATCHLIST = 200


class WatchlistError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class WatchlistService:
    def __init__(self, db: Database, engine: QuantEngine, experts: ExpertService,
                 jobs: JobManager, market=None, *, review_provider=None):
        self.db = db
        self.engine = engine
        self.experts = experts
        self.jobs = jobs
        self.market = market
        self.review_provider = review_provider

    def list(self) -> list[dict]:
        rows = self.db.query("SELECT * FROM watchlist ORDER BY added_at ASC")
        return [{"code": r["symbol_code"], "category": r["symbol_category"],
                 "name": r["name"], "added_at": r["added_at"]} for r in rows]

    def count(self) -> int:
        r = self.db.query_one("SELECT COUNT(*) AS c FROM watchlist")
        return int(r["c"]) if r else 0

    def add(self, code: str, category: str | None, actor: str = "user") -> dict:
        try:
            info = self.engine.resolve_symbol(code, category)
        except QuantError as exc:
            if self.market is None or exc.status not in (404, 503):
                raise
            # Watching a verified market symbol does not imply local fitting data
            # exists; batch analysis will still report the original quant error.
            if category in ("ETF", "LOF"):
                try:
                    info = SimpleNamespace(**self.market.fund_symbol(code))
                except Exception:
                    raise WatchlistError("未找到该上市基金（ETF/LOF），或当前行情服务不可用", status=404) from None
            elif category in (None, "个股"):
                info = SimpleNamespace(**self.market.symbol(code))
            else:
                raise
        exists = self.db.query_one(
            "SELECT 1 FROM watchlist WHERE symbol_code=? AND symbol_category=?",
            (info.code, info.category))
        if exists:
            return {"added": False, "reason": "已在自选", **self._entry(info)}
        if self.count() >= MAX_WATCHLIST:
            raise WatchlistError(f"自选股已达上限 {MAX_WATCHLIST} 只", status=409)
        self.db.execute(
            "INSERT INTO watchlist(symbol_code,symbol_category,name,added_at) VALUES(?,?,?,?)",
            (info.code, info.category, info.name, now_iso()))
        self.db.audit("watchlist.add", {"code": info.code, "category": info.category}, actor)
        return {"added": True, **self._entry(info)}

    def remove(self, code: str, category: str, actor: str = "user") -> None:
        self.db.execute(
            "DELETE FROM watchlist WHERE symbol_code=? AND symbol_category=?",
            (code, category))
        self.db.audit("watchlist.remove", {"code": code, "category": category}, actor)

    @staticmethod
    def _entry(info) -> dict:
        return {"code": info.code, "category": info.category, "name": info.name}

    # ------------------------------------------------------------------ 批量研判
    def submit_analyze(self, horizon: int, threshold: float = 0.6,
                       with_experts: bool = True) -> str:
        members = self.list()
        if not members:
            raise WatchlistError("自选股为空，无可研判标的")
        payload = {"horizon": horizon, "threshold": threshold,
                   "with_experts": with_experts, "symbols": members}
        return self.jobs.submit("watchlist_analyze", payload,
                                self._make_runner(members, horizon, threshold, with_experts),
                                total=len(members))

    def _make_runner(self, members: list[dict], horizon: int, threshold: float,
                     with_experts: bool):
        def runner(handle: JobHandle):
            results = []
            review_kwargs = {} if self.review_provider is None else {"review_provider": self.review_provider}
            for i, m in enumerate(members, 1):
                if handle.cancelled:
                    break
                row = {"code": m["code"], "category": m["category"], "name": m["name"]}
                try:
                    prob = self.engine.probability(m["code"], m["category"], horizon=horizon)
                    row["quant"] = {
                        "direction": prob.direction, "direction_label": prob.direction_label,
                        "probability": prob.probability, "baseline_up": prob.baseline_up,
                        "predictions": prob.sample["predictions"],
                    }
                except QuantError as exc:
                    row["quant"] = {"error": str(exc)}
                if with_experts:
                    try:
                        team = self.experts.team_analyze(
                            m["code"], m["category"], horizon, threshold=threshold,
                            persist=True, **review_kwargs)
                        row["consensus"] = team["consensus"]
                        row["votes"] = [
                            {"expert": v["expert"]["name"], "vote": v["vote"],
                             "confidence": v["confidence"], "abstained": v["abstained"],
                             "reason": v["reason"], "evidence": v["evidence"],
                             **({"history_comparison": v["history_comparison"]} if v.get("history_comparison") else {})}
                            for v in team["votes"]
                        ]
                        if team["errors"]:
                            row["expert_errors"] = team["errors"]
                    except ExpertError as exc:
                        row["expert_errors"] = [{"error": str(exc)}]
                results.append(row)
                handle.progress(i, {"items": results})
            return {"items": results, "horizon": horizon}
        return runner
