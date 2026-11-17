// Generated from web/app/assets/app.js by tools/build-pages.mjs.
// Original page functions retained; migration patches are in the build tool.
PAGES.journal = async function (root) {
  root.append(el("div", { class: "page-head" }, [
    el("h1", { text: "操盘记录与复盘" }),
    el("p", { text: "记录时冻结理由与信号快照；复盘用真实收盘价算前向收益与信号漂移。缺成交价只做方向复盘。" }),
  ]));
  const filterExpert = el("input", { class: "input", placeholder: "按专家筛选", style: "max-width:160px" });
  root.append(el("div", { class: "card" }, [
    el("div", { class: "row" }, [
      el("button", { class: "btn", text: "新建记录", onclick: () => openJournalModal() }),
      el("span", { style: "margin-left:auto" }), filterExpert,
      el("button", { class: "btn ghost sm", text: "筛选", onclick: () => refresh() }),
      el("button", { class: "btn ghost sm", text: "导出 CSV", onclick: () => exportJournal("csv") }),
      el("button", { class: "btn ghost sm", text: "导出 JSON", onclick: () => exportJournal("json") }),
    ]),
  ]));
  const listCard = el("div", { class: "card" });
  root.append(listCard);

  async function refresh() {
    const q = filterExpert.value.trim() ? "?expert=" + encodeURIComponent(filterExpert.value.trim()) : "";
    const { items } = await api.get("/journal" + q);
    listCard.innerHTML = "";
    if (!items.length) { listCard.append(el("div", { class: "empty", text: "还没有记录。" })); return; }
    for (const j of items) listCard.append(renderJournalItem(j, refresh));
  }
  journalRefresh = refresh;
  await refresh();
};

function renderJournalItem(j, refresh) {
  const sig = j.signal || {};
  const card = el("div", { class: "card" });
  card.append(el("div", { class: "row" }, [
    el("strong", { text: `${esc(j.symbol.name)} ${esc(j.symbol.code)}` }),
    el("span", { class: "badge " + (j.action === "buy" ? "up" : j.action === "sell" || j.action === "short" ? "down" : "flat"), text: j.action }),
    el("span", { class: "muted", text: `${j.expert} · 第${j.horizon}根 · ${j.created_at.slice(0, 10)}` }),
    j.closed ? el("span", { class: "badge flat", text: "已平" }) : null,
    el("span", { style: "margin-left:auto" }),
    el("button", { class: "btn ghost sm", text: "复盘", onclick: () => doReview(card, j.id) }),
    el("button", { class: "btn ghost sm", text: "补填 / 备注", onclick: () => openJournalEdit(j, refresh) }),
    el("button", { class: "btn danger sm", text: "删除", onclick: async () => { await api.del(`/journal/${j.id}`); await refresh(); } }),
  ]));
  card.append(el("div", { class: "muted", style: "margin-top:6px", text:
    `记录信号：方向 ${dirLabel(sig.direction || 0)}${sig.probability != null ? " · 概率 " + fmtPct(sig.probability) : ""}` +
    `${j.price != null ? " · 成交价 " + j.price : " · 未填成交价"}` }));
  if (j.note) card.append(el("p", { class: "muted", text: "备注：" + j.note }));
  if (j.reasons && j.reasons.summary) card.append(el("p", { style: "margin:6px 0 0", text: j.reasons.summary }));
  return card;
}

async function doReview(card, jid) {
  const slot = el("div", { class: "card", style: "margin-top:8px;background:var(--bg)" }, [el("span", { class: "spinner" }), " 复盘中…"]);
  card.append(slot);
  try {
    const r = await api.get(`/journal/${jid}/review`);
    slot.innerHTML = "";
    const ret = r.return || {};
    const drift = r.signal_drift || {};
    const kv = (k, v) => el("div", { class: "kv" }, [el("span", { text: k }), el("span", { class: "mono", text: v })]);
    slot.append(el("h2", { text: "复盘结果" }));
    if (ret.available) {
      slot.append(
        kv("进场", `${ret.entry_date} @ ${ret.entry_price}（${ret.entry_price_source === "recorded" ? "成交价" : "当日收盘"}）`),
        kv("出场", `${ret.exit_date} @ ${ret.exit_price}`),
        kv("方向收益", el("b", { class: ret.forward_return >= 0 ? "" : "", text: fmtPct(ret.forward_return) }).textContent),
        kv("是否命中", ret.hit == null ? "方向中性，不判命中" : (ret.hit ? "✓ 命中" : "✗ 未命中")),
      );
    } else {
      slot.append(el("div", { class: "warn-list", text: "暂无法算收益：" + (ret.reason || "行情不足") + "（仅方向复盘）" }));
    }
    slot.append(kv("信号漂移", drift.error ? drift.error :
      `记录时 ${dirLabel(drift.recorded_direction)} → 现在 ${dirLabel(drift.current_direction)}${drift.drifted ? "（已漂移）" : "（一致）"}`));
  } catch (e) { slot.innerHTML = ""; slot.append(el("div", { class: "empty", text: e.message })); }
}

function openJournalModal(code = "", category = null, horizon = 10) {
  const codeI = el("input", { class: "input", value: code, placeholder: "代码 601088" });
  const action = el("select", { class: "input" }, ["buy", "sell", "short", "watch"].map((a) => el("option", { value: a, text: a })));
  const horizonI = el("input", { class: "input", type: "number", value: horizon, min: 1, max: 20 });
  const price = el("input", { class: "input", type: "number", step: "0.01", placeholder: "成交价（可留空）" });
  const entryDate = el("input", { class: "input", type: "date" });
  const note = el("textarea", { class: "input", placeholder: "理由摘要（会连同信号快照一起冻结）" });
  const body = el("div", { class: "modal-body" }, [
    field("代码", codeI), field("动作", action), field("持有期（第N根）", horizonI),
    field("成交价", price), field("进场日期（可回填历史以复盘已走完的区间）", entryDate),
    field("理由", note),
  ]);
  const save = el("button", { class: "btn", text: "冻结记录" });
  const dlg = openModalRaw("新建操盘记录", body, [el("button", { class: "btn ghost", text: "取消", onclick: () => $("#modal").close() }), save]);
  listen(save, "click", async () => {
    if (!codeI.value.trim()) return toast("请输入代码", "err");
    try {
      await api.post("/journal", {
        code: codeI.value.trim(), category, action: action.value, horizon: +horizonI.value,
        price: price.value ? +price.value : null, entry_date: entryDate.value || null,
        reasons: { summary: note.value, votes: [] }, note: note.value,
      });
      $("#modal").close();
      toast("已冻结记录", "ok");
      if (journalRefresh) await journalRefresh();
    } catch (e) { toast(e.message, "err"); }
  });
}
function field(label, input) { return el("div", { class: "field" }, [el("label", { text: label }), input]); }
