"""量化引擎封装：概率网格查询 + 按需重算 + 真实交易日历。

复用现有 super_trader：KlineStore 读数据、fullfit.fit_symbol 现算、
probability_grid.json 作为预算好的内样本结果。

诚实性口径（任务书第 5 节）：
* 所有概率都是「历史同信号命中率」= 内样本频率，不是校准的未来概率。
* direction=0（当前无方向信号）时概率返回 None，只给单边基准。
* 日期→交易日用「该标的真实日期序列」推进，不做「数工作日」近似。
"""
from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from super_trader.config import Config, runtime_state_root
from super_trader.data import CATEGORIES, KlineStore, SymbolInfo
from super_trader.evaluate import prepare_symbol
from super_trader.fullfit import FullFitConfig, fit_symbol
from super_trader.rules import RULES
from super_trader.scan import eval_config

PROJECT_ROOT = Path(__file__).resolve().parent.parent
GRID_PATH = PROJECT_ROOT / "reports" / "fullfit" / "probability_grid.json"
FULLFIT_PATH = PROJECT_ROOT / "reports" / "fullfit" / "fullfit.json"

GRID_FIELDS = ("prob_x1000", "predictions", "direction", "base_up_x1000", "coverage_x1000")
_RULE_DESC = {r.key: r.desc for r in RULES}


class QuantError(Exception):
    """量化查询的可预期错误（未知标的、日期越界等），由 API 层翻译成 4xx。"""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class ProbabilityResult:
    symbol: dict
    target: dict
    direction: int
    direction_label: str
    probability: float | None
    sample: dict
    baseline_up: float
    rules: list[str]
    method: str
    evaluation: dict
    warnings: list[str]
    source: str

    def as_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "target": self.target,
            "direction": self.direction,
            "direction_label": self.direction_label,
            "probability": self.probability,
            "sample": self.sample,
            "baseline_up": self.baseline_up,
            "rules": self.rules,
            "method": self.method,
            "evaluation": self.evaluation,
            "warnings": self.warnings,
            "source": self.source,
        }


_DIR_LABEL = {1: "上涨", -1: "下跌", 0: "中性"}


class QuantEngine:
    """进程内单例：缓存 KlineStore、概率网格、交易日历。"""

    def __init__(self, cfg: Config | None = None, grid_path: Path | None = None):
        self.cfg = cfg or Config.load()
        self.store = KlineStore(self.cfg.data_path, self.cfg.cache_path)
        self.grid_path = grid_path or self.cfg.report_path / "fullfit" / "probability_grid.json"
        self._grid: dict[tuple[str, str], dict] | None = None
        self._grid_meta: dict = {}
        self._lock = threading.RLock()

    @property
    def capabilities(self) -> dict:
        """Cheap path/first-file checks only: no catalog, CSV reads or cache rebuild."""
        available = False
        try:
            for category in CATEGORIES:
                directory = self.cfg.data_path / category
                if not directory.is_dir():
                    continue
                with os.scandir(directory) as entries:
                    if any(e.is_file() and e.name.endswith(".csv") and "_" in e.name for e in entries):
                        available = True
                        break
        except OSError:
            available = False
        portable = os.environ.get("ST_PORTABLE_RUNTIME") == "1"
        state = runtime_state_root()
        return {
            "research_data_available": available,
            "grid_available": self.grid_path.is_file(),
            "data_configured": bool(os.environ.get("SUPER_TRADER_DATA_ROOT")) or not portable or self.cfg.data_path != state / "research-data",
            "report_configured": bool(os.environ.get("SUPER_TRADER_REPORT_DIR")) or not portable or self.cfg.report_path != state / "reports",
        }

    def _require_research_data(self) -> None:
        if not self.capabilities["research_data_available"]:
            raise QuantError("未配置或未找到研究日线数据；请设置 SUPER_TRADER_DATA_ROOT，行情服务仍可独立使用", status=503)

    # ------------------------------------------------------------------ 网格
    def _load_grid(self) -> None:
        if self._grid is not None:
            return
        with self._lock:
            if self._grid is not None:
                return
            index: dict[tuple[str, str], dict] = {}
            if self.grid_path.exists():
                payload = json.loads(self.grid_path.read_text(encoding="utf-8"))
                self._grid_meta = {
                    "generated_at": payload.get("generated_at"),
                    "snapshot": payload.get("snapshot"),
                    "scope": payload.get("scope"),
                    "symbols": payload.get("symbols"),
                    "horizons": payload.get("horizons"),
                }
                for item in payload.get("data", []):
                    index[(item["code"], item["category"])] = item
            self._grid = index

    @property
    def grid_meta(self) -> dict:
        self._load_grid()
        return dict(self._grid_meta)

    def grid_entry(self, code: str, category: str) -> dict | None:
        self._load_grid()
        assert self._grid is not None
        return self._grid.get((code, category))

    # ------------------------------------------------------------------ 日历
    @lru_cache(maxsize=4096)
    def _dates(self, code: str, category: str) -> tuple:
        """单标的真实交易日序列（tuple[str]，升序）。"""
        info = self.resolve_symbol(code, category)
        df = self.store.load(info)
        return tuple(pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d").tolist())

    def resolve_symbol(self, code: str, category: str | None) -> SymbolInfo:
        self._require_research_data()
        if self.store.catalog().empty:
            raise QuantError("研究数据目录没有可用标的", status=503)
        info = self.store.find(code, category) if category else self.store.resolve(code)
        if info is None:
            raise QuantError(f"未知标的: {code}" + (f"/{category}" if category else ""), status=404)
        return info

    def _future_trading_days(self, last: str, count: int) -> list[str]:
        """从快照日之后投影 count 个未来交易日。

        真实行情只到快照日为止，快照日之后不存在真实交易日。为了支持「给具体日期」
        的换算，这里按工作日（周一至周五，排除周末）向后投影，不含法定节假日，
        因此是**近似交易日历**，结果会在警告中标注为 projected。
        """
        out: list[str] = []
        cur = pd.Timestamp(last)
        while len(out) < count:
            cur = cur + pd.Timedelta(days=1)
            if cur.weekday() < 5:  # 0-4 = 周一至周五
                out.append(cur.strftime("%Y-%m-%d"))
        return out

    def horizon_from_date(self, code: str, category: str, target_date: str) -> tuple[int, str]:
        """把目标日期换算成「未来第 N 个交易日」。

        先用标的真实交易日序列（若目标日期落在历史区间内，直接数真实交易日）；
        目标日期晚于数据快照日时，用投影交易日历（工作日近似）向后推。
        """
        dates = self._dates(code, category)
        if not dates:
            raise QuantError("该标的无有效交易日", status=404)
        last = dates[-1]
        tgt = pd.Timestamp(target_date).strftime("%Y-%m-%d")
        if tgt <= last:
            raise QuantError(
                f"目标日期 {tgt} 不晚于数据快照日 {last}，无法作为未来预测日", status=400
            )
        future = self._future_trading_days(last, 60)
        horizon = sum(1 for d in future if d <= tgt)
        if horizon < 1:
            raise QuantError(f"目标日期 {tgt} 与快照日之间没有交易日", status=400)
        if horizon > 20:
            raise QuantError(
                f"目标日期 {tgt} 对应未来第 {horizon} 个交易日（投影），超出模型支持的 1–20 根",
                status=400,
            )
        return horizon, future[horizon - 1]

    def horizon_target_date(self, code: str, category: str, horizon: int) -> str | None:
        """未来第 N 根 → 对应投影日历日期。"""
        last = self._dates(code, category)[-1]
        future = self._future_trading_days(last, max(horizon, 1))
        if horizon <= len(future):
            return future[horizon - 1]
        return None

    @lru_cache(maxsize=1)
    def market_calendar(self) -> tuple:
        """全市场交易日历 = 所有标的日期序列的并集（升序）。

        首选从缓存 parquet 的并集构造（快，不读 CSV）；缺失时回退到主流宽基指数。
        """
        cal: set[str] = set()
        cache_root = self.cfg.cache_path
        parquets: list[Path] = []
        if cache_root.exists():
            parquets = list(cache_root.rglob("*.parquet"))
        if parquets:
            # 用宽基指数 + 若干长历史标的即可覆盖全部交易日；全量读太慢。
            # 上证指数覆盖 1990 至今的所有 A 股交易日。
            picks = [p for p in parquets if "000001_上证指数" in p.name]
            if not picks:
                picks = parquets[:50]
            for p in picks:
                try:
                    df = pd.read_parquet(p, columns=["date"])
                    cal.update(pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d").tolist())
                except Exception:  # noqa: BLE001  坏缓存不致命
                    continue
        if not cal:
            # 最后回退：上证指数 CSV
            info = self.store.find("000001", "指数")
            if info is not None:
                df = self.store.load(info)
                cal.update(pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d").tolist())
        return tuple(sorted(cal))

    # ------------------------------------------------------------------ 概率
    def probability(self, code: str, category: str | None, *, horizon: int | None = None,
                    target_date: str | None = None, recompute: bool = False) -> ProbabilityResult:
        if horizon is None and target_date is None:
            raise QuantError("必须提供 horizon 或 date 之一")
        info = self.resolve_symbol(code, category)
        cat = info.category
        resolved_date: str | None = None
        projected = False
        if target_date is not None:
            horizon, resolved_date = self.horizon_from_date(info.code, cat, target_date)
            projected = True
        assert horizon is not None
        if not (1 <= horizon <= 20):
            raise QuantError(f"horizon 必须在 1–20，收到 {horizon}")

        if resolved_date is None:
            resolved_date = self.horizon_target_date(info.code, cat, horizon)
            projected = True

        row = None
        source = "grid"
        if not recompute:
            entry = self.grid_entry(info.code, cat)
            if entry is not None:
                rows = entry.get("rows") or []
                if horizon <= len(rows) and rows[horizon - 1] is not None:
                    row = self._row_from_grid(rows[horizon - 1])
        if row is None:
            row = self._recompute(info, horizon)
            source = "recompute"

        return self._assemble(info, horizon, resolved_date, row, source, projected)

    def _row_from_grid(self, raw: list[int]) -> dict:
        prob_x1000, preds, direction, base_x1000, cov_x1000 = raw
        return {
            "probability": prob_x1000 / 1000.0,
            "predictions": int(preds),
            "direction": int(direction),
            "baseline_up": base_x1000 / 1000.0,
            "coverage": cov_x1000 / 1000.0,
            "rules": None,  # 网格不存规则名，需要时由重算补齐
            "period": None,
        }

    def _recompute(self, info: SymbolInfo, horizon: int) -> dict:
        df = self.store.load(info)
        if len(df) < self.cfg.min_bars:
            raise QuantError(
                f"{info.code} 历史仅 {len(df)} 根，少于 {self.cfg.min_bars}，样本不足以拟合", status=422
            )
        prepared = prepare_symbol(df, info, eval_config(self.cfg))
        if prepared is None:
            raise QuantError(f"{info.code} 预处理失败（历史过短或缺口过多）", status=422)
        single = {k: v for k, v in FullFitConfig().__dict__.items() if k != "horizons"}
        fit = fit_symbol(prepared, FullFitConfig(horizons=(horizon,), **single))
        if not fit:
            raise QuantError(
                f"{info.code} 第 {horizon} 根无满足样本/覆盖率下限的规律", status=422
            )
        return {
            "probability": fit.get("probability"),
            "predictions": int(fit.get("predictions") or 0),
            "direction": int(fit.get("latest_direction") or 0),
            "baseline_up": fit.get("base_up_rate"),
            "coverage": fit.get("coverage"),
            "rules": fit.get("rules"),
            "period": [fit.get("start"), fit.get("end")],
            "weighted_accuracy": fit.get("weighted_accuracy"),
        }

    def _assemble(self, info: SymbolInfo, horizon: int, resolved_date: str | None,
                  row: dict, source: str, projected: bool = False) -> ProbabilityResult:
        direction = int(row.get("direction") or 0)
        prob = row.get("probability")
        # direction=0 时不发方向预测：概率置 None（任务书硬要求）
        probability = float(prob) if (direction != 0 and prob is not None) else None
        baseline = row.get("baseline_up")
        rules = row.get("rules")
        if rules is None and direction != 0:
            # 网格没存规则名；按需补一次重算拿规则（仅在有方向时值得补）
            try:
                recomputed = self._recompute(info, horizon)
                rules = recomputed.get("rules")
                if row.get("period") is None:
                    row["period"] = recomputed.get("period")
            except QuantError:
                rules = []
        rules = rules or []
        rule_detail = [{"key": k, "desc": _RULE_DESC.get(k, k)} for k in rules]

        warnings = [
            "内样本历史频率，不是校准后的未来概率",
            "中性期（无方向信号）不发出预测",
        ]
        if source == "grid":
            warnings.append("取自预算概率网格（全历史拟合，无留出）")
        if projected and resolved_date is not None:
            warnings.append(f"目标日期 {resolved_date} 为投影交易日（工作日近似，未排除法定节假日）")
        period = row.get("period") or (self.grid_meta.get("snapshot"),)
        coverage_val = row.get("coverage")

        return ProbabilityResult(
            symbol={"code": info.code, "category": info.category, "name": info.name},
            target={
                "horizon": horizon,
                "target_date": resolved_date,
                "trading_days": horizon,
            },
            direction=direction,
            direction_label=_DIR_LABEL.get(direction, "中性"),
            probability=probability,
            sample={
                "predictions": int(row.get("predictions") or 0),
                "coverage": float(coverage_val) if coverage_val is not None else 0.0,
                "period": list(period) if isinstance(period, (list, tuple)) else [period],
            },
            baseline_up=float(baseline) if baseline is not None else None,
            rules=rule_detail,
            method="fullfit_recency_weighted_v1",
            evaluation={"type": "in_sample", "calibrated": False},
            warnings=warnings,
            source=source,
        )

    # ------------------------------------------------------------------ 快照（给专家工具用）
    def quant_snapshot(self, code: str, category: str | None, horizon: int) -> dict:
        """量化专家工具只读视图：方向/概率/样本/规则，附完整口径标注。"""
        res = self.probability(code, category, horizon=horizon)
        return res.as_dict()

    # ------------------------------------------------------------------ 搜索
    def search(self, query: str, limit: int = 20) -> list[dict]:
        if not self.capabilities["research_data_available"]:
            return []
        cat = self.store.catalog()
        q = (query or "").strip()
        if not q or cat.empty:
            return []
        mask = cat["code"].str.contains(q, na=False) | cat["name"].str.contains(q, na=False)
        hit = cat[mask].head(limit)
        return [
            {"code": r["code"], "name": r["name"], "category": r["category"],
             "board": r["board"]}
            for _, r in hit.iterrows()
        ]

    def close_price(self, code: str, category: str, on_date: str | None = None) -> float | None:
        """取某日收盘价（on_date 缺省取最新）。"""
        info = self.resolve_symbol(code, category)
        df = self.store.load(info)
        if df.empty:
            return None
        if on_date is None:
            return float(df["close"].iloc[-1])
        d = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
        hit = df[d == pd.Timestamp(on_date).strftime("%Y-%m-%d")]
        if hit.empty:
            return None
        return float(hit["close"].iloc[0])

    def forward_price(self, code: str, category: str, from_date: str, horizon: int) -> dict:
        """从某交易日起，第 horizon 根之后的实际收盘价与收益（复盘用真实行情）。"""
        info = self.resolve_symbol(code, category)
        df = self.store.load(info)
        dates = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d").tolist()
        closes = df["close"].astype(float).tolist()
        target = pd.Timestamp(from_date).strftime("%Y-%m-%d")
        # 找到 >= from_date 的第一个交易日作为基准
        start_i = next((i for i, d in enumerate(dates) if d >= target), None)
        if start_i is None:
            return {"available": False, "reason": "记录日期晚于已有数据"}
        end_i = start_i + horizon
        entry_close = closes[start_i]
        if end_i >= len(closes):
            return {
                "available": False,
                "reason": f"第 {horizon} 根尚未到来（数据仅到 {dates[-1]}）",
                "entry_date": dates[start_i], "entry_close": entry_close,
                "bars_available": len(closes) - 1 - start_i,
            }
        exit_close = closes[end_i]
        return {
            "available": True,
            "entry_date": dates[start_i], "entry_close": entry_close,
            "exit_date": dates[end_i], "exit_close": exit_close,
            "raw_return": exit_close / entry_close - 1.0,
        }


_ENGINE: QuantEngine | None = None
_ENGINE_LOCK = threading.Lock()


def get_engine() -> QuantEngine:
    global _ENGINE
    if _ENGINE is None:
        with _ENGINE_LOCK:
            if _ENGINE is None:
                _ENGINE = QuantEngine()
    return _ENGINE


def set_engine_for_test(engine: QuantEngine) -> None:
    global _ENGINE
    _ENGINE = engine
