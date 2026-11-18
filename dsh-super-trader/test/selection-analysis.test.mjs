import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SelectionAnalysisService,buildSelectionPrompt,normalizeSelectionRequest} from '../lib/selection-analysis.js';

async function setup(t,{existing=false,applyPermission}={}){
  const root=await mkdtemp(join(tmpdir(),'st-selection-analysis-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const defaultDirectory=join(root,'default'),path=join(defaultDirectory,'Ai专家选股');
  await mkdir(defaultDirectory);if(existing)await mkdir(path);
  const rows=existing?[{id:'W-selection',title:'Ai专家选股',path}]:[];
  const calls={workspace:[],session:[],rename:[],prompt:[]};let n=0;
  const workspaces={list:()=>[...rows],async create(p,title){calls.workspace.push([p,title]);const row={id:'W-selection',title,path:p};rows.push(row);return row;}};
  const sessions={async create(request){calls.session.push(request);return {sessionId:'S-'+(++n)};},async rename(request){calls.rename.push(request);return {title:request.title,seq:1};},async prompt(request){calls.prompt.push(request);return {accepted:true};}};
  const service=new SelectionAnalysisService({workspaces,sessions,workingDirectory:{defaultDirectory},uuid:()=> 'selection-request-0001',applyPermission});
  return {root,defaultDirectory,calls,service};
}

test('selection creates Ai专家选股 and a session that runs the real screening job',async t=>{
  const h=await setup(t);
  const receipt=await h.service.start({scope:'market',expert_ids:['price_action','buffett'],brief:'重视现金流',limit_per_expert:5});
  assert.equal(receipt.status,'accepted');assert.equal(receipt.workspaceTitle,'Ai专家选股');
  assert.equal(receipt.sessionId,'S-1');
  assert.deepEqual(h.calls.workspace,[[join(h.defaultDirectory,'Ai专家选股'),'Ai专家选股']]);
  assert.deepEqual(h.calls.session,[{workspaceId:'W-selection'}]);
  assert.match(h.calls.rename[0].title,/Ai专家选股：全A股/);
  const prompt=h.calls.prompt[0].content[0].text;
  for(const phrase of ['st_screen_stocks','st_job','scope: "market"','limit_per_expert','重视现金流','逐位专家展示','排除','不得编造','不是买入建议','universe.total = 0','st_watchlist','值得观察','不要向用户提问'])assert.ok(prompt.includes(phrase),phrase);
});

test('watchlist scope evaluates every saved target instead of screening a list',async t=>{
  const h=await setup(t);
  await h.service.start({scope:'watchlist',limit_per_expert:5,request_id:'selection-request-0001'});
  const prompt=h.calls.prompt[0].content[0].text;
  assert.doesNotMatch(prompt,/st_screen_stocks/);
  for(const phrase of ['st_watchlist','每一只','st_stock_research','st_team_research','值得观察','ETF','不要向用户提问'])assert.ok(prompt.includes(phrase),phrase);
});
test('sector scope passes the complete thscode and the same id reuses one session',async t=>{
  const h=await setup(t,{existing:true});
  const params={scope:'sector',sector:'881101.TI',expert_ids:['price_action'],brief:'',limit_per_expert:3};
  const a=await h.service.start({...params,request_id:'selection-request-0001'});
  const b=await h.service.start({...params,request_id:'selection-request-0001'});
  assert.equal(a.sessionId,b.sessionId);assert.equal(h.calls.session.length,1);assert.equal(h.calls.prompt.length,1);
  assert.match(h.calls.prompt[0].content[0].text,/881101\.TI/);
  await assert.rejects(h.service.start({...params,limit_per_expert:4,request_id:'selection-request-0001'}),/不同选股参数/);
});

test('selection parameters are validated before any session exists',async t=>{
  const h=await setup(t);
  assert.throws(()=>normalizeSelectionRequest({scope:'index'}),/market \/ watchlist \/ sector/);
  assert.throws(()=>normalizeSelectionRequest({scope:'sector'}),/完整指数 thscode/);
  assert.throws(()=>normalizeSelectionRequest({scope:'market',sector:'881101.TI'}),/只有板块范围/);
  assert.throws(()=>normalizeSelectionRequest({scope:'market',brief:'x'.repeat(1001)}),/1000/);
  assert.throws(()=>normalizeSelectionRequest({scope:'market',limit_per_expert:0}),/1..10/);
  assert.throws(()=>normalizeSelectionRequest({scope:'market',expert_ids:['a','a']}),/不可重复/);
  await assert.rejects(h.service.start({scope:'sector'}),/完整指数 thscode/);
  assert.equal(h.calls.session.length,0);
});

test('no expert ids means all enabled experts, and timeouts stay a transport concern',async t=>{
  const h=await setup(t);
  const receipt=await h.service.start({scope:'watchlist',limit_per_expert:2});
  assert.equal(receipt.status,'accepted');
  const prompt=h.calls.prompt[0].content[0].text;
  assert.match(prompt,/使用全部启用专家/);
  assert.doesNotMatch(prompt,/最多\d+轮/);
});

test('a permission failure keeps the selection accepted and warns',async t=>{
  const h=await setup(t,{applyPermission:async()=>{throw new Error('host refused');}});
  const receipt=await h.service.start({scope:'market',limit_per_expert:5});
  assert.equal(receipt.status,'accepted');
  assert.match(receipt.warnings.join(' '),/完全访问权限/);
});
