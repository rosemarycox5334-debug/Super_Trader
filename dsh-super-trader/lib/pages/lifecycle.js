// Page-owned resources; no DOM dependencies so cancellation/fallback can be tested offline.
export function createLifecycle(parentSignal) {
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

export function watchJob({ url, get, signal, onJob, onError, EventSourceImpl = globalThis.EventSource, schedule = setTimeout, unschedule = clearTimeout, interval = 1200 }) {
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
