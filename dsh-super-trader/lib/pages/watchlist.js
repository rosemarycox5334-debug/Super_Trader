// Generated from web/app/assets/app.js by tools/build-pages.mjs.
// Original page functions retained; migration patches are in the build tool.
PAGES.watchlist = async function (root) {
  const pageToken = root._stMarketPage = {};
  let currentItems = [], listVersion = 0, quoteVersion = 0;
  const active = () => root._stMarketPage === pageToken;
  const quoteCard = el("div", { class: "market-slot", "aria-live": "polite" });
  const quoteBtn = el("button", { class: "btn ghost sm", text: "刷新行情", onclick: refreshQuotes });
  root.append(el("div", { class: "page-head" }, [
    el("h1", { text: "自选股" }),
    el("p", { text: "最多 200 只。批量跑量化信号 + 专家共识，进度实时推送，可取消。" }),
  ]));
  const addCode = el("input", { class: "input", placeholder: "代码 如 601088", style: "max-width:160px" });
  const horizon = el("select", { class: "input" }, Array.from({ length: 20 }, (_, i) => el("option", { value: i + 1, text: "第 " + (i + 1) + " 根" })));
  horizon.value = "10";
  const withExperts = el("label", { class: "muted" }, [el("input", { type: "checkbox", checked: "checked" }), " 含专家"]);
  const runBtn = el("button", { class: "btn", text: "批量研判" });
  root.append(el("div", { class: "card" }, [
    el("div", { class: "row" }, [
      addCode,
      el("button", { class: "btn ghost sm", text: "加入", onclick: async () => {
        if (!addCode.value.trim()) return;
        try { await api.post("/watchlist", { code: addCode.value.trim() }); addCode.value = ""; await refresh(); toast("已加入", "ok"); }
        catch (e) { toast(e.message, "err"); }
      } }),
      el("span", { style: "margin-left:auto" }), quoteBtn, el("span", { class: "muted", text: "周期" }), horizon, withExperts, runBtn,
    ]),
  ]));
  const listCard = el("div", { class: "card" });
  const resultCard = el("div", { class: "card", hidden: "hidden" });
  root.append(listCard, quoteCard, resultCard);

  async function refresh() {
    const version = ++listVersion;
    ++quoteVersion;
    const { items, max } = await api.get("/watchlist");
    if (!active() || version !== listVersion) return;
    currentItems = items;
    ++quoteVersion; // A refreshed list also invalidates quotes started while it was loading.
    quoteCard.innerHTML = "";
    quoteCard.append(el("p", { class: "muted", text: "最新行情独立于批量研判；点击「刷新行情」才请求，最多前50条 A 股个股，不自动轮询。" }));
    renderQuotes(null, "尚未刷新行情。");
    listCard.innerHTML = "";
    listCard.append(el("h2", { text: `自选列表（${items.length}/${max}）` }));
    if (!items.length) { listCard.append(el("div", { class: "empty", text: "还没有自选股，上方加入或在量化页一键加入。" })); return; }
    const tb = el("tbody");
    for (const s of items) {
      tb.append(el("tr", {}, [
        el("td", { text: s.code }), el("td", { text: s.name }), el("td", { text: s.category }),
        el("td", {}, [el("button", { class: "btn danger sm", text: "移除", onclick: async () => {
          await api.del(`/watchlist?code=${s.code}&category=${encodeURIComponent(s.category)}`); await refresh();
        } })]),
      ]));
    }
    listCard.append(el("div", { class: "table-scroll" }, [el("table", { class: "data" }, [
      el("thead", {}, [el("tr", {}, ["代码", "名称", "分类", ""].map((h) => el("th", { text: h })))]), tb,
    ])]));
  }
  function renderQuotes(data, notice, selectedCodes = []) {
    const selected = new Set(selectedCodes);
    for (const s of currentItems) {
      const supported = marketSupported(s.code, s.category);
      const item = data && (data.items || []).find((x) => x.code === s.code);
      const message = !supported ? "unsupported：行情暂不支持指数 / ETF 等分类，仅支持 A 股个股。"
        : selectedCodes.length && !selected.has(s.code) ? "本次仅前50条；此标的未请求。"
        : notice || (item ? null : "missing：上游未返回此代码的行情。");
      quoteCard.append(renderMarketQuote(item || s, supported && selected.has(s.code) ? data : null, message));
    }
  }
  async function refreshQuotes() {
    const version = ++quoteVersion, list = listVersion;
    const supported = [...new Set(currentItems.filter((s) => marketSupported(s.code, s.category)).map((s) => s.code))];
    const codes = supported.slice(0, 50);
    quoteCard.innerHTML = "";
    const summary = supported.length > 50 ? "本次仅前50条 A 股个股（共 " + supported.length + " 条）；其余未请求。" : "本次请求 " + codes.length + " 条 A 股个股。";
    quoteCard.append(el("p", { class: "muted", text: summary }));
    if (!codes.length) { renderQuotes(null, "无可请求的 A 股个股。"); return; }
    quoteCard.append(el("p", { class: "muted", text: "最新行情加载中…" }));
    try {
      const data = await api.get("/market/quotes?codes=" + encodeURIComponent(codes.join(",")));
      if (!active() || version !== quoteVersion || list !== listVersion) return;
      quoteCard.innerHTML = "";
      quoteCard.append(el("p", { class: "muted", text: summary }));
      renderQuotes(data, null, codes);
    } catch (e) {
      if (!active() || version !== quoteVersion || list !== listVersion) return;
      quoteCard.innerHTML = "";
      quoteCard.append(el("p", { class: "muted", text: summary }));
      renderQuotes(null, "行情查询失败：" + e.message, codes);
    }
  }
  await refresh();

  listen(runBtn, "click", async () => {
    runBtn.disabled = true;
    try {
      const { job } = await api.post("/watchlist/analyze", { horizon: +horizon.value, with_experts: withExperts.querySelector("input").checked });
      resultCard.hidden = false;
      await streamJob(job.id, resultCard, () => { runBtn.disabled = false; });
    } catch (e) { toast(e.message, "err"); runBtn.disabled = false; }
  });
};

function renderBatchItems(body, items) {
  body.innerHTML = "";
  if (!items.length) return;
  const tb = el("tbody");
  for (const it of items) {
    const q = it.quant || {};
    const c = it.consensus;
    const row = el("tr", {}, [
      el("td", { text: it.code }), el("td", { text: it.name }),
      el("td", {}, [el("span", { class: "badge " + dirClass(q.direction), text: q.error ? "—" : dirLabel(q.direction) })]),
      el("td", { class: "mono", text: q.probability == null ? "—" : fmtPct(q.probability) }),
      el("td", { class: "mono", text: q.predictions == null ? "—" : q.predictions }),
      el("td", {}, [c ? el("span", { class: "badge " + (c.decision === "up" ? "up" : c.decision === "down" ? "down" : "flat"),
        text: c.decision === "up" ? `看涨 ${fmtPct(c.support)}` : c.decision === "down" ? `看跌 ${fmtPct(c.support)}` : "无共识" }) : el("span", { class: "muted", text: "—" })]),
    ]);
    if (it.votes) {
      row.style.cursor = "pointer";
      row.title = "点击查看逐位意见";
      listen(row, "click", () => openModal(it.name + " · 逐位意见",
        renderTeamResult({ consensus: it.consensus, votes: it.votes.map((v) => ({ expert: { name: v.expert }, vote: v.vote, confidence: v.confidence, reason: v.reason, evidence: v.evidence, abstained: v.abstained })) }), []));
    }
    tb.append(row);
  }
  body.append(el("div", { class: "table-scroll" }, [el("table", { class: "data" }, [
    el("thead", {}, [el("tr", {}, ["代码", "名称", "方向", "概率", "样本", "专家共识"].map((h) => el("th", { text: h })))]), tb,
  ])]));
}
