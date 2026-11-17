"""因子服务：目录扫描 / 单只读取（LRU 缓存）/ 规则评估 / 最优种子与当根方向。

只读本地 CSV，不写任何用户数据目录；不联网、不依赖 LLM。
"""
from __future__ import annotations

import math
from collections import OrderedDict
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .dataset import (
    MIN_BARS,
    STOCK_CATEGORY,
    data_version,
    read_bars,
    resolve_root,
    scan_symbols,
    stock_dir,
)
from .dsl import evaluate_spec, validate_spec, verify_no_lookahead
from .evaluate import evaluate_directions_df, summarize
from .sandbox import (
    DEFAULT_SANDBOX,
    SandboxError,
    source_sha256,
    validate_source,
    verify_no_lookahead as verify_code_no_lookahead,
)
from .seed_pool import all_rules, discovery_rules
from .targets import (
    DEFAULT_HORIZONS,
    EPS,
    actual_direction_matrix,
    direction_from_scores,
    forward_return_matrix,
    validate_horizons,
)

MAX_SAMPLE_LIMIT = 1000
SAMPLE_SIDES = ("false_positive", "false_negative")


class FactorError(Exception):
    """因子服务的可预期错误，status 供 API 层映射成 4xx/503。"""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = str(message)
        self.status = int(status)


def _check_limit(limit) -> int:
    if isinstance(limit, bool) or not isinstance(limit, (int, np.integer)):
        raise FactorError("limit 必须是正整数", 400)
    value = int(limit)
    if value < 1 or value > MAX_SAMPLE_LIMIT:
        raise FactorError(f"limit 超出范围 1..{MAX_SAMPLE_LIMIT}", 400)
    return value


def _as_of(df: pd.DataFrame) -> str | None:
    if df.empty or "date" not in df.columns:
        return None
    return str(pd.to_datetime(df["date"]).iloc[-1].date())


class FactorService:
    """Phase 0 确定性因子评估内核（无 LLM）。"""

    def __init__(
        self,
        data_root: str | Path | None = None,
        *,
        min_bars: int = MIN_BARS,
        cache_size: int = 8,
    ):
        self._root = resolve_root(data_root)
        self.min_bars = int(min_bars)
        self._cache_size = max(1, int(cache_size))
        self._cache: OrderedDict[tuple, dict] = OrderedDict()
        self._index: dict[str, dict] | None = None

    # ------------------------------------------------------------------ 目录
    def root(self) -> str:
        return str(self._root)

    def available(self) -> bool:
        try:
            return bool(self._ensure_index())
        except FactorError:
            return False

    def symbols(self, limit: int | None = None) -> list[dict]:
        rows = list(self._ensure_index().values())
        rows.sort(key=lambda r: (r["code"], r["name"]))
        if limit is not None:
            rows = rows[: max(0, int(limit))]
        return [dict(r) for r in rows]

    def symbol(self, code: str) -> dict:
        return dict(self._lookup(code))

    @staticmethod
    def rule_by_id(rule_id: str) -> dict | None:
        """按 id 取种子规则（含 id / name / spec / neutral_band），未知名返回 None。"""
        target = str(rule_id or "").strip()
        if not target:
            return None
        for rule in all_rules():
            if rule["id"] == target:
                out = dict(rule)
                out.setdefault("neutral_band", 0.0)
                return out
        return None

    def refresh(self) -> None:
        """丢弃标的名录与读取缓存（数据文件被外部更新后使用）。"""
        self._index = None
        self._cache.clear()

    def _ensure_index(self) -> dict[str, dict]:
        if self._index is not None:
            return self._index
        d = stock_dir(self._root)
        if not d.is_dir():
            raise FactorError(
                f"数据根目录不可用: {self._root}（缺少 {STOCK_CATEGORY} 目录）", 503
            )
        try:
            rows = scan_symbols(self._root)
        except OSError as exc:  # pragma: no cover - 权限/IO 异常
            raise FactorError(f"扫描数据目录失败: {d}: {exc}", 503) from exc
        if not rows:
            raise FactorError(f"数据目录为空: {d}", 503)
        index: dict[str, dict] = {}
        for row in rows:
            index.setdefault(row["code"], row)
        self._index = index
        return index

    def _lookup(self, code: str) -> dict:
        raw = str(code or "").strip()
        token = raw.split("_")[0].split(".")[0]
        if not token:
            raise FactorError("缺少标的代码", 400)
        index = self._ensure_index()
        rec = index.get(token)
        if rec is None:
            raise FactorError(f"未知标的: {raw}", 404)
        return rec

    # ------------------------------------------------------------------ 读取
    @staticmethod
    def _check_timeframe(timeframe: str) -> None:
        if str(timeframe) != "1d":
            raise FactorError(f"暂不支持 timeframe={timeframe!r}，当前只支持 '1d'", 400)

    def _load(self, code: str, timeframe: str = "1d") -> tuple[pd.DataFrame, str, dict]:
        self._check_timeframe(timeframe)
        rec = self._lookup(code)
        path = Path(rec["path"])
        try:
            st = path.stat()
        except OSError as exc:
            raise FactorError(f"数据文件不可读: {rec['name']} ({rec['code']})", 503) from exc

        key = (str(path), st.st_mtime_ns, st.st_size)
        hit = self._cache.get(key)
        if hit is not None:
            self._cache.move_to_end(key)
            return hit["df"], hit["version"], rec

        try:
            df = read_bars(path)
        except (OSError, ValueError, pd.errors.ParserError) as exc:
            raise FactorError(
                f"读取失败: {rec['name']} ({rec['code']}): {exc}", 503
            ) from exc
        if len(df) < self.min_bars:
            raise FactorError(
                f"数据不足: {rec['name']} ({rec['code']}) 仅 {len(df)} 根，"
                f"至少需要 {self.min_bars} 根",
                503,
            )
        version = data_version(path, len(df))
        self._cache[key] = {"df": df, "version": version}
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return df, version, rec

    def bars(self, code: str, timeframe: str = "1d") -> pd.DataFrame:
        df, _version, _rec = self._load(code, timeframe)
        return df

    def data_version(self, code: str, timeframe: str = "1d") -> str:
        _df, version, _rec = self._load(code, timeframe)
        return version

    # ------------------------------------------------------------------ 评估
    def evaluate(
        self,
        code: str,
        spec: Any,
        timeframe: str = "1d",
        *,
        neutral_band: float = 0.0,
        horizons=DEFAULT_HORIZONS,
        eps: float = EPS,
        verify: bool = True,
    ) -> dict:
        df, version, rec = self._load(code, timeframe)
        hs = validate_horizons(horizons)
        scores = evaluate_spec(spec, df)
        if verify:
            verify_no_lookahead(spec, df, indices=[len(df) - 1, len(df) // 2])
        direction = direction_from_scores(scores, neutral_band)
        metrics = evaluate_directions_df(df, direction, hs, eps)
        metrics.update(
            {
                "code": rec["code"],
                "name": rec["name"],
                "timeframe": "1d",
                "data_version": version,
                "as_of": _as_of(df),
            }
        )
        return metrics

    def samples(
        self,
        code: str,
        spec: Any,
        timeframe: str = "1d",
        side: str = "false_positive",
        limit: int = 5,
        *,
        neutral_band: float = 0.0,
        horizons=DEFAULT_HORIZONS,
        eps: float = EPS,
    ) -> list[dict]:
        """挑出方向判错的窗口。

        * ``false_positive``：预测看涨（d=+1）但 actual != +1（下跌或走平）。
        * ``false_negative``：预测看跌（d=-1）但 actual != -1（上涨或走平）。

        返回 ``[{date, h, ret}]``，date 为预测时点 t 的交易日，ret 为 t→t+h 的真实收益；
        按 |ret| 从大到小排序，最多 limit 条（并列时保持时间先后）。
        """
        if side not in SAMPLE_SIDES:
            raise FactorError(
                f"side 非法: {side!r}，只支持 {list(SAMPLE_SIDES)}", 400
            )
        limit = _check_limit(limit)
        df, _version, _rec = self._load(code, timeframe)
        return self._error_windows(
            df,
            spec,
            neutral_band=neutral_band,
            side=side,
            limit=limit,
            horizons=horizons,
            eps=eps,
        )

    def evaluate_detail(
        self,
        code: str,
        spec: Any,
        timeframe: str = "1d",
        neutral_band: float = 0.0,
        *,
        limit: int = 5,
        horizons=DEFAULT_HORIZONS,
        eps: float = EPS,
    ) -> dict:
        """``/api/factors/backtest`` 用：一次返回 metrics 与两侧错误样本。"""
        limit = _check_limit(limit)
        metrics = self.evaluate(
            code,
            spec,
            timeframe,
            neutral_band=neutral_band,
            horizons=horizons,
            eps=eps,
        )
        df, _version, _rec = self._load(code, timeframe)
        samples = {
            side: self._error_windows(
                df,
                spec,
                neutral_band=neutral_band,
                side=side,
                limit=limit,
                horizons=horizons,
                eps=eps,
            )
            for side in SAMPLE_SIDES
        }
        return {"metrics": metrics, "samples": samples}

    def _error_windows(
        self,
        df: pd.DataFrame,
        spec: Any,
        *,
        neutral_band: float,
        side: str,
        limit: int,
        horizons,
        eps: float,
    ) -> list[dict]:
        hs = validate_horizons(horizons)
        scores = evaluate_spec(spec, df)
        dirs = direction_from_scores(scores, neutral_band)
        close = df["close"].to_numpy(dtype=float)
        actual = actual_direction_matrix(close, hs, eps=eps)
        rets = forward_return_matrix(close, hs)

        valid = np.isfinite(actual)
        if side == "false_positive":
            mask = (dirs[:, None] == 1) & valid & (actual != 1.0)
        else:
            mask = (dirs[:, None] == -1) & valid & (actual != -1.0)

        tt, hh = np.nonzero(mask)
        if tt.size == 0:
            return []
        values = rets[tt, hh]
        order = np.argsort(-np.abs(values), kind="stable")[:limit]

        dates = None
        if "date" in df.columns:
            dates = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d").to_numpy()
        return [
            {
                "date": str(dates[tt[i]]) if dates is not None else None,
                "h": int(hs[hh[i]]),
                "ret": float(values[i]),
            }
            for i in order
        ]

    def evaluate_seeds(
        self,
        code: str,
        timeframe: str = "1d",
        *,
        horizons=DEFAULT_HORIZONS,
        eps: float = EPS,
    ) -> list[dict]:
        df, _version, rec = self._load(code, timeframe)
        hs = validate_horizons(horizons)
        close = df["close"].to_numpy(dtype=float)
        actual = actual_direction_matrix(close, hs, eps=eps)
        as_of = _as_of(df)

        results: list[dict] = []
        for rule in discovery_rules():
            if rule.get("non_discovery"):
                continue
            validate_spec(rule["spec"])
            scores = evaluate_spec(rule["spec"], df, validate=False)
            direction = direction_from_scores(scores, rule.get("neutral_band", 0.0))
            if np.unique(direction).size <= 1:
                # 恒定方向 / 全程弃权 的规则没有评估价值
                continue
            metrics = summarize(actual, direction, hs, eps)
            if not metrics["evaluated"]:
                continue
            metrics["as_of"] = as_of
            results.append(
                {
                    "rule": {
                        "id": rule["id"],
                        "name": rule["name"],
                        "spec": rule["spec"],
                        "neutral_band": float(rule.get("neutral_band", 0.0)),
                        "family": rule.get("family", ""),
                    },
                    "metrics": metrics,
                }
            )

        results.sort(
            key=lambda r: (
                r["metrics"]["accuracy"] if r["metrics"]["accuracy"] is not None else -1.0,
                r["metrics"]["coverage"] if r["metrics"]["coverage"] is not None else -1.0,
            ),
            reverse=True,
        )
        return results

    def predict(self, code: str, timeframe: str = "1d", **kwargs) -> dict:
        df, version, rec = self._load(code, timeframe)
        results = self.evaluate_seeds(code, timeframe, **kwargs)
        if not results:
            raise FactorError(
                f"没有可用的种子规则: {rec['name']} ({rec['code']})", 503
            )
        best = results[0]
        scores = evaluate_spec(best["rule"]["spec"], df, validate=False)
        last = float(scores.iloc[-1]) if len(scores) else float("nan")
        score_now = last if math.isfinite(last) else 0.0
        directions = direction_from_scores(scores, best["rule"].get("neutral_band", 0.0))
        direction_now = int(directions[-1]) if len(directions) else 0
        return {
            "code": rec["code"],
            "name": rec["name"],
            "timeframe": "1d",
            "as_of": _as_of(df),
            "bars": int(len(df)),
            "data_version": version,
            "rule": best["rule"],
            "metrics": best["metrics"],
            "accuracy": best["metrics"]["accuracy"],
            "coverage": best["metrics"]["coverage"],
            "direction_now": int(direction_now),
            "score_now": score_now,
            "neutral_band": float(best["rule"]["neutral_band"]),
        }

    # ------------------------------------------------------------ 代码因子
    # 模型自写 ``def factor(df): ...``：子进程执行 + 无前视校验，评估口径与 DSL 完全一致。
    def validate_code_source(self, source: Any) -> None:
        """静态校验模型自写代码（AST 白名单）；非法抛 ``SandboxError``（status=400）。"""
        validate_source(source)

    def evaluate_code(
        self,
        code: str,
        source: Any,
        timeframe: str = "1d",
        neutral_band: float = 0.0,
        *,
        horizons=DEFAULT_HORIZONS,
        eps: float = EPS,
        verify: bool = True,
    ) -> dict:
        """执行模型代码并复用现有口径评估（同一 d 用于 h=1..20）。

        流程：AST 校验 -> 子进程执行（LRU 缓存）-> 截断无前视校验 ->
        输出符号 + ``neutral_band`` 得到方向 -> ``evaluate_directions_df``。
        无前视是强经验测试（抽样 2 个 t），不是形式化证明。
        """
        df, version, rec = self._load(code, timeframe)
        hs = validate_horizons(horizons)
        text = validate_source(source)
        columns = _code_columns(df)
        # 缓存标签带标的名，避免不同标的碰巧同 data_version 时串用结果
        values = DEFAULT_SANDBOX.run_cached(text, columns, f"{rec['code']}:{version}")
        checked: list[int] = []
        if verify:
            checked = verify_code_no_lookahead(
                text, columns, baseline=values, sandbox=DEFAULT_SANDBOX
            )
        direction = direction_from_scores(values, neutral_band)
        last_value = float(values[-1]) if len(values) else float("nan")
        score_now = last_value if np.isfinite(last_value) else 0.0
        metrics = evaluate_directions_df(df, direction, hs, eps)
        metrics.update(
            {
                "code": rec["code"],
                "name": rec["name"],
                "timeframe": "1d",
                "data_version": version,
                "as_of": _as_of(df),
                "kind": "code",
                "source_sha256": source_sha256(text),
                "neutral_band": float(abs(float(neutral_band or 0.0))),
                "lookahead_checked": checked,
                "score_now": score_now,
                "direction_now": int(direction[-1]) if len(direction) else 0,
            }
        )
        return metrics

    def samples_code(
        self,
        code: str,
        source: Any,
        timeframe: str = "1d",
        side: str = "false_positive",
        limit: int = 5,
        *,
        neutral_band: float = 0.0,
        horizons=DEFAULT_HORIZONS,
        eps: float = EPS,
    ) -> list[dict]:
        """代码规则的判错窗口，口径与 DSL ``samples`` 完全一致。

        返回 ``[{date, h, ret}]``，按 |ret| 从大到小，最多 limit 条。
        这里只跑一次代码（不重复做无前视校验）；``evaluate_code`` 才是准入闸门。
        """
        if side not in SAMPLE_SIDES:
            raise FactorError(
                f"side 非法: {side!r}，只支持 {list(SAMPLE_SIDES)}", 400
            )
        limit = _check_limit(limit)
        df, version, rec = self._load(code, timeframe)
        hs = validate_horizons(horizons)
        text = validate_source(source)
        columns = _code_columns(df)
        values = DEFAULT_SANDBOX.run_cached(text, columns, f"{rec['code']}:{version}")
        dirs = direction_from_scores(values, neutral_band)
        close = df["close"].to_numpy(dtype=float)
        actual = actual_direction_matrix(close, hs, eps=eps)
        rets = forward_return_matrix(close, hs)

        valid = np.isfinite(actual)
        if side == "false_positive":
            mask = (dirs[:, None] == 1) & valid & (actual != 1.0)
        else:
            mask = (dirs[:, None] == -1) & valid & (actual != -1.0)

        tt, hh = np.nonzero(mask)
        if tt.size == 0:
            return []
        wins = rets[tt, hh]
        order = np.argsort(-np.abs(wins), kind="stable")[:limit]
        dates = None
        if "date" in df.columns:
            dates = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d").to_numpy()
        return [
            {
                "date": str(dates[tt[i]]) if dates is not None else None,
                "h": int(hs[hh[i]]),
                "ret": float(wins[i]),
            }
            for i in order
        ]


# ---------------------------------------------------------------------- 代码因子
# 进沙箱的只有数值列：OHLCV + 成交额/换手/涨跌幅等，日期等文本列不传。
_CODE_COLUMNS = (
    "open",
    "high",
    "low",
    "close",
    "volume",
    "amount",
    "turnover",
    "pct_chg",
    "amplitude",
    "change",
)


def _code_columns(df: pd.DataFrame) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for name in _CODE_COLUMNS:
        if name in df.columns:
            out[name] = pd.to_numeric(df[name], errors="coerce").to_numpy(dtype=float)
    if "close" not in out:
        raise FactorError("bars 缺少 close 列", 400)
    return out


def validate_code_source(source: Any) -> None:
    """模块级便捷入口：AST 静态校验模型自写因子代码；非法抛 ``SandboxError``。"""
    validate_source(source)
