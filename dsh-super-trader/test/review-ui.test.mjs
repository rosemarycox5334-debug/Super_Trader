import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../tools/invest-source.js',import.meta.url),'utf8');
const cockpit=await readFile(new URL('../tools/cockpit-source.js',import.meta.url),'utf8');
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const archived_at='2026-11-19T16:00:00+08:00';
const summaries=[{id:'R-latest',archived_at,scope:'market',target_count:2},{id:'R-older',archived_at:'2026-11-01T16:00:00+08:00',scope:'watchlist',target_count:1}];
const detail={...summaries[0],legacy:false,plan_count:4,targets:[
  {code:'601088',name:'中国神华',metrics:{status:'multiple_plans'},plans:[
    {plan_id:'P-rule',expert_id:'E1',expert_name:'价值研究者',expert_tag:'价值',plan_kind:'rule',confidence:'high',reason:'估值回到合理区间',entry_price:10,entry_direction:'below',invalidation_price:8,
      metrics:{status:'triggered',windows:{'5d':.04,'20d':.08},base_date:'2026-10-14',base_price:9.9,trigger:{date:'2026-10-14',price:9.9,source:'rule',is_fill:false,price_type:'observed_close'},as_of:'2026-11-12',is_fill:false}},
    {plan_id:'P-wait',expert_id:'E2',expert_name:'动量研究者',plan_kind:'rule',confidence:'medium',entry_price:12,entry_direction:'above',metrics:{status:'pending',days_waited:3}},
    {plan_id:'P-complex',expert_id:'E3',expert_name:'量价研究者',plan_kind:'complex',confidence:'medium',entry_note:'突破后放量两日',metrics:{status:'needs_ai',reason:'需核对量价条件',as_of:'2026-11-18'}}]},
  {code:'000001',name:'平安银行',plans:[{plan_id:'P-reference',expert_id:'E1',expert_name:'价值研究者',plan_kind:'reference',confidence:'medium',metrics:{status:'reference',windows:{'5d':.6,'20d':.9}}}]}
],experts:[{expert_id:'E1',expert_name:'价值研究者',picks:2,triggered:1,trigger_rate:1,avg_return_5d:.04,win_rate_5d:1}],confidence:[{confidence:'high',picks:1,triggered:1,trigger_rate:1}],benchmark:{windows:{'5d':{equal_weight:.04}}},warnings:['未到期不补零']};
// Deliberately use the pre-plan payload (no plans or legacy flag).
const older={...summaries[1],targets:[{code:'000002',name:'历史股票',experts:['旧专家'],confidence:'high',reason:'旧版共同理由',metrics:{status:'triggered',windows:{'5d':.01}}}],experts:[{expert:'不能归因的旧统计',picks:1}]};
function harness(custom) {
  const requests=[],entered=[];
  const dialogs=[];const context=vm.createContext({AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout,confirm:message=>{dialogs.push(message);return true;}});
  const api=vm.runInContext(cockpit+'\n'+source+'\n({createInvestStore,createInvestComponents,investMessages})',context);
  const base=async(url,init={})=>{
    if(url.endsWith('/base'))return reply({phase:'running',apiBase:'/dsh-super-trader/backend'});
    if(url.endsWith('/status'))return reply({ok:true});
    if(url.endsWith('/reviews'))return reply({items:summaries});
    if(url.endsWith('/reviews/R-latest')&&init.method==='GET')return reply(detail);
    if(url.endsWith('/reviews/R-older')&&init.method==='GET')return reply(older);
    if(url.endsWith('/reviews/sync'))return reply({archived:[],total:2});
    return reply({error:'Unexpected '+url},404);
  };
  const store=api.createInvestStore({autoConnect:false,onNavigate:tab=>entered.push(tab),fetch:async(url,init)=>{
    requests.push({url,init});return custom?custom(url,init,base):base(url,init);
  }});
  function render(element){
    if(Array.isArray(element))return element.map(render);
    if(!element||typeof element!=='object')return element;
    if(typeof element.type==='function')return render(element.type(element.props));
    return {...element,props:{...element.props,children:element.props.children.map(render)}};
  }
  function ui(name='Review',props={},effects=[]) {
    const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useSyncExternalStore:(_,get)=>get(),useEffect:fn=>effects.push(fn)};
    const dict={...vm.runInContext('cockpitMessages().zh',context),...api.investMessages().zh};
    return render(api.createInvestComponents(React,store)[name]({t:key=>dict[key]||key,...props}));
  }
  return {store,requests,entered,ui,dialogs};
}
function nodes(e){return Array.isArray(e)?e.flatMap(nodes):!e||typeof e!=='object'?[]:[e,...nodes(e.props.children)];}
function text(e){return Array.isArray(e)?e.map(text).join(' '):e&&typeof e==='object'?text(e.props.children):String(e??'');}
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label);
const summary=(tree,phrase)=>nodes(tree).find(n=>n.type==='details'&&text(n.props.children[0]).includes(phrase));
const requestsOf=h=>h.requests.filter(r=>r.url.includes('/api/reviews')).map(r=>[r.init.method,r.url.split('/api')[1]]);
const tick=()=>new Promise(r=>setImmediate(r));

async function enter(h){
  await h.store.checkConnection();
  const effects=[];h.ui('Review',{},effects);for(const fn of effects)fn();await tick();
}

test('review mount opens the latest batch with reads only; summary distinguishes waiting, entry and completed observations',async()=>{
  const h=harness();await enter(h);
  assert.deepEqual(requestsOf(h),[['GET','/reviews'],['GET','/reviews/R-latest']]);
  const tree=h.ui(),body=text(tree);
  assert.match(body,/最新批次/);assert.match(body,/R-latest/);
  assert.match(body,/1 项还在等触发；1 项已触发；1 项已满 20 个交易日/);
  assert.match(body,/20 日结果：上涨 1 项、下跌 0 项、持平 0 项/);
  assert.match(body,/1 项仅作参考/);assert.match(body,/下一步/);assert.match(body,/判定来源/);
  for(const label of ['中国神华','平安银行','专家与信心度统计','历史批次','口径与数据说明']){
    const details=summary(tree,label);assert.ok(details,label);assert.notEqual(details.props.open,true,label);
  }
  const stock=summary(tree,'中国神华'),views=nodes(stock).filter(n=>n.type==='article');
  assert.equal(views.length,3);assert.match(text(views[0]),/价值研究者.*≤ 10.*日线收盘价规则/s);assert.match(text(views[0]),/触发日 \/ 当日收盘价.*9\.9.*不代表实际成交/s);
  assert.match(text(views[1]),/动量研究者.*仍需等待.*≥ 12/s);assert.match(text(views[2]),/量价研究者.*待判定.*突破后放量两日/s);
  assert.match(text(summary(tree,'平安银行')),/参考价走势/);assert.doesNotMatch(text(summary(tree,'平安银行')),/触发后收益/);
  h.store.dispose();
});

test('manual refresh preserves the selected historical batch, no fake per-expert stats or paid controls for old payloads',async()=>{
  const h=harness();await enter(h);
  const oldRow=nodes(summary(h.ui(),'历史批次')).find(n=>n.type==='tr'&&text(n).includes('自选股'));
  await button(oldRow,'查看').props.onClick();await button(h.ui(),'刷新复盘').props.onClick();
  assert.equal(h.store.getSnapshot().reviewId,'R-older');
  assert.deepEqual(requestsOf(h).slice(-3),[['GET','/reviews/R-older'],['GET','/reviews'],['GET','/reviews/R-older']]);
  const tree=h.ui(),body=text(tree);assert.match(body,/旧版合并记录/);assert.match(body,/旧版共同理由/);assert.match(body,/不能归因/);
  assert.doesNotMatch(body,/不能归因的旧统计|手动发起 AI 判定|专家与信心度统计/);
  await button(summary(tree,'历史批次'),'归档已完成选股').props.onClick();
  assert.deepEqual(requestsOf(h).slice(-3),[['POST','/reviews/sync'],['GET','/reviews'],['GET','/reviews/R-older']]);
  h.store.dispose();
});

test('only an explicit click can send one exact complex plan, advertises cost, and refreshes the assessment',async()=>{
  let resolveJudge,judged=false;
  const h=harness((url,init,base)=>{
    if(url.endsWith('/judge'))return new Promise(resolve=>{resolveJudge=resolve;});
    if(judged&&url.endsWith('/reviews/R-latest')){
      const next=structuredClone(detail),plan=next.targets[0].plans[2];
      plan.metrics={status:'ambiguous',ai:{status:'ambiguous',reason:'真实量能证据不足',data_through:'2026-11-18',model:'review-model'}};
      return reply(next);
    }
    return base(url,init);
  });
  await enter(h);
  for(const [id,plan,consent] of [['R-latest','P-rule',true],['R-latest','P-wait',true],['R-latest','P-reference',true],['R-latest','P-complex',false],['R-older','P-complex',true]])await h.store.judgeReview(id,plan,consent);
  assert.equal(requestsOf(h).filter(([method])=>method==='POST').length,0);
  const tree=h.ui(),manual='立即 AI 判定（可能计费）';
  assert.equal(nodes(tree).filter(n=>n.type==='button'&&text(n).trim()===manual).length,1);
  assert.match(text(summary(tree,'中国神华')),/收盘后（15:05 以后）会自动判定一次/);
  const pending=button(tree,manual).props.onClick();await h.store.judgeReview('R-latest','P-complex',true);
  const calls=h.requests.filter(r=>r.url.endsWith('/judge'));
  assert.equal(calls.length,1);assert.match(calls[0].url,/R-latest\/judge$/);
  assert.deepEqual(JSON.parse(calls[0].init.body),{plan_ids:['P-complex']});
  judged=true;resolveJudge(reply({review_id:'R-latest',judged:[{plan_id:'P-complex'}],skipped:[],errors:[]}));await pending;
  assert.deepEqual(requestsOf(h).slice(-2),[['POST','/reviews/R-latest/judge'],['GET','/reviews/R-latest']]);
  const updated=h.ui();assert.match(text(updated),/已返回判定 1 项/);assert.match(text(updated),/真实量能证据不足/);
  assert.match(text(updated),/AI 所用行情截至.*2026-11-18/s);assert.ok(!button(updated,manual));
  h.store.dispose();
});

test('report references use exact review and plan identities, even if the latest list resolves afterwards',async()=>{
  let finishList;
  const h=harness((url,init,base)=>url.endsWith('/reviews')?new Promise(resolve=>{finishList=resolve;}):base(url,init));
  const comparison=[{review_id:'R-latest',plan_id:'P-complex',code:'601088',expert_name:'量价研究者',status:'needs_ai',as_of:'2026-11-18',comparison:'等待量价证据'},
    {review_id:'javascript:fake/other',status:'triggered',comparison:'未验证链接'}];
  // Exclude poison/path-like IDs and use the native panel callback rather than URLs.
  const waiting=h.store.loadReviews();
  const vote=h.ui('Vote',{vote:{expert:{name:'量价研究者'},history_comparison:comparison}});
  assert.match(text(vote),/历史复盘对照.*等待量价证据/s);assert.doesNotMatch(text(vote),/未验证链接/);
  await button(vote,'打开来源复盘').props.onClick();
  finishList(reply({items:[summaries[1],summaries[0]]}));await waiting;
  assert.deepEqual(h.entered,['review']);assert.equal(h.store.getSnapshot().reviewId,'R-latest');
  assert.equal(h.store.getSnapshot().reviewFocusPlanId,'P-complex');
  assert.equal(summary(h.ui(),'中国神华').props.open,true);assert.notEqual(summary(h.ui(),'平安银行').props.open,true);
  assert.deepEqual(requestsOf(h),[['GET','/reviews'],['GET','/reviews/R-latest']]);
  const pick=h.ui('SelectionResult',{result:{expert_results:[{expert:{id:'E3',name:'量价研究者'},picks:[{code:'601088',history_comparison:comparison}]}]}});
  assert.ok(button(pick,'打开来源复盘'));h.store.dispose();
});

test('batch re-assessment confirms once and sends every complex plan with force',async()=>{
  let judged=false;
  const h=harness((url,init,base)=>{
    if(url.endsWith('/judge')){
      judged=true;
      assert.deepEqual(JSON.parse(init.body),{plan_ids:['P-complex'],force:true});
      return reply({review_id:'R-latest',judged:[{plan_id:'P-complex'}],skipped:[],errors:[]});
    }
    if(judged&&url.endsWith('/reviews/R-latest')){
      const next=structuredClone(detail);
      next.targets[0].plans[2].metrics={status:'not_triggered',windows:{}};
      return reply(next);
    }
    return base(url,init);
  });
  await enter(h);
  const button=label=>nodes(h.ui()).find(n=>n.type==='button'&&text(n).trim()===label);
  await button('批量重新判定（可能计费）').props.onClick();
  await tick();
  assert.equal(h.dialogs.length,1);assert.match(h.dialogs[0],/1 条复杂条件/);
  const posts=h.requests.filter(r=>r.url.endsWith('/judge'));
  assert.equal(posts.length,1);
  assert.deepEqual(requestsOf(h).slice(-2),[['POST','/reviews/R-latest/judge'],['GET','/reviews/R-latest']]);
  assert.match(text(h.ui()),/已重新判定 1 项/);
  h.store.dispose();
});
