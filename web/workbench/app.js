/* Super Agent 工作台：插件化外壳 + 量化概率 + 专家团队。
 * 纯离线：不联网、不调用模型、不下单。所有数据来自内嵌历史快照。 */
'use strict';
(() => {
  const RAW = (typeof document !== 'undefined')
    ? JSON.parse(document.getElementById('workbench-data').textContent)
    : (globalThis.__SNAPSHOT || {symbols: [], snapshot: '2026-11-05'});
  // 构建脚本用紧凑数组 [code, category, name, rows] 存储，运行时统一成对象。
  const DATA = {
    snapshot: RAW.snapshot,
    generated_at: RAW.generated_at,
    symbols: (RAW.symbols || []).map(s => Array.isArray(s) ? {c: s[0], k: s[1], n: s[2], r: s[3]} : s)
  };
  const STORAGE_KEY = 'super-trader.workbench.v4';
  const HAS_DOM = typeof document !== 'undefined';
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct = (n, d = 1) => Number.isFinite(n) ? (n * 100).toFixed(d) + '%' : '—';
  const num = n => Number(n || 0).toLocaleString('en-US');
  const clone = x => JSON.parse(JSON.stringify(x));
  const stamp = () => new Date().toLocaleString('zh-CN', {hour12: false});
  const now = () => new Date().toLocaleTimeString('zh-CN', {hour2: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false});
  const ICONS = {
    sparkles: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4',
    chart: 'M3 3v18h18M6 14l4-4 4 3 6-8', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    sliders: 'M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 10h6m2 2h6m2 4h6', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    close: 'M6 6l12 12M18 6L6 18', check: 'M5 12l4 4L19 6', plus: 'M12 5v14M5 12h14', arrow: 'M12 19V5M5 12l7-7 7 7',
    menu: 'M4 6h16M4 12h16M4 18h16', help: 'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    shield: 'M12 22s9-4 9-11V5l-9-3-9 3v6c0 7 9 11 9 11M8 12l3 3 5-6', message: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z',
    'chevron-right': 'M9 5l7 7-7 7', 'chevron-down': 'M6 9l6 6 6-6', history: 'M3 11a9 9 0 1 1 2.7 6.4M3 4v7h7M12 7v5l3 2',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', download: 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5', upload: 'M12 16V4M7 9l5-5 5 5M4 17v4h16v-4',
    settings: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M3 10l2-1 1-2-1-2 2-2 2 1 2-1 1-2h2l1 2 2 1 2-1 2 2-1 2 1 2 2 1v2l-2 1-1 2 1 2-2 2-2-1-2 1-1 2h-2l-1-2-2-1-2 1-2-2 1-2-1-2-2-1z',
    clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', layers: 'M12 3l10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5', external: 'M14 3h7v7M10 14L21 3M10 3H3v18h18v-7'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.file}"></path></svg>`;

  const MODELS = ['未连接（本地规则）', 'DeepSeek V3.2（未连接）', 'DeepSeek R1（未连接）'];
  const EXPERT_SEEDS = [
    ['buffett','巴菲特','长期价值','巴','买「以合理价格买优秀公司」。先判断生意质量，再谈安全边际；证据不足就等待。','① 有没有持久护城河与定价权\n② 自由现金流是否稳定\n③ 价格是否留有安全边际','低换手，容易错过题材与高成长。','公开致股东信与价值投资框架','价值研究','#eaf1e9','#789370'],
    ['duan','段永平','本分 · 看懂生意','段','只看自己真正能看懂的生意：商业模式简单、能长期赚钱、管理层本分。看不懂就不做，价格要留余量。','① 这门生意我十年后能看懂吗\n② 现金流与用户价值是否真实\n③ 管理层是否本分、不占小股东便宜','能力圈很窄，多数股票会被直接放弃。','公开访谈与雪球问答框架','生意研究','#eef2e6','#7c8f5f'],
    ['cigar','烟蒂股','低估值 · 高股息','烟','寻找被忽视的低估值资产，用真实分红和资产价值构建反转假设。','① 低 PB / 高股息\n② 分红是否可持续\n③ 是否只是价值陷阱','便宜不等于有催化，牛市中可能落后。','格雷厄姆价值框架','股息研究','#f4eddf','#ab9369'],
    ['neutral','中性量化','数据 · 方向频率','量','只根据日线规则的历史命中率与覆盖率给出方向，不替代基本面判断。','① 至少 10% 历史覆盖\n② 1–20 根择优选周期\n③ 中性时不强行发预测','全历史拟合是内样本结果，不保证未来表现。','全历史拟合快照','量化研究','#e9eff5','#7591aa'],
    ['pa','价格行为','趋势 · 结构','价','观察趋势、区间与突破结构，提出可被价格证伪的交易假设。','① 趋势或区间结构\n② 突破与回踩确认\n③ 结构止损与风险回报','K 线形态不是经过验证的交易优势。','Al Brooks 价格行为框架','技术研究','#eeeaf5','#9482ad'],
    ['growth','成长派','景气 · 业绩加速','成','寻找行业景气和盈利能力同步改善的公司，关注估值与成长的匹配。','① 行业景气向上\n② 业绩增长质量\n③ 估值与成长匹配','拐点判断依赖财报，当前未接入。','成长投资研究框架','成长研究','#e9f1f0','#719b98']
  ];
  const FIXTURES = [
    {code:'601088',name:'中国神华',industry:'能源 / 煤炭',pe:9.1,pb:1.3,dividend:7.2,roe:14.8,notes:'现金流与股息框架匹配，但煤价周期需要核实。',votes:{buffett:1,duan:1,cigar:1,neutral:0,pa:1,growth:0}},
    {code:'600900',name:'长江电力',industry:'公用事业 / 水电',pe:18.2,pb:2.8,dividend:3.6,roe:12.1,notes:'经营稳定，估值是否合适仍需要真实财务与公告。',votes:{buffett:1,duan:1,cigar:0,neutral:0,pa:1,growth:-1}},
    {code:'000858',name:'五粮液',industry:'消费 / 白酒',pe:21.6,pb:4.6,dividend:2.1,roe:20.4,notes:'品牌力不是买入理由，需要等待估值与业绩证据。',votes:{buffett:0,duan:1,cigar:-1,neutral:0,pa:0,growth:0}},
    {code:'300750',name:'宁德时代',industry:'电新 / 电池',pe:31,pb:5.1,dividend:1.2,roe:16.2,notes:'产业地位与估值要分开研究，不以题材代替证据。',votes:{buffett:-1,duan:0,cigar:-1,neutral:0,pa:0,growth:1}}
  ];

  const defaultPlugins = () => ([
    {id:'quant', kind:'quant', name:'量化概率', icon:'chart', enabled:true, note:'按规则历史命中率计算未来第 N 根涨跌概率'},
    {id:'experts', kind:'experts', name:'专家团队', icon:'users', enabled:true, note:'蒸馏专家对候选标的给出可证伪的判断'},
    {id:'watchlist', kind:'watchlist', name:'自选股', icon:'bookmark', enabled:true, note:'自己挑的标的，结合量化信号与专家研判'},
    {id:'journal', kind:'journal', name:'操盘记录', icon:'file', enabled:true, note:'记录专家选股与买卖理由，供以后复盘'}
  ]);
  const defaultExperts = () => EXPERT_SEEDS.map(([id, name, tag, initial, desc, basis, flaw, source, role, bg, color]) => ({
    id, name, tag, initial, desc, basis, flaw, source, role, bg, color,
    enabled: true, weight: id === 'neutral' ? 1.5 : 1, model: MODELS[0]
  }));
  const defaultState = () => ({
    schemaVersion: 4, revision: 1, plugins: defaultPlugins(), experts: defaultExperts(),
    team: {consensus:'weighted', threshold:60, abstain:true},
    watchlist: ['个股|601088'], journal: [], conversations: [], activeConversationId: '', messages: [], activity: []
  });

  // ---------------------------------------------------------------- 状态校验
  function validateState(raw) {
    if (!raw || typeof raw !== 'object') throw Error('配置格式无效。');
    const base = defaultState();
    if (raw.schemaVersion !== 4 && raw.schemaVersion !== 3) throw Error('配置版本不受支持。');
    const text = (v, max = 2000) => typeof v === 'string' ? v.slice(0, max) : '';
    const numOr = (v, min, max, fallback) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;

    if (Array.isArray(raw.experts) && raw.experts.length === 0) throw Error('至少需要一位专家。');
    const seen = new Set();
    const experts = (Array.isArray(raw.experts) && raw.experts.length ? raw.experts : base.experts)
      .filter(e => e && typeof e.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(e.id) && !seen.has(e.id) && (seen.add(e.id), true))
      .slice(0, 24)
      .map(e => {
        const seed = base.experts.find(x => x.id === e.id) || {...base.experts[0], id: e.id, initial: '研'};
        const name = text(e.name, 24).trim();
        if (!name) throw Error('专家名称不能为空。');
        return {...seed, id: e.id, name, tag: text(e.tag, 40), desc: text(e.desc, 4000),
          basis: text(e.basis, 4000), flaw: text(e.flaw, 3000), source: text(e.source, 200), role: text(e.role, 40),
          enabled: e.enabled !== false, weight: numOr(e.weight, 0.1, 3, 1),
          model: MODELS.includes(e.model) ? e.model : MODELS[0]};
      });
    if (!experts.length) throw Error('至少需要一位专家。');
    if (!experts.some(e => e.enabled)) experts[0].enabled = true;

    const plugins = (Array.isArray(raw.plugins) ? raw.plugins : base.plugins)
      .filter(p => p && typeof p.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(p.id) && !seen.has('p:' + p.id) && (seen.add('p:' + p.id), true))
      .slice(0, 16)
      .map((p, i) => ({
        id: p.id,
        kind: ['quant', 'experts', 'watchlist', 'journal', 'custom'].includes(p.kind) ? p.kind : 'custom',
        name: text(p.name, 30).trim() || '未命名插件',
        icon: typeof p.icon === 'string' && ICONS[p.icon] ? p.icon : 'layers',
        enabled: p.enabled !== false,
        order: Number.isFinite(Number(p.order)) ? Number(p.order) : i,
        note: text(p.note, 200)
      }))
      .sort((a, b) => a.order - b.order)
      .map((p, i) => ({...p, order: i}));
    for (const builtin of base.plugins) {
      if (!plugins.some(p => p.id === builtin.id)) plugins.push({...builtin, order: plugins.length});
    }
    plugins.forEach((p, i) => { p.order = i; });
    if (!plugins.length) throw Error('至少需要一个插件。');
    if (!plugins.some(p => p.enabled)) plugins[0].enabled = true;

    const team = {...base.team, ...(raw.team || {})};
    team.consensus = ['weighted', 'majority', 'unanimous'].includes(team.consensus) ? team.consensus : 'weighted';
    team.threshold = numOr(team.threshold, 1, 100, 60);
    team.abstain = team.abstain !== false;

    const conv = (typeof normalizeConversationState === 'function') ? normalizeConversationState(raw) : null;
    return {
      ...base,
      revision: Math.max(1, Math.floor(Number(raw.revision) || 1)),
      plugins, experts, team,
      watchlist: Array.isArray(raw.watchlist) ? raw.watchlist.filter(k => typeof k === 'string').slice(0, 300) : base.watchlist,
      journal: normalizeJournal(raw.journal),
      ...(conv || {}),
      messages: (conv ? conv.messages : []),
      activity: Array.isArray(raw.activity) ? raw.activity.slice(0, 50)
        .filter(a => a && typeof a.text === 'string')
        .map(a => ({text: text(a.text, 240), time: text(a.time, 40)})) : []
    };
  }

  // ---------------------------------------------------------------- 操盘记录
  const ACTIONS = {watch: '观察', buy: '买入', add: '加仓', sell: '卖出', close: '清仓'};
  const ACTION_SIDE = {watch: 0, buy: 1, add: 1, sell: -1, close: -1};
  function normalizeJournal(raw) {
    const out = [];
    const seen = new Set();
    for (const r of Array.isArray(raw) ? raw.slice(0, 400) : []) {
      if (!r || typeof r.id !== 'string' || seen.has(r.id)) continue;
      if (typeof r.code !== 'string' || !ACTIONS[r.action]) continue;
      seen.add(r.id);
      const price = Number(r.price), now = Number(r.nowPrice);
      out.push({
        id: r.id.slice(0, 60),
        time: typeof r.time === 'string' ? r.time.slice(0, 40) : '',
        code: r.code.slice(0, 12),
        category: ['个股', 'ETF', '指数'].includes(r.category) ? r.category : '个股',
        name: typeof r.name === 'string' ? r.name.slice(0, 30) : '',
        action: r.action,
        expert: typeof r.expert === 'string' ? r.expert.slice(0, 24) : '团队',
        horizon: Math.min(20, Math.max(1, Math.round(Number(r.horizon) || 10))),
        direction: [-1, 0, 1].includes(r.direction) ? r.direction : 0,
        accuracy: Number.isFinite(Number(r.accuracy)) ? Math.min(1, Math.max(0, Number(r.accuracy))) : null,
        reason: typeof r.reason === 'string' ? r.reason.slice(0, 4000) : '',
        votes: Array.isArray(r.votes) ? r.votes.slice(0, 24).map(v => ({
          name: typeof v.name === 'string' ? v.name.slice(0, 24) : '专家',
          vote: [-1, 0, 1].includes(v.vote) ? v.vote : 0,
          why: typeof v.why === 'string' ? v.why.slice(0, 800) : ''
        })) : [],
        price: Number.isFinite(price) && price > 0 ? Math.min(1e7, price) : null,
        nowPrice: Number.isFinite(now) && now > 0 ? Math.min(1e7, now) : null,
        closed: r.closed === true,
        note: typeof r.note === 'string' ? r.note.slice(0, 1000) : ''
      });
    }
    return out;
  }
  function journalReturn(record) {
    if (!record.price || !record.nowPrice) return null;
    const side = ACTION_SIDE[record.action];
    if (!side) return null;
    return ((record.nowPrice - record.price) / record.price) * side;
  }
  function journalCreate(symbol, action, opts = {}) {
    const horizon = Math.min(20, Math.max(1, Number(opts.horizon) || wlHorizon));
    const p = probabilityFor(symbol, horizon);
    const verdicts = expertVerdicts(symbol, horizon);
    const record = {
      id: 'J-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4),
      time: stamp(), code: symbol.c, category: symbol.k, name: symbol.n,
      action: ACTIONS[action] ? action : 'watch',
      expert: opts.expert || '团队',
      horizon,
      direction: p ? p.direction : 0,
      accuracy: p && p.probability !== null ? p.probability : null,
      reason: opts.reason || `记录当时的量化与专家意见：共识 ${pct(verdicts.share, 0)}，支持 ${verdicts.up} / 观望 ${verdicts.flat} / 反对 ${verdicts.down}。`,
      votes: verdicts.votes.map(v => ({name: v.name, vote: v.vote, why: v.why})),
      price: Number(opts.price) > 0 ? Number(opts.price) : null,
      nowPrice: null, closed: false, note: typeof opts.note === 'string' ? opts.note : ''
    };
    return record;
  }

  // ---------------------------------------------------------------- 插件
  function pluginAdd(current, name) {
    const clean = String(name || '').trim().slice(0, 30);
    if (!clean) throw Error('插件名称不能为空。');
    if (current.plugins.length >= 16) throw Error('最多 16 个插件。');
    if (current.plugins.some(p => p.name === clean)) throw Error('已存在同名插件。');
    const id = 'plg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const plugin = {id, kind: 'custom', name: clean, icon: 'layers', enabled: true, order: current.plugins.length, note: '由 Super Agent 创建，数据源未接入'};
    return {...current, revision: current.revision + 1, plugins: [...current.plugins, plugin]};
  }
  function pluginRemove(current, id) {
    const target = current.plugins.find(p => p.id === id);
    if (!target) throw Error('插件不存在。');
    if (target.kind !== 'custom') throw Error('内置插件不能删除，可以停用。');
    if (current.plugins.filter(p => p.enabled).length === 1 && target.enabled) throw Error('至少保留一个启用的插件。');
    const plugins = current.plugins.filter(p => p.id !== id).map((p, i) => ({...p, order: i}));
    return {...current, revision: current.revision + 1, plugins};
  }
  function pluginToggle(current, id, enabled) {
    const target = current.plugins.find(p => p.id === id);
    if (!target) throw Error('插件不存在。');
    if (!enabled && current.plugins.filter(p => p.enabled).length === 1) throw Error('至少保留一个启用的插件。');
    const plugins = current.plugins.map(p => p.id === id ? {...p, enabled} : p);
    return {...current, revision: current.revision + 1, plugins};
  }
  function pluginMove(current, id, delta) {
    const list = current.plugins.slice().sort((a, b) => a.order - b.order);
    const at = list.findIndex(p => p.id === id);
    const to = at + delta;
    if (at < 0) throw Error('插件不存在。');
    if (to < 0 || to >= list.length) return current;
    const [item] = list.splice(at, 1);
    list.splice(to, 0, item);
    return {...current, revision: current.revision + 1, plugins: list.map((p, i) => ({...p, order: i}))};
  }

  // ---------------------------------------------------------------- 概率
  function symbolKey(s) { return s.k + '|' + s.c; }
  function findSymbol(code, category) {
    const list = DATA.symbols || [];
    if (category) return list.find(s => s.c === code && s.k === category) || null;
    return list.find(s => s.c === code) || null;
  }
  function searchSymbols(query, category) {
    const q = String(query || '').trim().toLowerCase();
    return (DATA.symbols || []).filter(s =>
      (!category || category === '全部' || s.k === category) &&
      (!q || s.c.includes(q) || String(s.n).toLowerCase().includes(q)));
  }
  /** 第 n 根（1..20）的方向概率；返回 null 表示该周期没有可用模型。 */
  function probabilityFor(symbol, horizon) {
    if (!symbol || !Array.isArray(symbol.r)) return null;
    const row = symbol.r[horizon - 1];
    if (!row) return null;
    const [prob, predictions, direction, baseUp, coverage] = row;
    return {
      horizon, direction,
      accuracy: prob / 1000,
      predictions, coverage: coverage / 1000,
      baseUp: baseUp / 1000,
      /** direction=+1 时是上涨概率，-1 时是下跌概率；0 表示没有信号 */
      label: direction === 1 ? '上涨' : direction === -1 ? '下跌' : '中性',
      probability: direction === 0 ? null : prob / 1000
    };
  }
  /** A 股近似交易日：从快照日往后数工作日，用于「未来某日」。 */
  function tradingDaysAhead(targetDate, fromISO) {
    const from = new Date(fromISO + 'T00:00:00');
    const to = new Date(String(targetDate) + 'T00:00:00');
    if (Number.isNaN(to.getTime())) return null;
    let days = 0;
    const cursor = new Date(from);
    while (cursor < to) {
      cursor.setDate(cursor.getDate() + 1);
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) days++;
    }
    return days;
  }
  function bestHorizon(symbol) {
    let best = null;
    for (let h = 1; h <= 20; h++) {
      const p = probabilityFor(symbol, h);
      if (p && p.probability !== null && (!best || p.probability > best.probability)) best = {...p};
    }
    return best;
  }

  // ---------------------------------------------------------------- 专家
  function verdictFor(expert, symbol, probability) {
    const fixture = FIXTURES.find(f => f.code === symbol.c);
    if (fixture) {
      const raw = fixture.votes[expert.id];
      if (typeof raw === 'number') {
        return {vote: raw, why: fixture.notes + `（PE ${fixture.pe}×，股息 ${fixture.dividend}%，ROE ${fixture.roe}%）`, evidence: '内置演示样本'};
      }
      return {vote: 0, why: '这位专家没有配置针对该样本的判断依据，保持观望。', evidence: '无依据'};
    }
    if (expert.id === 'neutral') {
      if (!probability || probability.probability === null) {
        return {vote: 0, why: `第 ${probability ? probability.horizon : '—'} 根该标的没有发出预测，保持中性。`, evidence: '历史量化快照'};
      }
      return {vote: probability.direction, why: `历史同信号命中率 ${pct(probability.accuracy, 2)}，覆盖率 ${pct(probability.coverage, 1)}，样本 ${num(probability.predictions)} 次。内样本频率，不是本次概率。`, evidence: '历史量化快照'};
    }
    return {vote: 0, why: '缺少该标的的财报、估值与公告原文，无法按这个框架判断；不投票，也不补造理由。', evidence: '数据未接入'};
  }
  function expertVerdicts(symbol, horizon) {
    const p = probabilityFor(symbol, horizon);
    const votes = state.experts.filter(e => e.enabled).map(e => ({id: e.id, name: e.name, initial: e.initial, bg: e.bg, color: e.color, ...verdictFor(e, symbol, p)}));
    const total = votes.reduce((n, v) => n + (state.team.consensus === 'weighted' ? state.experts.find(e => e.id === v.id).weight : 1), 0);
    const support = votes.filter(v => v.vote === 1).reduce((n, v) => n + (state.team.consensus === 'weighted' ? state.experts.find(e => e.id === v.id).weight : 1), 0);
    const share = total ? support / total : 0;
    return {votes, share, admitted: share >= state.team.threshold / 100,
      up: votes.filter(v => v.vote === 1).length, flat: votes.filter(v => v.vote === 0).length, down: votes.filter(v => v.vote < 0).length};
  }

  // ---------------------------------------------------------------- 运行时
  let state = defaultState();
  let storageAvailable = true, startupWarning = '', currentView = 'chat';
  let qSymbol = null, qHorizon = 10, qQuery = '', qCategory = '全部', qPage = 1, qDate = '';
  let eQuery = '', ePage = 1, eSymbol = null, eHorizon = 10;
  let wlQuery = '', wlHorizon = 10, wlDetail = '', wlAddQuery = '';
  let journalFilter = 'all', journalExpert = 'all';
  let drawerKind = null, drawerDraft = null, drawerOriginal = null, returnFocus = null;

  function currentPlugin() {
    const id = currentView.startsWith('p-') ? currentView.slice(2) : null;
    return id ? state.plugins.find(p => p.id === id) : null;
  }

  // ---------------------------------------------------------------- 启动
  function boot() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem('super-trader.workbench.v3') || 'null');
      if (saved) state = validateState(saved);
    } catch (e) { startupWarning = '本地配置未能恢复，已使用默认配置。'; }
    if (!state.conversations.length) Object.assign(state, normalizeConversationState(state));
    qSymbol = findSymbol('601088') || (DATA.symbols || [])[0];
    eSymbol = qSymbol;
    document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
    window.addEventListener('hashchange', route);
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', onKey);
    document.getElementById('overlay').addEventListener('click', () => requestClose());
    route();
    if (startupWarning) toast(startupWarning, 'info');
  }

  function persist() {
    try {
      if (Array.isArray(state.conversations)) syncConversationState(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageAvailable = true;
    } catch (e) { storageAvailable = false; }
    if (HAS_DOM) updateChrome();
  }
  function log(text) { state.activity.unshift({text, time: stamp()}); state.activity = state.activity.slice(0, 50); persist(); }
  function toast(text, kind = 'check') {
    if (!HAS_DOM) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = icon(kind) + `<span>${esc(text)}</span>`;
    document.getElementById('toasts').append(el);
    setTimeout(() => el.remove(), 3800);
  }

  function route() {
    const raw = location.hash.slice(1);
    const plugins = state.plugins.filter(p => p.enabled);
    if (!raw || raw === 'chat') currentView = 'chat';
    else if (raw.startsWith('p-') && plugins.some(p => 'p-' + p.id === raw)) currentView = raw;
    else currentView = 'chat';
    if (HAS_DOM) { render(); document.getElementById('sidebar').classList.remove('open'); document.querySelector('.mobile-scrim').hidden = true; }
  }
  function navigate(view) {
    if (drawerKind) { requestClose(() => { location.hash = view; }); return; }
    if (location.hash === '#' + view) { currentView = view; render(); } else location.hash = view;
  }

  function updateChrome() {
    const nav = document.getElementById('main-nav');
    if (nav) {
      const items = [{id: 'chat', name: 'Super Agent', icon: 'sparkles', builtin: true}]
        .concat(state.plugins.filter(p => p.enabled).map(p => ({id: 'p-' + p.id, name: p.name, icon: p.icon})));
      nav.innerHTML = items.map(i => `<a class="nav-item ${currentView === i.id ? 'active' : ''}" href="#${i.id}" data-view="${i.id}">
        <span data-icon="${i.icon}"></span><span>${esc(i.name)}</span>${i.builtin ? '<span class="home-label">主页</span>' : ''}</a>`).join('')
        + `<button class="new-conversation-button" data-action="new-chat"><span data-icon="plus"></span><span>新建对话</span></button>`;
      nav.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
    }
    const title = currentView === 'chat' ? 'Super Agent' : (currentPlugin()?.name || '工作台');
    const pt = document.getElementById('page-title'); if (pt) pt.textContent = title;
    const sd = document.getElementById('snapshot-date'); if (sd) sd.textContent = (DATA.snapshot || '').replaceAll('-', '.');
    const ss = document.getElementById('save-state'); if (ss) ss.textContent = storageAvailable ? '设置保存在本机' : '存储受限 · 请导出备份';
    const sl = document.getElementById('status-left');
    if (sl) sl.textContent = `工作区就绪 · ${state.plugins.filter(p => p.enabled).length} 个插件 · ${state.experts.filter(e => e.enabled).length} 位专家 · v${state.revision}`;
  }

  function render() {
    updateChrome();
    const host = document.getElementById('workspace');
    host.classList.toggle('agent-workspace', currentView === 'chat');
    const plugin = currentPlugin();
    let body;
    if (currentView === 'chat') body = chatPage();
    else if (plugin?.kind === 'quant') body = quantPage();
    else if (plugin?.kind === 'experts') body = expertsPage();
    else if (plugin?.kind === 'watchlist') body = watchlistPage();
    else if (plugin?.kind === 'journal') body = journalPage();
    else body = customPluginPage(plugin);
    host.innerHTML = `<div class="page ${currentView === 'chat' ? 'agent-page' : ''}">${body}</div>`;
    host.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
    if (currentView === 'chat') scrollChat();
  }

  // ---------------------------------------------------------------- 对话
  function currentConversation() { return (state.conversations || []).find(c => c.id === state.activeConversationId); }
  function appendMessage(message) {
    syncConversationState(state);
    state.messages = cleanMessages([...state.messages, message]);
    const c = currentConversation(); if (c) c.updated = stamp();
    persist();
  }
  function newConversation() {
    const current = syncConversationState(state);
    if (!current.messages.length && !current.draft) { navigate('chat'); return; }
    createConversationState(state, 'chat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), stamp());
    persist(); navigate('chat'); render();
  }
  function chatPage() {
    const c = currentConversation();
    const has = state.messages.length > 0;
    return `<div class="agent-topline"><div class="agent-identity"><span class="agent-status-mark">${icon('sparkles')}</span><div>
      <h1>Super Agent <span class="agent-role">你的工作台总助</span></h1>
      <p>${has ? esc(c?.title || '当前对话') : '对话即入口：让我加插件、算概率、请专家。'}</p></div></div>
      <div class="agent-top-actions"><span class="pill">离线交互演示</span>
      <button class="icon-button" data-action="plugin-manager" aria-label="管理工作台插件" title="管理工作台插件">${icon('plus')}</button>
      <button class="icon-button" data-action="conversation-list" aria-label="打开对话历史" title="对话历史">${icon('history')}</button></div></div>
      <div class="agent-thread ${has ? 'has-messages' : ''}" id="chat-thread" role="log" aria-label="与 Super Agent 的对话">
        <div class="agent-transcript">${has ? state.messages.map(messageHTML).join('') : welcomeHTML()}</div></div>
      <div class="agent-compose-region"><form id="chat-form" class="agent-composer">
        <label for="chat-input" class="sr-only">向 Super Agent 发送消息</label>
        <textarea id="chat-input" rows="3" placeholder="让 Super Agent 做点什么：加一个插件、算某日概率、请专家选股…" maxlength="1500">${esc(c?.draft || '')}</textarea>
        <div class="agent-compose-bottom"><div class="agent-context-controls">
          <button type="button" class="agent-mode-button" data-action="help">${icon('sparkles')}Super Agent${icon('chevron-down')}</button>
          <button type="button" class="agent-context-button" data-action="plugin-manager">${icon('layers')}${state.plugins.filter(p => p.enabled).length} 个插件</button>
          <button type="button" class="agent-context-button" data-action="open-experts">${icon('users')}专家 ${state.experts.filter(e => e.enabled).length}</button>
        </div><button class="agent-send" type="submit" aria-label="发送" title="发送 · Enter">${icon('arrow')}</button></div>
      </form><div class="agent-compose-caption"><span>Enter 发送 · Shift + Enter 换行</span><span>在线模型未接入，当前为本地演示与真实历史快照</span></div></div>`;
  }
  function welcomeHTML() {
    const starters = [
      ['chart', '算一算某日概率', '按规则命中率给出未来第 N 根涨跌概率', 'quant'],
      ['users', '请专家团队选股', '多位蒸馏专家交叉看同一只标的', 'experts'],
      ['layers', '改造工作台', '像 DSH 一样，让我加一个插件', 'plugin'],
      ['file', '查看历史对话', '回到之前的研究，不丢上下文', 'history']
    ];
    return `<section class="agent-welcome"><div class="agent-welcome-emblem">${icon('sparkles')}</div>
      <div class="agent-welcome-eyebrow">SUPER AGENT WORKSPACE</div>
      <h2>今天，想让我怎么改造工作台？</h2>
      <p>这是一个可以被对话改造的工作台。<br>万物皆插件：加一个页面、算一次概率、请一组专家。</p>
      <div class="agent-starters">${starters.map(([ic, t, s, act]) => `<button type="button" class="agent-starter" data-action="starter" data-starter="${act}">${icon(ic)}<span><strong>${t}</strong><small>${s}</small></span>${icon('chevron-right')}</button>`).join('')}</div>
      <div class="agent-ready-note"><span class="live-dot"></span>${num((DATA.symbols || []).length)} 个标的历史快照 <span>·</span> ${state.experts.filter(e => e.enabled).length} 位专家 <span>·</span> 对话与插件保存在本机</div></section>`;
  }
  function messageHTML(m) {
    return `<div class="turn agent-turn ${m.role === 'user' ? 'is-user' : 'is-agent'}">
      <span class="avatar ${m.role === 'user' ? 'user' : ''}">${m.role === 'user' ? 'ME' : icon('sparkles')}</span>
      <div class="turn-content"><div class="turn-meta"><b>${m.role === 'user' ? '你' : 'Super Agent'}</b>${m.role === 'assistant' ? '<span class="agent-response-tag">本地演示</span>' : ''}<time>${esc(m.time)}</time></div>
      <div class="${m.role === 'user' ? 'user-bubble' : 'assistant-text'}">${esc(m.text).replaceAll('\n', '<br>')}</div></div></div>`;
  }
  function scrollChat() { const el = document.getElementById('chat-thread'); if (el) el.scrollTop = el.scrollHeight; }

  function sendMessage(text) {
    text = String(text || '').trim();
    if (!text) return;
    const c = currentConversation(); if (c) c.draft = '';
    appendMessage({role: 'user', text, time: now()});
    let reply = '';
    const add = text.match(/(?:添加|新建|加|安装)\s*(?:一个)?\s*(?:插件|页面)\s*[「“"]?([^\s」”"，。]{1,20})/);
    const del = text.match(/(?:删除|卸载|移除)\s*(?:插件|页面)?\s*[「“"]?([^\s」”"，。]{1,20})/);
    const show = text.match(/(?:显示|启用)\s*(?:插件|页面)?\s*[「“"]?([^\s」”"，。]{1,20})/);
    const hide = text.match(/(?:隐藏|停用|禁用)\s*(?:插件|页面)?\s*[「“"]?([^\s」”"，。]{1,20})/);
    if (add) {
      try {
        state = pluginAdd(state, add[1]); persist(); render();
        reply = `已添加插件「${add[1]}」，它出现在左侧导航里了。\n\n这是本地演示插件：结构、顺序、启停都会保存，但真正的数据源还没接入。你可以在「管理工作台插件」里改名、排序或删除。`;
      } catch (e) { reply = '添加失败：' + e.message; }
    } else if (del) {
      const p = state.plugins.find(x => x.name === del[1]);
      try {
        if (!p) throw Error(`没有找到名为「${del[1]}」的插件。`);
        state = pluginRemove(state, p.id); persist(); render();
        reply = `已删除插件「${p.name}」。内置插件只能停用，不能删除。`;
      } catch (e) { reply = '删除失败：' + e.message; }
    } else if (show || hide) {
      const name = (show || hide)[1];
      const p = state.plugins.find(x => x.name === name);
      try {
        if (!p) throw Error(`没有找到名为「${name}」的插件。`);
        state = pluginToggle(state, p.id, Boolean(show)); persist(); render();
        reply = `插件「${p.name}」已${show ? '启用' : '停用'}。`;
      } catch (e) { reply = '操作失败：' + e.message; }
    } else if (/插件|页面/.test(text) && /(加|增|建|删|卸|隐藏|显示)/.test(text)) {
      reply = '我可以直接改这个工作台。试一句:「添加插件 龙虎榜」或「隐藏插件 专家团队」。\n\n插件是真实状态：会出现在导航、可排序、可启停，并保存在本机；但这些是演示插件，没有接入对应数据源。';
    } else if (/概率|上涨|下跌|涨|跌|未来|第.*根|哪天/.test(text)) {
      const code = (text.match(/\b(\d{6})\b/) || [])[1];
      const symbol = code ? findSymbol(code) : qSymbol;
      if (!symbol) { reply = '给我一个六位代码，我来算它未来第 N 根的方向概率。'; }
      else {
        const best = bestHorizon(symbol);
        const p = probabilityFor(symbol, best ? best.horizon : 10);
        qSymbol = symbol; qHorizon = p ? p.horizon : 10;
        reply = `${symbol.n}（${symbol.c}）\n\n最佳周期：第 ${p.horizon} 根。\n` +
          (p.probability === null
            ? `当前这条规则没有发出方向预测（中性）。该周期的单边基准上涨率是 ${pct(p.baseUp)}，但那不是模型结论。`
            : `方向：${p.label}，历史同信号命中率 ${pct(p.probability, 2)}。\n预测样本 ${num(p.predictions)} 次，覆盖率 ${pct(p.coverage, 1)}。`) +
          `\n\n这是截止 ${DATA.snapshot} 的全历史内样本频率，不是这一次的已校准概率。想看别的周期或日期，去「量化概率」。`;
      }
    } else if (/操盘|复盘|记录|平仓/.test(text)) {
      const rows = state.journal;
      reply = rows.length
        ? `你有 ${rows.length} 条操盘记录，其中 ${rows.filter(r => !r.closed).length} 条持仓中。\n\n` +
          rows.slice(0, 4).map(r => `· ${r.name}（${r.code}）${ACTIONS[r.action]} · ${r.expert} · 当时第 ${r.horizon} 根${r.direction === 1 ? '看涨' : r.direction === -1 ? '看跌' : '中性'} · 现在${journalDrift(r).label}`).join('\n') +
          `\n\n完整理由、逐位专家意见和复盘收益在「操盘记录」页。`
        : '还没有操盘记录。在「专家团队」或「自选股」点「记录操盘」，会连当时的理由和信号一起存下来。';
    } else if (/自选/.test(text)) {
      const code = (text.match(/\b(\d{6})\b/) || [])[1];
      if (code) {
        const symbol = findSymbol(code);
        if (!symbol) reply = `快照里没有 ${code}。核对一下代码？`;
        else if (/移出|删除|去掉/.test(text)) { state.watchlist = state.watchlist.filter(k => k !== symbolKey(symbol)); persist(); render(); reply = `已把 ${symbol.n} 移出自选。`; }
        else { addWatch(symbolKey(symbol)); reply = `已把 ${symbol.n}（${symbol.c}）加入自选。

去「自选股」页可以按同一持有期批量看量化方向与专家共识。`; }
      } else {
        const rows = watchBatch(wlHorizon);
        reply = rows.length
          ? `你的自选有 ${rows.length} 只，第 ${wlHorizon} 根批量研判：

` + rows.map(r => `· ${r.symbol.n}：量化${r.p ? (r.p.direction === 1 ? '看涨' : r.p.direction === -1 ? '看跌' : '中性') : '无信号'}${r.p && r.p.probability !== null ? '（历史命中 ' + pct(r.p.probability, 1) + '）' : ''}，专家共识 ${pct(r.verdicts.share, 0)}`).join('\n') + `\n\n完整表格和逐位专家理由在「自选股」页。`
          : '自选还是空的。说「把 600900 加入自选」就行。';
      }
    } else if (/专家|巴菲特|段永平|选股|团队/.test(text)) {
      const code = (text.match(/\b(\d{6})\b/) || [])[1];
      const symbol = code ? findSymbol(code) : eSymbol;
      if (symbol) { eSymbol = symbol; }
      reply = `当前专家团队有 ${state.experts.filter(e => e.enabled).length} 位：${state.experts.filter(e => e.enabled).map(e => e.name).join('、')}。\n\n` +
        (symbol ? `以 ${symbol.n}（${symbol.c}）为例，点「专家团队」可以看到每个人各自的判断依据与弃权理由。` : '去「专家团队」选一只标的。') +
        `\n\n说明：只有量化专家能读历史快照；价值类专家缺少财报与公告，会明确弃权，而不是编理由。`;
    } else if (/你好|hi|hello|你是谁/i.test(text)) {
      reply = '我是 Super Agent，这个工作台的总入口。\n\n我能做三件事：\n① 改造工作台——加/删/启停/排序插件；\n② 用量化规则算某只标的未来第 N 根的方向概率；\n③ 请专家团队交叉研判候选标的。\n\n在线模型未接入，其余能力我会明确说做不到。';
    } else {
      reply = '这个工作台目前只做三件事：插件化管理、量化概率、专家选股。\n\n试试：「添加插件 龙虎榜」「601088 第 10 根上涨概率」「专家怎么看 600900」。\n\n超出范围的问题我不会假装能回答，也不会编造数据。';
    }
    appendMessage({role: 'assistant', text: reply, time: now()});
    render(); scrollChat();
    const input = document.getElementById('chat-input'); if (input) input.focus();
  }

  // ---------------------------------------------------------------- 量化概率页
  function quantListHTML(list, pages) {
    const per = 12;
    const rows = list.slice((qPage - 1) * per, qPage * per);
    return `<div class="quant-list">${rows.map(s => `<button class="quant-row ${s === qSymbol ? 'selected' : ''}" data-action="q-pick" data-key="${symbolKey(s)}">
      <span><strong>${esc(s.n)}</strong><small>${s.c} · ${s.k}</small></span>
      <span class="quant-row-side">${(() => { const b = bestHorizon(s); return b ? `<b>${pct(b.probability, 1)}</b><small>H${b.horizon}</small>` : '<b>—</b><small>无信号</small>'; })()}</span></button>`).join('') || empty('没有匹配的标的', '换个代码或名称试试。')}</div>
      <div class="quant-pager"><button class="icon-button" data-action="q-prev" ${qPage === 1 ? 'disabled' : ''} aria-label="上一页">${'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg>'}</button>
      <span class="mono">${qPage} / ${num(pages)}</span>
      <button class="icon-button" data-action="q-next" ${qPage === pages ? 'disabled' : ''} aria-label="下一页">${'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg>'}</button></div>`;
  }
  function refreshProbCard() {
    const host = document.querySelector('.prob-card');
    if (!host || !qSymbol) return;
    const curve = Array.from({length: 20}, (_, i) => probabilityFor(qSymbol, i + 1));
    const tmp = document.createElement('template');
    tmp.innerHTML = probabilityPanel(qSymbol, probabilityFor(qSymbol, qHorizon), curve, qDate ? tradingDaysAhead(qDate, DATA.snapshot) : null);
    host.replaceWith(tmp.content.querySelector('.prob-card'));
  }
  function refreshQuantList() {
    const list = searchSymbols(qQuery, qCategory);
    const pages = Math.max(1, Math.ceil(list.length / 12));
    qPage = Math.min(Math.max(qPage, 1), pages);
    const host = document.querySelector('.quant-list'); const pager = document.querySelector('.quant-pager');
    if (!host) return;
    const changed = !qSymbol || !list.includes(qSymbol);
    if (changed) qSymbol = list[0] || qSymbol;
    const tmp = document.createElement('template');
    tmp.innerHTML = quantListHTML(list, pages);
    host.replaceWith(tmp.content.querySelector('.quant-list'));
    if (pager) pager.replaceWith(tmp.content.querySelector('.quant-pager'));
    if (changed) refreshProbCard();
  }
  function quantPage() {
    const list = searchSymbols(qQuery, qCategory);
    const per = 12, pages = Math.max(1, Math.ceil(list.length / per));
    qPage = Math.min(Math.max(qPage, 1), pages);
    if (!qSymbol || !list.some(s => s === qSymbol)) qSymbol = list[0] || qSymbol;
    const p = qSymbol ? probabilityFor(qSymbol, qHorizon) : null;
    const curve = qSymbol ? Array.from({length: 20}, (_, i) => probabilityFor(qSymbol, i + 1)) : [];
    const rows = list.slice((qPage - 1) * per, qPage * per);
    const daysFromDate = qDate ? tradingDaysAhead(qDate, DATA.snapshot) : null;
    return `<div class="page-heading"><div><div class="eyebrow">QUANT PROBABILITY</div><h1>量化概率</h1>
      <p class="subtitle">按历史规则命中率，给出某只标的「未来第 N 根」的上涨或下跌概率。${num((DATA.symbols || []).length)} 个标的 · 1–20 根。</p></div>
      <div class="heading-actions"><button class="btn" data-action="wl-add-current">${icon('bookmark')}${qSymbol && state.watchlist.includes(symbolKey(qSymbol)) ? '已在自选' : '加入自选'}</button><span class="pill amber">内样本频率，非预测</span></div></div>
      <div class="quant-layout"><aside class="panel quant-picker">
        <div class="panel-header"><h2>选择标的</h2><span class="meta">${num(list.length)} / ${num((DATA.symbols || []).length)}</span></div>
        <div class="quant-picker-body"><label class="search-input">${icon('search')}<input id="q-search" type="search" placeholder="代码或名称…" value="${esc(qQuery)}" aria-label="搜索标的"></label>
        <div class="segmented quant-types">${['全部', '个股', 'ETF', '指数'].map(t => `<button data-action="q-type" data-type="${t}" class="${qCategory === t ? 'active' : ''}">${t}</button>`).join('')}</div></div>
        ${quantListHTML(list, pages)}
      </aside>
      <section class="quant-result">${qSymbol ? probabilityPanel(qSymbol, p, curve, daysFromDate) : empty('先选一只标的', '左侧列表可以搜索全部标的。')}</section></div>`;
  }
  function probabilityPanel(symbol, p, curve, days) {
    const headline = !p ? '没有可用模型'
      : p.probability === null ? '当前无方向信号'
      : `第 ${p.horizon} 根后${p.label}概率`;
    const big = !p ? '—' : p.probability === null ? pct(p.baseUp, 1) : pct(p.probability, 1);
    const sub = !p ? '' : p.probability === null
      ? '显示的是该周期单边基准上涨率，不是模型结论'
      : `历史同信号命中率 · 样本 ${num(p.predictions)} 次 · 覆盖率 ${pct(p.coverage, 1)}`;
    const bars = curve.map((c, i) => {
      const h = i + 1, v = c && c.probability !== null ? c.probability : (c ? c.baseUp : 0);
      const active = h === qHorizon;
      return `<button class="qbar ${active ? 'on' : ''} ${c && c.probability === null ? 'flat' : ''}" data-action="q-horizon" data-h="${h}"
        title="第 ${h} 根 · ${c ? (c.probability === null ? '无信号' : pct(c.probability, 1)) : '无模型'}" aria-label="第 ${h} 根">
        <i style="height:${Math.max(6, Math.min(100, (v - 0.45) / 0.3 * 100))}%"></i><span>${h}</span></button>`;
    }).join('');
    return `<div class="panel prob-card"><div class="prob-head"><div>
        <div class="section-label">${esc(symbol.c)} · ${esc(symbol.k)}</div>
        <h2>${esc(symbol.n)}</h2>
        <div class="prob-horizon">持有期 <b>第 ${qHorizon} 根</b>${days !== null ? ` · 你选的日期约第 ${days} 个交易日` : ''}</div></div>
        <div class="prob-hero"><div class="prob-direction ${p && p.direction === 1 ? 'up' : p && p.direction === -1 ? 'down' : 'flat'}">${headline}</div>
        <div class="prob-value">${big}</div><div class="prob-sub">${sub}</div></div></div>
      <div class="prob-controls">
        <label class="prob-field"><span>目标日期</span><input id="q-date" type="date" value="${esc(qDate)}" min="${esc(DATA.snapshot)}">
        </label><div class="prob-hint">${days === null ? '或直接选下面的持有期' : days > 20 ? `约 ${days} 个交易日，超出 1–20 根范围` : `约 ${days} 个交易日 → 已切到第 ${qHorizon} 根`}</div>
        <label class="prob-field"><span>持有期</span><select id="q-horizon-select">${Array.from({length: 20}, (_, i) => `<option value="${i + 1}" ${qHorizon === i + 1 ? 'selected' : ''}>第 ${i + 1} 根</option>`).join('')}</select></label>
      </div>
      <div class="prob-chart" role="group" aria-label="1 到 20 根概率曲线">${bars}</div>
      <div class="prob-legend"><span><i class="ok"></i>有方向信号</span><span><i class="none"></i>无信号（显示基准）</span></div>
      <div class="prob-table-wrap"><table class="prob-table"><thead><tr><th>第 N 根</th><th class="num">方向</th><th class="num">历史命中率</th><th class="num">预测次数</th><th class="num">覆盖率</th><th class="num">单边基准</th></tr></thead><tbody>
        ${curve.map((c, i) => `<tr class="${i + 1 === qHorizon ? 'on' : ''}"><td>第 ${i + 1} 根</td><td class="num">${c ? (c.direction === 1 ? '上涨' : c.direction === -1 ? '下跌' : '中性') : '—'}</td>
          <td class="num">${c && c.probability !== null ? pct(c.probability, 2) : '—'}</td><td class="num">${c ? num(c.predictions) : '—'}</td>
          <td class="num">${c ? pct(c.coverage, 1) : '—'}</td><td class="num muted">${c ? pct(c.baseUp, 1) : '—'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="prob-note">${icon('info')}全历史拟合的内样本命中率，不是校准后的概率；无信号时不把基准涨率包装成结论。数据截止 ${esc(DATA.snapshot)}。</p>
    </div>`;
  }

  // ---------------------------------------------------------------- 专家页
  function candListHTML(list, pages) {
    const per = 10; const rows = list.slice((ePage - 1) * per, ePage * per);
    return `<div class="cand-list">${rows.map(s => `<button class="cand-row ${s === eSymbol ? 'selected' : ''}" data-action="e-pick" data-key="${symbolKey(s)}"><span><strong>${esc(s.n)}</strong><small>${s.c} · ${s.k}</small></span>${(() => { const b = bestHorizon(s); return b ? `<b>${pct(b.probability, 1)}</b>` : '<b class="muted">—</b>'; })()}</button>`).join('') || empty('没有匹配的标的', '换个搜索词。')}</div>
      <div class="quant-pager"><button class="icon-button" data-action="e-prev" ${ePage === 1 ? 'disabled' : ''} aria-label="上一页">${'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg>'}</button><span class="mono">${ePage} / ${num(pages)}</span><button class="icon-button" data-action="e-next" ${ePage === pages ? 'disabled' : ''} aria-label="下一页">${'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg>'}</button></div>`;
  }
  function refreshVerdictPanel() {
    const host = document.querySelector('.verdict-panel');
    if (!host || !eSymbol) return;
    const tmp = document.createElement('template');
    tmp.innerHTML = verdictPanel(eSymbol, expertVerdicts(eSymbol, eHorizon), probabilityFor(eSymbol, eHorizon));
    host.replaceWith(tmp.content.querySelector('.verdict-panel'));
  }
  function refreshCandList() {
    const list = searchSymbols(eQuery, '全部');
    const pages = Math.max(1, Math.ceil(list.length / 10));
    ePage = Math.min(Math.max(ePage, 1), pages);
    const host = document.querySelector('.cand-list'); if (!host) return;
    const changed = !eSymbol || !list.includes(eSymbol);
    if (changed) eSymbol = list[0] || eSymbol;
    const tmp = document.createElement('template');
    tmp.innerHTML = candListHTML(list, pages);
    host.replaceWith(tmp.content.querySelector('.cand-list'));
    const pager = document.querySelector('.verdict-panel') ? document.querySelectorAll('.quant-pager')[1] : null;
    const fresh = tmp.content.querySelector('.quant-pager');
    if (pager && fresh) pager.replaceWith(fresh);
    if (changed) refreshVerdictPanel();
  }
  function expertsPage() {
    const list = searchSymbols(eQuery, '全部');
    const per = 10, pages = Math.max(1, Math.ceil(list.length / per));
    ePage = Math.min(Math.max(ePage, 1), pages);
    if (!eSymbol || !list.some(s => s === eSymbol)) eSymbol = list[0] || eSymbol;
    const rows = list.slice((ePage - 1) * per, ePage * per);
    const verdicts = eSymbol ? expertVerdicts(eSymbol, eHorizon) : null;
    const p = eSymbol ? probabilityFor(eSymbol, eHorizon) : null;
    return `<div class="page-heading"><div><div class="eyebrow">EXPERT TEAM</div><h1>专家团队</h1>
      <p class="subtitle">蒸馏专家的判断函数，用来辅助选股。每位专家独立给结论，缺少证据就弃权。</p></div>
      <div class="heading-actions"><button class="btn" data-action="journal-new">${icon('file')}记录操盘</button><button class="btn" data-action="wl-add-current">${icon('bookmark')}加入自选</button><span class="pill">${state.experts.filter(e => e.enabled).length} 位启用</span></div></div>
      <div class="experts-layout"><aside class="panel experts-team">
        <div class="panel-header"><h2>团队</h2><span class="meta">${state.experts.length} 位</span></div>
        <div class="expert-mini-list">${state.experts.map(e => `<div class="expert-mini ${e.enabled ? '' : 'off'}">
          <span class="avatar" style="background:${e.bg};color:${e.color}">${esc(e.initial)}</span>
          <span class="expert-mini-name"><strong>${esc(e.name)}</strong><small>${esc(e.tag)}</small></span>
          <button class="switch" role="switch" aria-checked="${e.enabled}" data-action="toggle-expert" data-id="${e.id}" aria-label="${e.enabled ? '停用' : '启用'}${esc(e.name)}"></button>
        </div>`).join('')}</div>
        <div class="expert-mini-actions"><button class="text-button" data-action="edit-expert" data-id="${state.experts[0]?.id}">${icon('sliders')}查看/编辑专家设置</button></div>
      </aside>
      <section class="experts-main"><div class="panel experts-candidates">
        <div class="panel-header"><h2>候选标的</h2><span class="meta">${num(list.length)}</span></div>
        <div class="experts-cand-body"><label class="search-input">${icon('search')}<input id="e-search" type="search" placeholder="搜索候选标的…" value="${esc(eQuery)}" aria-label="搜索候选标的"></label>
        ${candListHTML(list, pages)}</div>
      </div>
      ${verdicts ? verdictPanel(eSymbol, verdicts, p) : ''}</section></div>`;
  }
  function verdictPanel(symbol, v, p) {
    const total = state.experts.filter(e => e.enabled).length;
    return `<div class="panel verdict-panel"><div class="panel-header"><h2>${esc(symbol.n)} <span class="mono muted">${symbol.c}</span></h2>
      <div class="button-group"><span class="pill ${v.admitted ? 'green' : ''}">共识 ${pct(v.share, 0)}</span>
      <select id="e-horizon" class="filter-select" aria-label="会审持有期">${Array.from({length: 20}, (_, i) => `<option value="${i + 1}" ${eHorizon === i + 1 ? 'selected' : ''}>第 ${i + 1} 根</option>`).join('')}</select></div></div>
      <div class="verdict-summary"><div class="verdict-bar"><i class="up" style="width:${v.up / total * 100}%"></i><i class="flat" style="width:${v.flat / total * 100}%"></i><i class="down" style="width:${v.down / total * 100}%"></i></div>
      <div class="verdict-legend"><span>支持 ${v.up}</span><span>观望 ${v.flat}</span><span>反对 ${v.down}</span><span class="muted">门槛 ${state.team.threshold}%</span></div></div>
      <div class="verdict-list">${v.votes.map(x => `<div class="verdict-row"><span class="avatar" style="background:${x.bg};color:${x.color}">${esc(x.initial)}</span>
        <div class="verdict-body"><div class="verdict-head"><strong>${esc(x.name)}</strong><span class="pill ${x.vote === 1 ? 'green' : x.vote === -1 ? 'red' : ''}">${x.vote === 1 ? '支持' : x.vote === -1 ? '反对' : '观望/弃权'}</span><span class="verdict-evidence">${esc(x.evidence)}</span></div>
        <p>${esc(x.why)}</p></div></div>`).join('')}</div>
      <p class="prob-note">${icon('info')}专家意见来自蒸馏框架 + 本地快照/内置样本；未接入财报与公告时，价值类专家会弃权而不是编造理由。共识比例是「支持权重占比」，不是上涨概率。</p></div>`;
  }

  // ---------------------------------------------------------------- 自选股
  function watchlistSymbols() {
    return (state.watchlist || []).map(k => {
      const [cat, code] = k.split('|');
      return findSymbol(code, cat);
    }).filter(Boolean);
  }
  function watchBatch(horizon) {
    return watchlistSymbols().map(s => ({symbol: s, p: probabilityFor(s, horizon), verdicts: expertVerdicts(s, horizon)}));
  }
  function watchlistPage() {
    const rows = watchBatch(wlHorizon);
    const candidates = searchSymbols(wlAddQuery, '全部').filter(s => !state.watchlist.includes(symbolKey(s))).slice(0, 6);
    const detail = wlDetail ? rows.find(r => symbolKey(r.symbol) === wlDetail) : null;
    const avg = rows.filter(r => r.verdicts).length
      ? rows.reduce((n, r) => n + r.verdicts.share, 0) / rows.length : 0;
    return `<div class="page-heading"><div><div class="eyebrow">MY WATCHLIST</div><h1>自选股</h1>
      <p class="subtitle">自己挑的标的放在一起，用同一套量化信号与专家团队批量研判。</p></div>
      <div class="heading-actions"><select id="wl-horizon" class="filter-select" aria-label="自选股研判持有期">${Array.from({length: 20}, (_, i) => `<option value="${i + 1}" ${wlHorizon === i + 1 ? 'selected' : ''}>第 ${i + 1} 根</option>`).join('')}</select>
      <span class="pill">${rows.length} 只 · 平均共识 ${pct(avg, 0)}</span></div></div>
      <div class="watch-layout"><aside class="panel watch-add">
        <div class="panel-header"><h2>添加标的</h2><span class="meta">${num((DATA.symbols || []).length)}</span></div>
        <div class="watch-add-body"><label class="search-input">${icon('search')}<input id="wl-add-search" type="search" placeholder="代码或名称…" value="${esc(wlAddQuery)}" aria-label="搜索要加入自选的标的"></label>
        <div class="watch-candidates">${candidates.map(s => `<button class="cand-row" data-action="wl-add" data-key="${symbolKey(s)}"><span><strong>${esc(s.n)}</strong><small>${s.c} · ${s.k}</small></span>${icon('plus')}</button>`).join('') || (wlAddQuery ? empty('没有匹配', '换个代码或名称。') : `<p class="rail-note">输入代码或名称即可加入。也可以先到「量化概率」看某只标的，再点「加入自选」。</p>`)}</div></div>
        <div class="watch-list-head">当前自选 <span>${rows.length}</span></div>
        <div class="watch-list">${rows.map(r => `<div class="watch-row ${wlDetail === symbolKey(r.symbol) ? 'selected' : ''}">
          <button class="watch-row-main" data-action="wl-detail" data-key="${symbolKey(r.symbol)}"><strong>${esc(r.symbol.n)}</strong><small>${r.symbol.c} · ${r.symbol.k}</small></button>
          <button class="icon-button" data-action="wl-remove" data-key="${symbolKey(r.symbol)}" aria-label="移出自选">${icon('close')}</button></div>`).join('') || empty('自选还是空的', '从左侧搜索并加入。')}</div>
      </aside>
      <section class="watch-main">
        ${rows.length ? `<div class="panel watch-table-panel"><div class="panel-header"><h2>批量研判 · 第 ${wlHorizon} 根</h2><span class="meta">量化信号 + 专家共识</span></div>
          <div class="table-scroll"><table class="data-table watch-table"><thead><tr><th>标的</th><th>量化方向</th><th class="num">历史命中率</th><th class="num">覆盖率</th><th class="num">专家共识</th><th>支持 / 观望 / 反对</th><th></th></tr></thead><tbody>
          ${rows.map(r => { const v = r.verdicts; const p = r.p; return `<tr class="${wlDetail === symbolKey(r.symbol) ? 'on' : ''}">
            <td><strong>${esc(r.symbol.n)}</strong><small>${r.symbol.c} · ${r.symbol.k}</small></td>
            <td><span class="pill ${p && p.direction === 1 ? 'red' : p && p.direction === -1 ? 'green' : ''}">${p ? (p.direction === 1 ? '上涨' : p.direction === -1 ? '下跌' : '中性') : '—'}</span></td>
            <td class="num">${p && p.probability !== null ? pct(p.probability, 2) : '<span class="muted">无信号</span>'}</td>
            <td class="num">${p ? pct(p.coverage, 1) : '—'}</td>
            <td class="num"><b>${pct(v.share, 0)}</b></td>
            <td><span class="verdict-mini"><i class="up" style="width:${v.up / Math.max(1, v.votes.length) * 100}%"></i><i class="flat" style="width:${v.flat / Math.max(1, v.votes.length) * 100}%"></i><i class="down" style="width:${v.down / Math.max(1, v.votes.length) * 100}%"></i></span><small class="muted">${v.up} / ${v.flat} / ${v.down}</small></td>
            <td><button class="text-button" data-action="journal-new-symbol" data-key="${symbolKey(r.symbol)}">记录</button><button class="text-button" data-action="wl-detail" data-key="${symbolKey(r.symbol)}">展开 ${icon('chevron-right')}</button></td></tr>`; }).join('')}
          </tbody></table></div>
          <p class="prob-note">${icon('info')}量化命中率是截止 ${esc(DATA.snapshot)} 的内样本频率；共识是支持权重占比。价值类专家在没有财报时弃权。</p></div>
          ${detail && detail.p ? verdictPanel(detail.symbol, detail.verdicts, detail.p) : ''}`
        : `<div class="panel">${empty('先往自选里放几只标的', '加入后，这里会用同一持有期批量给出量化方向与专家共识，并可展开逐位专家的理由。')}</div>`}
      </section></div>`;
  }

  // ---------------------------------------------------------------- 操盘记录页
  function journalRows() {
    return (state.journal || []).slice().sort((a, b) => (a.time < b.time ? 1 : -1))
      .filter(r => (journalFilter === 'all' || (journalFilter === 'open' ? !r.closed : r.closed))
        && (journalExpert === 'all' || r.expert === journalExpert));
  }
  function journalConflict(r) {
    const side = ACTION_SIDE[r.action];
    if (!side || !r.direction) return false;
    return side > 0 ? r.direction < 0 : r.direction > 0;
  }
  function journalDrift(r) {
    const symbol = findSymbol(r.code, r.category);
    if (!symbol) return {label: '标的不在快照', cls: 'muted'};
    const now = probabilityFor(symbol, r.horizon);
    if (!now) return {label: '无模型', cls: 'muted'};
    if (!r.direction) return {label: now.direction ? '现在有信号了' : '仍无信号', cls: 'muted'};
    if (now.direction === 0) return {label: '信号已消失', cls: 'amber'};
    return now.direction === r.direction
      ? {label: '方向仍一致', cls: 'green'}
      : {label: '方向已反转', cls: 'red'};
  }
  function journalPage() {
    const rows = journalRows();
    const open = state.journal.filter(r => !r.closed).length;
    const experts = [...new Set(state.journal.map(r => r.expert))];
    return `<div class="page-heading"><div><div class="eyebrow">TRADING JOURNAL</div><h1>操盘记录</h1>
      <p class="subtitle">专家选股与买卖的当时理由都记在这里；以后复盘时能看到「当时怎么想」和「信号后来怎么变」。</p></div>
      <div class="heading-actions"><button class="btn" data-action="journal-export">${icon('download')}导出记录</button>
      <button class="btn btn-primary" data-action="journal-new">${icon('plus')}记录一笔</button></div></div>
      <div class="metrics journal-metrics">
        <div class="metric"><div class="metric-label">${icon('file')}全部记录</div><div class="metric-number">${String(state.journal.length).padStart(2, '0')}</div><div class="metric-note">本地保存</div></div>
        <div class="metric"><div class="metric-label">${icon('clock')}持仓中</div><div class="metric-number">${String(open).padStart(2, '0')}</div><div class="metric-note">尚未平仓</div></div>
        <div class="metric"><div class="metric-label">${icon('users')}参与专家</div><div class="metric-number">${String(experts.length).padStart(2, '0')}</div><div class="metric-note">${experts.slice(0, 3).map(esc).join('、') || '—'}</div></div>
        <div class="metric"><div class="metric-label">${icon('chart')}复盘收益</div><div class="metric-number">${(() => { const rs = state.journal.map(journalReturn).filter(v => v !== null); return rs.length ? pct(rs.reduce((a, b) => a + b, 0) / rs.length, 2) : '—'; })()}</div><div class="metric-note">仅统计已填写买入与现价的记录</div></div>
      </div>
      <div class="toolbar"><div class="segmented">${[['all', '全部'], ['open', '持仓中'], ['closed', '已平仓']].map(([v, t]) => `<button data-action="journal-filter" data-filter="${v}" class="${journalFilter === v ? 'active' : ''}">${t}</button>`).join('')}</div>
      <select id="journal-expert" class="filter-select" aria-label="按专家筛选"><option value="all">全部专家</option>${experts.map(x => `<option value="${esc(x)}" ${journalExpert === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <span class="compact-note">${rows.length} 条记录 · 复盘对比的是「现在的信号」，不是真实盈亏</span></div>
      <div class="panel table-panel"><div class="table-scroll"><table class="data-table journal-table"><thead><tr>
        <th>时间</th><th>标的</th><th>动作</th><th>专家</th><th>当时信号</th><th>现在对比</th><th class="num">复盘收益</th><th></th></tr></thead><tbody>
        ${rows.map(r => { const drift = journalDrift(r); const ret = journalReturn(r); return `<tr class="journal-row ${r.closed ? 'closed' : ''}">
          <td class="mono muted small">${esc(r.time)}</td>
          <td><button class="text-button" data-action="journal-detail" data-id="${esc(r.id)}"><strong>${esc(r.name)}</strong></button><small>${esc(r.code)} · ${esc(r.category)}</small></td>
          <td><span class="pill ${ACTION_SIDE[r.action] > 0 ? 'red' : ACTION_SIDE[r.action] < 0 ? 'green' : ''}">${ACTIONS[r.action]}</span>${journalConflict(r) ? '<small class="conflict">与量化方向相反</small>' : ''}</td>
          <td>${esc(r.expert)}</td>
          <td><span class="pill">第 ${r.horizon} 根 · ${r.direction === 1 ? '上涨' : r.direction === -1 ? '下跌' : '中性'}</span>${r.accuracy !== null ? `<small>命中 ${pct(r.accuracy, 1)}</small>` : ''}</td>
          <td><span class="pill ${drift.cls}">${drift.label}</span></td>
          <td class="num">${ret === null ? '<span class="muted">待填价格</span>' : `<b class="${ret >= 0 ? 'positive' : 'negative'}">${(ret * 100).toFixed(2)}%</b>`}</td>
          <td><button class="text-button" data-action="journal-detail" data-id="${esc(r.id)}">复盘 ${icon('chevron-right')}</button></td></tr>`; }).join('') || ''}
      </tbody></table></div>${rows.length ? '' : empty(state.journal.length ? '该筛选下没有记录' : '还没有操盘记录', state.journal.length ? '换个状态或专家筛选试试。' : '在「专家团队」或「自选股」里点「记录操盘」，当时的理由和信号会一起存下来。')}</div>`;
  }
  function journalDrawer(id) {
    const r = state.journal.find(x => x.id === id);
    if (!r) return;
    const drift = journalDrift(r);
    const ret = journalReturn(r);
    drawerKind = 'journal'; drawerDraft = null; drawerOriginal = null;
    setDrawer(`复盘 · ${esc(r.name)}`, `${esc(r.code)} · ${esc(r.category)} · ${esc(r.time)}`,
      `<div class="drawer-content">
        <div class="badge-row"><span class="pill ${ACTION_SIDE[r.action] > 0 ? 'red' : ACTION_SIDE[r.action] < 0 ? 'green' : ''}">${ACTIONS[r.action]}</span>${journalConflict(r) ? '<span class="pill amber">与当时量化方向相反</span>' : ''}
          <span class="pill">${esc(r.expert)}</span><span class="pill">第 ${r.horizon} 根</span>
          <span class="pill ${drift.cls}">${drift.label}</span>${r.closed ? '<span class="pill">已平仓</span>' : ''}</div>
        <h3 class="drawer-section-title">当时的理由</h3>
        <p class="compact-note">${esc(r.reason)}</p>
        <div class="journal-votes">${r.votes.map(v => `<div class="journal-vote"><strong>${esc(v.name)}</strong><span class="pill ${v.vote === 1 ? 'green' : v.vote === -1 ? 'red' : ''}">${v.vote === 1 ? '支持' : v.vote === -1 ? '反对' : '观望'}</span><p>${esc(v.why)}</p></div>`).join('') || '<p class="compact-note">这条记录没有保存逐位专家意见。</p>'}</div>
        <h3 class="drawer-section-title">复盘：价格与结果</h3>
        <div class="form-grid"><div class="form-group"><label for="j-price">记录时价格</label><input id="j-price" type="number" step="0.0001" min="0" value="${r.price ?? ''}" placeholder="例如 38.50"></div>
        <div class="form-group"><label for="j-now">现在价格（手动填）</label><input id="j-now" type="number" step="0.0001" min="0" value="${r.nowPrice ?? ''}" placeholder="例如 41.20"></div></div>
        <div class="journal-return ${ret === null ? '' : ret >= 0 ? 'positive' : 'negative'}">${ret === null ? '填写两个价格后计算复盘收益' : `复盘收益 ${(ret * 100).toFixed(2)}%（${ACTION_SIDE[r.action] > 0 ? '做多' : '做空'}口径）`}</div>
        <p class="rail-note">没有接入实时行情，收益按你手动填写的价格计算；它只用于复盘判断，不是账户净值。</p>
        <div class="form-group" style="margin-top:14px"><label for="j-note">复盘备注</label><textarea id="j-note" rows="3" placeholder="后来发生了什么？当时的判断对不对？">${esc(r.note)}</textarea></div>
        <label class="tool-option"><span>标记为已平仓<small>平仓后不再计入持仓中</small></span><input type="checkbox" id="j-closed" ${r.closed ? 'checked' : ''}></label>
        <div class="button-group" style="margin-top:18px"><button class="btn btn-danger" data-action="journal-delete" data-id="${esc(r.id)}">${icon('trash')}删除记录</button></div>
      </div>`,
      `<div class="drawer-footer"><span class="save-hint">复盘不会改动历史记录的理由</span><button class="btn" data-action="close-drawer">取消</button><button class="btn btn-primary" data-action="journal-save" data-id="${esc(r.id)}">${icon('check')}保存复盘</button></div>`);
  }
  function journalFormDrawer(symbol) {
    if (!symbol) { toast('先选一只标的。', 'info'); return; }
    drawerKind = 'journal-new'; drawerDraft = null; drawerOriginal = null;
    const v = expertVerdicts(symbol, wlHorizon);
    setDrawer('记录一笔操盘', `${esc(symbol.n)} · ${esc(symbol.c)} · ${esc(symbol.k)}`,
      `<div class="drawer-content"><div class="notice-box">这里记录的是「当时的判断」。价格可以先留空，复盘时再填；没有实时行情，不计算真实盈亏。</div>
        <div class="form-group"><label for="j-action">动作</label><select id="j-action">${Object.entries(ACTIONS).map(([k, t]) => `<option value="${k}" ${k === 'buy' ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="form-grid"><div class="form-group"><label for="j-horizon">持有期</label><select id="j-horizon">${Array.from({length: 20}, (_, i) => `<option value="${i + 1}" ${wlHorizon === i + 1 ? 'selected' : ''}>第 ${i + 1} 根</option>`).join('')}</select></div>
        <div class="form-group"><label for="j-price2">记录时价格（可留空）</label><input id="j-price2" type="number" step="0.0001" min="0" placeholder="可选"></div></div>
        <div class="form-group"><label for="j-reason">当时的理由</label><textarea id="j-reason" rows="4">${esc(`专家共识 ${pct(v.share, 0)}，支持 ${v.up} / 观望 ${v.flat} / 反对 ${v.down}。`)}</textarea></div>
        <p class="rail-note">保存时会自动附上当时的量化方向与逐位专家意见快照，之后不会被改写。</p></div>`,
      `<div class="drawer-footer"><span class="save-hint">${state.experts.filter(e => e.enabled).length} 位专家参与</span><button class="btn" data-action="close-drawer">取消</button><button class="btn btn-primary" data-action="journal-create" data-code="${esc(symbol.c)}" data-cat="${esc(symbol.k)}">${icon('check')}保存记录</button></div>`);
  }

  // ---------------------------------------------------------------- 插件页
  function customPluginPage(plugin) {
    if (!plugin) return empty('插件不存在', '它可能已被删除。');
    return `<div class="page-heading"><div><div class="eyebrow">PLUGIN</div><h1>${esc(plugin.name)}</h1>
      <p class="subtitle">由 Super Agent 安装的演示插件：结构、排序、启停都会保存，但数据源尚未接入。</p></div>
      <div class="heading-actions"><button class="btn" data-action="plugin-manager">${icon('sliders')}插件管理</button></div></div>
      <div class="panel plugin-blank"><div class="plugin-blank-body">
        <div class="plugin-blank-icon">${icon(plugin.icon)}</div>
        <h2>${esc(plugin.name)} 已安装</h2>
        <p>这是一个自定义插件槽位。真实插件需要提供数据源与渲染器；当前版本只演示「Super Agent 可以改造工作台」这一层。</p>
        <div class="kv"><span>插件 ID</span><b class="mono">${esc(plugin.id)}</b></div>
        <div class="kv"><span>类型</span><b>自定义</b></div>
        <div class="kv"><span>状态</span><b>${plugin.enabled ? '已启用' : '已停用'}</b></div>
        <div class="button-group" style="margin-top:16px">
          <button class="btn" data-action="plugin-rename" data-id="${plugin.id}">${icon('sliders')}重命名</button>
          <button class="btn btn-danger" data-action="plugin-remove" data-id="${plugin.id}">${icon('trash')}删除插件</button>
        </div></div></div>`;
  }

  // ---------------------------------------------------------------- 抽屉
  function setDrawer(title, subtitle, body, footer = '', headAvatar = '') {
    const d = document.getElementById('drawer');
    if (d.hidden) returnFocus = document.activeElement;
    document.getElementById('overlay').hidden = false;
    d.hidden = false;
    d.innerHTML = `<div class="drawer-head">${headAvatar}<div><h2 id="drawer-title">${title}</h2><p>${subtitle}</p></div>
      <button class="icon-button" data-action="close-drawer" aria-label="关闭">${icon('close')}</button></div>${body}${footer}`;
    d.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
    document.querySelector('.app-shell').inert = true;
    setTimeout(() => { if (!d.hidden && !d.contains(document.activeElement)) d.querySelector('input,select,textarea,button')?.focus(); }, 0);
  }
  function closeDrawer() {
    const d = document.getElementById('drawer');
    d.hidden = true; document.getElementById('overlay').hidden = true;
    document.querySelector('.app-shell').inert = false;
    drawerKind = null; drawerDraft = null; drawerOriginal = null;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  }
  function requestClose(after) { closeDrawer(); after?.(); }
  function pluginManager() {
    drawerKind = 'plugins'; drawerDraft = null; drawerOriginal = null;
    setDrawer('管理工作台插件', '万物皆插件：增删、启停、排序都会保存到本机。',
      `<div class="drawer-content"><div class="plugin-add"><input id="plugin-name" placeholder="新插件名称，例如 龙虎榜" maxlength="30"><button class="btn btn-primary" data-action="plugin-create">${icon('plus')}添加</button></div>
      <p class="rail-note">内置插件只能停用，不能删除；自定义插件可随时移除。</p>
      <div class="plugin-list">${state.plugins.map((p, i) => `<div class="plugin-row">
        <span class="plugin-row-icon">${icon(p.icon)}</span>
        <span class="plugin-row-name"><strong>${esc(p.name)}</strong><small>${p.kind === 'custom' ? '自定义 · 数据源未接入' : '内置'} · 顺序 ${i + 1}</small></span>
        <button class="icon-button" data-action="plugin-up" data-id="${p.id}" ${i === 0 ? 'disabled' : ''} aria-label="上移">${icon('chevron-down')}</button>
        <button class="icon-button" data-action="plugin-down" data-id="${p.id}" ${i === state.plugins.length - 1 ? 'disabled' : ''} aria-label="下移">${icon('chevron-right')}</button>
        <button class="switch" role="switch" aria-checked="${p.enabled}" data-action="plugin-toggle" data-id="${p.id}" aria-label="${p.enabled ? '停用' : '启用'}${esc(p.name)}"></button>
        ${p.kind === 'custom' ? `<button class="icon-button" data-action="plugin-remove" data-id="${p.id}" aria-label="删除${esc(p.name)}">${icon('trash')}</button>` : ''}
      </div>`).join('')}</div>
      <p class="rail-note">也可以在对话里直接说「添加插件 龙虎榜」。插件是真实状态，但演示插件没有数据源。</p></div>`,
      `<div class="drawer-footer"><span class="save-hint">最多 16 个插件</span><button class="btn" data-action="close-drawer">完成</button></div>`);
  }
  function conversationList() {
    drawerKind = 'conversations'; drawerDraft = null; drawerOriginal = null;
    setDrawer('历史对话', '对话保存在这台浏览器。', `<div class="drawer-content"><div class="conversation-list">${state.conversations.map(c => `<div class="conversation-history-row">
      <button data-action="switch-conversation" data-id="${esc(c.id)}"><strong>${esc(c.title)}</strong><small>${c.messages.length} 条消息 · ${esc(c.updated || '尚未发送')}</small></button>
      ${c.id === state.activeConversationId ? '<span class="pill green">当前</span>' : `<button class="icon-button" data-action="delete-conversation" data-id="${esc(c.id)}" aria-label="删除">${icon('trash')}</button>`}
    </div>`).join('')}</div></div>`, `<div class="drawer-footer"><span class="save-hint">新建不会清空旧对话</span><button class="btn btn-primary" data-action="new-chat">${icon('plus')}新建对话</button></div>`);
  }
  function editExpert(id) {
    const e = state.experts.find(x => x.id === id); if (!e) return;
    drawerKind = 'expert'; drawerDraft = clone(e); drawerOriginal = JSON.stringify(e);
    renderExpertDrawer();
  }
  function renderExpertDrawer() {
    const d = drawerDraft;
    setDrawer(`配置专家 · ${esc(d.name)}`, '决定函数、权重与可用证据；保存后参与下一次研判。',
      `<form id="expert-form" class="drawer-form" novalidate><div class="drawer-content"><div id="form-error" class="form-error" hidden></div>
        <div class="form-group"><label for="ef-name">显示名称</label><input id="ef-name" name="name" value="${esc(d.name)}" maxlength="24" required></div>
        <div class="form-grid"><div class="form-group"><label for="ef-tag">风格标签</label><input id="ef-tag" name="tag" value="${esc(d.tag)}" maxlength="40"></div>
        <div class="form-group"><label for="ef-weight">投票权重</label><div class="range-row"><input id="ef-weight" name="weight" type="range" min="0.1" max="3" step="0.1" value="${d.weight}"><output>${Number(d.weight).toFixed(1)}×</output></div></div></div>
        <div class="form-group"><label for="ef-desc">研究简介</label><textarea id="ef-desc" name="desc" rows="3" maxlength="4000">${esc(d.desc)}</textarea></div>
        <div class="form-group"><label for="ef-basis">判断依据（一行一条）</label><textarea id="ef-basis" name="basis" rows="4" maxlength="4000">${esc(d.basis)}</textarea></div>
        <div class="form-group"><label for="ef-flaw">已知缺陷 / 弃权条件</label><textarea id="ef-flaw" name="flaw" rows="3" maxlength="3000">${esc(d.flaw)}</textarea></div>
        <div class="form-group"><label for="ef-enabled">启用</label><select id="ef-enabled" name="enabled"><option value="true" ${d.enabled ? 'selected' : ''}>启用</option><option value="false" ${!d.enabled ? 'selected' : ''}>停用</option></select></div>
        <div class="notice-box">模型未连接：这里只保存决策框架，不会发起在线推理。</div></div>
        <div class="drawer-footer"><button type="button" class="btn" data-action="close-drawer">取消</button><button type="submit" class="btn btn-primary">${icon('check')}保存</button></div></form>`,
      '', `<span class="avatar" style="background:${d.bg};color:${d.color}">${esc(d.initial)}</span>`);
  }
  function saveExpert() {
    const d = drawerDraft;
    if (!d.name.trim()) { document.getElementById('form-error').hidden = false; document.getElementById('form-error').textContent = '专家名称不能为空。'; return; }
    state.experts = state.experts.map(e => e.id === d.id ? {...e, ...d} : e);
    closeDrawer(); persist(); render(); toast('专家设置已保存。');
  }
  function helpModal() {
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="modal-body"><h2 id="modal-title">这是一个可以被对话改造的工作台</h2>
      <p>① Super Agent 是唯一入口：说「添加插件 龙虎榜」就会真的多一个插件页面。<br>
      ② 量化概率：选标的和持有期/日期，看历史规则给出的方向概率。<br>
      ③ 专家团队：多位蒸馏专家独立研判，缺证据就弃权。<br>
      ④ 自选股：自己挑标的，按同一持有期批量看量化信号与专家共识。<br>
      ⑤ 操盘记录：把专家选股与买卖的理由存下来，以后复盘对比信号变化。<br><br>
      数据来自 2026-11-05 的全历史拟合快照，是内样本频率；模型、财报与行情均未接入，不会下单。</p></div>
      <div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">知道了</button></div>`;
    m.showModal();
  }

  // ---------------------------------------------------------------- 事件
  function onClick(event) {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action, id = el.dataset.id, key = el.dataset.key;
    const handlers = {
      'starter': () => {
        if (el.dataset.starter === 'quant') navigate('p-quant');
        else if (el.dataset.starter === 'experts') navigate('p-experts');
        else if (el.dataset.starter === 'history') conversationList();
        else pluginManager();
      },
      'nav': () => navigate(el.dataset.view),
      'toggle-nav': () => { const s = document.getElementById('sidebar'); const open = s.classList.toggle('open'); document.querySelector('.mobile-scrim').hidden = !open; },
      'close-nav': () => { document.getElementById('sidebar').classList.remove('open'); document.querySelector('.mobile-scrim').hidden = true; },
      'new-chat': () => { if (drawerKind) closeDrawer(); newConversation(); },
      'open-experts': () => navigate('p-experts'),
      'conversation-list': conversationList,
      'switch-conversation': () => { if (switchConversationState(state, id)) { persist(); if (drawerKind) closeDrawer(); navigate('chat'); } },
      'delete-conversation': () => { state.conversations = state.conversations.filter(c => c.id !== id); persist(); conversationList(); render(); },
      'plugin-manager': pluginManager,
      'plugin-create': () => {
        const input = document.getElementById('plugin-name');
        try { state = pluginAdd(state, input?.value || ''); persist(); pluginManager(); updateChrome(); render(); toast('插件已添加。'); }
        catch (e) { toast(e.message, 'info'); }
      },
      'plugin-toggle': () => {
        const p = state.plugins.find(x => x.id === id);
        try { state = pluginToggle(state, id, !p.enabled); persist(); pluginManager(); render(); }
        catch (e) { toast(e.message, 'info'); }
      },
      'plugin-up': () => { state = pluginMove(state, id, -1); persist(); pluginManager(); render(); },
      'plugin-down': () => { state = pluginMove(state, id, 1); persist(); pluginManager(); render(); },
      'plugin-remove': () => { try { state = pluginRemove(state, id); persist(); if (currentView === 'p-' + id) navigate('chat'); else { pluginManager(); render(); } } catch (e) { toast(e.message, 'info'); } },
      'plugin-rename': () => {
        const p = state.plugins.find(x => x.id === id);
        const name = prompt('插件名称', p?.name || '');
        if (!name || !name.trim()) return;
        state.plugins = state.plugins.map(x => x.id === id ? {...x, name: name.trim().slice(0, 30)} : x);
        persist(); render();
      },
      'toggle-expert': () => {
        const e = state.experts.find(x => x.id === id);
        if (e.enabled && state.experts.filter(x => x.enabled).length === 1) { toast('至少保留一位启用的专家。', 'info'); return; }
        state.experts = state.experts.map(x => x.id === id ? {...x, enabled: !x.enabled} : x);
        persist(); render();
      },
      'edit-expert': () => editExpert(id || state.experts[0].id),
      'journal-new': () => journalFormDrawer(qSymbol || eSymbol || findSymbol('601088')),
      'journal-create': () => {
        const symbol = findSymbol(el.dataset.code, el.dataset.cat);
        if (!symbol) return;
        const action = document.getElementById('j-action').value;
        const horizon = Number(document.getElementById('j-horizon').value);
        const price = Number(document.getElementById('j-price2').value);
        const reason = document.getElementById('j-reason').value;
        state.journal.unshift(journalCreate(symbol, action, {horizon, price, reason}));
        log(`记录操盘 · ${ACTIONS[action]} ${symbol.n}`);
        persist(); closeDrawer(); render(); toast('已记录，之后可以复盘。');
      },
      'journal-detail': () => journalDrawer(id),
      'journal-save': () => {
        const record = state.journal.find(x => x.id === id);
        if (!record) return;
        const price = Number(document.getElementById('j-price').value);
        const now = Number(document.getElementById('j-now').value);
        record.price = Number.isFinite(price) && price > 0 ? price : null;
        record.nowPrice = Number.isFinite(now) && now > 0 ? now : null;
        record.note = document.getElementById('j-note').value.slice(0, 1000);
        record.closed = document.getElementById('j-closed').checked;
        persist(); closeDrawer(); render(); toast('复盘已保存。');
      },
      'journal-delete': () => {
        state.journal = state.journal.filter(x => x.id !== id);
        persist(); closeDrawer(); render(); toast('记录已删除。');
      },
      'journal-filter': () => { journalFilter = el.dataset.filter; render(); },
      'journal-export': () => download({journal: state.journal}, 'super-trader-journal.json'),
      'journal-to-experts': () => navigate('p-experts'),
      'journal-new-symbol': () => journalFormDrawer((DATA.symbols || []).find(x => symbolKey(x) === key)),
      'wl-add': () => addWatch(key),
      'wl-add-current': () => addWatch(symbolKey(currentView === 'p-quant' ? qSymbol : eSymbol)),
      'wl-remove': () => removeWatch(key),
      'wl-detail': () => { wlDetail = wlDetail === key ? '' : key; render(); },
      'q-pick': () => { qSymbol = (DATA.symbols || []).find(s => symbolKey(s) === key) || qSymbol; render(); },
      'q-type': () => { qCategory = el.dataset.type; qPage = 1; render(); },
      'q-prev': () => { qPage--; render(); },
      'q-next': () => { qPage++; render(); },
      'q-horizon': () => { qHorizon = Number(el.dataset.h); qDate = ''; render(); },
      'e-pick': () => { eSymbol = (DATA.symbols || []).find(s => symbolKey(s) === key) || eSymbol; render(); },
      'e-prev': () => { ePage--; render(); },
      'e-next': () => { ePage++; render(); },
      'close-drawer': () => requestClose(),
      'close-modal': () => document.getElementById('modal').close(),
      'help': helpModal,
      'activity': () => setDrawer('活动记录', '只记录本机操作。', `<div class="drawer-content"><div class="timeline">${state.activity.length ? state.activity.map(a => `<div class="timeline-item"><time>${esc(a.time)}</time><p>${esc(a.text)}</p></div>`).join('') : empty('还没有记录', '改插件或保存设置后会出现在这里。')}</div></div>`),
      'command': commandModal
    };
    const fn = handlers[a];
    if (fn) { event.preventDefault(); fn(); }
  }
  function onInput(event) {
    const t = event.target;
    if (t.id === 'chat-input') { const c = currentConversation(); if (c) { c.draft = t.value.slice(0, 1500); persist(); } }
    if (t.id === 'wl-add-search') { wlAddQuery = t.value; refreshWatchCandidates(); }
    if (t.id === 'q-search') { qQuery = t.value; qPage = 1; refreshQuantList(); }
    if (t.id === 'e-search') { eQuery = t.value; ePage = 1; refreshCandList(); }
    if (t.closest('#drawer') && t.name === 'weight') { const out = t.closest('.range-row')?.querySelector('output'); if (out) out.textContent = Number(t.value).toFixed(1) + '×'; drawerDraft.weight = Number(t.value); }
  }
  function onChange(event) {
    const t = event.target;
    if (t.id === 'q-horizon-select') { qHorizon = Number(t.value); render(); }
    if (t.id === 'e-horizon') { eHorizon = Number(t.value); render(); }
    if (t.id === 'wl-horizon') { wlHorizon = Number(t.value); wlDetail = ''; render(); }
    if (t.id === 'journal-expert') { journalExpert = t.value; render(); }
    if (t.id === 'q-date') {
      qDate = t.value; const days = tradingDaysAhead(qDate, DATA.snapshot);
      if (days !== null && days >= 1 && days <= 20) { qHorizon = days; render(); }
      else { render(); toast('该日期超出 1–20 个交易日范围，请直接选持有期。', 'info'); }
    }
    if (t.closest('#drawer')) {
      const n = t.name;
      if (n === 'name') drawerDraft.name = t.value;
      if (n === 'tag') drawerDraft.tag = t.value;
      if (n === 'desc') drawerDraft.desc = t.value;
      if (n === 'basis') drawerDraft.basis = t.value;
      if (n === 'flaw') drawerDraft.flaw = t.value;
      if (n === 'enabled') drawerDraft.enabled = t.value === 'true';
    }
  }
  function onSubmit(event) {
    if (event.target.id === 'chat-form') { event.preventDefault(); sendMessage(document.getElementById('chat-input').value); }
    if (event.target.id === 'expert-form') { event.preventDefault(); saveExpert(); }
  }
  function onKey(event) {
    if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(event.target.value); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); commandModal(); return; }
    if (event.key === 'Escape' && drawerKind && !document.getElementById('modal').open) { event.preventDefault(); requestClose(); }
  }
  function commandModal() {
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="command-box"><label class="search-input" style="border:0">${icon('search')}<input id="command-input" placeholder="跳转到插件或执行操作…" autocomplete="off"><kbd>ESC</kbd></label></div>
      <div class="command-items" id="command-items">${commandItems('')}</div>`;
    m.showModal();
    document.getElementById('command-input').focus();
  }
  function commandItems(q) {
    const items = [{label: 'Super Agent 主页', action: 'nav', view: 'chat'}]
      .concat(state.plugins.filter(p => p.enabled).map(p => ({label: p.name, action: 'nav', view: 'p-' + p.id})))
      .concat([{label: '管理工作台插件', action: 'plugin-manager'}, {label: '历史对话', action: 'conversation-list'}]);
    return items.filter(i => i.label.includes(q)).map(i => `<button class="command-item" data-action="${i.action}" ${i.view ? `data-view="${i.view}"` : ''}>${icon('chevron-right')}<span>${esc(i.label)}</span></button>`).join('') || empty('没有匹配项', '试试插件名或「插件」。');
  }

  // ---------------------------------------------------------------- 导出给测试
  globalThis.__wb = {
    defaultState, validateState, pluginAdd, pluginRemove, pluginToggle, pluginMove,
    probabilityFor, bestHorizon, tradingDaysAhead, searchSymbols, findSymbol, symbolKey,
    verdictFor, expertVerdicts, FIXTURES, EXPERT_SEEDS,
    journalCreate, journalReturn, normalizeJournal, ACTIONS, ACTION_SIDE,
    getState: () => state, setState: v => { state = v; },
    setLead: () => {}, data: DATA
  };
  function addWatch(k) {
    if (!k || k === 'undefined') return;
    if (state.watchlist.includes(k)) { toast('已经在自选里了。', 'info'); return; }
    if (state.watchlist.length >= 200) { toast('自选最多 200 只。', 'info'); return; }
    state.watchlist = [...state.watchlist, k];
    log('加入自选 · ' + k);
    persist(); render(); toast('已加入自选股。');
  }
  function removeWatch(k) {
    state.watchlist = state.watchlist.filter(x => x !== k);
    if (wlDetail === k) wlDetail = '';
    log('移出自选 · ' + k);
    persist(); render();
  }
  function refreshWatchCandidates() {
    const host = document.querySelector('.watch-candidates');
    if (!host) return;
    const list = searchSymbols(wlAddQuery, '全部').filter(s => !state.watchlist.includes(symbolKey(s))).slice(0, 6);
    host.innerHTML = list.map(s => `<button class="cand-row" data-action="wl-add" data-key="${symbolKey(s)}"><span><strong>${esc(s.n)}</strong><small>${s.c} · ${s.k}</small></span>${icon('plus')}</button>`).join('')
      || (wlAddQuery ? empty('没有匹配', '换个代码或名称。') : `<p class="rail-note">输入代码或名称即可加入。</p>`);
  }
  function empty(title, text) { return `<div class="empty-state">${icon('layers')}<h3>${title}</h3><p>${text}</p></div>`; }

  if (HAS_DOM) boot();
})();
