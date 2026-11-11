"""构建脚本的离线校验：单文件、数据形状与脚本转义。"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_workbench", ROOT / "scripts" / "build_workbench.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


def _grid(tmp_path: Path, rows: int = 3) -> Path:
    data = {"generated_at": "2026-11-11", "snapshot": "2026-11-05", "scope": "in_sample",
            "data": [{"code": f"60000{i}", "category": "个股", "name": f"样本{i}",
                      "rows": [[600 + i, 120, 1, 520, 300] for _ in range(20)]}
                     for i in range(rows)]}
    path = tmp_path / "grid.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def test_snapshot_compacts_grid_and_keeps_category_identity(tmp_path):
    data = BUILDER.snapshot_data(_grid(tmp_path), "2026-11-05")
    assert data["snapshot"] == "2026-11-05"
    assert len(data["symbols"]) == 3
    code, category, name, rows = data["symbols"][0]
    assert (code, category) == ("600000", "个股")
    assert len(rows) == 20
    assert rows[1][0] == 600  # prob×1000 保持整数，避免浮点膨胀


def test_duplicate_identity_and_wrong_horizon_count_are_rejected(tmp_path):
    path = _grid(tmp_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["data"].append(dict(payload["data"][0]))
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="重复标的"):
        BUILDER.snapshot_data(path)

    path = _grid(tmp_path / "x") if False else _grid(tmp_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["data"][0]["rows"] = payload["data"][0]["rows"][:10]
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="不是 20"):
        BUILDER.snapshot_data(path)


def test_single_file_has_no_external_assets(tmp_path):
    html = BUILDER.build(output=tmp_path / "out.html", source=_grid(tmp_path)).read_text(encoding="utf-8")
    assert "/*__WORKBENCH_" not in html
    assert "<script src=" not in html and "https://cdn." not in html
    raw = re.search(r'<script id="workbench-data" type="application/json">(.*?)</script>', html, re.S)[1]
    assert len(json.loads(raw)["symbols"]) == 3
    for text in ("Super Agent", "量化概率", "专家团队", "万物皆插件"):
        assert text in html


def test_embedded_json_cannot_close_script(tmp_path):
    path = _grid(tmp_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["data"][0]["name"] = "</script><b>x</b>"
    path.write_text(json.dumps(payload), encoding="utf-8")
    html = BUILDER.build(output=tmp_path / "o.html", source=path).read_text(encoding="utf-8")
    raw = re.search(r'<script id="workbench-data" type="application/json">(.*?)</script>', html, re.S)[1]
    assert "</script>" not in raw
    assert json.loads(raw)["symbols"][0][2] == "</script><b>x</b>"


def test_build_is_reproducible(tmp_path):
    source = _grid(tmp_path)
    a = BUILDER.build(output=tmp_path / "a.html", source=source).read_bytes()
    b = BUILDER.build(output=tmp_path / "b.html", source=source).read_bytes()
    assert a == b
