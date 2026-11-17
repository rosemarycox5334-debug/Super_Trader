import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const BUNDLED_RUNTIME = resolve(PACKAGE_ROOT, 'runtime');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SUPERVISOR = fileURLToPath(new URL('./backend-supervisor.py', import.meta.url));
const READY = new Set(['external', 'running']);
const FAILURES = new Set(['python_missing', 'dependency_missing', 'start_timeout', 'exited', 'start_failed', 'port_conflict', 'backend_missing', 'invalid_config']);

export class BackendError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'BackendError'; this.code = code;
    Object.assign(this, details);
  }
}

/** A bounded promise even when an injected fetch ignores AbortSignal. */
function bounded(operation, { signal, timeoutMs, code = 'request_timeout' } = {}) {
  const controller = new AbortController();
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let timer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      fn(value);
    };
    const abort = () => {
      controller.abort(signal?.reason);
      finish(reject, new BackendError('cancelled', 'Operation cancelled'));
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    if (Number.isFinite(timeoutMs)) timer = setTimeout(() => {
      controller.abort(); finish(reject, new BackendError(code, 'Operation timed out'));
    }, Math.max(0, timeoutMs));
    Promise.resolve().then(() => {
      if (settled) return;
      return operation(controller.signal);
    }).then(value => finish(resolvePromise, value), error => finish(reject, error));
  });
}

function sleep(ms, signal) {
  return new Promise(resolvePromise => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolvePromise(); };
    const timer = setTimeout(finish, ms);
    if (signal?.aborted) finish();
    else signal?.addEventListener('abort', finish, { once: true });
  });
}

/** Local-only backend lifecycle. No process or network activity until ensureBackend/request/doctor. */
export class BackendManager {
  constructor(options = {}) {
    this.env = options.env ?? process.env;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.spawn = options.spawn ?? nodeSpawn;
    this.exists = options.exists ?? existsSync;
    this.platform = options.platform ?? process.platform;
    const sourceRoot = options.sourceRoot ?? ROOT;
    const sourceLayout = this.exists(resolve(sourceRoot, 'backend', 'serve.py')) && this.exists(resolve(sourceRoot, 'super_trader', 'config.py'));
    const explicitRoot = this.env.ST_REPO_ROOT || options.repoRoot;
    this.repoRoot = resolve(explicitRoot || (sourceLayout ? sourceRoot : options.runtimeRoot || BUNDLED_RUNTIME));
    this.portable = this.env.ST_PORTABLE_RUNTIME === '1' || (!explicitRoot && !sourceLayout);
    this.stateRoot = resolve(this.env.ST_STATE_DIR || options.stateRoot || (this.env.DSH_PROFILE_DIR ? resolve(this.env.DSH_PROFILE_DIR, 'super-trader-data') : resolve(options.homeDir || homedir(), '.super-trader')));
    this.python = this.env.ST_PYTHON || options.python || 'python';
    this.probeTimeoutMs = options.probeTimeoutMs ?? 1500;
    this.startTimeoutMs = options.startTimeoutMs ?? 20000;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 1000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120000;
    this.now = options.now ?? Date.now;
    this.supervisorPath = options.supervisorPath ?? SUPERVISOR;
    this.controller = new AbortController();
    this.owned = null; this.pending = null; this.disposal = null; this.logs = ''; this.stopping = new WeakMap();
    this.state = { phase: 'idle', baseUrl: '', managed: false, pid: null, lastError: null };
    try {
      const url = new URL(this.env.ST_BASE_URL || options.baseUrl || 'http://127.0.0.1:8000');
      if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
        throw new Error('ST_BASE_URL must be a loopback HTTP(S) origin without credentials, path, query or fragment');
      }
      this.state.baseUrl = url.origin;
      this.allowFallback = !this.env.ST_BASE_URL && !options.baseUrl;
    } catch (error) { this.fail('invalid_config', error.message); }
  }

  redact(value) {
    let text = String(value);
    for (const [name, secret] of Object.entries(this.env)) {
      if (/key|token|secret|password|authorization/i.test(name) && typeof secret === 'string' && secret.length >= 3) text = text.split(secret).join('[REDACTED]');
    }
    return text.replace(/\b(?:sk-|sk_)[A-Za-z0-9_-]+/gi, '[REDACTED]')
      .replace(/((?:api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s,"'}]+/gi, '$1[REDACTED]')
      .replace(/\bBearer\s+[^\s,"'}]+/gi, 'Bearer [REDACTED]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  }

  safe(value) {
    if (value === undefined) return null;
    // Redact diagnostic keys as well as strings; never publish env or process options.
    return JSON.parse(JSON.stringify(value, (key, item) => /(?:api[_-]?key|token|secret|password|authorization|headers)/i.test(key) ? '[REDACTED]' : typeof item === 'string' ? this.redact(item) : item));
  }

  getState() { return this.safe({ ...this.state, logTail: this.logs.slice(-12000).split(/\r?\n/).slice(-60).join('\n') }); }
  fail(phase, message) { this.state.phase = phase; this.state.lastError = { code: phase, message: this.redact(message) }; }

  async probe(baseUrl = this.state.baseUrl, signal = this.controller.signal, timeoutMs = this.probeTimeoutMs) {
    try {
      return await bounded(async fetchSignal => {
        const response = await this.fetch(`${baseUrl}/api/status`, { signal: fetchSignal, redirect: 'error' });
        const body = await response.json();
        return { occupied: true, ok: response.ok === true && body?.ok === true && body.model !== null && typeof body.model === 'object' && !Array.isArray(body.model) && body.grid !== null && typeof body.grid === 'object' && !Array.isArray(body.grid), body };
      }, { signal, timeoutMs });
    } catch (error) {
      if (signal.aborted) throw error;
      // An HTTP responder with invalid JSON is occupied too. Timeout is conservatively occupied.
      return { ok: false, occupied: error.code === 'request_timeout' || error instanceof SyntaxError };
    }
  }

  ensureBackend() {
    if (this.pending) return this.pending;
    if (this.controller.signal.aborted || READY.has(this.state.phase) || FAILURES.has(this.state.phase)) return Promise.resolve(this.getState());
    this.pending = this.start().catch(error => {
      if (!this.controller.signal.aborted) this.fail('start_failed', error.message);
      return this.getState();
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  /** Explicit user action only. Failed automatic starts stay sticky until this call. */
  retryBackend() {
    if (this.pending) return this.pending;
    if (this.controller.signal.aborted || this.state.phase === 'invalid_config') return Promise.resolve(this.getState());
    if (!READY.has(this.state.phase) && !FAILURES.has(this.state.phase)) return this.ensureBackend();
    this.pending = (async () => {
      if (READY.has(this.state.phase)) {
        const check = await this.probe();
        if (!this.controller.signal.aborted && !check.ok) this.fail('exited', 'Backend no longer passes its identity probe; retry explicitly after checking the service');
        return this.getState();
      }
      const child = this.owned;
      if (child) await this.stopOwned(child);
      if (this.controller.signal.aborted || this.owned) return this.getState();
      this.state.phase = 'idle'; this.state.lastError = null; this.logs = '';
      return this.start();
    })().catch(error => {
      if (!this.controller.signal.aborted) this.fail('start_failed', error.message);
      return this.getState();
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  backendEnv(url) {
    const env = { ...this.env, ST_HOST: url.hostname === '[::1]' ? '::1' : url.hostname, ST_PORT: url.port || '80', PYTHONUNBUFFERED: '1', PYTHONUTF8: '1' };
    if (this.portable) Object.assign(env, {
      ST_PORTABLE_RUNTIME: '1', ST_STATE_DIR: this.stateRoot,
      ST_STATE_DB: this.env.ST_STATE_DB || resolve(this.stateRoot, 'state.db'),
      SUPER_TRADER_CACHE_DIR: this.env.SUPER_TRADER_CACHE_DIR || resolve(this.stateRoot, 'cache'),
    });
    return env;
  }

  async start() {
    const signal = this.controller.signal;
    this.state.phase = 'probing';
    let check = await this.probe();
    if (signal.aborted) return this.getState();
    if (check.ok) { this.state.phase = 'external'; return this.getState(); }
    if (check.occupied) {
      if (!this.allowFallback) { this.fail('port_conflict', 'Configured loopback endpoint is occupied by a different service'); return this.getState(); }
      this.state.baseUrl = 'http://127.0.0.1:8711';
      check = await this.probe();
      if (signal.aborted) return this.getState();
      if (check.ok) { this.state.phase = 'external'; return this.getState(); }
      if (check.occupied) { this.fail('port_conflict', 'Both 8000 and 8711 are occupied by other services'); return this.getState(); }
    }
    if (!this.exists(resolve(this.repoRoot, 'backend', 'serve.py')) || !this.exists(this.supervisorPath)) {
      this.fail('backend_missing', 'Missing backend/serve.py or plugin backend-supervisor.py; restore the packaged runtime or configure ST_REPO_ROOT'); return this.getState();
    }
    this.state.phase = 'starting';
    const url = new URL(this.state.baseUrl);
    if (url.protocol !== 'http:') { this.fail('invalid_config', 'Local Python backend only supports HTTP; use an existing HTTPS backend or configure HTTP'); return this.getState(); }
    let child;
    try {
      child = this.spawn(this.python, ['-u', this.supervisorPath], {
        cwd: this.repoRoot,
        env: this.backendEnv(url),
        // Windows non-detached children are killed by libuv's parent Job Object before
        // stdin EOF cleanup can run. Detach only the supervisor, retaining all pipes.
        windowsHide: true, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.fail(error.code === 'ENOENT' ? 'python_missing' : 'start_failed', error.message); return this.getState();
    }
    this.owned = child; this.state.managed = true; this.state.pid = child.pid ?? null;
    child.stdin?.on?.('error', () => {});
    const append = data => { this.logs = (this.logs + String(data)).slice(-24000); };
    child.stdout?.on('data', append); child.stderr?.on('data', append);
    child.on('error', error => {
      if (this.owned !== child || signal.aborted) return;
      this.fail(error.code === 'ENOENT' ? 'python_missing' : 'start_failed', error.message);
      if (!child.pid) { this.owned = null; this.state.managed = false; this.state.pid = null; }
    });
    child.on('exit', (code, exitSignal) => {
      if (this.owned !== child) return;
      this.owned = null; this.state.managed = false; this.state.pid = null;
      if (signal.aborted || FAILURES.has(this.state.phase)) return;
      this.fail(/(?:ModuleNotFoundError|ImportError|No module named)/i.test(this.logs) ? 'dependency_missing' : 'exited', `Backend exited (${code ?? exitSignal ?? 'unknown'}). ${this.logs.slice(-2000)}`);
    });
    const deadline = this.now() + this.startTimeoutMs;
    while (!signal.aborted && this.state.phase === 'starting') {
      const remaining = deadline - this.now();
      if (remaining <= 0) break;
      check = await this.probe(this.state.baseUrl, signal, Math.min(this.probeTimeoutMs, remaining));
      if (signal.aborted || this.state.phase !== 'starting') break;
      if (check.ok) { this.state.phase = 'running'; this.state.lastError = null; return this.getState(); }
      await sleep(Math.min(this.pollIntervalMs, Math.max(0, deadline - this.now())), signal);
    }
    if (!signal.aborted && this.state.phase === 'starting') this.fail('start_timeout', 'Backend did not become ready within the startup deadline');
    if (!signal.aborted && this.owned === child) await this.stopOwned(child);
    return this.getState();
  }

  async request(method, path, body, { signal, timeoutMs = this.requestTimeoutMs } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/api/') || path.includes('\\') || path.includes('#') || new URL(path, 'http://localhost').pathname !== path.split('?')[0]) throw new BackendError('invalid_path', 'Only /api/ paths without traversal are allowed');
    const lifetime = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    return bounded(async operationSignal => {
      await bounded(() => this.ensureBackend(), { signal: operationSignal });
      if (!READY.has(this.state.phase)) throw new BackendError(this.state.phase, 'Super Trader backend is unavailable', { state: this.getState() });
      const response = await this.fetch(`${this.state.baseUrl}${path}`, {
        method, signal: operationSignal, redirect: 'error',
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let value;
      try { value = JSON.parse(text); } catch { value = text; }
      if (!response.ok) throw new BackendError('http_error', `Backend HTTP ${response.status}`, { status: response.status, body: value });
      return value;
    }, { signal: lifetime, timeoutMs });
  }

  stopOwned(child) {
    if (!child || this.owned !== child) return Promise.resolve();
    if (this.stopping.has(child)) return this.stopping.get(child);
    const waitForExit = () => new Promise(resolvePromise => {
      let timer;
      const finish = () => { clearTimeout(timer); child.removeListener?.('exit', finish); resolvePromise(); };
      child.once?.('exit', finish);
      if (this.owned !== child) finish();
      else timer = setTimeout(finish, this.stopTimeoutMs);
    });
    const stopping = (async () => {
      // EOF asks the watchdog to reap its child. Never signal an external or exited PID.
      try { child.stdin?.end?.(); } catch {}
      await waitForExit();
      if (this.owned !== child) return;
      const hardKill = () => { if (this.owned === child) { try { child.kill?.('SIGKILL'); } catch {} } };
      try {
        if (this.platform === 'win32' && child.pid) {
          const killer = this.spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.on?.('error', hardKill);
          killer.on?.('exit', code => { if (code !== 0) hardKill(); });
        } else child.kill?.('SIGTERM');
      } catch { hardKill(); }
      await waitForExit();
      if (this.owned === child) {
        hardKill();
        await waitForExit();
      }
      if (this.owned === child) {
        // Retain ownership until an actual exit, rather than claiming cleanup succeeded.
        this.logs = (this.logs + '\nOwned supervisor did not confirm exit after termination.').slice(-24000);
      }
    })();
    this.stopping.set(child, stopping);
    return stopping;
  }

  dispose() {
    if (this.disposal) return this.disposal;
    this.controller.abort(); this.state.phase = 'disposed';
    const child = this.owned;
    this.disposal = (async () => { await this.stopOwned(child); await this.pending; return this.getState(); })();
    return this.disposal;
  }

  async doctor({ signal } = {}) {
    const state = await bounded(() => this.ensureBackend(), { signal });
    let status = null;
    if (READY.has(state.phase)) {
      const result = await this.probe(state.baseUrl, signal ?? this.controller.signal);
      status = result.ok ? this.safe(result.body) : { ok: false, error: 'Backend status probe failed' };
    }
    const guidance = {
      python_missing: 'Install Python 3.10+ or set ST_PYTHON to the interpreter path; reload the plugin.',
      dependency_missing: 'Use ST_PYTHON to select Python 3.10+ with the dependencies in runtime/requirements.txt (or repository requirements.txt), then explicitly retry. No automatic pip install is performed.',
      backend_missing: 'Restore the packaged runtime/backend and runtime/super_trader directories, or set ST_REPO_ROOT to a complete source repository; then reload or explicitly retry.',
      start_timeout: 'Inspect the redacted log tail, backend data and dependencies; resolve the cause and reload the plugin.',
      port_conflict: 'Free the loopback port or set ST_BASE_URL to an existing Super Trader loopback backend; reload the plugin.',
      invalid_config: 'Set ST_BASE_URL to a loopback HTTP origin, without credentials or paths; reload the plugin.',
      exited: 'Inspect the redacted log tail, repair the backend environment, then reload the plugin.',
      start_failed: 'Check ST_PYTHON, repository access and the redacted log tail; reload the plugin.',
      disposed: 'The plugin is disposed. Reload it to use the backend.',
    };
    return { state: this.getState(), status, guidance: guidance[state.phase] ?? (status?.ok === false ? 'The previously ready backend no longer passes its identity probe. Check the service and reload the plugin; no automatic restart was attempted.' : status?.model?.configured === false ? 'Backend ready. Configure a model key in the backend environment to enable experts; no conclusions are fabricated.' : 'Backend ready; probabilities are in-sample historical frequencies, not calibrated forecasts.') };
  }
}
