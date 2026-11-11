"""为每个标的生成 1–20 根持有期的方向概率网格。

量化概率页需要「未来第 N 根」的概率，而 fullfit.json 只保留胜率最高的那一根。
这里对每个标的逐命中周期各挑一组规则，输出紧凑的 20 档网格：

    {code, category, name, rows: [[概率×1000, 预测数, 当前方向, 单边基准×1000], ...] }

仍然是全历史拟合的内样本结果，不是未来校准概率。
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
import json
import multiprocessing as mp
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from super_trader.config import Config
from super_trader.data import KlineStore, SymbolInfo
from super_trader.evaluate import prepare_symbol
from super_trader.fullfit import FullFitConfig, fit_symbol
from super_trader.scan import eval_config

_CACHE: dict = {}


def _init(cfg_dict: dict) -> None:
    _CACHE["cfg"] = Config(**cfg_dict)
    _CACHE["store"] = KlineStore(_CACHE["cfg"].data_path, _CACHE["cfg"].cache_path)


def _one(item):
    info, cfg_dict = item
    cfg = _CACHE["cfg"]
    df = _CACHE["store"].load(info)
    if len(df) < cfg.min_bars:
        return None
    prepared = prepare_symbol(df, info, eval_config(cfg))
    if prepared is None:
        return None
    rows = []
    single = {k: v for k, v in cfg_dict.items() if k != "horizons"}
    for horizon in range(1, 21):
        row = fit_symbol(prepared, FullFitConfig(horizons=(horizon,), **single))
        if not row:
            rows.append(None)
            continue
        rows.append([
            int(round((row["weighted_accuracy"] or 0) * 1000)),
            int(row["predictions"] or 0),
            int(row["latest_direction"] or 0),
            int(round((row["base_up_rate"] or 0) * 1000)),
            int(round((row["coverage"] or 0) * 1000)),
        ])
    del prepared
    if not any(rows):
        return None
    return {"code": info.code, "category": info.category, "name": info.name, "rows": rows}


def _members(store):
    cat = store.catalog()
    order = cat.sort_values("size", ascending=False) if "size" in cat else cat
    for _, row in order.iterrows():
        yield (SymbolInfo(code=str(row["code"]), name=str(row["name"]),
                          category=str(row["category"]), path=str(row["path"]),
                          board=str(row["board"]), price_limit=float(row["price_limit"])), "all")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--out", type=Path,
                        default=ROOT / "reports" / "fullfit" / "probability_grid.json")
    args = parser.parse_args()

    cfg = Config.load()
    cfg.ensure_dirs()
    store = KlineStore(cfg.data_path, cfg.cache_path)
    items = list(_members(store))
    if args.limit:
        items = items[: args.limit]
    cfg_dict = asdict(FullFitConfig())
    items = [(info, cfg_dict) for info, _tag in items]

    results = []
    done = 0
    total = len(items)
    with mp.Pool(args.workers, initializer=_init, initargs=(asdict(cfg),)) as pool:
        for row in pool.imap_unordered(_one, items, chunksize=4):
            done += 1
            if row:
                results.append(row)
            if done % 200 == 0 or done == total:
                print(f"[{done}/{total}] 收录 {len(results)}", flush=True)

    results.sort(key=lambda r: (r["category"], r["code"]))
    payload = {
        "generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "snapshot": "2026-11-05",
        "scope": "in_sample_full_history_no_split",
        "horizons": list(range(1, 21)),
        "symbols": len(results),
        "fields": ["prob_x1000", "predictions", "direction", "base_up_x1000", "coverage_x1000"],
        "data": results,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8", newline="\n")
    print(f"{args.out} {args.out.stat().st_size:,} bytes · {len(results)} 个标的")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
