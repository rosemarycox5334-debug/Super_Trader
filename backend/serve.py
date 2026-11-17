"""一条命令起服务：python -m backend.serve

等价于 uvicorn backend.app:app，但会先确保数据库初始化并打印环境就绪情况。
"""
from __future__ import annotations

import uvicorn

from .app import create_app
from .settings import get_settings

app = create_app()


def main() -> None:
    s = get_settings()
    status = "已配置" if s.model.configured else "未配置（专家接口将返回明确错误，不伪造）"
    print(f"Super Agent 工作台启动中 http://{s.host}:{s.port}")
    print(f"状态库: {s.state_db}")
    print(f"模型密钥: {status}  模型: {s.model.model}  网关: {s.model.base_url}")
    uvicorn.run(app, host=s.host, port=s.port, log_level="info")


if __name__ == "__main__":
    main()
