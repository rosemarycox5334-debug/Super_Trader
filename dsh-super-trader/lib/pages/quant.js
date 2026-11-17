// Generated from web/app/assets/app.js by tools/build-pages.mjs.
// Original page functions retained; migration patches are in the build tool.
PAGES.quant = async function (root) {
  root.append(el("div", { class: "page-head" }, [
    el("h1", { text: "量化概率" }),
    el("p", { text: "给定标的与未来第 N 个交易日（或具体日期），返回方向与历史同信号命中率。内样本频率，非校准概率。" }),
  ]));

  const search = el("input", { class: "input", placeholder: "搜索代码或名称，如 601088 / 神华", style: "min-width:220px" });
  const results = el("select", { class: "input", style: "min-width:220px" });
  const horizon = el("select", { class: "input" },
    Array.from({ length: 20 }, (_, i) => el("option", { value: i + 1, text: "第 " + (i + 1) + " 根" })));
  horizon.value = "10";
  const dateInput = el("input", { class: "input", type: "date", "aria-label": "目标日期" });
  const byDate = el("label", { class: "muted" }, [
    el("input", { type: "checkbox" }), " 用日期",
  ]);
  const goBtn = el("button", { class: "btn", text: "查询" });
  const panel = el("div", {});
  const marketPanel = el("div", { class: "market-slot", "aria-live": "polite" });
  const pageToken = root._stMarketPage = {};
  let queryVersion = 0, marketVersion = 0, searchVersion = 0;
  const active = () => root._stMarketPage === pageToken;
  const refreshQuote = el("button", { class: "btn ghost sm", text: "刷新行情", onclick: () => {
    if (!results.value) return toast("请先搜索并选择标的", "err");
    const [code, category] = results.value.split("|");
    return loadQuote(code, category);
  } });

  root.append(el("div", { class: "card" }, [
    el("div", { class: "row" }, [
      search, results,
      el("span", { class: "muted", text: "周期" }), horizon, byDate, dateInput, goBtn, refreshQuote,
    ]),
  ]), marketPanel, panel);
  listen(results, "change", () => {
    queryVersion++; marketVersion++;
    panel.innerHTML = "";
    marketPanel.innerHTML = "";
    marketPanel.append(el("div", { class: "card muted", text: "标的已切换，请查询或刷新行情。" }));
  });
  dateInput.disabled = true;
  listen(byDate.querySelector("input"), "change", (e) => {
    dateInput.disabled = !e.target.checked;
    horizon.disabled = e.target.checked;
  });

  let searchTimer;
  listen(search, "input", () => {
    clearTimeout(searchTimer);
    searchVersion++; queryVersion++; marketVersion++;
    results.innerHTML = ""; panel.innerHTML = ""; marketPanel.innerHTML = "";
    searchTimer = setTimeout(() => doSearch().catch(report), 250);
  });
  async function doSearch() {
    const q = search.value.trim(), version = searchVersion;
    if (!q) { results.innerHTML = ""; return; }
    try {
      const { items } = await api.get("/symbols/search?q=" + encodeURIComponent(q) + "&limit=20");
      if (!active() || version !== searchVersion) return;
      results.innerHTML = "";
      for (const s of items) {
        results.append(el("option", { value: s.code + "|" + s.category, text: `${s.code} ${s.name}（${s.category}）` }));
      }
    } catch (e) { toast(e.message, "err"); }
  }

  listen(goBtn, "click", query);
  function query() {
    if (!results.value) { toast("请先搜索并选择标的", "err"); return; }
    const [code, category] = results.value.split("|");
    const version = ++queryVersion, selection = results.value;
    panel.innerHTML = "";
    panel.append(el("div", { class: "card muted", text: "历史内样本概率计算中…" }));
    const params = new URLSearchParams({ code, category });
    if (byDate.querySelector("input").checked && dateInput.value) params.set("date", dateInput.value);
    else params.set("horizon", horizon.value);
    // Independent requests: a slow/failed quant calculation never delays quotes (or vice versa).
    loadQuote(code, category);
    api.get("/quant/probability?" + params.toString()).then((r) => {
      if (active() && version === queryVersion && results.value === selection) renderProb(panel, r, code, category);
    }).catch((e) => {
      if (!active() || version !== queryVersion || results.value !== selection) return;
      panel.innerHTML = "";
      panel.append(el("div", { class: "card empty", text: "历史概率查询失败：" + e.message }));
    });
  }
  async function loadQuote(code, category) {
    const version = ++marketVersion, selection = results.value;
    marketPanel.innerHTML = "";
    if (!marketSupported(code, category)) {
      marketPanel.append(renderMarketQuote({ code }, null, "行情暂不支持此分类（指数 / ETF 等）；仅支持 A 股个股。"));
      return;
    }
    marketPanel.append(el("div", { class: "card muted", text: "最新行情加载中…" }));
    try {
      const data = await api.get("/market/quotes?codes=" + encodeURIComponent(code));
      if (!active() || version !== marketVersion || results.value !== selection) return;
      marketPanel.innerHTML = "";
      const item = (data.items || []).find((x) => x.code === code);
      marketPanel.append(renderMarketQuote(item || { code }, data, item ? null : "missing：上游未返回此代码的行情。"));
    } catch (e) {
      if (!active() || version !== marketVersion || results.value !== selection) return;
      marketPanel.innerHTML = "";
      marketPanel.append(renderMarketQuote({ code }, null, "行情查询失败：" + e.message));
    }
  }
};

function renderProb(panel, r, code, category) {
  panel.innerHTML = "";
  const d = r.direction;
  const probText = r.probability == null ? "无方向" : fmtPct(r.probability);
  const left = el("div", { class: "card", style: "flex:1;min-width:260px" }, [
    el("h2", { text: `${r.symbol.name} · ${r.symbol.code} · 历史内样本概率` }),
    el("div", { class: "row", style: "align-items:flex-end;gap:16px" }, [
      el("div", { class: "prob-big " + dirClass(d), text: probText }),
      el("span", { class: "badge " + dirClass(d), text: dirLabel(d) }),
    ]),
    el("p", { class: "muted", style: "margin:8px 0 0",
      text: d === 0 ? "当前无方向信号，仅给历史内样本单边基准，非校准的未来概率。" : "概率为历史内样本同信号命中率，非校准的未来概率，与最新行情涨跌幅无关。" }),
    r.warnings && r.warnings.length
      ? el("ul", { class: "warn-list" }, r.warnings.map((w) => el("li", { text: w })))
      : null,
  ]);
  const kv = (k, v) => el("div", { class: "kv" }, [el("span", { text: k }), el("span", { class: "mono", text: v })]);
  const right = el("div", { class: "card", style: "flex:1;min-width:240px" }, [
    el("h2", { text: "口径与样本" }),
    kv("目标", `第 ${r.target.horizon} 根${r.target.target_date ? "（" + r.target.target_date + "）" : ""}`),
    kv("单边基准", fmtPct(r.baseline_up)),
    kv("样本量(predictions)", r.sample.predictions),
    kv("覆盖率", fmtPct(r.sample.coverage)),
    kv("评估口径", r.evaluation.type + (r.evaluation.calibrated ? " · 已校准" : " · 未校准")),
    kv("方法", r.method),
    kv("数据来源", r.source === "grid" ? "预算网格" : "按需重算"),
    r.rules && r.rules.length
      ? el("div", { style: "margin-top:8px" }, [
          el("div", { class: "muted", text: "命中规则" }),
          el("div", { class: "pill-row" }, r.rules.map((x) => el("span", { class: "badge plain", title: x.desc, text: x.key }))),
        ])
      : null,
  ]);
  const quick = el("div", { class: "row", style: "margin-top:4px" }, [
    el("button", { class: "btn ghost sm", text: "加入自选", onclick: async () => {
      try { await api.post("/watchlist", { code, category }); toast("已加入自选", "ok"); }
      catch (e) { toast(e.message, "err"); }
    } }),
    el("button", { class: "btn ghost sm", text: "专家研判", onclick: () => analyzeTeam(code, category, r.target.horizon) }),
    el("button", { class: "btn ghost sm", text: "记一笔", onclick: () => openJournalModal(code, category, r.target.horizon) }),
  ]);
  panel.append(el("div", { class: "row", style: "gap:14px;align-items:stretch" }, [left, right]), quick);
}

// Shared by quant and watchlist; build-pages extracts these helpers once.
function marketSupported(code, category) {
  return /^\d{6}$/.test(String(code)) && ["个股", "A股", "A股个股", "a-share", "stock"].includes(category);
}
function marketNumber(value, suffix = "") {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: 4 }) + suffix : "—";
}
function marketTime(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未知（上游未提供）";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知（无有效时间）" : date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（上海）";
}
function renderMarketQuote(item, data, notice) {
  const card = el("section", { class: "card market-quote", "aria-label": "最新行情 " + item.code });
  card.append(el("h2", { text: `${item.name || ""} ${item.code} · 最新行情` }));
  card.append(el("div", { class: "muted market-meta", text: "来源：" + (data && data.source || "同花顺 Financial-API") }));
  if (notice) {
    card.append(el("p", { class: "warn-list", text: notice }));
  } else {
    const change = item.price_change;
    const direction = typeof change === "number" ? (change > 0 ? 1 : change < 0 ? -1 : 0) : 0;
    card.append(el("div", { class: "row market-price" }, [
      el("strong", { class: "prob-big " + dirClass(direction), text: marketNumber(item.last_price) }),
      el("span", { class: "badge " + dirClass(direction), text: "涨跌 " + marketNumber(change) + " / 涨跌幅 " + marketNumber(item.price_change_ratio_pct, "%") }),
    ]));
    const fields = [["今开", "open_price"], ["最高", "high_price"], ["最低", "low_price"], ["昨收", "prev_price"], ["成交量（上游口径）", "volume"], ["成交额（上游口径）", "turnover"]];
    card.append(el("div", { class: "market-grid" }, fields.map(([label, key]) => el("div", { class: "kv" }, [el("span", { text: label }), el("span", { class: "mono", text: marketNumber(item[key]) })]))));
  }
  if (data) {
    card.append(el("p", { class: "muted market-meta", text: "接口快照时间：" + marketTime(item.timestamp ?? data.timestamp) }));
    card.append(el("p", { class: "muted market-meta", text: data.cached === true ? "缓存：是 · 缓存年龄 " + marketNumber(data.cache_age_seconds, " 秒") : data.cached === false ? "缓存：否（本次获取）" : "缓存：未知" }));
    for (const warning of data.warnings || []) card.append(el("p", { class: "warn-list", text: warning }));
  }
  card.append(el("p", { class: "muted market-meta", text: "接口快照时间非成交 / 逐笔时间；行情涨跌幅不是历史概率。仅操作时请求，不自动轮询。" }));
  return card;
}

async function analyzeTeam(code, category, horizon) {
  const dlg = openModal("专家团队研判", el("div", { class: "empty" }, [el("span", { class: "spinner" }), " 调用模型中…"]), []);
  try {
    const r = await api.post("/experts/team/analyze", { code, category, horizon });
    dlg.body.innerHTML = "";
    dlg.body.append(renderTeamResult(r));
  } catch (e) {
    dlg.body.innerHTML = "";
    dlg.body.append(el("div", { class: "empty", text: "研判失败：" + e.message }));
  }
}

function renderTeamResult(r) {
  const c = r.consensus;
  const wrap = el("div", {});
  wrap.append(el("div", { class: "row" }, [
    el("span", { class: "badge " + (c.decision === "up" ? "up" : c.decision === "down" ? "down" : "flat"),
      text: "共识：" + (c.decision === "up" ? "看涨" : c.decision === "down" ? "看跌" : "无共识") }),
    el("span", { class: "muted", text: `支持度 ${fmtPct(c.support)} · ${c.voted} 票有效 / ${c.abstained} 弃权` }),
  ]));
  for (const v of r.votes || []) {
    wrap.append(el("div", { class: "card", style: "margin-top:10px" }, [
      el("div", { class: "row" }, [
        el("strong", { text: v.expert.name }),
        el("span", { class: "badge " + dirClass(v.vote), text: v.abstained ? "弃权" : dirLabel(v.vote) }),
        el("span", { class: "muted", text: v.confidence }),
      ]),
      el("p", { style: "margin:6px 0 0", text: v.reason }),
      v.evidence && v.evidence.length
        ? el("div", { class: "evidence", html: "证据：" + v.evidence.map((e) => `<code>${esc(e.source)}</code> ${esc(e.ref)}`).join("；") })
        : el("div", { class: "evidence", text: "无证据引用" }),
    ]));
  }
  if (r.errors && r.errors.length) {
    wrap.append(el("div", { class: "warn-list", text: r.errors.map((e) => e.error).join("；") }));
  }
  return wrap;
}
