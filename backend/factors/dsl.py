"""安全 JSON 表达式树（DSL）：只解释白名单算子，绝不 exec / eval 用户代码。

节点格式::

    {"op": "gt", "args": [{"op": "ma_gap", "n": 20}, 0]}

叶子可以是数字常量（int / float）。需要窗口参数的算子把 ``n`` 放在节点上，
特征节点本身不带参数（如 ``{"op": "rsi", "n": 14}``）；``zscore`` / ``rolling_*``
把待处理序列放在 ``args[0]``。

因果性：所有特征都是「后视窗口」（pandas rolling / shift 只回看），
``evaluate_spec`` 只读 t 及之前的数据。``verify_no_lookahead`` 用截断重算做实证校验。
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

MAX_NODES = 200
MAX_DEPTH = 12
N_MIN = 1
N_MAX = 250

_NODE_KEYS = frozenset({"op", "args", "n"})
_FORBIDDEN_WORDS = (
    "shift", "future", "target", "label", "lead", "lookahead", "forward", "next",
)

_LOGICAL = {"and": 2, "or": 2, "not": 1}
_COMPARE = {"gt": 2, "gte": 2, "lt": 2, "lte": 2, "between": 3}
_MATH = {"add": 2, "sub": 2, "mul": 2, "div": 2, "abs": 1, "min": 2, "max": 2, "clip": 3}
_PRICE_N = frozenset(
    {
        "ma_gap", "ret_n", "rsi", "atr", "vol_ratio", "range_pos",
        "close_over_ma", "close_over_max", "turnover_z",
    }
)
_PRICE_CONST = frozenset({"gap_pct", "macd_hist"})
_SERIES_N = frozenset(
    {"zscore", "rolling_mean", "rolling_std", "rolling_min", "rolling_max"}
)

ARITY: dict[str, int] = {}
ARITY.update(_LOGICAL)
ARITY.update(_COMPARE)
ARITY.update(_MATH)
ARITY.update({k: 0 for k in _PRICE_N})
ARITY.update({k: 0 for k in _PRICE_CONST})
ARITY.update({k: 1 for k in _SERIES_N})
NEEDS_N = frozenset(_PRICE_N) | _SERIES_N
ALL_OPS = frozenset(ARITY)


class DslError(ValueError):
    """DSL 校验/求值失败（未知算子、窗口越界、节点过多、深度过大等）。"""


# ---------------------------------------------------------------------- 校验
def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float, np.integer, np.floating)) and not isinstance(
        value, (bool, np.bool_)
    )


def _walk(node: Any, depth: int, st: dict) -> None:
    if depth > MAX_DEPTH:
        raise DslError(f"节点深度超过上限 {MAX_DEPTH}")
    st["depth"] = max(st["depth"], depth)

    if _is_number(node):
        if not math.isfinite(float(node)):
            raise DslError(f"常量必须是有限数字: {node!r}")
        st["nodes"] += 1
        if st["nodes"] > MAX_NODES:
            raise DslError(f"节点数超过上限 {MAX_NODES}")
        return

    if not isinstance(node, dict):
        raise DslError(f"节点必须是对象或数字常量: {node!r}")

    extra = set(node) - _NODE_KEYS
    if extra:
        raise DslError(f"出现白名单外字段: {sorted(extra)}")

    op = node.get("op")
    if not isinstance(op, str) or not op:
        raise DslError("节点缺少字符串 op")
    lowered = op.lower()
    if any(word in lowered for word in _FORBIDDEN_WORDS):
        raise DslError(f"禁止使用前视/未来算子: {op}")
    if op not in ARITY:
        raise DslError(f"未知算子: {op}")

    st["nodes"] += 1
    if st["nodes"] > MAX_NODES:
        raise DslError(f"节点数超过上限 {MAX_NODES}")
    st["ops"].add(op)

    args = node.get("args", [])
    if not isinstance(args, list):
        raise DslError(f"{op}.args 必须是列表")
    if len(args) != ARITY[op]:
        raise DslError(f"{op} 需要 {ARITY[op]} 个参数，实际 {len(args)} 个")

    has_n = "n" in node
    if op in NEEDS_N:
        if not has_n:
            raise DslError(f"{op} 缺少窗口参数 n")
        n = node["n"]
        if isinstance(n, (bool, np.bool_)) or not isinstance(n, (int, np.integer)):
            raise DslError(f"{op}.n 必须是 int，实际 {type(n).__name__}")
        if int(n) < N_MIN or int(n) > N_MAX:
            raise DslError(f"{op}.n 超出范围 {N_MIN}..{N_MAX}: {int(n)}")
    elif has_n:
        raise DslError(f"{op} 不接受窗口参数 n")

    for child in args:
        _walk(child, depth + 1, st)


def validate_spec(spec: Any) -> dict:
    """静态校验表达式树；返回节点数/深度/算子集合。"""
    st: dict = {"nodes": 0, "depth": 0, "ops": set()}
    _walk(spec, 1, st)
    return {
        "valid": True,
        "nodes": int(st["nodes"]),
        "depth": int(st["depth"]),
        "ops": sorted(st["ops"]),
    }


# ---------------------------------------------------------------------- 求值
def _freeze(node: Any):
    if _is_number(node):
        return ("const", float(node))
    if isinstance(node, dict):
        op = node.get("op")
        n = node.get("n")
        args = node.get("args", [])
        return (op, None if n is None else int(n), tuple(_freeze(a) for a in args))
    return ("raw", repr(node))


class _Ctx:
    """一次求值共享的列缓存与子树结果缓存。"""

    def __init__(self, bars: pd.DataFrame):
        if not isinstance(bars, pd.DataFrame):
            raise DslError("bars 必须是 pandas.DataFrame")
        if "close" not in bars.columns:
            raise DslError("bars 缺少 close 列")
        self.index = bars.index
        self.n = int(len(bars))
        self.cache: dict[Any, pd.Series] = {}
        self._cols: dict[str, pd.Series] = {}
        for name in ("open", "high", "low", "close", "volume", "amount", "turnover"):
            if name in bars.columns:
                self._cols[name] = pd.to_numeric(bars[name], errors="coerce").astype(float)
            else:
                self._cols[name] = pd.Series(np.zeros(self.n), index=self.index, dtype=float)

    def col(self, name: str) -> pd.Series:
        return self._cols[name]

    def const(self, value: float) -> pd.Series:
        return pd.Series(np.full(self.n, float(value)), index=self.index, dtype=float)


def _arr(series: pd.Series) -> np.ndarray:
    if isinstance(series, pd.Series):
        return series.to_numpy(dtype=float)
    return np.asarray(series, dtype=float)


def _to_bool(series) -> np.ndarray:
    arr = _arr(series)
    return np.where(np.isfinite(arr), arr != 0.0, False)


def _bool_series(arr: np.ndarray, index) -> pd.Series:
    return pd.Series(np.asarray(arr, dtype=bool), index=index)


def _finite(series) -> pd.Series:
    """把 ±inf 归一成 NaN（保持索引）。"""
    if isinstance(series, pd.Series):
        arr = series.to_numpy(dtype=float)
        return pd.Series(np.where(np.isfinite(arr), arr, np.nan), index=series.index)
    arr = np.asarray(series, dtype=float)
    return pd.Series(np.where(np.isfinite(arr), arr, np.nan))


def _roll(series: pd.Series, n: int, how: str) -> pd.Series:
    win = series.rolling(int(n), min_periods=int(n))
    if how == "std":
        return win.std(ddof=0)
    return getattr(win, how)()


def _zscore(series: pd.Series, n: int) -> pd.Series:
    mean = _roll(series, n, "mean")
    std = _roll(series, n, "std")
    out = (series - mean) / std.where(std > 0)
    return _finite(out)


def _rsi(close: pd.Series, n: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()
    avg_loss = loss.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()
    rs = avg_gain / avg_loss.where(avg_loss > 0)
    out = 100.0 - 100.0 / (1.0 + rs)
    out = out.mask((avg_loss <= 0) & (avg_gain > 0), 100.0)
    out = out.mask((avg_loss <= 0) & (avg_gain <= 0), np.nan)
    return out


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, n: int) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [(high - low).abs(), (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()


def _macd_hist(close: pd.Series) -> pd.Series:
    ema12 = close.ewm(span=12, adjust=False, min_periods=12).mean()
    ema26 = close.ewm(span=26, adjust=False, min_periods=26).mean()
    dif = ema12 - ema26
    dea = dif.ewm(span=9, adjust=False, min_periods=9).mean()
    return dif - dea


def _feature(op: str, node: dict, args: list, ctx: _Ctx) -> pd.Series:
    close = ctx.col("close")
    if op == "ma_gap":
        n = int(node["n"])
        return _finite(close / _roll(close, n, "mean") - 1.0)
    if op == "ret_n":
        n = int(node["n"])
        return _finite(close / close.shift(n) - 1.0)
    if op == "rsi":
        return _rsi(close, int(node["n"]))
    if op == "atr":
        return _atr(ctx.col("high"), ctx.col("low"), close, int(node["n"]))
    if op == "vol_ratio":
        n = int(node["n"])
        vol = ctx.col("volume")
        return _finite(vol / _roll(vol, n, "mean"))
    if op == "range_pos":
        n = int(node["n"])
        lo = _roll(ctx.col("low"), n, "min")
        hi = _roll(ctx.col("high"), n, "max")
        rng = hi - lo
        return _finite((close - lo) / rng.where(rng > 0))
    if op == "gap_pct":
        return _finite(ctx.col("open") / close.shift(1) - 1.0)
    if op == "macd_hist":
        return _macd_hist(close)
    if op == "close_over_ma":
        n = int(node["n"])
        ma = _roll(close, n, "mean")
        return pd.Series(np.sign((close - ma).to_numpy(dtype=float)), index=ctx.index)
    if op == "close_over_max":
        n = int(node["n"])
        return _finite(close / _roll(close, n, "max") - 1.0)
    if op == "turnover_z":
        return _zscore(ctx.col("turnover"), int(node["n"]))
    if op == "zscore":
        return _zscore(_as_float_series(_eval(args[0], ctx), ctx), int(node["n"]))
    if op in ("rolling_mean", "rolling_std", "rolling_min", "rolling_max"):
        how = op.split("_", 1)[1]
        return _roll(_as_float_series(_eval(args[0], ctx), ctx), int(node["n"]), how)
    raise DslError(f"未知算子: {op}")


def _as_float_series(series, ctx: _Ctx) -> pd.Series:
    if isinstance(series, pd.Series):
        return series.astype(float)
    return ctx.const(float(series))


def _apply(op: str, node: dict, args: list, ctx: _Ctx) -> pd.Series:
    index = ctx.index
    if op in _LOGICAL:
        if op == "not":
            return _bool_series(~_to_bool(_eval(args[0], ctx)), index)
        left = _to_bool(_eval(args[0], ctx))
        right = _to_bool(_eval(args[1], ctx))
        return _bool_series(left & right if op == "and" else left | right, index)

    if op in _COMPARE:
        with np.errstate(invalid="ignore"):
            x = _arr(_eval(args[0], ctx))
            if op == "between":
                lo = _arr(_eval(args[1], ctx))
                hi = _arr(_eval(args[2], ctx))
                return _bool_series((x >= lo) & (x <= hi), index)
            y = _arr(_eval(args[1], ctx))
            if op == "gt":
                out = x > y
            elif op == "gte":
                out = x >= y
            elif op == "lt":
                out = x < y
            else:
                out = x <= y
        return _bool_series(out, index)

    if op in _MATH:
        x = _arr(_eval(args[0], ctx))
        if op == "abs":
            return pd.Series(np.abs(x), index=index)
        if op == "clip":
            lo = _arr(_eval(args[1], ctx))
            hi = _arr(_eval(args[2], ctx))
            return pd.Series(np.clip(x, lo, hi), index=index)
        y = _arr(_eval(args[1], ctx))
        with np.errstate(invalid="ignore", divide="ignore", over="ignore"):
            if op == "add":
                out = x + y
            elif op == "sub":
                out = x - y
            elif op == "mul":
                out = x * y
            elif op == "div":
                out = x / y
            elif op == "min":
                out = np.minimum(x, y)
            elif op == "max":
                out = np.maximum(x, y)
            else:  # pragma: no cover - 由 ARITY 白名单保证
                raise DslError(f"未知算子: {op}")
        return _finite(pd.Series(out, index=index))

    return _feature(op, node, args, ctx)


def _eval(node: Any, ctx: _Ctx) -> pd.Series:
    if _is_number(node):
        return ctx.const(float(node))
    if not isinstance(node, dict):
        raise DslError(f"非法节点: {node!r}")
    key = _freeze(node)
    hit = ctx.cache.get(key)
    if hit is not None:
        return hit
    op = node.get("op")
    if op not in ARITY:
        raise DslError(f"未知算子: {op}")
    out = _apply(op, node, node.get("args", []), ctx)
    if not isinstance(out, pd.Series):
        out = pd.Series(np.asarray(out), index=ctx.index)
    ctx.cache[key] = out
    return out


def evaluate_spec(spec: Any, bars: pd.DataFrame, *, validate: bool = True) -> pd.Series:
    """在 bars 上求值，返回与 bars 索引对齐的 Series（float 或 bool，NaN 保留）。"""
    if validate:
        validate_spec(spec)
    ctx = _Ctx(bars)
    return _eval(spec, ctx)


# ---------------------------------------------------------------- 前视校验
def _same_value(a, b) -> bool:
    if isinstance(a, (bool, np.bool_)) or isinstance(b, (bool, np.bool_)):
        return bool(a) == bool(b)
    fa = float(a)
    fb = float(b)
    if math.isnan(fa) and math.isnan(fb):
        return True
    if math.isnan(fa) or math.isnan(fb):
        return False
    return abs(fa - fb) <= 1e-9 * max(1.0, abs(fa), abs(fb))


def verify_no_lookahead(
    spec: Any,
    bars: pd.DataFrame,
    indices=None,
    *,
    validate: bool = False,
) -> list[int]:
    """截断重算：把 t 之后的行删掉后，t 处的取值必须不变。返回已检查的 t 列表。"""
    if validate:
        validate_spec(spec)
    if not isinstance(bars, pd.DataFrame) or len(bars) == 0:
        return []
    full = evaluate_spec(spec, bars, validate=False)
    n = len(bars)
    if indices is None:
        wanted = [n - 1] if n < 3 else [n - 1, n // 2]
    else:
        wanted = [int(i) for i in indices]

    checked: list[int] = []
    for t in wanted:
        if t < 0:
            t += n
        if t < 0 or t >= n:
            continue
        trunc = evaluate_spec(spec, bars.iloc[: t + 1], validate=False)
        if len(trunc) != t + 1:
            raise DslError(f"前视校验失败：截断到 t={t} 后长度异常")
        if not _same_value(full.iloc[t], trunc.iloc[-1]):
            raise DslError(
                f"前视校验失败：t={t} 处的取值依赖了 t 之后的数据 "
                f"({full.iloc[t]!r} != {trunc.iloc[-1]!r})"
            )
        checked.append(t)
    return checked
