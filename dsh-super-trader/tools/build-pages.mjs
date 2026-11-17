// Reuse, do not reimplement, the existing web UI's rendering/business wiring.
// Run from any cwd: node dsh-super-trader/tools/build-pages.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const base = fileURLToPath(new URL('../', import.meta.url));
const original = await readFile(path.resolve(base, '../web/app/assets/app.js'), 'utf8');
const between = (start, end) => {
  const a = original.indexOf(start), b = original.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error('Original page extraction marker missing: ' + start);
  return original.slice(a, b).trim();
};
function migrate(source) {
  return source
    .replace(/byDate\.querySelector\("input"\)\.addEventListener\(/g, 'listen(byDate.querySelector("input"), ')
    .replace(/\b(search|results|goBtn|runBtn|row|save)\.addEventListener\(/g, 'listen($1, ')
    .replace('setTimeout(doSearch, 250)', 'setTimeout(() => doSearch().catch(report), 250)')
    .replace('analyzeTeam(code.value.trim(), null, +horizon.value);', 'return analyzeTeam(code.value.trim(), null, +horizon.value);')
    .replace('streamJob(job.id, resultCard, () => { runBtn.disabled = false; });', 'await streamJob(job.id, resultCard, () => { runBtn.disabled = false; });')
    .replace('await api.del(`/journal/${j.id}`); refresh();', 'await api.del(`/journal/${j.id}`); await refresh();')
    .replace('window.__journalRefresh = refresh;', 'journalRefresh = refresh;')
    .replace('if (window.__journalRefresh) window.__journalRefresh();', 'if (journalRefresh) await journalRefresh();')
    .replace('window.open("/api/journal/export?fmt=csv", "_blank")', 'exportJournal("csv")')
    .replace('window.open("/api/journal/export?fmt=json", "_blank")', 'exportJournal("json")')
    .replace('code: codeI.value.trim(), action:', 'code: codeI.value.trim(), category, action:')
    .replace('text: "复盘", onclick: () => doReview(card, j.id) }),', 'text: "复盘", onclick: () => doReview(card, j.id) }),\n    el("button", { class: "btn ghost sm", text: "补填 / 备注", onclick: () => openJournalEdit(j, refresh) }),')
    .replace('if (j.reasons && j.reasons.summary) card.append', 'if (j.note) card.append(el("p", { class: "muted", text: "备注：" + j.note }));\n  if (j.reasons && j.reasons.summary) card.append');
}
const modules = {
  quant: between('PAGES.quant =', '// ================================================================== 页面：专家团队'),
  experts: between('PAGES.experts =', '// ================================================================== 页面：自选股'),
  watchlist: between('PAGES.watchlist =', 'function streamJob(') + '\n\n' + between('function renderBatchItems(', '// ================================================================== 页面：操盘记录'),
  journal: between('PAGES.journal =', '// ================================================================== 页面：记忆') + '\n\n' + between('function openJournalModal(', '// ------------------------------------------------------------------ Modal 基础设施'),
};
await mkdir(path.join(base, 'lib/pages'), { recursive: true });
for (const [name, source] of Object.entries(modules)) {
  const heading = '// Generated from web/app/assets/app.js by tools/build-pages.mjs.\n// Original page functions retained; migration patches are in the build tool.\n';
  await writeFile(path.join(base, 'lib/pages', name + '.js'), heading + migrate(source) + '\n');
}
const lifecycle = (await readFile(path.join(base, 'lib/pages/lifecycle.js'), 'utf8')).replace(/^export /gm, '');
const factory = await readFile(path.join(base, 'lib/pages/factory.js'), 'utf8');
const pages = Object.values(modules).map(migrate).join('\n\n');
const bundle = factory.replace('/* LIFECYCLE */', lifecycle).replace('/* PAGES */', pages);
if (/\bimport\s/.test(bundle)) throw new Error('Bundle must not contain ESM imports');
await writeFile(path.join(base, 'lib/pages-bundle.js'), '// Generated self-contained factory; inline createPages.toString() in ModuleLoader.\n' + bundle);
console.log('Built lib/pages-bundle.js (four original pages, self-contained createPages)');
