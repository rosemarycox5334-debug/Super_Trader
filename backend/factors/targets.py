"""预测目标：未来 h 根的方向标签与方向编码。

口径（Phase 0 冻结）：

* 预测时点 t 只输出一个方向 d ∈ {-1, 0, 1}，对未来 h=1..20 全部窗口复用同一 d。
* ``actual_h = sign(close[t+h] / close[t] - 1)``；``|ret| <= 1e-9`` 记 flat(0)。
* t+h 越界或任一端价格无效（非有限 / <=0）→ 该窗口不可评估（NaN）。

本模块只做纯数值变换，不读文件、不依赖 pandas 以外的状态。
"""
from __future__ import annotations

import numpy as np

DEFAULT_HORIZONS: tuple[int, ...] = tuple(range(1, 21))
EPS = 1e-9
MAX_HORIZON = 250


def validate_horizons(horizons) -> list[int]:
    """校验并规范化 horizon 列表（正 int、1..250、非空）。"""
    if horizons is None:
        raise ValueError("horizons 不能为 None")
    out: list[int] = []
    for h in horizons:
        if isinstance(h, bool) or not isinstance(h, (int, np.integer)):
            raise ValueError(f"horizon 必须是 int: {h!r}")
        h = int(h)
        if h < 1 or h > MAX_HORIZON:
            raise ValueError(f"horizon 超出范围 1..{MAX_HORIZON}: {h}")
        out.append(h)
    if not out:
        raise ValueError("horizons 不能为空")
    return out


def as_close_array(close) -> np.ndarray:
    arr = np.asarray(close, dtype=float).reshape(-1)
    return arr


def forward_return_matrix(close, horizons=DEFAULT_HORIZONS) -> np.ndarray:
    """形状 (N, H) 的未来收益率矩阵；越界/价格无效处为 NaN。"""
    close = as_close_array(close)
    hs = validate_horizons(horizons)
    n = len(close)
    out = np.full((n, len(hs)), np.nan, dtype=float)
    ok = np.isfinite(close) & (close > 0.0)
    for j, h in enumerate(hs):
        if h >= n:
            continue
        with np.errstate(invalid="ignore", divide="ignore"):
            r = close[h:] / close[: n - h] - 1.0
        mask = ok[: n - h] & ok[h:]
        r = np.where(mask, r, np.nan)
        out[: n - h, j] = r
    return out


def actual_direction_matrix(close, horizons=DEFAULT_HORIZONS, eps: float = EPS) -> np.ndarray:
    """形状 (N, H) 的真实方向矩阵：-1 / 0 / 1，不可评估处 NaN。"""
    ret = forward_return_matrix(close, horizons)
    out = np.full(ret.shape, np.nan, dtype=float)
    finite = np.isfinite(ret)
    vals = ret[finite]
    out[finite] = np.sign(np.where(np.abs(vals) <= float(eps), 0.0, vals))
    return out


def direction_from_scores(scores, neutral_band: float = 0.0, eps: float = 1e-12) -> np.ndarray:
    """score -> 方向：score > band 记 +1，score < -band 记 -1，其余 0；NaN -> 0。"""
    s = np.asarray(scores, dtype=float).reshape(-1)
    band = abs(float(neutral_band or 0.0))
    out = np.zeros(s.shape, dtype=np.int8)
    finite = np.isfinite(s)
    out[finite & (s > band + eps)] = 1
    out[finite & (s < -band - eps)] = -1
    return out
