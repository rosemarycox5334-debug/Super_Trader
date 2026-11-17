import time
from pathlib import Path

from backend.db import Database
from backend.factors import research as module
from backend.factors.research import FactorResearchService
from backend.factors.service import FactorService


class StubFactors:
    def __init__(self, root):
        self._root = root

    def root(self):
        return str(self._root)


def test_universe_directory_is_cached_and_writes_once(tmp_path, monkeypatch):
    calls = []

    def fake_scan(root):
        calls.append(root)
        return [
            {"target_id": "个股:000001", "code": "000001", "name": "A", "category": "个股", "path": "a.csv"},
            {"target_id": "ETF:510300", "code": "510300", "name": "B", "category": "ETF", "path": "b.csv"},
        ]

    monkeypatch.setattr(module, "scan_targets", fake_scan)
    db = Database(tmp_path / "state.db")
    try:
        service = FactorResearchService(StubFactors(tmp_path), object(), object(), db)
        first = service.universe()
        second = service.universe()
        assert first["total"] == 2 and second["total"] == 2
        assert len(calls) == 1, "repeated reads must reuse the directory cache"
        rows = db.query("SELECT COUNT(*) n FROM factor_research_targets")[0]["n"]
        assert rows == 2
        # Expiry forces a rescan but never changes identity semantics.
        service._dir_at = time.monotonic() - 61
        service.universe()
        assert len(calls) == 2
    finally:
        db.close()
