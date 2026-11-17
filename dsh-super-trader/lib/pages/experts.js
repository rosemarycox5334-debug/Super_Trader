// Generated from web/app/assets/app.js by tools/build-pages.mjs.
// Original page functions retained; migration patches are in the build tool.
PAGES.experts = async function (root) {
  root.append(el("div", { class: "page-head" }, [
    el("h1", { text: "专家团队" }),
    el("p", { text: "蒸馏专家真实调用模型，带工具与证据；缺证据必须弃权。结论含理由与来源。" }),
  ]));
  if (!state.status || !state.status.model.configured) {
    root.append(el("div", { class: "card", style: "border-color:var(--warn)" }, [
      el("strong", { text: "模型未接入" }),
      el("p", { class: "muted", text: "设置环境变量 ST_MODEL_API_KEY 后重启服务，专家才能真实研判。未配置时研判会返回明确错误，不会伪造结论。" }),
    ]));
  }
  const { items } = await api.get("/experts");
  const code = el("input", { class: "input", placeholder: "标的代码 如 601088", style: "max-width:180px" });
  const horizon = el("select", { class: "input" }, Array.from({ length: 20 }, (_, i) => el("option", { value: i + 1, text: "第 " + (i + 1) + " 根" })));
  horizon.value = "10";
  root.append(el("div", { class: "card" }, [
    el("div", { class: "row" }, [
      code, el("span", { class: "muted", text: "周期" }), horizon,
      el("button", { class: "btn", text: "团队研判", onclick: () => {
        if (!code.value.trim()) return toast("请输入代码", "err");
        return analyzeTeam(code.value.trim(), null, +horizon.value);
      } }),
    ]),
  ]));
  const grid = el("div", { class: "grid grid-2" });
  for (const e of items) {
    grid.append(el("div", { class: "card" }, [
      el("div", { class: "row" }, [
        el("strong", { text: e.name }),
        el("span", { class: "badge plain", text: e.tag || "" }),
        e.enabled ? null : el("span", { class: "badge flat", text: "停用" }),
      ]),
      el("div", { class: "pill-row", style: "margin:6px 0" }, (e.criteria || []).map((c) => el("span", { class: "badge plain", text: c }))),
      el("div", { class: "muted", text: "工具：" + (e.tools || []).join("、") }),
      el("div", { class: "row", style: "margin-top:8px" }, [
        el("button", { class: "btn ghost sm", text: "单独研判", onclick: async () => {
          if (!code.value.trim()) return toast("请先在上方输入代码", "err");
          const dlg = openModal(e.name + " · 研判", el("div", { class: "empty" }, [el("span", { class: "spinner" }), " 调用模型中…"]), []);
          try {
            const r = await api.post(`/experts/${e.id}/analyze`, { code: code.value.trim(), horizon: +horizon.value });
            dlg.body.innerHTML = "";
            dlg.body.append(renderTeamResult({ consensus: { decision: r.vote === 1 ? "up" : r.vote === -1 ? "down" : "none", support: 0, voted: r.abstained ? 0 : 1, abstained: r.abstained ? 1 : 0 }, votes: [{ expert: r.expert, vote: r.vote, confidence: r.confidence, reason: r.reason, evidence: r.evidence, abstained: r.abstained }] }));
          } catch (err) { dlg.body.innerHTML = ""; dlg.body.append(el("div", { class: "empty", text: err.message })); }
        } }),
      ]),
    ]));
  }
  root.append(grid);
};
