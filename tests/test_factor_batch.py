"""Offline multi-target sandbox and evaluator contract tests (no model calls)."""
from concurrent.futures import ThreadPoolExecutor
import threading

import numpy as np
import pandas as pd
import pytest

from backend.factors.batch import FactorBatchEvaluator, scan_targets, universe_summary
from backend.factors.sandbox import CodeSandbox, SandboxError, run_batch
from backend.factors.service import FactorService

UP = "def factor(df):\n    return F.ones(len(df))"
DOWN = "def factor(df):\n    return -F.ones(len(df))"
MOM = "def factor(df):\n    return F.diff(df['close'], 3)"


def make_csv(root, category="个股", code="000001", n=140, falling=False):
    directory = root / category
    directory.mkdir(parents=True, exist_ok=True)
    close = np.arange(1, n+1, dtype=float)
    if falling:
        close = close[::-1]
    df = pd.DataFrame({"date": pd.date_range("2020-01-01", periods=n), "close": close,
                       "open": close, "high": close+1, "low": np.maximum(.1, close-.5), "volume": 100.})
    path = directory / f"{code}_合成.csv"
    df.to_csv(path, index=False)
    return path


def test_universe_all_categories_and_same_code(tmp_path):
    for cat in ("个股", "ETF", "指数"):
        make_csv(tmp_path, cat)
    rows = scan_targets(tmp_path)
    assert len(rows) == 3
    assert len({r["target_id"] for r in rows}) == 3
    assert universe_summary(rows)["sampled"] is False


def test_batch_matches_single_all_metrics_and_skip(tmp_path):
    make_csv(tmp_path)
    make_csv(tmp_path, code="000002", n=20)
    rows = []
    with FactorBatchEvaluator(tmp_path, workers=2) as evaluator:
        summary = evaluator.evaluate(MOM, on_chunk=lambda chunk, _: rows.extend(chunk))
    assert summary == dict(total=2, completed=1, failed=0, skipped=1, unprocessed=0)
    got = next(r for r in rows if r["status"] == "completed")["metrics"]
    expected = FactorService(tmp_path).evaluate_code("000001", MOM)
    for key in ("accuracy", "coverage", "evaluated", "correct", "skipped", "not_evaluated",
                "per_horizon", "confusion", "baseline", "lookahead_checked", "direction_now"):
        assert got[key] == expected[key], key


def test_full_and_prefix_one_compilation_fresh_namespaces():
    # Mutable module data would leak if reused between symbols OR full/prefix.
    source = "memo=[]\ndef factor(df):\n memo.append(1)\n return F.ones(len(df))*len(memo)"
    items = [{"target_id": str(i), "columns": {"close": np.arange(1., 141.)}} for i in range(3)]
    rows = run_batch(source, items)
    assert all(r["ok"] and np.all(r["values"] == 1.) for r in rows)
    assert all(len(r["lookahead_checked"]) == 2 for r in rows)


def test_lookahead_rejected_independently():
    items = [{"target_id": str(i), "columns": {"close": np.arange(1., 141.)}} for i in range(2)]
    rows = run_batch("def factor(df):\n return F.shift(df['close'], -3)", items)
    assert all(not r["ok"] and "未来" in r["error"] for r in rows)


def test_null_zero_windows_and_errors(tmp_path):
    make_csv(tmp_path)
    with FactorBatchEvaluator(tmp_path) as evaluator:
        rows = []
        evaluator.evaluate("def factor(df):\n return F.zeros(len(df))", on_chunk=lambda r, _: rows.extend(r))
        assert rows[0]["metrics"]["accuracy"] is None
        assert rows[0]["metrics"]["evaluated"] == 0
        errors = []
        evaluator.evaluate("def factor(df):\n return missing", on_chunk=lambda r, _: errors.extend(r))
        assert errors[0]["status"] == "failed"


def test_worker_read_cache_is_thread_private(tmp_path):
    make_csv(tmp_path)
    rec = scan_targets(tmp_path)[0]
    barrier = threading.Barrier(2)
    with FactorBatchEvaluator(tmp_path, workers=2) as evaluator:
        def read():
            df, _ = evaluator.load(rec)
            barrier.wait(timeout=5)
            return id(evaluator._local.cache), id(df)
        with ThreadPoolExecutor(2) as pool:
            a, b = pool.submit(read), pool.submit(read)
            assert a.result() != b.result()


def test_bounds_and_timeout_reap(monkeypatch):
    from backend.factors import sandbox
    original = sandbox.subprocess.Popen
    spawned = []
    def track(*args, **kwargs):
        proc = original(*args, **kwargs)
        spawned.append(proc)
        return proc
    monkeypatch.setattr(sandbox.subprocess, "Popen", track)
    items = [{"target_id": "one", "columns": {"close": np.arange(1., 141.)}}]
    with pytest.raises(SandboxError, match="输出"):
        run_batch(UP, items, max_stdout=64)
    with pytest.raises(SandboxError, match="超时"):
        run_batch("def factor(df):\n while True:\n  pass", items, timeout=.3)
    with pytest.raises(SandboxError):
        run_batch(UP, items*33)
    for source in ("import os\ndef factor(df):\n return df['close']",
                   "def factor(df):\n return df.__class__",
                   "def factor(df):\n return open('bad')"):
        with pytest.raises(SandboxError):
            run_batch(source, items)
    # A timeout/oversize failure does not poison subsequent processes.
    assert run_batch(UP, items)[0]["ok"]
    assert all(proc.poll() is not None for proc in spawned)


def test_cancel_before_launch_no_process(tmp_path, monkeypatch):
    make_csv(tmp_path)
    called = []
    monkeypatch.setattr("backend.factors.batch.run_batch", lambda *a, **k: called.append(1))
    def stop():
        raise RuntimeError("cancelled")
    with FactorBatchEvaluator(tmp_path) as evaluator, pytest.raises(RuntimeError, match="cancelled"):
        evaluator.evaluate(UP, check=stop)
    assert not called


def test_entire_universe_crosses_shards_with_one_process_each(tmp_path, monkeypatch):
    from backend.factors import sandbox
    for i in range(65):
        make_csv(tmp_path, ("个股", "ETF", "指数")[i % 3], code=f"{i:06d}")
    original = sandbox.subprocess.Popen
    started = []
    def track(*args, **kwargs):
        proc = original(*args, **kwargs)
        started.append(proc)
        return proc
    monkeypatch.setattr(sandbox.subprocess, "Popen", track)
    chunks = []
    with FactorBatchEvaluator(tmp_path, workers=2) as evaluator:
        summary = evaluator.evaluate(UP, on_chunk=lambda rows, _: chunks.append(rows))
    assert summary["total"] == summary["completed"] == 65
    assert summary["unprocessed"] == 0
    assert len(started) == len(chunks) == 3  # ceil(65/24), NOT 65*5 subprocesses
    assert len({r["target_id"] for chunk in chunks for r in chunk}) == 65
    assert all(proc.poll() is not None for proc in started)


@pytest.mark.parametrize("source,kind,name,line", [
    ("def factor(df):\n secret='C:/private/DO_NOT_LEAK_SECRET'\n return pd.ones(len(df))", "NameError", "pd", 3),
    ("def factor(df):\n return df['close'].rolling(3)", "AttributeError", "rolling", 2),
])
def test_safe_actionable_name_and_attribute_diagnostics(tmp_path, source, kind, name, line):
    make_csv(tmp_path)
    items = [{"target_id": "个股:000001", "columns": {"close": np.arange(1., 141.)}}]
    reply = run_batch(source, items)[0]
    assert not reply["ok"]
    assert reply["kind"] == kind and reply["name"] == name and reply["line"] == line
    assert kind in reply["error"] and name in reply["error"] and f"第{line}行" in reply["error"]
    assert "DO_NOT_LEAK_SECRET" not in str(reply)
    assert "private" not in str(reply) and "Traceback" not in str(reply)
    with pytest.raises(SandboxError) as caught:
        CodeSandbox().run(source, items[0]["columns"])
    assert name in str(caught.value) and f"第{line}行" in str(caught.value)
    assert "DO_NOT_LEAK_SECRET" not in str(caught.value)
    rows = []
    with FactorBatchEvaluator(tmp_path, workers=1) as evaluator:
        evaluator.evaluate(source, on_chunk=lambda r, _: rows.extend(r))
    assert rows[0]["status"] == "failed"
    assert rows[0]["error_kind"] == kind and rows[0]["error_name"] == name and rows[0]["error_line"] == line
    assert f"第{line}行" in rows[0]["error"]
    assert "DO_NOT_LEAK_SECRET" not in rows[0]["error"]


def test_diagnostic_identifier_limits_and_no_exception_text_leak():
    from backend.factors.sandbox import _execution_diagnostic
    items = [{"target_id": "one", "columns": {"close": np.arange(1., 141.)}}]
    long_name = "a" * 81
    row = run_batch("def factor(df):\n return " + long_name, items)[0]
    assert row["name"] is None and long_name not in row["error"]
    source = "def factor(df):\n secret='C:/private/DO_NOT_LEAK_SECRET'\n return {}[secret]"
    row = run_batch(source, items)[0]
    assert row["error"] == "KeyError"
    assert "DO_NOT_LEAK_SECRET" not in str(row) and "private" not in str(row)
    assert _execution_diagnostic({"kind": "NameError", "name": "C:/private/DO_NOT_LEAK_SECRET", "line": "secret"}) == ("NameError", None, None)
    assert run_batch(UP, items)[0]["ok"]
