"""Portable paths and missing-data handling only; never read credentials/live data."""
from pathlib import Path

import pandas as pd
import pytest

from backend import settings
from backend.quant import QuantEngine, QuantError
from super_trader.config import Config


@pytest.fixture
def portable_env(monkeypatch, tmp_path):
    monkeypatch.setenv("ST_PORTABLE_RUNTIME", "1")
    monkeypatch.setenv("ST_STATE_DIR", str(tmp_path / "user-state"))
    for name in ("ST_MODEL_API_KEY", "COMMANDCODE_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ST_MODEL_KEY_FILE", "ST_STATE_DB", "SUPER_TRADER_DATA_ROOT", "SUPER_TRADER_CACHE_DIR", "SUPER_TRADER_REPORT_DIR"):
        monkeypatch.delenv(name, raising=False)
    return tmp_path / "user-state"


def test_portable_config_never_defaults_to_original_drive(portable_env):
    cfg = Config.load()
    assert cfg.data_path == portable_env / "research-data"
    assert cfg.cache_path == portable_env / "cache"
    assert cfg.report_path == portable_env / "reports"
    assert settings.Settings.load().state_db == portable_env / "state.db"


def test_portable_no_implicit_key_file_reads(portable_env, monkeypatch):
    def forbidden(_path):
        raise AssertionError("implicit key-file read")
    monkeypatch.setattr(settings, "_read_key_file", forbidden)
    assert settings._resolve_api_key() == ""


def test_explicit_missing_key_file_fails_closed(portable_env, monkeypatch, tmp_path):
    calls = []
    monkeypatch.setenv("ST_MODEL_KEY_FILE", str(tmp_path / "selected-missing.txt"))
    monkeypatch.setattr(settings, "_read_key_file", lambda path: calls.append(path) or "")
    assert settings._resolve_api_key() == ""
    assert calls == [tmp_path / "selected-missing.txt"]


def test_missing_and_empty_catalog_are_controlled(portable_env, monkeypatch):
    engine = QuantEngine()
    assert engine.capabilities == {"research_data_available": False, "grid_available": False, "data_configured": False, "report_configured": False}
    assert engine.search("601088") == []
    with pytest.raises(QuantError) as error:
        engine.probability("601088", None, horizon=10)
    assert error.value.status == 503
    category = engine.cfg.data_path / "个股"
    category.mkdir(parents=True)
    (category / "601088_fixture.csv").touch()
    assert engine.capabilities["research_data_available"] is True
    monkeypatch.setattr(engine.store, "catalog", lambda: pd.DataFrame())
    assert engine.search("601088") == []
    with pytest.raises(QuantError) as error:
        engine.resolve_symbol("601088", None)
    assert error.value.status == 503


def test_report_override_and_cheap_capabilities(portable_env, monkeypatch, tmp_path):
    report = tmp_path / "external-reports"
    monkeypatch.setenv("SUPER_TRADER_REPORT_DIR", str(report))
    engine = QuantEngine()
    assert engine.grid_path == report / "fullfit" / "probability_grid.json"
    engine.grid_path.parent.mkdir(parents=True)
    engine.grid_path.touch()
    monkeypatch.setattr(engine.store, "catalog", lambda: (_ for _ in ()).throw(AssertionError("catalog scanned")))
    assert engine.capabilities["grid_available"] is True
    assert engine.capabilities["report_configured"] is True
    assert engine._grid is None  # Availability never loads or parses the grid.


def test_existing_grid_decode_and_neutral_contract_unchanged(portable_env):
    from super_trader.data import SymbolInfo
    engine = QuantEngine()
    raw = [657, 123, 0, 512, 456]
    row = engine._row_from_grid(raw)
    assert row["probability"] == 0.657
    assert row["baseline_up"] == 0.512
    assert row["coverage"] == 0.456
    info = SymbolInfo("601088", "fixture", "个股", "", "主板", 0.1)
    result = engine._assemble(info, 10, "2026-11-27", row, "grid", True)
    assert result.direction == 0 and result.probability is None
    assert result.evaluation == {"type": "in_sample", "calibrated": False}
    assert result.method == "fullfit_recency_weighted_v1"
    assert any("工作日近似" in warning for warning in result.warnings)
