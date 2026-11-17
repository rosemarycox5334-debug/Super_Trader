from backend.factors.batch import report_for, WARNINGS


def row(evaluated, coverage, accuracy=0.9):
    return {
        "target_id": "ETF:159168", "code": "159168", "name": "小样本ETF", "category": "ETF",
        "data_version": "v1", "direction_now": 1,
        "metrics": {"accuracy": accuracy, "coverage": coverage, "evaluated": evaluated,
                    "correct": int(evaluated * accuracy), "skipped": 0, "not_evaluated": 0,
                    "bars": 174, "as_of": "2026-11-05", "direction_now": 1,
                    "baseline": {"always_up": 0.5, "same_set": 0.5, "all_window_up_rate": 0.5},
                    "confusion": {"pred_up": {}, "pred_down": {}},
                    "per_horizon": []},
    }


def rule():
    return {"id": "llm-x", "name": "x", "kind": "code", "source_sha256": "a" * 64}


def test_thin_sample_is_flagged_but_still_sorted_by_accuracy():
    thin = report_for(row(670, 0.2049, 0.9104), rule(), row(670, 0.2049, 0.9104)["metrics"], "v1")
    normal = report_for(row(5000, 0.6, 0.55), rule(), row(5000, 0.6, 0.55)["metrics"], "v1")
    assert thin["sample_quality"] == "thin"
    assert any("样本提醒" in w for w in thin["warnings"])
    assert normal["sample_quality"] == "normal"
    assert not any("样本提醒" in w for w in normal["warnings"])
    assert thin["metrics"]["accuracy"] == 0.9104


def test_low_coverage_is_flagged_even_with_many_windows():
    low = report_for(row(5000, 0.0051, 0.7333), rule(), row(5000, 0.0051)["metrics"], "v1")
    assert low["sample_quality"] == "thin"
    assert any("覆盖率" in w for w in low["warnings"])
