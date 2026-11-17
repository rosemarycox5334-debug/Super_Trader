"""Super Agent 投研工作台后端。

一个 FastAPI 应用 + SQLite 状态库 + 现有量化引擎（super_trader）。
所有业务状态落盘在 state.db；密钥只从环境变量读，绝不进前端。
"""
from __future__ import annotations

__all__ = ["create_app"]


def create_app():
    from .app import create_app as _create_app

    return _create_app()
