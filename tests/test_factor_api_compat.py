import numpy as np
import pytest

from backend.factors.sandbox import DEFAULT_SANDBOX, SandboxError


def columns(n=120):
    close = np.linspace(10.0, 20.0, n)
    return {
        "open": (close - 0.1).tolist(),
        "high": (close + 0.2).tolist(),
        "low": (close - 0.2).tolist(),
        "close": close.tolist(),
        "volume": np.full(n, 1000.0).tolist(),
        "turnover": np.full(n, 1e6).tolist(),
    }


def run(source):
    return DEFAULT_SANDBOX.run(source, columns())


def test_numpy_facade_and_bare_aliases_and_attribute_columns():
    source = (
        "def factor(df):\n"
        "    c = df.close\n"
        "    m = F.rolling_mean(c, 20)\n"
        "    r = rsi(c, 14)\n"
        "    z = np.where(c > m, 1.0, -1.0)\n"
        "    out = np.nan_to_num(z, nan=0.0, posinf=0.0, neginf=0.0)\n"
        "    return out\n"
    )
    values = run(source)
    assert len(values) == 120
    finite = values[np.isfinite(values)]
    assert set(np.unique(finite)) <= {-1.0, 1.0}


def test_numpy_like_keywords_do_not_break_nan_to_num():
    source = (
        "def factor(df):\n"
        "    x = np.where(df['close'] > 0, 1.0, 0.0)\n"
        "    return nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0, copy=False)\n"
    )
    assert len(run(source)) == 120


def test_numpy_asarray_and_reductions_work():
    source = (
        "def factor(df):\n"
        "    c = np.asarray(df['close'])\n"
        "    x = np.nanmean(c)\n"
        "    return np.where(c > x, 1.0, -1.0)\n"
    )
    values = run(source)
    assert len(values) == 120
    assert set(np.unique(values[np.isfinite(values)])) <= {-1.0, 1.0}


def test_numpy_logical_and_is_available_and_the_failed_rule_now_runs():
    # Exact shape of the rule that failed 100 times in job-ee139da7cd31.
    source = (
        "def factor(df):\n"
        "    c = df['close']\n"
        "    eps = 1e-9\n"
        "    lc = np.log(np.where(c > eps, c, eps))\n"
        "    r1 = diff(lc, 1)\n"
        "    vol = rolling_std(r1, 20)\n"
        "    vol = np.where(vol > eps, vol, eps)\n"
        "    z1 = r1 / vol\n"
        "    s = -np.tanh(0.9 * np.clip(z1, -6.0, 6.0))\n"
        "    s = np.nan_to_num(s, nan=0.0, posinf=0.0, neginf=0.0)\n"
        "    idx = arange(len(c))\n"
        "    gate = np.logical_and(idx >= 25, np.abs(z1) > 2.0)\n"
        "    return np.where(gate, s, 0.0)\n"
    )
    values = run(source)
    assert len(values) == 120
    assert np.isfinite(values).all()


def test_bare_numpy_helpers_are_available_without_prefix():
    source = (
        "def factor(df):\n"
        "    c = asarray(df['close'])\n"
        "    x = tanh(c / nanmean(c) - 1.0)\n"
        "    return np.where(x > 0, 1.0, -1.0)\n"
    )
    values = run(source)
    assert len(values) == 120
    assert set(np.unique(values[np.isfinite(values)])) <= {-1.0, 1.0}


@pytest.mark.parametrize("source", [
    "def factor(df):\n    return np.load('x')\n",
    "def factor(df):\n    return np.zeros(1).tofile('x')\n",
    "def factor(df):\n    return df.__class__\n",
])
def test_no_file_or_dunder_escape_is_exposed(source):
    with pytest.raises(SandboxError):
        run(source)
