"""后台任务队列：批量研判用。进度写库 + SSE 推送 + 可取消。

单进程内用一个后台线程池跑任务；状态落 jobs 表，服务重启后历史仍在
（运行中的任务会被标记为 interrupted）。
"""
from __future__ import annotations

import math
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from .db import Database, dumps, loads, utc_iso

JobFn = Callable[["JobHandle"], Any]


class JobHandle:
    """任务运行时句柄：worker 用它报告进度、检查取消。"""

    def __init__(self, job_id: str, manager: "JobManager", total: int, payload: dict):
        self.id = job_id
        self._mgr = manager
        self.total = total
        self.payload = payload
        self._cancel = manager._cancel_event(job_id)

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def progress(self, done: int, partial: Any | None = None) -> None:
        self._mgr._update_progress(self.id, done, self.total, partial)



def _finite(value):
    """JSON cannot carry NaN/Infinity; running task payloads must stay serializable."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_finite(v) for v in value]
    return value

class JobManager:
    def __init__(self, db: Database, max_workers: int = 2):
        self.db = db
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="job")
        self._cancels: dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        self.on_completed: Callable[[str, str], None] | None = None
        self._mark_orphans()

    def _mark_orphans(self) -> None:
        """重启后把残留的 running/queued 标为 interrupted（诚实反映中断）。"""
        self.db.execute(
            "UPDATE jobs SET status='interrupted', finished_at=? "
            "WHERE status IN ('running','queued')",
            (utc_iso(),),
        )

    def _cancel_event(self, job_id: str) -> threading.Event:
        with self._lock:
            ev = self._cancels.get(job_id)
            if ev is None:
                ev = threading.Event()
                self._cancels[job_id] = ev
            return ev

    def submit(self, job_type: str, payload: dict, fn: JobFn, total: int) -> str:
        job_id = f"job-{uuid.uuid4().hex[:12]}"
        self.db.execute(
            """INSERT INTO jobs(id,type,status,progress,total,payload,result,error,created_at)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            (job_id, job_type, "queued", 0, total, dumps(payload), None, None, utc_iso()),
        )
        self._cancel_event(job_id)
        self._pool.submit(self._run, job_id, job_type, payload, fn, total)
        return job_id

    def _run(self, job_id: str, job_type: str, payload: dict, fn: JobFn, total: int) -> None:
        self.db.execute("UPDATE jobs SET status='running' WHERE id=?", (job_id,))
        handle = JobHandle(job_id, self, total, payload)
        try:
            result = fn(handle)
            if handle.cancelled:
                self.db.execute(
                    "UPDATE jobs SET status='cancelled', finished_at=? WHERE id=?",
                    (utc_iso(), job_id))
            else:
                self.db.execute(
                    "UPDATE jobs SET status='done', progress=total, result=?, finished_at=? WHERE id=?",
                    (dumps(result), utc_iso(), job_id))
                if self.on_completed is not None:
                    try:
                        self.on_completed(job_type, job_id)
                    except Exception:
                        # Derived archival can be recovered by review sync; never
                        # change an already completed research job into a failure.
                        pass
        except Exception as exc:  # noqa: BLE001  任务异常落库，不吞
            self.db.execute(
                "UPDATE jobs SET status='error', error=?, finished_at=? WHERE id=?",
                (str(exc), utc_iso(), job_id))
        finally:
            with self._lock:
                self._cancels.pop(job_id, None)

    def _update_progress(self, job_id: str, done: int, total: int, partial: Any | None) -> None:
        if partial is not None:
            self.db.execute(
                "UPDATE jobs SET progress=?, total=?, result=? WHERE id=?",
                (done, total, dumps(partial), job_id))
        else:
            self.db.execute(
                "UPDATE jobs SET progress=?, total=? WHERE id=?", (done, total, job_id))

    def cancel(self, job_id: str) -> bool:
        row = self.db.query_one("SELECT status FROM jobs WHERE id=?", (job_id,))
        if row is None:
            return False
        if row["status"] in ("done", "error", "cancelled", "interrupted"):
            return False
        ev = self._cancel_event(job_id)
        ev.set()
        return True

    def get(self, job_id: str) -> dict | None:
        r = self.db.query_one("SELECT * FROM jobs WHERE id=?", (job_id,))
        if r is None:
            return None
        return {
            "id": r["id"], "type": r["type"], "status": r["status"],
            "progress": r["progress"], "total": r["total"],
            "payload": _finite(loads(r["payload"], {})), "result": _finite(loads(r["result"])),
            "error": r["error"], "created_at": r["created_at"],
            "finished_at": r["finished_at"],
        }

    def list(self, limit: int = 50) -> list[dict]:
        rows = self.db.query("SELECT id FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,))
        return [self.get(r["id"]) for r in rows]

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
