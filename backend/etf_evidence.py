"""ETF-specific evidence. No synthetic NAV, IOPV, constituent breadth or stock financials."""
from copy import deepcopy
import math


ETF_ANALYSIS_POLICY = {
    "excluded_sources": ["valuation", "news"],
    "excluded_metrics": ["iopv", "realtime_premium", "tracking_index_pe_percentile"],
    "ignore_missing_excluded": True,
    "instructions": "本轮ETF不使用实时IOPV/折溢价、指数估值分位及基金新闻；不补查、不列缺口，不因此降置信度或弃权，不声称已取得。",
}


def _number(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


def _missing(message, **extra):
    return {"available": False, "error": message, **extra}


def etf_sections(datasets, quote, history):
    """Use actual source dates and keep missing endpoints independent."""
    datasets = datasets if isinstance(datasets, dict) else {}
    sections = {key: deepcopy(datasets.get(key) or _missing("该基金证据接口尚不可用"))
                for key in ("profile", "nav", "holdings", "performance", "financials", "indicators", "news")}
    profile = sections["profile"]
    profile.setdefault("warnings", []).append(
        "fund_scale保留上游原值，未提供规模单位/报告日时不声称是实时规模；资料页unit_nav无净值日期，净值以nav源为准；费率字符串不补零。")
    sections["nav"].setdefault("warnings", []).append(
        "nav_date是净值估值日，不是接口时间；QDII存在境内外时差，unit_nav与adj_nav不可混用。")

    rows = history.get("data", {}).get("items", []) if history.get("available") else []
    dated = [row for row in rows if isinstance(row, dict) and type(row.get("date_ms")) is int]
    dated.sort(key=lambda row: row["date_ms"])
    recent = dated[-20:]
    amounts = [_number(row.get("turnover")) for row in recent]
    amounts = [value for value in amounts if value is not None and value >= 0]
    observations = {}
    if amounts:
        observations.update(mean_turnover_20d=sum(amounts) / len(amounts), turnover_sample_count=len(amounts),
                            first_date_ms=recent[0]["date_ms"], last_date_ms=recent[-1]["date_ms"])
    snapshots = quote.get("data", {}).get("items", []) if quote.get("available") else []
    if snapshots:
        for key in ("turnover", "volume", "turnover_ratio_pct"):
            value = _number(snapshots[0].get(key))
            if value is not None:
                observations["snapshot_" + key] = value
        if any(key.startswith("snapshot_") for key in observations):
            observations["snapshot_timestamp"] = quote.get("data", {}).get("timestamp")
    liquidity = {"available": bool(observations), "data": observations,
                 "warnings": ["成交额/换手只是历史流动性观测，无盘口深度/买卖价差，不能保证大额订单可成交。"]}
    fund = {"available": any(sections[key].get("available") for key in ("profile", "nav", "performance", "financials")) or liquidity["available"],
            "data": {key: value for key, value in sections.items() if key not in ("holdings", "news", "indicators")},
            "warnings": ["基金资料/基金财务指标不等于成分公司的营收、ROE或护城河。"]}
    fund["data"]["liquidity"] = liquidity

    constituents = sections["holdings"]
    if constituents.get("available"):
        data = constituents.setdefault("data", {})
        holdings = data.get("items", [])
        # thscode belongs to the held asset; foreign IDs must not be coerced to A-share codes.
        data["items"] = [{**row, "name": row.get("stock_name", row.get("name")),
                          "weight_pct": row.get("hold_ratio")} for row in holdings]
        data.update(sample_type="fund_disclosed_holdings", disclosed_count=len(holdings),
                    is_full_index=False)
        dates = [row["end_date_ms"] for row in holdings if type(row.get("end_date_ms")) is int and row["end_date_ms"] > 0]
        constituents["as_of"] = max(dates) if dates else None
        constituents.setdefault("warnings", []).append(
            "定期披露的基金持仓不等于实时持仓或完整指数成分；权重保留hold_ratio原值；不对海外持仓套用A股行情/估值。")

    # Explicitly outside this analysis, not a failed data prerequisite.
    valuation = {"available": False, "excluded": True, "attempted": False}
    news = {"available": False, "excluded": True, "attempted": False}
    fundamentals = deepcopy(sections["financials"])
    if fundamentals.get("available"):
        fundamentals["data"]["kind"] = "fund_financial_indicators"
        fundamentals.setdefault("warnings", []).append(
            "基金报告期收入/利润/资产净值不是持仓公司的营业收入、净利润或资产负债表，不据此推断成分股盈利。")
    return {"fund": fund, "constituents": constituents, "valuation": valuation,
            "analysis_policy": deepcopy(ETF_ANALYSIS_POLICY),
            "fundamentals": fundamentals, "news": news,
            "breadth": _missing("披露持仓不是完整指数成分，且缺少匹配时刻的海外报价，未伪造市场宽度")}
