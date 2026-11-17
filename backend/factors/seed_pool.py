"""种子规则池：Phase 0 的「发现候选」，全部是 JSON DSL，可静态校验、可复现。

每条规则：id / name / spec（DSL 表达式树）/ neutral_band（|score| 小于该值弃权）。
规则只表达「方向分数」，score > band 看涨，score < -band 看跌，其余弃权。
``baseline_up`` 是 always_up 参考基线，标记 non_discovery，不参与最优规则选择。
"""
from __future__ import annotations

from typing import Any


def _node(op: str, *args: Any, n: int | None = None) -> dict:
    node: dict[str, Any] = {"op": op}
    if args:
        node["args"] = list(args)
    if n is not None:
        node["n"] = int(n)
    return node


def _gt(a, b) -> dict:
    return _node("gt", a, b)


def _gte(a, b) -> dict:
    return _node("gte", a, b)


def _lt(a, b) -> dict:
    return _node("lt", a, b)


def _sub(a, b) -> dict:
    return _node("sub", a, b)


def _and(a, b) -> dict:
    return _node("and", a, b)


def _rule(rule_id: str, name: str, spec: dict, neutral_band: float, family: str) -> dict:
    return {
        "id": rule_id,
        "name": name,
        "spec": spec,
        "neutral_band": float(neutral_band),
        "family": family,
    }


SEEDS: list[dict] = [
    # ---- 趋势 ----
    _rule("trend_ma10", "10 日均线趋势", _node("ma_gap", n=10), 0.003, "trend"),
    _rule("trend_ma20", "20 日均线趋势", _node("ma_gap", n=20), 0.005, "trend"),
    _rule("trend_ma60", "60 日均线趋势", _node("ma_gap", n=60), 0.008, "trend"),
    _rule(
        "trend_stack_20_60",
        "均线多头排列（20 日强于 60 日）",
        _sub(_node("ma_gap", n=20), _node("ma_gap", n=60)),
        0.002,
        "trend",
    ),
    _rule(
        "pullback_in_uptrend",
        "上升趋势中的回踩",
        _and(_gt(_node("ma_gap", n=60), 0), _lt(_node("ma_gap", n=5), -0.01)),
        0.0,
        "trend",
    ),
    # ---- 突破 ----
    _rule(
        "breakout_20",
        "20 日新高突破",
        _gte(_node("close_over_max", n=20), 0),
        0.0,
        "breakout",
    ),
    _rule(
        "breakout_60",
        "60 日新高突破",
        _gte(_node("close_over_max", n=60), 0),
        0.0,
        "breakout",
    ),
    _rule(
        "breakout_vol_20",
        "20 日新高 + 放量",
        _and(_gte(_node("close_over_max", n=20), 0), _gt(_node("vol_ratio", n=20), 1.3)),
        0.0,
        "breakout",
    ),
    _rule(
        "breakout_vol_60",
        "60 日新高 + 放量",
        _and(_gte(_node("close_over_max", n=60), 0), _gt(_node("vol_ratio", n=60), 1.3)),
        0.0,
        "breakout",
    ),
    # ---- 动量 ----
    _rule("momentum_5", "5 日动量", _node("ret_n", n=5), 0.01, "momentum"),
    _rule("momentum_20", "20 日动量", _node("ret_n", n=20), 0.02, "momentum"),
    _rule("momentum_60", "60 日动量", _node("ret_n", n=60), 0.03, "momentum"),
    _rule("macd_trend", "MACD 柱线方向", _node("macd_hist"), 0.0, "momentum"),
    # ---- 均值回归 ----
    _rule(
        "rsi_reversion",
        "RSI(14) 超买超卖反转",
        _sub(50, _node("rsi", n=14)),
        20.0,
        "reversion",
    ),
    _rule("meanrev_5", "5 日反转", _sub(0, _node("ret_n", n=5)), 0.01, "reversion"),
    _rule("gap_fade", "跳空回补", _sub(0, _node("gap_pct")), 0.005, "reversion"),
    _rule(
        "range_pos_20",
        "20 日区间位置",
        _sub(_node("range_pos", n=20), 0.5),
        0.1,
        "reversion",
    ),
    _rule(
        "range_pos_60",
        "60 日区间位置",
        _sub(_node("range_pos", n=60), 0.5),
        0.1,
        "reversion",
    ),
    # ---- 波动 ----
    _rule(
        "vol_squeeze_break",
        "波动收缩后的上破",
        _and(_lt(_node("zscore", _node("atr", n=14), n=60), -0.5), _gt(_node("ret_n", n=1), 0)),
        0.0,
        "volatility",
    ),
    _rule(
        "vol_expansion",
        "波动放大",
        _gt(_node("zscore", _node("atr", n=14), n=60), 1.0),
        0.0,
        "volatility",
    ),
    _rule(
        "atr_quiet_hold",
        "低波持有（ATR 分位偏低）",
        _lt(_node("zscore", _node("atr", n=20), n=120), -0.5),
        0.0,
        "volatility",
    ),
    # ---- 量能 ----
    _rule(
        "volume_surge_up",
        "放量上涨",
        _and(_gt(_node("vol_ratio", n=20), 2.0), _gt(_node("ret_n", n=1), 0)),
        0.0,
        "volume",
    ),
    _rule("turnover_spike", "换手率异常放大", _gt(_node("turnover_z", n=20), 1.5), 0.0, "volume"),
    _rule(
        "vol_dry_reversal",
        "缩量回踩后的多头结构",
        _and(_lt(_node("vol_ratio", n=5), 0.7), _gt(_node("ma_gap", n=20), 0)),
        0.0,
        "volume",
    ),
    # ---- RSI ----
    _rule(
        "rsi_trend",
        "RSI(14) 强度趋势",
        _sub(_node("rsi", n=14), 50),
        5.0,
        "rsi",
    ),
    _rule(
        "rsi_short_term",
        "RSI(6) 短期强度",
        _sub(_node("rsi", n=6), 50),
        5.0,
        "rsi",
    ),
]


# always_up 参考基线：恒看涨，只用于对照，不参与「最优种子」选择。
BASELINE_UP: dict = {
    "id": "baseline_up",
    "name": "参考基线：始终看涨",
    "spec": 1,
    "neutral_band": 0.0,
    "family": "baseline",
    "non_discovery": True,
}


def discovery_rules() -> list[dict]:
    """参与种子评估的规则（排除基线）。"""
    return [dict(rule) for rule in SEEDS if not rule.get("non_discovery")]


def all_rules() -> list[dict]:
    return [dict(rule) for rule in SEEDS] + [dict(BASELINE_UP)]
