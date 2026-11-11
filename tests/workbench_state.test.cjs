'use strict';
// 依赖零第三方库：在无 DOM 的 vm 里加载会话工具与工作台脚本，验证状态层。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../web/workbench');
const plain = v => JSON.parse(JSON.stringify(v));

function snapshot() {
  const row = (prob, dir, base) => [prob, 400, dir, base, 300];
  const rows = Array.from({length: 20}, (_, i) => row(560 + i, i % 3 === 0 ? 0 : 1, 520));
  return {
    snapshot: '2026-11-05', generated_at: 'x',
    symbols: [
      ['601088', '个股', '中国神华', rows],
      ['600900', '个股', '长江电力', rows],
      ['000001', '指数', '上证指数', rows],
      ['000001', '个股', '平安银行', rows]
    ]
  };
}

function load(saved) {
  const helpers = fs.readFileSync(path.join(ROOT, 'conversation_helpers.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const storage = new Map();
  if (saved) storage.set('super-trader.workbench.v4', JSON.stringify(saved));
  const context = vm.createContext({
    __SNAPSHOT: snapshot(),
    localStorage: {getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v))}
  });
  vm.runInContext(helpers + '\n' + app, context, {timeout: 2000});
  return {...context.__wb, helpers: {
    normalize: context.normalizeConversationState, sync: context.syncConversationState,
    create: context.createConversationState, switchTo: context.switchConversationState, clean: context.cleanMessages
  }};
}

test('默认工作台只有 Super Agent 需要的两个插件与六位专家', () => {
  const wb = load();
  const s = wb.defaultState();
  assert.equal(s.schemaVersion, 4);
  assert.equal(s.plugins.map(p => p.kind).join(','), 'quant,experts,watchlist,journal');
  const names = s.experts.map(e => e.name);
  assert.ok(names.includes('巴菲特') && names.includes('段永平'), names.join(','));
  assert.equal(s.experts.length, 6);
});

test('配置往返保留插件顺序、启停与专家字段', () => {
  const wb = load();
  const s = plain(wb.defaultState());
  s.revision = 7;
  const reversed = s.plugins.slice().reverse();
  s.plugins = reversed.map((p, i) => ({...p, order: i, enabled: i === 0}));
  s.experts[0].name = '价值研究员';
  s.experts[0].weight = 2.4;
  const back = wb.validateState(plain(s));
  assert.equal(back.revision, 7);
  assert.equal(back.plugins.map(p => p.id).join(','), s.plugins.map(p => p.id).join(','));
  assert.equal(back.plugins[0].enabled, true);
  assert.equal(back.experts[0].name, '价值研究员');
  assert.equal(back.experts[0].weight, 2.4);
});

test('插件可以新增、拒绝重名、达到上限、删除内置被拒', () => {
  const wb = load();
  let s = wb.defaultState();
  s = wb.pluginAdd(s, '龙虎榜');
  assert.equal(s.plugins.length, 5);
  assert.equal(s.plugins[4].kind, 'custom');
  assert.throws(() => wb.pluginAdd(s, '龙虎榜'), /同名/);
  assert.throws(() => wb.pluginAdd(s, '   '), /不能为空/);
  assert.throws(() => wb.pluginRemove(s, 'quant'), /内置插件不能删除/);
  const removed = wb.pluginRemove(s, s.plugins[4].id);
  assert.equal(removed.plugins.length, 4);
  let many = s;
  for (let i = 0; i < 11; i++) many = wb.pluginAdd(many, '插件' + i);
  assert.equal(many.plugins.length, 16);
  assert.throws(() => wb.pluginAdd(many, '再多一个'), /最多/);
});

test('最后一个插件不能被停用', () => {
  const wb = load();
  let s = wb.defaultState();
  for (const id of ['experts', 'watchlist', 'journal']) s = wb.pluginToggle(s, id, false);
  assert.equal(s.plugins.filter(p => p.enabled).length, 1);
  assert.throws(() => wb.pluginToggle(s, 'quant', false), /至少保留一个/);
});

test('插件排序按上下移动生效并保持连续序号', () => {
  const wb = load();
  let s = wb.pluginAdd(wb.defaultState(), '第三个');
  s = wb.pluginMove(s, s.plugins[4].id, -4);
  assert.equal(s.plugins.map(p => p.name).join(','), '第三个,量化概率,专家团队,自选股,操盘记录');
  assert.equal(s.plugins.map(p => p.order).join(','), '0,1,2,3,4');
});

test('概率查询返回方向、命中率、覆盖率与单边基准', () => {
  const wb = load();
  const s = wb.findSymbol('601088');
  const p = wb.probabilityFor(s, 11);
  assert.equal(p.horizon, 11);
  assert.equal(p.direction, 1);
  assert.equal(p.probability, (560 + 10) / 1000);
  assert.equal(p.label, '上涨');
  assert.equal(p.baseUp, 0.52);
  assert.equal(p.coverage, 0.3);
  assert.equal(wb.probabilityFor(s, 21), null);
  const flat = wb.probabilityFor(s, 1);
  assert.equal(flat.direction, 0);
  assert.equal(flat.probability, null);
  assert.equal(flat.label, '中性');
});

test('代码相同但类别不同的标的不会混淆', () => {
  const wb = load();
  assert.equal(wb.findSymbol('000001', '指数').n, '上证指数');
  assert.equal(wb.findSymbol('000001', '个股').n, '平安银行');
  assert.equal(wb.searchSymbols('000001').length, 2);
  assert.equal(wb.symbolKey(wb.findSymbol('000001', '个股')), '个股|000001');
});

test('最佳周期沿着 1–20 根比较，跳过无信号周期', () => {
  const wb = load();
  const best = wb.bestHorizon(wb.findSymbol('601088'));
  assert.equal(best.horizon, 20);
  assert.equal(best.direction, 1);
});

test('目标日期按工作日折算，越界返回超过 20', () => {
  const wb = load();
  assert.equal(wb.tradingDaysAhead('2026-11-06', '2026-11-05'), 1);
  assert.equal(wb.tradingDaysAhead('2026-11-09', '2026-11-05'), 2);
  assert.equal(wb.tradingDaysAhead('2026-11-05', '2026-11-05'), 0);
  assert.ok(wb.tradingDaysAhead('2027-01-05', '2026-11-05') > 20);
  assert.equal(wb.tradingDaysAhead('bad-date', '2026-11-05'), null);
});

test('内置样本用脚本化判断，非样本价值专家明确弃权', () => {
  const wb = load();
  const fixture = wb.findSymbol('601088');
  const buffett = wb.defaultState().experts.find(e => e.id === 'buffett');
  assert.equal(wb.verdictFor(buffett, fixture, wb.probabilityFor(fixture, 5)).vote, 1);
  const other = wb.findSymbol('600900');
  const duan = wb.defaultState().experts.find(e => e.id === 'duan');
  assert.equal(wb.verdictFor(duan, other, null).vote, 1);
  const unknown = {c: '999999', k: '个股', n: '测试'};
  const abstain = wb.verdictFor(duan, unknown, wb.probabilityFor(fixture, 5));
  assert.equal(abstain.vote, 0);
  assert.match(abstain.why, /缺少|未接入/);
});

test('量化专家读快照：无信号时弃权，不把基准当结论', () => {
  const wb = load();
  const neutral = wb.defaultState().experts.find(e => e.id === 'neutral');
  const s = wb.findSymbol('000001', '指数');
  const up = wb.verdictFor(neutral, s, wb.probabilityFor(s, 11));
  assert.equal(up.vote, 1);
  assert.match(up.why, /命中率/);
  const flat = wb.verdictFor(neutral, s, wb.probabilityFor(s, 1));
  assert.equal(flat.vote, 0);
  assert.match(flat.why, /没有发出预测/);
});

test('共识比例按权重计算', () => {
  const wb = load();
  const s = wb.findSymbol('601088');
  const v = wb.expertVerdicts(s, 5);
  assert.equal(v.votes.length, 6);
  assert.ok(v.share >= 0 && v.share <= 1);
  const weights = v.votes.reduce((n, x) => n + wb.getState().experts.find(e => e.id === x.id).weight, 0);
  const support = v.votes.filter(x => x.vote === 1).reduce((n, x) => n + wb.getState().experts.find(e => e.id === x.id).weight, 0);
  assert.ok(Math.abs(v.share - support / weights) < 1e-9);
});

test('损坏配置回退而不清空合法部分', () => {
  const wb = load();
  const s = plain(wb.defaultState());
  s.experts.push({id: 'bad<id>', name: 'x'});
  s.experts.push({id: 'good', name: '  合法专家  ', weight: 99});
  const back = wb.validateState(s);
  assert.ok(!back.experts.some(e => e.id === 'bad<id>'));
  const good = back.experts.find(e => e.id === 'good');
  assert.equal(good.name, '合法专家');
  assert.ok(good.weight <= 3);
  assert.throws(() => wb.validateState({schemaVersion: 4, experts: []}), /至少需要一位专家/);
});

test('会话：旧版单聊天迁移、新建不清空、切换恢复', () => {
  const wb = load();
  const h = wb.helpers;
  const legacy = {messages: [{role: 'user', text: '旧问题', time: '09:00'}], conversations: []};
  const migrated = h.normalize(legacy);
  assert.equal(migrated.conversations.length, 1);
  assert.deepEqual(plain(h.normalize(plain(migrated))), plain(migrated));

  const s = plain(wb.defaultState());
  Object.assign(s, h.normalize(s));
  s.messages = [{role: 'user', text: '第一条', time: '09:01'}];
  h.create(s, 'chat-b', '10:00');
  assert.equal(s.messages.length, 0);
  s.messages = [{role: 'user', text: '第二条', time: '10:01'}];
  h.switchTo(s, s.conversations[1].id);
  assert.equal(s.messages[0].text, '第一条');
});

test('操盘记录：创建时冻结当时理由与信号，复盘收益按方向计算', () => {
  const wb = load();
  const symbol = wb.findSymbol('000001', '指数');
  const created = wb.journalCreate(symbol, 'buy', {horizon: 11, price: 10, reason: '测试理由'});
  assert.equal(created.action, 'buy');
  assert.equal(created.direction, 1);
  assert.ok(created.votes.length >= 1);
  assert.equal(created.price, 10);
  assert.match(created.reason, /测试理由/);

  created.nowPrice = 11;
  assert.ok(Math.abs(wb.journalReturn(created) - 0.1) < 1e-9);
  created.action = 'sell';
  assert.ok(Math.abs(wb.journalReturn(created) + 0.1) < 1e-9);
  created.nowPrice = null;
  assert.equal(wb.journalReturn(created), null);
});

test('操盘记录：损坏数据被丢弃，合法记录保留且理由不被截断丢失', () => {
  const wb = load();
  const good = wb.journalCreate(wb.findSymbol('601088'), 'watch', {horizon: 5, reason: '保留'});
  const saved = plain(wb.defaultState());
  saved.journal = [good, null, {id: 'x'}, {...good, id: 'bad', action: 'unknown'}];
  const back = wb.validateState(saved);
  assert.equal(back.journal.length, 1);
  assert.equal(back.journal[0].reason, '保留');
  assert.equal(back.journal[0].action, 'watch');
});

test('老配置缺少内置插件时自动补齐，但保留自定义插件', () => {
  const wb = load();
  const s = plain(wb.defaultState());
  s.plugins = [s.plugins[0], {id: 'plg-x', kind: 'custom', name: '龙虎榜', icon: 'layers', enabled: true, order: 1, note: ''}];
  const back = wb.validateState(s);
  const ids = back.plugins.map(p => p.id);
  for (const builtin of ['quant', 'experts', 'watchlist', 'journal']) assert.ok(ids.includes(builtin), builtin);
  assert.ok(ids.includes('plg-x'));
});
