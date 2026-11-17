"""代码因子沙箱测试：AST 白名单、子进程执行、无前视校验、输出校验、缓存。

全部离线（不联网、不装依赖）；真实数据缺失时跳过对应用例。
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.factors.dataset import default_data_root
from backend.factors.sandbox import (
    CodeSandbox,
    SandboxError,
    run_code,
    validate_source,
    verify_no_lookahead,
)
from backend.factors.service import FactorError, FactorService, validate_code_source

REAL_ROOT = default_data_root()

MA_RULE = """
def factor(df):
    c = df["close"]
    m = F.rolling_mean(c, 20)
    return c / m - 1.0
"""

BOOL_RULE = """
def factor(df):
    return df["close"] > F.rolling_mean(df["close"], 5)
"""

FUTURE_INDEX_RULE = """
def factor(df):
    c = df["close"]
    n = len(c)
    out = [0.0] * n
    for i in range(n - 5):
        out[i] = 1.0 if c[i + 5] > c[i] else -1.0
    return out
"""

FUTURE_SHIFT_RULE = """
def factor(df):
    return F.shift(df["close"], -5) - df["close"]
"""


# ---------------------------------------------------------------------- 工具
def _synthetic_bars(n: int = 320, seed: int = 5) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    ret = rng.normal(0.0004, 0.016, n)
    close = 10.0 * np.exp(np.cumsum(ret))
    prev = np.r_[close[0], close[:-1]]
    open_ = prev * (1.0 + rng.normal(0.0, 0.004, n))
    high = np.maximum(open_, close) * (1.0 + np.abs(rng.normal(0.0, 0.006, n)))
    low = np.minimum(open_, close) * (1.0 - np.abs(rng.normal(0.0, 0.006, n)))
    volume = np.abs(rng.lognormal(13.0, 0.4, n))
    return pd.DataFrame(
        {
            "date": pd.bdate_range("2018-01-02", periods=n),
            "open": open_,
            "close": close,
            "high": high,
            "low": low,
            "volume": volume,
            "amount": volume * close * 100.0,
            "amplitude": (high - low) / prev * 100.0,
            "pct_chg": (close / prev - 1.0) * 100.0,
            "change": close - prev,
            "turnover": volume / 1e6,
        }
    )


def _write_csv(path, bars: pd.DataFrame) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bars.to_csv(path, index=False, encoding="utf-8-sig")


_COLUMNS = ("open", "high", "low", "close", "volume", "amount", "turnover")


@pytest.fixture(scope="module")
def columns() -> dict[str, np.ndarray]:
    bars = _synthetic_bars()
    return {name: bars[name].to_numpy(dtype=float) for name in _COLUMNS}


@pytest.fixture(scope="module")
def synthetic_service(tmp_path_factory) -> FactorService:
    root = tmp_path_factory.mktemp("code_factor") / "root"
    _write_csv(root / "个股" / "000001_合成.csv", _synthetic_bars())
    return FactorService(root)


def _real_601088():
    d = REAL_ROOT / "个股"
    if not d.is_dir():
        return None
    hits = sorted(d.glob("601088_*.csv"))
    return hits[0] if hits else None


# ------------------------------------------------------------ 1. 合法规则
def test_legal_ma_rule_length_and_metrics(columns, synthetic_service):
    out = run_code(MA_RULE, columns)
    assert out.shape == (len(columns["close"]),)
    assert np.isfinite(out[20:]).all()
    assert np.isnan(out[:19]).all()  # 20 根窗口的自然暖机段

    metrics = synthetic_service.evaluate_code("000001", MA_RULE)
    assert metrics["kind"] == "code"
    assert metrics["code"] == "000001"
    assert metrics["timeframe"] == "1d"
    assert metrics["bars"] == 320
    assert metrics["data_version"]
    assert metrics["as_of"]
    assert metrics["source_sha256"]
    assert len(metrics["per_horizon"]) == 20
    assert metrics["evaluated"] > 0
    assert 0.0 <= metrics["accuracy"] <= 1.0
    assert 0.0 <= metrics["coverage"] <= 1.0
    assert (
        metrics["evaluated"] + metrics["skipped"] + metrics["not_evaluated"]
        == metrics["total_windows"]
    )
    # 截断无前视校验确实跑过（2 个随机 t）
    assert len(metrics["lookahead_checked"]) == 2


# ------------------------------------------------------------ 2. bool -> 0/1
def test_bool_rule_becomes_zero_one(columns):
    out = run_code(BOOL_RULE, columns)
    assert out.shape == (len(columns["close"]),)
    finite = out[np.isfinite(out)]
    assert finite.size == len(finite)
    assert set(np.unique(finite).tolist()) <= {0.0, 1.0}
    assert finite.max() == 1.0
    # rolling_mean(5) 前 4 根是 NaN，比较结果 False -> 0（中性），不是 NaN
    assert np.all(out[:4] == 0.0)


def test_columns_are_read_only(columns):
    """列数组在子进程里被 setflags(write=False)，模型不能就地改写行情。"""
    source = "def factor(df):\n    c = df['close']\n    c[0] = 1.0\n    return c\n"
    with pytest.raises(SandboxError) as excinfo:
        run_code(source, columns)
    assert "取值错误" in str(excinfo.value)


# ------------------------------------------------------------ 3. 未来函数
def test_future_indexing_rejected(columns, synthetic_service):
    with pytest.raises(SandboxError) as excinfo:
        verify_no_lookahead(FUTURE_INDEX_RULE, columns)
    assert "未来数据" in str(excinfo.value)

    # 全链路：evaluate_code 也不放行
    with pytest.raises(SandboxError):
        synthetic_service.evaluate_code("000001", FUTURE_INDEX_RULE)


def test_future_shift_rejected(columns):
    with pytest.raises(SandboxError) as excinfo:
        verify_no_lookahead(FUTURE_SHIFT_RULE, columns)
    assert "未来数据" in str(excinfo.value)


# ------------------------------------------------------------ 4. import
def test_import_rejected():
    source = "import os\ndef factor(df):\n    return df['close']\n"
    with pytest.raises(SandboxError) as excinfo:
        validate_source(source)
    assert "Import" in str(excinfo.value)
    with pytest.raises(SandboxError):
        run_code(source, {"close": np.ones(60)})


# ------------------------------------------------------------ 5. open
def test_open_rejected():
    source = "def factor(df):\n    return open('x')\n"
    with pytest.raises(SandboxError) as excinfo:
        validate_source(source)
    assert "open" in str(excinfo.value)
    with pytest.raises(SandboxError):
        run_code(source, {"close": np.ones(60)})


# ------------------------------------------------------------ 6. __class__
def test_dunder_attribute_rejected():
    source = "def factor(df):\n    return df['close'].__class__\n"
    with pytest.raises(SandboxError) as excinfo:
        validate_source(source)
    assert "__class__" in str(excinfo.value)
    with pytest.raises(SandboxError):
        run_code(source, {"close": np.ones(60)})


def test_format_string_escape_rejected():
    source = "def factor(df):\n    return '{0.__class__}'.format(df['close'])\n"
    with pytest.raises(SandboxError) as excinfo:
        validate_source(source)
    assert "format" in str(excinfo.value)


# ------------------------------------------------------------ 7. 死循环超时
def test_infinite_loop_times_out(columns):
    sandbox = CodeSandbox(timeout=1.0)
    source = "def factor(df):\n    while True:\n        pass\n"
    with pytest.raises(SandboxError) as excinfo:
        sandbox.run(source, columns)
    assert "超时" in str(excinfo.value)


# ------------------------------------------------------------ 8. 长度错误
def test_wrong_length_rejected(columns):
    source = "def factor(df):\n    return [0.0] * (len(df) - 1)\n"
    with pytest.raises(SandboxError) as excinfo:
        run_code(source, columns)
    assert "长度" in str(excinfo.value)


# ------------------------------------------------------------ 9. 确定性 + 缓存
def test_same_inputs_same_outputs_and_cache(columns):
    sandbox = CodeSandbox()
    first = sandbox.run(MA_RULE, columns)
    second = sandbox.run(MA_RULE, columns)
    np.testing.assert_array_equal(first, second)

    cached_a = sandbox.run_cached(MA_RULE, columns, "v1")
    cached_b = sandbox.run_cached(MA_RULE, columns, "v1")
    np.testing.assert_array_equal(cached_a, cached_b)
    info = sandbox.cache_info()
    assert info["misses"] == 1
    assert info["hits"] == 1
    assert info["size"] == 1
    # 缓存返回的是副本，调用方改写不会污染缓存
    cached_b[:] = 0.0
    again = sandbox.run_cached(MA_RULE, columns, "v1")
    assert not np.all(again[np.isfinite(again)] == 0.0)


# ------------------------------------------------------------ 10. 边界
def test_missing_entry_rejected():
    with pytest.raises(SandboxError) as excinfo:
        validate_code_source("def other(df):\n    return []\n")
    assert "factor" in str(excinfo.value)


def test_long_string_constant_rejected():
    source = "def factor(df):\n    s = '" + "a" * 2000 + "'\n    return df['close']\n"
    with pytest.raises(SandboxError) as excinfo:
        validate_source(source)
    assert "过长" in str(excinfo.value)


def test_all_nan_output_is_allowed(columns):
    source = "def factor(df):\n    return [float('nan')] * len(df)\n"
    out = run_code(source, columns)
    assert out.shape == (len(columns["close"]),)
    assert np.isnan(out).all()


def test_samples_code_side_validation(synthetic_service):
    with pytest.raises(FactorError) as excinfo:
        synthetic_service.samples_code("000001", MA_RULE, side="whatever")
    assert excinfo.value.status == 400


def test_samples_code_window_shape(synthetic_service):
    rows = synthetic_service.samples_code(
        "000001", "def factor(df):\n    return df['close'] - F.shift(df['close'], 1)\n",
        side="false_positive", limit=3,
    )
    assert 0 < len(rows) <= 3
    for row in rows:
        assert set(row) == {"date", "h", "ret"}
        assert row["h"] in range(1, 21)
        assert isinstance(row["ret"], float)
        assert len(row["date"]) == 10
    magnitudes = [abs(r["ret"]) for r in rows]
    assert magnitudes == sorted(magnitudes, reverse=True)


# ------------------------------------------------------------ 11. 真实数据
def test_real_601088_momentum_code_rule():
    if _real_601088() is None:
        pytest.skip(f"真实数据缺失：{REAL_ROOT / '个股' / '601088_*.csv'}")

    service = FactorService(REAL_ROOT)
    source = """
def factor(df):
    c = df["close"]
    fast = F.rolling_mean(c, 10)
    slow = F.rolling_mean(c, 30)
    return fast / slow - 1.0
"""
    metrics = service.evaluate_code("601088", source)
    assert metrics["kind"] == "code"
    assert metrics["code"] == "601088"
    assert metrics["bars"] > 200
    assert 0.0 <= metrics["accuracy"] <= 1.0
    assert metrics["coverage"] is not None
    assert metrics["evaluated"] > 0
    assert metrics["not_evaluated"] > 0  # 末尾 20 根没有未来
    assert metrics["source_sha256"]
