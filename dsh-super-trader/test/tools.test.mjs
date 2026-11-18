import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../lib/tools.js';

const names = ['st_market_quotes', 'st_quant_probability', 'st_expert_analyze', 'st_expert_config', 'st_expert_creation', 'st_expert_team', 'st_watchlist_add', 'st_watchlist_analyze', 'st_journal_create', 'st_journal_review', 'st_memory_recall', 'st_market_history', 'st_watchlist', 'st_journal', 'st_research_catalog', 'st_job', 'st_backend_retry', 'st_symbol_search', 'st_screen_stocks', 'st_stock_research', 'st_sector_research', 'st_team_research', 'st_factor_predict', 'st_factor_code', 'st_factor_research', 'st_doctor', 'st_session_list', 'st_session_read'];
function setup(handler = () => ({ actual: true }), options = {}) {
  const calls = [];
  const manager = {
    async request(...args) { calls.push(args); return handler(...args); },
    async doctor(args) { calls.push(['doctor', args]); return handler('doctor', args); },
    async retryBackend() { calls.push(['retry']); return handler('retry'); },
  };
  const tools = createTools(manager, { pollIntervalMs: 1, pollTimeoutMs: 500, ...options });
  return { calls, tools, get: name => tools.find(tool => tool.name === name) };
}

test('exact twenty-eight names, real ToolDefinition output renderer and basic schema dialect', async () => {
  const { tools } = setup(); assert.deepEqual(tools.map(tool => tool.name), names);
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'oneOf', 'description']);
  function inspect(schema) {
    for (const [key, value] of Object.entries(schema)) {
      assert.ok(allowed.has(key), `unsupported schema keyword ${key}`);
      if (key === 'properties') for (const child of Object.values(value)) inspect(child);
      if (key === 'items') inspect(value);
      if (key === 'oneOf') for (const child of value) inspect(child);
    }
  }
  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string'); assert.equal(typeof tool.execute, 'function');
    assert.equal(tool.parameters.additionalProperties, false); inspect(tool.parameters); inspect(tool.output.schema);
    const value = { direction: 0, probability: null, expert: { abstained: true } };
    assert.deepEqual(tool.output.render({}, value), [{ type: 'text', text: JSON.stringify(value) }]);
  }
});

const forwards = [
  ['st_market_quotes', { codes:'601088,000001.SZ' }, 'GET', '/api/market/quotes?codes=601088%2C000001.SZ', undefined],
  ['st_quant_probability', { code: '601088', category: '个股', horizon: 20, recompute: true }, 'GET', '/api/quant/probability?code=601088&category=%E4%B8%AA%E8%82%A1&horizon=20&recompute=true', undefined],
  ['st_expert_analyze', { expert_id: 'duan/x?', code: '601088', horizon: 1 }, 'POST', '/api/experts/duan%2Fx%3F/analyze', { code: '601088', horizon: 1 }],
  ['st_expert_config', {action:'save',name:'自定义专家',system_prompt:'依据证据'}, 'POST', '/api/experts', {name:'自定义专家',system_prompt:'依据证据',tools:['quant_snapshot','news_search']}],
  ['st_expert_config', {action:'get',id:'custom'}, 'GET', '/api/experts/custom', undefined],
  ['st_expert_config', {action:'delete',id:'custom'}, 'DELETE', '/api/experts/custom', undefined],
  ['st_expert_team', { code: '601088', category: '个股', horizon: 10, threshold: 0.7, require_unanimous: true, expert_ids: ['duan', 'buffett'] }, 'POST', '/api/experts/team/analyze', { code: '601088', category: '个股', horizon: 10, threshold: 0.7, require_unanimous: true, expert_ids: ['duan', 'buffett'] }],
  ['st_watchlist_add', { code: '601088', category: '个股' }, 'POST', '/api/watchlist', { code: '601088', category: '个股' }],
  ['st_watchlist_analyze', { horizon: 10, threshold: 0.6, with_experts: false }, 'POST', '/api/watchlist/analyze', { horizon: 10, threshold: 0.6, with_experts: false }],
  ['st_journal_create', { code: '601088', action: 'buy', price: 35, entry_date: '2026-09-01', note: '' }, 'POST', '/api/journal', { code: '601088', action: 'buy', price: 35, entry_date: '2026-09-01', note: '' }],
  ['st_journal_review', { id: 'J/a ?' }, 'GET', '/api/journal/J%2Fa%20%3F/review', undefined],
  ['st_memory_recall', { q: '电池 &', scope: 'agent' }, 'GET', '/api/memory/recall?q=%E7%94%B5%E6%B1%A0+%26&scope=agent', undefined],
];
for (const [name, args, method, path, body] of forwards) {
  test(`${name} forwards exact API and cancellation signal`, async () => {
    const raw = name === 'st_watchlist_analyze' ? { job: { id: 'job1', status: 'done', result: { probability: null } } } : { probability: null, direction: 0, actual: true };
    const { get, calls } = setup(() => raw);
    const controller = new AbortController();
    const value = await get(name).execute(args, { signal: controller.signal });
    assert.deepEqual(calls[0].slice(0, 3), [method, path, body]);
    assert.equal(calls[0][3].signal, controller.signal);
    if (name === 'st_watchlist_analyze') assert.deepEqual(value, { job_id: 'job1', job: raw.job });
    else assert.equal(value, raw);
  });
}

test('team research waits for the terminal job instead of returning a running snapshot',async()=>{
  const {get,calls}=setup((method,path)=>{
    if(method==='POST')return {job:{id:'T1',status:'running',progress:0,total:2}};
    return {id:'T1',status:'completed',progress:2,total:2,result:{consensus:{decision:'up'}}};
  },{teamPollMs:1});
  const value=await get('st_team_research').execute({kind:'sector',code:'881101.TI'});
  assert.equal(value.job.status,'completed');assert.equal(value.job.result.consensus.decision,'up');
  assert.equal(calls[0][0],'POST');assert.equal(calls[1][0],'GET');assert.match(calls[1][1],/\/api\/jobs\/T1$/);
});
test('doctor forwards signal and real diagnosis', async () => {
  const raw = { state: { phase: 'python_missing' }, guidance: 'Install Python' };
  const { get, calls } = setup(() => raw); const controller = new AbortController();
  assert.equal(await get('st_doctor').execute({}, { signal: controller.signal }), raw);
  assert.deepEqual(calls, [['doctor', { signal: controller.signal }]]);
});

for (const [name, args] of [...forwards.map(([name, args]) => [name, args]), ['st_doctor', {}]]) {
  test(`${name} preserves backend HTTP status and body without inventing a result`, async () => {
    const body = { error: '未配置模型密钥', detail: ['原始', 1] };
    const { get } = setup(() => { throw Object.assign(new Error('Backend HTTP 503'), { code: 'http_error', status: 503, body }); });
    const result = await get(name).execute(args);
    assert.equal(result.error.code, 'http_error'); assert.equal(result.status, 503); assert.equal(result.body, body);
    assert.equal(result.probability, undefined);
  });
}

const invalids = [
  ...[{}, {codes:''}, {codes:'601088,'}, {codes:'http://evil'}, {codes:6}, {codes:Array(51).fill('601088').join(',')}].map(args=>['st_market_quotes',args]),
  ['st_quant_probability', {}], ['st_quant_probability', { code: '' }], ['st_quant_probability', { code: '  ' }], ['st_quant_probability', { code: 123 }],
  ...[0, 21, 1.5, '10', null, Infinity, NaN].map(horizon => ['st_quant_probability', { code: 'a', horizon }]),
  ['st_quant_probability', { code: 'a', horizon: 10, date: '2026-11-19' }],
  ...['no-date', '2026-02-30', '2026-13-01'].map(date => ['st_quant_probability', { code: 'a', date }]),
  ['st_expert_config',{action:'save'}], ['st_expert_config',{action:'get'}], ['st_expert_config',{action:'delete'}], ['st_expert_config',{action:'delete',id:'x',name:'禁止修改'}], ['st_expert_config',{action:'get',id:'x',name:'禁止修改'}],
  ['st_expert_analyze', { code: 'a' }], ['st_expert_analyze', { expert_id: ' ', code: 'a' }], ['st_expert_analyze', { expert_id: 'a', code: '', horizon: 0 }],
  ['st_expert_team', { code: 'a', threshold: 1.01 }], ['st_expert_team', { code: 'a', threshold: -0.1 }], ['st_expert_team', { code: 'a', expert_ids: [''] }], ['st_expert_team', { code: 'a', expert_ids: 'x' }],
  ['st_watchlist_add', { code: '' }], ['st_watchlist_add', { code: 'a', category: 1 }],
  ['st_watchlist_analyze', { with_experts: 'false' }], ['st_watchlist_analyze', { horizon: 21 }], ['st_watchlist_analyze', { job_id: 'x', horizon: 1 }],
  ['st_journal_create', { code: 'a', action: 'hold' }], ['st_journal_create', { code: 'a', action: 'buy', price: 0 }], ['st_journal_create', { code: 'a', action: 'buy', price: -1 }], ['st_journal_create', { code: 'a', action: 'buy', entry_date: '2026-02-30' }],
  ['st_journal_review', { id: '' }], ['st_memory_recall', { q: ' ' }], ['st_memory_recall', { q: 'a', scope: null }], ['st_doctor', { secret: 'x' }],
];
for (const [index, [name, args]] of invalids.entries()) {
  test(`parameter validation ${index}: ${name}`, async () => {
    const { get, calls } = setup(); const value = await get(name).execute(args);
    assert.equal(value.error.code, 'invalid_arguments', JSON.stringify(args)); assert.equal(calls.length, 0);
  });
}

for (const name of names) {
  test(`${name} rejects non-object and unknown arguments; pre-aborted exec makes no calls`, async () => {
    const { get, calls } = setup();
    for (const args of [null, [], 'bad', { invented: true }]) assert.equal((await get(name).execute(args)).error.code, 'invalid_arguments');
    const controller = new AbortController(); controller.abort();
    assert.equal((await get(name).execute({}, { signal: controller.signal })).error.code, 'cancelled'); assert.equal(calls.length, 0);
  });
}

test('date alternative forwarded without injecting default horizon', async () => {
  const { get, calls } = setup(); await get('st_quant_probability').execute({ code: 'a', date: '2026-11-19' });
  assert.equal(calls[0][1], '/api/quant/probability?code=a&date=2026-11-19');
});

test('all four journal action values accepted without changing snapshots', async () => {
  const { get, calls } = setup();
  for (const action of ['buy', 'sell', 'short', 'watch']) assert.deepEqual(await get('st_journal_create').execute({ code: 'a', action }), { actual: true });
  assert.equal(calls.length, 4);
});

test('job polls real result, encoded ID, exact with_experts forwarding', async () => {
  let n = 0;
  const { get, calls } = setup(() => ++n === 1 ? { job: { id: 'J/a', status: 'queued' } } : n === 2 ? { id: 'J/a', status: 'running', progress: 1 } : { id: 'J/a', status: 'done', result: [1, 2] });
  const value = await get('st_watchlist_analyze').execute({ with_experts: false });
  assert.equal(calls.length, 3); assert.equal(calls[1][1], '/api/jobs/J%2Fa'); assert.deepEqual(value.job.result, [1, 2]);
});

test('job timeout retains ID and query path; subsequent call only queries, never resubmits', async () => {
  const { get, calls } = setup(() => ({ job: { id: 'job123', status: 'running' } }), { pollTimeoutMs: 2, pollIntervalMs: 5 });
  const value = await get('st_watchlist_analyze').execute({});
  assert.equal(value.polling_timed_out, true); assert.equal(value.job_id, 'job123'); assert.equal(value.query_path, '/api/jobs/job123');
  await get('st_watchlist_analyze').execute({ job_id: value.job_id });
  assert.equal(calls.at(-1)[0], 'GET'); assert.equal(calls.at(-1)[1], '/api/jobs/job123');
  assert.equal(calls.filter(call => call[0] === 'POST').length, 1);
});

for (const status of ['error', 'cancelled', 'interrupted']) {
  test(`job terminal ${status} returned honestly`, async () => {
    const job = { id: 'x', status, error: 'backend failure' };
    const { get, calls } = setup(() => ({ job }));
    const value = await get('st_watchlist_analyze').execute({}); assert.equal(value.job, job); assert.equal(calls.length, 1);
  });
}

test('job polling HTTP failure and timeout retain ID', async () => {
  for (const code of ['http_error', 'request_timeout']) {
    let n = 0;
    const { get } = setup(() => {
      if (++n === 1) return { job: { id: 'x', status: 'running' } };
      throw Object.assign(new Error('failed'), { code, status: 503, body: { error: 'raw' } });
    });
    const value = await get('st_watchlist_analyze').execute({});
    assert.equal(value.job_id, 'x');
    if (code === 'request_timeout') assert.equal(value.polling_timed_out, true);
    else { assert.equal(value.status, 503); assert.deepEqual(value.body, { error: 'raw' }); }
  }
});

test('job cancellation stops polling, preserves ID, never silently cancels backend job', async () => {
  const controller = new AbortController();
  const { get, calls } = setup(() => { queueMicrotask(() => controller.abort()); return { job: { id: 'x', status: 'running' } }; });
  const value = await get('st_watchlist_analyze').execute({}, { signal: controller.signal });
  assert.equal(value.error.code, 'cancelled'); assert.equal(value.job_id, 'x'); assert.equal(calls.length, 1);
});

test('malformed job is not reported as success, generic backend failure structured', async () => {
  const { get } = setup(() => ({ not_job: true }));
  assert.equal((await get('st_watchlist_analyze').execute({})).error.code, 'invalid_job_response');
  const broken = setup(() => { throw new Error('offline'); });
  assert.deepEqual((await broken.get('st_memory_recall').execute({ q: 'a' })).error, { code: 'request_failed', message: 'offline' });
});

test('tool output is lossless JSON and st_job can wait without shell sleeps', async () => {
  const {get} = setup(() => ({ status: 'done', nan: NaN, inf: Infinity, neg: -0, big: 10n, nested: [undefined, { ok: true }] }));
  const job = await get('st_job').execute({ action: 'get', id: 'job-1' });
  assert.deepEqual(job, { status: 'done', nan: null, inf: null, neg: 0, big: '10', nested: [null, { ok: true }] });
});

test('st_job wait returns at the terminal state instead of sleeping in a shell', async () => {
  const terminal = setup(() => ({ status: 'completed', result: { ok: true } }));
  const done = await terminal.get('st_job').execute({ action: 'get', id: 'job-1', wait: true, timeout_ms: 1000 });
  assert.equal(done.status, 'completed');
  assert.equal(terminal.calls.length, 1);

  const running = setup(() => ({ status: 'running', progress: 1 }));
  const started = Date.now();
  const snapshot = await running.get('st_job').execute({ action: 'get', id: 'job-1', wait: true, timeout_ms: 1000 });
  assert.equal(snapshot.status, 'running');
  assert.ok(Date.now() - started >= 900, 'waits for the requested budget');
  assert.ok(running.calls.length >= 2);
});
