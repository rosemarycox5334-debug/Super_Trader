"""Offline SSE gateway compatibility and per-round budget hooks."""
import json
from types import SimpleNamespace

import httpx
import pytest

from backend import model_gateway
from backend.model_gateway import ModelClient, ModelError


def sse(delta, finish="stop"):
    return 'data: ' + json.dumps({"choices": [{"delta": delta, "finish_reason": finish}]}) + '\n\ndata: [DONE]\n\n'


def client_with_transport(monkeypatch, handler, observed):
    real = httpx.Client
    def client(**kwargs):
        observed.append(kwargs["timeout"])
        return real(transport=httpx.MockTransport(handler), **kwargs)
    monkeypatch.setattr(model_gateway.httpx, "Client", client)
    return ModelClient(SimpleNamespace(configured=True, api_key="offline-fake", base_url="https://offline.invalid", model="fake", timeout=10))


def test_stream_budget_hooks_tokens_timeout_and_tool_rounds(monkeypatch):
    calls, observed, bodies = [], [], []
    def handler(request):
        body = json.loads(request.content)
        bodies.append(body)
        if len(bodies) == 1:
            delta = {"tool_calls": [{"index": 0, "id": "call-1", "type": "function", "function": {"name": "observe", "arguments": "{}"}}]}
            return httpx.Response(200, text=sse(delta, "tool_calls"))
        return httpx.Response(200, text=sse({"content": "真实流内容"}))
    client = client_with_transport(monkeypatch, handler, observed)
    events = list(client.chat_stream([{"role": "user", "content": "test"}], tools=[{"type": "function"}],
        tool_impls={"observe": lambda args: {"ok": True}}, before_round=lambda: calls.append(1),
        max_tokens=123, timeout=lambda: 3, max_tool_rounds=2))
    assert len(calls) == len(bodies) == 2
    assert observed == [3., 3.]
    assert all(body["max_tokens"] == 123 for body in bodies)
    assert [e["type"] for e in events] == ["action", "token", "done"]
    assert events[-1]["content"] == "真实流内容"


def test_stream_old_call_unchanged_and_timeout_capped(monkeypatch):
    bodies, observed = [], []
    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, text=sse({"content": "ok"}))
    client = client_with_transport(monkeypatch, handler, observed)
    assert list(client.chat_stream([]))[-1]["content"] == "ok"
    assert "max_tokens" not in bodies[0]
    assert observed == [10.]
    list(client.chat_stream([], timeout=100))
    assert observed[-1] == 10.


def test_stream_continues_when_model_stops_without_tool(monkeypatch):
    bodies, observed = [], []

    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, text=sse({"content": f"round{len(bodies)}"}))

    client = client_with_transport(monkeypatch, handler, observed)
    events = list(client.chat_stream([{"role": "user", "content": "start"}],
                                     tools=[{"type": "function"}],
                                     continue_prompt="继续直到finish", max_continuations=2,
                                     force_tool_on_continue=True))
    assert len(bodies) == 3
    assert bodies[1]["messages"][-1] == {"role": "user", "content": "继续直到finish"}
    assert bodies[0]["tool_choice"] == "auto" and bodies[1]["tool_choice"] == "required"
    assert events[-1]["content"] == "round3"


def test_stream_before_round_stops_http_and_invalid_budget(monkeypatch):
    requests, observed = [], []
    client = client_with_transport(monkeypatch, lambda request: requests.append(request), observed)
    def stopped():
        raise RuntimeError("cancelled budget")
    with pytest.raises(RuntimeError, match="budget"):
        list(client.chat_stream([], before_round=stopped))
    assert not requests and not observed
    with pytest.raises(ModelError) as caught:
        list(client.chat_stream([], timeout=0))
    assert caught.value.status == 504
    with pytest.raises(ValueError):
        list(client.chat_stream([], max_tokens=0))
    assert not requests


def test_stream_round_limit_matches_chat_error(monkeypatch):
    observed = []
    def handler(request):
        delta = {"tool_calls": [{"index": 0, "id": "call-1", "function": {"name": "observe", "arguments": "{}"}}]}
        return httpx.Response(200, text=sse(delta, "tool_calls"))
    client = client_with_transport(monkeypatch, handler, observed)
    with pytest.raises(ModelError) as caught:
        list(client.chat_stream([], tools=[{}], tool_impls={"observe": lambda args: {}}, max_tool_rounds=1))
    assert caught.value.code == "tool_round_limit"
