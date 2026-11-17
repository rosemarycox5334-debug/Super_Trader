"""本地日线数据集：路径解析、标的扫描、CSV 读取/校验、数据版本指纹。

约定（与 ``super_trader.data`` 保持一致，但本模块只读、不写任何缓存/用户目录）：

    {根}/个股/{代码}_{名称}.csv
    date,open,close,high,low,volume,amount,amplitude,pct_chg,change,turnover

* 只处理个股目录；不扫 ETF / 指数。
* 只按单只标的读取，绝不遍历目录内容解析全部 CSV。
* 不复权原始行情；价格无效（<=0 / 非有限值）与 high<low 的行直接丢弃。
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

import numpy as np
import pandas as pd

STOCK_CATEGORY = "个股"
DEFAULT_ROOT = r"D:\A股k线数据\多周期\日线"
MIN_BARS = 100

REQUIRED_COLUMNS = ("date", "open", "high", "low", "close")
OPTIONAL_COLUMNS = (
    "volume", "amount", "amplitude", "pct_chg", "change", "turnover",
)
# 对外统一输出的列顺序（缺失的可选列补 0）
OUTPUT_COLUMNS = REQUIRED_COLUMNS + OPTIONAL_COLUMNS


# ---------------------------------------------------------------------- 路径
def default_data_root() -> Path:
    """数据根目录：环境变量 > super_trader 配置 > 本机默认路径。"""
    env = os.environ.get("SUPER_TRADER_DATA_ROOT")
    if env:
        return Path(env)

    try:  # 本地已有配置层；get_config 不存在时退回 Config.load()
        from super_trader import config as st_config
    except Exception:  # pragma: no cover - 极端情况下没有 super_trader 包
        return Path(DEFAULT_ROOT)

    getter = getattr(st_config, "get_config", None)
    if callable(getter):
        try:
            root = getattr(getter(), "data_root", None)
            if root:
                return Path(root)
        except Exception:  # pragma: no cover - 配置层异常不应阻断取数
            pass
    try:
        return Path(st_config.Config.load().data_root)
    except Exception:  # pragma: no cover
        return Path(DEFAULT_ROOT)


def resolve_root(data_root: str | Path | None = None) -> Path:
    """显式传入优先，否则走默认解析。"""
    return Path(data_root) if data_root else default_data_root()


def stock_dir(root: str | Path) -> Path:
    return Path(root) / STOCK_CATEGORY


def scan_symbols(root: str | Path, limit: int | None = None) -> list[dict]:
    """扫描 ``{根}/个股/*.csv``（只读文件名），按代码排序。"""
    d = stock_dir(root)
    if not d.is_dir():
        return []
    rows: list[dict] = []
    for p in sorted(d.glob("*.csv")):
        stem = p.stem
        if "_" not in stem:
            continue
        code, name = stem.split("_", 1)
        code = code.strip()
        if not code:
            continue
        rows.append({"code": code, "name": name.strip(), "path": str(p)})
    rows.sort(key=lambda r: (r["code"], r["name"]))
    if limit is not None:
        rows = rows[: max(0, int(limit))]
    return rows


# ---------------------------------------------------------------------- 读取
def read_bars(path: str | Path) -> pd.DataFrame:
    """读取并校验单只标的日线，返回按日期升序、索引重置的 DataFrame。"""
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"数据文件不存在: {p}")

    df = pd.read_csv(p, encoding="utf-8-sig")
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"{p.name} 缺列: {missing}")

    cols = [c for c in OUTPUT_COLUMNS if c in df.columns]
    df = df.loc[:, cols].copy()

    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.normalize()
    for c in cols:
        if c == "date":
            continue
        vals = pd.to_numeric(df[c], errors="coerce").to_numpy(dtype=float)
        df[c] = np.where(np.isfinite(vals), vals, np.nan)

    df = df.dropna(subset=list(REQUIRED_COLUMNS))
    df = df[(df["close"] > 0) & (df["open"] > 0) & (df["high"] > 0) & (df["low"] > 0)]
    df = df[df["high"] >= df["low"]]
    df = df.drop_duplicates(subset="date", keep="last").sort_values("date")
    df = df.reset_index(drop=True)

    for c in OPTIONAL_COLUMNS:
        if c not in df.columns:
            df[c] = 0.0
        else:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
    for c in ("volume", "amount"):
        df[c] = df[c].clip(lower=0.0)

    df = df.loc[:, list(OUTPUT_COLUMNS)]
    df.attrs["path"] = str(p)
    return df


def data_version(path: str | Path, rows: int) -> str:
    """数据版本指纹：文件 mtime + size + 有效行数。"""
    st = Path(path).stat()
    raw = f"{st.st_mtime_ns}|{st.st_size}|{int(rows)}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
