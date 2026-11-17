"""命令行：``python -m backend.factors.cli <code>``

输出 JSON：as_of / bars / 最优规则（默认 3 条）及 accuracy / coverage / per_horizon 摘要。
失败时打印 ``{"error": ...}`` 并以退出码 1 结束。
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .service import FactorError, FactorService


def _configure_stdout() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:  # pragma: no cover - 非标准流
        pass


def _brief(entry: dict) -> dict:
    metrics = entry.get("metrics", entry)
    rule = entry.get("rule", {})
    per_horizon = [
        {
            "h": int(item["h"]),
            "accuracy": item.get("accuracy"),
            "evaluated": int(item.get("evaluated", 0)),
        }
        for item in metrics.get("per_horizon", [])
    ]
    return {
        "id": rule.get("id"),
        "name": rule.get("name"),
        "family": rule.get("family", ""),
        "neutral_band": rule.get("neutral_band"),
        "accuracy": metrics.get("accuracy"),
        "coverage": metrics.get("coverage"),
        "evaluated": metrics.get("evaluated"),
        "correct": metrics.get("correct"),
        "skipped": metrics.get("skipped"),
        "not_evaluated": metrics.get("not_evaluated"),
        "baseline_always_up": (metrics.get("baseline") or {}).get("always_up"),
        "per_horizon": per_horizon,
    }


def build_payload(service: FactorService, code: str, top: int = 3) -> dict:
    dataframe = service.bars(code)
    seeds = service.evaluate_seeds(code)
    if not seeds:
        raise FactorError(f"没有可用的种子规则: {code}", 503)
    prediction = service.predict(code)
    rule = service.symbol(code)
    return {
        "code": rule["code"],
        "name": rule["name"],
        "timeframe": "1d",
        "as_of": prediction["as_of"],
        "bars": int(len(dataframe)),
        "data_version": prediction["data_version"],
        "best": _brief(seeds[0]),
        "rules": [_brief(item) for item in seeds[: max(1, int(top))]],
        "direction_now": prediction["direction_now"],
        "score_now": prediction["score_now"],
    }


def main(argv: list[str] | None = None) -> int:
    _configure_stdout()
    parser = argparse.ArgumentParser(
        prog="python -m backend.factors.cli",
        description="Phase 0 确定性因子评估内核（只读本地日线 CSV）",
    )
    parser.add_argument("code", help="标的代码，例如 601088")
    parser.add_argument("--data-root", default=None, help="覆盖数据根目录")
    parser.add_argument("--top", type=int, default=3, help="输出的最优规则条数（默认 3）")
    parser.add_argument("--timeframe", default="1d", help="周期，当前只支持 1d")
    parser.add_argument("--indent", type=int, default=2, help="JSON 缩进（0 为紧凑输出）")
    args = parser.parse_args(argv)

    try:
        service = FactorService(args.data_root)
        if not service.available():
            raise FactorError(f"数据根目录不可用: {service.root()}", 503)
        payload: dict[str, Any] = build_payload(service, args.code, top=args.top)
        payload["timeframe"] = args.timeframe
        if payload["timeframe"] != "1d":
            service.bars(args.code, payload["timeframe"])  # 触发明确的不支持错误
    except (FactorError, ValueError, FileNotFoundError) as exc:
        error = {
            "error": str(exc),
            "type": type(exc).__name__,
        }
        status = getattr(exc, "status", None)
        if status is not None:
            error["status"] = status
        print(json.dumps(error, ensure_ascii=False, indent=2))
        return 1

    indent = args.indent if args.indent and args.indent > 0 else None
    print(json.dumps(payload, ensure_ascii=False, indent=indent))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
