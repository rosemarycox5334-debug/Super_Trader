"""Real streamed events with offline tools, bounded durable cursor semantics."""
from types import SimpleNamespace
import json
import threading

from backend.factors.research import _TranscriptWriter
from backend.model_gateway import ModelError
from tests.test_factor_research import setup, flush


SECRET = "TEST_PRIVATE_API_TOKEN_0123456789"


class FakeStreamingModel:
    settings = SimpleNamespace(configured=True, timeout=30, api_key=SECRET)

    def chat(self, *args, **kwargs):
        raise AssertionError("stream must be preferred")

    def chat_stream(self, messages, *, before_round, tool_impls, **kwargs):
        before_round()
        yield {"type": "thinking", "text": "正在规划"}
        yield {"type": "token", "text": "模型"}
        yield {"type": "token", "text": "正文"}
        result = tool_impls["save_note"]({"note": "真实工具笔记"})
        yield {"type": "action", "tool": "save_note", "args": {"note": "真实工具笔记", "source": "def factor(df): return secret", "api_key": SECRET},
               "result": {**result, "rule": {"source": "def factor(df): return secret"}, "authorization": "Bearer " + SECRET}}
        tool_impls["finish"]({})
        yield {"type": "done", "content": "模型正文"}


def test_stream_order_dedup_live_output_and_safe_tools(setup):
    _, db, jobs, _, service = setup
    service.model = FakeStreamingModel()
    job = flush(jobs, service.submit())
    assert job["status"] == "done"
    assert job["result"]["live_output"] == "模型正文"
    page = service.transcript(job["id"], limit=500)
    items = page["items"]
    assert [i["seq"] for i in items] == list(range(1, len(items)+1))
    assert [i["kind"] for i in items] == ["status", "thinking", "content", "tool", "status"]
    assert items[-1]["text"] == "finished"
    assert "".join(i["text"] for i in items if i["kind"] == "content") == "模型正文"
    rendered = json.dumps(items, ensure_ascii=False)
    assert SECRET not in rendered and "def factor" not in rendered
    assert items[3]["tool"] == "save_note"
    assert db.query_one("SELECT COUNT(*) n FROM factor_research_notes")["n"] == 1
    first = service.transcript(job["id"], limit=2)
    second = service.transcript(job["id"], after=first["next_seq"], limit=2)
    assert first["next_seq"] == first["items"][-1]["seq"] and first["has_more"]
    assert second["items"][0]["seq"] > first["next_seq"]
    assert service.transcript("job-does-not-exist", after=999)["items"] == []
    assert service.transcript("job-does-not-exist", after=999)["next_seq"] == 999


def test_retention_cursor_holes_and_single_entry_bound(setup):
    _, _, jobs, _, service = setup
    service.model = FakeStreamingModel()
    job = flush(jobs, service.submit())
    writer = _TranscriptWriter(service.db, job["id"], service._redact_transcript)
    try:
        for i in range(410):
            writer.append("tool", str(i), "universe_profile")
        writer.append("content", "字" * 9001)
    finally:
        writer.close()
    page = service.transcript(job["id"], after=0, limit=200)
    assert page["items"][0]["seq"] > 1
    assert len(page["items"]) == 200 and page["has_more"]
    second = service.transcript(job["id"], after=page["next_seq"], limit=500)
    assert len(second["items"]) == 200 and not second["has_more"]
    combined = page["items"] + second["items"]
    assert len({i["seq"] for i in combined}) == 400
    assert all(len(i["text"]) <= 4000 for i in combined)
    empty = service.transcript(job["id"], after=second["next_seq"])
    assert empty["next_seq"] == second["next_seq"] and not empty["has_more"]


def test_nonstream_chat_fallback_saved_once(setup):
    _, _, jobs, model, service = setup
    def chat(*args, before_round, tool_impls, **kwargs):
        before_round()
        tool_impls["finish"]({})
        return {"content": "兼容旧模型输出"}
    model.chat = chat
    job = flush(jobs, service.submit())
    assert job["status"] == "done"
    content = [i for i in service.transcript(job["id"])["items"] if i["kind"] == "content"]
    assert len(content) == 1 and content[0]["text"] == "兼容旧模型输出"
    assert job["result"]["live_output"] == "兼容旧模型输出"


def test_partial_flush_on_error_and_budget_stop_with_redaction(setup):
    _, _, jobs, _, service = setup
    model = FakeStreamingModel()
    def stream(*args, before_round, **kwargs):
        before_round()
        yield {"type": "token", "text": "部分内容 " + SECRET}
        raise ModelError("raw provider body " + SECRET)
    model.chat_stream = stream
    service.model = model
    job = flush(jobs, service.submit())
    assert job["status"] == "error"
    items = service.transcript(job["id"])["items"]
    assert "部分内容" in "".join(i["text"] for i in items)
    assert any(i["kind"] == "error" for i in items)
    assert items[-1]["text"] == "error"
    assert SECRET not in json.dumps(items) and SECRET not in job["result"]["live_output"]
    def budget_stream(*args, before_round, **kwargs):
        before_round()
        yield {"type": "thinking", "text": "预算前的真实文字"}
        before_round()
    model.chat_stream = budget_stream
    job = flush(jobs, service.submit(max_model_calls=1, brief="预算"))
    assert job["result"]["phase"]["name"] == "budget_exhausted"
    items = service.transcript(job["id"])["items"]
    assert any("预算前" in i["text"] for i in items)
    assert items[-1]["text"] == "budget_exhausted"


def test_timer_flushes_during_stalled_model_and_joins(setup):
    _, db, _, _, service = setup
    db.execute("INSERT INTO jobs(id,type,status,created_at) VALUES(?,?,?,?)",
               ("timer-test", "factor_research", "running", "2026-11-15"))
    writer = _TranscriptWriter(db, "timer-test", service._redact_transcript)
    writer.append("content", "短输出")
    # Wait on the writer's timer, not a polling loop; direct flush is separately
    # tested above. An Event lets the DB write confirm real time-based flush.
    original = db.executemany
    written = threading.Event()
    def record(sql, rows):
        original(sql, rows)
        if "transcript" in sql:
            written.set()
    db.executemany = record
    try:
        assert written.wait(timeout=2)
        assert service.transcript("timer-test")["items"][0]["text"] == "短输出"
    finally:
        writer.close()
        db.executemany = original
    assert not writer.thread.is_alive()
