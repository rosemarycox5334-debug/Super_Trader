import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SectorAnalysisService,buildSectorAnalysisPrompt} from '../lib/sector-analysis.js';

async function setup(t,{existing=false}={}){
  const root=await mkdtemp(join(tmpdir(),'st-sector-analysis-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const defaultDirectory=join(root,'default'),path=join(defaultDirectory,'Ai板块分析');await mkdir(defaultDirectory);
  if(existing)await mkdir(path);
  const rows=existing?[{id:'W-sector',title:'Ai板块分析',path}]:[];
  const calls={workspace:[],session:[],rename:[],prompt:[]};let n=0;
  const workspaces={
    list:()=>[...rows],
    async create(p,title){calls.workspace.push([p,title]);const row={id:'W-sector',title,path:p};rows.push(row);return row;},
  };
  const sessions={
    async create(request){calls.session.push(request);return {sessionId:'S-'+(++n)};},
    async rename(request){calls.rename.push(request);return {title:request.title,seq:1};},
    async prompt(request,signal){calls.prompt.push({request,signal});return {accepted:true};},
  };
  const service=new SectorAnalysisService({workspaces,sessions,workingDirectory:{defaultDirectory},uuid:()=> 'request-fixed-0001'});
  return {root,defaultDirectory,path,rows,calls,service};
}
test('sector analysis creates the Ai板块分析 workspace and a new independent session',async t=>{
  const h=await setup(t),receipt=await h.service.start({thscode:'881101.TI',name:'银行板块'});
  assert.equal(receipt.status,'accepted');assert.equal(receipt.workspaceTitle,'Ai板块分析');assert.equal(receipt.sessionId,'S-1');
  assert.deepEqual(h.calls.workspace,[[join(h.defaultDirectory,'Ai板块分析'),'Ai板块分析']]);
  assert.deepEqual(h.calls.session,[{workspaceId:'W-sector'}]);
  assert.equal(h.calls.rename[0].title,'Ai板块分析：银行板块');
  const prompt=h.calls.prompt[0].request.content[0].text;
  assert.match(prompt,/881101\.TI/);assert.match(prompt,/银行板块/);assert.match(prompt,/st_sector_research/);assert.match(prompt,/st_team_research/);
});
test('existing workspace is reused and the same request never starts twice',async t=>{
  const h=await setup(t,{existing:true});
  const a=await h.service.start({thscode:'881101.TI',name:'银行板块',request_id:'request-fixed-0001'});
  const b=await h.service.start({thscode:'881101.TI',name:'银行板块',request_id:'request-fixed-0001'});
  assert.equal(a.sessionId,b.sessionId);assert.equal(h.calls.workspace.length,0);assert.equal(h.calls.session.length,1);assert.equal(h.calls.prompt.length,1);
});
test('different sector under the same request id is rejected',async t=>{
  const h=await setup(t,{existing:true});await h.service.start({thscode:'881101.TI',name:'银行板块',request_id:'request-fixed-0001'});
  await assert.rejects(h.service.start({thscode:'881102.TI',name:'券商板块',request_id:'request-fixed-0001'}),/不同板块/);
  assert.equal(h.calls.session.length,1);assert.equal(h.calls.prompt.length,1);
});
test('invalid code, name or duplicate workspace names fail without creating a session',async t=>{
  const h=await setup(t);
  for(const body of [{thscode:'123',name:'x'},{thscode:'881101.TI',name:''},{thscode:'881101.XX',name:'x'}]){
    await assert.rejects(h.service.start(body));assert.equal(h.calls.session.length,0);
  }
  const duplicate=await setup(t,{existing:true});duplicate.rows.push({id:'W2',title:'Ai板块分析',path:join(duplicate.root,'other')});
  await assert.rejects(duplicate.service.start({thscode:'881101.TI',name:'银行板块'}),/多个/);assert.equal(duplicate.calls.session.length,0);
});
test('prompt is a sector instruction rather than a stock or new-expert task',()=>{
  const prompt=buildSectorAnalysisPrompt('银行板块','881101.TI');
  assert.match(prompt,/不要新建工作区或会话/);assert.match(prompt,/st_sector_research/);assert.match(prompt,/wait=true/);assert.match(prompt,/不要传 expert_ids/);assert.match(prompt,/wait=true/);assert.match(prompt,/整节省略/);assert.match(prompt,/不要把“任务仍在运行\/1\/N”写进最终报告/);assert.match(prompt,/团队逐位展示/);assert.match(prompt,/每位专家单独一节/);assert.match(prompt,/不是复述原始数据/);assert.match(prompt,/不编造/);
  assert.doesNotMatch(prompt,/st_expert_config/);
});
