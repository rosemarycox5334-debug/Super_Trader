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
    if(url.endsWith('/portfolios'))return reply({portfolios:[]});
    if(url.endsWith('/reviews'))return reply({items:summaries,pending_archive:1});
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
    const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useSyncExternalStore:(_,get)=>get(),useEffect:fn=>effects.push(fn),useRef:current=>({current})};
    const {lang='zh',...viewProps}=props;
    const dict={...vm.runInContext('cockpitMessages()',context)[lang],...api.investMessages()[lang]};
    return render(api.createInvestComponents(React,store)[name]({t:key=>dict[key]||key,...viewProps}));
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
  assert.match(text(updated),/1 项待补证（不计模拟入场）/);
  assert.doesNotMatch(text(updated),/复杂条件等待 AI 判定/);
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

const portfolioPayload={started_at:'2026-11-13T09:00:00+08:00',initial_cash:100000,max_positions:5,target_weight:.2,
  benchmark:{name:'沪深300',history:[{date:'2026-11-13',nav:100000,return:0},{date:'2026-11-20',nav:102000,return:.02}]},
  portfolios:[
    {expert_id:'E1',expert_name:'价值专家',cash:83000,nav:103100,max_drawdown:-.0275,realized_pnl:400,unrealized_pnl:1200,closed_count:2,closed_wins:1,closed_win_rate:.5,as_of:'2026-11-20',
      nav_history:[{date:'2026-11-20',nav:103100},{date:'2026-11-13',nav:100000},{date:'2026-11-16',nav:101000},{date:'2026-11-17',nav:null},{date:'2026-11-18',nav:102500}],
      open_positions:[{code:'601088',name:'中国神华',entry_date:'2026-11-16',entry_price:30,entry_cost:18000,mark_price:32,quantity:600,unrealized_pnl:1200,invalidation_price:27,entry_reason:'已验证买入条件'},{code:'600000',name:'浦发银行',entry_cost:1000,unrealized_pnl:null}],
      closed_positions:[{code:'601088',name:'中国神华',entry_date:'2026-11-13',entry_cost:1500,exit_date:'2026-11-16',exit_price:34,realized_pnl:600,exit_reason:'估值达到目标'},{code:'000001',name:'平安银行',entry_cost:1500,realized_pnl:-200,exit_reason:'硬止损'}],
      queued_orders:[{code:'600519',name:'贵州茅台',side:'buy',decision_at:'2026-11-20T15:06:00+08:00',reason:'突破已验证',status_reason:'等待后续开盘'}]},
    {expert_id:'E2',expert_name:'趋势专家',cash:100000,nav:99600,max_drawdown:-.004,unrealized_pnl:null,realized_pnl:0,closed_count:0,closed_wins:0,closed_win_rate:null,
      nav_history:[{date:'2026-11-20',nav:99600}]},
  ]};
const dashboard=tree=>nodes(tree).find(n=>n.type==='section'&&n.props.className?.includes('sti-portfolio'));
const series=(tree,id)=>nodes(dashboard(tree)).find(n=>n.props['data-series']===id);
const plot=tree=>nodes(dashboard(tree)).find(n=>n.type==='svg');
function metric(tree,label){return text(nodes(dashboard(tree)).find(n=>n.props.className==='sti-metric'&&text(n.props.children[0])===label)?.props.children[1]);}

test('portfolio is first, fetches read-only data and toggles dated NAV/return series without requests',async()=>{
  const h=harness((url,init,base)=>url.endsWith('/portfolios')?reply(portfolioPayload):base(url,init));
  await enter(h);
  const apiCalls=()=>h.requests.filter(r=>r.url.includes('/api/')).map(r=>[r.init.method,r.url.split('/api')[1]]);
  const mounted=[['GET','/status'],['GET','/portfolios'],['GET','/reviews'],['GET','/reviews/R-latest']];
  assert.deepEqual(apiCalls(),mounted);
  let tree=h.ui('Review',{lang:'en'});
  assert.ok(text(tree).indexOf('Simulated expert portfolios')<text(tree).indexOf('Selection batch review'));
  assert.match(plot(tree).props['aria-label'],/Cumulative return .* Date/);
  assert.ok(series(tree,'E1')&&series(tree,'E2')&&series(tree,'csi300'));
  const strokes=nodes(series(tree,'E1')).filter(n=>n.type==='path');
  assert.equal(strokes.length,2,'an explicit missing NAV splits the path');
  const dx=d=>{const [x1,x2]=d.match(/[ML]\d+(?:\.\d+)?/g).map(s=>Number(s.slice(1)));return x2-x1;};
  assert.ok(Math.abs(dx(strokes[0].props.d)/dx(strokes[1].props.d)-1.5)<.001,'Fri–Mon uses three calendar days, Wed–Fri two');
  assert.equal(nodes(series(tree,'E2')).filter(n=>n.type==='path').length,0);
  assert.equal(nodes(series(tree,'E2')).filter(n=>n.type==='circle').length,1);
  const legend=label=>nodes(dashboard(tree)).find(n=>n.type==='button'&&text(n).trim().endsWith(label));
  legend('价值专家').props.onClick();tree=h.ui('Review',{lang:'en'});
  assert.equal(legend('价值专家').props['aria-pressed'],false);assert.equal(series(tree,'E1'),undefined);
  legend('CSI 300').props.onClick();tree=h.ui('Review',{lang:'en'});assert.equal(series(tree,'csi300'),undefined);
  button(tree,'Portfolio NAV (CNY)').props.onClick();tree=h.ui('Review',{lang:'en'});
  assert.match(plot(tree).props['aria-label'],/Portfolio NAV/);
  legend('CSI 300').props.onClick();tree=h.ui('Review',{lang:'en'});assert.ok(series(tree,'csi300'),'backend supplies rebased NAV');
  legend('CSI 300').props.onClick();legend('趋势专家').props.onClick();tree=h.ui('Review',{lang:'en'});
  assert.equal(plot(tree),undefined);assert.match(text(dashboard(tree)),/No visible series/);
  assert.deepEqual(apiCalls(),mounted,'display controls are local only');
  await button(tree,'Refresh portfolios').props.onClick();assert.deepEqual(apiCalls().at(-1),['GET','/portfolios']);
  h.store.dispose();
});

test('selected expert metrics, execution reasons and stock attribution use portfolio figures',async()=>{
  const h=harness((url,init,base)=>url.endsWith('/portfolios')?reply(portfolioPayload):base(url,init));await enter(h);
  let tree=h.ui('Review',{lang:'en'});
  assert.equal(metric(tree,'Total return'),'+3.1%');assert.equal(metric(tree,'Maximum drawdown'),'-2.75%');
  assert.equal(metric(tree,'Realized P&L'),'+400 CNY');assert.equal(metric(tree,'Open P&L'),'+1,200 CNY');
  assert.equal(metric(tree,'Closed win rate (wins / closes)'),'50% · 1 / 2');
  assert.match(text(summary(tree,'Open holdings')),/中国神华.*32.*27.*\+1,200 CNY.*已验证买入条件/s);
  assert.match(text(summary(tree,'Queued orders')),/贵州茅台.*Buy.*突破已验证.*等待后续开盘/s);
  assert.match(text(summary(tree,'Closed trades')),/中国神华.*\+600 CNY.*估值达到目标.*平安银行.*-200 CNY.*硬止损/s);
  const contribution=summary(tree,'P&L contribution by stock');
  assert.match(text(contribution),/中国神华.*\+1,200 CNY.*\+600 CNY.*\+1,800 CNY/s);
  assert.match(text(contribution),/浦发银行[^+]*—.*—.*—/s);assert.doesNotMatch(text(contribution),/贵州茅台/);
  nodes(dashboard(tree)).find(n=>n.type==='select').props.onChange({target:{value:'E2'}});
  tree=h.ui('Review',{lang:'en'});
  assert.equal(metric(tree,'Total return'),'-0.4%');assert.equal(metric(tree,'Open P&L'),'—');
  assert.equal(metric(tree,'Closed win rate (wins / closes)'),'— · 0 / 0');
  assert.doesNotMatch(text(dashboard(tree)),/中国神华/);assert.match(text(dashboard(tree)),/No open holdings|No closed trades/);
  h.store.dispose();
});

test('unstarted experts and missing marks show guidance or gaps, not an invented history or benchmark',async()=>{
  const blank=harness((url,init,base)=>url.endsWith('/portfolios')?reply({initial_cash:100000,portfolios:[{expert_id:'E1',cash:100000,nav:100000,nav_history:[],max_drawdown:0}],benchmark:portfolioPayload.benchmark}):base(url,init));
  await enter(blank);
  const view=blank.ui('Review',{lang:'en'});assert.match(text(dashboard(view)),/No simulated portfolios yet/);assert.equal(plot(view),undefined);
  assert.doesNotMatch(text(dashboard(view)),/Maximum drawdown/);
  button(view,'Start a new selection batch').props.onClick();assert.deepEqual(blank.entered,['screen']);blank.store.dispose();
  const points=harness((url,init,base)=>url.endsWith('/portfolios')?reply({started_on:'2026-11-13',initial_cash:100000,items:[{expert_id:'E1',curve:[{date:'2026-11-13',nav:null,return:null}],total_return:null}],benchmark:null}):base(url,init));
  await enter(points);const tree=points.ui('Review',{lang:'en'});
  assert.match(text(dashboard(tree)),/CSI 300 benchmark is unavailable.*There are no simulated NAV or return observations/s);
  assert.equal(plot(tree),undefined);assert.equal(metric(tree,'Total return'),'—');assert.equal(metric(tree,'Maximum drawdown'),'—');
  assert.equal(points.requests.some(r=>r.init.method==='POST'),false);points.store.dispose();
});

test('selection repeats explain the prior selection and authorization reason only when present',()=>{
  const h=harness();
  const tree=h.ui('SelectionResult',{lang:'en',result:{expert_results:[{expert:{id:'E1',name:'Value'},picks:[{code:'601088',name:'Example',reselection:{times:2,last_selected_at:'2026-11-19T16:00:00+08:00',reason:'New valuation evidence'}}]}]}});
  assert.match(text(tree),/Selected again by this expert.*Times selected: 2.*Previously selected at.*Why it was selected again: New valuation evidence/s);
  h.store.dispose();
});

test('manual archive stays hidden unless the API reports unarchived selections',async()=>{
  const h=harness((url,init,next)=>url.endsWith('/reviews')?reply({items:summaries,pending_archive:0}):next(url,init));
  await enter(h);
  const history=summary(h.ui(),'历史批次');
  assert.ok(history);
  assert.equal(nodes(history).filter(n=>n.type==='button'&&text(n).trim()==='归档已完成选股').length,0);
  h.store.dispose();
});
