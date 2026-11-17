"""后端运行期配置：只从环境变量 / 密钥文件 + 默认值读取，密钥绝不写盘到前端。

模型网关兼容 OpenAI /chat/completions 协议。默认接 Command Code（DSH 用的
OpenAI 兼容网关），也可通过环境变量切到任意兼容端点。支持的环境变量：

    ST_MODEL_BASE_URL   OpenAI 兼容网关地址（默认 Command Code）
    ST_MODEL_API_KEY    模型密钥（缺失时专家接口返回明确错误而非伪造）
    ST_MODEL_KEY_FILE   密钥文件路径（替代直接给 key，便于不把 key 写进启动脚本）
    ST_MODEL_NAME       模型 id（Command Code 的 id 带前缀，如 deepseek/deepseek-v4.1-flash）
    ST_MODEL_TIMEOUT    单次请求超时秒数（默认 60）
    ST_MODEL_ZDR        是否带 x-cmd-zdr 零数据保留头（默认 1，Command Code 需要）
    ST_STATE_DB         状态库路径（默认 backend/state.db）
    ST_HOST / ST_PORT   服务监听地址（默认 127.0.0.1:8000）

密钥来源优先级：ST_MODEL_API_KEY > COMMANDCODE_API_KEY / DEEPSEEK_API_KEY /
OPENAI_API_KEY > ST_MODEL_KEY_FILE 指定的文件 > 若干默认候选文件。
所有来源都只在服务端内存，不下发前端，不写回磁盘。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_ROOT.parent

# Command Code（DSH）默认网关与默认模型
DEFAULT_BASE_URL = "https://api.commandcode.ai/provider/v1"
DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash"
# DSH 特意伪装成 Chrome，裸 UA 某些通道会被拦；默认带上。
DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36")

# 默认密钥文件候选（从文件取 key，避免写进 bat / 环境变量）
_DEFAULT_KEY_FILES = (
    PROJECT_ROOT / "commandcode_key.txt",         # 项目内（已被 .gitignore 排除）
    PROJECT_ROOT.parent / "commandcode_key.txt",  # 上级目录 D:\cl\commandcode_key.txt
)


def _first_env(*names: str) -> str:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v.strip()
    return ""


def _read_key_file(path: Path) -> str:
    try:
        if path.is_file():
            txt = path.read_text(encoding="utf-8-sig").strip()
            # 取第一行非空（容忍文件里有说明/多行）
            for line in txt.splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    return line
    except OSError:
        pass
    return ""


def _resolve_api_key() -> str:
    key = _first_env("ST_MODEL_API_KEY", "COMMANDCODE_API_KEY",
                     "DEEPSEEK_API_KEY", "OPENAI_API_KEY")
    if key:
        return key
    # 指定的密钥文件
    env_file = os.environ.get("ST_MODEL_KEY_FILE")
    if env_file:
        # Explicitly selected file is authoritative; never fall back to a neighbour.
        return _read_key_file(Path(env_file))
    if os.environ.get("ST_PORTABLE_RUNTIME") == "1":
        return ""
    # 默认候选文件
    for cand in _DEFAULT_KEY_FILES:
        k = _read_key_file(cand)
        if k:
            return k
    return ""


@dataclass(frozen=True)
class ModelSettings:
    base_url: str
    api_key: str
    model: str
    timeout: float
    extra_headers: dict = field(default_factory=dict)

    @property
    def configured(self) -> bool:
        """是否具备真实调用模型的条件（有 key）。"""
        return bool(self.api_key)

    def public_status(self) -> dict:
        """给前端看的状态：只暴露是否就绪与模型名，绝不暴露密钥与 header。"""
        return {
            "configured": self.configured,
            "model": self.model if self.configured else None,
            "base_url": self.base_url if self.configured else None,
        }


@dataclass(frozen=True)
class Settings:
    state_db: Path
    host: str
    port: int
    model: ModelSettings

    @classmethod
    def load(cls) -> "Settings":
        if os.environ.get("ST_PORTABLE_RUNTIME") == "1":
            from super_trader.config import runtime_state_root
            default_db = runtime_state_root() / "state.db"
        else:
            default_db = BACKEND_ROOT / "state.db"
        state_db = Path(os.environ.get("ST_STATE_DB", str(default_db)))
        host = os.environ.get("ST_HOST", "127.0.0.1")
        port = int(os.environ.get("ST_PORT", "8000"))

        headers: dict[str, str] = {"User-Agent": os.environ.get("ST_MODEL_UA", DEFAULT_UA)}
        if os.environ.get("ST_MODEL_ZDR", "1") not in ("0", "false", "no", ""):
            headers["x-cmd-zdr"] = "1"

        model = ModelSettings(
            base_url=os.environ.get("ST_MODEL_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
            api_key=_resolve_api_key(),
            model=os.environ.get("ST_MODEL_NAME", DEFAULT_MODEL),
            timeout=float(os.environ.get("ST_MODEL_TIMEOUT", "60")),
            extra_headers=headers,
        )
        return cls(state_db=state_db, host=host, port=port, model=model)


_SETTINGS: Settings | None = None


def get_settings() -> Settings:
    global _SETTINGS
    if _SETTINGS is None:
        _SETTINGS = Settings.load()
    return _SETTINGS


def reset_settings_for_test(state_db: Path | None = None) -> Settings:
    """测试辅助：用临时库重置单例。"""
    global _SETTINGS
    base = Settings.load()
    if state_db is not None:
        base = Settings(state_db=state_db, host=base.host, port=base.port, model=base.model)
    _SETTINGS = base
    return base
