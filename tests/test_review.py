"""Selection review: only triggered entries earn returns; untriggered stays zero exposure."""
from datetime import datetime, timedelta, timezone
import tempfile
from pathlib import Path

import pytest

from backend.db import Database
from backend.review import ReviewError, ReviewService

SH = timezone(timedelta(hours=8))
START = datetime(2026, 1, 5, tzinfo=SH)


def bars(closes, start=START):
    rows = []
    day = start
    for close in closes:
        rows.append({"date_ms": int(day.timestamp() * 1000), "close_price": close,
                     "open_price": close, "high_price": close, "low_price": close, "volume": 100})
        day += timedelta(days=1)
    return rows


class FakeMarket:
    def __init__(self, series):
        self.series = series

    def history(self, code, limit=120, adjust="forward"):
        return {"items": self.series.get(code, []), "timestamp": 1, "adjust": adjust}

    def fund_history(self, code, limit=120):
        return {"items": self.series.get(code, []), "timestamp": 1}

    def fund_research(self, code):
        return {"nav": {"data": {"items": []}}}


class FakeJobs:
    def __init__(self, jobs):
        self.jobs = jobs

    def get(self, job_id):
        return self.jobs.get(job_id)


def pick(code, entry_price=None, direction=None, invalidation=None, confidence="high", name="测试股"):
    item = {"code": code, "name": name, "reason": "证据符合理念", "why_fit": "现金流可核实",
            "confidence": confidence, "risks": [], "missing_evidence": [],
            "evidence": [{"source_id": "s1", "ref": "/data/items/0/last_price"}]}
    if entry_price is not None:
        item["entry_price"] = entry_price
        item["entry_direction"] = direction
    if invalidation is not None:
        item["invalidation_price"] = invalidation
    return item


def job(picks, finished="2026-01-05T15:00:00+08:00"):
    experts = [{"expert": {"id": "price_action", "name": "价格行为派"},
                "picks": [p for p in picks if p.get("code") in ("000001",)]},
               {"expert": {"id": "buffett", "name": "巴菲特"},
                "picks": [p for p in picks if p.get("code") in ("000002",)]}]
    return {"id": "job-1", "status": "done", "created_at": finished, "finished_at": finished,
            "payload": {"scope": "market", "expert_ids": ["price_action", "buffett"]},
            "result": {"expert_results": experts}}


@pytest.fixture
def build():
    root = Path(tempfile.mkdtemp())
    db = Database(root / "review.sqlite")

    def make(series, picks, finished="2026-01-05T15:00:00+08:00"):
        service = ReviewService(db, FakeMarket(series), FakeJobs({"job-1": job(picks, finished)}))
        return service

    yield make
    db.close()


def test_triggered_entry_returns_are_measured_from_the_trigger_bar(build):
    service = build({"000001": bars([10, 11, 13, 14, 15, 16])},
                    [pick("000001", entry_price=12.5, direction="above")])
    review = service.archive("job-1")
    detail = service.get(review["id"])
    target = detail["targets"][0]
    assert target["metrics"]["status"] == "triggered"
    assert target["metrics"]["trigger"]["date"] == "2026-01-07"
    assert target["metrics"]["windows"]["1d"] == round(14 / 13 - 1, 6)
    assert target["metrics"]["windows"]["5d"] is None
    assert detail["benchmark"]["entered"] == 1


def test_untriggered_pick_earns_no_return_and_is_counted_as_not_entered(build):
    closes = [10] * 4 + [10.2] * 20
    service = build({"000001": bars(closes)}, [pick("000001", entry_price=12.5, direction="above")])
    review = service.archive("job-1")
    metrics = service.get(review["id"])["targets"][0]["metrics"]
    assert metrics["status"] == "not_triggered"
    assert metrics["windows"] == {} and metrics["current"] is None
    assert "未入场" in metrics["reason"]


def test_invalidation_before_trigger_voids_the_pick(build):
    service = build({"000001": bars([10, 9.5, 9.0, 9.2, 9.4, 9.6])},
                    [pick("000001", entry_price=12.5, direction="above", invalidation=9.8)])
    review = service.archive("job-1")
    metrics = service.get(review["id"])["targets"][0]["metrics"]
    assert metrics["status"] == "invalidated"
    assert metrics["windows"] == {}


def test_no_condition_is_reference_only_and_explicitly_labelled(build):
    service = build({"000001": bars([10, 11, 12, 13, 14, 15])}, [pick("000001")])
    review = service.archive("job-1")
    metrics = service.get(review["id"])["targets"][0]["metrics"]
    assert metrics["status"] == "reference" and metrics["base_price"] == 10
    assert metrics["windows"]["5d"] == round(15 / 10 - 1, 6)


def test_expert_ranking_requires_ten_triggered_picks(build):
    service = build({"000001": bars([10, 11, 13, 14, 15, 16])},
                    [pick("000001", entry_price=12.5, direction="above")])
    review = service.archive("job-1")
    expert = [row for row in service.get(review["id"])["experts"] if row["expert"] == "price_action"][0]
    assert expert["triggered"] == 1 and expert["ranked"] is False and "rank" not in expert
    assert expert["trigger_rate"] == 1.0


def test_duplicate_archive_returns_the_same_review(build):
    service = build({"000001": bars([10, 11, 13])}, [pick("000001", entry_price=12.5, direction="above")])
    first = service.archive("job-1")
    second = service.archive("job-1")
    assert first["id"] == second["id"] and service.count() == 1


def test_unfinished_job_cannot_be_archived(build):
    service = build({"000001": bars([10, 11])}, [pick("000001")])
    service.jobs.jobs["job-1"]["status"] = "running"
    with pytest.raises(ReviewError):
        service.archive("job-1")
