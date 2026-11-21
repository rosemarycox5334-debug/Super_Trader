import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source=await readFile(new URL('../tools/daily-review-source.js',import.meta.url),'utf8');
const api=vm.runInNewContext(`${source}\n({investDailyReviewReport,investDailyReviewHtml})`);
const project=(...args)=>JSON.parse(JSON.stringify(api.investDailyReviewReport(...args)));
const html=api.investDailyReviewHtml;
const day='2026-11-20', prev='2026-11-19', older='2026-11-18', next='2026-11-23';
const point=(date,nav,fields={})=>({date,nav,...fields});
const book=(id,fields={})=>({expert_id:id,expert_name:`Expert ${id}`,initial_cash:100000,curve:[],pending:[],positions:[],closed:[],...fields});
const order=(id,fields={})=>({id,code:'601088',status:'queued',side:'buy',queued_at:`${day}T16:00:00+08:00`,reason:'Frozen order reason',...fields});
const plan=(id,metrics,fields={})=>({plan_id:id,expert_id:'A',metrics,selected_at:`${prev}T09:00:00+08:00`,entry_price:10,entry_direction:'above',...fields});
const detail=(...plans)=>({id:'R1',targets:[{code:'601088',name:'Example',plans}]});
const approx=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} ≈ ${expected}`);

test('triggered signals carry observation returns and capital, never as portfolio NAV',()=>{
  const a=book('A',{curve:[point(day,100000)]});
  const r=detail(
    plan('old',{status:'triggered',base_date:prev,as_of:day,trigger:{date:prev},base_price:20,current:0.05,windows:{'1d':0.02,'3d':0.05},max_drawdown:-0.01}),
    plan('today',{status:'triggered',base_date:day,as_of:day,trigger:{date:day},base_price:40,current:null,windows:{}}),
  );
  const report=project(day,{items:[a],initial_cash:100000},[r]);
  assert.equal(report.capital,100000);
  assert.equal(report.experts[0].initial,100000);
  assert.deepEqual(report.signals.map(s=>[s.planId,s.triggerDate,s.current,s.windows]),[
    ['old',prev,0.05,{'1d':0.02,'3d':0.05}],['today',day,null,{}]]);
  assert.deepEqual(report.signalSummary,{count:2,current:0.05,maxDrawdown:-0.01,windows:{'1d':0.02,'3d':0.05}});
  assert.equal(report.experts[0].totalReturn,0);
  const page=html(report,'zh',null);
  assert.match(page,/每位专家本金/);
  assert.match(page,/100,000/);
  assert.match(page,/已触发信号跟踪/);
  assert.match(page,/已触发信号：按窗口的等权收益/);
  const fresh=html(project(day,{items:[a]},[detail(plan('today',{status:'triggered',base_date:day,as_of:day,trigger:{date:day},base_price:40}))]),'zh',null);
  assert.match(fresh,/尚无已走完的交易日/);
  // Latest prices are attached only at render time and produce an intraday return.
  const livePage=html(report,'zh',null,{live:{quotes:{'601088':22},time:Date.UTC(2026,10,20,7,0,0),
    curve:[{date:prev,value:0},{date:day,value:0.1}]}});
  assert.match(livePage,/最新行情截至/);
  assert.match(livePage,/22\.00/);
  assert.match(livePage,/10%/);
  assert.match(livePage,/自触发日累计收益/);
});

test('clips future NAV and warnings, aligns the union of dates and does not bridge a missing prior session',()=>{
  const a=book('A',{curve:[point(day,110000,{warnings:['current','current',null]}),point('2026-02-30',3),point(older,100000),point(next,999999,{warnings:['future']})]});
  const b=book('B',{curve:[point(older,105000),point(prev,100000),point(day,90000)]});
  const c=book('C',{curve:[point(prev,100000),point(day,NaN,{return:0.21}),point(next,101000)]});
  const report=project(day,{items:[a,b,c]},[]);
  const [first,second,third]=report.experts;
  assert.deepEqual(first.points.map(p=>[p.date,p.stamp,p.nav]),[[older,Date.parse(older),100000],[prev,Date.parse(prev),null],[day,Date.parse(day),110000]]);
  assert.equal(first.points[1].value,null);
  assert.equal(first.nav,110000);
  assert.equal(first.navDate,day);
  assert.equal(first.dayReturn,null);
  assert.deepEqual(first.warnings,['current']);
  approx(first.totalReturn,0.1);
  approx(second.dayReturn,-0.1);
  approx(second.drawdown,90000/105000-1);
  assert.equal(third.nav,null);
  assert.equal(third.dayReturn,null);
  assert.equal(third.totalReturn,null);
  const closedMarket=project(next,{items:[{...b,curve:b.curve}]},[]).experts[0];
  assert.equal(closedMarket.navDate,day);
  assert.equal(closedMarket.dayReturn,null);
});

test('uses mutually exclusive dated plan classes; keeps plans and actual simulated ledger actions distinct',()=>{
  const position={id:'pos-1',code:'601088',name:'Example',entry_date:day,exit_date:day,entry_price:10,exit_price:11,entry_reason:'Entry',exit_reason:'Exit'};
  const a=book('A',{
    pending:[order('q1'),order('q1'),order('q2',{status:'filled'}),order('q3',{queued_at:`${prev}T16:01:00Z`}),order('q4',{queued_at:`${next}T09:00:00+08:00`})],
    closed:[position,{...position,id:'pos-2',entry_date:day,exit_date:next,exit_reason:'Future close'}],
    positions:[{...position,exit_date:null},{...position,id:'pos-3',entry_date:next,exit_date:null}],
  });
  const r=detail(
    plan('rule',{status:'triggered',trigger:{date:day},as_of:next,reason:'Future metric wording'},{reason:'Original signal'}),
    plan('base',{status:'triggered',base_date:day,as_of:day}),
    plan('future-trigger',{status:'triggered',trigger:{date:next},base_date:day,as_of:next}),
    plan('future-ai',{status:'triggered',trigger:{date:day},as_of:day,ai:{judged_on:next}}),
    plan('selected-later',{status:'triggered',trigger:{date:day}},{selected_at:next}),
    plan('waiting',{status:'pending',as_of:day,reason:'System status reason'},{selected_at:day}),
    plan('waiting-past',{status:'pending',as_of:prev}),
    plan('needs-verification',{status:'needs_ai',as_of:day}),
    plan('ambiguous',{status:'ambiguous',as_of:day}),
    plan('unavailable',{status:'unavailable',as_of:day}),
    plan('unknown-as-of',{status:'unavailable',as_of:null}),
    plan('selected-only',{status:'pending',as_of:next,reason:'Future pending reason'},{selected_at:day}),
    plan('irrelevant-observation',{status:'reference',as_of:day,base_date:day,current:1.75}),
  );
  const report=project(day,{items:[a]},[r,r]);
  assert.deepEqual(report.counts,{experts:1,triggered:2,queued:2,buys:2,sells:1,pending:1,unverified:3,selected:1});
  const [expert]=report.experts;
  assert.deepEqual(expert.plans.map(p=>[p.planId,p.status,p.reason]),[
    ['rule','triggered','Original signal'],['base','triggered',''],['waiting','pending','System status reason'],
    ['needs-verification','needs_ai',''],['ambiguous','ambiguous',''],['unavailable','unavailable',''],['selected-only','selected','']
  ]);
  assert.deepEqual(expert.plans[0],{code:'601088',name:'Example',status:'triggered',reason:'Original signal',condition:'≥ 10',reviewId:'R1',planId:'rule'});
  assert.equal(expert.buys[1].reason,'Entry');
  assert.equal(expert.sells[0].reason,'Exit');
  assert.equal(expert.totalReturn,null);
  assert.ok(!JSON.stringify(report).includes('Future'));
});

test('partial historical preview retains dated ledger/trigger facts, not mutable status or queue snapshots',()=>{
  const books={items:[book('A',{pending:[order('q1')],positions:[{id:'P',code:'601088',entry_date:day,entry_price:8}]})]};
  const details=[detail(plan('triggered',{status:'triggered',trigger:{date:day},as_of:next}),plan('pending',{status:'pending',as_of:day}))];
  const report=project(day,books,details,{partial:true});
  assert.equal(report.partial,true);
  assert.equal(report.historical,true);
  assert.equal(report.counts.triggered,1);
  assert.equal(report.counts.buys,1);
  assert.equal(report.counts.queued,0);
  assert.equal(report.counts.pending,0);
  assert.deepEqual(report.experts[0].plans.map(p=>p.status),['triggered']);
  assert.match(html(report,'en'),/New queued orders<\/dt><dd>—<\/dd>/);
  const livePartial=project(day,books,details,{partial:true,historical:false});
  assert.equal(livePartial.partial,true);
  assert.equal(livePartial.counts.queued,1);
  assert.equal(livePartial.counts.pending,1);
});

test('the live sample shape has one marker per settled expert: three triggers and queues, zero fills',()=>{
  const books={items:Array.from({length:7},(_,i)=>book(i===0?'A':`E${i}`,{
    curve:[point(day,100000)],pending:i===0?[order('one'),order('two'),order('three')]:[]
  }))};
  const details=[detail(...[1,2,3].map(i=>plan(`P${i}`,{status:'triggered',trigger:{date:day},as_of:day})))];
  const report=project(day,books,details);
  assert.deepEqual(report.counts,{experts:7,triggered:3,queued:3,buys:0,sells:0,pending:0,unverified:0,selected:0});
  assert.ok(report.experts.every(expert=>expert.nav===100000&&expert.dayReturn===null&&expert.totalReturn===0));
  const doc=html(report);
  assert.equal(doc.match(/<circle /g)?.length,7);
  assert.doesNotMatch(doc,/<polyline /);
});

test('empty reports neither fabricate performance nor chart a series; bad cutoff never selects data',()=>{
  const report=project(day,{items:[book('A')]},[{targets:[{code:'000001',metrics:{status:'triggered',base_date:day}}]}]);
  const [expert]=report.experts;
  assert.deepEqual([expert.nav,expert.dayReturn,expert.totalReturn,expert.drawdown],[null,null,null,null]);
  assert.deepEqual([expert.points,expert.plans,expert.queued,expert.buys,expert.sells],[[],[],[],[],[]]);
  assert.doesNotMatch(html(report),/<svg\b/);
  assert.equal(project('2026-02-30',{items:[book('A',{curve:[point(day,100000)]})]},[]).counts.experts,0);
});

test('standalone HTML escapes all displayed text and does not connect disconnected markers',()=>{
  const attack=`</title><script>bad()</script><img src=x onerror='bad()'>&"`;
  const report=project(day,{items:[book('A',{expert_name:attack,curve:[point(older,100000),point(prev,null),point(day,102000,{warnings:[attack]})],pending:[order('1',{name:attack,reason:attack})]})]},
    [detail(plan('1',{status:'pending',as_of:day},{name:attack,entry_note:attack,reason:attack}))]);
  const doc=html(report,'en');
  assert.match(doc,/^<!doctype html>/);
  assert.match(doc,/Content-Security-Policy/);
  assert.match(doc,/2026-11-20/);
  assert.match(doc,/&lt;\/title&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;&lt;img src=x onerror=&#39;bad\(\)&#39;&gt;&amp;&quot;/);
  assert.doesNotMatch(doc,/<script\b|<img\b|<link\b|<polyline\b/);
  assert.equal(doc.match(/<circle /g)?.length,2);
  assert.match(doc,/No new AI commentary/);
  const contiguous=project(day,{items:[book('A',{curve:[point(prev,100000),point(day,102000)]})]},[]);
  assert.match(html(contiguous),/<polyline /);
});

test('optional commentary is escaped, scoped to report experts, and never required',()=>{
  const report=project(day,{items:[book('A')]},[]);
  assert.match(html(report,'en'),/Awaiting AI commentary/);
  const doc=html(report,'en',{summary:'<script>summary</script>',experts:[
    {id:'A',comment:'<img src=x>',watch:['Watch <b>levels</b>','Confirm & log']},
    {id:'not-in-report',comment:'Do not include me'}
  ]});
  assert.match(doc,/&lt;script&gt;summary&lt;\/script&gt;/);
  assert.match(doc,/&lt;img src=x&gt;/);
  assert.match(doc,/Watch &lt;b&gt;levels&lt;\/b&gt;/);
  assert.match(doc,/Confirm &amp; log/);
  assert.doesNotMatch(doc,/<script\b|<img\b|<b\b|Do not include me|Awaiting AI commentary/);
});
