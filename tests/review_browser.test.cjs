'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../web/workbench');
const plain = value => JSON.parse(JSON.stringify(value));
const fixtureCodes = ['601088', '600900', '000858', '300750'];
function dataset() {
  const records = Array.from({length:6194}, (_, i) => ({category:i % 3 === 0 ? 'ETF' : '个股',code:String(100000+i),name:'标的 '+i,weighted_accuracy:.63,coverage:.2,horizon:5}));
  records.push({category:'个股',code:'000001',name:'同码股票'}, {category:'指数',code:'000001',name:'同码指数'});
  for (const code of fixtureCodes) records.push({category:'个股',code,name:'样本 '+code});
  records[6000].name = 'FarNeedle 跨页标的';
  return records;
}
function load() {
  const records = dataset();
  const helpers = fs.readFileSync(path.join(root, 'conversation_helpers.js'), 'utf8');
  let app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const initializer = "  const D = JSON.parse(document.getElementById('workbench-data').textContent);";
  const marker = "  document.addEventListener('click',";
  assert.equal(app.split(initializer).length, 2);
  assert.equal(app.split(marker).length, 2);
  app = app.slice(0, app.indexOf(marker)).replace(initializer, '  const D = globalThis.snapshot;');
  app += `globalThis.api={reviewRows,reviewState,reviewStored,reviewFixture,reviewDetail,key,defaultState,
    getState:()=>state,setState:s=>{state=s;},getReviewPage:()=>reviewPage,
    setReviewFilter:f=>{if('scope' in f)reviewScope=f.scope;if('query' in f)reviewQuery=f.query;
      if('type' in f)reviewType=f.type;if('status' in f)reviewStatus=f.status;
      if('page' in f)reviewPage=f.page;if('selection' in f)reviewSelection=f.selection;}
  };})();`;
  const context = vm.createContext({snapshot:{records,mainstream:[],snapshot:'2026-11-08'},localStorage:{getItem:()=>null}});
  vm.runInContext(helpers+'\n'+app,context,{timeout:1000});
  return {...context.api,records};
}
function savedTask(api) {
  const assessment = {code:'601088',votes:[],share:.75,admitted:true};
  const state = api.defaultState();
  state.lastResult = {id:'SAVED',config:{revision:1},result:{codes:['601088','000858'],assessments:[assessment]}};
  api.setState(state);
  return {state,assessment};
}

test('all 6200 snapshot records remain reachable through 15-row pages and page bounds clamp',()=>{
  const api=load();let result=api.reviewRows();
  assert.equal(api.records.length,6200);assert.equal(result.sourceCount,6200);assert.equal(result.rows.length,6200);
  assert.equal(result.pages,414);assert.equal(result.pageRows.length,15);
  const visited=[];
  for(let page=1;page<=414;page++){api.setReviewFilter({page});visited.push(...api.reviewRows().pageRows.map(api.key));}
  assert.equal(visited.length,6200);assert.equal(new Set(visited).size,6200);
  assert.deepEqual(visited,api.records.map(api.key));
  api.setReviewFilter({page:9999});result=api.reviewRows();assert.equal(api.getReviewPage(),414);assert.equal(result.pageRows.length,5);
  api.setReviewFilter({page:-10});assert.equal(api.reviewRows().pageRows.length,15);assert.equal(api.getReviewPage(),1);
});

test('search covers the full snapshot, trims and folds case, and preserves duplicate-code categories',()=>{
  const api=load();api.setReviewFilter({page:400,query:'  FARneedle  '});
  let result=api.reviewRows();assert.equal(result.sourceCount,6200);assert.equal(result.rows.length,1);assert.equal(result.pageRows[0].code,'106000');assert.equal(api.getReviewPage(),1);
  api.setReviewFilter({query:'000001'});result=api.reviewRows();
  assert.deepEqual(plain(result.rows.map(api.key)),['个股|000001','指数|000001']);
  api.setReviewFilter({type:'指数'});assert.deepEqual(plain(api.reviewRows().rows.map(api.key)),['指数|000001']);
  api.setReviewFilter({query:'no such security',page:42});result=api.reviewRows();assert.equal(result.pages,1);assert.equal(result.pageRows.length,0);assert.equal(api.getReviewPage(),1);
});

test('type and pending/sample/record filters intersect without treating fixtures as saved records',()=>{
  const api=load();savedTask(api);
  for(const [status,count] of [['record',1],['sample',3],['pending',6196]]){
    api.setReviewFilter({status});const result=api.reviewRows();assert.equal(result.rows.length,count);assert.ok(result.rows.every(r=>api.reviewState(r)===status));
  }
  api.setReviewFilter({type:'指数',status:'pending'});assert.deepEqual(plain(api.reviewRows().rows.map(api.key)),['指数|000001']);
  for(const status of ['sample','record']){api.setReviewFilter({status});assert.equal(api.reviewRows().rows.length,0);}
  api.setReviewFilter({type:'个股',status:'sample'});assert.deepEqual(plain(api.reviewRows().rows.map(r=>r.code)),fixtureCodes.slice(1));
  api.setReviewFilter({status:'record'});assert.equal(api.reviewRows().rows[0].code,'601088');
});

test('task scope contains only saved task codes, not other fixtures or pending records; no task is empty',()=>{
  const api=load();api.setReviewFilter({scope:'task'});let result=api.reviewRows();assert.equal(result.sourceCount,0);assert.equal(result.rows.length,0);assert.equal(result.pages,1);
  savedTask(api);result=api.reviewRows();assert.equal(result.sourceCount,2);assert.deepEqual(plain(result.rows.map(r=>r.code)),['601088','000858']);
  api.setReviewFilter({status:'record'});assert.deepEqual(plain(api.reviewRows().rows.map(r=>r.code)),['601088']);
  api.setReviewFilter({status:'sample'});assert.deepEqual(plain(api.reviewRows().rows.map(r=>r.code)),['000858']);
  api.setReviewFilter({status:'pending'});assert.equal(api.reviewRows().rows.length,0);
});

test('watchlist scope uses category-qualified keys and ignores absent snapshot keys',()=>{
  const api=load(),state=api.defaultState();state.watchlist=['指数|000001','个股|601088','个股|missing'];api.setState(state);
  api.setReviewFilter({scope:'watchlist'});let result=api.reviewRows();assert.equal(result.sourceCount,2);assert.deepEqual(plain(result.rows.map(api.key)),['指数|000001','个股|601088']);
  api.setReviewFilter({status:'pending'});assert.deepEqual(plain(api.reviewRows().rows.map(api.key)),['指数|000001']);
  state.watchlist=[];result=api.reviewRows();assert.equal(result.sourceCount,0);assert.equal(result.pageRows.length,0);
});

test('pending unreviewed detail does not fabricate an assessment or expert consensus',()=>{
  const api=load();const {state,assessment}=savedTask(api),before=plain(state);
  const pending=api.records.find(r=>r.code==='000001'&&r.category==='个股');
  assert.equal(api.reviewState(pending),'pending');assert.equal(api.reviewStored(pending),undefined);assert.equal(api.reviewFixture(pending),undefined);
  const html=api.reviewDetail(pending);assert.match(html,/AWAITING ANALYSIS/);assert.match(html,/尚未生成专家会审记录/);assert.match(html,/专家共识<\/small><b>—<\/b>/);assert.doesNotMatch(html,/analyst-vote|consensus-number|SAVED SIMULATION/);
  const index=api.records.find(r=>r.category==='指数');assert.equal(api.reviewStored(index),null);assert.equal(api.reviewFixture(index),null);assert.equal(api.reviewState(index),'pending');
  assert.equal(api.reviewStored(api.records.find(r=>r.code==='601088')),assessment);assert.deepEqual(plain(state),before);
});
