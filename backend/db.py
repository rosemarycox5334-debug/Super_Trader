"""SQLite 状态层：建表（可重复执行）、连接管理、审计日志、JSON 辅助。

所有业务真相落盘在这里；前端不存业务状态。schema 对应任务书第 4 节。
"""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

# 建表语句都带 IF NOT EXISTS，init_db 可反复执行不报错（满足「迁移可重复执行」）。
SCHEMA = """
CREATE TABLE IF NOT EXISTS plugins(
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, icon TEXT,
    entry TEXT, enabled INTEGER NOT NULL DEFAULT 1, ord INTEGER NOT NULL DEFAULT 0,
    builtin INTEGER NOT NULL DEFAULT 0, permissions JSON, config JSON,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS experts(
    id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT, system_prompt TEXT NOT NULL,
    criteria JSON, tools JSON, model TEXT, temperature REAL DEFAULT 0.3,
    abstain_policy TEXT DEFAULT 'missing_evidence',
    version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expert_tombstones(
    expert_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses(
    id TEXT PRIMARY KEY, expert_id TEXT NOT NULL, symbol_code TEXT NOT NULL,
    symbol_category TEXT NOT NULL, horizon INTEGER NOT NULL, vote INTEGER NOT NULL,
    confidence TEXT, reason TEXT, evidence JSON, abstained INTEGER NOT NULL DEFAULT 0,
    model TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist(
    symbol_code TEXT NOT NULL, symbol_category TEXT NOT NULL, name TEXT,
    added_at TEXT NOT NULL, PRIMARY KEY(symbol_code, symbol_category)
);
CREATE TABLE IF NOT EXISTS journal(
    id TEXT PRIMARY KEY, symbol_code TEXT NOT NULL, symbol_category TEXT NOT NULL,
    name TEXT, action TEXT NOT NULL, expert TEXT, horizon INTEGER,
    signal JSON, reasons JSON, price REAL, closed INTEGER NOT NULL DEFAULT 0,
    note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs(
    id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
    payload JSON, result JSON, error TEXT,
    created_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS audit(
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT,
    action TEXT NOT NULL, detail JSON
);
CREATE TABLE IF NOT EXISTS memory_nodes(
    id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT 'default',
    kind TEXT NOT NULL, text TEXT NOT NULL, subject TEXT,
    importance REAL NOT NULL DEFAULT 1.0, activations INTEGER NOT NULL DEFAULT 0,
    source JSON, retired INTEGER NOT NULL DEFAULT 0, superseded_by TEXT,
    created_at TEXT NOT NULL, last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_nodes(scope, retired);
"""


def now_iso() -> str:
    """带本地时区偏移的 ISO 时间串（journal 冻结时间要能复现）。"""
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    """线程安全的轻量 SQLite 封装。

    用一把可重入锁串行化写入；FastAPI 多线程池 + 后台 job 线程都走这把锁，
    避免 "database is locked"。读多写少，锁开销可忽略。
    """

    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False：允许后台线程复用连接；用锁保证安全。
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._lock = threading.RLock()
        self.init_db()

    # ------------------------------------------------------------------ 迁移
    def init_db(self) -> None:
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ------------------------------------------------------------------ 原语
    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, tuple(params))
            self._conn.commit()
            return cur

    def executemany(self, sql: str, seq: Iterable[Iterable[Any]]) -> None:
        with self._lock:
            self._conn.executemany(sql, [tuple(x) for x in seq])
            self._conn.commit()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Serialize an atomic read/write unit; use only the yielded connection inside.

        BEGIN IMMEDIATE also serializes writers using another Database connection.
        A failing statement or business check rolls back every change in the unit.
        Nested transactions and auto-committing execute/executemany calls are not
        supported inside this context.
        """
        with self._lock:
            if self._conn.in_transaction:
                raise RuntimeError("Nested Database transactions are not supported")
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
                self._conn.commit()
            except BaseException:
                self._conn.rollback()
                raise

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._conn.execute(sql, tuple(params)).fetchall())

    def query_one(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    # ------------------------------------------------------------------ 审计
    def audit(self, action: str, detail: Any, actor: str = "system") -> None:
        self.execute(
            "INSERT INTO audit(at, actor, action, detail) VALUES(?,?,?,?)",
            (utc_iso(), actor, action, dumps(detail)),
        )

    def audit_log(self, limit: int = 100) -> list[dict]:
        rows = self.query(
            "SELECT at, actor, action, detail FROM audit ORDER BY id DESC LIMIT ?",
            (limit,),
        )
        return [
            {"at": r["at"], "actor": r["actor"], "action": r["action"],
             "detail": loads(r["detail"])}
            for r in rows
        ]


# ------------------------------------------------------------------ JSON 辅助
def dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


def loads(raw: str | None, default: Any = None):
    if raw is None or raw == "":
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default
