import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StockAnalysisService,buildStockAnalysisPrompt} from '../lib/stock-analysis.js';

async function setup(t,{existing=false}={}){
  const root=await mkdtemp(join(tmpdir(),'st-stock-analysis-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const defaultDirectory=join(root,'default'),path=join(defaultDirectory,'Ai个股分析');await mkdir(defaultDirectory);if(existing)await mkdir(path);
  const rows=existing?[{id:'W-stock',title:'Ai个股分析',path}]:[];
  const calls={workspace:[],session:[],rename:[],prompt:[]};let n=0;
  const workspaces={list:()=>[...rows],async create(p,title){calls.workspace.push([p,title]);const row={id:'W-stock',title,path:p};rows.push(row);return row;}};
  const sessions={async create(request){calls.session.push(request);return {sessionId:'S-'+(++n)};},async rename(request){calls.rename.push(request);return {title:request.title,seq:1};},async prompt(request,signal){calls.prompt.push({request,signal});return {accepted:true};}};
  const service=new StockAnalysisService({workspaces,sessions,workingDirectory:{defaultDirectory},uuid:()=> 'request-fixed-0002'});
  return {root,defaultDirectory,path,rows,calls,service};
}
test('stock analysis creates Ai个股分析 and a new independent session',async t=>{
  const h=await setup(t),receipt=await h.service.start({code:'601088',name:'中国神华'});
  assert.equal(receipt.status,'accepted');assert.equal(receipt.workspaceTitle,'Ai个股分析');assert.equal(receipt.sessionId,'S-1');
  assert.deepEqual(h.calls.workspace,[[join(h.defaultDirectory,'Ai个股分析'),'Ai个股分析']]);
  assert.deepEqual(h.calls.session,[{workspaceId:'W-stock'}]);assert.equal(h.calls.rename[0].title,'Ai个股分析：中国神华');
  const prompt=h.calls.prompt[0].request.content[0].text;assert.match(prompt,/601088/);assert.match(prompt,/逐位专家展开/);assert.match(prompt,/不得只输出“7\/7/);
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
test('stock prompt demands every expert reason, evidence, outlook and risks',()=>{
  const p=buildStockAnalysisPrompt('中国神华','601088');
  for(const phrase of ['st_stock_research','st_team_research','"wait":true','不要传 expert_ids','逐位专家展开','理由','依据','outlook','风险','弃权','不得只输出'])assert.ok(p.includes(phrase),phrase);
  assert.doesNotMatch(p,/st_expert_config/);
});
