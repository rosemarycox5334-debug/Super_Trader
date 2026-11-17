"""方向预测的确定性评估：逐 h 准确率、覆盖率、混淆计数、单边基准。

评估口径见 ``targets`` 模块文档。本模块是纯函数集合：
``evaluate_directions(close, direction, ...)`` 不依赖文件/网络，便于用合成数据测试。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .targets import (
    DEFAULT_HORIZONS,
    EPS,
    actual_direction_matrix,
    validate_horizons,
)


def _coerce_direction(direction, n: int) -> np.ndarray:
    """方向数组校验：长度对齐，只允许 -1/0/1（NaN 视为 0）。"""
    arr = np.asarray(direction, dtype=float).reshape(-1)
    if arr.size != n:
        raise ValueError(f"direction 长度 {arr.size} 与 close 长度 {n} 不一致")
    arr = np.where(np.isfinite(arr), arr, 0.0)
    bad = ~np.isin(arr, (-1.0, 0.0, 1.0))
    if bool(np.any(bad)):
        sample = np.unique(arr[bad])[:5].tolist()
        raise ValueError(f"direction 只能是 -1/0/1，出现非法值: {sample}")
    return arr.astype(np.int8)


def _ratio(num: int, den: int):
    return (num / den) if den else None


def summarize(actual: np.ndarray, direction, horizons, eps: float = EPS) -> dict:
    """用预算好的真实方向矩阵汇总指标（evaluate_seeds 复用，避免重复算矩阵）。"""
    actual = np.asarray(actual, dtype=float)
    if actual.ndim != 2:
        raise ValueError("actual 必须是 (N, H) 二维矩阵")
    n, h_count = actual.shape
    hs = validate_horizons(horizons)
    if len(hs) != h_count:
        raise ValueError(f"horizons 数量 {len(hs)} 与 actual 列数 {h_count} 不一致")

    dirs = _coerce_direction(direction, n)
    pred = np.broadcast_to(dirs[:, None], (n, h_count))
    finite = np.isfinite(actual)
    predicted = pred != 0
    evaluated_mask = finite & predicted
    skipped_mask = finite & ~predicted
    not_evaluated_mask = ~finite

    evaluated = int(evaluated_mask.sum())
    skipped = int(skipped_mask.sum())
    not_evaluated = int(not_evaluated_mask.sum())
    correct_mask = evaluated_mask & (actual == pred)
    correct = int(correct_mask.sum())
    flat_mask = evaluated_mask & (actual == 0.0)
    flat_wrong = int(flat_mask.sum())

    accuracy = _ratio(correct, evaluated)
    coverage = _ratio(evaluated, evaluated + skipped)

    per_horizon: list[dict] = []
    for j, h in enumerate(hs):
        ev = int(evaluated_mask[:, j].sum())
        corr = int(correct_mask[:, j].sum())
        up = int((evaluated_mask[:, j] & (actual[:, j] == 1.0)).sum())
        flat = int((evaluated_mask[:, j] & (actual[:, j] == 0.0)).sum())
        per_horizon.append(
            {
                "h": int(h),
                "evaluated": ev,
                "samples": ev,
                "correct": corr,
                "wrong": ev - corr,
                "flat_wrong": flat,
                "accuracy": _ratio(corr, ev),
                "baseline_up": _ratio(up, ev),
            }
        )

    confusion: dict[str, dict[str, int]] = {}
    for sign, key in ((1, "pred_up"), (-1, "pred_down")):
        mask = evaluated_mask & (pred == sign)
        confusion[key] = {
            "up": int((mask & (actual == 1.0)).sum()),
            "flat": int((mask & (actual == 0.0)).sum()),
            "down": int((mask & (actual == -1.0)).sum()),
        }

    up_all = int((finite & (actual == 1.0)).sum())
    down_all = int((finite & (actual == -1.0)).sum())
    evaluable = evaluated + skipped
    baseline_up_valid = int((evaluated_mask & (actual == 1.0)).sum())
    baseline_down_valid = int((evaluated_mask & (actual == -1.0)).sum())

    return {
        "horizons": [int(h) for h in hs],
        "eps": float(eps),
        "bars": int(n),
        "total_windows": int(n * h_count),
        "evaluated": evaluated,
        "correct": correct,
        "wrong": evaluated - correct,
        "flat_wrong": flat_wrong,
        "skipped": skipped,
        "not_evaluated": not_evaluated,
        "accuracy": accuracy,
        "coverage": coverage,
        "valid_timepoints": int(evaluated_mask.any(axis=1).sum()),
        "direction_counts": {
            "up": int((dirs == 1).sum()),
            "flat": int((dirs == 0).sum()),
            "down": int((dirs == -1).sum()),
        },
        "confusion": confusion,
        "baseline": {
            "always_up": _ratio(baseline_up_valid, evaluated),
            "always_down": _ratio(baseline_down_valid, evaluated),
            "all_window_up_rate": _ratio(up_all, evaluable),
            "all_window_down_rate": _ratio(down_all, evaluable),
            "evaluable_windows": int(evaluable),
        },
        "per_horizon": per_horizon,
    }


def evaluate_directions(
    close,
    direction,
    horizons=DEFAULT_HORIZONS,
    eps: float = EPS,
) -> dict:
    """纯函数：收盘价序列 + 每个时点的方向 -> 完整评估指标。

    direction 长度必须与 close 相同，取值 {-1, 0, 1}；0 表示该时点弃权。
    """
    close = np.asarray(close, dtype=float).reshape(-1)
    hs = validate_horizons(horizons)
    actual = actual_direction_matrix(close, hs, eps=eps)
    return summarize(actual, direction, hs, eps=eps)


def evaluate_directions_df(
    bars: pd.DataFrame,
    direction,
    horizons=DEFAULT_HORIZONS,
    eps: float = EPS,
) -> dict:
    """DataFrame 包装：额外带上 as_of / bars 等元信息。"""
    if "close" not in bars.columns:
        raise ValueError("bars 缺少 close 列")
    metrics = evaluate_directions(
        bars["close"].to_numpy(dtype=float), direction, horizons, eps
    )
    if "date" in bars.columns and len(bars):
        metrics["as_of"] = str(pd.to_datetime(bars["date"]).iloc[-1].date())
    else:
        metrics["as_of"] = None
    return metrics
