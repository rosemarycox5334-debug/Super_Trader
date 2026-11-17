import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExpertCreationService} from '../lib/expert-creation.js';
import {createTools} from '../lib/tools.js';
const url='https://author.example.org/post';
const configuration={name:'公开资料风格参考',system_prompt:'基于本人原文 '+url,tools:['quant_snapshot','news_search']};
function history(){return [
  {type:'tool/call',seq:1,data:{callId:'search',name:'web_search',arguments:'{"queries":["author 最新交易理念"]}'}},
  {type:'tool/result',seq:2,sourceEventSeqs:[1],data:{message:{toolCallId:'search',isError:false,content:[]},meta:{sources:[{url,title:'原文'}]}}},
  {type:'tool/call',seq:3,data:{callId:'fetch',name:'web_fetch',arguments:JSON.stringify({url})}},
  {type:'tool/result',seq:4,sourceEventSeqs:[3],data:{message:{toolCallId:'fetch',isError:false,content:[{type:'text',text:'本人公开方法论原文。'}]},meta:{url,statusCode:200}}},
];}
async function setup(t,{events=history(),creation=true}={}){
  const root=await mkdtemp(join(tmpdir(),'expert-online-gate-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const row={id:'W1',title:creation?'新建专家':'其他研究',path:root,sessionIds:creation?['creator']:['manual']};
  const views={creator:{meta:{id:'creator'},events,inheritedEventCount:0},manual:{meta:{id:'manual'},events:[],inheritedEventCount:0}};
  const sessions={async inspect(id){if(!views[id])throw Error('unknown');return views[id];}};
  const service=new ExpertCreationService({workspaces:{list:()=>[row]},sessions,workingDirectory:{defaultDirectory:root}});
  const calls=[],manager={async request(...args){calls.push(args);return {id:'new-expert',...args[2]};}};
  const tool=createTools(manager,{expertCreation:service}).find(tool=>tool.name==='st_expert_config');
  const save=(body=configuration,agent={id:'creator'})=>tool.execute({action:'save',...body},{agent,signal:new AbortController().signal});
  return {root,row,views,service,calls,tool,save};
}
test('successful current-session search and cited read allow the shared save endpoint',async t=>{
  const h=await setup(t),out=await h.save();assert.equal(out.id,'new-expert');assert.equal(h.calls.length,1);assert.equal(h.calls[0][1],'/api/experts');
});
test('model memory or a claimed source URL cannot save without network receipts',async t=>{
  const h=await setup(t,{events:[{type:'assistant/message',seq:1,data:{message:{content:[{type:'text',text:'我已经联网读取 '+url}]}}}]}),out=await h.save();
  assert.equal(out.error.code,'online_research_required');assert.equal(h.calls.length,0);
});
test('only search, uncited pages or failed fetch cannot reach backend save',async t=>{
  const h=await setup(t);h.views.creator.events=history().slice(0,2);assert.equal((await h.save()).error.code,'online_research_required');
  h.views.creator.events=history();assert.equal((await h.save({...configuration,system_prompt:'没有来源URL'})).error.code,'online_research_required');
  h.views.creator.events[3].data.meta.statusCode=404;assert.equal((await h.save()).error.code,'online_research_required');assert.equal(h.calls.length,0);
});
test('missing subject or unreadable history fails closed without leaking inspection errors',async t=>{
  const h=await setup(t);assert.equal((await h.save(configuration,null)).error.code,'online_research_context_unavailable');
  h.service.sessions.inspect=async()=>{throw Error('SECRET-INTERNAL');};const out=await h.save();assert.equal(out.error.code,'online_research_unverified');assert.doesNotMatch(JSON.stringify(out),/SECRET/);assert.equal(h.calls.length,0);
});
test('manual edits outside a creation session retain their existing behavior',async t=>{
  const h=await setup(t,{creation:false});const out=await h.save({...configuration,id:'existing',system_prompt:'手动编辑'}, {id:'manual'});
  assert.equal(out.id,'existing');assert.equal(h.calls.length,1);
});
test('read-only get does not require fresh web evidence',async t=>{
  const h=await setup(t,{events:[]});await h.tool.execute({action:'get',id:'existing'},{agent:{id:'creator'}});assert.equal(h.calls[0][0],'GET');
});
test('durable receipts still identify a creation session after Workspace rename and cwd change',async t=>{
  const h=await setup(t,{creation:false}),dir=join(h.root,'.super-trader','expert-creation');await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'11111111-1111-4111-8111-111111111111.json'),JSON.stringify({workspaceId:'W1',sessionId:'creator',accepted:false}));
  h.views.creator.events=[];const result=await h.save();assert.equal(result.error.code,'online_research_required');assert.equal(h.calls.length,0);
});
test('fork and descendant saves cannot reuse inherited parent web results',async t=>{
  const h=await setup(t);h.views.child={meta:{id:'child',parentSession:'creator'},events:history(),inheritedEventCount:4};
  const result=await h.save(configuration,{id:'child'});assert.equal(result.error.code,'online_research_required');assert.equal(h.calls.length,0);
  h.views.child.events=[...history(),...history().map(e=>({...e,seq:e.seq+4,...(e.sourceEventSeqs?{sourceEventSeqs:e.sourceEventSeqs.map(seq=>seq+4)}:{})}))];
  assert.equal((await h.save(configuration,{id:'child'})).id,'new-expert');
});
