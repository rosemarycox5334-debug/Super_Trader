"""Archive expert selections and track how the picked stocks actually moved.

Only observed prices are used. A window with too few trading days is reported as
pending, never filled with a synthetic return. The equal-weight benchmark is the
average of the picked targets that have a real price on both ends.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import math
import uuid

from .db import now_iso

SHANGHAI = None  # set lazily to avoid importing zoneinfo at module import cost
WINDOWS = (1, 3, 5, 10, 20)
RANK_MIN_SAMPLES = 10
CONFIDENCE_ORDER = ("high", "medium", "low")


def _number(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


def _date_ms(bar):
    for key in ("date_ms", "nav_date"):
        value = bar.get(key)
        if type(value) is int:
            return value
    return None


class ReviewError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class ReviewService:
    def __init__(self, db, market, jobs):
        self.db = db
        self.market = market
        self.jobs = jobs
        self._table()

    def _table(self):
        self.db.execute("""CREATE TABLE IF NOT EXISTS selection_reviews(
            id TEXT PRIMARY KEY, job_id TEXT UNIQUE, created_at TEXT, archived_at TEXT,
            scope TEXT, sector TEXT, brief TEXT, expert_ids TEXT, targets TEXT,
            status TEXT, warnings TEXT)""")

    # ------------------------------------------------------------------ 归档
    def sync(self, limit: int = 10) -> dict:
        """Auto-archive finished expert-selection jobs that have no review yet."""
        rows = self.db.query(
            "SELECT id,status,finished_at,result FROM jobs WHERE type='expert_selection' "
            "AND status IN ('done','completed','succeeded') ORDER BY created_at DESC LIMIT ?", (limit,))
        created = []
        for row in rows:
            try:
                created.append(self.archive(row["id"]))
            except ReviewError:
                continue
            except Exception:
                continue
        return {"archived": [item for item in created if item], "total": self.count()}

    def count(self) -> int:
        row = self.db.query_one("SELECT COUNT(*) n FROM selection_reviews")
        return int(row["n"]) if row else 0

    def archive(self, job_id: str) -> dict:
        existing = self.db.query_one("SELECT id FROM selection_reviews WHERE job_id=?", (job_id,))
        if existing:
            return self.get(existing["id"], with_metrics=False)
        job = self.jobs.get(job_id) if self.jobs else None
        if not job or job.get("status") not in ("done", "completed", "succeeded"):
            raise ReviewError("只有已完成且成功的选股任务才能归档", status=409)
        result = job.get("result") or {}
        targets = self._merge_targets(result.get("expert_results") or [])
        if not targets:
            raise ReviewError("该次选股没有可归档的候选", status=409)
        entry_date = self._entry_date(job)
        for target in targets:
            target["entry"] = self._entry_price(target, entry_date)
        payload = {"payload": job.get("payload") or {}, "created_at": job.get("created_at"),
                   "finished_at": job.get("finished_at")}
        review_id = "R-" + uuid.uuid4().hex[:12]
        self.db.execute(
            "INSERT INTO selection_reviews VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (review_id, job_id, payload.get("created_at") or now_iso(), now_iso(),
             (job.get("payload") or {}).get("scope"), (job.get("payload") or {}).get("sector"),
             (job.get("payload") or {}).get("brief"),
             self._dump((job.get("payload") or {}).get("expert_ids") or []), self._dump(targets),
             "tracking", self._dump([
                 "只统计真实行情；未到观察期的窗口显示跟踪中，不提前下结论。",
                 "收益是价格变化，不含手续费/滑点，不是可实现收益。",
                 "对比基准为本次候选等权（仅统计两端都有真实价格的标的）。"])))
        return self.get(review_id, with_metrics=False)

    @staticmethod
    def _dump(value):
        import json
        return json.dumps(value, ensure_ascii=False)

    @staticmethod
    def _loads(value, default):
        import json
        try:
            return json.loads(value) if value else default
        except Exception:
            return default

    def _entry_date(self, job) -> str:
        stamp = job.get("finished_at") or job.get("created_at") or ""
        return str(stamp)[:10]

    def _history(self, code: str, category: str):
        """Return ascending [(date_ms, close)] for a stock/fund, or [] when unavailable."""
        rows = []
        if category in ("ETF", "LOF") or (self.market and callable(getattr(self.market, "fund_history", None)) and category == "ETF"):
            try:
                data = self.market.fund_history(code, limit=120)
                rows = data.get("items") or []
            except Exception:
                rows = []
            if not rows and category == "LOF":
                rows = self._nav_rows(code)
        else:
            try:
                data = self.market.history(code, limit=120, adjust="forward")
                rows = data.get("items") or []
            except Exception:
                rows = []
        bars = sorted((( _date_ms(row), _number(row.get("close_price", row.get("unit_nav"))) )
                       for row in rows if isinstance(row, dict)), key=lambda item: item[0] or 0)
        return [(date, close) for date, close in bars if date and close is not None and close > 0]

    def _nav_rows(self, code: str):
        try:
            data = self.market.fund_research(code)
            nav = (data.get("nav") or {}).get("data", {}).get("items") or []
            return nav
        except Exception:
            return []

    def _entry_price(self, target: dict, entry_date: str):
        bars = self._history(target["code"], target.get("category") or "个股")
        if not bars:
            return {"date": entry_date, "price": None, "status": "unavailable",
                    "reason": "入选日前后没有可用的真实收盘价"}
        picked = None
        for date, close in bars:
            if self._day(date) <= entry_date:
                picked = (date, close)
        if picked is None:
            return {"date": entry_date, "price": None, "status": "pending",
                    "reason": "入选日之后才有行情，尚不能计算入选价"}
        return {"date": self._day(picked[0]), "price": picked[1], "status": "ok"}

    @staticmethod
    def _day(date_ms: int) -> str:
        return datetime.fromtimestamp(date_ms / 1000, tz=None).strftime("%Y-%m-%d")

    def _merge_targets(self, expert_results) -> list[dict]:
        merged = {}
        for row in expert_results:
            if not isinstance(row, dict):
                continue
            expert = (row.get("expert") or {}).get("id")
            for pick in row.get("picks") or []:
                if not isinstance(pick, dict):
                    continue
                code = str(pick.get("code") or "")
                if len(code) != 6 or not code.isdigit():
                    continue
                item = merged.setdefault(code, {"code": code, "name": pick.get("name") or code,
                                                "category": "个股", "experts": [], "confidence": "low",
                                                "reason": pick.get("reason") or "",
                                                "why_fit": pick.get("why_fit") or "",
                                                "entry_price": None, "entry_direction": None,
                                                "invalidation_price": None, "entry_note": ""})
                for field in ("entry_price", "entry_direction", "invalidation_price"):
                    if item.get(field) is None and pick.get(field) is not None:
                        item[field] = pick[field]
                if not item.get("entry_note") and pick.get("entry_note"):
                    item["entry_note"] = pick["entry_note"]
                if expert and expert not in item["experts"]:
                    item["experts"].append(expert)
                if CONFIDENCE_ORDER.index(pick.get("confidence") or "low") < CONFIDENCE_ORDER.index(item["confidence"]):
                    item["confidence"] = pick.get("confidence") or "low"
                if not item["reason"] and pick.get("reason"):
                    item["reason"] = pick["reason"]
        return list(merged.values())

    # ------------------------------------------------------------------ 读取
    def list(self) -> list[dict]:
        rows = self.db.query("SELECT * FROM selection_reviews ORDER BY archived_at DESC")
        return [self._summary(row) for row in rows]

    def get(self, review_id: str, with_metrics: bool = True) -> dict:
        row = self.db.query_one("SELECT * FROM selection_reviews WHERE id=?", (review_id,))
        if row is None:
            raise ReviewError("复盘记录不存在", status=404)
        review = self._summary(row)
        review["targets"] = self._loads(row["targets"], [])
        review["warnings"] = self._loads(row["warnings"], [])
        if not with_metrics:
            return review
        self._with_metrics(review)
        return review

    def _summary(self, row) -> dict:
        targets = self._loads(row["targets"], [])
        return {"id": row["id"], "job_id": row["job_id"], "scope": row["scope"],
                "sector": row["sector"], "brief": row["brief"],
                "expert_ids": self._loads(row["expert_ids"], []),
                "created_at": row["created_at"], "archived_at": row["archived_at"],
                "status": row["status"], "target_count": len(targets)}

    def _with_metrics(self, review: dict) -> None:
        targets = review.get("targets") or []
        for target in targets:
            target["metrics"] = self._metrics(target)
        review["benchmark"] = self._benchmark(targets)
        review["experts"] = self._experts(targets)
        review["confidence"] = self._confidence(targets)

    @staticmethod
    def _plan(target: dict) -> dict:
        return {"entry_price": _number(target.get("entry_price")),
                "entry_direction": target.get("entry_direction") if target.get("entry_direction") in ("above", "below") else None,
                "invalidation_price": _number(target.get("invalidation_price")),
                "entry_note": target.get("entry_note") or ""}

    def _metrics(self, target: dict) -> dict:
        """Triggered entries get returns from the trigger bar; untriggered picks get none."""
        bars = self._history(target["code"], target.get("category") or "个股")
        entry = target.get("entry") or {}
        if not bars:
            return {"status": "unavailable", "windows": {}, "current": None, "max_drawdown": None,
                    "reason": "没有可用的真实行情"}
        selection_day = entry.get("date")
        start = next((i for i, (date, _) in enumerate(bars) if self._day(date) >= selection_day), None)
        if start is None:
            return {"status": "pending", "windows": {}, "current": None, "max_drawdown": None,
                    "reason": "入选日之后还没有新的交易日"}
        plan = self._plan(target)
        later = list(range(start + 1, len(bars)))
        if plan["entry_price"] is None:
            base_index, status, trigger = start, "reference", None
        else:
            base_index, status, trigger = self._find_trigger(bars, start, later, plan)
        if base_index is None:
            waited = len(later)
            return {"status": status, "windows": {}, "current": None, "max_drawdown": None,
                    "trigger": trigger or plan, "days_waited": waited,
                    "reason": ("价格先触及失效价，按失效处理，不计收益" if status == "invalidated"
                               else "观察期内价格未达到触发条件，视为未入场，不计收益" if status == "not_triggered"
                               else "尚未积累足够的交易日判断是否触发")}
        base = bars[base_index][1]
        windows, pending = {}, []
        for window in WINDOWS:
            position = base_index + window
            if position < len(bars):
                windows[f"{window}d"] = round(bars[position][1] / base - 1, 6)
            else:
                windows[f"{window}d"] = None
                pending.append(window)
        peak, drawdown = base, 0.0
        for _, close in bars[base_index:]:
            peak = max(peak, close)
            drawdown = min(drawdown, close / peak - 1)
        return {"status": status, "windows": windows,
                "current": round(bars[-1][1] / base - 1, 6),
                "max_drawdown": round(drawdown, 6),
                "pending_windows": pending,
                "base_date": self._day(bars[base_index][0]), "base_price": base,
                "trigger": trigger, "days_waited": base_index - start,
                "bars_after_entry": len(bars) - base_index, "as_of": self._day(bars[-1][0])}

    @staticmethod
    def _find_trigger(bars, start: int, later, plan: dict):
        """Daily-close trigger check; invalidation wins ties, so untriggered picks stay unclaimed."""
        invalidation = plan.get("invalidation_price")
        for index in later:
            close = bars[index][1]
            if invalidation is not None and close <= invalidation:
                return None, "invalidated", {"date": ReviewService._day(bars[index][0]), "price": close,
                                             "event": "invalidation_price"}
            price = plan.get("entry_price")
            hit = close >= price if plan.get("entry_direction") == "above" else close <= price
            if hit:
                return index, "triggered", {"date": ReviewService._day(bars[index][0]), "price": close,
                                            "event": "entry_price", "direction": plan.get("entry_direction")}
        if len(later) >= WINDOWS[-1]:
            return None, "not_triggered", None
        return None, "pending", None

    def _benchmark(self, targets) -> dict:
        out = {}
        for window in WINDOWS:
            key = f"{window}d"
            values = [t.get("metrics", {}).get("windows", {}).get(key) for t in targets]
            available = [value for value in values if type(value) is float]
            out[key] = {"equal_weight": round(sum(available) / len(available), 6) if available else None,
                        "sample": len(available), "total": len(targets)}
        entered = sum(1 for t in targets if (t.get("metrics") or {}).get("status") in ("triggered", "reference"))
        return {"kind": "本次候选等权（仅统计已触发/参考口径）", "entered": entered,
                "total": len(targets), "windows": out}

    @staticmethod
    def _rate(bucket: dict):
        decisions = bucket["triggered"] + bucket["not_triggered"] + bucket["invalidated"]
        return round(bucket["triggered"] / decisions, 4) if decisions else None

    def _experts(self, targets) -> list[dict]:
        buckets = {}
        for target in targets:
            metrics = target.get("metrics") or {}
            status = metrics.get("status")
            for expert in target.get("experts") or []:
                bucket = buckets.setdefault(expert, {"expert": expert, "picks": 0, "triggered": 0,
                                                     "not_triggered": 0, "invalidated": 0,
                                                     "samples": 0, "wins": 0, "sum": 0.0})
                bucket["picks"] += 1
                if status in ("triggered", "reference"):
                    bucket["triggered"] += 1
                elif status == "not_triggered":
                    bucket["not_triggered"] += 1
                elif status == "invalidated":
                    bucket["invalidated"] += 1
                window = metrics.get("windows", {}).get("5d")
                if type(window) is float:
                    bucket["samples"] += 1
                    bucket["wins"] += 1 if window > 0 else 0
                    bucket["sum"] += window
        rows = []
        for bucket in buckets.values():
            rows.append({"expert": bucket["expert"], "picks": bucket["picks"],
                         "triggered": bucket["triggered"], "not_triggered": bucket["not_triggered"],
                         "invalidated": bucket["invalidated"], "trigger_rate": self._rate(bucket),
                         "samples": bucket["samples"],
                         "avg_return_5d": round(bucket["sum"] / bucket["samples"], 6) if bucket["samples"] else None,
                         "win_rate_5d": round(bucket["wins"] / bucket["samples"], 4) if bucket["samples"] else None,
                         "ranked": bucket["triggered"] >= RANK_MIN_SAMPLES})
        ranked = [row for row in rows if row["ranked"] and row["avg_return_5d"] is not None]
        ranked.sort(key=lambda row: row["avg_return_5d"], reverse=True)
        for position, row in enumerate(ranked, 1):
            row["rank"] = position
        return rows

    def _confidence(self, targets) -> list[dict]:
        buckets = {}
        for target in targets:
            level = target.get("confidence") or "low"
            metrics = target.get("metrics") or {}
            bucket = buckets.setdefault(level, {"confidence": level, "picks": 0, "triggered": 0,
                                                "not_triggered": 0, "invalidated": 0,
                                                "samples": 0, "wins": 0, "sum": 0.0})
            bucket["picks"] += 1
            status = metrics.get("status")
            if status in ("triggered", "reference"):
                bucket["triggered"] += 1
            elif status == "not_triggered":
                bucket["not_triggered"] += 1
            elif status == "invalidated":
                bucket["invalidated"] += 1
            window = metrics.get("windows", {}).get("5d")
            if type(window) is float:
                bucket["samples"] += 1
                bucket["wins"] += 1 if window > 0 else 0
                bucket["sum"] += window
        rows = []
        for level in CONFIDENCE_ORDER:
            bucket = buckets.get(level)
            if not bucket:
                continue
            rows.append({"confidence": level, "picks": bucket["picks"],
                         "trigger_rate": self._rate(bucket), "samples": bucket["samples"],
                         "avg_return_5d": round(bucket["sum"] / bucket["samples"], 6) if bucket["samples"] else None,
                         "win_rate_5d": round(bucket["wins"] / bucket["samples"], 4) if bucket["samples"] else None})
        return rows
