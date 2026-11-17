import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ExpertCreationService} from '../lib/expert-creation.js';

const title='新建专家';
const requirement='创建一位关注现金流质量的价值投资风格专家';
const requestId='expert-request-20261117-0001';
const request2='expert-request-20261117-0002';
const diskFs={mkdir,readFile,writeFile,rename};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

async function setup(t,{existing=false}={}){
  const root=await mkdtemp(join(tmpdir(),'st-expert-creation-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const defaultDirectory=join(root,'default'),existingDirectory=join(root,'registered');
  await mkdir(defaultDirectory);await mkdir(existingDirectory);
  const rows=existing?[{id:'W-existing',title,path:existingDirectory}]:[];
  const calls={list:[],workspaceCreate:[],sessionCreate:[],sessionRename:[],prompt:[]};
  const hooks={};let nextWorkspace=0,nextSession=0,nextUuid=0;
  const workspaces={
    list(){calls.list.push(true);return [...rows];},
    async create(path,name){
      calls.workspaceCreate.push({path,title:name});
      if(hooks.workspaceCreate)return hooks.workspaceCreate(path,name);
      const same=rows.find(row=>row.path===path);
      if(same)return same;
      const value={id:'W-'+(++nextWorkspace),title:name,path};rows.push(value);return value;
    },
  };
  const sessions={
    async create(request){
      calls.sessionCreate.push(structuredClone(request));
      if(hooks.sessionCreate)return hooks.sessionCreate(request);
      return {sessionId:'S-'+(++nextSession)};
    },
    async rename(request){calls.sessionRename.push(structuredClone(request));return hooks.sessionRename?.(request)??{title:request.title,seq:1};},
    async prompt(request,signal){calls.prompt.push({request:structuredClone(request),signal});return hooks.prompt?hooks.prompt(request,signal):{accepted:true};},
  };
  const make=overrides=>new ExpertCreationService({workspaces,sessions,workingDirectory:{defaultDirectory},uuid:()=>`test-generated-uuid-${++nextUuid}`, ...overrides});
  const service=make();
  return {root,defaultDirectory,existingDirectory,rows,calls,hooks,workspaces,sessions,make,service};
}
function recordPath(workspace,id=requestId){return join(workspace.path,'.super-trader','expert-creation',id+'.json');}
function status(expected){return error=>{assert.equal(error.status,expected);return true;};}

// All Session/Workspace operations below are mocks. The only real writes are
// receipts under this test's unique temporary directory; no model is invoked.

test('existing exact-title Workspace is reused without registering another directory',async t=>{
  const h=await setup(t,{existing:true});
  const receipt=await h.service.start({requirement,request_id:requestId});
  assert.equal(receipt.workspaceId,'W-existing');assert.equal(receipt.workspaceTitle,title);
  assert.equal(h.calls.workspaceCreate.length,0);
  await assert.rejects(stat(join(h.defaultDirectory,title)),{code:'ENOENT'});
  const saved=JSON.parse(await readFile(recordPath(h.rows[0]),'utf8'));
  assert.equal(saved.accepted,true);assert.equal(saved.sessionId,receipt.sessionId);
});

test('missing Workspace creates a child directory, registers it, and writes a durable receipt',async t=>{
  const h=await setup(t),receipt=await h.service.start({requirement,request_id:requestId});
  const path=join(h.defaultDirectory,title);
  assert.equal((await stat(path)).isDirectory(),true);
  assert.deepEqual(h.calls.workspaceCreate,[{path,title}]);
  assert.equal(receipt.workspaceId,h.rows[0].id);assert.equal(receipt.sessionId,'S-1');
  const saved=JSON.parse(await readFile(recordPath(h.rows[0]),'utf8'));
  assert.equal(saved.requirement,requirement);assert.equal(saved.requestId,requestId);assert.equal(saved.accepted,true);
});

test('every distinct request gets a new independent Session without a reuse sessionId',async t=>{
  const h=await setup(t,{existing:true});
  const a=await h.service.start({requirement,request_id:requestId});
  const b=await h.service.start({requirement,request_id:request2});
  assert.notEqual(a.sessionId,b.sessionId);
  assert.deepEqual(h.calls.sessionCreate,[{workspaceId:'W-existing'},{workspaceId:'W-existing'}]);
  assert.ok(h.calls.sessionCreate.every(value=>!Object.hasOwn(value,'sessionId')));
  assert.deepEqual(h.calls.prompt.map(value=>value.request.sessionId),[a.sessionId,b.sessionId]);
  assert.deepEqual(h.calls.prompt.map(value=>value.request.requestId),[requestId,request2]);
});

test('concurrent identical request shares one promise and one prompt',async t=>{
  const h=await setup(t),gate=deferred();
  h.hooks.prompt=()=>gate.promise;
  const a=h.service.start({requirement,request_id:requestId});
  const b=h.service.start({requirement,request_id:requestId});
  assert.equal(a,b);
  gate.resolve({accepted:true});
  const [r1,r2]=await Promise.all([a,b]);assert.equal(r1,r2);
  assert.equal(h.calls.workspaceCreate.length,1);assert.equal(h.calls.sessionCreate.length,1);assert.equal(h.calls.prompt.length,1);
});

test('same in-flight request id with different requirement is rejected without another Session',async t=>{
  const h=await setup(t),gate=deferred();h.hooks.prompt=()=>gate.promise;
  const first=h.service.start({requirement,request_id:requestId});
  await assert.rejects(h.service.start({requirement:'创建不同策略的专家',request_id:requestId}),status(409));
  gate.resolve({accepted:true});await first;
  assert.equal(h.calls.sessionCreate.length,1);assert.equal(h.calls.prompt.length,1);
});

test('different concurrent requests coalesce Workspace registration, not their Sessions',async t=>{
  const h=await setup(t);
  const [a,b]=await Promise.all([h.service.start({requirement,request_id:requestId}),h.service.start({requirement,request_id:request2})]);
  assert.equal(h.calls.workspaceCreate.length,1);assert.equal(h.calls.sessionCreate.length,2);
  assert.notEqual(a.sessionId,b.sessionId);assert.equal(h.calls.prompt.length,2);
});

test('failed prompt retains the exact Session and request id for retry',async t=>{
  const h=await setup(t,{existing:true});let attempt=0;
  h.hooks.prompt=()=>{if(++attempt===1)throw Object.assign(Error('临时网络故障'),{status:502});return {accepted:true};};
  await assert.rejects(h.service.start({requirement,request_id:requestId}),error=>{
    assert.equal(error.status,502);assert.equal(error.body.sessionId,'S-1');
    assert.equal(error.body.workspaceId,'W-existing');assert.equal(error.body.request_id,requestId);return true;
  });
  const receipt=await h.service.start({requirement,request_id:requestId});
  assert.equal(receipt.sessionId,'S-1');assert.equal(receipt.status,'accepted');
  assert.equal(h.calls.sessionCreate.length,1);assert.equal(h.calls.sessionRename.length,1);assert.equal(h.calls.prompt.length,2);
  assert.deepEqual(h.calls.prompt.map(value=>value.request.requestId),[requestId,requestId]);
  assert.deepEqual(h.calls.prompt.map(value=>value.request.sessionId),['S-1','S-1']);
});

test('restart reloads accepted receipt and never creates or prompts again',async t=>{
  const h=await setup(t,{existing:true});
  const first=await h.service.start({requirement,request_id:requestId});
  const restarted=h.make();
  const again=await restarted.start({requirement,request_id:requestId});
  assert.deepEqual(again,first);assert.equal(h.calls.sessionCreate.length,1);assert.equal(h.calls.prompt.length,1);
});

test('restart after a failed prompt resumes the persisted Session instead of duplicating it',async t=>{
  const h=await setup(t,{existing:true});
  h.hooks.prompt=()=>{throw Object.assign(Error('上游未受理'),{status:503});};
  await assert.rejects(h.service.start({requirement,request_id:requestId}),status(503));
  delete h.hooks.prompt;
  const resumed=await h.make().start({requirement,request_id:requestId});
  assert.equal(resumed.sessionId,'S-1');assert.equal(h.calls.sessionCreate.length,1);assert.equal(h.calls.prompt.length,2);
});

test('persisted request id cannot be reused for a different requirement',async t=>{
  const h=await setup(t,{existing:true});await h.service.start({requirement,request_id:requestId});
  await assert.rejects(h.make().start({requirement:'另一项新需求',request_id:requestId}),status(409));
  assert.equal(h.calls.sessionCreate.length,1);assert.equal(h.calls.prompt.length,1);
});

test('ambiguous duplicate Workspace titles are refused before any creation or prompt',async t=>{
  const h=await setup(t,{existing:true});h.rows.push({id:'W-other',title,path:join(h.root,'other')});
  await assert.rejects(h.service.start({requirement,request_id:requestId}),error=>{
    assert.equal(error.status,409);assert.match(error.message,/多个/);return true;
  });
  assert.equal(h.calls.workspaceCreate.length,0);assert.equal(h.calls.sessionCreate.length,0);assert.equal(h.calls.prompt.length,0);
});

test('a registered target directory under another title is not renamed or reused silently',async t=>{
  const h=await setup(t);h.rows.push({id:'W-other-title',title:'其他项目',path:join(h.defaultDirectory,title)});
  await assert.rejects(h.service.start({requirement,request_id:requestId}),status(409));
  assert.equal(h.rows[0].title,'其他项目');assert.equal(h.calls.sessionCreate.length,0);assert.equal(h.calls.prompt.length,0);
});

for(const value of [undefined,null,1,{},'', '  ', '\n\t']){
  test(`invalid blank/non-text requirement is rejected without side effects ${JSON.stringify(value)}`,async t=>{
    const h=await setup(t);
    await assert.rejects(h.service.start({requirement:value,request_id:requestId}),status(400));
    assert.equal(h.calls.list.length,0);assert.equal(h.calls.workspaceCreate.length,0);assert.equal(h.calls.sessionCreate.length,0);assert.equal(h.calls.prompt.length,0);
  });
}
for(const field of ['list','create']){
  test(`missing Workspace.${field} yields honest unavailable error`,async t=>{
    const h=await setup(t),workspaces={...h.workspaces};delete workspaces[field];
    await assert.rejects(h.make({workspaces}).start({requirement,request_id:requestId}),status(503));
    assert.equal(h.calls.sessionCreate.length,0);assert.equal(h.calls.prompt.length,0);
  });
}
for(const field of ['create','prompt']){
  test(`missing Session.${field} yields honest unavailable error`,async t=>{
    const h=await setup(t),sessions={...h.sessions};delete sessions[field];
    await assert.rejects(h.make({sessions}).start({requirement,request_id:requestId}),status(503));
    assert.equal(h.calls.sessionCreate.length,0);assert.equal(h.calls.prompt.length,0);
  });
}

test('missing default directory fails before registering a Workspace',async t=>{
  const h=await setup(t);
  await assert.rejects(h.make({workingDirectory:{}}).start({requirement,request_id:requestId}),status(503));
  assert.equal(h.calls.workspaceCreate.length,0);assert.equal(h.calls.sessionCreate.length,0);assert.equal(h.calls.prompt.length,0);
});

test('pre-aborted request never creates a Workspace or Session',async t=>{
  const h=await setup(t),controller=new AbortController();controller.abort();
  await assert.rejects(h.service.start({requirement,request_id:requestId},controller.signal),status(499));
  assert.equal(h.calls.list.length,0);assert.equal(h.calls.sessionCreate.length,0);assert.equal(h.calls.prompt.length,0);
});

test('cancellation after Session creation reports that Session and retry reuses it',async t=>{
  const h=await setup(t,{existing:true}),controller=new AbortController();
  h.hooks.sessionCreate=()=>{controller.abort();return {sessionId:'S-partial'};};
  await assert.rejects(h.service.start({requirement,request_id:requestId},controller.signal),error=>{
    assert.equal(error.status,499);assert.equal(error.body?.sessionId,'S-partial');
    assert.equal(error.body?.workspaceId,'W-existing');assert.equal(error.body?.request_id,requestId);return true;
  });
  assert.equal(h.calls.prompt.length,0);
  delete h.hooks.sessionCreate;
  const recovered=await h.service.start({requirement,request_id:requestId});
  assert.equal(recovered.sessionId,'S-partial');assert.equal(h.calls.sessionCreate.length,1);assert.equal(h.calls.prompt.length,1);
});

test('prompt cancellation is an error with recoverable ids, not a saved-expert receipt',async t=>{
  const h=await setup(t,{existing:true}),controller=new AbortController();
  h.hooks.prompt=(_request,signal)=>{assert.equal(signal,controller.signal);controller.abort();throw Object.assign(Error('请求已取消'),{status:499});};
  await assert.rejects(h.service.start({requirement,request_id:requestId},controller.signal),error=>{
    assert.equal(error.status,499);assert.equal(error.body.sessionId,'S-1');assert.equal(error.body.request_id,requestId);return true;
  });
});

test('rename failure is disclosed while accepted still does not mean expert saved',async t=>{
  const h=await setup(t,{existing:true});h.hooks.sessionRename=()=>{throw Error('命名不可用');};
  const result=await h.service.start({requirement,request_id:requestId});
  assert.equal(result.status,'accepted');assert.equal(result.submitted,true);assert.equal(result.expertSaved,false);
  assert.ok(result.warnings.some(value=>value.includes('命名')));
  assert.equal(result.expertId,undefined);assert.equal(h.calls.prompt.length,1);
});

test('accepted prompt receipt is not an expert-save result and carries the exact DSH request',async t=>{
  const h=await setup(t,{existing:true});const result=await h.service.start({requirement,request_id:requestId});
  assert.equal(result.status,'accepted');assert.equal(result.submitted,true);assert.equal(result.expertSaved,false);
  assert.equal(result.request_id,requestId);assert.equal(result.workspaceTitle,title);assert.equal(result.sessionId,'S-1');
  const {request,signal}=h.calls.prompt[0];
  assert.equal(request.requestId,requestId);assert.equal(request.sessionId,result.sessionId);assert.equal(request.mode,'queue');
  assert.equal(request.content.length,1);assert.equal(request.content[0].type,'text');
  assert.match(request.content[0].text,/st_expert_config/);assert.ok(request.content[0].text.includes(requirement));
  assert.equal(typeof signal.aborted,'boolean');assert.equal(result.expertId,undefined);
});

test('accepted prompt with receipt-write failure remains deduplicated in this service',async t=>{
  const h=await setup(t,{existing:true});let rejected=false;
  const fs={...diskFs,async writeFile(path,data,...args){
    if(!rejected&&JSON.parse(data).accepted){rejected=true;throw Object.assign(Error('磁盘写入失败'),{code:'EIO'});}
    return writeFile(path,data,...args);
  }};
  const service=h.make({fs}),first=await service.start({requirement,request_id:requestId});
  assert.equal(first.status,'accepted');assert.equal(first.expertSaved,false);assert.ok(first.warnings.some(value=>value.includes('回执')));
  const again=await service.start({requirement,request_id:requestId});
  assert.equal(again.sessionId,first.sessionId);assert.equal(again.status,'accepted');assert.equal(h.calls.sessionCreate.length,1);assert.equal(h.calls.prompt.length,1);
});

test('invalid Session create response cannot produce acceptance or start a model',async t=>{
  const h=await setup(t,{existing:true});h.hooks.sessionCreate=()=>({});
  await assert.rejects(h.service.start({requirement,request_id:requestId}),status(503));
  assert.equal(h.calls.prompt.length,0);
});

test('non-accepted prompt response is failure, then a retry keeps the Session identity',async t=>{
  const h=await setup(t,{existing:true});h.hooks.prompt=()=>({accepted:false});
  await assert.rejects(h.service.start({requirement,request_id:requestId}),status(503));
  delete h.hooks.prompt;
  const receipt=await h.service.start({requirement,request_id:requestId});
  assert.equal(receipt.status,'accepted');assert.equal(receipt.sessionId,'S-1');assert.equal(h.calls.sessionCreate.length,1);
});

test('status inspects only the owned creation Session without another prompt',async t=>{
  const h=await setup(t,{existing:true});await h.service.start({requirement,request_id:requestId});
  h.sessions.inspect=async id=>{assert.equal(id,'S-1');return {events:[{type:'turn/start',seq:1},{type:'turn/end',seq:2,data:{reason:{kind:'completed'}}}]};};
  const result=await h.service.status(requestId);assert.equal(result.activity.running,false);assert.equal(result.activity.lastTurnEndReason.kind,'completed');assert.equal(result.expertSaveVerified,false);assert.equal(h.calls.prompt.length,1);
});
test('cancel is restricted to a saved creation receipt and can archive that Session',async t=>{
  const h=await setup(t,{existing:true});await h.service.start({requirement,request_id:requestId});const calls=[];
  h.sessions.cancel=async request=>{calls.push(request);return {accepted:true};};h.workspaces.archiveSession=async(...args)=>calls.push(args);
  const result=await h.service.cancel(requestId,{archive:true});assert.equal(result.archived,true);assert.deepEqual(calls,[{sessionId:'S-1'},['S-1',{stopActivity:true}]]);
  await assert.rejects(h.service.cancel(request2),status(404));assert.equal(calls.length,2);assert.equal(h.calls.prompt.length,1);
});
