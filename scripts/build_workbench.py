"""把离线工作台构建成单个 HTML（无服务器、无 CDN）。

数据源：reports/fullfit/probability_grid.json
    {symbols:[{code,category,name,rows:[[prob×1000,预测数,方向,单边基准×1000,覆盖×1000], …20]}]}

页面只保留三件事：Super Agent（可插件化改造）、量化概率、专家团队。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FIELDS = 5  # prob, predictions, direction, base_up, coverage


def snapshot_data(source: Path, snapshot: str | None = None) -> dict:
    payload = json.loads(source.read_text(encoding="utf-8"))
    rows = payload.get("data") or []
    symbols = []
    seen = set()
    for item in rows:
        code, category, name = str(item["code"]), str(item["category"]), str(item["name"])
        if (category, code) in seen:
            raise ValueError(f"重复标的：{category} {code}")
        seen.add((category, code))
        cells = item.get("rows") or []
        if len(cells) != 20:
            raise ValueError(f"{code} 的周期数量不是 20")
        clean = []
        for cell in cells:
            if not cell or len(cell) != FIELDS:
                clean.append(None)
                continue
            prob, preds, direction, base, cover = cell
            if direction not in (-1, 0, 1):
                raise ValueError(f"{code} 方向取值非法")
            clean.append([int(prob), int(preds), int(direction), int(base), int(cover)])
        symbols.append([code, category, name, clean])
    if not symbols:
        raise ValueError("概率网格为空")
    return {
        "snapshot": snapshot or payload.get("snapshot") or "2026-11-05",
        "generated_at": payload.get("generated_at", ""),
        "scope": payload.get("scope", "in_sample_full_history_no_split"),
        "symbols": symbols,
    }


def build(output: Path | None = None, source: Path | None = None,
          snapshot: str | None = None) -> Path:
    assets = ROOT / "web" / "workbench"
    output = output or ROOT / "reports" / "chat_main.html"
    source = source or ROOT / "reports" / "fullfit" / "probability_grid.json"
    html = (assets / "index.html").read_text(encoding="utf-8")
    css = "\n".join((assets / name).read_text(encoding="utf-8")
                    for name in ("workbench.css", "superagent.css", "review.css"))
    js = ((assets / "conversation_helpers.js").read_text(encoding="utf-8")
          + "\n" + (assets / "app.js").read_text(encoding="utf-8"))
    data = json.dumps(snapshot_data(source, snapshot), ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).replace("<", "\\u003c")
    for marker, replacement in (
        ("/*__WORKBENCH_CSS__*/", css),
        ("/*__WORKBENCH_DATA__*/", data),
        ("/*__WORKBENCH_JS__*/", js),
    ):
        if html.count(marker) != 1:
            raise ValueError(f"模板中必须恰好出现一次 {marker}")
        html = html.replace(marker, replacement, 1)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8", newline="\n")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--snapshot", default=None)
    args = parser.parse_args()
    path = build(args.output, args.source, args.snapshot)
    print(f"{path} ({path.stat().st_size:,} bytes)")
