import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BackendManager, BackendError } from '../lib/backend-manager.js';

const identity = { ok: true, model: { configured: false }, grid: { symbols: 1 } };
const response = (body = identity, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const refused = () => Promise.reject(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
function fakeChild(pid = 4321) {
  const child = new EventEmitter();
  Object.assign(child, { pid, stdout: new EventEmitter(), stderr: new EventEmitter(), kills: [], ended: 0 });
  child.stdin = new EventEmitter();
  child.stdin.end = () => { child.ended++; queueMicrotask(() => child.emit('exit', 0)); };
  child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit('exit', 0, signal)); };
  return child;
}
function setup(overrides = {}) {
  const calls = [];
  const child = fakeChild();
  const manager = new BackendManager({ env: {}, exists: () => true, platform: 'linux', fetch: refused, spawn: (...args) => { calls.push(args); return child; }, startTimeoutMs: 30, probeTimeoutMs: 5, pollIntervalMs: 1, stopTimeoutMs: 5, ...overrides });
  return { manager, child, calls };
}

test('default root is module-relative, construction is idle/nonblocking', () => {
  const { manager, calls } = setup();
  assert.equal(manager.repoRoot, resolve(fileURLToPath(new URL('../../', import.meta.url))));
  assert.equal(manager.getState().phase, 'idle'); assert.equal(calls.length, 0);
});

test('external identity reused, concurrent ensure shares one promise and never kills external', async () => {
  let probes = 0;
  const { manager, calls } = setup({ fetch: async () => { probes++; return response(); } });
  const a = manager.ensureBackend(), b = manager.ensureBackend();
  assert.equal(a, b);
  assert.equal((await a).phase, 'external'); assert.equal(probes, 1); assert.equal(calls.length, 0);
  await manager.dispose(); assert.equal(calls.length, 0); assert.equal(manager.getState().phase, 'disposed');
});

test('spawns supervisor with environment precedence and shared startup', async () => {
  let probes = 0;
  const { manager, calls, child } = setup({ env: { ST_PYTHON: '/my/python', ST_BASE_URL: 'http://127.0.0.1:8123', TEST_VALUE: 'retained' }, fetch: () => ++probes === 1 ? refused() : Promise.resolve(response()) });
  const a = manager.ensureBackend(); assert.equal(a, manager.ensureBackend());
  assert.equal((await a).phase, 'running');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], '/my/python');
  assert.match(calls[0][1][1], /backend-supervisor\.py$/);
  assert.deepEqual(calls[0][2].stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(calls[0][2].env.ST_PORT, '8123'); assert.equal(calls[0][2].env.ST_HOST, '127.0.0.1');
  assert.equal(calls[0][2].env.TEST_VALUE, 'retained');
  assert.equal(manager.getState().pid, child.pid);
  await manager.dispose(); assert.equal(child.ended, 1); assert.equal(manager.getState().pid, null);
});

for (const bad of [{ ok: true }, { ok: true, model: null, grid: {} }, { ok: false, model: {}, grid: {} }, { ok: true, model: [], grid: {} }]) {
  test(`rejects foreign status identity ${JSON.stringify(bad)} and falls back to 8711`, async () => {
    let started = false;
    const { manager, calls } = setup({ fetch: async url => {
      if (url.includes(':8000')) return response(bad);
      return started ? response() : refused();
    }, spawn: (...args) => { calls.push(args); started = true; return fakeChild(); } });
    assert.equal((await manager.ensureBackend()).phase, 'running');
    assert.equal(manager.getState().baseUrl, 'http://127.0.0.1:8711'); assert.equal(calls[0][2].env.ST_PORT, '8711');
    await manager.dispose();
  });
}

test('invalid JSON / non-OK identity are occupied; no spawn if fallback also occupied', async () => {
  const { manager, calls } = setup({ fetch: async url => url.includes(':8000') ? { ok: true, json: async () => { throw new SyntaxError('bad json'); } } : response(identity, 500) });
  assert.equal((await manager.ensureBackend()).phase, 'port_conflict'); assert.equal(calls.length, 0);
});

test('explicit endpoint never silently switches or starts a remote backend', async () => {
  for (const base of ['http://example.com:8000', 'http://127.0.0.1.evil:8000', 'file:///x', 'http://u:secret@localhost:8000', 'http://127.0.0.1:8000/path', 'http://localhost:8000/?key=secret']) {
    const { manager, calls } = setup({ env: { ST_BASE_URL: base } });
    assert.equal((await manager.ensureBackend()).phase, 'invalid_config'); assert.equal(calls.length, 0);
    assert.doesNotMatch(JSON.stringify(manager.getState()), /u:secret/);
  }
  const { manager, calls } = setup({ env: { ST_BASE_URL: 'http://localhost:8999' }, fetch: async () => response({ wrong: true }) });
  assert.equal((await manager.ensureBackend()).phase, 'port_conflict'); assert.equal(calls.length, 0);
});

test('recognizes IPv6 loopback and ST_BASE_URL overrides options', async () => {
  const { manager } = setup({ baseUrl: 'http://127.0.0.1:1', env: { ST_BASE_URL: 'http://[::1]:8001' }, fetch: async () => response() });
  assert.equal((await manager.ensureBackend()).baseUrl, 'http://[::1]:8001'); await manager.dispose();
});

test('missing backend files yields sticky backend_missing without spawning', async () => {
  const { manager, calls } = setup({ exists: () => false });
  assert.equal((await manager.ensureBackend()).phase, 'backend_missing');
  assert.equal((await manager.ensureBackend()).phase, 'backend_missing'); assert.equal(calls.length, 0);
});

for (const asynchronous of [false, true]) {
  test(`python ENOENT ${asynchronous ? 'async' : 'sync'} stays sticky, no restart storm`, async () => {
    let count = 0;
    const { manager } = setup({ spawn: () => {
      count++;
      const error = Object.assign(new Error('python missing'), { code: 'ENOENT' });
      if (!asynchronous) throw error;
      const child = fakeChild(); queueMicrotask(() => child.emit('error', error)); return child;
    } });
    assert.equal((await manager.ensureBackend()).phase, 'python_missing');
    await manager.ensureBackend(); await manager.ensureBackend(); assert.equal(count, 1);
    assert.match((await manager.doctor()).guidance, /ST_PYTHON/); await manager.dispose();
  });
}

test('dependency failure differentiated from ordinary exit; log tail redacts split keys and bounded size', async () => {
  const secret = 'env-private-value';
  const { manager, child } = setup({ env: { ST_MODEL_API_KEY: secret }, fetch: (() => { let n = 0; return () => ++n === 1 ? refused() : new Promise(resolve => setTimeout(() => resolve(response({})), 2)); })() });
  const pending = manager.ensureBackend();
  await new Promise(resolve => setTimeout(resolve, 1));
  child.stderr.emit('data', 'x'.repeat(30000) + '\nModuleNotFoundError: No module named uvicorn\nST_MODEL_API_KEY=env-');
  child.stderr.emit('data', 'private-value\nAuthorization: Bearer sk-secret-token\n');
  child.emit('exit', 1);
  assert.equal((await pending).phase, 'dependency_missing');
  const state = manager.getState(); assert.ok(state.logTail.length <= 12000);
  assert.doesNotMatch(JSON.stringify(state), /env-private-value|sk-secret-token/);
  assert.match((await manager.doctor()).guidance, /requirements.txt/); await manager.dispose();
});

test('unexpected running-child exit is sticky and owned pid cleared', async () => {
  let n = 0;
  const { manager, child, calls } = setup({ fetch: () => ++n === 1 ? refused() : Promise.resolve(response()) });
  await manager.ensureBackend(); child.emit('exit', 2);
  assert.equal(manager.getState().phase, 'exited'); assert.equal(manager.getState().pid, null);
  await manager.ensureBackend(); assert.equal(calls.length, 1); await manager.dispose();
});

test('startup timeout is bounded even when fetch never resolves; owned process cleaned', async () => {
  const { manager, child } = setup({ fetch: () => new Promise(() => {}) });
  // Probe timeout regards default port as occupied; fallback timeout then stops without launching.
  assert.equal((await manager.ensureBackend()).phase, 'port_conflict'); assert.equal(child.ended, 0);
  let n = 0;
  const second = setup({ fetch: () => ++n === 1 ? refused() : new Promise(() => {}) });
  assert.equal((await second.manager.ensureBackend()).phase, 'start_timeout'); assert.equal(second.child.ended, 1);
  await manager.dispose(); await second.manager.dispose();
});

test('dispose races probe: no late spawn or phase resurrection', async () => {
  let release;
  const { manager, calls } = setup({ fetch: () => new Promise(resolve => { release = resolve; }) });
  const pending = manager.ensureBackend();
  await Promise.resolve(); await manager.dispose(); release?.(response());
  assert.equal((await pending).phase, 'disposed'); assert.equal(calls.length, 0);
});

test('dispose races startup polling and cleans child once', async () => {
  let n = 0;
  const { manager, child } = setup({ fetch: () => ++n === 1 ? refused() : new Promise(() => {}) });
  const pending = manager.ensureBackend();
  await new Promise(resolve => setTimeout(resolve, 1));
  const disposal = manager.dispose(); assert.equal(disposal, manager.dispose()); await disposal; await pending;
  assert.equal(manager.getState().phase, 'disposed'); assert.equal(child.ended, 1);
});

test('Windows supervisor detaches from libuv kill-on-close job but retains stdin lifetime pipe', async () => {
  let n=0;const {manager,calls}=setup({platform:'win32',fetch:()=>++n===1?refused():Promise.resolve(response())});
  await manager.ensureBackend();assert.equal(calls[0][2].detached,true);assert.equal(calls[0][2].windowsHide,true);assert.equal(calls[0][2].stdio[0],'pipe');await manager.dispose();
});

test('Windows taskkill tree fallback targets only owned child', async () => {
  let n = 0;
  const calls = []; const child = fakeChild(7799); child.stdin.end = () => { child.ended++; };
  const { manager } = setup({ platform: 'win32', fetch: () => ++n === 1 ? refused() : Promise.resolve(response()), spawn: (...args) => {
    calls.push(args); return args[0] === 'taskkill' ? new EventEmitter() : child;
  } });
  await manager.ensureBackend(); await manager.dispose();
  assert.deepEqual(calls[1][1], ['/PID', '7799', '/T', '/F']);
  assert.equal(calls.length, 2); await manager.dispose(); assert.equal(calls.length, 2);
});

test('request forwards raw success and HTTP status/body; safe local paths only', async () => {
  const seen = [];
  const { manager } = setup({ fetch: async (url, opts) => { seen.push([url, opts]); return url.endsWith('/api/status') ? response() : response({ error: 'no key', probability: null }, 503); } });
  await assert.rejects(manager.request('POST', '/api/experts/duan/analyze', { code: '601088' }), error => error instanceof BackendError && error.status === 503 && error.body.error === 'no key');
  assert.deepEqual(JSON.parse(seen[1][1].body), { code: '601088' }); assert.equal(seen[1][1].redirect, 'error');
  for (const path of ['https://evil', '//evil/api/x', '/api/../x', '/api/\\evil', '/api/%2e%2e/x']) await assert.rejects(manager.request('GET', path), { code: 'invalid_path' });
  await manager.dispose();
});

test('request cancellation does not cancel shared startup; disposed requests never fetch', async () => {
  let release;
  const { manager } = setup({ fetch: () => new Promise(resolve => { release = resolve; }) });
  const shared = manager.ensureBackend();
  const controller = new AbortController();
  const request = manager.request('GET', '/api/test', undefined, { signal: controller.signal }); controller.abort();
  await assert.rejects(request, { code: 'cancelled' });
  await Promise.resolve(); release(response()); assert.equal((await shared).phase, 'external');
  await manager.dispose(); await assert.rejects(manager.request('GET', '/api/test'), { code: 'cancelled' });
});

test('unresponsive owned supervisor is terminated, late taskkill errors cannot target an exited child', async () => {
  let n = 0; const child = fakeChild(); child.stdin.end = () => {};
  const killer = new EventEmitter();
  const { manager } = setup({ platform: 'win32', fetch: () => ++n === 1 ? refused() : Promise.resolve(response()), spawn: name => name === 'taskkill' ? killer : child });
  await manager.ensureBackend(); await manager.dispose();
  assert.deepEqual(child.kills, ['SIGKILL']); assert.equal(manager.getState().pid, null);
  killer.emit('error', new Error('late error')); assert.deepEqual(child.kills, ['SIGKILL']);
});

test('doctor does not claim readiness when an external backend has disappeared', async () => {
  let n = 0;
  const { manager } = setup({ fetch: () => ++n === 1 ? Promise.resolve(response()) : refused() });
  await manager.ensureBackend(); const value = await manager.doctor();
  assert.equal(value.status.ok, false); assert.match(value.guidance, /no longer passes/); await manager.dispose();
});

test('successful requests preserve JSON and non-JSON bodies; unavailable backend errors include state', async () => {
  const { manager } = setup({ fetch: async url => url.endsWith('/api/status') ? response() : url.endsWith('/api/json') ? response({ direction: 0, probability: null }) : { ok: true, text: async () => 'raw,csv' } });
  assert.deepEqual(await manager.request('GET', '/api/json'), { direction: 0, probability: null });
  assert.equal(await manager.request('GET', '/api/csv'), 'raw,csv'); await manager.dispose();
  const broken = setup({ exists: () => false });
  await assert.rejects(broken.manager.request('GET', '/api/json'), error => error.code === 'backend_missing' && error.state.phase === 'backend_missing');
  await broken.manager.dispose();
});

test('request timeout covers hung transport, doctor sanitizes status secrets', async () => {
  const { manager } = setup({ fetch: async url => url.endsWith('/api/status') ? response({ ...identity, token: 'secret-value', extra: 'password=hunter2' }) : new Promise(() => {}) });
  await assert.rejects(manager.request('GET', '/api/hung', undefined, { timeoutMs: 3 }), { code: 'request_timeout' });
  const diagnosis = await manager.doctor();
  assert.doesNotMatch(JSON.stringify(diagnosis), /secret-value|hunter2/); assert.match(diagnosis.guidance, /model key/);
  await manager.dispose();
});
