import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WatchlistAnalysisService,buildWatchlistAnalysisPrompt,normalizeWatchTargets} from '../lib/watchlist-analysis.js';

const items=[
  {code:'601088',name:'中国神华',category:'个股'},
  {code:'513290',name:'纳指生物科技ETF',category:'ETF'},
];

async function setup(t,{existing=false,applyPermission}={}){
  const root=await mkdtemp(join(tmpdir(),'st-watch-analysis-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const defaultDirectory=join(root,'default'),path=join(defaultDirectory,'Ai自选股分析');
  await mkdir(defaultDirectory);if(existing)await mkdir(path);
  const rows=existing?[{id:'W-watch',title:'Ai自选股分析',path}]:[];
  const calls={workspace:[],session:[],rename:[],prompt:[]};let n=0;
  const workspaces={list:()=>[...rows],async create(p,title){calls.workspace.push([p,title]);const row={id:'W-watch',title,path:p};rows.push(row);return row;}};
  const sessions={async create(request){calls.session.push(request);return {sessionId:'S-'+(++n)};},async rename(request){calls.rename.push(request);return {title:request.title,seq:1};},async prompt(request){calls.prompt.push(request);return {accepted:true};}};
  const service=new WatchlistAnalysisService({workspaces,sessions,workingDirectory:{defaultDirectory},uuid:()=> 'watch-request-0001',applyPermission});
  return {root,defaultDirectory,calls,service};
}

test('watchlist analysis creates Ai自选股分析 and a new session for the selected items',async t=>{
  const h=await setup(t),receipt=await h.service.start({items});
  assert.equal(receipt.status,'accepted');assert.equal(receipt.workspaceTitle,'Ai自选股分析');
  assert.equal(receipt.sessionId,'S-1');assert.deepEqual(receipt.items,items);
  assert.deepEqual(h.calls.workspace,[[join(h.defaultDirectory,'Ai自选股分析'),'Ai自选股分析']]);
  assert.deepEqual(h.calls.session,[{workspaceId:'W-watch'}]);
  assert.equal(h.calls.rename[0].title,'Ai自选股分析：2只');
  const prompt=h.calls.prompt[0].content[0].text;
  for(const phrase of ['601088','513290','st_stock_research','st_team_research','逐位专家展开','交易策略','分批位次','无条件离场','专家看不到量化因子','55% 准确率门槛','最后的总表','不能做空'])assert.ok(prompt.includes(phrase),phrase);
});

test('the same request id reuses one session and rejects a different selection',async t=>{
  const h=await setup(t,{existing:true});
  const a=await h.service.start({items,request_id:'watch-request-0001'});
  const b=await h.service.start({items,request_id:'watch-request-0001'});
  assert.equal(a.sessionId,b.sessionId);assert.equal(h.calls.session.length,1);assert.equal(h.calls.prompt.length,1);
  await assert.rejects(h.service.start({items:items.slice(0,1),request_id:'watch-request-0001'}),/不同标的组合/);
});

test('selected targets are validated and deduplicated without a count cap',()=>{
  assert.deepEqual(normalizeWatchTargets([items[0],{...items[0]}]),[items[0]]);
  assert.equal(normalizeWatchTargets([...items,{code:'600519',name:'贵州茅台',category:'个股'}]).length,3);
  assert.throws(()=>normalizeWatchTargets([]),/至少勾选/);
  assert.throws(()=>normalizeWatchTargets([{code:'60108',name:'x',category:'个股'}]),/六位数字/);
  assert.throws(()=>normalizeWatchTargets([{code:'601088',name:'x',category:'基金'}]),/个股、ETF、LOF/);
  assert.equal(normalizeWatchTargets(Array.from({length:30},(_,i)=>({code:String(600000+i),name:'x',category:'个股'}))).length,30);
});

test('a permission failure keeps the analysis accepted and warns',async t=>{
  const h=await setup(t,{applyPermission:async()=>{throw new Error('host refused');}});
  const receipt=await h.service.start({items});
  assert.equal(receipt.status,'accepted');assert.equal(h.calls.prompt.length,1);
  assert.match(receipt.warnings.join(' '),/完全访问权限/);
});

test('prompt lists every target with its real category and requires sequential team runs',()=>{
  const prompt=buildWatchlistAnalysisPrompt(items);
  assert.match(prompt,/1\. 中国神华（601088，个股）/);
  assert.match(prompt,/2\. 纳指生物科技ETF（513290，ETF）/);
  assert.match(prompt,/逐只串行执行/);
  assert.match(prompt,/整段省略/);
});
