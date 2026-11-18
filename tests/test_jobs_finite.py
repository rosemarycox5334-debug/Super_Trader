"""Running job payloads must stay lossless JSON: NaN/Infinity become null."""
import math
import tempfile
from pathlib import Path

from backend.db import Database
from backend.jobs import JobManager, _finite


def test_finite_helper_replaces_non_finite_and_recurses():
    assert _finite(float("nan")) is None
    assert _finite(float("inf")) is None
    assert _finite(0.5) == 0.5
    assert _finite({"a": [float("-inf"), {"b": float("nan")}], "c": 1}) == {"a": [None, {"b": None}], "c": 1}


def test_running_job_payload_is_serializable_without_nan():
    root = Path(tempfile.mkdtemp())
    db = Database(root / "jobs.sqlite")
    jobs = JobManager(db, max_workers=1)
    try:
        job_id = jobs.submit("demo", {"x": 1}, lambda handle: {"ratio": float("nan"), "nested": {"inf": float("inf")}}, total=1)
        jobs._pool.submit(lambda: None).result(timeout=30)
        row = jobs.get(job_id)
        assert row["result"] == {"ratio": None, "nested": {"inf": None}}
        assert math.isfinite(1.0)
    finally:
        jobs.shutdown()
        db.close()
