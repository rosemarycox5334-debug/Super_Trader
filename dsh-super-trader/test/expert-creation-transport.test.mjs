import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHandlers} from '../lib/routes.js';
import {createTools} from '../lib/tools.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const origin='http://127.0.0.1:57621';
const input={requirement:'参考公开交易理念创建专家',request_id:'11111111-1111-4111-8111-111111111111'};
const receipt={status:'accepted',submitted:true,sessionId:'S-new',workspaceId:'W-expert',expertSaved:false};
function response(){const r=new EventEmitter();r.writeHead=status=>{r.status=status;};r.end=text=>{r.text=text;r.writableEnded=true;};return r;}
function request(body=input,method='POST',headers={host:'127.0.0.1:57621'}){return {method,headers,url:'/dsh-super-trader/expert-creation',async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};}
test('UI and tool invoke the same Host expert-creation operation, never the Python model',async()=>{
  const calls=[],service={async start(...args){calls.push(args);return receipt;}};
  const manager={request(){throw Error('Python backend must not start this task');}};
  const h=createHandlers(manager,()=>origin,undefined,service),res=response();await h.createExpert(request(),res);
  assert.equal(res.status,200);assert.deepEqual(JSON.parse(res.text),receipt);assert.deepEqual(calls[0][0],input);assert.ok(calls[0][1] instanceof AbortSignal);
  const tool=createTools(manager,{expertCreation:service}).find(t=>t.name==='st_expert_creation');
  const controller=new AbortController();assert.deepEqual(await tool.execute(input,{signal:controller.signal}),receipt);
  assert.deepEqual(calls[1],[input,controller.signal]);
});
test('GET, foreign-origin requests and unknown fields cannot start an AI conversation',async()=>{
  let starts=0;const h=createHandlers({},()=>origin,undefined,{start(){starts++;}});
  for(const [req,status] of [[request(input,'GET'),405],[request(input,'POST',{host:'127.0.0.1:57621',origin:'https://evil.example'}),403],[request({...input,sessionId:'other'}),400]]){
    const res=response();await h.createExpert(req,res);assert.equal(res.status,status);
  }
  assert.equal(starts,0);
});
test('partial failures retain session and request identities for explicit retry',async()=>{
  const body={error:'模型暂不可用',sessionId:'S-new',request_id:input.request_id};
  const h=createHandlers({},()=>origin,undefined,{start(){throw Object.assign(Error(body.error),{status:503,body});}}),res=response();
  await h.createExpert(request(),res);assert.equal(res.status,503);assert.deepEqual(JSON.parse(res.text),body);
});
test('expert session navigation opens only the returned identity without sending any other prompt',async()=>{
  const source=await readFile(new URL('../tools/ai-bridge-source.js',import.meta.url),'utf8');
  const sandbox=vm.createContext({});vm.runInContext(source+'\nglobalThis.make=createExpertSessionBridge;',sandbox);
  const calls=[],open=sandbox.make({get:name=>name==='uiWorkspace'?{openSession:id=>calls.push(id)}:undefined});
  open('S-new');assert.deepEqual(calls,['S-new']);assert.equal(sandbox.make({}),undefined);assert.throws(()=>open(''),/会话标识/);
});
