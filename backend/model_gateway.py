"""模型网关：兼容 OpenAI /chat/completions 的最小客户端 + 工具调用循环。

* 密钥只从环境变量（settings）读，绝不进前端、绝不入库。
* 未配置密钥时抛 ModelNotConfigured，由上层翻译成明确错误（绝不伪造「已连接」或假答案）。
* 支持 function calling：把工具 schema 传给模型，模型请求调用工具时本地执行后回灌。
"""
from __future__ import annotations

import json
from typing import Any, Callable

import httpx

from .settings import ModelSettings


class ModelNotConfigured(Exception):
    """没有可用模型密钥：诚实报错，不伪造输出。"""


class ModelError(Exception):
    """模型调用失败（网络、超时、限流、协议错误）。"""

    def __init__(self, message: str, status: int = 502, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


ToolFn = Callable[[dict], Any]


class ModelClient:
    def __init__(self, settings: ModelSettings):
        self.settings = settings

    def chat(self, messages: list[dict], *, tools: list[dict] | None = None,
             tool_impls: dict[str, ToolFn] | None = None, temperature: float = 0.3,
             model: str | None = None, max_tool_rounds: int = 4,
             response_format_json: bool = True,
             before_round: Callable[[], None] | None = None,
             max_tokens: int | None = None,
             timeout: float | Callable[[], float] | None = None) -> dict:
        """跑一轮带工具调用的对话，返回 {content, tool_trace, raw}。"""
        if not self.settings.configured:
            raise ModelNotConfigured(
                "未配置模型密钥（环境变量 ST_MODEL_API_KEY），无法真实调用模型"
            )
        tool_impls = tool_impls or {}
        convo = list(messages)
        trace: list[dict] = []
        url = f"{self.settings.base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self.settings.api_key}",
                   "Content-Type": "application/json"}
        # 合入网关专属头（如 Command Code 的 x-cmd-zdr 与伪装 UA）
        headers.update(getattr(self.settings, "extra_headers", {}) or {})

        for _ in range(max_tool_rounds):
            if before_round is not None:
                before_round()
            body: dict[str, Any] = {
                "model": model or self.settings.model,
                "messages": convo,
                "temperature": temperature,
            }
            if tools:
                body["tools"] = tools
                body["tool_choice"] = "auto"
            if response_format_json and not tools:
                body["response_format"] = {"type": "json_object"}
            if max_tokens is not None:
                if type(max_tokens) is not int or max_tokens <= 0:
                    raise ValueError("max_tokens must be a positive integer")
                body["max_tokens"] = max_tokens
            request_timeout = timeout() if callable(timeout) else timeout
            request_timeout = self.settings.timeout if request_timeout is None else request_timeout
            if not isinstance(request_timeout, (int, float)) or request_timeout <= 0:
                raise ModelError("模型请求前剩余时限不足", status=504)
            try:
                with httpx.Client(timeout=request_timeout) as client:
                    resp = client.post(url, headers=headers, json=body)
            except httpx.TimeoutException as exc:
                raise ModelError(f"模型请求超时（{request_timeout}s）", status=504) from exc
            except httpx.HTTPError as exc:
                raise ModelError(f"模型请求失败: {exc}", status=502) from exc
            if resp.status_code == 429:
                raise ModelError("模型限流（429），请稍后重试", status=429)
            if resp.status_code >= 400:
                raise ModelError(
                    f"模型返回 {resp.status_code}: {resp.text[:200]}", status=502
                )
            data = resp.json()
            choice = (data.get("choices") or [{}])[0]
            msg = choice.get("message") or {}
            tool_calls = msg.get("tool_calls")
            if tool_calls:
                convo.append(msg)
                for call in tool_calls:
                    fn = (call.get("function") or {})
                    name = fn.get("name")
                    try:
                        args = json.loads(fn.get("arguments") or "{}")
                    except (TypeError, ValueError):
                        args = {}
                    impl = tool_impls.get(name)
                    if impl is None:
                        result = {"error": f"未知工具 {name}"}
                    else:
                        try:
                            result = impl(args)
                        except Exception as exc:  # noqa: BLE001  工具错误回灌给模型
                            result = {"error": str(exc)}
                    trace.append({"tool": name, "args": args, "result": result})
                    convo.append({
                        "role": "tool", "tool_call_id": call.get("id"),
                        "content": json.dumps(result, ensure_ascii=False, default=str),
                    })
                continue
            finish_reason = choice.get("finish_reason")
            if finish_reason not in ("stop", "length", "tool_calls", "content_filter", "function_call"):
                finish_reason = None
            return {"content": msg.get("content") or "", "tool_trace": trace, "raw": data,
                    "finish_reason": finish_reason}
        raise ModelError("工具调用轮数超限，仍未得到最终回复", status=502, code="tool_round_limit")

    # ------------------------------------------------------------------ 流式
    def chat_stream(self, messages: list[dict], *, tools: list[dict] | None = None,
                    tool_impls: dict[str, ToolFn] | None = None, temperature: float = 0.3,
                    model: str | None = None, max_tool_rounds: int = 4,
                    response_format_json: bool = True,
                    before_round: Callable[[], None] | None = None,
                    max_tokens: int | None = None,
                    timeout: float | Callable[[], float] | None = None,
                    continue_prompt: str | None = None,
                    max_continuations: int = 0,
                    force_tool_on_continue: bool = False):
        """流式对话生成器，逐块产出事件（像 dsh 那样边生成边显示）。

        事件形状（dict）：
          {"type":"thinking","text":...}  模型推理片段（reasoning_content）
          {"type":"token","text":...}     正式回复片段（content）
          {"type":"action","tool","args","result"}  一次工具调用完成
          {"type":"done","content":完整回复,"tool_trace":[...]}

        工具调用仍走多轮循环：模型请求工具 → 本地执行 → 结果回灌 → 继续流式。
        """
        if not self.settings.configured:
            raise ModelNotConfigured(
                "未配置模型密钥（环境变量 ST_MODEL_API_KEY），无法真实调用模型"
            )
        tool_impls = tool_impls or {}
        convo = list(messages)
        trace: list[dict] = []
        continuations = 0
        url = f"{self.settings.base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self.settings.api_key}",
                   "Content-Type": "application/json",
                   "Accept": "text/event-stream"}
        headers.update(getattr(self.settings, "extra_headers", {}) or {})

        for _ in range(max_tool_rounds):
            if before_round is not None:
                before_round()
            body: dict[str, Any] = {
                "model": model or self.settings.model,
                "messages": convo,
                "temperature": temperature,
                "stream": True,
            }
            if tools:
                body["tools"] = tools
                body["tool_choice"] = "required" if (continuations and force_tool_on_continue) else "auto"
            if response_format_json and not tools:
                body["response_format"] = {"type": "json_object"}

            if max_tokens is not None:
                if type(max_tokens) is not int or max_tokens <= 0:
                    raise ValueError("max_tokens must be a positive integer")
                body["max_tokens"] = max_tokens
            request_timeout = timeout() if callable(timeout) else timeout
            request_timeout = self.settings.timeout if request_timeout is None else request_timeout
            if not isinstance(request_timeout, (int, float)) or request_timeout <= 0:
                raise ModelError("模型请求前剩余时限不足", status=504)
            request_timeout = min(float(self.settings.timeout), float(request_timeout))
            content_parts: list[str] = []
            tool_calls_acc: dict[int, dict] = {}
            finish_reason = None
            try:
                with httpx.Client(timeout=request_timeout) as client:
                    with client.stream("POST", url, headers=headers, json=body) as resp:
                        if resp.status_code == 429:
                            raise ModelError("模型限流（429），请稍后重试", status=429)
                        if resp.status_code >= 400:
                            raw = resp.read().decode("utf-8", "replace")
                            raise ModelError(
                                f"模型返回 {resp.status_code}: {raw[:200]}", status=502)
                        for line in resp.iter_lines():
                            if not line:
                                continue
                            if line.startswith("data:"):
                                payload = line[5:].strip()
                            else:
                                payload = line.strip()
                            if payload == "[DONE]":
                                break
                            try:
                                chunk = json.loads(payload)
                            except (TypeError, ValueError):
                                continue
                            choice = (chunk.get("choices") or [{}])[0]
                            delta = choice.get("delta") or {}
                            if choice.get("finish_reason"):
                                finish_reason = choice["finish_reason"]
                            think = delta.get("reasoning_content")
                            if think:
                                yield {"type": "thinking", "text": think}
                            piece = delta.get("content")
                            if piece:
                                content_parts.append(piece)
                                yield {"type": "token", "text": piece}
                            for tc in (delta.get("tool_calls") or []):
                                self._accumulate_tool_call(tool_calls_acc, tc)
            except httpx.TimeoutException as exc:
                raise ModelError(f"模型请求超时（{request_timeout}s）", status=504) from exc
            except httpx.HTTPError as exc:
                raise ModelError(f"模型请求失败: {exc}", status=502) from exc

            if tool_calls_acc and finish_reason in ("tool_calls", None, "stop"):
                calls = [tool_calls_acc[i] for i in sorted(tool_calls_acc)]
                # 只在确有工具调用时处理
                if any(c.get("function", {}).get("name") for c in calls):
                    convo.append({"role": "assistant", "content": "".join(content_parts) or None,
                                  "tool_calls": calls})
                    for call in calls:
                        fn = call.get("function") or {}
                        name = fn.get("name")
                        if not name:
                            continue
                        try:
                            args = json.loads(fn.get("arguments") or "{}")
                        except (TypeError, ValueError):
                            args = {}
                        impl = tool_impls.get(name)
                        if impl is None:
                            result = {"error": f"未知工具 {name}"}
                        else:
                            try:
                                result = impl(args)
                            except Exception as exc:  # noqa: BLE001
                                result = {"error": str(exc)}
                        trace.append({"tool": name, "args": args, "result": result})
                        yield {"type": "action", "tool": name, "args": args, "result": result}
                        convo.append({"role": "tool", "tool_call_id": call.get("id"),
                                      "content": json.dumps(result, ensure_ascii=False, default=str)})
                    continue  # 回灌工具结果后再跑一轮流式

            if continue_prompt and continuations < max_continuations:
                # An autonomous agent may stop without calling finish: keep the
                # same conversation and ask it to continue instead of ending.
                convo.append({"role": "assistant", "content": "".join(content_parts) or None})
                convo.append({"role": "user", "content": continue_prompt})
                continuations += 1
                continue

            yield {"type": "done", "content": "".join(content_parts), "tool_trace": trace,
                   "finish_reason": finish_reason}
            return
        raise ModelError("工具调用轮数超限，仍未得到最终回复", status=502, code="tool_round_limit")

    @staticmethod
    def _accumulate_tool_call(acc: dict[int, dict], tc: dict) -> None:
        """把流式 tool_call 分片按 index 拼起来。"""
        idx = tc.get("index", 0)
        slot = acc.setdefault(idx, {"id": None, "type": "function",
                                    "function": {"name": "", "arguments": ""}})
        if tc.get("id"):
            slot["id"] = tc["id"]
        fn = tc.get("function") or {}
        if fn.get("name"):
            slot["function"]["name"] = fn["name"]
        if fn.get("arguments"):
            slot["function"]["arguments"] += fn["arguments"]
