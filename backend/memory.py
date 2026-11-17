"""记忆服务：给 Super Agent 跨轮/跨会话记忆（借鉴 dsh-soul 的思路，用本项目栈实现）。

和 dsh-soul 的对应关系（简化、自洽版，不依赖 DSH 宿主）：
* 节点类型：constraint（约束/偏好）、decision（决策）、fact（事实）、progress（进度）。
* capture：每轮对话结束后用确定性规则从「用户消息 + 执行动作 + 回复」抽取记忆节点，
  按 subject 去重；同一 subject 的约束被新表述取代时，旧节点标记 retired（supersede）。
* project：下一轮对话前，在字节预算内挑最相关/最重要的节点，拼成一段注入 system prompt。
* recall：全文检索历史记忆与来源。
* prune：超容量时清理最旧的非活动记录（退役节点不直接删，保留可回捞）。

诚实性：抽取是规则驱动的，不改模型权重；记忆只是把过去对话的事实放回上下文，仍有 token 成本。
"""
from __future__ import annotations

import re
import uuid

from .db import Database, dumps, loads, now_iso

KINDS = ("constraint", "decision", "fact", "progress")

# 抽取规则：匹配到就生成对应类型的记忆节点。pattern 捕获组 1 作为正文主体。
_RULES: list[tuple[str, str]] = [
    # 约束 / 偏好（用户设定的长期要求）
    ("constraint", r"(?:以后|请?记住|默认|一律|务必|永远|总是|不要|别再|偏好|我喜欢|习惯用)\s*[:：]?\s*(.+)"),
    ("constraint", r"(?:我的|统一)(?:默认|偏好|习惯)\s*(?:是|为|设为)?\s*(.+)"),
    # 决策（这次定下来怎么做）
    ("decision", r"(?:决定|改成|就用|采用|选择|换成|设为|定为)\s*[:：]?\s*(.+)"),
    # 进度（做到哪了）
    ("progress", r"(?:已经?|完成了?|接下来|下一步|还需要|待办|TODO)\s*[:：]?\s*(.+)"),
]

# 停用：太短或纯指令词的，不值得记
_STOP = re.compile(r"^(?:嗯|好的?|谢谢|ok|行|是的?|对|嗯嗯)\W*$", re.I)


class MemoryService:
    def __init__(self, db: Database, max_nodes: int = 500):
        self.db = db
        self.max_nodes = max_nodes

    # ------------------------------------------------------------------ 读
    def _row(self, r) -> dict:
        return {
            "id": r["id"], "scope": r["scope"], "kind": r["kind"], "text": r["text"],
            "subject": r["subject"], "importance": r["importance"],
            "activations": r["activations"], "source": loads(r["source"], {}),
            "retired": bool(r["retired"]), "superseded_by": r["superseded_by"],
            "created_at": r["created_at"], "last_used_at": r["last_used_at"],
        }

    def list(self, scope: str = "default", include_retired: bool = False,
             limit: int = 200) -> list[dict]:
        sql = "SELECT * FROM memory_nodes WHERE scope=?"
        params: list = [scope]
        if not include_retired:
            sql += " AND retired=0"
        sql += " ORDER BY retired ASC, importance DESC, created_at DESC LIMIT ?"
        params.append(limit)
        return [self._row(r) for r in self.db.query(sql, params)]

    def stats(self, scope: str = "default") -> dict:
        rows = self.db.query(
            "SELECT kind, COUNT(*) AS c FROM memory_nodes WHERE scope=? AND retired=0 GROUP BY kind",
            (scope,))
        by_kind = {r["kind"]: int(r["c"]) for r in rows}
        total = self.db.query_one(
            "SELECT COUNT(*) AS c FROM memory_nodes WHERE scope=? AND retired=0", (scope,))
        retired = self.db.query_one(
            "SELECT COUNT(*) AS c FROM memory_nodes WHERE scope=? AND retired=1", (scope,))
        return {"scope": scope, "active": int(total["c"]) if total else 0,
                "retired": int(retired["c"]) if retired else 0,
                "by_kind": by_kind, "capacity": self.max_nodes}

    # ------------------------------------------------------------------ 写
    def add(self, kind: str, text: str, *, scope: str = "default", subject: str | None = None,
            importance: float = 1.0, source: dict | None = None, actor: str = "user") -> dict | None:
        text = (text or "").strip().rstrip("。.!！")
        if not text or len(text) < 4 or _STOP.match(text):
            return None
        if kind not in KINDS:
            kind = "fact"
        subject = subject or _subject_of(text)
        # 去重：同 scope 同 subject 同 kind 的活跃节点已存在且文本高度相似 → 不重复记
        existing = self.db.query(
            "SELECT * FROM memory_nodes WHERE scope=? AND kind=? AND subject=? AND retired=0",
            (scope, kind, subject))
        for e in existing:
            if _similar(e["text"], text):
                # 刷新重要度与时间，不新增
                self.db.execute(
                    "UPDATE memory_nodes SET importance=MIN(importance+0.2, 3.0), last_used_at=? WHERE id=?",
                    (now_iso(), e["id"]))
                return self._row(self.db.query_one("SELECT * FROM memory_nodes WHERE id=?", (e["id"],)))
        # 约束类：同 subject 的旧约束被新表述取代 → 退役旧的（supersede）
        nid = f"M-{uuid.uuid4().hex[:12]}"
        if kind in ("constraint", "decision"):
            for e in existing:
                self.db.execute(
                    "UPDATE memory_nodes SET retired=1, superseded_by=? WHERE id=?",
                    (nid, e["id"]))
        self.db.execute(
            """INSERT INTO memory_nodes(id,scope,kind,text,subject,importance,activations,
                                        source,retired,superseded_by,created_at,last_used_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (nid, scope, kind, text, subject, float(importance), 0,
             dumps(source or {}), 0, None, now_iso(), None))
        self.db.audit("memory.add", {"id": nid, "kind": kind, "subject": subject}, actor)
        self._prune(scope)
        return self._row(self.db.query_one("SELECT * FROM memory_nodes WHERE id=?", (nid,)))

    def delete(self, node_id: str, actor: str = "user") -> None:
        self.db.execute("DELETE FROM memory_nodes WHERE id=?", (node_id,))
        self.db.audit("memory.delete", {"id": node_id}, actor)

    def clear(self, scope: str = "default", actor: str = "user") -> int:
        n = self.db.query_one("SELECT COUNT(*) AS c FROM memory_nodes WHERE scope=?", (scope,))
        self.db.execute("DELETE FROM memory_nodes WHERE scope=?", (scope,))
        self.db.audit("memory.clear", {"scope": scope}, actor)
        return int(n["c"]) if n else 0

    def _prune(self, scope: str) -> None:
        """超容量时清理最旧的非活动记录（退役节点优先清，活跃约束保留）。"""
        cnt = self.db.query_one(
            "SELECT COUNT(*) AS c FROM memory_nodes WHERE scope=?", (scope,))
        total = int(cnt["c"]) if cnt else 0
        # 容量四倍才清，和 dsh-soul 一致：给回捞留余地
        if total <= self.max_nodes * 4:
            return
        over = total - self.max_nodes
        victims = self.db.query(
            """SELECT id FROM memory_nodes WHERE scope=?
               ORDER BY retired DESC, activations ASC, created_at ASC LIMIT ?""",
            (scope, over))
        for v in victims:
            self.db.execute("DELETE FROM memory_nodes WHERE id=?", (v["id"],))

    # ------------------------------------------------------------------ 抽取
    def capture_turn(self, user_message: str, reply: str, actions: list[dict] | None = None,
                     scope: str = "default") -> list[dict]:
        """从一轮对话抽取记忆节点。返回新增/更新的节点。"""
        created: list[dict] = []
        actions = actions or []

        # 1) 从用户消息按规则抽取约束/决策/进度
        for kind, pat in _RULES:
            m = re.search(pat, user_message)
            if m:
                body = m.group(1).strip()
                node = self.add(kind, body, scope=scope,
                                source={"from": "user_message", "raw": user_message[:200]})
                if node:
                    created.append(node)

        # 2) 从执行过的动作抽取「进度/决策」事实（真实发生的操作，天然可信）
        for a in actions:
            tool = a.get("tool")
            args = a.get("args") or {}
            fact = _action_fact(tool, args)
            if fact:
                node = self.add("progress", fact, scope=scope,
                                source={"from": "action", "tool": tool})
                if node:
                    created.append(node)
        return created

    # ------------------------------------------------------------------ 投影
    def project(self, scope: str = "default", limit_bytes: int = 600) -> str:
        """挑选预算内最相关的记忆，拼成注入 system prompt 的文本。"""
        nodes = self.list(scope=scope, include_retired=False, limit=100)
        if not nodes:
            return ""
        # 排序：约束 > 决策 > 进度 > 事实；同类按重要度与新旧
        order = {"constraint": 0, "decision": 1, "progress": 2, "fact": 3}
        nodes.sort(key=lambda n: (order.get(n["kind"], 4), -n["importance"], n["created_at"]))
        label = {"constraint": "约束", "decision": "决策", "progress": "进度", "fact": "事实"}
        lines: list[str] = []
        used = 0
        picked_ids: list[str] = []
        for n in nodes:
            line = f"- [{label.get(n['kind'], n['kind'])}] {n['text']}"
            b = len(line.encode("utf-8"))
            if used + b > limit_bytes:
                break
            lines.append(line)
            picked_ids.append(n["id"])
            used += b
        if not lines:
            return ""
        # 投影即使用：被投影的节点激活度 +1
        for nid in picked_ids:
            self.db.execute(
                "UPDATE memory_nodes SET activations=activations+1, last_used_at=? WHERE id=?",
                (now_iso(), nid))
        return "已知的用户记忆（跨轮保留，供参考，不要与之矛盾）：\n" + "\n".join(lines)

    # ------------------------------------------------------------------ 召回
    def recall(self, query: str, scope: str = "default", limit: int = 20) -> list[dict]:
        q = (query or "").strip()
        if not q:
            return []
        like = f"%{q}%"
        rows = self.db.query(
            """SELECT * FROM memory_nodes WHERE scope=? AND (text LIKE ? OR subject LIKE ?)
               ORDER BY retired ASC, importance DESC, created_at DESC LIMIT ?""",
            (scope, like, like, limit))
        out = []
        for r in rows:
            self.db.execute(
                "UPDATE memory_nodes SET activations=activations+1, last_used_at=? WHERE id=?",
                (now_iso(), r["id"]))
            out.append(self._row(r))
        return out


# ------------------------------------------------------------------ 辅助
def _subject_of(text: str) -> str:
    """粗略取主题，作为「同一件事」的匹配键。

    去掉标点后，再把数字归一成占位符 #，这样「默认用第10个交易日」与
    「默认用第20个交易日」会得到同一主题键，从而让后者取代前者（约束更新）。
    """
    cleaned = re.sub(r"[\s，。,.：:；;!！?？]+", "", text)
    cleaned = re.sub(r"\d+", "#", cleaned)
    return cleaned[:16]


def _similar(a: str, b: str) -> bool:
    """简单相似判定：一方包含另一方，或去标点后相等。"""
    ca = re.sub(r"[\s，。,.：:；;]+", "", a)
    cb = re.sub(r"[\s，。,.：:；;]+", "", b)
    if not ca or not cb:
        return False
    return ca == cb or ca in cb or cb in ca


def _action_fact(tool: str | None, args: dict) -> str | None:
    """把一次真实工具调用翻译成一句「进度」记忆。"""
    if not tool:
        return None
    name = args.get("name")
    code = args.get("code")
    if tool == "add_plugin" and name:
        return f"创建了插件「{name}」"
    if tool == "remove_plugin" and name:
        return f"删除了插件「{name}」"
    if tool == "toggle_plugin" and name:
        return f"{'启用' if args.get('enabled') else '停用'}了插件「{name}」"
    if tool == "move_plugin_first" and name:
        return f"把插件「{name}」排到了最前"
    if tool == "rename_plugin" and name:
        return f"把插件「{name}」改名为「{args.get('new_name')}」"
    if tool == "quant_probability" and code:
        return f"查询过 {code} 的量化概率"
    if tool == "expert_team" and code:
        return f"让专家团队研判过 {code}"
    return None
