"""后端测试夹具：用临时 SQLite + 假量化引擎，隔离真实数据与模型。

真实数据相关的概率测试单独用 @pytest.mark 标记（见 test_probability_live.py），
其余测试全部走假引擎，保证离线、快速、可复现。
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.quant import ProbabilityResult, QuantError
from backend.services import Services
from backend.settings import Settings, ModelSettings


class FakeEngine:
    """可控的假量化引擎：按预设返回概率/价格，不读磁盘。"""

    def __init__(self):
        self.grid_meta = {"snapshot": "2026-11-05", "symbols": 2}
        self._symbols = {
            ("601088", "个股"): "中国神华",
            ("000001", "个股"): "平安银行",
            ("159603", "ETF"): "科创创业ETF天弘",
        }
        # (code,category,horizon) -> dict
        self.prob_overrides = {}

    # -- 标的 --
    def resolve_symbol(self, code, category):
        from super_trader.data import SymbolInfo
        name = self._symbols.get((code, category or "个股"))
        if name is None:
            # 允许不指定分类
            for (c, cat), nm in self._symbols.items():
                if c == code:
                    code, category, name = c, cat, nm
                    break
        if name is None:
            raise QuantError(f"未知标的: {code}", status=404)
        return SymbolInfo(code=code, name=name, category=category or "个股",
                          path="", board="主板", price_limit=0.10)

    def search(self, q, limit=20):
        return [{"code": c, "name": n, "category": cat, "board": "主板"}
                for (c, cat), n in self._symbols.items() if q in c or q in n][:limit]

    # -- 概率 --
    def probability(self, code, category, *, horizon=None, target_date=None, recompute=False):
        if horizon is None and target_date is None:
            raise QuantError("必须提供 horizon 或 date 之一")
        info = self.resolve_symbol(code, category)
        if target_date is not None and horizon is None:
            if target_date <= "2026-11-05":
                raise QuantError("目标日期不晚于快照日", status=400)
            horizon = 3
        horizon = horizon or 10
        if not (1 <= horizon <= 20):
            raise QuantError("horizon 必须在 1-20")
        key = (info.code, info.category, horizon)
        ov = self.prob_overrides.get(key, {})
        direction = ov.get("direction", 1 if info.code == "159603" else 0)
        prob = ov.get("probability", 0.58 if direction else None)
        prob = prob if direction != 0 else None
        return ProbabilityResult(
            symbol={"code": info.code, "category": info.category, "name": info.name},
            target={"horizon": horizon, "target_date": "2026-11-12" if target_date else None,
                    "trading_days": horizon},
            direction=direction, direction_label={1: "上涨", -1: "下跌", 0: "中性"}[direction],
            probability=prob,
            sample={"predictions": 300, "coverage": 0.15, "period": ["2005-01-04", "2026-11-05"]},
            baseline_up=0.51,
            rules=[{"key": "波动率__squeeze_break", "desc": "波动收敛突破"}] if direction else [],
            method="fullfit_recency_weighted_v1",
            evaluation={"type": "in_sample", "calibrated": False},
            warnings=["内样本历史频率，不是校准后的未来概率"], source="grid",
        )

    def quant_snapshot(self, code, category, horizon):
        return self.probability(code, category, horizon=horizon).as_dict()

    # -- 复盘价格 --
    def forward_price(self, code, category, from_date, horizon):
        if from_date >= "2026-11-05":
            return {"available": False, "reason": "记录日期晚于已有数据"}
        return {"available": True, "entry_date": from_date, "entry_close": 30.0,
                "exit_date": "2026-09-15", "exit_close": 33.0, "raw_return": 0.1}


@pytest.fixture()
def fake_engine():
    return FakeEngine()


@pytest.fixture()
def services(tmp_path, fake_engine):
    settings = Settings(state_db=tmp_path / "test.db", host="127.0.0.1", port=8000,
                        model=ModelSettings(base_url="https://x/v1", api_key="",
                                            model="deepseek-chat", timeout=5))
    svc = Services(settings=settings, engine=fake_engine)
    yield svc
    svc.close()


@pytest.fixture()
def client(services):
    app = create_app(services)
    return TestClient(app)
