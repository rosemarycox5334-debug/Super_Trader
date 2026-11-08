'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
const root = path.resolve(__dirname, '../web/workbench');
function load(saved) {
  const helpers = fs.readFileSync(path.join(root, 'conversation_helpers.js'), 'utf8');
  let app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const initializer = "  const D = JSON.parse(document.getElementById('workbench-data').textContent);";
  assert.equal(app.split(initializer).length, 2);
  const marker = "  document.addEventListener('click',";
  assert.equal(app.split(marker).length, 2);
  app = app.slice(0, app.indexOf(marker)).replace(initializer, '  const D = globalThis.snapshot;');
  app += `globalThis.api={defaultState,validateState,cfgSnapshot,computeResearch,appendChatMessage,messageHTML,esc,
    getState:()=>state,setState:s=>{state=s;},getWarning:()=>startupWarning};})();`;
  const context = vm.createContext({snapshot: {records: ['601088','600900'].map(code=>({category:'个股',code})),mainstream:[]},
    localStorage:{getItem:()=>saved ? JSON.stringify(saved) : null}});
  vm.runInContext(helpers+'\n'+app, context, {timeout:1000});
  return { ...context.api, clean:context.cleanMessages, normalize:context.normalizeConversationState,
    sync:context.syncConversationState, create:context.createConversationState, switch:context.switchConversationState };
}
const msg = text => ({role:'user',text,time:'09:00'});
function initialized(api) { const s=api.defaultState(); Object.assign(s,api.normalize(s));api.setState(s);return s; }

test('legacy schema3 migration is idempotent and leaves input untouched',()=>{
  const api=load(), legacy={messages:[msg('旧问题')]}, before=plain(legacy);
  const migrated=api.normalize(legacy);
  assert.deepEqual(plain(legacy),before);
  assert.equal(migrated.conversations.length,1);
  assert.deepEqual(plain(migrated.messages),legacy.messages);
  assert.deepEqual(plain(api.normalize(plain(migrated))),plain(migrated));
});
test('authoritative conversations replace stale mirror; invalid active falls back deterministically',()=>{
  const api=load();const result=api.normalize({messages:[msg('stale')],activeConversationId:'missing',conversations:[{id:'a',messages:[msg('real')]}]});
  assert.equal(result.activeConversationId,'a');assert.equal(result.messages[0].text,'real');
  assert.deepEqual(plain(api.normalize(plain(result))),plain(result));
});
test('bad and duplicate sessions are isolated without losing config or tasks',()=>{
  const api=load(),s=api.defaultState();s.revision=8;s.experts[0].name='保留专家';
  const config=api.cfgSnapshot();const task={id:'SIM-1',title:'task',status:'cancelled',config,result:{counts:[],codes:[],admitted:[],assessments:[]}};
  s.tasks=[task];s.conversations=[null,{id:'bad<id'},{id:'a',messages:[msg('valid')]},{id:'a',messages:[msg('duplicate')]}];s.activeConversationId='absent';
  const restored=load(s);const r=restored.getState();assert.equal(restored.getWarning(),'');assert.equal(r.experts[0].name,'保留专家');assert.equal(r.revision,8);assert.equal(r.tasks.length,1);assert.equal(r.conversations.length,1);assert.equal(r.messages[0].text,'valid');
});
test('new conversation and switching preserve drafts, old messages, tasks and config revision',()=>{
  const api=load(),s=initialized(api);s.messages=[msg('first')];s.conversations[0].draft='first draft';s.tasks=[{id:'keep'}];
  const cfg=plain(api.cfgSnapshot());const first=s.activeConversationId;
  api.create(s,'second','today');s.conversations[0].draft='second draft';s.messages=[msg('second')];
  assert.equal(api.switch(s,first),true);assert.equal(s.messages[0].text,'first');assert.equal(s.conversations.find(c=>c.id===first).draft,'first draft');
  api.switch(s,'second');assert.equal(s.messages[0].text,'second');assert.equal(s.conversations[0].draft,'second draft');assert.deepEqual(plain(api.cfgSnapshot()),cfg);assert.equal(s.tasks[0].id,'keep');
});
test('message array reassignment syncs and switched mirrors are detached',()=>{
  const api=load(),s=initialized(api),first=s.activeConversationId;
  s.messages=[msg('one'),msg('two')].slice(-1);api.sync(s);assert.equal(s.conversations[0].messages[0].text,'two');
  api.create(s,'b','');api.switch(s,first);s.messages[0].text='changed';assert.equal(s.conversations.find(c=>c.id===first).messages[0].text,'two');api.sync(s);assert.equal(s.conversations.find(c=>c.id===first).messages[0].text,'changed');
  assert.equal(api.switch(s,'missing'),false);assert.equal(s.activeConversationId,first);
});
test('conversation cap throws without deleting prior history; invalid and duplicate IDs fail',()=>{
  const api=load(),s=initialized(api);for(let i=1;i<30;i++)api.create(s,'c'+i,'');
  const before=plain(s);assert.throws(()=>api.create(s,'overflow',''),/30/);assert.deepEqual(plain(s),before);
  for(const id of ['c1','<script>','', 'x'.repeat(71)])assert.throws(()=>api.create(s,id,''),/ID/);
});
test('metadata is sanitized and retained through conversation startup roundtrip',()=>{
  const api=load(),s=initialized(api);s.messages=[{...msg('result'),role:'assistant',taskId:'SIM-1',recordKeys:['个股|601088','个股|601088',42,'x'.repeat(45)]}];api.sync(s);
  const r=load(plain(s)).getState();assert.equal(r.messages[0].taskId,'SIM-1');assert.deepEqual(plain(r.messages[0].recordKeys),['个股|601088']);
  const bad=api.clean([{...msg('safe'),taskId:'\" onclick=bad',recordKeys:null}, {role:'system',text:'drop'},null]);assert.equal(bad.length,1);assert.equal(Object.hasOwn(bad[0],'taskId'),false);
});
test('task ownership survives validation and background append targets origin only',()=>{
  const api=load(),s=initialized(api),origin=s.activeConversationId;const config=api.cfgSnapshot();
  const task={id:'SIM-OWNED',conversationId:origin,title:'owned',status:'cancelled',config,result:{counts:[],codes:[],admitted:[],assessments:[]}};
  s.tasks=[task];s.lastResult=task;api.create(s,'other','');api.appendChatMessage({role:'assistant',text:'done',taskId:task.id,time:'10:00'},origin);
  assert.equal(s.messages.length,0);assert.equal(s.conversations.find(c=>c.id===origin).messages[0].taskId,task.id);
  const restored=load(plain(s)).getState();assert.equal(restored.tasks[0].conversationId,origin);assert.equal(restored.lastResult.conversationId,origin);assert.equal(restored.activeConversationId,'other');assert.equal(restored.messages.length,0);
});
test('untrusted text remains inert on render and invalid session IDs are discarded',()=>{
  const api=load(),payload='<img src=x onerror=alert(1)>',s=initialized(api);const html=api.messageHTML(msg(payload));
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));assert.equal(api.normalize({conversations:[{id:'\" onclick=bad',title:payload}]}).conversations[0].id,'chat-start');
  const clean=api.clean([{...msg('x'.repeat(6000)),time:'t'.repeat(100)}]);assert.equal(clean[0].text.length,5000);assert.equal(clean[0].time.length,30);
});
