"""All-directory, typed-identity factor batches; no cross-sectional ranking.

A candidate is shared, each target is independently evaluated and may choose its
own best rule. A thread owns its bounded read cache; a shard owns one sandbox
process (compiled once, full/prefix tests in fresh namespaces).
"""
from __future__ import annotations

from collections import Counter, OrderedDict
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from copy import deepcopy
from pathlib import Path
import threading
import time

import numpy as np
import pandas as pd

from .dataset import data_version, read_bars
from .evaluate import evaluate_directions_df
from .sandbox import run_batch, source_sha256, validate_source
from .service import FactorError, _code_columns
from .targets import actual_direction_matrix, direction_from_scores, forward_return_matrix, DEFAULT_HORIZONS

CATEGORIES = ("个股", "ETF", "指数")
WARNINGS = [
    "准确率是内样本历史频率，不是校准未来概率；多次试验择优存在过拟合。",
    "无前视为确定切点的经验截断测试，不是形式化证明。",
    "AST限制不是完整安全隔离；Windows使用1GiB/单进程Job与超时，非Windows无硬内存隔离。",
]


def scan_targets(root):
    rows = []
    seen = set()
    for category in CATEGORIES:
        for path in sorted((Path(root) / category).glob("*.csv")):
            if not path.is_file():
                continue
            code, sep, name = path.stem.partition("_")
            code = code.strip()
            if not code:
                continue
            target_id = f"{category}:{code}"
            if target_id in seen:
                raise FactorError(f"同类别代码有重复CSV，无法唯一标识: {target_id}", 409)
            seen.add(target_id)
            rows.append(dict(target_id=target_id, code=code, name=name.strip() if sep else code,
                             category=category, path=str(path)))
    return sorted(rows, key=lambda r: (r["category"], r["code"], r["name"]))


def universe_summary(rows):
    counts = Counter(r["category"] for r in rows)
    return {"total": len(rows), "categories": [{"category": c, "count": counts[c]} for c in CATEGORIES],
            "timeframe": "1d", "source": "local_csv_directory", "sampled": False,
            "minimum_bars": 100, "identity": "category:code"}


def report_for(rec, rule, metrics, version, samples=None):
    metrics = deepcopy(metrics)
    base = metrics["baseline"]
    metrics["baseline"] = {**base, "always_up": base.get("all_window_up_rate"),
                           "always_down": base.get("all_window_down_rate"),
                           "same_set": base.get("always_up"), "same_set_down": base.get("always_down")}
    confusion = metrics["confusion"]
    metrics["confusion"] = {"up": confusion.get("pred_up", {}), "down": confusion.get("pred_down", {})}
    metrics["per_horizon20"] = metrics["per_horizon"]
    result = {"kind": "factor", "target": {k: rec[k] for k in ("target_id", "code", "name", "category")},
              "as_of": metrics.get("as_of"), "bars": metrics["bars"], "direction": metrics["direction_now"],
              "rule": {k: rule[k] for k in ("id", "name", "kind", "source_sha256") if k in rule},
              "metrics": metrics, "rules": [], "warnings": list(WARNINGS), "source": "llm_batch",
              "data_version": version, "status": "completed"}
    result["target"]["timeframe"] = "1d"
    evaluated = int(metrics.get("evaluated") or 0)
    coverage = float(metrics.get("coverage") or 0.0)
    result["sample_quality"] = "thin" if (evaluated < 1000 or coverage < 0.15) else "normal"
    if result["sample_quality"] == "thin":
        result["warnings"].append(
            f"样本提醒：仅 {evaluated} 个有效窗口、覆盖率 {coverage:.1%}；"
            "准确率可能由少数窗口主导，不能当作稳定预测能力或低风险结论。")
    if samples is not None:
        result["samples"] = samples
    else:
        result["samples"] = None
        result["warnings"].append("此记录未保存错误样本，samples为null，非空样本数组。")
    return result


def _samples(df, directions, limit=5):
    close = df["close"].to_numpy(dtype=float)
    actual = actual_direction_matrix(close, DEFAULT_HORIZONS)
    returns = forward_return_matrix(close, DEFAULT_HORIZONS)
    dates = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d").to_numpy()
    out = {}
    for side, sign in (("false_positive", 1), ("false_negative", -1)):
        tt, hh = np.nonzero((directions[:, None] == sign) & np.isfinite(actual) & (actual != sign))
        order = np.argsort(-np.abs(returns[tt, hh]), kind="stable")[:limit]
        out[side] = [{"date": str(dates[tt[i]]), "h": int(DEFAULT_HORIZONS[hh[i]]),
                      "ret": float(returns[tt[i], hh[i]])} for i in order]
    return out


class FactorBatchEvaluator:
    """Bounded worker pool. Call close(), or use as a context manager.

    No shared FactorService/CodeSandbox LRU. Only each thread's private read
    cache is reused between candidates. At most `workers` shards are submitted.
    """
    def __init__(self, root, *, workers=4, shard_size=24, min_bars=100):
        if type(workers) is not int or not 1 <= workers <= 8:
            raise FactorError("workers须为1..8整数")
        if type(shard_size) is not int or not 16 <= shard_size <= 32:
            raise FactorError("shard_size须为16..32整数")
        self.root = Path(root)
        self.workers, self.shard_size = workers, shard_size
        self.min_bars = max(100, int(min_bars))
        self._local = threading.local()
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="factor-shard")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        self._pool.shutdown(wait=True, cancel_futures=True)

    def load(self, rec):
        # Only called by its owning thread. Never borrow factors._cache.
        cache = getattr(self._local, "cache", None)
        if cache is None:
            cache = self._local.cache = OrderedDict()
        path = Path(rec["path"])
        st = path.stat()
        key = (str(path), st.st_mtime_ns, st.st_size)
        hit = cache.get(key)
        if hit is None:
            frame = read_bars(path)
            hit = (frame, data_version(path, len(frame)))
            cache[key] = hit
            while len(cache) > 32:
                cache.popitem(last=False)
        else:
            cache.move_to_end(key)
        return hit

    def _shard(self, source, records, check, deadline):
        check()
        loaded, output = {}, []
        for rec in records:
            check()
            try:
                df, version = self.load(rec)
                if len(df) < self.min_bars:
                    output.append({**rec, "status": "skipped", "bars": len(df), "data_version": version,
                                   "error": f"数据不足100根（实际{len(df)}根）"})
                else:
                    loaded[rec["target_id"]] = (rec, df, version)
            except Exception as exc:
                output.append({**rec, "status": "failed", "error": str(exc)[:240]})
        if not loaded:
            return output
        check()  # immediately before each actual process launch
        remaining = 120. if deadline is None else deadline - time.monotonic()
        if remaining <= 0:
            check()
            raise FactorError("分片时间预算已耗尽", 504)
        try:
            replies = run_batch(source, [{"target_id": tid, "columns": _code_columns(df)}
                                        for tid, (_, df, _) in loaded.items()], timeout=min(30., remaining))
        except Exception as exc:
            replies = [{"target_id": tid, "ok": False, "error": str(exc)[:240]} for tid in loaded]
        for reply in replies:
            rec, df, version = loaded[reply["target_id"]]
            if not reply.get("ok"):
                output.append({**rec, "status": "failed", "data_version": version, "error": reply["error"],
                               "error_kind": reply.get("kind"), "error_name": reply.get("name"),
                               "error_line": reply.get("line")})
                continue
            values = reply["values"]
            dirs = direction_from_scores(values, 0.)
            metrics = evaluate_directions_df(df, dirs)
            metrics.update(data_version=version, kind="code", source_sha256=source_sha256(source),
                           neutral_band=0., lookahead_checked=reply["lookahead_checked"],
                           direction_now=int(dirs[-1]), score_now=float(values[-1]) if np.isfinite(values[-1]) else 0.)
            output.append({**rec, "status": "completed", "data_version": version, "metrics": metrics,
                           "samples": _samples(df, dirs)})
        return output

    def evaluate(self, source, targets=None, *, on_chunk=None, check=None, deadline=None):
        """Evaluate all given targets; callback persists each finished shard.

        A cancellation/deadline exception halts new launches; already running
        shards are drained (bounded timeout) and persisted before re-raising.
        Returned summary is bounded and never contains the entire result set.
        """
        source = validate_source(source)
        records = scan_targets(self.root) if targets is None else list(targets)
        check = check or (lambda: None)
        chunks = iter([records[i:i+self.shard_size] for i in range(0, len(records), self.shard_size)])
        pending = set()
        summary = {"total": len(records), "completed": 0, "failed": 0, "skipped": 0, "unprocessed": len(records)}
        stopped = None
        def launch():
            check()
            chunk = next(chunks, None)
            if chunk is not None:
                pending.add(self._pool.submit(self._shard, source, chunk, check, deadline))
                return True
            return False
        try:
            for _ in range(self.workers):
                if not launch():
                    break
            while pending:
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
                for future in done:
                    try:
                        rows = future.result()
                        for row in rows:
                            summary[row["status"]] += 1
                            summary["unprocessed"] -= 1
                        if on_chunk:
                            on_chunk(rows, dict(summary))
                    except Exception as exc:
                        stopped = stopped or exc
                if stopped is None:
                    for _ in done:
                        try:
                            if not launch():
                                break
                        except Exception as exc:
                            stopped = exc
                            break
        except Exception as exc:
            stopped = stopped or exc
        finally:
            # Do not abandon in-flight processes or completed evidence on cancel.
            for future in pending:
                try:
                    rows = future.result()
                    for row in rows:
                        summary[row["status"]] += 1
                        summary["unprocessed"] -= 1
                    if on_chunk:
                        on_chunk(rows, dict(summary))
                except Exception as exc:
                    stopped = stopped or exc
        if stopped is not None:
            raise stopped
        return summary
