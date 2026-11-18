import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StockAnalysisService,buildStockAnalysisPrompt} from '../lib/stock-analysis.js';

async function setup(t,{existing=false,applyPermission}={}){
  const root=await mkdtemp(join(tmpdir(),'st-stock-analysis-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const defaultDirectory=join(root,'default'),path=join(defaultDirectory,'Ai个股分析');await mkdir(defaultDirectory);if(existing)await mkdir(path);
  const rows=existing?[{id:'W-stock',title:'Ai个股分析',path}]:[];
  const calls={workspace:[],session:[],rename:[],prompt:[]};let n=0;
  const workspaces={list:()=>[...rows],async create(p,title){calls.workspace.push([p,title]);const row={id:'W-stock',title,path:p};rows.push(row);return row;}};
  const sessions={async create(request){calls.session.push(request);return {sessionId:'S-'+(++n)};},async rename(request){calls.rename.push(request);return {title:request.title,seq:1};},async prompt(request,signal){calls.prompt.push({request,signal});return {accepted:true};}};
  const service=new StockAnalysisService({workspaces,sessions,workingDirectory:{defaultDirectory},uuid:()=> 'request-fixed-0002',applyPermission});
  return {root,defaultDirectory,path,rows,calls,service};
}
test('stock analysis creates Ai个股分析 and a new independent session',async t=>{
  const h=await setup(t),receipt=await h.service.start({code:'601088',name:'中国神华'});
  assert.equal(receipt.status,'accepted');assert.equal(receipt.workspaceTitle,'Ai个股分析');assert.equal(receipt.sessionId,'S-1');
  assert.deepEqual(h.calls.workspace,[[join(h.defaultDirectory,'Ai个股分析'),'Ai个股分析']]);
  assert.deepEqual(h.calls.session,[{workspaceId:'W-stock'}]);assert.equal(h.calls.rename[0].title,'Ai个股分析：中国神华');
  const prompt=h.calls.prompt[0].request.content[0].text;assert.match(prompt,/601088/);assert.match(prompt,/逐位专家展开/);assert.match(prompt,/不得只输出“全部投票”/);
});
test('existing stock workspace is reused and duplicate request does not prompt twice',async t=>{
  const h=await setup(t,{existing:true});
  const a=await h.service.start({code:'601088',name:'中国神华',request_id:'request-fixed-0002'});
  const b=await h.service.start({code:'601088',name:'中国神华',request_id:'request-fixed-0002'});
  assert.equal(a.sessionId,b.sessionId);assert.equal(h.calls.workspace.length,0);assert.equal(h.calls.session.length,1);assert.equal(h.calls.prompt.length,1);
});
test('invalid stock code or name fails before creating a session',async t=>{
  const h=await setup(t);
  for(const body of [{code:'60108',name:'x'},{code:'601088',name:''},{code:'ABCDEF',name:'x'}]){
    await assert.rejects(h.service.start(body));assert.equal(h.calls.session.length,0);
  }
});
test('new stock session is pinned to full access before the task is queued',async t=>{
  const root=await mkdtemp(join(tmpdir(),'st-stock-perm-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const defaultDirectory=join(root,'default');await mkdir(defaultDirectory);
  const order=[];const rows=[];
  const workspaces={list:()=>rows,async create(p,title){const row={id:'W-stock',title,path:p};rows.push(row);return row;}};
  const sessions={async create(){order.push('create');return {sessionId:'S-perm'};},async rename(){return {title:'t',seq:1};},async prompt(){order.push('prompt');return {accepted:true};}};
  const service=new StockAnalysisService({workspaces,sessions,workingDirectory:{defaultDirectory},uuid:()=> 'request-fixed-0009',
    applyPermission:async id=>{order.push('permission:'+id);}});
  const receipt=await service.start({code:'601088',name:'中国神华'});
  assert.deepEqual(order,['create','permission:S-perm','prompt']);
  assert.deepEqual(receipt.warnings,[]);
});
test('a permission failure keeps the analysis accepted and says how to switch manually',async t=>{
  const h=await setup(t,{applyPermission:async()=>{throw new Error('host refused');}});
  const receipt=await h.service.start({code:'601088',name:'中国神华'});
  assert.equal(receipt.status,'accepted');assert.equal(h.calls.prompt.length,1);
  assert.match(receipt.warnings.join(' '),/完全访问权限/);
});
test('stock prompt demands every expert reason, evidence, trade plan and outlook',()=>{
  const p=buildStockAnalysisPrompt('中国神华','601088');
  for(const phrase of ['st_stock_research','st_team_research','"wait":true','不要传 expert_ids','逐位专家展开','理由','依据','交易策略','综合交易策略','止损','仓位','情景展望','风险','不得只输出','ETF 专项取证','不补查这些项目','量化因子不参与单个专家的判断','信心度','A股默认不能做空','买入（加仓）','全部用中文表述','专家看不到量化因子','量化因子校验','55% 准确率门槛','整个第 2 层直接省略','分批位次','转为观望或放弃的条件','无条件离场'])assert.ok(p.includes(phrase),phrase);
  assert.doesNotMatch(p,/明确写“本次不采用因子辅助”/);
  assert.doesNotMatch(p,/- outlook：|- 置信度/);
  assert.doesNotMatch(p,/action、入场触发条件/);
  assert.doesNotMatch(p,/写“未提供”|未提供（空数组|未提供的字段写/);
  assert.doesNotMatch(p,/继续用 web_search|用 web_search 和 web_fetch 核查/);
  assert.doesNotMatch(p,/st_expert_config/);
});
test('sector prompt also requires a plan for every stance and hides absent fields',async()=>{
  const {buildSectorAnalysisPrompt}=await import('../lib/sector-analysis.js');
  const p=buildSectorAnalysisPrompt('煤炭','881101.TI');
  for(const phrase of ['交易策略','综合交易策略','止损','仓位','观望','信心度','A股默认不能做空','全部用中文表述','情景展望','买入（加仓）','专家看不到量化因子'])assert.ok(p.includes(phrase),phrase);
  assert.doesNotMatch(p,/- outlook：|- 置信度/);
  assert.doesNotMatch(p,/写“未提供”|未提供（空数组|未提供的字段写/);
});
