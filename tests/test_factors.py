"""backend.factors Phase 0 测试：评估口径、DSL、种子规则、服务边界。

全部离线；真实数据目录缺失时跳过对应用例。
"""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from backend.factors.dataset import default_data_root
from backend.factors.dsl import (
    DslError,
    evaluate_spec,
    validate_spec,
    verify_no_lookahead,
)
from backend.factors.evaluate import evaluate_directions
from backend.factors.seed_pool import BASELINE_UP, SEEDS, discovery_rules
from backend.factors.service import FactorError, FactorService
from backend.factors.targets import direction_from_scores

REAL_ROOT = default_data_root()


# ---------------------------------------------------------------------- 工具
def _synthetic_bars(n: int = 600, seed: int = 7, start: str = "2015-01-05") -> pd.DataFrame:
    """生成带趋势/波动/量能结构的合成日线（字段与东财 CSV 一致）。"""
    rng = np.random.default_rng(seed)
    ret = rng.normal(0.0004, 0.018, n)
    close = 10.0 * np.exp(np.cumsum(ret))
    prev = np.r_[close[0], close[:-1]]
    open_ = prev * (1.0 + rng.normal(0.0, 0.004, n))
    high = np.maximum(open_, close) * (1.0 + np.abs(rng.normal(0.0, 0.006, n)))
    low = np.minimum(open_, close) * (1.0 - np.abs(rng.normal(0.0, 0.006, n)))
    volume = np.abs(rng.lognormal(13.0, 0.45, n))
    amount = volume * close * 100.0
    return pd.DataFrame(
        {
            "date": pd.bdate_range(start, periods=n),
            "open": open_,
            "close": close,
            "high": high,
            "low": low,
            "volume": volume,
            "amount": amount,
            "amplitude": (high - low) / prev * 100.0,
            "pct_chg": (close / prev - 1.0) * 100.0,
            "change": close - prev,
            "turnover": volume / 1e6,
        }
    )


def _write_csv(path: Path, bars: pd.DataFrame) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bars.to_csv(path, index=False, encoding="utf-8-sig")


def _real_601088() -> Path | None:
    d = REAL_ROOT / "个股"
    if not d.is_dir():
        return None
    hits = sorted(d.glob("601088_*.csv"))
    return hits[0] if hits else None


def _add_tree(depth: int):
    if depth == 0:
        return 1.0
    return {"op": "add", "args": [_add_tree(depth - 1), _add_tree(depth - 1)]}


# ---------------------------------------------------------------------- 口径
def test_accuracy_half_bars():
    """10 根上涨 + 10 根回落，全看涨，h=1：20 个窗口命中 10 个。"""
    close = np.concatenate([np.linspace(100.0, 110.0, 11), np.linspace(109.0, 100.0, 10)])
    direction = np.ones(len(close), dtype=int)
    metrics = evaluate_directions(close, direction, horizons=[1])

    assert metrics["evaluated"] == 20
    assert metrics["correct"] == 10
    assert metrics["accuracy"] == pytest.approx(0.5)
    assert metrics["coverage"] == pytest.approx(1.0)
    assert metrics["confusion"]["pred_up"]["up"] == 10
    assert metrics["confusion"]["pred_up"]["down"] == 10
    assert metrics["flat_wrong"] == 0
    assert metrics["per_horizon"][0]["h"] == 1


def test_neutral_direction_skips_everything():
    close = np.linspace(100.0, 110.0, 30)
    metrics = evaluate_directions(close, np.zeros(len(close), dtype=int))

    assert metrics["evaluated"] == 0
    assert metrics["correct"] == 0
    assert metrics["accuracy"] is None
    assert metrics["coverage"] == 0.0
    assert metrics["skipped"] > 0
    assert metrics["skipped"] + metrics["not_evaluated"] == metrics["total_windows"]


def test_flat_window_counts_as_wrong():
    close = np.array([100.0, 100.5, 100.5, 101.0, 100.0])
    metrics = evaluate_directions(close, np.ones(len(close), dtype=int), horizons=[1])

    assert metrics["evaluated"] == 4
    assert metrics["flat_wrong"] == 1
    assert metrics["correct"] == 2
    assert metrics["wrong"] == 2
    assert metrics["accuracy"] == pytest.approx(0.5)
    assert metrics["confusion"]["pred_up"]["flat"] == 1


def test_tail_windows_not_evaluated():
    close = np.linspace(100.0, 124.0, 25)
    metrics = evaluate_directions(close, np.ones(len(close), dtype=int), horizons=[20])

    assert metrics["total_windows"] == 25
    assert metrics["evaluated"] == 5
    assert metrics["not_evaluated"] == 20
    assert metrics["valid_timepoints"] == 5
    assert metrics["accuracy"] == pytest.approx(1.0)


# ---------------------------------------------------------------------- DSL
@pytest.mark.parametrize(
    "spec",
    [
        {"op": "unknown_op"},
        {"op": "ma_gap", "n": 0},
        {"op": "ma_gap", "n": 251},
        {"op": "ma_gap", "n": 20.5},
        {"op": "ma_gap", "n": True},
        {"op": "ma_gap", "n": 20, "args": [1]},
        {"op": "gt", "args": [1]},
        {"op": "gt", "args": [1, 2, 3]},
        {"op": "gt", "args": [1, 2], "field": "close"},
        {"op": "shift", "n": -1},
        {"op": "ret_n", "args": [{"op": "shift", "n": -1, "args": [1]}]},
        {"op": "target", "args": []},
        "close",
    ],
)
def test_dsl_rejects_invalid_specs(spec):
    with pytest.raises(DslError):
        validate_spec(spec)


def test_dsl_rejects_too_many_nodes():
    spec = _add_tree(10)  # 2047 个节点、深度 11
    with pytest.raises(DslError):
        validate_spec(spec)


def test_dsl_rejects_too_deep():
    node = 1.0
    for _ in range(13):
        node = {"op": "not", "args": [node]}
    with pytest.raises(DslError):
        validate_spec(node)


def test_dsl_accepts_valid_feature_and_arith():
    spec = {
        "op": "and",
        "args": [
            {"op": "gt", "args": [{"op": "ma_gap", "n": 20}, 0]},
            {
                "op": "lt",
                "args": [
                    {"op": "zscore", "args": [{"op": "atr", "n": 14}], "n": 60},
                    1.0,
                ],
            },
        ],
    }
    info = validate_spec(spec)
    assert info["nodes"] > 3
    assert "ma_gap" in info["ops"]


def test_no_lookahead_ma_gap():
    bars = _synthetic_bars(400)
    spec = {"op": "ma_gap", "n": 20}
    full = evaluate_spec(spec, bars)
    t = 300

    mutated = bars.copy()
    for col in ("open", "close", "high", "low", "volume"):
        mutated.loc[t + 1:, col] = mutated.loc[t + 1:, col] * 3.0
    after = evaluate_spec(spec, mutated)

    assert np.isfinite(full.iloc[t]) and np.isfinite(after.iloc[t])
    assert after.iloc[t] == pytest.approx(full.iloc[t], rel=1e-12, abs=1e-12)
    assert verify_no_lookahead(spec, bars)


# ---------------------------------------------------------------------- 种子
def test_seed_specs_validate_and_evaluate_on_synthetic(tmp_path):
    bars = _synthetic_bars(600)
    assert len(SEEDS) >= 18
    assert BASELINE_UP["id"] == "baseline_up"
    assert BASELINE_UP.get("non_discovery") is True

    for rule in SEEDS:
        info = validate_spec(rule["spec"])
        assert info["valid"] is True
        scores = evaluate_spec(rule["spec"], bars)
        assert len(scores) == len(bars)
        direction = direction_from_scores(scores, rule["neutral_band"])
        metrics = evaluate_directions(bars["close"].to_numpy(dtype=float), direction)
        assert len(metrics["per_horizon"]) == 20
        assert (
            metrics["evaluated"] + metrics["skipped"] + metrics["not_evaluated"]
            == metrics["total_windows"]
        )
        if metrics["accuracy"] is not None:
            assert 0.0 <= metrics["accuracy"] <= 1.0

    root = tmp_path / "root"
    _write_csv(root / "个股" / "000001_合成.csv", bars)
    service = FactorService(root)
    results = service.evaluate_seeds("000001")
    assert len(results) >= 10
    ids = [item["rule"]["id"] for item in results]
    assert "baseline_up" not in ids
    accuracies = [item["metrics"]["accuracy"] for item in results]
    assert accuracies == sorted(accuracies, reverse=True)


# ---------------------------------------------------------------------- 真实数据
def test_real_601088_seeds():
    path = _real_601088()
    if path is None:
        pytest.skip(f"真实数据缺失：{REAL_ROOT / '个股' / '601088_*.csv'}")

    service = FactorService(REAL_ROOT)
    bars = service.bars("601088")
    assert len(bars) > 200

    started = time.monotonic()
    results = service.evaluate_seeds("601088")
    elapsed = time.monotonic() - started
    assert elapsed < 5.0
    assert len(results) >= 10

    best = results[0]
    metrics = best["metrics"]
    assert 0.0 <= metrics["accuracy"] <= 1.0
    assert 0.0 <= metrics["coverage"] <= 1.0
    assert len(metrics["per_horizon"]) == 20
    assert metrics["evaluated"] > 0

    prediction = service.predict("601088")
    assert prediction["bars"] == len(bars)
    assert prediction["direction_now"] in (-1, 0, 1)
    assert prediction["rule"]["id"] == best["rule"]["id"]


# ---------------------------------------------------------------------- 错误
def test_service_error_paths(tmp_path):
    root = tmp_path / "root"
    _write_csv(root / "个股" / "000001_正常.csv", _synthetic_bars(150))
    _write_csv(root / "个股" / "000002_小样本.csv", _synthetic_bars(50))
    service = FactorService(root)

    assert service.available() is True
    assert len(service.symbols(limit=1)) == 1

    with pytest.raises(FactorError) as excinfo:
        service.bars("000001", timeframe="5m")
    assert excinfo.value.status == 400
    assert "1d" in str(excinfo.value)

    with pytest.raises(FactorError) as excinfo:
        service.bars("999999")
    assert excinfo.value.status == 404

    with pytest.raises(FactorError) as excinfo:
        service.bars("000002")
    assert excinfo.value.status == 503
    assert "100" in str(excinfo.value)

    empty = FactorService(tmp_path / "empty")
    assert empty.available() is False


# ------------------------------------------------------------ 只读 API 方法
def _service_with_synthetic(tmp_path: Path) -> FactorService:
    root = tmp_path / "root"
    _write_csv(root / "个股" / "000001_合成.csv", _synthetic_bars(600, seed=11))
    return FactorService(root)


def test_rule_by_id_contract():
    rule = FactorService.rule_by_id("trend_ma20")
    assert rule is not None
    for key in ("id", "name", "spec", "neutral_band"):
        assert key in rule
    assert rule["id"] == "trend_ma20"
    assert FactorService.rule_by_id("no_such_rule") is None
    assert FactorService.rule_by_id("") is None

    baseline = FactorService.rule_by_id("baseline_up")
    assert baseline is not None
    assert baseline.get("non_discovery") is True

    rules = discovery_rules()
    assert len(rules) >= 18
    assert all("neutral_band" in item for item in rules)
    assert all(item["id"] != "baseline_up" for item in rules)


def test_samples_false_positive_and_negative(tmp_path):
    service = _service_with_synthetic(tmp_path)
    long_spec = {"op": "gt", "args": [{"op": "ret_n", "n": 1}, 0]}

    false_positives = service.samples("000001", long_spec, side="false_positive", limit=5)
    assert 0 < len(false_positives) <= 5
    magnitudes = [abs(item["ret"]) for item in false_positives]
    assert magnitudes == sorted(magnitudes, reverse=True)
    for item in false_positives:
        assert set(item) == {"date", "h", "ret"}
        assert item["h"] in range(1, 21)
        assert isinstance(item["ret"], float)
        assert len(item["date"]) == 10

    # 只做多的规则不会产生 false_negative
    assert service.samples("000001", long_spec, side="false_negative", limit=5) == []

    short_spec = {"op": "sub", "args": [0, {"op": "lt", "args": [{"op": "ret_n", "n": 1}, 0]}]}
    false_negatives = service.samples("000001", short_spec, side="false_negative", limit=3)
    assert 0 < len(false_negatives) <= 3
    assert service.samples("000001", short_spec, side="false_positive", limit=3) == []


def test_samples_rejects_bad_arguments(tmp_path):
    service = _service_with_synthetic(tmp_path)
    spec = {"op": "ma_gap", "n": 20}

    with pytest.raises(FactorError) as excinfo:
        service.samples("000001", spec, side="whatever")
    assert excinfo.value.status == 400

    for bad_limit in (0, -1, True, "3"):
        with pytest.raises(FactorError) as excinfo:
            service.samples("000001", spec, limit=bad_limit)
        assert excinfo.value.status == 400


def test_evaluate_detail_envelope(tmp_path):
    service = _service_with_synthetic(tmp_path)
    spec = {"op": "ma_gap", "n": 20}

    detail = service.evaluate_detail("000001", spec)
    assert set(detail) == {"metrics", "samples"}
    assert set(detail["samples"]) == {"false_positive", "false_negative"}

    metrics = detail["metrics"]
    for key in ("accuracy", "coverage", "per_horizon", "code", "as_of", "data_version"):
        assert key in metrics
    assert len(metrics["per_horizon"]) == 20
    assert detail["metrics"] == service.evaluate("000001", spec)
    for side in ("false_positive", "false_negative"):
        assert len(detail["samples"][side]) <= 5


def test_predict_rule_includes_neutral_band(tmp_path):
    service = _service_with_synthetic(tmp_path)
    prediction = service.predict("000001")
    assert "neutral_band" in prediction["rule"]
    assert prediction["direction_now"] in (-1, 0, 1)
    assert prediction["bars"] == 600
    seeds = service.evaluate_seeds("000001")
    assert seeds
    assert all("neutral_band" in item["rule"] for item in seeds)
