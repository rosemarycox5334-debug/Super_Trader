import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createLifecycle, watchJob } from '../lib/pages/lifecycle.js';

const bundle = await readFile(new URL('../lib/pages-bundle.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/styles.css', import.meta.url), 'utf8');
const original = await readFile(new URL('../../web/app/assets/app.js', import.meta.url), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));

function jobHarness(overrides = {}) {
  let source, closed = 0, calls = 0;
  const controller = new AbortController();
  const jobs = [], errors = [], timers = new Map(); let next = 0;
  class Source { constructor(url) { this.url = url; source = this; } close() { closed++; } }
  const stop = watchJob({ url: '/proxy/api/jobs/1/stream', signal: controller.signal,
    EventSourceImpl: Source, get: async () => { calls++; return { status: 'running', progress: 1, total: 2 }; },
    onJob: job => jobs.push(job), onError: error => errors.push(error.message),
    schedule: fn => { timers.set(++next, fn); return next; }, unschedule: id => timers.delete(id), ...overrides });
  return { get source() { return source; }, get calls() { return calls; }, get closed() { return closed; }, controller, jobs, errors, timers, stop };
}

test('SSE progress and all terminal statuses close without polling', () => {
  for (const status of ['done', 'error', 'cancelled', 'interrupted']) {
    const h = jobHarness();
    assert.equal(h.source.url, '/proxy/api/jobs/1/stream');
    h.source.onmessage({ data: JSON.stringify({ status: 'running', progress: 1, total: 2 }) });
    h.source.onmessage({ data: JSON.stringify({ status, progress: 2, total: 2 }) });
    assert.equal(h.jobs.length, 2); assert.equal(h.calls, 0); assert.equal(h.closed, 1); assert.equal(h.timers.size, 0);
  }
});
test('SSE error closes stream, starts one polling chain, and abort clears timer', async () => {
  const h = jobHarness(); h.source.onerror(); h.source.onerror(); await turn();
  assert.equal(h.calls, 1); assert.equal(h.timers.size, 1); assert.match(h.errors[0], /轮询/);
  h.controller.abort(); assert.equal(h.timers.size, 0);
  h.source.onmessage({ data: '{"status":"done"}' }); assert.equal(h.jobs.length, 1);
});
test('malformed SSE falls back; poll HTTP errors remain visible and retry', async () => {
  const h = jobHarness({ get: async () => { throw new Error('HTTP 503'); } });
  h.source.onmessage({ data: '{invalid' }); await turn();
  assert.equal(h.errors.length, 2); assert.equal(h.errors[1], 'HTTP 503'); assert.equal(h.timers.size, 1); h.stop();
});
test('abort ignores an in-flight poll result and never schedules another', async () => {
  let resolve;
  const h = jobHarness({ get: () => new Promise(r => { resolve = r; }) });
  h.source.onerror(); h.controller.abort(); resolve({ status: 'done' }); await turn();
  assert.equal(h.jobs.length, 0); assert.equal(h.timers.size, 0);
});
test('EventSource constructor failure falls back and terminal poll closes', async () => {
  const h = jobHarness({ EventSourceImpl: class { constructor() { throw new Error('blocked'); } }, get: async () => ({ job: { status: 'done' } }) });
  await turn(); assert.equal(h.jobs[0].status, 'done'); assert.equal(h.timers.size, 0);
});
test('lifecycle abort owns cleanups and prevents delayed callbacks', async () => {
  const parent = new AbortController(); const life = createLifecycle(parent.signal); let calls = 0;
  life.own(() => calls++); life.later(() => calls += 10, 0); parent.abort(); life.stop(); await turn();
  assert.equal(life.signal.aborted, true); assert.equal(calls, 1);
});

// Minimal DOM contract fake, not a UI preview or a backend/network simulator.
class Node {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.nodeType = 1; this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this.listeners = {}; this.value = ''; this.textContent = ''; this.className = ''; this.disabled = false;
    this.classList = { add: x => { this.className += ' ' + x; }, remove: x => { this.className = this.className.split(' ').filter(y => y !== x).join(' '); }, contains: x => this.className.split(' ').includes(x) }; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  set innerHTML(value) { this.children = []; this._html = value; }
  get innerHTML() { return this._html || ''; }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'id') this.id = value; }
  addEventListener(type, fn, options) { (this.listeners[type] ||= []).push({ fn, options }); }
  async fire(type, extra = {}) { for (const { fn, options } of this.listeners[type] || []) if (!options?.signal?.aborted) await fn({ target: this, ...extra }); }
  querySelector(selector) { return this.all().find(node => selector.split(',').some(s => s.trim().startsWith('#') ? node.id === s.trim().slice(1) : node.tagName === s.trim().toUpperCase())) || null; }
  all() { return this.children.flatMap(n => [n, ...n.all()]); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  focus() {} click() { return this.fire('click'); }
}
function setup(fetch, globals = {}) {
  const doc = { createElement: tag => new Node(tag, doc), createTextNode: text => { const n = new Node('#text', doc); n.textContent = text; return n; } };
  const root = doc.createElement('main');
  const context = vm.createContext({ AbortController, DOMException, setTimeout, clearTimeout, URLSearchParams, fetch, ...globals });
  const createPages = vm.runInContext(bundle.replace('export function createPages', 'function createPages') + '\ncreatePages;', context);
  return { root, pages: createPages({ root, baseUrl: '/proxy' }), createPages, doc };
}
const response = data => ({ ok: true, text: async () => JSON.stringify(data) });
const button = (root, text) => root.all().find(n => n.tagName === 'BUTTON' && n.textContent === text);

test('bundle is self-contained, excludes non-page UI, retains original functions', () => {
  assert.doesNotMatch(bundle, /\bimport\s|document\.body|window\.|showModal\(|PAGES\.(chat|memory|declarative)|openPluginManager/);
  for (const name of ['renderProb', 'renderTeamResult', 'renderBatchItems', 'renderJournalItem', 'doReview', 'openJournalModal']) assert.match(bundle, new RegExp('function ' + name + '\\('));
  assert.match(bundle, /baseUrl \+ '\/api' \+ path/); assert.match(bundle, /baseUrl \+ '\/api\/jobs\//); assert.match(bundle, /baseUrl \+ '\/api\/journal\/export/);
});
test('four pages mount on demand without outer tabs; export links stay in proxy root', async () => {
  const requests = [];
  const h = setup(async (url, options) => { requests.push({ url, options }); return response(url.endsWith('/status') ? { model: { configured: true } } : { items: [], max: 200 }); });
  assert.equal(requests.length, 0);
  for (const id of ['quant', 'experts', 'watchlist', 'journal']) await h.pages.navigate(id);
  assert.equal(requests.every(r => r.url.startsWith('/proxy/api/')), true);
  assert.equal(h.root.all().some(n => n.tagName === 'NAV'), false);
  await button(h.root, '导出 CSV').click();
  assert.equal(h.root.all().some(n => n.tagName === 'A'), false);
  h.pages.dispose(); assert.equal(h.root.children.length, 0);
});
test('navigation and dispose abort previous fetches; stale response cannot change active page', async () => {
  let request, resolve;
  const h = setup((url, options) => { request = options; return new Promise(r => { resolve = r; }); });
  const first = h.pages.navigate('watchlist'); await h.pages.navigate('quant');
  assert.equal(request.signal.aborted, true);
  resolve(response({ items: [], max: 200 })); await first;
  assert.equal(h.root.all().some(n => n.textContent === '量化概率'), true);
  assert.equal(h.root.all().some(n => n.textContent === '还没有自选股，上方加入或在量化页一键加入。'), false);
  h.pages.dispose();
});
test('async event errors are visible and busy button prevents duplicate mutation', async () => {
  let release; let mutations = 0;
  const h = setup(async (url, options) => {
    if (options.method === 'POST') { mutations++; return new Promise(r => { release = r; }); }
    return response({ items: [], max: 200 });
  });
  await h.pages.navigate('watchlist');
  const input = h.root.all().find(n => n.attrs.placeholder === '代码 如 601088'); input.value = '601088';
  const join = button(h.root, '加入'); const first = join.click(); await join.click(); assert.equal(mutations, 1);
  release({ ok: false, text: async () => '{"detail":"explicit failure"}' }); await first;
  assert.equal(h.root.all().some(n => n.textContent.includes('explicit failure')), true); assert.equal(join.disabled, false); h.pages.dispose();
});
test('unknown page and initial HTTP error are explicitly rendered', async () => {
  const h = setup(async () => ({ ok: false, statusText: 'Unavailable', text: async () => '{"detail":"backend offline"}' }));
  await h.pages.navigate('watchlist'); assert.equal(h.root.all().some(n => n.textContent.includes('backend offline')), true);
  await h.pages.navigate('chat'); assert.equal(h.root.all().some(n => n.textContent.includes('未知页面')), true); h.pages.dispose();
});
test('batch action stays busy until terminal SSE and disposal closes source', async () => {
  let source, posts = 0, closed = 0;
  const h = setup(async (url, options) => {
    if (options.method === 'POST') { posts++; return response({ job: { id: 'job-1' } }); }
    return response({ items: [], max: 200 });
  }, { EventSource: class { constructor(url) { source = this; this.url = url; } close() { closed++; } } });
  await h.pages.navigate('watchlist'); const run = button(h.root, '批量研判'); const pending = run.click(); await turn();
  assert.equal(run.disabled, true); await run.click(); assert.equal(posts, 1);
  assert.equal(source.url, '/proxy/api/jobs/job-1/stream');
  source.onmessage({ data: JSON.stringify({ status: 'done', progress: 0, total: 0, result: { items: [] } }) });
  await pending; assert.equal(run.disabled, false); assert.equal(closed, 1); h.pages.dispose();
});
test('journal supplements price/note via existing PATCH without modifying frozen reasons', async () => {
  const item = { id: 'j1', symbol: { name: '神华', code: '601088' }, action: 'buy', expert: '团队', horizon: 10, created_at: '2026-11-13', reasons: { summary: '冻结理由' }, note: '旧备注' };
  let payload;
  const h = setup(async (url, options) => {
    if (options.method === 'PATCH') { assert.equal(url, '/proxy/api/journal/j1'); payload = JSON.parse(options.body); return response(item); }
    return response({ items: [item] });
  });
  await h.pages.navigate('journal'); await button(h.root, '补填 / 备注').click();
  const modal = h.root.querySelector('#modal'); assert.equal(modal.hidden, false);
  const price = modal.all().find(n => n.attrs.type === 'number'); price.value = '28.35';
  modal.querySelector('textarea').value = '新备注'; await button(h.root, '保存').click();
  assert.deepEqual(payload, { note: '新备注', price: 28.35 }); assert.equal(modal.hidden, true); h.pages.dispose();
});
test('parent abort disposes panel; same-origin proxy root is mandatory', () => {
  const h = setup(async () => response({})); const parent = new AbortController();
  const other = h.doc.createElement('div'); const pages = h.createPages({ root: other, baseUrl: '/proxy', signal: parent.signal });
  parent.abort(); assert.equal(other.children.length, 0); pages.dispose();
  assert.throws(() => h.createPages({ root: other, baseUrl: 'https://other.example' }), /same-origin/); h.pages.dispose();
});
const texts = root => root.all().map(n => n.textContent).join('\n');
const selected = (root, code = '601088', category = '个股') => { const select = root.all().find(n => n.tagName === 'SELECT'); select.value = code + '|' + category; return select; };
const quote = (code = '601088', extra = {}) => ({ code, name: '<img src=x onerror=alert(1)>', last_price: 28.35, price_change: -0.25, price_change_ratio_pct: -0.87, open_price: null, high_price: 29, low_price: 28, prev_price: 28.6, volume: 1000, turnover: 28350, timestamp: 0, ...extra });
const market = (items = [quote()], extra = {}) => ({ source: '同花顺 Financial-API', provider: 'hithink-finance', timestamp: 0, fetched_at: '2026-11-13T00:00:00Z', cached: true, cache_age_seconds: 2, items, missing: [], warnings: ['接口快照时间非成交/逐笔时间'], ...extra });
const probability = code => ({ symbol: { name: '样本', code }, direction: 1, probability: 0.68, baseline_up: 0.5, target: { horizon: 10 }, sample: { predictions: 100, coverage: 0.5 }, evaluation: { type: 'in_sample', calibrated: false }, method: 'test', source: 'grid' });

test('quant quote starts independently, preserves units/null/source/cache/Shanghai time and uses text nodes', async () => {
  const requests = []; let release;
  const h = setup(async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/quant/')) return new Promise(r => { release = r; });
    return response(market());
  });
  await h.pages.navigate('quant'); assert.equal(requests.length, 0);
  selected(h.root); await button(h.root, '查询').click(); await turn();
  assert.equal(requests.length, 2); assert.match(requests[0].url, /\/proxy\/api\/market\/quotes\?codes=601088/);
  let text = texts(h.root);
  for (const value of ['28.35', '-0.87%', '同花顺 Financial-API', '缓存：是', '（上海）', '历史内样本概率计算中', '—', '<img src=x onerror=alert(1)>']) assert.ok(text.includes(value), value);
  assert.equal(h.root.all().some(n => n.tagName === 'IMG'), false);
  assert.doesNotMatch(text, /-87.0%/);
  release(response(probability('601088'))); await turn();
  text = texts(h.root); assert.match(text, /68.0%/); assert.match(text, /历史内样本概率/); assert.match(text, /非校准的未来概率/);
  h.pages.dispose();
});
test('quote HTTP failure and probability failure remain independent; refresh never computes quant', async () => {
  let quoteCalls = 0, quantCalls = 0, failMarket = true;
  const h = setup(async url => {
    if (url.includes('/market/')) { quoteCalls++; return failMarket ? { ok: false, text: async () => '{"error":"missing credentials"}' } : response(market()); }
    quantCalls++; return failMarket ? response(probability('601088')) : { ok: false, text: async () => '{"error":"quant offline"}' };
  });
  await h.pages.navigate('quant'); selected(h.root); await button(h.root, '查询').click(); await turn();
  assert.match(texts(h.root), /行情查询失败：missing credentials/); assert.match(texts(h.root), /68.0%/);
  failMarket = false; await button(h.root, '查询').click(); await turn();
  assert.match(texts(h.root), /历史概率查询失败：quant offline/); assert.match(texts(h.root), /28.35/);
  await button(h.root, '刷新行情').click(); assert.equal(quoteCalls, 3); assert.equal(quantCalls, 2); h.pages.dispose();
});
test('rapid quant queries, selection changes and navigation never let old code overwrite new quotes/probability', async () => {
  const pending = [];
  const h = setup((url, options) => new Promise(resolve => pending.push({ url, options, resolve })));
  await h.pages.navigate('quant'); const select = selected(h.root); await button(h.root, '查询').click();
  select.value = '000001|个股'; await select.fire('change'); await button(h.root, '查询').click();
  assert.equal(pending.length, 4);
  pending[2].resolve(response(market([quote('000001', { name: '新标的' })]))); pending[3].resolve(response(probability('000001'))); await turn();
  pending[0].resolve(response(market([quote('601088', { name: '过期标的' })]))); pending[1].resolve(response(probability('601088'))); await turn();
  assert.match(texts(h.root), /新标的/); assert.doesNotMatch(texts(h.root), /过期标的|样本 · 601088/);
  select.value = '600000|个股'; await select.fire('change'); await button(h.root, '查询').click();
  await h.pages.navigate('quant');
  assert.equal(pending[4].options.signal.aborted, true);
  pending[4].resolve(response(market([quote('600000', { name: '离页过期' })]))); pending[5].resolve(response(probability('600000'))); await turn();
  assert.doesNotMatch(texts(h.root), /离页过期/); h.pages.dispose();
});
test('unsupported quant category makes no market call and missing/null snapshots never become zero', async () => {
  let calls = 0;
  const h = setup(async url => { if (url.includes('/market/')) { calls++; return response(market([], { timestamp: null, cached: false, missing: ['601088'] })); } return response(probability('000001')); });
  await h.pages.navigate('quant'); selected(h.root, '000001', '指数'); await button(h.root, '查询').click(); await turn();
  assert.equal(calls, 0); assert.match(texts(h.root), /暂不支持此分类/); assert.match(texts(h.root), /68.0%/);
  selected(h.root); await button(h.root, '刷新行情').click();
  assert.equal(calls, 1); assert.match(texts(h.root), /missing/); assert.match(texts(h.root), /未知（上游未提供）/); assert.match(texts(h.root), /缓存：否/); h.pages.dispose();
});
test('watchlist only explicitly refreshes first 50 A-share codes; each item has quote/missing/unsupported state', async () => {
  const items = Array.from({ length: 51 }, (_, i) => ({ code: String(600000 + i), name: '股票' + i, category: '个股' }));
  items.push({ code: '000001', name: '指数', category: '指数' }, { code: '510300', name: 'ETF', category: 'ETF' });
  const requests = [];
  const h = setup(async url => { requests.push(url); return response(url.includes('/market/') ? market([quote('600000')], { missing: ['600001'] }) : { items, max: 200 }); });
  await h.pages.navigate('watchlist'); assert.equal(requests.length, 1); assert.match(texts(h.root), /尚未刷新/); assert.match(texts(h.root), /unsupported/);
  await button(h.root, '刷新行情').click();
  assert.equal(requests.length, 2); const codes = new URL('http://local' + requests[1]).searchParams.get('codes').split(',');
  assert.equal(codes.length, 50); assert.equal(codes[0], '600000'); assert.equal(codes[49], '600049'); assert.match(texts(h.root), /本次仅前50条/);
  assert.match(texts(h.root), /missing/); assert.match(texts(h.root), /此标的未请求/); assert.match(texts(h.root), /28.35/); assert.match(texts(h.root), /缓存：是/);
  assert.equal(h.root.all().some(n => n.tagName === 'IMG'), false); h.pages.dispose();
});
test('watchlist empty/unsupported-only never fetch quotes and navigation aborts a quote request', async () => {
  let items = [], calls = 0, pending, quoteOptions;
  const h = setup(async (url, options) => {
    if (url.includes('/market/')) { calls++; quoteOptions = options; return new Promise(r => { pending = r; }); }
    return response({ items, max: 200 });
  });
  await h.pages.navigate('watchlist'); await button(h.root, '刷新行情').click(); assert.equal(calls, 0);
  items = [{ code: '000001', category: '指数' }]; await h.pages.navigate('watchlist'); await button(h.root, '刷新行情').click(); assert.equal(calls, 0);
  items = [{ code: '601088', category: '个股' }]; await h.pages.navigate('watchlist'); const first = button(h.root, '刷新行情').click(); await turn();
  await h.pages.navigate('quant'); assert.equal(quoteOptions.signal.aborted, true); pending(response(market())); await first;
  assert.doesNotMatch(texts(h.root), /28.35/); h.pages.dispose();
});
test('standalone navigation captures renderer and original quant uses relative independent market API', async () => {
  const h = setup(async () => response({}));
  const shell = h.doc.createElement('main');
  for (const id of ['workspace', 'sidebar', 'scrim', 'main-nav', 'page-title', 'toasts']) { const node = h.doc.createElement('div'); node.id = id; shell.append(node); }
  h.doc.querySelector = selector => shell.querySelector(selector); h.doc.addEventListener = () => {};
  const urls = []; const context = vm.createContext({ document: h.doc, setTimeout, clearTimeout, URLSearchParams, fetch: async url => { urls.push(url); return response(url.includes('/market/') ? market() : probability('601088')); } });
  const app = vm.runInContext(original.slice(0, original.indexOf('// ------------------------------------------------------------------ 启动')) + '\n({ navigate, state });', context);
  app.state.plugins = [{ id: 'q', kind: 'quant', name: '量化' }]; await app.navigate('q'); selected(shell); await button(shell, '查询').click(); await turn();
  assert.ok(urls.some(url => url === '/api/market/quotes?codes=601088')); assert.match(texts(shell), /28.35/); assert.match(texts(shell), /68.0%/);
  h.pages.dispose();
});

test('styles are root-scoped and all colors derive from approved host aliases', () => {
  assert.doesNotMatch(css, /:root|document|prefers-color-scheme|#[0-9a-f]{3,8}\b|rgba?\(/i);
  for (const rule of css.matchAll(/([^{}]+)\{/g)) {
    const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (selector.startsWith('@') || selector === 'to') continue;
    assert.equal(selector.split(',').every(s => s.trim().startsWith('.st-pages')), true, selector);
  }
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/); assert.match(css, /overflow-x: auto/); assert.match(css, /max-width: calc\(100% - 16px\)/);
});
