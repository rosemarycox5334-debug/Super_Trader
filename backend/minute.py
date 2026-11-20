"""Minute bars (TDX protocol) used only to verify intraday sequencing.

Daily bars cannot prove "pullback then breakout" or whether volume expanded.
These bars come from a public quote feed; prices/volumes are normalised against
the daily close we already trust, and any failure degrades to daily-only review.
"""
from __future__ import annotations

import threading
from datetime import datetime

MARKET_BY_PREFIX = {"6": 1, "9": 1, "0": 0, "2": 0, "3": 0, "4": 2, "8": 2}
PERIODS = {1: 7, 5: 0, 15: 1, 30: 2, 60: 3}
FAIL_BACKOFF_SECONDS = 300


class MinuteBars:
    def __init__(self, clock=None):
        self._lock = threading.RLock()
        self._client = None
        self._failed_until = 0.0
        self._clock = clock or (lambda: datetime.now().timestamp())

    def _connect(self):
        from opentdx.client import QuotationClient  # optional dependency
        client = QuotationClient(True, True)
        client.connect().login()
        return client

    def _session(self, code):
        if not isinstance(code, str) or not code[:1].isdigit():
            return None
        market = MARKET_BY_PREFIX.get(code[:1])
        return None if market is None else market

    def bars(self, code, *, period=5, count=200, price_hint=None):
        """Newest `count` bars, oldest first; [] when the feed is unavailable."""
        market = self._session(code)
        if market is None or period not in PERIODS or not 20 <= count <= 800:
            return []
        if self._clock() < self._failed_until:
            return []
        with self._lock:
            try:
                from opentdx.const import ADJUST, MARKET, PERIOD
                if self._client is None:
                    self._client = self._connect()
                # `market` is resolved locally; PERIOD maps our minutes to the feed.
                result = self._client.get_kline(MARKET(market), code, PERIOD(PERIODS[period]),
                                                0, count, 1, ADJUST.NONE)
            except Exception:
                self._client = None
                self._failed_until = self._clock() + FAIL_BACKOFF_SECONDS
                return []
        rows = result.get("data") if isinstance(result, dict) else result
        if not isinstance(rows, list):
            return []
        # The feed returns prices x10, volume x100 and turnover x10000 relative to
        # the exchange convention; confirm with the trusted daily close when given.
        scale = 10.0
        if price_hint and rows:
            try:
                ratio = float(rows[-1]["close"]) / float(price_hint)
                if 0.5 <= ratio <= 2:
                    scale = 1.0
                elif 5 <= ratio <= 20:
                    scale = round(ratio)
            except Exception:
                scale = 10.0
        clean = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            stamp, close = row.get("datetime"), row.get("close")
            if not isinstance(stamp, datetime) or not isinstance(close, (int, float)):
                continue
            values = {}
            for key in ("open", "high", "low", "close"):
                value = row.get(key)
                values[key] = round(float(value) / scale, 2) if isinstance(value, (int, float)) else None
            volume = row.get("vol")
            values["volume"] = int(float(volume) / 100) if isinstance(volume, (int, float)) else None
            if values["close"] is None:
                continue
            values.update(datetime=stamp.strftime("%Y-%m-%d %H:%M"), date=stamp.strftime("%Y-%m-%d"))
            clean.append(values)
        return clean


_SHARED = None
_SHARED_LOCK = threading.Lock()


def shared() -> MinuteBars:
    """Process-wide instance so a dead feed costs one attempt, not one per plan."""
    global _SHARED
    with _SHARED_LOCK:
        if _SHARED is None:
            _SHARED = MinuteBars()
        return _SHARED
