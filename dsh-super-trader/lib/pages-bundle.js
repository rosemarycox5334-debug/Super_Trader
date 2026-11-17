// Generated self-contained factory; inline createPages.toString() in ModuleLoader.
// Factory template. build-pages.mjs inserts original page functions and lifecycle helpers.
export function createPages(environment) {
  'use strict';
  // Page-owned resources; no DOM dependencies so cancellation/fallback can be tested offline.
function createLifecycle(parentSignal) {
  const controller = new AbortController();
  const cleanups = new Set();
  const stop = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    for (const fn of cleanups) { try { fn(); } catch {} }
    cleanups.clear();
  };
  const own = (fn) => { if (controller.signal.aborted) fn(); else cleanups.add(fn); return () => cleanups.delete(fn); };
  const later = (fn, ms) => {
    let release;
    const id = setTimeout(() => { release(); if (!controller.signal.aborted) Promise.resolve().then(fn).catch(() => {}); }, ms);
    release = own(() => clearTimeout(id));
    return id;
  };
  if (parentSignal) {
    parentSignal.addEventListener('abort', stop, { once: true });
    own(() => parentSignal.removeEventListener('abort', stop));
    if (parentSignal.aborted) stop();
  }
  return { signal: controller.signal, stop, own, later };
}

function watchJob({ url, get, signal, onJob, onError, EventSourceImpl = globalThis.EventSource, schedule = setTimeout, unschedule = clearTimeout, interval = 1200 }) {
  let source, timer, stopped = false, polling = false;
  const terminal = new Set(['done', 'error', 'cancelled', 'interrupted']);
  function stop() {
    stopped = true;
    source?.close();
    if (timer !== undefined) unschedule(timer);
    signal?.removeEventListener('abort', stop);
  }
  function accept(job) {
    if (stopped || signal?.aborted) return;
    onJob(job);
    if (terminal.has(job.status)) stop();
  }
  function report(error) { if (!stopped && !signal?.aborted) onError(error); }
  async function poll() {
    if (stopped || signal?.aborted) return;
    try { const value = await get(); accept(value.job || value); }
    catch (error) { report(error); }
    if (!stopped && !signal?.aborted) timer = schedule(poll, interval);
  }
  function fallback(error) {
    if (stopped || polling) return;
    polling = true;
    source?.close();
    if (error) report(error);
    void poll();
  }
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) { stop(); return stop; }
  try {
    if (!EventSourceImpl) throw new Error('SSE 不可用，已改为轮询');
    source = new EventSourceImpl(url);
    source.onmessage = (event) => {
      if (polling || stopped) return;
      try { const value = JSON.parse(event.data); accept(value.job || value); }
      catch (error) { fallback(error); }
    };
    source.onerror = () => fallback(new Error('实时连接中断，已改为轮询'));
  } catch (error) { fallback(error); }
  return stop;
}

  const { root, signal } = environment;
  if (!root?.ownerDocument) throw new TypeError('createPages requires a root HTMLElement');
  const document = root.ownerDocument;
  const baseUrl = String(environment.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl.startsWith('/') || baseUrl.startsWith('//') || /[?#]/.test(baseUrl)) throw new TypeError('baseUrl must be a same-origin proxy root');
  root.classList.add('st-pages');
  const workspace = document.createElement('div'); workspace.className = 'workspace'; workspace.tabIndex = -1;
  const modal = document.createElement('section'); modal.className = 'modal'; modal.id = 'modal'; modal.hidden = true;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  const toasts = document.createElement('div'); toasts.className = 'toasts'; toasts.id = 'toasts'; toasts.setAttribute('role', 'status');
  root.append(workspace, modal, toasts);
  let current, disposed = false;
  const closeModal = () => { modal.hidden = true; modal.replaceChildren(); workspace.inert = false; };
  modal.close = closeModal;
  function dispose() {
    if (disposed) return;
    disposed = true; current?.stop(); closeModal();
    workspace.remove(); modal.remove(); toasts.remove(); root.classList.remove('st-pages');
    signal?.removeEventListener('abort', dispose);
  }
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
  async function navigate(id) {
    if (disposed) return;
    current?.stop(); workspace._stMarketPage = null; closeModal(); toasts.replaceChildren(); workspace.replaceChildren();
    const life = current = createLifecycle(signal);
    // A fresh lexical scope on every navigation prevents stale handlers using a new page's signal.
    const $ = (sel, within = root) => within.querySelector(sel);
    const setTimeout = (fn, ms) => life.later(fn, ms);
    const clearTimeout = globalThis.clearTimeout.bind(globalThis);
    let journalRefresh = null;
    const state = { status: null };
    const PAGES = {};
    const report = (error) => { if (!life.signal.aborted) toast('请求失败：' + error.message, 'err'); };
    function listen(node, type, handler) {
      node.addEventListener(type, async (event) => {
        if (life.signal.aborted || node.dataset.stBusy === 'true') return;
        const button = node.tagName === 'BUTTON';
        if (button) { node.dataset.stBusy = 'true'; node.disabled = true; }
        try { await handler(event); } catch (error) { report(error); }
        finally { if (button) { node.dataset.stBusy = 'false'; node.disabled = false; } }
      }, { signal: life.signal });
    }
    const el = (tag, attrs = {}, children = []) => {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'class') node.className = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') listen(node, key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
      }
      for (const child of [].concat(children)) if (child != null) node.append(child.nodeType ? child : document.createTextNode(String(child)));
      return node;
    };
    const api = {
      async req(method, path, body) {
        const options = { method, signal: life.signal, headers: {} };
        if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
        const response = await globalThis.fetch(baseUrl + '/api' + path, options);
        const text = await response.text();
        if (life.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        let data; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
        if (!response.ok) { const detail = data?.error || data?.detail || data?.raw || response.statusText; throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)); }
        return data;
      },
      get(path) { return this.req('GET', path); }, post(path, body) { return this.req('POST', path, body); },
      patch(path, body) { return this.req('PATCH', path, body); }, del(path) { return this.req('DELETE', path); },
    };
    function toast(msg, kind = '') {
      if (life.signal.aborted) return;
      const node = el('div', { class: 'toast ' + kind, text: msg });
      toasts.append(node); setTimeout(() => node.remove(), 4200);
    }
    const fmtPct = (x) => x == null ? '—' : (x * 100).toFixed(1) + '%';
    const dirClass = (d) => d === 1 ? 'up' : d === -1 ? 'down' : 'flat';
    const dirLabel = (d) => d === 1 ? '上涨' : d === -1 ? '下跌' : '中性';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));
    function openModalRaw(title, bodyNode, footNodes) {
      modal.replaceChildren(); modal.setAttribute('aria-label', title);
      modal.append(el('div', { class: 'modal-head', text: title }));
      const body = bodyNode.classList?.contains('modal-body') ? bodyNode : el('div', { class: 'modal-body' }, [bodyNode]);
      modal.append(body, el('div', { class: 'modal-foot' }, footNodes?.length ? footNodes : [el('button', { class: 'btn', text: '关闭', onclick: closeModal })]));
      modal.hidden = false; workspace.inert = true;
      modal.querySelector('input, button, select, textarea')?.focus();
      return { modal, body };
    }
    listen(modal, 'keydown', (event) => { if (event.key === 'Escape') closeModal(); });
    const openModal = openModalRaw;
    function exportJournal(fmt) {
      const link = el('a', { href: baseUrl + '/api/journal/export?fmt=' + fmt, target: '_blank', rel: 'noopener', download: 'journal.' + fmt });
      root.append(link); link.click(); link.remove();
    }
    function openJournalEdit(item, refresh) {
      const price = el('input', { class: 'input', type: 'number', step: '0.01', min: '0', value: item.price ?? '', placeholder: '成交价（可留空）' });
      const note = el('textarea', { class: 'input', text: item.note || '' });
      const save = el('button', { class: 'btn', text: '保存', onclick: async () => {
        const payload = { note: note.value };
        if (price.value !== '') {
          if (!Number.isFinite(+price.value) || +price.value <= 0) return toast('请输入有效成交价', 'err');
          payload.price = +price.value;
        }
        await api.patch('/journal/' + item.id, payload);
        closeModal(); await refresh(); toast('已保存', 'ok');
      } });
      openModalRaw('补填成交价 / 记录备注', el('div', { class: 'modal-body' }, [field('成交价（留空保留原值）', price), field('备注（不改冻结理由）', note)]), [el('button', { class: 'btn ghost', text: '取消', onclick: closeModal }), save]);
    }
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
    function streamJob(jobId, card, onDone) {
      card.replaceChildren();
      const bar = el('i', { style: 'width:0%' });
      const label = el('span', { class: 'muted', text: '排队中…' });
      const notice = el('div', { class: 'warn-list', role: 'status' });
      const cancelBtn = el('button', { class: 'btn danger sm', text: '取消', onclick: () => api.post('/jobs/' + jobId + '/cancel') });
      const body = el('div');
      card.append(el('h2', { text: '批量研判' }), el('div', { class: 'row' }, [label, cancelBtn]), el('div', { class: 'progress' }, [bar]), notice, body);
      return new Promise((resolve) => {
      life.own(resolve);
      life.own(watchJob({ url: baseUrl + '/api/jobs/' + jobId + '/stream', get: () => api.get('/jobs/' + jobId), signal: life.signal,
        onError: (error) => { notice.textContent = error.message; },
        onJob: (job) => {
          bar.style.width = (job.total ? Math.round(job.progress / job.total * 100) : 0) + '%';
          label.textContent = `${job.status} · ${job.progress}/${job.total}`;
          renderBatchItems(body, job.result?.items || []);
          if (['done', 'error', 'cancelled', 'interrupted'].includes(job.status)) {
            cancelBtn.disabled = true; if (job.error) notice.textContent = job.error; onDone?.(); resolve();
          }
        },
      }));
      });
    }
    try {
      if (!Object.hasOwn(PAGES, id)) throw new Error('未知页面：' + id);
      if (id === 'experts') {
        try { state.status = await api.get('/status'); } catch (error) { if (life.signal.aborted) return; report(error); }
      }
      if (!life.signal.aborted) await PAGES[id](workspace);
    } catch (error) {
      if (!life.signal.aborted) workspace.append(el('div', { class: 'card empty', role: 'alert', text: '加载失败：' + error.message }));
    }
  }
  return { navigate, dispose };
}
