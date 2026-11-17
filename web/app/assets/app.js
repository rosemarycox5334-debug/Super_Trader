"use strict";
// Super Agent 工作台前端。纯展示与交互，所有计算走后端；无业务状态存前端。

// ------------------------------------------------------------------ API 客户端
const api = {
  async req(method, path, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    const res = await fetch("/api" + path, opt);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = (data && (data.error || data.detail)) || res.statusText;
      const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(p) { return this.req("GET", p); },
  post(p, b) { return this.req("POST", p, b); },
  patch(p, b) { return this.req("PATCH", p, b); },
  del(p) { return this.req("DELETE", p); },
};

// ------------------------------------------------------------------ 工具
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
};
const fmtPct = (x) => (x == null ? "—" : (x * 100).toFixed(1) + "%");
const dirClass = (d) => (d === 1 ? "up" : d === -1 ? "down" : "flat");
const dirLabel = (d) => (d === 1 ? "上涨" : d === -1 ? "下跌" : "中性");

function toast(msg, kind = "") {
  const t = el("div", { class: "toast " + kind, text: msg });
  $("#toasts").append(t);
  setTimeout(() => t.remove(), 4200);
}

// 转义，防止标的名里的 HTML 注入
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ------------------------------------------------------------------ 应用状态（仅 UI，不含业务真相）
const state = { plugins: [], active: null, status: null };

// ------------------------------------------------------------------ 导航渲染
const ICONS = { chart: "📈", users: "👥", star: "★", book: "📒", puzzle: "🧩", brain: "🧠" };

async function loadShell() {
  try {
    state.status = await api.get("/status");
    $("#snapshot-date").textContent = (state.status.grid && state.status.grid.snapshot) || "—";
    const dot = $("#env-dot"), txt = $("#env-text");
    if (state.status.model.configured) {
      dot.className = "env-dot on";
      txt.textContent = "模型已接入 · " + state.status.model.model;
    } else {
      dot.className = "env-dot off";
      txt.textContent = "模型未接入（专家需配置密钥）";
    }
  } catch (e) { toast("状态获取失败：" + e.message, "err"); }
  await loadPlugins();
}

async function loadPlugins() {
  const { items } = await api.get("/plugins");
  state.plugins = items;
  renderNav();
}

function renderNav() {
  const nav = $("#main-nav");
  nav.innerHTML = "";
  // Super Agent 对话固定在最上
  nav.append(navButton({ id: "chat", name: "Super Agent", icon: "🤖" }, state.active === "chat"));
  for (const p of state.plugins) {
    if (!p.enabled) continue;
    nav.append(navButton(p, state.active === p.id));
  }
}

function navButton(p, active) {
  const icon = p.icon && ICONS[p.icon] ? ICONS[p.icon] : (p.icon || "🧩");
  return el("button", {
    class: "nav-item" + (active ? " active" : ""),
    onclick: () => navigate(p.id === "chat" ? "chat" : p.id),
  }, [
    el("span", { class: "nav-icon", text: p.id === "chat" ? "🤖" : icon }),
    el("span", { text: p.name }),
  ]);
}

// ------------------------------------------------------------------ 路由
const PAGES = {}; // 由各插件 kind 注册

async function navigate(id) {
  state.active = id;
  closeNav();
  renderNav();
  const ws = $("#workspace");
  ws._stMarketPage = null;
  ws.innerHTML = "";
  let page, title;
  if (id === "chat") { page = PAGES.chat; title = "Super Agent"; }
  else {
    const plugin = state.plugins.find((p) => p.id === id);
    if (!plugin) { navigate("chat"); return; }
    title = plugin.name;
    const renderer = PAGES[plugin.kind] || PAGES.declarative;
    page = renderer ? (c) => renderer(c, plugin) : null;
  }
  $("#page-title").textContent = title;
  ws.focus();
  if (!page) { ws.append(el("div", { class: "empty", text: "此插件暂无渲染器" })); return; }
  try { await page(ws); }
  catch (e) { ws.append(el("div", { class: "empty", text: "加载失败：" + e.message })); }
}

// ================================================================== 页面：Super Agent 对话
PAGES.chat = async function (root) {
  const wrap = el("div", { class: "chat-wrap" });
  const log = el("div", { class: "chat-log" });
  const suggest = el("div", { class: "suggest" }, [
    "添加插件 龙虎榜", "把自选股排到最前", "601088 第10个交易日 概率", "隐藏插件 操盘记录",
  ].map((s) => el("button", { text: s, onclick: () => send(s) })));
  const input = el("input", { class: "input", placeholder: "用自然语言指挥工作台…", "aria-label": "对话输入" });
  const btn = el("button", { class: "btn", text: "发送" });
  const form = el("form", { class: "chat-input", onsubmit: (e) => { e.preventDefault(); send(input.value); } }, [input, btn]);

  wrap.append(
    el("div", { class: "page-head" }, [
      el("h1", { text: "Super Agent" }),
      el("p", { text: "对话或 UI 都能增删、启停、排序插件；也能查量化概率、调专家团队。执行的都是真实后端操作。" }),
    ]),
    suggest, log, form,
  );
  root.append(wrap);
  addMsg(log, "agent", "你好，我是 Super Agent。试试「添加插件 龙虎榜」或「601088 第10个交易日概率」。");

  let busy = false;
  async function send(text) {
    text = (text || input.value).trim();
    if (!text || busy) return;
    busy = true; btn.disabled = true; input.value = "";
    addMsg(log, "user", text);
    const pending = addMsg(log, "agent", "");
    const bubble = pending.querySelector(".bubble");
    bubble.innerHTML = "";
    // 思考区（灰色，像 dsh 的 reasoning）+ 正文区 + 动作区
    const thinkBox = el("div", { class: "think", hidden: "hidden" });
    const bodyText = el("span", { class: "stream-text" });
    const actionsBox = el("div", { class: "actions", hidden: "hidden" });
    const caret = el("span", { class: "caret" });
    bubble.append(thinkBox, bodyText, caret, actionsBox);

    let answer = "";
    const actionNames = [];
    let sawPlugin = false;
    try {
      await streamAgent(text, (ev) => {
        if (ev.type === "thinking") {
          thinkBox.hidden = false;
          thinkBox.textContent += ev.text;
        } else if (ev.type === "token") {
          answer += ev.text;
          bodyText.textContent = answer;
        } else if (ev.type === "action") {
          actionNames.push(ev.tool);
          actionsBox.hidden = false;
          actionsBox.textContent = "已执行：" + actionNames.join("、");
          if (/plugin/i.test(ev.tool)) sawPlugin = true;
        } else if (ev.type === "notice") {
          thinkBox.hidden = false;
          thinkBox.textContent += "[" + ev.text + "]";
        } else if (ev.type === "done") {
          if (ev.reply && !answer) bodyText.textContent = ev.reply;
          if (ev.actions && ev.actions.some((a) => /plugin/i.test(a.tool))) sawPlugin = true;
        } else if (ev.type === "error") {
          bodyText.textContent = (answer ? answer + "\n" : "") + "出错了：" + ev.error;
        }
        // 思考结束后折叠收起视觉占用
        log.scrollTop = log.scrollHeight;
      });
      caret.remove();
      // 思考完成后淡出（保留可展开，但默认收起）
      if (thinkBox.textContent) thinkBox.classList.add("done");
      if (sawPlugin) await loadPlugins();
    } catch (e) {
      caret.remove();
      bodyText.textContent = (answer ? answer + "\n" : "") + "出错了：" + e.message;
    } finally {
      busy = false; btn.disabled = false;
      input.focus();
      log.scrollTop = log.scrollHeight;
    }
  }
};

// 读取 SSE 流（POST，需用 fetch + ReadableStream；EventSource 只支持 GET）
async function streamAgent(message, onEvent) {
  const res = await fetch("/api/agent/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(t || res.statusText);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE 事件以空行分隔
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = raw.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try { onEvent(JSON.parse(payload)); } catch { /* 忽略坏块 */ }
    }
  }
}

function addMsg(log, who, text) {
  const node = el("div", { class: "msg " + who }, [el("div", { class: "bubble", text })]);
  log.append(node);
  log.scrollTop = log.scrollHeight;
  return node;
}

// ================================================================== 页面：量化概率
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
  results.addEventListener("change", () => {
    queryVersion++; marketVersion++;
    panel.innerHTML = "";
    marketPanel.innerHTML = "";
    marketPanel.append(el("div", { class: "card muted", text: "标的已切换，请查询或刷新行情。" }));
  });
  dateInput.disabled = true;
  byDate.querySelector("input").addEventListener("change", (e) => {
    dateInput.disabled = !e.target.checked;
    horizon.disabled = e.target.checked;
  });

  let searchTimer;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchVersion++; queryVersion++; marketVersion++;
    results.innerHTML = ""; panel.innerHTML = ""; marketPanel.innerHTML = "";
    searchTimer = setTimeout(doSearch, 250);
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

  goBtn.addEventListener("click", query);
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

// ================================================================== 页面：专家团队
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
        analyzeTeam(code.value.trim(), null, +horizon.value);
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

// ================================================================== 页面：自选股
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

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    try {
      const { job } = await api.post("/watchlist/analyze", { horizon: +horizon.value, with_experts: withExperts.querySelector("input").checked });
      resultCard.hidden = false;
      streamJob(job.id, resultCard, () => { runBtn.disabled = false; });
    } catch (e) { toast(e.message, "err"); runBtn.disabled = false; }
  });
};

function streamJob(jobId, card, onDone) {
  card.innerHTML = "";
  const bar = el("i", { style: "width:0%" });
  const label = el("span", { class: "muted", text: "排队中…" });
  const cancelBtn = el("button", { class: "btn danger sm", text: "取消", onclick: () => api.post(`/jobs/${jobId}/cancel`).catch(() => {}) });
  const body = el("div", {});
  card.append(el("h2", { text: "批量研判" }), el("div", { class: "row" }, [label, el("span", { style: "margin-left:auto" }), cancelBtn]),
    el("div", { class: "progress" }, [bar]), body);

  const es = new EventSource(`/api/jobs/${jobId}/stream`);
  es.onmessage = (ev) => {
    const job = JSON.parse(ev.data);
    const pct = job.total ? Math.round((job.progress / job.total) * 100) : 0;
    bar.style.width = pct + "%";
    label.textContent = `${job.status} · ${job.progress}/${job.total}`;
    const items = (job.result && job.result.items) || [];
    renderBatchItems(body, items);
    if (["done", "error", "cancelled", "interrupted"].includes(job.status)) {
      es.close(); cancelBtn.disabled = true;
      if (job.error) body.append(el("div", { class: "warn-list", text: job.error }));
      if (onDone) onDone();
    }
  };
  es.onerror = () => { es.close(); if (onDone) onDone(); };
}

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
      row.addEventListener("click", () => openModal(it.name + " · 逐位意见",
        renderTeamResult({ consensus: it.consensus, votes: it.votes.map((v) => ({ expert: { name: v.expert }, vote: v.vote, confidence: v.confidence, reason: v.reason, evidence: v.evidence, abstained: v.abstained })) }), []));
    }
    tb.append(row);
  }
  body.append(el("div", { class: "table-scroll" }, [el("table", { class: "data" }, [
    el("thead", {}, [el("tr", {}, ["代码", "名称", "方向", "概率", "样本", "专家共识"].map((h) => el("th", { text: h })))]), tb,
  ])]));
}

// ================================================================== 页面：操盘记录
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
      el("button", { class: "btn ghost sm", text: "导出 CSV", onclick: () => window.open("/api/journal/export?fmt=csv", "_blank") }),
      el("button", { class: "btn ghost sm", text: "导出 JSON", onclick: () => window.open("/api/journal/export?fmt=json", "_blank") }),
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
  window.__journalRefresh = refresh;
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
    el("button", { class: "btn danger sm", text: "删除", onclick: async () => { await api.del(`/journal/${j.id}`); refresh(); } }),
  ]));
  card.append(el("div", { class: "muted", style: "margin-top:6px", text:
    `记录信号：方向 ${dirLabel(sig.direction || 0)}${sig.probability != null ? " · 概率 " + fmtPct(sig.probability) : ""}` +
    `${j.price != null ? " · 成交价 " + j.price : " · 未填成交价"}` }));
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

// ================================================================== 页面：记忆
const MEM_LABEL = { constraint: "约束", decision: "决策", progress: "进度", fact: "事实" };
const MEM_BADGE = { constraint: "up", decision: "plain", progress: "flat", fact: "plain" };

PAGES.memory = async function (root) {
  root.append(el("div", { class: "page-head" }, [
    el("h1", { text: "记忆" }),
    el("p", { text: "Super Agent 跨轮/跨会话记住你的约束、决策与进度，下次对话自动带回上下文。规则抽取，不改模型权重。" }),
  ]));

  const recallInput = el("input", { class: "input", placeholder: "召回：搜索记忆关键词", style: "min-width:200px" });
  const addText = el("input", { class: "input", placeholder: "手动加一条记忆（如：默认用第10个交易日）", style: "flex:1;min-width:220px" });
  const addKind = el("select", { class: "input" },
    ["constraint", "decision", "progress", "fact"].map((k) => el("option", { value: k, text: MEM_LABEL[k] })));
  root.append(el("div", { class: "card" }, [
    el("div", { class: "row" }, [
      recallInput, el("button", { class: "btn ghost sm", text: "召回", onclick: () => doRecall() }),
      el("button", { class: "btn ghost sm", text: "全部", onclick: () => refresh() }),
      el("span", { style: "margin-left:auto" }),
      el("button", { class: "btn danger sm", text: "清空记忆", onclick: async () => {
        if (!confirm("清空 Super Agent 的全部记忆？不可恢复。")) return;
        await api.post("/memory/clear?scope=agent"); await refresh(); toast("已清空", "ok");
      } }),
    ]),
    el("div", { class: "row", style: "margin-top:8px" }, [
      addKind, addText, el("button", { class: "btn", text: "记一条", onclick: async () => {
        if (!addText.value.trim()) return;
        try { await api.post("/memory", { kind: addKind.value, text: addText.value.trim(), scope: "agent" });
          addText.value = ""; await refresh(); toast("已记住", "ok"); }
        catch (e) { toast(e.message, "err"); }
      } }),
    ]),
  ]));

  const statBar = el("div", { class: "card" });
  const listCard = el("div", { class: "card" });
  root.append(statBar, listCard);

  async function refresh() {
    const { items, stats } = await api.get("/memory?scope=agent");
    renderStats(stats);
    renderList(items);
  }
  async function doRecall() {
    const q = recallInput.value.trim();
    if (!q) return refresh();
    const { items } = await api.get("/memory/recall?scope=agent&q=" + encodeURIComponent(q));
    renderList(items, `召回「${q}」：${items.length} 条`);
  }
  function renderStats(s) {
    statBar.innerHTML = "";
    const parts = Object.entries(s.by_kind || {}).map(([k, v]) => `${MEM_LABEL[k] || k} ${v}`);
    statBar.append(
      el("span", { class: "muted", text: `活跃 ${s.active} 条 · 退役 ${s.retired} · 容量 ${s.capacity}` }),
      parts.length ? el("span", { class: "muted", style: "margin-left:12px", text: parts.join(" · ") }) : null,
    );
  }
  function renderList(items, title) {
    listCard.innerHTML = "";
    if (title) listCard.append(el("h2", { text: title }));
    if (!items.length) { listCard.append(el("div", { class: "empty", text: "还没有记忆。和 Super Agent 聊几句，或上面手动记一条。" })); return; }
    for (const m of items) {
      listCard.append(el("div", { class: "row", style: "padding:8px 0;border-bottom:1px solid var(--line);align-items:flex-start" }, [
        el("span", { class: "badge " + (MEM_BADGE[m.kind] || "plain"), text: MEM_LABEL[m.kind] || m.kind }),
        el("div", { style: "flex:1" }, [
          el("div", { text: m.text }),
          el("div", { class: "evidence", text:
            `${m.created_at.slice(0, 16).replace("T", " ")} · 命中 ${m.activations} 次` +
            (m.source && m.source.from ? ` · 来源 ${m.source.from}` : "") }),
        ]),
        el("button", { class: "btn danger sm", text: "删除", onclick: async () => {
          await api.del(`/memory/${m.id}`); await refresh();
        } }),
      ]));
    }
  }
  await refresh();
};

// ================================================================== 声明式自定义插件
PAGES.declarative = async function (root, plugin) {
  const cfg = plugin.config || {};
  root.append(el("div", { class: "page-head" }, [el("h1", { text: plugin.name }), el("p", { text: "自定义插件（声明式渲染）。" })]));
  if (!cfg.data_source) {
    root.append(el("div", { class: "card empty" }, [
      el("p", { text: "这是一个占位的自定义插件，还没有配置数据源。" }),
      el("p", { class: "muted", text: "在管理面板里给它配置 render 与 data_source（见 docs/PLUGIN.md），即可按声明渲染后端数据。" }),
    ]));
    return;
  }
  const card = el("div", { class: "card" }, [el("span", { class: "spinner" }), " 加载数据源…"]);
  root.append(card);
  try {
    const res = await fetch(cfg.data_source);
    const data = await res.json();
    card.innerHTML = "";
    renderDeclarative(card, cfg.render || "table", data);
  } catch (e) { card.innerHTML = ""; card.append(el("div", { class: "empty", text: "数据源加载失败：" + e.message })); }
};

function renderDeclarative(card, render, data) {
  const rows = Array.isArray(data) ? data : (data.items || data.data || []);
  if (render === "markdown" || typeof data === "string") {
    card.append(el("pre", { text: typeof data === "string" ? data : JSON.stringify(data, null, 2) })); return;
  }
  if (!rows.length) { card.append(el("div", { class: "empty", text: "无数据" })); return; }
  const cols = Object.keys(rows[0]);
  const tb = el("tbody");
  for (const r of rows.slice(0, 200)) tb.append(el("tr", {}, cols.map((c) => el("td", { text: typeof r[c] === "object" ? JSON.stringify(r[c]) : r[c] }))));
  card.append(el("div", { class: "table-scroll" }, [el("table", { class: "data" }, [
    el("thead", {}, [el("tr", {}, cols.map((c) => el("th", { text: c })))]), tb,
  ])]));
}

// ================================================================== 插件管理面板
async function openPluginManager() {
  const { items } = await api.get("/plugins");
  const list = el("div", {});
  const render = () => {
    list.innerHTML = "";
    items.forEach((p, i) => {
      list.append(el("div", { class: "row", style: "padding:6px 0;border-bottom:1px solid var(--line)" }, [
        el("span", { text: (p.icon && ICONS[p.icon]) || "🧩" }),
        el("strong", { text: p.name }),
        p.builtin ? el("span", { class: "badge plain", text: "内置" }) : null,
        el("span", { style: "margin-left:auto" }),
        el("button", { class: "btn ghost sm", text: p.enabled ? "停用" : "启用", onclick: async () => {
          try { await api.patch(`/plugins/${p.id}`, { enabled: !p.enabled }); p.enabled = !p.enabled; render(); await loadPlugins(); }
          catch (e) { toast(e.message, "err"); }
        } }),
        el("button", { class: "btn ghost sm", text: "↑", title: "上移", disabled: i === 0 ? "disabled" : null, onclick: async () => {
          const order = items.map((x) => x.id); [order[i - 1], order[i]] = [order[i], order[i - 1]];
          await api.post("/plugins/reorder", { order }); await reloadMgr();
        } }),
        p.builtin ? null : el("button", { class: "btn danger sm", text: "删除", onclick: async () => {
          try { await api.del(`/plugins/${p.id}`); await reloadMgr(); await loadPlugins(); toast("已删除", "ok"); }
          catch (e) { toast(e.message, "err"); }
        } }),
      ]));
    });
  };
  async function reloadMgr() {
    const r = await api.get("/plugins"); items.length = 0; items.push(...r.items); render();
  }
  render();

  const nameInput = el("input", { class: "input", placeholder: "新插件名，如 龙虎榜" });
  const body = el("div", { class: "modal-body" }, [
    list,
    el("div", { class: "field" }, [el("label", { text: "新增自定义插件" }),
      el("div", { class: "row" }, [nameInput, el("button", { class: "btn", text: "创建", onclick: async () => {
        if (!nameInput.value.trim()) return;
        try { await api.post("/plugins", { name: nameInput.value.trim() }); nameInput.value = ""; await reloadMgr(); await loadPlugins(); toast("已创建", "ok"); }
        catch (e) { toast(e.message, "err"); }
      } })]),
    ]),
  ]);
  openModalRaw("管理工作台插件", body);
}

// ================================================================== 操盘记录弹窗
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
  save.addEventListener("click", async () => {
    if (!codeI.value.trim()) return toast("请输入代码", "err");
    try {
      await api.post("/journal", {
        code: codeI.value.trim(), action: action.value, horizon: +horizonI.value,
        price: price.value ? +price.value : null, entry_date: entryDate.value || null,
        reasons: { summary: note.value, votes: [] }, note: note.value,
      });
      $("#modal").close();
      toast("已冻结记录", "ok");
      if (window.__journalRefresh) window.__journalRefresh();
    } catch (e) { toast(e.message, "err"); }
  });
}
function field(label, input) { return el("div", { class: "field" }, [el("label", { text: label }), input]); }

// ------------------------------------------------------------------ Modal 基础设施
function openModalRaw(title, bodyNode, footNodes) {
  const modal = $("#modal");
  modal.innerHTML = "";
  modal.append(el("div", { class: "modal-head", text: title }));
  if (bodyNode.classList && bodyNode.classList.contains("modal-body")) modal.append(bodyNode);
  else modal.append(el("div", { class: "modal-body" }, [bodyNode]));
  const foot = el("div", { class: "modal-foot" }, footNodes && footNodes.length ? footNodes
    : [el("button", { class: "btn", text: "关闭", onclick: () => modal.close() })]);
  modal.append(foot);
  if (!modal.open) modal.showModal();
  return { modal, body: modal.querySelector(".modal-body") };
}
function openModal(title, bodyNode, footNodes) { return openModalRaw(title, bodyNode, footNodes); }

// ------------------------------------------------------------------ 导航开关（移动端）
function closeNav() { $("#sidebar").classList.remove("open"); $("#scrim").hidden = true; }
document.addEventListener("click", (e) => {
  const act = e.target.closest("[data-action]");
  if (!act) return;
  const a = act.dataset.action;
  if (a === "toggle-nav") { $("#sidebar").classList.toggle("open"); $("#scrim").hidden = !$("#sidebar").classList.contains("open"); }
  if (a === "close-nav") closeNav();
  if (a === "plugin-manager") openPluginManager();
});
$("#scrim").addEventListener("click", closeNav);

// ------------------------------------------------------------------ 启动
(async function boot() {
  await loadShell();
  navigate("chat");
})();
