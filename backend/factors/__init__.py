"""量化因子预测 —— Phase 0 确定性评估内核（不含 LLM）。

对外入口：

* ``evaluate_directions`` / ``evaluate_directions_df``：方向预测的确定性指标
* ``validate_spec`` / ``evaluate_spec``：安全 JSON DSL
* ``SEEDS`` / ``BASELINE_UP``：种子规则池
* ``FactorService``：目录扫描、单只读取、种子评估、当根方向
"""
from __future__ import annotations

from .dsl import DslError, evaluate_spec, validate_spec, verify_no_lookahead
from .evaluate import evaluate_directions, evaluate_directions_df, summarize
from .seed_pool import BASELINE_UP, SEEDS, all_rules, discovery_rules
from .service import FactorError, FactorService
from .targets import (
    DEFAULT_HORIZONS,
    EPS,
    actual_direction_matrix,
    direction_from_scores,
    forward_return_matrix,
)

__all__ = [
    "BASELINE_UP",
    "DEFAULT_HORIZONS",
    "DslError",
    "EPS",
    "FactorError",
    "FactorService",
    "SEEDS",
    "actual_direction_matrix",
    "all_rules",
    "direction_from_scores",
    "discovery_rules",
    "evaluate_directions",
    "evaluate_directions_df",
    "evaluate_spec",
    "forward_return_matrix",
    "summarize",
    "validate_spec",
    "verify_no_lookahead",
]
