from backend.factors.research import FactorResearchService, FactorResearchError
import pytest


def rows(n=8228):
    return [{"target_id": f"个股:{i:06d}", "code": f"{i:06d}"} for i in range(n)]


def test_quick_sample_is_deterministic_and_evenly_spaced():
    scope = rows()
    first = FactorResearchService._sample(scope, 120)
    second = FactorResearchService._sample(scope, 120)
    assert [r["target_id"] for r in first] == [r["target_id"] for r in second]
    assert len(first) == 120
    assert len({r["target_id"] for r in first}) == 120
    indexes = [int(r["code"]) for r in first]
    assert indexes[0] == 0 and indexes[-1] > 7800
    gaps = [b - a for a, b in zip(indexes, indexes[1:])]
    assert min(gaps) > 50 and max(gaps) < 90


def test_sample_preserves_all_when_scope_is_smaller_and_rejects_bad_size():
    small = rows(30)
    assert FactorResearchService._sample(small, 120) == small
    for bad in (19, 501, True, 60.0, "60"):
        with pytest.raises(FactorResearchError):
            FactorResearchService._sample(small, bad)
