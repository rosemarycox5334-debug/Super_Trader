import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import yaml from 'js-yaml';
import {apply,mount} from '../lib/index.js';
import {createHandlers,allowedEndpoint,trusted} from '../lib/routes.js';

test('patch parses to package insert and distribution exports metadata',async()=>{
  const patch=yaml.load(await readFile(new URL('../cordis.patch.yml',import.meta.url),'utf8'));
  assert.equal(patch[0].insert[0].name,'dsh-super-trader');
  const p=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.ok(p.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'));
  assert.ok(!p.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'));
  assert.ok(p.files.includes('runtime'));
  for(const path of [p.main,p.exports['./client'],p.exports['./icon'],'locale/zh.json','locale/en.json'])assert.ok((await readFile(new URL('../'+path,import.meta.url))).length);
});
test('apply tolerates missing/throwing host context',()=>{
  for(const ctx of [undefined,null,{}, {effect(){throw new Error('host unavailable');}},new Proxy({},{get(){throw Error('hostile');}})])assert.doesNotThrow(()=>apply(ctx));
});
test('mount registers exactly twenty-six tools and five routes without awaiting backend',async()=>{
  const registered=[],routes=[],cleanup=[];
  let starts=0,disposed=0;
  const manager={getState:()=>({phase:'idle'}),ensureBackend(){starts++;return new Promise(()=>{});},dispose:async()=>{disposed++;}};
  const services={tools:{register(t){registered.push(t);return ()=>{};}},webServer:{register(r){routes.push(r);return ()=>{};},getOrigin:()=> 'http://127.0.0.1:57621'}};
  mount({get:k=>services[k],effect(fn){const d=fn();if(d)cleanup.push(d);}},()=>manager);
  assert.equal(registered.length,26);assert.equal(routes.length,5);
  // Host WebServer.match appends '/' itself; a trailing slash never matches descendants.
  const proxy=routes.find(r=>r.kind==='prefix');
  assert.equal(proxy.path,'/dsh-super-trader/backend');
  assert.ok('/dsh-super-trader/backend/api/status'.startsWith(proxy.path+'/'));
  await Promise.resolve();assert.equal(starts,1);
  await cleanup[0]();assert.equal(disposed,1);
});
test('partial context does not start backend',async()=>{
  let start=0,dispose=0;
  mount({effect:f=>f()},()=>({ensureBackend(){start++;},async dispose(){dispose++;}}));
  await Promise.resolve();assert.equal(start,0);assert.equal(dispose,1);
});
test('proxy rejects foreign origins and non-allowlisted paths',()=>{
  assert.equal(trusted({headers:{host:'127.0.0.1:57621',origin:'http://evil.example'}},'http://127.0.0.1:57621'),false);
  assert.equal(trusted({headers:{host:'evil.example'}},'http://127.0.0.1:57621'),false);
  assert.equal(trusted({headers:{host:'127.0.0.1:57621','sec-fetch-site':'cross-site'}},'http://127.0.0.1:57621'),false);
  assert.equal(allowedEndpoint('GET','/api/market/quotes'),true);
  assert.equal(allowedEndpoint('GET','/api/market/status'),true);
  assert.equal(allowedEndpoint('POST','/api/market/quotes'),false);
  assert.equal(allowedEndpoint('GET','/api/market/credentials'),false);
  assert.equal(allowedEndpoint('GET','/api/quant/probability'),true); // maintained explicit read contract
});
test('expert saves pass through the same-origin proxy without opening arbitrary writes',async()=>{
  assert.equal(allowedEndpoint('POST','/api/experts'),true);
  assert.equal(allowedEndpoint('DELETE','/api/experts'),false);
  assert.equal(allowedEndpoint('DELETE','/api/experts/buffett'),true);
  assert.equal(allowedEndpoint('DELETE','/api/experts/a/b'),false);
  assert.equal(allowedEndpoint('POST','/api/experts/other'),false);
  const calls=[],body={name:'新专家',system_prompt:'依据事实分析',tools:['quant_snapshot','news_search']};
  const manager={request:async(...args)=>{calls.push(args);return {id:'new-expert',...args[2]};}};
  const h=createHandlers(manager,()=> 'http://127.0.0.1:57621');
  const req={headers:{host:'127.0.0.1:57621'},method:'POST',url:'/dsh-super-trader/backend/api/experts',async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};
  const res=response();await h.proxy(req,res);
  assert.equal(res.status,200);assert.equal(calls.length,1);
  assert.equal(calls[0][0],'POST');assert.equal(calls[0][1],'/api/experts');assert.deepEqual(calls[0][2],body);
  assert.equal(JSON.parse(res.text).id,'new-expert');
});
test('expert deletion is a same-origin DELETE of exactly one identity',async()=>{
  const calls=[],manager={request:async(...args)=>{calls.push(args);return {deleted:'buffett'};}};
  const h=createHandlers(manager,()=> 'http://127.0.0.1:57621');
  const req={headers:{host:'127.0.0.1:57621'},method:'DELETE',url:'/dsh-super-trader/backend/api/experts/buffett'};
  const res=response();await h.proxy(req,res);
  assert.equal(res.status,200);assert.deepEqual(JSON.parse(res.text),{deleted:'buffett'});
  assert.deepEqual(calls[0].slice(0,3),['DELETE','/api/experts/buffett',undefined]);
});
test('sector analysis route starts the Host workspace/session service',async()=>{
  const calls=[],sectorAnalysis={async start(body,signal){calls.push([body,signal]);return {status:'accepted',submitted:true,workspaceId:'W-sector',sessionId:'S-sector',thscode:body.thscode};}};
  const h=createHandlers({},()=> 'http://127.0.0.1:57621',undefined,undefined,sectorAnalysis),body={thscode:'881101.TI',name:'银行板块'};
  const req={headers:{host:'127.0.0.1:57621'},method:'POST',url:'/dsh-super-trader/sector-analysis',async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body));}};
  const res=response();await h.createSector(req,res);
  assert.equal(res.status,200);assert.equal(JSON.parse(res.text).sessionId,'S-sector');assert.deepEqual(calls[0][0],body);assert.ok(calls[0][1] instanceof AbortSignal);
  const bad=response();await h.createSector({...req,method:'GET'},bad);assert.equal(bad.status,405);
  const unknown=response();await h.createSector({...req,async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({...body,workspaceId:'x'}));}},unknown);assert.equal(unknown.status,400);
});
function response(){const res=new EventEmitter();res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;res.headersSent=true;};res.end=t=>{res.text=t;res.writableEnded=true;};return res;}
test('base state includes same-origin API base; proxy preserves backend errors',async()=>{
  const manager={getState:()=>({phase:'running',baseUrl:'http://127.0.0.1:8000'}),request:async()=>{throw Object.assign(Error('no model'),{status:503,body:{error:'未配置模型密钥'}});}};
  const h=createHandlers(manager,()=> 'http://127.0.0.1:57621');
  const req={headers:{host:'127.0.0.1:57621'},method:'GET',url:'/dsh-super-trader/base'};
  let res=response();await h.base(req,res);assert.equal(JSON.parse(res.text).apiBase,'/dsh-super-trader/backend');
  res=response();await h.proxy({...req,url:'/dsh-super-trader/backend/api/status'},res);assert.equal(res.status,503);assert.deepEqual(JSON.parse(res.text),{error:'未配置模型密钥'});
});
