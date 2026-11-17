"""操盘记录与复盘：创建时冻结理由与信号快照，复盘用真实收盘价算结果。

诚实性：
* 创建时冻结 signal + reasons，之后不可改写（只允许改 note / closed）。
* 复盘收益用真实行情计算；没有成交价时只做方向复盘，不编造收益。
* 同时给「信号漂移」：现在的方向 vs 记录时的方向。
"""
from __future__ import annotations

import csv
import io
import uuid

from .db import Database, dumps, loads, now_iso
from .quant import QuantEngine, QuantError

_VALID_ACTIONS = {"buy", "sell", "watch", "short"}
_DIR_SIGN = {"buy": 1, "sell": -1, "short": -1, "watch": 0}


class JournalError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class JournalService:
    def __init__(self, db: Database, engine: QuantEngine):
        self.db = db
        self.engine = engine

    def create(self, data: dict, actor: str = "user") -> dict:
        code = data.get("code")
        category = data.get("category")
        action = (data.get("action") or "").lower()
        if action not in _VALID_ACTIONS:
            raise JournalError(f"action 必须是 {sorted(_VALID_ACTIONS)} 之一")
        info = self.engine.resolve_symbol(code, category)
        horizon = int(data.get("horizon") or 10)
        # 成交/进场日期：默认记录当天；允许回填历史日期以便对已走完的持有期做真实复盘。
        entry_date = data.get("entry_date")

        # 冻结信号快照：优先用调用方传入的 signal，否则现查一次量化概率。
        signal = data.get("signal")
        if not signal:
            try:
                prob = self.engine.probability(info.code, info.category, horizon=horizon)
                signal = {
                    "direction": prob.direction,
                    "direction_label": prob.direction_label,
                    "probability": prob.probability,
                    "baseline_up": prob.baseline_up,
                    "rules": [r["key"] for r in prob.rules],
                    "snapshot": (prob.sample.get("period") or [None])[-1],
                    "evaluation": prob.evaluation,
                }
            except QuantError as exc:
                signal = {"error": str(exc), "direction": 0}
        if entry_date:
            signal = {**signal, "entry_date": entry_date}

        reasons = data.get("reasons") or {"summary": data.get("note", ""), "votes": []}
        price = data.get("price")
        jid = f"J-{uuid.uuid4().hex[:12]}"
        created = now_iso()
        self.db.execute(
            """INSERT INTO journal(id,symbol_code,symbol_category,name,action,expert,horizon,
                                   signal,reasons,price,closed,note,created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (jid, info.code, info.category, info.name, action, data.get("expert", "团队"),
             horizon, dumps(signal), dumps(reasons),
             float(price) if price is not None else None, 0, data.get("note", ""), created),
        )
        self.db.audit("journal.create", {"id": jid, "code": info.code, "action": action}, actor)
        return self.get(jid)

    def _row(self, r) -> dict:
        return {
            "id": r["id"],
            "symbol": {"code": r["symbol_code"], "category": r["symbol_category"], "name": r["name"]},
            "action": r["action"], "expert": r["expert"], "horizon": r["horizon"],
            "signal": loads(r["signal"], {}), "reasons": loads(r["reasons"], {}),
            "price": r["price"], "closed": bool(r["closed"]), "note": r["note"],
            "created_at": r["created_at"],
        }

    def get(self, jid: str) -> dict:
        r = self.db.query_one("SELECT * FROM journal WHERE id=?", (jid,))
        if r is None:
            raise JournalError(f"记录不存在: {jid}", status=404)
        return self._row(r)

    def list(self, expert: str | None = None, closed: bool | None = None) -> list[dict]:
        sql = "SELECT * FROM journal"
        clauses, params = [], []
        if expert:
            clauses.append("expert=?"); params.append(expert)
        if closed is not None:
            clauses.append("closed=?"); params.append(1 if closed else 0)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY created_at DESC"
        return [self._row(r) for r in self.db.query(sql, params)]

    def update_note(self, jid: str, note: str | None = None, closed: bool | None = None,
                    price: float | None = None, actor: str = "user") -> dict:
        self.get(jid)  # 存在性校验
        fields, params = [], []
        if note is not None:
            fields.append("note=?"); params.append(note)
        if closed is not None:
            fields.append("closed=?"); params.append(1 if closed else 0)
        if price is not None:
            # 允许补填成交价（创建时未填），但不改信号/理由快照
            fields.append("price=?"); params.append(float(price))
        if fields:
            params.append(jid)
            self.db.execute(f"UPDATE journal SET {', '.join(fields)} WHERE id=?", params)
            self.db.audit("journal.update", {"id": jid, "closed": closed, "price": price}, actor)
        return self.get(jid)

    def delete(self, jid: str, actor: str = "user") -> None:
        self.get(jid)
        self.db.execute("DELETE FROM journal WHERE id=?", (jid,))
        self.db.audit("journal.delete", {"id": jid}, actor)

    # ------------------------------------------------------------------ 复盘
    def review(self, jid: str) -> dict:
        rec = self.get(jid)
        code = rec["symbol"]["code"]
        category = rec["symbol"]["category"]
        horizon = rec["horizon"] or 10
        signal = rec["signal"] or {}
        rec_dir = int(signal.get("direction") or _DIR_SIGN.get(rec["action"], 0))
        # 进场日优先用冻结快照里的 entry_date（可回填历史），否则用记录创建日。
        from_date = signal.get("entry_date") or rec["created_at"][:10]

        review: dict = {"id": jid, "horizon": horizon, "recorded_direction": rec_dir}

        # 信号漂移：现在的方向 vs 记录时的方向
        try:
            now_prob = self.engine.probability(code, category, horizon=horizon)
            review["signal_drift"] = {
                "recorded_direction": rec_dir,
                "current_direction": now_prob.direction,
                "drifted": now_prob.direction != rec_dir,
                "current_probability": now_prob.probability,
            }
        except QuantError as exc:
            review["signal_drift"] = {"error": str(exc)}

        # 真实前向收益
        try:
            fp = self.engine.forward_price(code, category, from_date, horizon)
        except QuantError as exc:
            fp = {"available": False, "reason": str(exc)}

        entry_price = rec["price"]
        if not fp.get("available"):
            review["return"] = {
                "available": False,
                "reason": fp.get("reason", "行情尚不足"),
                "mode": "direction_only",
                "entry_price_filled": entry_price is not None,
            }
            return review

        # 用记录成交价优先；否则用记录日的收盘价
        base_price = entry_price if entry_price is not None else fp["entry_close"]
        exit_close = fp["exit_close"]
        raw_ret = exit_close / base_price - 1.0
        sign = 1 if rec_dir >= 0 else -1  # 做多/做空按方向取号；watch(0) 按做多口径展示
        directional_ret = raw_ret * (sign if rec_dir != 0 else 1)
        hit = None
        if rec_dir != 0:
            hit = (raw_ret > 0) == (rec_dir > 0)
        review["return"] = {
            "available": True,
            "entry_date": fp["entry_date"],
            "entry_price": base_price,
            "entry_price_source": "recorded" if entry_price is not None else "close_on_entry",
            "exit_date": fp["exit_date"],
            "exit_price": exit_close,
            "raw_return": round(raw_ret, 6),
            "forward_return": round(directional_ret, 6),
            "hit": hit,
            "mode": "full" if entry_price is not None else "close_based",
        }
        return review

    # ------------------------------------------------------------------ 导出
    def export_json(self, **filters) -> list[dict]:
        records = self.list(**filters)
        for r in records:
            r["review"] = self.review(r["id"])
        return records

    def export_csv(self, **filters) -> str:
        records = self.list(**filters)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", "code", "name", "category", "action", "expert", "horizon",
                    "recorded_direction", "recorded_probability", "price", "closed",
                    "created_at", "forward_return", "hit", "return_mode"])
        for r in records:
            rev = self.review(r["id"])
            ret = rev.get("return", {})
            sig = r["signal"] or {}
            w.writerow([
                r["id"], r["symbol"]["code"], r["symbol"]["name"], r["symbol"]["category"],
                r["action"], r["expert"], r["horizon"], sig.get("direction"),
                sig.get("probability"), r["price"], int(r["closed"]), r["created_at"],
                ret.get("forward_return"), ret.get("hit"), ret.get("mode"),
            ])
        return buf.getvalue()
