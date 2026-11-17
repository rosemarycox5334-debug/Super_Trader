"""插件运行时：注册 / 启停 / 排序 / 持久化 / 审计。

真实的运行时注册：插件记录落在 SQLite，导航由后端下发。
保护：至少保留一个启用插件；内置插件不可删除。
自定义插件契约：声明式渲染（render + data_source）或受限只读配置。
"""
from __future__ import annotations

import re
from typing import Any

from .db import Database, dumps, loads, now_iso
from .seeds import BUILTIN_PLUGINS

_VALID_RENDER = {"table", "list", "cards", "markdown"}


class PluginError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _slugify(name: str) -> str:
    base = re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", "-", (name or "").strip()).strip("-")
    base = base.lower() or "plugin"
    # 中文名无法做 ascii slug，退化为 plugin + 随机片段
    if not re.match(r"^[0-9a-z-]+$", base):
        import uuid
        base = "plugin-" + uuid.uuid4().hex[:6]
    return base


class PluginService:
    def __init__(self, db: Database):
        self.db = db
        self.ensure_builtins()

    # ------------------------------------------------------------------ 初始化
    def ensure_builtins(self) -> None:
        for p in BUILTIN_PLUGINS:
            exists = self.db.query_one("SELECT id FROM plugins WHERE id=?", (p["id"],))
            if exists:
                continue
            self.db.execute(
                """INSERT INTO plugins(id,name,kind,icon,entry,enabled,ord,builtin,
                                       permissions,config,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (p["id"], p["name"], p["kind"], p["icon"], p["entry"], p["enabled"],
                 p["ord"], p["builtin"], dumps(p["permissions"]), dumps(p["config"]),
                 now_iso()),
            )

    # ------------------------------------------------------------------ 读
    def _row_to_dict(self, r) -> dict:
        return {
            "id": r["id"], "name": r["name"], "icon": r["icon"], "kind": r["kind"],
            "entry": r["entry"], "enabled": bool(r["enabled"]), "order": r["ord"],
            "builtin": bool(r["builtin"]),
            "permissions": loads(r["permissions"], []),
            "config": loads(r["config"], {}),
            "updated_at": r["updated_at"],
        }

    def list(self, enabled_only: bool = False) -> list[dict]:
        sql = "SELECT * FROM plugins"
        if enabled_only:
            sql += " WHERE enabled=1"
        sql += " ORDER BY ord ASC, updated_at ASC"
        return [self._row_to_dict(r) for r in self.db.query(sql)]

    def get(self, plugin_id: str) -> dict:
        r = self.db.query_one("SELECT * FROM plugins WHERE id=?", (plugin_id,))
        if r is None:
            raise PluginError(f"插件不存在: {plugin_id}", status=404)
        return self._row_to_dict(r)

    def _enabled_count(self) -> int:
        r = self.db.query_one("SELECT COUNT(*) AS c FROM plugins WHERE enabled=1")
        return int(r["c"]) if r else 0

    # ------------------------------------------------------------------ 写
    def create(self, data: dict, actor: str = "user") -> dict:
        name = (data.get("name") or "").strip()
        if not name:
            raise PluginError("插件必须有名字")
        kind = data.get("kind") or "custom"
        config = data.get("config") or {}
        # 自定义插件契约校验（声明式优先）
        if kind == "custom" or data.get("entry", "").startswith("declarative:"):
            render = config.get("render")
            if render and render not in _VALID_RENDER:
                raise PluginError(f"render 必须是 {sorted(_VALID_RENDER)} 之一")
        pid = data.get("id") or _slugify(name)
        if self.db.query_one("SELECT id FROM plugins WHERE id=?", (pid,)):
            pid = f"{pid}-{__import__('uuid').uuid4().hex[:4]}"
        max_ord = self.db.query_one("SELECT COALESCE(MAX(ord),-1) AS m FROM plugins")
        order = int(max_ord["m"]) + 1
        entry = data.get("entry") or f"declarative:{pid}"
        self.db.execute(
            """INSERT INTO plugins(id,name,kind,icon,entry,enabled,ord,builtin,
                                   permissions,config,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (pid, name, kind, data.get("icon", "puzzle"), entry,
             1 if data.get("enabled", True) else 0, order, 0,
             dumps(data.get("permissions", [])), dumps(config), now_iso()),
        )
        self.db.audit("plugin.create", {"id": pid, "name": name, "kind": kind}, actor)
        return self.get(pid)

    def update(self, plugin_id: str, patch: dict, actor: str = "user") -> dict:
        current = self.get(plugin_id)
        fields: dict[str, Any] = {}
        if "name" in patch and patch["name"]:
            fields["name"] = str(patch["name"]).strip()
        if "icon" in patch:
            fields["icon"] = patch["icon"]
        if "config" in patch:
            fields["config"] = dumps(patch["config"])
        if "permissions" in patch:
            fields["permissions"] = dumps(patch["permissions"])
        if "enabled" in patch:
            new_enabled = 1 if patch["enabled"] else 0
            if new_enabled == 0 and current["enabled"] and self._enabled_count() <= 1:
                raise PluginError("至少保留一个启用的插件", status=409)
            fields["enabled"] = new_enabled
        if "order" in patch:
            fields["ord"] = int(patch["order"])
        if not fields:
            return current
        fields["updated_at"] = now_iso()
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(
            f"UPDATE plugins SET {sets} WHERE id=?", (*fields.values(), plugin_id)
        )
        if "order" in patch:
            self._reindex()
        self.db.audit("plugin.update", {"id": plugin_id, "patch": {k: patch[k] for k in patch}}, actor)
        return self.get(plugin_id)

    def delete(self, plugin_id: str, actor: str = "user") -> None:
        current = self.get(plugin_id)
        if current["builtin"]:
            raise PluginError("内置插件不可删除", status=409)
        if current["enabled"] and self._enabled_count() <= 1:
            raise PluginError("至少保留一个启用的插件", status=409)
        self.db.execute("DELETE FROM plugins WHERE id=?", (plugin_id,))
        self._reindex()
        self.db.audit("plugin.delete", {"id": plugin_id, "name": current["name"]}, actor)

    def reorder(self, ordered_ids: list[str], actor: str = "user") -> list[dict]:
        existing = {p["id"] for p in self.list()}
        for i, pid in enumerate(ordered_ids):
            if pid in existing:
                self.db.execute(
                    "UPDATE plugins SET ord=?, updated_at=? WHERE id=?",
                    (i, now_iso(), pid),
                )
        self.db.audit("plugin.reorder", {"order": ordered_ids}, actor)
        return self.list()

    def move_first(self, plugin_id: str, actor: str = "user") -> dict:
        self.get(plugin_id)
        ids = [p["id"] for p in self.list()]
        ids = [plugin_id] + [i for i in ids if i != plugin_id]
        self.reorder(ids, actor)
        return self.get(plugin_id)

    def _reindex(self) -> None:
        rows = self.db.query("SELECT id FROM plugins ORDER BY ord ASC, updated_at ASC")
        for i, r in enumerate(rows):
            self.db.execute("UPDATE plugins SET ord=? WHERE id=?", (i, r["id"]))
