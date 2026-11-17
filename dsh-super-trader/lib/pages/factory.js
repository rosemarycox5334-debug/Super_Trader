// Factory template. build-pages.mjs inserts original page functions and lifecycle helpers.
export function createPages(environment) {
  'use strict';
  /* LIFECYCLE */
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
    /* PAGES */
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
