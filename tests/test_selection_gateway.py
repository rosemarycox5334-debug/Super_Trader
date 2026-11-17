"""The optional round gate is backwards compatible and never touches a network."""
from types import SimpleNamespace

import pytest

from backend.model_gateway import ModelClient, ModelNotConfigured


def gateway(monkeypatch, replies):
    requests, timeouts = [], []
    class FakeHTTP:
        def __init__(self, **kwargs):
            timeouts.append(kwargs["timeout"])
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def post(self, url, headers, json):
            requests.append(json)
            value = replies.pop(0)
            return SimpleNamespace(status_code=200, json=lambda: value)
    monkeypatch.setattr("backend.model_gateway.httpx.Client", FakeHTTP)
    settings = SimpleNamespace(configured=True, model="fake", api_key="offline-not-a-key", base_url="https://invalid.invalid", timeout=1)
    model = ModelClient(settings)
    model.test_timeouts = timeouts
    return model, requests


def answer(text="{}"):
    return {"choices": [{"message": {"content": text}}]}


def call_tool():
    return {"choices": [{"message": {"role": "assistant", "tool_calls": [
        {"id": "t1", "type": "function", "function": {"name": "read", "arguments": "{}"}}]}}]}


def test_default_none_keeps_old_chat_call_unchanged(monkeypatch):
    model, requests = gateway(monkeypatch, [answer()])
    assert model.chat([{"role": "user", "content": "test"}])["content"] == "{}"
    assert len(requests) == 1
    assert requests[0]["response_format"] == {"type": "json_object"}
    assert "max_tokens" not in requests[0] and model.test_timeouts == [1]


def test_before_round_called_before_each_http_and_error_propagates(monkeypatch):
    model, requests = gateway(monkeypatch, [call_tool(), answer()])
    count, data_calls = [], []
    class Stop(Exception):
        pass
    def gate():
        count.append(len(requests))
        if len(count) == 2:
            raise Stop("cancelled")
    with pytest.raises(Stop):
        model.chat([], tools=[{"type": "function", "function": {"name": "read"}}],
                   tool_impls={"read": lambda args: data_calls.append(args) or {"available": True}}, before_round=gate)
    assert count == [0, 1] and data_calls == [{}]
    assert len(requests) == 1  # no second HTTP after cancellation


def test_callback_can_allow_tool_loop_and_counts_final_round(monkeypatch):
    model, requests = gateway(monkeypatch, [call_tool(), answer('{"picks":[]}' )])
    rounds = []
    output = model.chat([], tools=[{"function": {"name": "read"}}], tool_impls={"read": lambda args: {"available": False}},
                        before_round=lambda: rounds.append(len(requests)), max_tool_rounds=7)
    assert rounds == [0, 1] and output["content"] == '{"picks":[]}'
    assert output["tool_trace"][0]["result"] == {"available": False}


def test_initial_callback_can_stop_before_any_http(monkeypatch):
    model, requests = gateway(monkeypatch, [answer()])
    def stopped():
        raise TimeoutError("budget")
    with pytest.raises(TimeoutError):
        model.chat([], before_round=stopped)
    assert not requests


def test_optional_token_limit_and_timeout_override_apply_each_round(monkeypatch):
    model, requests = gateway(monkeypatch, [call_tool(), answer()])
    remaining = iter([7.5, 2.0])
    model.chat([], tools=[{"function": {"name": "read"}}], tool_impls={"read": lambda args: {}},
               max_tokens=1400, timeout=lambda: next(remaining))
    assert model.test_timeouts == [7.5, 2.0]
    assert [request["max_tokens"] for request in requests] == [1400, 1400]
    model, requests = gateway(monkeypatch, [answer()])
    model.chat([], timeout=3, max_tokens=4000)
    assert model.test_timeouts == [3] and requests[0]["max_tokens"] == 4000


def test_callback_stops_before_timeout_override_or_http(monkeypatch):
    model, requests = gateway(monkeypatch, [answer()])
    def stopped():
        raise TimeoutError("cancelled")
    with pytest.raises(TimeoutError):
        model.chat([], before_round=stopped, timeout=lambda: pytest.fail("no timeout evaluation after cancellation"))
    assert not requests and not model.test_timeouts


@pytest.mark.parametrize("reason,expected", [("length", "length"), ("stop", "stop"), ("content_filter", "content_filter"),
    ("DO-NOT-EXPOSE-PROVIDER-TEXT", None)])
def test_completion_exposes_only_whitelisted_finish_reason_metadata(monkeypatch, reason, expected):
    reply = answer('{"picks":[]}')
    reply["choices"][0]["finish_reason"] = reason
    model, _ = gateway(monkeypatch, [reply])
    result = model.chat([])
    assert result["finish_reason"] == expected


def test_missing_configuration_does_not_call_round_gate(monkeypatch):
    model, requests = gateway(monkeypatch, [])
    model.settings.configured = False
    with pytest.raises(ModelNotConfigured):
        model.chat([], before_round=lambda: pytest.fail("must not start model round"))
    assert not requests
