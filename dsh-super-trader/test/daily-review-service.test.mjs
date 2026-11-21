import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DailyReviewService } from '../lib/daily-review-service.js';

const DATE = '2026-11-20';
const URL = `/dsh-super-trader/daily-review/report/${DATE}`;
const TITLE = 'AI 专家复盘';
const source = (date = DATE) => ({ date, counts: { experts: 1, triggered: 1, buys: 0, queued: 1 }, experts: [{
  id: 'expert-a', name: '专家甲', nav: 999, navDate: date, dayReturn: -0.001, totalReturn: -0.001, drawdown: -0.001,
  plans: [{ code: '600000', reason: '冻结理由', status: 'triggered' }], queued: [{ code: '600000', side: 'buy' }], points: [{ sentinel: 'unneeded-long-series' }],
}] });

async function setup(t, { prompt, create, inspect } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'st-daily-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceRows = [], calls = { workspace: [], create: [], rename: [], prompt: [], load: [], list: [] };
  const workspaces = {
    list: () => workspaceRows.slice(),
    async create(path, title) {
      calls.workspace.push([path, title]);
      const row = { id: 'workspace-review', title, path };
      workspaceRows.push(row);
      return row;
    },
  };
  const visible = new Set();
  const sessions = {
    async create(data) {
      calls.create.push(data);
      const value = create ? create(data) : { sessionId: `review-session-${calls.create.length}` };
      if (value?.sessionId) visible.add(value.sessionId);
      return value;
    },
    async rename(data) { calls.rename.push(data); },
    async prompt(data, signal) {
      calls.prompt.push({ ...data, signal });
      return prompt ? prompt(data) : { accepted: true };
    },
    // Session history the panel can actually reopen; archiving removes a row from this list.
    async list(data, signal) { calls.list.push({ data, signal }); return { items: [...visible].map(sessionId => ({ sessionId })) }; },
    inspect,
  };
  const archived = new Set();
  const archive = {
    // One baseline frame answers the archive question; the service aborts the stream after it.
    async *follow() { yield { type: 'baseline', value: { items: [], archivedSessionIds: [...archived] } }; },
  };
  const h = { report: source(), root, calls, workspaces, workspaceRows, sessions, archived };
  h.restart = (options = {}) => new DailyReviewService({
    workspaces, sessions, archive, workingDirectory: { defaultDirectory: root },
    loadReport() { calls.load.push(true); return h.report; },
    renderHtml(report, lang, commentary) { return JSON.stringify({ report, lang, commentary }); },
    ...options,
  });
  h.hideSession = sessionId => visible.delete(sessionId);
  h.archiveSession = sessionId => archived.add(sessionId);
  h.service = h.restart();
  return h;
}

const status = code => error => error.status === code;

test('history and missing HTML are read-only, and dates are canonical calendar dates', async t => {
  const h = await setup(t);
  assert.deepEqual(await h.service.history(), { items: [] });
  await assert.rejects(h.service.html(DATE), status(404));
  for (const date of [undefined, '../2026-11-20', '2026-11-20\n', '2026-02-30', '2026-11-2', '%2e%2e']) {
    await assert.rejects(h.service.html(date), status(400));
  }
  await assert.rejects(h.service.publish('anything', { summary: 'x', experts: [] }), status(403));
  assert.deepEqual(await readdir(h.root), []);
  assert.deepEqual(h.calls.workspace, []);
  assert.deepEqual(h.calls.load, []);
});

test('one start prompts immediately, shares the flight, and durably reopens the frozen report', async t => {
  const h = await setup(t);
  const a = h.restart({ reportOrigin: () => 'http://127.0.0.1:53412' });
  const [first, parallel, otherInstance] = await Promise.all([a.start(), a.start(), h.service.start()]);
  assert.deepEqual(first, { date: DATE, workspaceId: 'workspace-review', sessionId: 'review-session-1', reportUrl: URL, reused: false });
  assert.deepEqual(parallel, { ...first, reused: true });
  assert.deepEqual(otherInstance, parallel);
  assert.equal(h.calls.load.length, 1);
  assert.deepEqual(h.calls.workspace, [[join(h.root, TITLE), TITLE]]);
  assert.deepEqual(h.calls.create, [{ workspaceId: 'workspace-review' }]);
  assert.deepEqual(h.calls.rename, [{ sessionId: first.sessionId, title: `${TITLE}：${DATE}` }]);
  const [{ content, mode, sessionId, signal }] = h.calls.prompt;
  assert.equal(sessionId, first.sessionId);
  assert.equal(mode, 'queue');
  assert.ok(signal instanceof AbortSignal);
  assert.equal(content[0].type, 'text');
  assert.ok(content[0].text.includes(`http://127.0.0.1:53412${URL}`));
  for (const phrase of ['st_daily_review_publish', '冻结理由', '归档记录', '不查取未来数据', '不下单或修改组合账本']) {
    assert.ok(content[0].text.includes(phrase), phrase);
  }
  assert.doesNotMatch(content[0].text, /unneeded-long-series/);
  h.report.experts[0].plans[0].reason = '后续变化';
  const restarted = h.restart();
  assert.deepEqual(await restarted.start(), parallel);
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.prompt.length, 1);
  const base = JSON.parse(await restarted.html(DATE));
  assert.equal(base.lang, 'zh');
  assert.equal(base.commentary, null);
  assert.equal(base.report.experts[0].plans[0].reason, '冻结理由');
  h.report = source('2026-11-23');
  await restarted.start();
  const { items } = await h.restart().history();
  assert.deepEqual(items.map(item => [item.date, item.sessionId]), [['2026-11-23', 'review-session-2'], [DATE, first.sessionId]]);
  assert.equal(h.calls.workspace.length, 1);
});

test('an archived conversation is replaced by a new one for the same frozen date', async t => {
  const h = await setup(t);
  const first = await h.service.start();
  assert.equal(first.sessionId, 'review-session-1');
  h.archiveSession(first.sessionId);
  const again = await h.restart().start();
  assert.deepEqual(again, { date: DATE, workspaceId: 'workspace-review', sessionId: 'review-session-2', reportUrl: URL, reused: false, replaced: true });
  assert.equal(h.calls.create.length, 2);
  assert.equal(h.calls.prompt.length, 2);
  assert.equal(h.calls.prompt[1].sessionId, 'review-session-2');
  assert.equal(JSON.parse(JSON.stringify(h.calls.prompt[1].content[0].text)).includes('冻结理由'), true);
  const reopened = await h.restart().start();
  assert.deepEqual(reopened, { date: DATE, workspaceId: 'workspace-review', sessionId: 'review-session-2', reportUrl: URL, reused: true });
  assert.equal(h.calls.create.length, 2);
});

test('an explicit restart replaces a still-visible conversation for the same date', async t => {
  const h = await setup(t);
  const first = await h.service.start();
  const again = await h.restart().start({ restart: true });
  assert.deepEqual(again, { date: DATE, workspaceId: 'workspace-review', sessionId: 'review-session-2', reportUrl: URL, reused: false, replaced: true });
  assert.notEqual(again.sessionId, first.sessionId);
  assert.equal(h.calls.create.length, 2);
  assert.equal(h.calls.prompt.length, 2);
});

test('ambiguous admission is not resubmitted, even by a new service; base report and session link survive', async t => {
  const h = await setup(t, { prompt() { throw new Error('ack was lost'); } });
  const ambiguous = error => error.status === 409 && error.body.sessionId === 'review-session-1' && error.body.reportUrl === URL;
  await assert.rejects(h.service.start(), ambiguous);
  await assert.rejects(h.restart().start(), ambiguous);
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.prompt.length, 1);
  assert.ok(h.calls.list.length >= 2);
  assert.equal((await h.restart().history()).items[0].status, 'submitting');
  assert.equal(JSON.parse(await h.restart().html(DATE)).commentary, null);
});

test('matching durable user prompt confirms admission when the acknowledgement was lost', async t => {
  let received;
  const h = await setup(t, {
    prompt(data) { received = data; throw new Error('ack was lost'); },
    inspect(sessionId) {
      assert.equal(sessionId, received.sessionId);
      return { events: [{ type: 'user/message', data: { content: received.content } }] };
    },
  });
  assert.equal((await h.service.start()).sessionId, 'review-session-1');
  assert.equal((await h.restart().start()).reused, true);
  assert.equal(h.calls.prompt.length, 1);
});

test('definite prompt rejection can retry, reusing its session, request id, and frozen source', async t => {
  let attempts = 0;
  const h = await setup(t, { prompt: () => ({ accepted: ++attempts > 1 }) });
  await assert.rejects(h.service.start(), error => error.status === 503 && error.body.sessionId === 'review-session-1');
  h.report.experts[0].plans[0].reason = '重试时的数据';
  assert.equal((await h.restart().start()).sessionId, 'review-session-1');
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.prompt.length, 2);
  assert.equal(h.calls.prompt[0].requestId, h.calls.prompt[1].requestId);
  assert.equal(h.calls.prompt[0].content[0].text, h.calls.prompt[1].content[0].text);
});

test('unconfirmed session creation never creates another potentially duplicate session', async t => {
  const h = await setup(t, { create() { throw new Error('create acknowledgement interrupted'); } });
  await assert.rejects(h.service.start(), /未确认/);
  await assert.rejects(h.restart().start(), /未确认/);
  assert.equal(h.calls.create.length, 1);
  assert.equal(h.calls.prompt.length, 0);
  assert.deepEqual((await h.service.history()).items, []);
  assert.equal(JSON.parse(await h.service.html(DATE)).report.date, DATE);
});

test('only the exact owning session can publish validated plain text, including during admission', async t => {
  let h;
  const body = { summary: '  整体稳健  ', experts: [{ id: 'expert-a', comment: '来自冻结档案', watch: '核对缺口' }] };
  h = await setup(t, { async prompt(data) {
    assert.equal(JSON.parse(await h.service.html(DATE)).commentary, null);
    assert.deepEqual(await h.service.publish(data.sessionId, body), { date: DATE, reportUrl: URL, published: true });
    return { accepted: true };
  } });
  const { sessionId } = await h.service.start();
  const restarted = h.restart();
  for (const wrong of [undefined, sessionId + '-fork', sessionId.toUpperCase(), 'others']) {
    await assert.rejects(restarted.publish(wrong, body), status(403));
  }
  for (const invalid of [
    { ...body, date: DATE }, { ...body, summary: '<script>alert(1)</script>' }, { ...body, summary: 'x'.repeat(1201) },
    { ...body, experts: [{ id: 'unknown', comment: 'X' }] }, { ...body, experts: [...body.experts, ...body.experts] },
    { ...body, experts: [{ id: 'expert-a', comment: ' ', watch: '文本' }] },
    { ...body, experts: [{ ...body.experts[0], watch: ['x'] }] }, { ...body, experts: Array(51).fill(body.experts[0]) },
  ]) {
    await assert.rejects(restarted.publish(sessionId, invalid), status(400));
  }
  const finalized = JSON.parse(await restarted.html(DATE));
  assert.deepEqual(finalized.commentary, { ...body, summary: body.summary.trim() });
  assert.deepEqual(finalized.report, h.report);
});

test('source prompt is bounded and omissions are explicit', async t => {
  const h = await setup(t);
  h.report.experts = Array.from({ length: 100 }, (_, index) => ({ ...h.report.experts[0], id: `e-${index}`, name: '专'.repeat(200),
    plans: Array.from({ length: 8 }, () => ({ code: '600000', reason: '原'.repeat(300) })),
  }));
  await h.service.start();
  const text = h.calls.prompt[0].content[0].text;
  assert.ok(Buffer.byteLength(text) < 25_000);
  const snapshot = JSON.parse(text.slice(text.lastIndexOf('\n') + 1));
  assert.equal(snapshot.omittedExperts + snapshot.experts.length, 100);
  assert.ok(snapshot.omittedExperts >= 50);
  const shown = snapshot.experts.reduce((sum, expert) => sum + (expert.plans?.length ?? 0) + (expert.queued?.length ?? 0), 0);
  assert.equal(snapshot.omittedEvents + shown, 900);
});
