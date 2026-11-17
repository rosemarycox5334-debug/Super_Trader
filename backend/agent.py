"""Super Agent：用自然语言驱动工作台（增删/启停/排序插件、查概率、跑专家）。

两条路径：
1) 有模型密钥：走模型 + 工具调用（函数就是真实的后端操作），模型决定调哪个。
2) 无模型密钥：退化到确定性意图解析（关键词 + 正则），仍能真实执行插件 CRUD、
   查概率等核心操作——保证「说『添加插件 龙虎榜』真的创建」这一验收点在离线也成立。

无论哪条路径，执行的都是真实后端 API，不是前端假动作。
"""
from __future__ import annotations

import json
import re
from typing import Any

from .experts import ExpertError, ExpertService
from .model_gateway import ModelClient, ModelError, ModelNotConfigured
from .plugins import PluginError, PluginService
from .quant import QuantEngine, QuantError
from .watchlist import WatchlistService


class AgentService:
    def __init__(self, plugins: PluginService, engine: QuantEngine,
                 experts: ExpertService, watchlist: WatchlistService,
                 model: ModelClient, memory=None):
        self.plugins = plugins
        self.engine = engine
        self.experts = experts
        self.watchlist = watchlist
        self.model = model
        self.memory = memory  # MemoryService | None（无则退化为无记忆）

    # ------------------------------------------------------------------ 工具
    def _tool_schemas(self) -> list[dict]:
        return [
            _fn("add_plugin", "新增一个工作台插件（在导航出现）", {
                "name": {"type": "string", "description": "插件显示名"},
            }, ["name"]),
            _fn("remove_plugin", "删除一个自定义插件（内置插件不可删）", {
                "name": {"type": "string"}}, ["name"]),
            _fn("toggle_plugin", "启用或停用（隐藏）一个插件", {
                "name": {"type": "string"},
                "enabled": {"type": "boolean"}}, ["name", "enabled"]),
            _fn("move_plugin_first", "把某个插件排到导航最前", {
                "name": {"type": "string"}}, ["name"]),
            _fn("rename_plugin", "重命名插件", {
                "name": {"type": "string"}, "new_name": {"type": "string"}},
                ["name", "new_name"]),
            _fn("list_plugins", "列出当前所有插件", {}, []),
            _fn("quant_probability", "查询某标的未来第 N 个交易日的上涨/下跌概率", {
                "code": {"type": "string"}, "horizon": {"type": "integer"}},
                ["code"]),
            _fn("expert_team", "让专家团队研判某标的", {
                "code": {"type": "string"}, "horizon": {"type": "integer"}},
                ["code"]),
        ]

    def _impls(self, actor: str) -> dict[str, Any]:
        def add_plugin(a):
            return self.plugins.create({"name": a["name"]}, actor)

        def remove_plugin(a):
            pid = self._find_plugin_id(a["name"])
            self.plugins.delete(pid, actor)
            return {"deleted": pid}

        def toggle_plugin(a):
            pid = self._find_plugin_id(a["name"])
            return self.plugins.update(pid, {"enabled": bool(a["enabled"])}, actor)

        def move_plugin_first(a):
            pid = self._find_plugin_id(a["name"])
            return self.plugins.move_first(pid, actor)

        def rename_plugin(a):
            pid = self._find_plugin_id(a["name"])
            return self.plugins.update(pid, {"name": a["new_name"]}, actor)

        def list_plugins(a):
            return self.plugins.list()

        def quant_probability(a):
            code, cat = _split_code(a["code"])
            return self.engine.probability(code, cat, horizon=int(a.get("horizon") or 10)).as_dict()

        def expert_team(a):
            code, cat = _split_code(a["code"])
            return self.experts.team_analyze(code, cat, int(a.get("horizon") or 10))

        return {
            "add_plugin": add_plugin, "remove_plugin": remove_plugin,
            "toggle_plugin": toggle_plugin, "move_plugin_first": move_plugin_first,
            "rename_plugin": rename_plugin, "list_plugins": list_plugins,
            "quant_probability": quant_probability, "expert_team": expert_team,
        }

    def _find_plugin_id(self, name: str) -> str:
        name = (name or "").strip()
        for p in self.plugins.list():
            if p["id"] == name or p["name"] == name:
                return p["id"]
        # 模糊匹配
        for p in self.plugins.list():
            if name and (name in p["name"] or p["name"] in name):
                return p["id"]
        raise PluginError(f"找不到插件: {name}", status=404)

    # ------------------------------------------------------------------ 入口
    def chat(self, message: str, actor: str = "user") -> dict:
        impls = self._impls(actor)
        result = None
        if self.model.settings.configured:
            try:
                result = self._chat_with_model(message, impls, actor)
            except (ModelError, ModelNotConfigured):
                # 模型路径失败则退化到确定性解析，保证可用
                result = None
        if result is None:
            result = self._chat_deterministic(message, impls)
        self._capture(message, result.get("reply", ""), result.get("actions", []))
        return result

    def _chat_with_model(self, message: str, impls: dict, actor: str) -> dict:
        out = self.model.chat(
            [{"role": "system", "content": self._system_prompt()},
             {"role": "user", "content": message}],
            tools=self._tool_schemas(), tool_impls=impls, temperature=0.2,
            response_format_json=False,
        )
        return {"reply": out["content"], "actions": out["tool_trace"], "mode": "model"}

    def _system_prompt(self) -> str:
        base = (
            "你是 Super Agent，一个投研工作台的指挥官。用户用自然语言让你管理插件、查量化概率、"
            "调专家团队。你只能通过提供的工具执行真实操作；执行后用中文简要说明做了什么。"
            "不要编造数据；量化概率是内样本历史频率。"
        )
        projection = self._memory_projection()
        return base + ("\n\n" + projection if projection else "")

    def _memory_projection(self) -> str:
        if self.memory is None:
            return ""
        try:
            return self.memory.project(scope="agent", limit_bytes=600)
        except Exception:  # noqa: BLE001  记忆投影失败不应阻断对话
            return ""

    def _capture(self, message: str, reply: str, actions: list[dict]) -> None:
        if self.memory is None:
            return
        try:
            self.memory.capture_turn(message, reply, actions, scope="agent")
        except Exception:  # noqa: BLE001  抽取失败不影响对话返回
            pass

    # ------------------------------------------------------------------ 流式入口
    def chat_stream(self, message: str, actor: str = "user"):
        """流式产出对话事件（像 dsh 一样边生成边显示）。

        事件类型：thinking / token / action / done / error / mode。
        有模型密钥走真流式；无密钥或模型失败则退化到确定性解析，把最终文本分块"伪流式"输出，
        保证前端渲染体验一致，且执行的仍是真实后端操作。
        """
        impls = self._impls(actor)
        if self.model.settings.configured:
            try:
                yield {"type": "mode", "mode": "model"}
                yield from self._stream_with_model(message, impls)
                return
            except (ModelError, ModelNotConfigured) as exc:
                # 模型失败：告知并退化到确定性解析
                yield {"type": "notice", "text": f"模型流式不可用（{exc}），改用本地解析。"}
        yield {"type": "mode", "mode": "deterministic"}
        yield from self._stream_deterministic(message, impls)

    def _stream_with_model(self, message: str, impls: dict):
        actions: list[dict] = []
        content = ""
        for ev in self.model.chat_stream(
            [{"role": "system", "content": self._system_prompt()},
             {"role": "user", "content": message}],
            tools=self._tool_schemas(), tool_impls=impls, temperature=0.2,
            response_format_json=False,
        ):
            if ev["type"] == "action":
                actions.append({"tool": ev["tool"], "args": ev["args"],
                                "result": _jsonable(ev["result"])})
                yield {"type": "action", "tool": ev["tool"], "args": ev["args"]}
            elif ev["type"] == "done":
                content = ev.get("content", content)
                self._capture(message, content, actions)
                yield {"type": "done", "reply": content, "actions": actions, "mode": "model"}
            else:
                # thinking / token / notice 直接透传
                yield ev

    def _stream_deterministic(self, message: str, impls: dict):
        result = self._chat_deterministic(message, impls)
        for a in result["actions"]:
            yield {"type": "action", "tool": a["tool"], "args": a.get("args", {})}
        # 把最终文本分成小块逐步吐出，模拟打字机效果
        reply = result["reply"]
        for chunk in _chunks(reply, 6):
            yield {"type": "token", "text": chunk}
        self._capture(message, reply, result["actions"])
        yield {"type": "done", "reply": reply, "actions": result["actions"],
               "mode": "deterministic"}

    # ------------------------------------------------------------------ 离线意图解析
    def _chat_deterministic(self, message: str, impls: dict) -> dict:
        text = (message or "").strip()
        actions: list[dict] = []
        reply = ""

        def run(tool: str, args: dict):
            res = impls[tool](args)
            actions.append({"tool": tool, "args": args, "result": _jsonable(res)})
            return res

        m = re.search(r"(添加|新增|创建|加).*?插件\s*[：:]*\s*([^\s，。,.]+)", text)
        if m:
            p = run("add_plugin", {"name": m.group(2)})
            return self._wrap(f"已添加插件「{p['name']}」，已在导航出现。", actions)

        m = re.search(r"(删除|移除|去掉).*?插件\s*[：:]*\s*([^\s，。,.]+)", text)
        if m:
            try:
                run("remove_plugin", {"name": m.group(2)})
                return self._wrap(f"已删除插件「{m.group(2)}」。", actions)
            except PluginError as exc:
                return self._wrap(f"删除失败：{exc}", actions)

        m = re.search(r"(隐藏|停用|关闭|禁用).*?插件\s*[：:]*\s*([^\s，。,.]+)", text)
        if m:
            try:
                run("toggle_plugin", {"name": m.group(2), "enabled": False})
                return self._wrap(f"已停用插件「{m.group(2)}」。", actions)
            except PluginError as exc:
                return self._wrap(f"操作失败：{exc}", actions)

        m = re.search(r"(启用|显示|打开).*?插件\s*[：:]*\s*([^\s，。,.]+)", text)
        if m:
            try:
                run("toggle_plugin", {"name": m.group(2), "enabled": True})
                return self._wrap(f"已启用插件「{m.group(2)}」。", actions)
            except PluginError as exc:
                return self._wrap(f"操作失败：{exc}", actions)

        m = re.search(r"把?\s*([^\s，。,.]+?)\s*(插件)?\s*(排|放|移)到?\s*(最前|第一|最前面|前面)", text)
        if m:
            try:
                run("move_plugin_first", {"name": m.group(1)})
                return self._wrap(f"已把「{m.group(1)}」排到最前。", actions)
            except PluginError as exc:
                return self._wrap(f"操作失败：{exc}", actions)

        # 概率查询：抓 6 位代码 + 第 N 根/天
        code_m = re.search(r"\b(\d{6})\b", text)
        horizon_m = re.search(r"第?\s*(\d{1,2})\s*(个)?\s*(交易日|日|根|天)", text)
        if code_m and ("概率" in text or "涨" in text or "跌" in text or horizon_m):
            try:
                res = run("quant_probability",
                          {"code": code_m.group(1),
                           "horizon": int(horizon_m.group(1)) if horizon_m else 10})
                lbl = res["direction_label"]
                prob = res["probability"]
                if prob is None:
                    return self._wrap(
                        f"{res['symbol']['name']}（{res['symbol']['code']}）当前无方向信号，"
                        f"第 {res['target']['horizon']} 根单边基准 {res['baseline_up']:.1%}。", actions)
                return self._wrap(
                    f"{res['symbol']['name']}（{res['symbol']['code']}）第 {res['target']['horizon']} 根"
                    f"方向{lbl}，历史同信号命中率 {prob:.1%}（内样本，样本 {res['sample']['predictions']} 次）。",
                    actions)
            except QuantError as exc:
                return self._wrap(f"查询失败：{exc}", actions)

        if code_m and "专家" in text:
            try:
                res = run("expert_team",
                          {"code": code_m.group(1),
                           "horizon": int(horizon_m.group(1)) if horizon_m else 10})
                c = res["consensus"]
                return self._wrap(
                    f"专家团队共识：{c['decision']}（支持度 {c['support']:.0%}，"
                    f"{c['voted']} 票有效 / {c['abstained']} 弃权）。", actions)
            except ExpertError as exc:
                return self._wrap(f"专家研判失败：{exc}", actions)

        if "插件" in text and ("列" in text or "有哪些" in text or "列表" in text):
            run("list_plugins", {})
            names = "、".join(p["name"] for p in self.plugins.list())
            return self._wrap(f"当前插件：{names}。", actions)

        return self._wrap(
            "我可以帮你管理插件（如「添加插件 龙虎榜」「隐藏插件 专家团队」「把自选股排到最前」）、"
            "查量化概率（如「601088 第 10 个交易日 概率」）、调专家团队。请换种说法试试。",
            actions)

    def _wrap(self, reply: str, actions: list) -> dict:
        return {"reply": reply, "actions": actions, "mode": "deterministic"}


# ------------------------------------------------------------------ 辅助
def _fn(name: str, desc: str, props: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name, "description": desc,
            "parameters": {"type": "object", "properties": props, "required": required},
        },
    }


def _split_code(token: str) -> tuple[str, str | None]:
    token = (token or "").strip()
    if "/" in token:
        code, cat = token.split("/", 1)
        return code.strip(), cat.strip()
    return token, None


def _jsonable(obj):
    try:
        json.dumps(obj, default=str)
        return obj
    except (TypeError, ValueError):
        return str(obj)


def _chunks(text: str, size: int):
    """把文本切成固定长度的块（确定性路径的伪流式）。"""
    for i in range(0, len(text), size):
        yield text[i:i + size]
