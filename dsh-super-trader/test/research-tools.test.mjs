import test from 'node:test';
import assert from 'node:assert/strict';
import {createTools} from '../lib/tools.js';
import {allowedEndpoint} from '../lib/routes.js';
function setup(value={items:[]}){const calls=[];const manager={request:async(...args)=>{calls.push(args);return value;}};const all=createTools(manager);return {calls,get:n=>all.find(t=>t.name===n)};}
test('selection starts experts without prepared stocks or common financial/quant thresholds',async()=>{
  const {calls,get}=setup({job:{id:'selection1',status:'queued'}});await get('st_screen_stocks').execute({scope:'sector',sector:'881101.TI',expert_ids:['buffett'],brief:'重视现金流'});
  assert.equal(calls[0][0],'POST');assert.equal(calls[0][1],'/api/research/select');
  assert.deepEqual(calls[0][2],{scope:'sector',sector:'881101.TI',expert_ids:['buffett'],brief:'重视现金流',limit_per_expert:5});
  for(const input of [{scope:'sector'},{limit_per_expert:0},{limit_per_expert:11},{horizon:10},{style:'trend'},{min_roe:10},{expert_ids:[]},{brief:'x'.repeat(1001)}])assert.equal((await get('st_screen_stocks').execute(input)).error.code,'invalid_arguments');
  assert.equal(calls.length,1);
});
test('default expert selection permits the whole real A-share market and returns a job once',async()=>{
  const job={job:{id:'selection1',status:'queued'}};const {calls,get}=setup(job);
  assert.equal(await get('st_screen_stocks').execute({}),job);
  assert.equal(calls.length,1);assert.deepEqual(calls[0].slice(0,3),['POST','/api/research/select',{scope:'market',limit_per_expert:5}]);
});
test('optional selection preferences may be empty and count Unicode characters consistently',async()=>{
  const {calls,get}=setup({job:{id:'selection1',status:'queued'}});
  await get('st_screen_stocks').execute({brief:''});assert.equal(calls.length,1);
  await get('st_screen_stocks').execute({brief:'🙂'.repeat(1000)});assert.equal(calls.length,2);
  assert.equal((await get('st_screen_stocks').execute({brief:'🙂'.repeat(1001)})).error.code,'invalid_arguments');
});
test('stock brief truncates only chart payload and retains source counts and quant evidence',async()=>{
  const report={kind:'stock',history:{available:true,data:{items:Array.from({length:120},(_,n)=>({date_ms:n,close_price:10+n}))}},quant:{items:[{horizon:5,available:true,result:{direction:0,probability:null}}]}};
  const {get}=setup(report);const result=await get('st_stock_research').execute({code:'601088'});
  assert.equal(result.history.data.items.length,5);assert.equal(result.history.data.omitted_items,115);assert.equal(result.history.data.returned_count,120);
  assert.equal(report.history.data.items.length,120);assert.equal(result.quant.items[0].result.probability,null);
});
test('ETF brief retains fund evidence and verified ETF factor without stock placeholders',async()=>{
  const report={kind:'stock',target:{code:'513290',category:'ETF'},fund:{available:true,data:{nav:{available:true,data:{items:[{nav_date:1000,unit_nav:1.7}]}},profile:{available:true,data:{items:[{rate_info:[{standard_rate:'0.50%'}]}]}}}},factor:{available:true,data:{target:{category:'ETF'}}}};
  const {get}=setup(report);const result=await get('st_stock_research').execute({code:'513290'});
  assert.equal(result.fund.data.nav.data.items[0].unit_nav,1.7);
  assert.equal(result.fund.data.profile.data.items[0].rate_info[0].standard_rate,'0.50%');
  assert.equal(result.factor.data.target.category,'ETF');
});
test('ETF excluded sources are omitted rather than shown as unavailable in the session',async()=>{
  const report={kind:'stock',target:{code:'513290',category:'ETF'},analysis_policy:{excluded_sources:['valuation','news'],ignore_missing_excluded:true},fund:{available:true,data:{nav:{available:true,data:{items:[{unit_nav:1.7}]}}}},valuation:{available:false,excluded:true},news:{available:false,excluded:true}};
  const {get}=setup(report);const result=await get('st_stock_research').execute({code:'513290'});
  assert.equal(Object.hasOwn(result,'valuation'),false);assert.equal(Object.hasOwn(result,'news'),false);
  assert.equal(result.fund.data.nav.data.items[0].unit_nav,1.7);assert.equal(report.news.excluded,true);
});
test('sector catalog and report require real complete index identity',async()=>{
  const {calls,get}=setup({kind:'sector',constituents:{data:{items:Array.from({length:50},(_,n)=>({code:String(n)}))}}});
  await get('st_sector_research').execute({action:'catalog',tag:'industry',q:'煤炭'});
  assert.match(calls[0][1],/^\/api\/market\/sectors\?/);
  const result=await get('st_sector_research').execute({action:'report',thscode:'881101.TI'});
  assert.equal(result.constituents.data.items.length,10);assert.equal(result.constituents.data.omitted_items,40);
  assert.equal((await get('st_sector_research').execute({action:'report',thscode:'881101'})).error.code,'invalid_arguments');
});
test('new team returns backend job once, no hidden polling or model retry',async()=>{
  const job={job:{id:'job1',status:'queued'}};const {calls,get}=setup(job);
  assert.equal(await get('st_team_research').execute({kind:'stock',code:'601088',expert_ids:['quant_expert'],wait:false}),job);
  assert.equal(calls.length,1);assert.deepEqual(calls[0].slice(0,3),['POST','/api/research/team',{kind:'stock',code:'601088',expert_ids:['quant_expert']}]);
  for(const input of [{kind:'stock',code:'881101.TI'},{kind:'sector',code:'881101'},{kind:'stock',code:'601088',expert_ids:[]}])assert.equal((await get('st_team_research').execute(input)).error.code,'invalid_arguments');
  assert.equal(calls.length,1);
});
test('name search forwards to authenticated backend directory only',async()=>{
  const {calls,get}=setup();await get('st_symbol_search').execute({q:'神华',limit:5});
  assert.equal(calls[0][1],'/api/market/search?q=%E7%A5%9E%E5%8D%8E&limit=5');
  assert.equal((await get('st_symbol_search').execute({q:'a'.repeat(61)})).error.code,'invalid_arguments');
});
test('research proxy is explicit read/write allowlist, not a generic API tunnel',()=>{
  for(const path of ['/api/research/stock','/api/research/sector','/api/research/screen','/api/market/sectors','/api/market/search'])assert.equal(allowedEndpoint('GET',path),true);
  assert.equal(allowedEndpoint('POST','/api/research/team'),true);
  assert.equal(allowedEndpoint('POST','/api/research/select'),true);
  assert.equal(allowedEndpoint('POST','/api/factors/code'),true);
  assert.equal(allowedEndpoint('GET','/api/factors/code'),false);
  assert.equal(allowedEndpoint('GET','/api/research/quant-screen'),true);
  assert.equal(allowedEndpoint('GET','/api/research/select'),false);
  assert.equal(allowedEndpoint('GET','/api/research/admin'),false);
  assert.equal(allowedEndpoint('POST','/api/research/stock'),false);
});
