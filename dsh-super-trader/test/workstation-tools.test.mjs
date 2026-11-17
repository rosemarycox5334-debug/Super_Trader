import test from 'node:test';
import assert from 'node:assert/strict';
import {createTools} from '../lib/tools.js';
import {createHandlers} from '../lib/routes.js';
import {EventEmitter} from 'node:events';

function setup(data={actual:true}){
  const calls=[];
  const manager={request:async(...args)=>{calls.push(args);return data;},retryBackend:async()=>{calls.push(['retry']);return {phase:'running'};}};
  const tools=createTools(manager);
  return {calls,get:n=>tools.find(t=>t.name===n),manager};
}
test('history bounds and explicit price adjustment forward to same backend',async()=>{
  const {calls,get}=setup();
  assert.deepEqual(await get('st_market_history').execute({code:'601088',adjust:'none'}),{actual:true});
  assert.equal(calls[0][1],'/api/market/history?code=601088&adjust=none&limit=60');
  assert.equal(calls[0][3].timeoutMs,45000);
  for(const args of [{code:'bad'}, {code:'601088',limit:181}, {code:'601088',limit:0},{code:'601088',adjust:'bad'}])assert.equal((await get('st_market_history').execute(args)).error.code,'invalid_arguments');
  assert.equal(calls.length,1);
});
test('watchlist list bounded pagination and remove use canonical API',async()=>{
  const {calls,get}=setup({items:[{code:'a'},{code:'b'},{code:'c'}],max:200});
  const result=await get('st_watchlist').execute({action:'list',offset:1,limit:1});
  assert.deepEqual(result.items,[{code:'b'}]); assert.equal(result.total,3); assert.equal(result.has_more,true);
  await get('st_watchlist').execute({action:'remove',code:'601088',category:'个股'});
  assert.equal(calls[1][0],'DELETE');assert.equal(calls[1][1],'/api/watchlist?code=601088&category=%E4%B8%AA%E8%82%A1');
  assert.equal((await get('st_watchlist').execute({action:'remove',code:'601088'})).error.code,'invalid_arguments');
});
test('journal discovery is concise, detail and edits retain exact identities',async()=>{
  const raw={items:[{id:'J1',symbol:{code:'601088'},signal:{probability:null},reasons:{summary:'frozen'},note:'original'}]};
  const {calls,get}=setup(raw);
  const list=await get('st_journal').execute({action:'list'});
  assert.equal(list.items[0].id,'J1');assert.equal(list.items[0].reasons,undefined);
  assert.equal(await get('st_journal').execute({action:'get',id:'J1'}),raw);
  await get('st_journal').execute({action:'update',id:'J1',note:'',closed:true,price:50});
  assert.deepEqual(calls.at(-1).slice(0,3),['PATCH','/api/journal/J1',{note:'',price:50,closed:true}]);
  assert.equal((await get('st_journal').execute({action:'update',id:'J1'})).error.code,'invalid_arguments');
});
test('journal freezes provided real evidence without silent probability requery',async()=>{
  const {calls,get}=setup();
  const payload={code:'601088',action:'watch',signal:{direction:0,probability:null,evaluation:{type:'in_sample'}},reasons:{summary:'from observed data',evidence:{quote:{last_price:50,timestamp:123}}}};
  await get('st_journal_create').execute(payload);
  assert.deepEqual(calls[0].slice(0,3),['POST','/api/journal',payload]);
  assert.equal((await get('st_journal_create').execute({...payload,reasons:[]})).error.code,'invalid_arguments');
});
test('catalog and jobs expose otherwise hidden IDs and real cancellation',async()=>{
  const {calls,get}=setup({items:[{id:'expert1',name:'Example',system_prompt:'large private prompt'}]});
  const catalog=await get('st_research_catalog').execute({kind:'experts'});
  assert.equal(catalog.items[0].id,'expert1');assert.equal(catalog.items[0].system_prompt,undefined);
  assert.equal((await get('st_research_catalog').execute({kind:'symbols'})).error.code,'invalid_arguments');
  await get('st_job').execute({action:'cancel',id:'a/b'});
  assert.equal(calls.at(-1)[1],'/api/jobs/a%2Fb/cancel');
});
test('backend recovery button and tool share retry operation and trust fence',async()=>{
  const {manager,calls,get}=setup();
  await get('st_backend_retry').execute({}); assert.deepEqual(calls,[['retry']]);
  const h=createHandlers(manager,()=> 'http://127.0.0.1:57621');
  const res=()=>{const r=new EventEmitter();r.writeHead=(status)=>r.status=status;r.end=text=>{r.text=text;r.writableEnded=true;};return r;};
  let response=res();await h.retry({method:'POST',headers:{host:'127.0.0.1:57621'}},response);
  assert.equal(response.status,200);assert.equal(JSON.parse(response.text).phase,'running');assert.equal(calls.length,2);
  response=res();await h.retry({method:'POST',headers:{host:'evil'}},response);assert.equal(response.status,403);assert.equal(calls.length,2);
  response=res();await h.retry({method:'GET',headers:{host:'127.0.0.1:57621'}},response);assert.equal(response.status,405);
});
