import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../tools/ai-bridge-source.js',import.meta.url),'utf8');
function setup({draftResult='applied',entries=[{id:'S1',retainedBy:{mainView:1}}]}={}){
  const calls=[];const nav=new AbortController();
  const services={sessions:{list:{getSnapshot:()=>({byId:Object.fromEntries(entries.map(i=>[i.id,i]))})},retain(id,opts){calls.push(['retain',id,opts.source]);return {binding:{id},ready:Promise.resolve(),release(){calls.push(['release']);}};}},conversation:{input:{requestDraftInitialization(binding,opts){calls.push(['draft',binding.id,opts]);return draftResult;}}},layout:{beginNavigation:()=>nav.signal,selectPanel:id=>calls.push(['panel',id])},uiWorkspace:{openSession:id=>calls.push(['open',id])}};
  const sandbox=vm.createContext({});vm.runInContext(source+'\nglobalThis.bridge=createAnalysisBridge;globalThis.current=currentResearchSession;',sandbox);
  const ctx={get:name=>services[name]};
  return {services,calls,nav,make:props=>sandbox.bridge(ctx,props),current:props=>sandbox.current(ctx,props)};
}
test('analysis prepares existing exact session draft without prompt/send',async()=>{
  const {make,calls}=setup();const result=await make({})('code 601088; probability=null; source-time=123');
  assert.equal(result.submitted,false);assert.equal(result.sessionId,'S1');assert.equal(result.status,'draft_prepared');
  assert.deepEqual(calls.map(c=>c[0]),['retain','draft','open','release']);
  assert.equal(calls[1][2].whenDraftExists,'keep');
});
test('existing draft never overwritten, error is actionable and reference released',async()=>{
  const {make,calls}=setup({draftResult:'preserved'});
  await assert.rejects(make({})('research context'),/原有草稿已保留/);
  assert.deepEqual(calls.map(c=>c[0]),['retain','draft','release']);
});
test('does not select a random background or ambiguous retained session',async()=>{
  // User decision: desktop capability errors use neutral wording, not a product name.
  const {make,calls}=setup({entries:[{id:'background',retainedBy:{controllerOperation:1}}]});
  await assert.rejects(make({})('context'),/请先选择一个会话/);assert.equal(calls.length,0);
  const ambiguous=setup({entries:[{id:'A',retainedBy:{mainView:1}},{id:'B',retainedBy:{mainView:1}}]});
  await assert.rejects(ambiguous.make({})('context'),/请先选择一个会话/);
});
test('session-scoped props take precedence, unavailable API keeps copy fallback',async()=>{
  const {make,calls}=setup();await make({sessionId:'S2'})('context');assert.equal(calls[0][1],'S2');
  const unsupported=setup();delete unsupported.services.conversation;
  await assert.rejects(unsupported.make({})('context'),/草稿初始化接口/);assert.equal(unsupported.calls.length,0);
});
test('navigation cancellation releases borrowed reference without draft write',async()=>{
  const {make,calls,nav,services}=setup();
  let releaseReady;const ready=new Promise(resolve=>releaseReady=resolve);
  services.sessions.retain=(id)=>({binding:{id},ready,release(){calls.push(['release']);}});
  const pending=make({})('context');nav.abort();releaseReady();
  await assert.rejects(pending,/导航已取消/);assert.deepEqual(calls,[['release']]);
});
