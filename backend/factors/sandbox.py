"""模型自写因子代码的执行沙箱（子进程 + AST 白名单 + 截断无前视校验）。

口径
----
模型写 ``def factor(df): ...``，返回与 bars 等长的数值数组：

* ``> 0`` 看涨，``< 0`` 看跌，``0`` / ``NaN`` 中性（由 service 侧取符号 + band）。
* 规则空间不设上限：允许任意循环、条件、numpy 向量运算（``df["close"]`` 返回的
  就是 ``numpy.ndarray``，算术/比较/布尔索引都可用）。
* 只禁止文件、网络、进程与反射逃逸：AST 静态白名单 + 子进程隔离，父进程
  从不 exec 模型代码。

隔离
----
1. 独立子进程：``python -I -c BOOTSTRAP``，stdin 收 JSON、stdout 回 JSON；
   父进程只做 AST 校验、超时/输出大小限制与结果校验。
2. 数据只以 OHLCV/turnover 的 JSON 数组传入；子进程重建 numpy 数组并包成
   只读 ``Bars``（只支持 ``df["close"]`` 列访问与 ``len(df)``）。
3. 命名空间只给内置白名单 + 一个 ``F`` 纯函数命名空间；不暴露
   ``numpy`` / ``pandas`` 模块对象，也没有 ``open`` / ``exec`` / ``eval`` /
   ``compile`` / ``__import__`` / ``globals`` / ``locals`` / ``getattr``。
4. AST 校验拒绝 import / class / with / try / raise / delete / yield / await /
   global / nonlocal；拒绝危险内置名；拒绝任何以 ``_`` 开头的属性
   （``__class__`` / ``__globals__`` 等）；拒绝 ``tofile`` / ``dump`` / ``load`` /
   ``write`` / ``read`` / ``system`` / ``popen`` / ``spawn`` / ``format`` 等属性；
   字符串常量有长度上限。

无前视
------
``verify_no_lookahead`` 做截断重算：对 2–3 个随机 t（避开最后 25 根）分别用
``df[:t+1]``、``df[:t+2]`` 运行，并与全长运行在 t 处的输出比较（容差 1e-9，
NaN 视为相等）。任一不一致即 ``SandboxError("检测到使用未来数据")``。

**这是强经验测试，不是形式化证明。** 只抽样 2–3 个 t，理论上存在只在其它位置
偷看未来、或只在特定切点露馅的规则可以漏过；它抓的是 ``shift(-5)`` /
``close[t+5]`` 这类常规未来函数。

缓存
----
按 ``(source 的 sha256, data_version)`` 缓存结果数组，LRU 32，避免同一规则
反复起进程。默认 ``DEFAULT_SANDBOX`` 是进程级单例。
"""
from __future__ import annotations

import ast
import hashlib
import json
import math
import random
import re
import subprocess
import sys
import os
import threading
import time
from collections import OrderedDict
from collections.abc import Mapping
from typing import Any

import numpy as np

TIMEOUT_SECONDS = 8.0
MAX_STDOUT_BYTES = 2 * 1024 * 1024
MAX_STDERR_CHARS = 2000
MAX_SOURCE_CHARS = 20000
MAX_STRING_CHARS = 1000
MAX_STRING_TOTAL = 4000
MAX_CACHE_SIZE = 32
LOOKAHEAD_SAMPLES = 2
LOOKAHEAD_TOL = 1e-9
LOOKAHEAD_TAIL = 25

_RESULT_MARKER = "@@FACTOR_RESULT@@"

# 危险内置名：AST 层直接拒绝（Child 里也根本没有这些名字）
_FORBIDDEN_NAMES = frozenset(
    {
        "open", "exec", "eval", "compile", "__import__", "globals", "locals",
        "getattr", "setattr", "delattr", "vars", "dir", "input", "breakpoint",
        "memoryview", "type", "object", "super", "classmethod", "staticmethod",
        "property", "print", "importlib", "os", "sys", "subprocess", "socket",
        "ctypes", "builtins", "__builtins__", "exit", "quit", "help", "license",
        "credits", "copyright", "breakpoint", "ascii", "repr",
    }
)

# 危险/IO/序列化属性名（前缀 "_" 的属性另有一票否决）
_FORBIDDEN_ATTRS = frozenset(
    {
        "tofile", "dump", "dumps", "load", "loads", "save", "savetxt", "savez",
        "fromfile", "memmap", "write", "writelines", "read", "readline",
        "system", "popen", "spawn", "spawnl", "spawnv", "fork", "kill",
        "exec", "eval", "compile", "format", "format_map", "ctypes",
        "data_as", "buffer_info", "getbuffer", "setflags", "resize",
        "attach", "connection", "cursor", "execute",
    }
)

_FORBIDDEN_NODES: tuple[type, ...] = (
    ast.Import,
    ast.ImportFrom,
    ast.ClassDef,
    ast.With,
    ast.AsyncWith,
    ast.Try,
    ast.Raise,
    ast.Delete,
    ast.Yield,
    ast.YieldFrom,
    ast.Await,
    ast.Global,
    ast.Nonlocal,
)
if hasattr(ast, "TryStar"):  # pragma: no cover - Python 3.11+ 才有
    _FORBIDDEN_NODES += (ast.TryStar,)

_PATH_RE = re.compile(r"(?:[A-Za-z]:[\\/][^\s'\"]*|(?:/[^\s'\"]+){2,})")

# 回传摘要用中文异常类别，不把 traceback 原文（可能带本机路径/环境）带给调用方
_EXC_LABELS = {
    "TypeError": "类型错误",
    "ValueError": "取值错误",
    "NameError": "未定义名字",
    "KeyError": "列名/键错误",
    "IndexError": "下标越界",
    "AttributeError": "属性错误",
    "ZeroDivisionError": "除零错误",
    "MemoryError": "内存不足",
    "RecursionError": "递归过深",
    "OverflowError": "数值溢出",
    "StopIteration": "迭代结束",
    "NotImplementedError": "未实现",
}


class SandboxError(Exception):
    """沙箱拒绝/执行失败；status 供 API 层映射成 400。"""

    status = 400

    def __init__(self, message: str, *, detail: str | None = None):
        super().__init__(message)
        self.message = str(message)
        self.detail = detail


# ---------------------------------------------------------------- AST 校验
class _Validator(ast.NodeVisitor):
    """静态白名单：解析后遍历，遇到禁止结构立即抛 SandboxError。"""

    def __init__(self) -> None:
        self.string_total = 0

    # -- 禁止的结构
    def generic_visit(self, node: ast.AST) -> None:
        if isinstance(node, _FORBIDDEN_NODES):
            raise SandboxError(f"第 {getattr(node, 'lineno', 0)} 行: 禁止使用 {type(node).__name__}")
        super().generic_visit(node)

    # -- 名字 / 属性 / 常量
    def visit_Name(self, node: ast.Name) -> None:
        name = node.id
        if name in _FORBIDDEN_NAMES:
            raise SandboxError(f"第 {node.lineno} 行: 禁止使用内置 {name}")
        if name.startswith("_") and name != "_":
            raise SandboxError(f"第 {node.lineno} 行: 禁止使用私有名字 {name}")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        attr = node.attr
        if attr.startswith("_"):
            raise SandboxError(f"第 {node.lineno} 行: 禁止访问私有属性 {attr}")
        if attr in _FORBIDDEN_ATTRS:
            raise SandboxError(f"第 {node.lineno} 行: 禁止访问属性 {attr}")
        self.generic_visit(node)

    def visit_Constant(self, node: ast.Constant) -> None:
        value = node.value
        if isinstance(value, str):
            if len(value) > MAX_STRING_CHARS:
                raise SandboxError(
                    f"第 {node.lineno} 行: 字符串常量过长（上限 {MAX_STRING_CHARS} 字符）"
                )
            self.string_total += len(value)
            if self.string_total > MAX_STRING_TOTAL:
                raise SandboxError(f"字符串常量总长度超过上限 {MAX_STRING_TOTAL}")
        elif isinstance(value, bytes) and len(value) > MAX_STRING_CHARS:
            raise SandboxError(f"第 {node.lineno} 行: bytes 常量过长")
        self.generic_visit(node)


def validate_source(source: Any) -> str:
    """静态校验模型代码，返回规范化后的源码；非法抛 SandboxError。"""
    if not isinstance(source, str):
        raise SandboxError("source 必须是字符串")
    text = source.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    if not text.strip():
        raise SandboxError("source 不能为空")
    if "\x00" in text:
        raise SandboxError("source 含非法字符")
    if len(text) > MAX_SOURCE_CHARS:
        raise SandboxError(f"source 过长（上限 {MAX_SOURCE_CHARS} 字符）")

    try:
        tree = ast.parse(text, filename="<factor>", mode="exec")
    except SyntaxError as exc:
        raise SandboxError(f"代码语法错误: 第 {exc.lineno or 0} 行") from None

    _Validator().visit(tree)

    entry = None
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "factor":
            entry = node
        elif isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "factor" for t in node.targets
        ):
            entry = node
    if entry is None:
        raise SandboxError("缺少入口函数：必须定义 def factor(df)")
    if isinstance(entry, (ast.FunctionDef, ast.AsyncFunctionDef)):
        required = len(entry.args.posonlyargs) + len(entry.args.args)
        if required < 1:
            raise SandboxError("入口函数 factor 必须接收一个参数（df）")
    return text


def source_sha256(source: str) -> str:
    """规范源码的 sha256（缓存键）。"""
    return hashlib.sha256(str(source).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- 子进程侧
_BOOTSTRAP = r'''
import json
import sys
import warnings

warnings.filterwarnings("ignore")
import numpy as np

_MARK = "@@FACTOR_RESULT@@"


def _emit(obj):
    sys.stdout.write("\n" + _MARK + json.dumps(obj, ensure_ascii=True) + "\n")
    sys.stdout.flush()


class _OutputError(Exception):
    pass


class _Bars:
    __slots__ = ("_cols", "_n", "_names")

    def __init__(self, cols):
        self._cols = cols
        self._n = len(next(iter(cols.values()))) if cols else 0
        self._names = tuple(sorted(cols))

    def __getitem__(self, key):
        if not isinstance(key, str) or key.startswith("_"):
            raise KeyError("非法列名")
        try:
            return self._cols[key]
        except KeyError:
            raise KeyError("未知列: " + str(key)[:32])

    def __getattr__(self, key):
        # Convenience for models used to df.close; still rejects private names.
        if isinstance(key, str) and not key.startswith("_") and key in self._cols:
            return self._cols[key]
        raise AttributeError("未知列: " + str(key)[:32])

    def __contains__(self, key):
        return isinstance(key, str) and key in self._cols

    def __len__(self):
        return self._n

    def __repr__(self):
        return "<Bars n=%d cols=%s>" % (self._n, ",".join(self._names))


def _arr(x):
    if isinstance(x, _Bars):
        raise TypeError("请先取列，例如 F.rolling_mean(df['close'], 20)")
    return np.asarray(x, dtype=float).reshape(-1)


def _rolling(x, n, how):
    n = int(n)
    if n < 1:
        raise ValueError("窗口 n 必须 >= 1")
    m = len(x)
    if n == 1:
        if how == "std":
            return np.zeros(m)
        return x.astype(float, copy=True)
    out = np.full(m, np.nan)
    if m < n:
        return out
    win = np.lib.stride_tricks.sliding_window_view(x, n)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if how == "mean":
            vals = np.nanmean(win, axis=1)
        elif how == "std":
            vals = np.nanstd(win, axis=1, ddof=0)
        elif how == "min":
            vals = np.nanmin(win, axis=1)
        else:
            vals = np.nanmax(win, axis=1)
    out[n - 1:] = vals
    return out


def _wilder(v, n):
    alpha = 1.0 / float(n)
    out = np.full(len(v), np.nan)
    prev = np.nan
    for i in range(len(v)):
        val = v[i]
        if not np.isfinite(val):
            continue
        if np.isfinite(prev):
            prev = alpha * val + (1.0 - alpha) * prev
        else:
            prev = val
        out[i] = prev
    return out


def _finite(x):
    x = np.asarray(x, dtype=float).reshape(-1)
    return np.where(np.isfinite(x), x, np.nan)


class _F:
    """纯函数命名空间：全部返回 numpy 数组，NaN 按中性处理。"""

    def rolling_mean(self, x, n):
        return _rolling(_arr(x), n, "mean")

    def rolling_std(self, x, n):
        return _rolling(_arr(x), n, "std")

    def rolling_min(self, x, n):
        return _rolling(_arr(x), n, "min")

    def rolling_max(self, x, n):
        return _rolling(_arr(x), n, "max")

    def ema(self, x, n):
        x = _arr(x)
        n = int(n)
        if n < 1:
            raise ValueError("ema 窗口 n 必须 >= 1")
        alpha = 2.0 / (n + 1.0)
        out = np.full(len(x), np.nan)
        prev = np.nan
        for i in range(len(x)):
            val = x[i]
            if not np.isfinite(val):
                out[i] = prev
                continue
            prev = val if not np.isfinite(prev) else alpha * val + (1.0 - alpha) * prev
            out[i] = prev
        return out

    def shift(self, x, n=1):
        x = _arr(x)
        k = int(n)
        out = np.full(len(x), np.nan)
        if k == 0:
            return x.astype(float, copy=True)
        if k > 0:
            if k < len(x):
                out[k:] = x[:-k]
        else:
            k = -k
            if k < len(x):
                out[:-k] = x[k:]
        return out

    def pct_change(self, x, n=1):
        x = _arr(x)
        prev = self.shift(x, n)
        with np.errstate(invalid="ignore", divide="ignore"):
            return _finite(x / prev - 1.0)

    def diff(self, x, n=1):
        x = _arr(x)
        return _finite(x - self.shift(x, n))

    def rsi(self, x, n=14):
        x = _arr(x)
        n = int(n)
        if n < 1:
            raise ValueError("rsi 窗口 n 必须 >= 1")
        delta = np.full(len(x), np.nan)
        if len(x) > 1:
            delta[1:] = np.diff(x)
        gain = np.where(np.isfinite(delta) & (delta > 0), delta, 0.0)
        loss = np.where(np.isfinite(delta) & (delta < 0), -delta, 0.0)
        ag = _wilder(gain, n)
        al = _wilder(loss, n)
        with np.errstate(invalid="ignore", divide="ignore"):
            rs = ag / al
            out = 100.0 - 100.0 / (1.0 + rs)
        out = np.where((al <= 0) & (ag > 0), 100.0, out)
        out = np.where((al <= 0) & (ag <= 0), np.nan, out)
        return out

    def atr(self, *args):
        if len(args) == 2:
            frame, n = args
            high = _arr(frame["high"])
            low = _arr(frame["low"])
            close = _arr(frame["close"])
        elif len(args) == 4:
            high, low, close, n = args
            high = _arr(high)
            low = _arr(low)
            close = _arr(close)
        else:
            raise TypeError("F.atr 用法：F.atr(df, n) 或 F.atr(high, low, close, n)")
        n = int(n)
        if n < 1:
            raise ValueError("atr 窗口 n 必须 >= 1")
        prev_close = np.full(len(close), np.nan)
        if len(close) > 1:
            prev_close[1:] = close[:-1]
        with np.errstate(invalid="ignore"):
            tr = np.nanmax(
                np.vstack([high - low, np.abs(high - prev_close), np.abs(low - prev_close)]),
                axis=0,
            )
        return _wilder(_finite(tr), n)

    def zscore(self, x, n):
        x = _arr(x)
        mean = _rolling(x, n, "mean")
        std = _rolling(x, n, "std")
        with np.errstate(invalid="ignore", divide="ignore"):
            return _finite((x - mean) / np.where(std > 0, std, np.nan))

    def where(self, cond, a, b):
        cond = np.asarray(cond)
        return np.where(cond, a, b)

    def clip(self, x, lo, hi):
        return np.clip(_arr(x), lo, hi)

    def log(self, x):
        with np.errstate(invalid="ignore", divide="ignore"):
            return _finite(np.log(_arr(x)))

    def sqrt(self, x):
        with np.errstate(invalid="ignore"):
            return _finite(np.sqrt(_arr(x)))

    def sign(self, x):
        return np.sign(_arr(x))

    def isnan(self, x):
        return np.isnan(_arr(x))

    def nan_to_num(self, x, nan=0.0, posinf=None, neginf=None, **kwargs):
        """Accept numpy-like keywords; infinities become the same neutral value."""
        fill = float(nan)
        return np.nan_to_num(_arr(x), nan=fill,
                             posinf=fill if posinf is None else float(posinf),
                             neginf=fill if neginf is None else float(neginf))

    def arange(self, *args):
        return np.arange(*args, dtype=float)

    def zeros(self, n):
        return np.zeros(int(n), dtype=float)

    def ones(self, n):
        return np.ones(int(n), dtype=float)

    def logical_and(self, a, b):
        return np.logical_and(np.asarray(a), np.asarray(b))

    def logical_or(self, a, b):
        return np.logical_or(np.asarray(a), np.asarray(b))

    def logical_not(self, a):
        return np.logical_not(np.asarray(a))

    def minimum(self, a, b):
        return np.minimum(a, b)

    def maximum(self, a, b):
        return np.maximum(a, b)


_SAFE_BUILTINS = {
    "len": len, "range": range, "abs": abs, "min": min, "max": max,
    "sum": sum, "float": float, "int": int, "bool": bool, "list": list,
    "dict": dict, "tuple": tuple, "set": set, "enumerate": enumerate,
    "zip": zip, "sorted": sorted, "round": round, "any": any, "all": all,
    "isinstance": isinstance,
}


class _NP:
    """Tiny numpy-like facade: computation only, no file/network/IO attributes."""

    nan = float("nan")
    inf = float("inf")
    pi = 3.141592653589793
    float64 = float

    def __init__(self, f):
        self._f = f

    def asarray(self, x, dtype=None):
        return np.asarray(x, dtype=float).reshape(-1)

    def array(self, x, dtype=None):
        return np.asarray(x, dtype=float)

    def reshape(self, x, shape):
        return np.asarray(x, dtype=float).reshape(shape)

    def ravel(self, x):
        return np.asarray(x, dtype=float).reshape(-1)

    def zeros(self, n):
        return np.zeros(int(n), dtype=float)

    def ones(self, n):
        return np.ones(int(n), dtype=float)

    def arange(self, *args):
        return np.arange(*args, dtype=float)

    def where(self, cond, a, b):
        return np.where(np.asarray(cond), a, b)

    def clip(self, x, lo, hi):
        return np.clip(_arr(x), lo, hi)

    def nan_to_num(self, x, nan=0.0, posinf=None, neginf=None, **kwargs):
        return self._f.nan_to_num(x, nan=nan, posinf=posinf, neginf=neginf)

    def isnan(self, x):
        return np.isnan(_arr(x))

    def isfinite(self, x):
        return np.isfinite(_arr(x))

    def abs(self, x):
        return np.abs(_arr(x))

    def sqrt(self, x):
        with np.errstate(invalid="ignore"):
            return _finite(np.sqrt(_arr(x)))

    def log(self, x):
        with np.errstate(invalid="ignore", divide="ignore"):
            return _finite(np.log(_arr(x)))

    def log1p(self, x):
        with np.errstate(invalid="ignore", divide="ignore"):
            return _finite(np.log1p(_arr(x)))

    def exp(self, x):
        with np.errstate(over="ignore"):
            return _finite(np.exp(_arr(x)))

    def tanh(self, x):
        return np.tanh(_arr(x))

    def sign(self, x):
        return np.sign(_arr(x))

    def floor(self, x):
        return np.floor(_arr(x))

    def ceil(self, x):
        return np.ceil(_arr(x))

    def power(self, a, b):
        with np.errstate(invalid="ignore", over="ignore"):
            return _finite(np.power(_arr(a), b))

    def logical_and(self, a, b):
        return np.logical_and(np.asarray(a), np.asarray(b))

    def logical_or(self, a, b):
        return np.logical_or(np.asarray(a), np.asarray(b))

    def logical_not(self, a):
        return np.logical_not(np.asarray(a))

    def isinf(self, x):
        return np.isinf(_arr(x))

    def absolute(self, x):
        return np.abs(_arr(x))

    def round(self, x, decimals=0, **kwargs):
        return np.round(_arr(x), int(decimals))

    def cumprod(self, x):
        return np.nancumprod(_arr(x))

    def minimum(self, a, b):
        return np.minimum(a, b)

    def maximum(self, a, b):
        return np.maximum(a, b)

    def diff(self, x, n=1):
        return np.diff(_arr(x), int(n))

    def mean(self, x):
        values = _arr(x)
        return float(np.nanmean(values)) if len(values) else 0.0

    def std(self, x, ddof=0, **kwargs):
        values = _arr(x)
        return float(np.nanstd(values)) if len(values) else 0.0

    def nanmean(self, x):
        return self.mean(x)

    def nanstd(self, x, **kwargs):
        return self.std(x)

    def nanmax(self, x):
        return float(np.nanmax(_arr(x)))

    def nanmin(self, x):
        return float(np.nanmin(_arr(x)))

    def sum(self, x):
        return float(np.nansum(_arr(x)))

    def cumsum(self, x):
        return np.nancumsum(_arr(x))

    def concatenate(self, arrays, axis=0):
        return np.concatenate([np.asarray(a, dtype=float) for a in arrays], axis=axis)

    def stack(self, arrays, axis=0):
        return np.stack([np.asarray(a, dtype=float) for a in arrays], axis=axis)

    def vstack(self, arrays):
        return np.vstack([np.asarray(a, dtype=float) for a in arrays])

    def hstack(self, arrays):
        return np.hstack([np.asarray(a, dtype=float) for a in arrays])

    def size(self, x):
        return int(np.asarray(x).size)


def _namespace():
    f = _F()
    npf = _NP(f)
    namespace = {"__builtins__": dict(_SAFE_BUILTINS), "F": f, "np": npf}
    for name in dir(f):
        if name.startswith("_") or name in _SAFE_BUILTINS:
            continue
        namespace[name] = getattr(f, name)
    # Also expose safe numpy-like helpers under their bare names (tanh, asarray,
    # nanmean, ...) so models do not have to guess whether the F/np prefix is
    # required. Builtins and already-provided names keep precedence.
    for name in dir(npf):
        if name.startswith("_") or name in _SAFE_BUILTINS or name in namespace:
            continue
        value = getattr(npf, name)
        if callable(value) or name in ("nan", "inf", "pi"):
            namespace[name] = value
    return namespace


def _line_of(exc):
    line = None
    tb = exc.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == "<factor>":
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def _error_info(exc):
    # Never stringify exceptions: AttributeError text can include the object's
    # repr (and thus source constants). Only Python's safe symbol metadata.
    name = exc.name if isinstance(exc, (NameError, AttributeError)) else None
    if not isinstance(name, str) or len(name) > 80 or not name.isidentifier():
        name = None
    return {"kind": type(exc).__name__, "line": _line_of(exc), "name": name}


def _coerce(res, n):
    if isinstance(res, _Bars):
        raise _OutputError("factor 必须返回数值数组，不能返回 df")
    try:
        arr = np.asarray(res)
    except Exception:
        raise _OutputError("返回值无法转换成数值数组")
    if arr.dtype == object:
        raise _OutputError("返回值必须是数值数组（当前是 object）")
    if arr.ndim != 1:
        raise _OutputError("返回值必须是一维数组（当前 %d 维）" % arr.ndim)
    if arr.shape[0] != n:
        raise _OutputError("返回长度 %d 与 bars 长度 %d 不一致" % (arr.shape[0], n))
    if arr.dtype == np.bool_:
        arr = arr.astype(float)
    elif np.issubdtype(arr.dtype, np.complexfloating):
        raise _OutputError("返回值不能是复数")
    elif not np.issubdtype(arr.dtype, np.number):
        raise _OutputError("返回值必须是数值，当前 dtype=%s" % arr.dtype)
    arr = arr.astype(float, copy=True)
    arr[~np.isfinite(arr)] = np.nan
    return arr


def _run():
    payload = json.loads(sys.stdin.read())
    cols = {k: np.asarray(v, dtype=float).reshape(-1) for k, v in payload["columns"].items()}
    for _name in cols:
        cols[_name].setflags(write=False)
    bars = _Bars(cols)
    namespace = _namespace()
    try:
        exec(compile(payload["source"], "<factor>", "exec"), namespace)
        fn = namespace.get("factor")
        if not callable(fn):
            raise _OutputError("缺少入口函数 def factor(df)")
        values = _coerce(fn(bars), len(bars))
    except _OutputError as exc:
        _emit({"ok": False, "error": "output", "message": str(exc)})
        return
    except BaseException as exc:
        _emit({"ok": False, "error": "exec", **_error_info(exc)})
        return
    _emit({"ok": True, "values": values.tolist()})


try:
    _run()
except BaseException as exc:
    _emit({"ok": False, "error": "fatal", "kind": type(exc).__name__})
'''


def _encode_columns(columns: Mapping[str, Any]) -> tuple[dict[str, list], int]:
    """把列映射编码成 JSON 数组；同时校验等长。"""
    if not isinstance(columns, Mapping):
        raise SandboxError("行情数据必须是 列名 -> 数值序列 的映射")
    encoded: dict[str, list] = {}
    length: int | None = None
    for key, value in columns.items():
        name = str(key)
        if not name or name.startswith("_"):
            raise SandboxError(f"非法列名: {name!r}")
        arr = np.asarray(value, dtype=float).reshape(-1)
        if length is None:
            length = int(arr.size)
        elif int(arr.size) != length:
            raise SandboxError("各列长度必须一致")
        encoded[name] = np.where(np.isfinite(arr), arr, np.nan).tolist()
    if not encoded or not length:
        raise SandboxError("行情数据为空")
    return encoded, int(length)


def _same_value(a: float, b: float) -> bool:
    fa = float(a)
    fb = float(b)
    if math.isnan(fa) and math.isnan(fb):
        return True
    if math.isnan(fa) or math.isnan(fb):
        return False
    return abs(fa - fb) <= LOOKAHEAD_TOL * max(1.0, abs(fa), abs(fb))


def _sanitize(text: str, limit: int = 300) -> str:
    """去掉本机路径等痕迹，只留短摘要。"""
    out = _PATH_RE.sub("<path>", str(text))
    out = out.replace("\r", " ").replace("\n", " ")
    out = " ".join(out.split())
    return out[:limit]


def _execution_diagnostic(reply):
    """Parent-side defensive validation of symbol-only child diagnostics."""
    kind = reply.get("kind")
    if not isinstance(kind, str) or len(kind) > 80 or not kind.isidentifier():
        kind = None
    name = reply.get("name")
    if not isinstance(name, str) or len(name) > 80 or not name.isidentifier():
        name = None
    line = reply.get("line")
    if type(line) is not int or not 1 <= line <= MAX_SOURCE_CHARS:
        line = None
    return kind, name, line


def _execution_message(kind, name, line):
    if kind in ("NameError", "UnboundLocalError"):
        message = f"{kind}：未定义符号" + (f" {name}" if name else "")
    elif kind == "AttributeError":
        message = "AttributeError：缺少属性" + (f" {name}" if name else "")
    else:
        message = str(kind or "执行失败")
    return message + (f"（第{line}行）" if line else "")


def _coerce_result(values: Any, n: int) -> np.ndarray:
    """父进程侧复检子进程回传的结果（防御性，双保险）。"""
    if not isinstance(values, list):
        raise SandboxError("输出校验失败: 沙箱返回值不是数组")
    try:
        arr = np.asarray(values)
    except (TypeError, ValueError):
        raise SandboxError("输出校验失败: 返回值不是数值数组") from None
    if arr.ndim != 1:
        raise SandboxError("输出校验失败: 返回值必须是一维数组")
    if arr.size != n:
        raise SandboxError(f"输出校验失败: 返回长度 {arr.size} 与 bars 长度 {n} 不一致")
    if arr.dtype == object or not np.issubdtype(arr.dtype, np.number):
        raise SandboxError("输出校验失败: 返回值必须是数值")
    if np.issubdtype(arr.dtype, np.complexfloating):
        raise SandboxError("输出校验失败: 返回值不能是复数")
    out = arr.astype(float, copy=True)
    out[~np.isfinite(out)] = np.nan
    return out


class CodeSandbox:
    """父子进程隔离的代码执行器（含 LRU 结果缓存）。"""

    def __init__(
        self,
        *,
        timeout: float = TIMEOUT_SECONDS,
        max_cache: int = MAX_CACHE_SIZE,
        max_stdout: int = MAX_STDOUT_BYTES,
    ):
        self.timeout = float(timeout)
        self.max_cache = max(1, int(max_cache))
        self.max_stdout = int(max_stdout)
        self._cache: OrderedDict[tuple[str, str], np.ndarray] = OrderedDict()
        self.hits = 0
        self.misses = 0

    # ------------------------------------------------------------ 底层执行
    def _spawn(self, payload: dict, timeout: float | None) -> dict:
        # ensure_ascii=True：子进程 stdio 用系统 locale 编解码，纯 ASCII 传输不受影响
        body = json.dumps(payload, ensure_ascii=True).encode("ascii")
        limit = self.timeout if timeout is None else float(timeout)
        stdout, stderr, returncode = _bounded_process(_BOOTSTRAP, body, limit, self.max_stdout)
        if len(stdout) > self.max_stdout:
            raise SandboxError(f"沙箱输出过大（> {self.max_stdout} 字节）")
        idx = stdout.rfind(_RESULT_MARKER.encode("ascii"))
        if idx < 0:
            tail = stderr.decode("utf-8", "replace")[:MAX_STDERR_CHARS]
            raise SandboxError(
                f"沙箱进程异常退出（returncode={returncode}）",
                detail=_sanitize(tail),
            )
        raw = stdout[idx + len(_RESULT_MARKER):].split(b"\n", 1)[0]
        try:
            return json.loads(raw.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            raise SandboxError("沙箱返回格式错误") from None

    def run(self, source: Any, columns: Mapping[str, Any], *, timeout: float | None = None) -> np.ndarray:
        """执行一次（不读缓存），返回长度与 bars 一致的 float 数组。"""
        text = validate_source(source)
        encoded, length = _encode_columns(columns)
        reply = self._spawn({"source": text, "columns": encoded}, timeout)
        if not isinstance(reply, dict):
            raise SandboxError("沙箱返回格式错误")
        if not reply.get("ok"):
            kind = str(reply.get("error") or "")
            if kind == "output":
                raise SandboxError(f"输出校验失败: {_sanitize(str(reply.get('message') or ''), 120)}")
            if kind == "exec":
                error_kind, name, line = _execution_diagnostic(reply)
                if error_kind in ("NameError", "UnboundLocalError", "AttributeError"):
                    raise SandboxError(_execution_message(error_kind, name, line))
                raw = str(reply.get("kind") or "")
                exc = _EXC_LABELS.get(raw, raw or "未知错误")
                if line:
                    raise SandboxError(f"第 {int(line)} 行: {exc}")
                raise SandboxError(f"执行失败: {exc}")
            raise SandboxError("沙箱执行失败")
        return _coerce_result(reply.get("values"), length)

    # ------------------------------------------------------------ 缓存
    def run_cached(
        self,
        source: Any,
        columns: Mapping[str, Any],
        data_version: Any,
    ) -> np.ndarray:
        """按 (源码 sha256, data_version) 取缓存，未命中才起子进程。"""
        text = validate_source(source)
        key = (source_sha256(text), str(data_version))
        hit = self._cache.get(key)
        if hit is not None:
            self._cache.move_to_end(key)
            self.hits += 1
            return hit.copy()
        self.misses += 1
        arr = self.run(text, columns)
        stored = arr.copy()
        stored.setflags(write=False)
        self._cache[key] = stored
        while len(self._cache) > self.max_cache:
            self._cache.popitem(last=False)
        return arr

    def cache_clear(self) -> None:
        self._cache.clear()

    def cache_info(self) -> dict[str, int]:
        return {
            "size": len(self._cache),
            "maxsize": self.max_cache,
            "hits": int(self.hits),
            "misses": int(self.misses),
        }


DEFAULT_SANDBOX = CodeSandbox()


def run_code(
    source: Any,
    columns: Mapping[str, Any],
    *,
    sandbox: CodeSandbox | None = None,
    timeout: float | None = None,
) -> np.ndarray:
    """便捷入口：用默认沙箱执行一次（不读缓存）。"""
    return (sandbox or DEFAULT_SANDBOX).run(source, columns, timeout=timeout)


def verify_no_lookahead(
    source: Any,
    columns: Mapping[str, Any],
    *,
    samples: int = LOOKAHEAD_SAMPLES,
    baseline: np.ndarray | None = None,
    sandbox: CodeSandbox | None = None,
) -> list[int]:
    """截断重算的无前视校验，返回已检查的 t 列表。

    对每个随机 t（避开最后 25 根）：
    ``df[:t+1]``、``df[:t+2]`` 两次截断运行在 t 处的输出，必须与全长运行一致。
    """
    sb = sandbox or DEFAULT_SANDBOX
    text = validate_source(source)
    encoded_cols = {str(k): np.asarray(v, dtype=float).reshape(-1) for k, v in columns.items()}
    if not encoded_cols:
        raise SandboxError("行情数据为空")
    n = len(next(iter(encoded_cols.values())))
    if n < 40:
        return []
    lo = max(5, n // 20)
    hi = n - LOOKAHEAD_TAIL - 1
    if hi <= lo:
        return []
    rnd = random.Random(0x5EED)
    want = max(1, min(int(samples), hi - lo + 1))
    indices = sorted(rnd.sample(range(lo, hi + 1), want))

    full = baseline if baseline is not None else sb.run(text, encoded_cols)
    if len(full) != n:
        raise SandboxError("前视校验失败：基准输出长度异常")

    checked: list[int] = []
    for t in indices:
        prefix = {k: v[: t + 1] for k, v in encoded_cols.items()}
        plus = {k: v[: t + 2] for k, v in encoded_cols.items()}
        short = sb.run(text, prefix)
        shorter = sb.run(text, plus)
        if not (
            _same_value(full[t], short[-1])
            and _same_value(full[t], shorter[t])
            and _same_value(short[-1], shorter[t])
        ):
            raise SandboxError("检测到使用未来数据")
        checked.append(int(t))
    return checked


# Batch execution compiles a candidate once, never its data or mutable namespace.
# Fresh builtins/F/globals for EVERY full/prefix invocation prevent cross-target state.
_BATCH_BOOTSTRAP = _BOOTSTRAP.split("def _run():", 1)[0] + r'''
import random

def _run_batch():
    payload = json.loads(sys.stdin.read())
    code = compile(payload["source"], "<factor>", "exec")
    def invoke(cols):
        arrays = {k: np.array(v, dtype=float, copy=True) for k, v in cols.items()}
        for value in arrays.values():
            value.setflags(write=False)
        namespace = _namespace()
        exec(code, namespace)
        fn = namespace.get("factor")
        if not callable(fn):
            raise _OutputError("缺少入口函数 def factor(df)")
        return _coerce(fn(_Bars(arrays)), len(next(iter(arrays.values()))))
    result = []
    for item in payload["items"]:
        try:
            cols = item["columns"]
            values = invoke(cols)
            checked = []
            for t in item["indices"]:
                short = invoke({k: v[:t+1] for k, v in cols.items()})
                plus = invoke({k: v[:t+2] for k, v in cols.items()})
                vals = (values[t], short[-1], plus[t])
                def equal(a, b):
                    return ((np.isnan(a) and np.isnan(b)) or
                            (np.isfinite(a) and np.isfinite(b) and
                             abs(a-b) <= 1e-9 * max(1., abs(a), abs(b))))
                if not (equal(vals[0], vals[1]) and equal(vals[0], vals[2]) and equal(vals[1], vals[2])):
                    raise _OutputError("检测到使用未来数据")
                checked.append(t)
            result.append({"target_id": item["target_id"], "ok": True,
                           "values": values.tolist(), "lookahead_checked": checked})
        except _OutputError as exc:
            result.append({"target_id": item["target_id"], "ok": False, "error": str(exc)[:160]})
        except BaseException as exc:
            result.append({"target_id": item["target_id"], "ok": False,
                           "error": type(exc).__name__, **_error_info(exc)})
    _emit({"ok": True, "items": result})
try:
    _run_batch()
except BaseException as exc:
    _emit({"ok": False, "error": type(exc).__name__})
'''


def _windows_job(proc):
    """Trusted parent: one-process 1 GiB Job, killed on handle close.

    This is a resource boundary, NOT an OS security sandbox. AST restrictions
    reduce attack surface but are not a proof against Python/numpy exploits.
    Job assignment failure is fail-closed on Windows, before sending source.
    """
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes
    class BASIC(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD),
                    ("SchedulingClass", wintypes.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ("ReadOperationCount", "WriteOperationCount",
                    "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]
    class EXT(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO),
                    ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise SandboxError("无法创建 Windows 资源限制 Job")
    limits = EXT()
    limits.BasicLimitInformation.LimitFlags = 0x2000 | 0x100 | 0x8  # kill-on-close/process-memory/active-process
    limits.BasicLimitInformation.ActiveProcessLimit = 1
    limits.ProcessMemoryLimit = 1024 * 1024 * 1024
    if not (kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) and
            kernel.AssignProcessToJobObject(job, wintypes.HANDLE(proc._handle))):
        kernel.CloseHandle(job)
        raise SandboxError("无法应用 Windows Job 资源限制，拒绝执行")
    return lambda: kernel.CloseHandle(job)


def _bounded_process(bootstrap, body, timeout, max_stdout):
    """Drain bounded pipes while alive; reap on every exit (no capture_output).

    Non-Windows resource isolation is NOT hard: wall time/output only. Windows
    additionally enforces Job memory/one-process limits. Input is capped as well.
    """
    if len(body) > 128 * 1024 * 1024:
        raise SandboxError("分片输入超过128MiB，请减小分片")
    if timeout <= 0:
        raise SandboxError("代码执行预算已耗尽")
    proc = None
    close_job = None
    readers = []
    outputs = [bytearray(), bytearray()]
    exceeded = threading.Event()
    try:
        proc = subprocess.Popen([sys.executable, "-I", "-c", bootstrap],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        close_job = _windows_job(proc)
        def drain(stream, slot, cap):
            try:
                while True:
                    chunk = stream.read(8192)
                    if not chunk:
                        break
                    room = max(0, cap - len(outputs[slot]))
                    outputs[slot].extend(chunk[:room])
                    if len(chunk) > room:
                        exceeded.set()
                        proc.kill()
                        break
            except (OSError, ValueError):
                pass
        def feed():
            try:
                proc.stdin.write(body)
                proc.stdin.close()
            except (OSError, ValueError):
                pass
        for stream, slot, cap in ((proc.stdout, 0, max_stdout), (proc.stderr, 1, 65536)):
            thread = threading.Thread(target=drain, args=(stream, slot, cap), daemon=True)
            readers.append(thread)
            thread.start()
        writer = threading.Thread(target=feed, daemon=True)
        readers.append(writer)
        writer.start()
        try:
            proc.wait(timeout=float(timeout))
        except subprocess.TimeoutExpired:
            raise SandboxError(f"代码执行超时（>{timeout:.1f}s）") from None
        for thread in readers:
            thread.join(timeout=2)
        if exceeded.is_set():
            raise SandboxError("沙箱输出过大（有界读取已终止进程）")
        return bytes(outputs[0]), bytes(outputs[1]), proc.returncode
    except OSError as exc:
        raise SandboxError("无法启动沙箱子进程", detail=_sanitize(str(exc))) from None
    finally:
        if proc is not None:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
        if close_job:
            close_job()
        for thread in readers:
            thread.join(timeout=2)
        if proc is not None:
            for stream in (proc.stdin, proc.stdout, proc.stderr):
                if stream:
                    stream.close()


def run_batch(source, items, *, timeout=30.0, max_stdout=None):
    """One compiled candidate / one subprocess / 1..32 independent targets.

    items: [{target_id, columns}]. Per-target failures do not discard siblings.
    Returns [{target_id, ok, values: ndarray, lookahead_checked} | {..., error}].
    Prefix comparisons match the single-target empirical lookahead test.
    """
    text = validate_source(source)
    if not isinstance(items, list) or not 1 <= len(items) <= 32:
        raise SandboxError("分片须包含1..32个标的")
    # Refuse oversized input before constructing Python lists/JSON. This bounds
    # parent-side serialization as well as the child's memory/output budget.
    cells = 0
    for item in items:
        columns = item.get("columns")
        if not isinstance(columns, Mapping) or not 1 <= len(columns) <= 32:
            raise SandboxError("分片列映射须包含1..32列")
        cells += sum(np.asarray(v).size for v in columns.values())
        if cells > 4000000:
            raise SandboxError("分片数值超过4000000单元资源上限，请减小分片")
    encoded, lengths, total = [], {}, 0
    for item in items:
        tid = item["target_id"]
        if not isinstance(tid, str) or len(tid) > 160 or tid in lengths:
            raise SandboxError("分片标的ID非法或重复")
        columns, n = _encode_columns(item["columns"])
        if n > 400000:
            raise SandboxError("单标的数据超过400000根资源上限")
        lengths[tid] = n
        total += n
        lo, hi = max(5, n // 20), n - LOOKAHEAD_TAIL - 1
        indices = (sorted(random.Random(0x5EED).sample(range(lo, hi+1), min(LOOKAHEAD_SAMPLES, hi-lo+1)))
                   if n >= 40 and hi > lo else [])
        encoded.append({"target_id": tid, "columns": columns, "indices": indices})
    cap = min(64 * 1024 * 1024, max(65536, total * 32 + len(items) * 1024))
    if max_stdout is not None:
        cap = min(cap, max(1, int(max_stdout)))
    body = json.dumps({"source": text, "items": encoded}, ensure_ascii=True).encode("ascii")
    stdout, stderr, rc = _bounded_process(_BATCH_BOOTSTRAP, body, min(120., float(timeout)), cap)
    marker = stdout.rfind(_RESULT_MARKER.encode("ascii"))
    if marker < 0:
        raise SandboxError(f"批沙箱进程异常退出（returncode={rc}）", detail=_sanitize(stderr.decode("utf-8", "replace")))
    try:
        reply = json.loads(stdout[marker+len(_RESULT_MARKER):].split(b"\n", 1)[0])
    except (ValueError, TypeError):
        raise SandboxError("批沙箱返回格式错误") from None
    if not isinstance(reply, dict) or not reply.get("ok") or not isinstance(reply.get("items"), list):
        raise SandboxError("批沙箱执行失败")
    rows = reply["items"]
    if len(rows) != len(items) or [r.get("target_id") for r in rows] != [i["target_id"] for i in items]:
        raise SandboxError("批沙箱标的身份不匹配")
    for row in rows:
        if row.get("ok"):
            row["values"] = _coerce_result(row.get("values"), lengths[row["target_id"]])
        else:
            kind, name, line = _execution_diagnostic(row)
            row.update(kind=kind, name=name, line=line)
            if kind in ("NameError", "UnboundLocalError", "AttributeError"):
                row["error"] = _execution_message(kind, name, line)
            else:
                row["error"] = _sanitize(row.get("error", "执行失败"), 160)
    return rows
