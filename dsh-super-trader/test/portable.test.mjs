import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, copyFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { buildRuntime, REQUIREMENTS } from '../tools/build-runtime.mjs';
import { BackendManager } from '../lib/backend-manager.js';

const pkg = fileURLToPath(new URL('../', import.meta.url));
const identity = { ok: true, model: { configured: false }, grid: {} };
const response = () => ({ ok: true, json: async () => identity });
const refused = async () => { throw new Error('refused'); };
function child() {
  const value = new EventEmitter();
  Object.assign(value, { pid: 1234, stdin: new EventEmitter(), stdout: new EventEmitter(), stderr: new EventEmitter(), ended: 0 });
  value.stdin.end = () => { value.ended++; queueMicrotask(() => value.emit('exit', 0)); };
  value.kill = () => queueMicrotask(() => value.emit('exit', 0));
  return value;
}

test('runtime allowlist is deterministic, contains original algorithm bytes, excludes private payloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'st-build-'));
  try {
    const first = await buildRuntime({ outputRoot: join(root, 'runtime') });
    const manifest1 = await readFile(join(root, 'runtime/manifest.json'), 'utf8');
    const second = await buildRuntime({ outputRoot: join(root, 'runtime') });
    assert.equal(await readFile(join(root, 'runtime/manifest.json'), 'utf8'), manifest1);
    assert.equal(first.files, 61); assert.deepEqual(first.manifest, second.manifest);
    assert.deepEqual(await readFile(join(root, 'runtime/backend/review_context.py')), await readFile(resolve(pkg, '../backend/review_context.py')));
    assert.match(await readFile(join(root, 'runtime/LICENSE'), 'utf8'), /MIT License/);
    assert.equal((await readFile(join(root, 'runtime/requirements.txt'), 'utf8')), REQUIREMENTS);
    assert.equal(REQUIREMENTS.trim().split('\n').length, 8);
    for (const name of ['fullfit.py', 'rules.py', 'features.py', 'evaluate.py', 'stats.py', 'data.py', 'scan.py']) {
      assert.deepEqual(await readFile(join(root, 'runtime/super_trader', name)), await readFile(resolve(pkg, '../super_trader', name)));
    }
    assert.doesNotMatch(Object.keys(first.manifest.files).join('\n'), /(?:state\.db|key\.txt|\.pyc|reports\/|cache\/|tests\/)/);
    await writeFile(join(root, 'runtime/DO_NOT_PACKAGE.txt'), 'unexpected');
    await assert.rejects(buildRuntime({ outputRoot: join(root, 'runtime') }), /Unexpected runtime file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('portable runtime paths are writable external state, while explicit/source repo keeps compatibility', async () => {
  const root = resolve(tmpdir(), 'st-state-portable');
  let calls = 0, options;
  const owned = child();
  const manager = new BackendManager({ env: { DSH_PROFILE_DIR: root }, sourceRoot: '/missing-source', runtimeRoot: '/bundle/runtime', exists: path => !path.includes('missing-source'), fetch: async () => ++calls === 1 ? refused() : response(), spawn: (_exe, _args, opts) => { options = opts; return owned; } });
  assert.equal(manager.portable, true);
  assert.equal((await manager.ensureBackend()).phase, 'running');
  assert.equal(options.cwd, resolve('/bundle/runtime'));
  assert.equal(options.env.ST_PORTABLE_RUNTIME, '1');
  assert.equal(options.env.ST_STATE_DB, join(root, 'super-trader-data/state.db'));
  assert.equal(options.env.SUPER_TRADER_CACHE_DIR, join(root, 'super-trader-data/cache'));
  assert.equal(options.env.SUPER_TRADER_DATA_ROOT, undefined);
  assert.equal(options.env.SUPER_TRADER_REPORT_DIR, undefined);
  await manager.dispose();
  const explicit = new BackendManager({ env: { ST_REPO_ROOT: '/explicit', ST_STATE_DIR: root }, repoRoot: '/ignored', exists: () => false });
  assert.equal(explicit.repoRoot, resolve('/explicit')); assert.equal(explicit.portable, false);
  assert.equal(explicit.backendEnv(new URL('http://localhost:4567')).ST_STATE_DB, undefined);
  await explicit.dispose();
});

test('explicit retry shares one operation, restarts only failed owned state, healthy external stays external', async () => {
  let available = false, launches = 0, probeCount = 0;
  const manager = new BackendManager({ env: {}, exists: () => available, fetch: async () => ++probeCount > 2 && launches ? response() : refused(), spawn: () => { launches++; return child(); }, pollIntervalMs: 1 });
  assert.equal((await manager.ensureBackend()).phase, 'backend_missing');
  assert.equal((await manager.ensureBackend()).phase, 'backend_missing');
  available = true;
  const pending = manager.retryBackend(); assert.equal(pending, manager.retryBackend()); assert.equal(pending, manager.ensureBackend());
  assert.equal((await pending).phase, 'running'); assert.equal(launches, 1);
  const pid = manager.getState().pid; assert.equal((await manager.retryBackend()).phase, 'running'); assert.equal(manager.getState().pid, pid); assert.equal(launches, 1);
  await manager.dispose();
  const external = new BackendManager({ env: {}, fetch: async () => response(), spawn: () => { throw new Error('must not spawn'); } });
  await external.ensureBackend(); assert.equal((await external.retryBackend()).phase, 'external'); await external.dispose();
});

test('retry reaps a failed owned child before starting its replacement and never stops healthy/external owners', async () => {
  const children = [];
  const manager = new BackendManager({ env: {}, exists: () => true, fetch: async () => children.length && !children.at(-1).ended ? response() : refused(), spawn: () => { const value = child(); children.push(value); return value; } });
  assert.equal((await manager.ensureBackend()).phase, 'running');
  manager.fail('start_failed', 'controlled failure');
  const retry = manager.retryBackend(); assert.equal(retry, manager.retryBackend());
  assert.equal((await retry).phase, 'running');
  assert.equal(children.length, 2); assert.equal(children[0].ended, 1); assert.equal(children[1].ended, 0);
  await manager.retryBackend(); assert.equal(children[1].ended, 0); assert.equal(children.length, 2);
  await manager.dispose(); assert.equal(children[1].ended, 1);
  let healthy = true;
  const external = new BackendManager({ env: {}, fetch: async () => healthy ? response() : refused(), spawn: () => { throw new Error('no spawn during ready retry'); } });
  await external.ensureBackend(); healthy = false;
  assert.equal((await external.retryBackend()).phase, 'exited');
  assert.equal(external.getState().managed, false); await external.dispose();
});

test('portable environment preserves explicit data/report/state/cache selections', () => {
  const env = { ST_PORTABLE_RUNTIME: '1', ST_STATE_DIR: '/state', ST_STATE_DB: '/db/custom.sqlite', SUPER_TRADER_DATA_ROOT: '/research', SUPER_TRADER_REPORT_DIR: '/reports', SUPER_TRADER_CACHE_DIR: '/cache' };
  const manager = new BackendManager({ env });
  const actual = manager.backendEnv(new URL('http://127.0.0.1:8765'));
  for (const [key, value] of Object.entries(env)) assert.equal(actual[key], key === 'ST_STATE_DIR' ? resolve(value) : value);
});

// Opt-in real process test; uses a disposable copy OUTSIDE the source repository,
// an OS-assigned independent port, no inherited credentials and no research files.
test('isolated portable backend starts without keys/data and returns controlled degradation', { skip: process.env.ST_PORTABLE_SMOKE !== '1', timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'st 移植 smoke '));
  let manager;
  try {
    const packageRoot = join(root, 'installed/plugin');
    await mkdir(join(packageRoot, 'lib'), { recursive: true });
    await writeFile(join(packageRoot, 'package.json'), '{"type":"module"}');
    for (const name of ['backend-manager.js', 'backend-supervisor.py']) await copyFile(join(pkg, 'lib', name), join(packageRoot, 'lib', name));
    await buildRuntime({ outputRoot: join(packageRoot, 'runtime') });
    const server = createServer();
    await new Promise((resolvePromise, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolvePromise));
    const port = server.address().port; await new Promise(resolvePromise => server.close(resolvePromise));
    assert.notEqual(port, 8000); assert.notEqual(port, 8711);
    const env = {};
    for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { ST_BASE_URL: `http://127.0.0.1:${port}`, ST_PYTHON: process.env.ST_PYTHON || 'python', ST_STATE_DIR: join(root, 'user state'), PYTHONDONTWRITEBYTECODE: '1' });
    const { BackendManager: PortableManager } = await import(pathToFileURL(join(packageRoot, 'lib/backend-manager.js')).href);
    manager = new PortableManager({ env, startTimeoutMs: 40000, stopTimeoutMs: 2000 });
    assert.equal(manager.portable, true);
    const state = await manager.ensureBackend();
    assert.equal(state.phase, 'running', JSON.stringify(state));
    const status = await manager.request('GET', '/api/status');
    assert.equal(status.ok, true); assert.equal(status.model.configured, false);
    assert.equal(status.capabilities.research_data_available, false);
    assert.equal(status.capabilities.grid_available, false);
    assert.deepEqual(await manager.request('GET', '/api/symbols/search?q=601088'), { items: [] });
    await assert.rejects(manager.request('GET', '/api/quant/probability?code=601088&horizon=10'), error => error.status === 503);
    await assert.rejects(manager.request('GET', '/api/market/quotes?codes=601088'), error => error.status === 503 && error.body.code === 'market_not_configured');
    assert.ok(Array.isArray((await manager.request('GET', '/api/experts')).items));
    await manager.dispose(); assert.equal(manager.getState().pid, null);
    await assert.rejects(fetch(`${env.ST_BASE_URL}/api/status`, { signal: AbortSignal.timeout(1000) }));
    console.log('portable smoke: independent runtime, no keys/data, temporary DB, controlled 503, owned cleanup passed');
  } finally {
    await manager?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
