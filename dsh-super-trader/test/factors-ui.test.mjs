import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('tools/invest-source.js',root),'utf8');
const cockpit=await readFile(new URL('tools/cockpit-source.js',root),'utf8');
const template=await readFile(new URL('tools/client-source.js',root),'utf8');
const css=await readFile(new URL('assets/invest.css',root),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const report=(code='601088',rule='unified-rule')=>({kind:'factor',target:{code,name:'真实股票',timeframe:'1d',category:'个股'},as_of:'2026-11-05',bars:4558,direction:-1,rule:{id:rule,name:rule==='other-rule'?'另一条共用规则':'统一方向规则'},metrics:{accuracy:.58,coverage:.42,evaluated:9820,correct:5696,skipped:0,not_evaluated:0,baseline:{always_up:.512,same_set:.55},per_horizon:Array.from({length:20},(_,i)=>({h:i+1,accuracy:.61-i*.005,evaluated:491})),confusion:{up:{up:100,down:80,flat:0},down:{up:40,down:120,flat:1}}},rules:[{id:'unified-rule',name:'统一方向规则',accuracy:.58,coverage:.42},{id:'other-rule',name:'另一条共用规则',accuracy:.62,coverage:.3}],warnings:['全样本回测，未做样本外；历史频率不是未来概率']});
const backtest=(code='601088',rule='unified-rule')=>({...report(code,rule),samples:{false_positive:[{date:'2026-09-18',h:17,ret:-.064}],false_negative:[{date:'2026-09-21',h:4,ret:.025}]}});
function setup(custom) {
  const requests=[],context=vm.createContext({AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout});
  const api=vm.runInContext(cockpit+'\n'+source+'\n({createInvestStore,createInvestComponents,investMessages,investFactorReport})',context);
  const base=async(url,init={})=>{
    const u=new URL('http://local'+url);
    if(url.endsWith('/base'))return reply({phase:'running',apiBase:'/dsh-super-trader/backend'});
    if(url.endsWith('/status'))return reply({ok:true});
    if(u.pathname.endsWith('/factors/universe'))return reply({total:1200,timeframe:'1d',categories:[{category:'个股',count:1000},{category:'ETF',count:150},{category:'指数',count:50}]});
    if(u.pathname.endsWith('/api/jobs'))return reply({items:[]});
    if(u.pathname.endsWith('/factors/stock')){const r=report(u.searchParams.get('code'));r.target.category=u.searchParams.get('category');return reply(r);}
    if(u.pathname.endsWith('/factors/library'))return reply({items:report().rules.map(({id,name},i)=>({id,name,summary:i===0?'趋势跟随：价格高于20日均线时看涨':null,accuracy:i===0?.58:null,coverage:i===0?.42:null,targets:1200,evaluated:9820,sample_quality:'normal',best_targets:12,created_at:'2026-11-15T00:00:00Z',job_id:'job-1',top_accuracy:i===0?{target_id:'个股:601088',code:'601088',name:'真实股票',accuracy:.58,coverage:.42}:null,top_coverage:i===0?{target_id:'个股:601088',code:'601088',name:'真实股票',accuracy:.58,coverage:.42}:null})),total:2,warning:'历史分数不等于当前表现'});
    if(u.pathname.endsWith('/factors/rules'))return reply({items:report().rules.map(({id,name})=>({id,name})),total:2});
    if(u.pathname.endsWith('/factors/backtest')){const r=backtest(u.searchParams.get('code'),u.searchParams.get('rule_id'));r.target.category=u.searchParams.get('category');return reply(r);}
    return reply({error:'Unexpected URL '+url},404);
  };
  const store=api.createInvestStore({autoConnect:false,fetch:async(url,init)=>{requests.push({url,init});return custom?custom(url,init,base):base(url,init);}});
  return {api,store,requests};
}
function fakeReact(effects=[]) {return {Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useSyncExternalStore:(_sub,get)=>get(),useEffect:fn=>effects.push(fn),useRef:()=>({current:null}),useState:value=>[value,()=>{}]};}
function render(node){if(Array.isArray(node))return node.map(render);if(!node||typeof node!=='object')return node;if(typeof node.type==='function')return render(node.type(node.props));return {...node,props:{...node.props,children:(node.props?.children || []).map(render)}};}
function nodes(node){return Array.isArray(node)?node.flatMap(nodes):!node||typeof node!=='object'?[]:[node,...nodes(node.props?.children || [])];}
function text(node){return Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):String(node ?? '');}
function ui(h,name='Factors',props={},effects=[]) {const c=h.api.createInvestComponents(fakeReact(effects),h.store),t=key=>h.api.investMessages().zh[key] || key;return render(c[name]({t,...props}));}
const factorRequests=h=>h.requests.filter(r=>r.url.includes('/api/factors/'));

test('factor declarations are idle, localized and use a separate default daily stock state',()=>{
  const h=setup(),s=h.store.getSnapshot();assert.equal(h.requests.length,0);assert.equal(s.factors.code,'601088');assert.equal(s.factors.timeframe,'1d');assert.equal(s.factors.tab,'batch');assert.equal(s.factors.report.data,null);assert.equal(s.report.data,null);
  const messages=h.api.investMessages();assert.equal(messages.zh.factors,'量化因子预测');assert.deepEqual(Object.keys(messages.zh).sort(),Object.keys(messages.en).sort());assert.doesNotMatch(source,/^(?:import |export |window\.|document\.)/m);h.store.dispose();
});
test('native factor view has only batch, library and backtest; removed stock form has no visible entry',()=>{
  const h=setup(),batch=ui(h);assert.deepEqual(nodes(batch).filter(n=>n.props?.role==='tab').map(text),['批量挖掘','因子库','回测详情']);assert.equal(nodes(batch).some(n=>n.type==='input'&&n.props.value==='601088'),false);assert.doesNotMatch(text(batch),/单股查询|查询本地回测/);h.store.factorTab('predict');assert.equal(h.store.getSnapshot().factors.tab,'batch');
  h.store.factorTab('backtest');const tree=ui(h);assert.match(text(tree),/先在因子库选择一条已挖掘量化因子/);assert.equal(nodes(tree).find(n=>n.type==='input').props.value,'601088');assert.equal(nodes(tree).find(n=>n.type==='button'&&text(n)==='查询该量化因子回测').props.disabled,true);assert.equal(nodes(tree).some(n=>n.type==='option'&&['1d','5m','1h','1w'].includes(n.props.value)),false);assert.equal(nodes(tree).some(n=>n.type==='iframe'),false);assert.equal(h.requests.length,0);h.store.dispose();
});
test('connected initial mount reads full directory and history only; never stock query, LLM, or POST',async()=>{
  const h=setup();await h.store.checkConnection();const effects=[];ui(h,'Factors',{},effects);const cleanup=effects.map(fn=>fn()).filter(fn=>typeof fn==='function');await tick();assert.equal(factorRequests(h).length,1);assert.match(factorRequests(h)[0].url,/factors\/universe$/);assert.ok(h.requests.some(r=>r.url.endsWith('/jobs?limit=10')));
  await h.store.ensureFactors();assert.equal(factorRequests(h).length,1);assert.equal(h.requests.some(r=>r.init.method==='POST'||/research\/|expert|evolve/.test(r.url)),false);cleanup.forEach(fn=>fn());h.store.dispose();
});
test('contract parsing displays final accuracy, direction, coverage, baselines and the single shared rule',async()=>{
  const h=setup();await h.store.selectFactorRule('unified-rule',true);const d=h.store.getSnapshot().factors.backtest.data;assert.equal(d.kind,'factor');assert.equal(d.metrics.per_horizon.length,20);assert.equal(d.rule.id,'unified-rule');
  const tree=ui(h);for(const value of ['最终预测准确率','58%','偏空','42%','9,820','51.2%','55%','统一方向规则','2026-11-05','4,558','h=1–20共用同一条量化因子'])assert.ok(text(tree).includes(value),value);
  assert.equal(nodes(tree).find(n=>n.props?.className==='sti-factor-accuracy').props['data-accuracy'],'0.58');assert.equal(nodes(tree).find(n=>n.props?.className==='sti-factor-direction').props['data-direction'],-1);assert.equal(h.store.getSnapshot().target,null);h.store.dispose();
});
test('per-horizon SVG draws all 20 observed accuracy bars with real zero, and null leaves a gap',()=>{
  const h=setup(),rows=report().metrics.per_horizon;rows[0].accuracy=0;rows[1].accuracy=null;
  const tree=ui(h,'FactorCurve',{items:rows});assert.equal(nodes(tree).filter(n=>n.type==='rect').length,19);assert.equal(nodes(tree).filter(n=>n.type==='circle').length,19);assert.equal(nodes(tree).filter(n=>n.type==='text'&&n.props.textAnchor==='middle').length,20);assert.match(text(tree),/空值留空，不补零/);assert.doesNotMatch(JSON.stringify(tree),/NaN|Infinity/);
  const empty=ui(h,'FactorCurve',{items:rows.map(row=>({...row,accuracy:null}))});assert.equal(nodes(empty).some(n=>n.type==='svg'),false);assert.match(text(empty),/不生成示意曲线/);h.store.dispose();
});
test('accuracy=null with no evaluated windows is explicit and never substituted with zero',async()=>{
  const h=setup((url,init,base)=>{if(!url.includes('/factors/backtest'))return base(url,init);const r=backtest();r.metrics.accuracy=null;r.metrics.coverage=0;r.metrics.evaluated=0;r.metrics.correct=0;r.metrics.per_horizon.forEach(row=>{row.accuracy=null;row.evaluated=0;});return reply(r);});
  await h.store.selectFactorRule('unified-rule',true);const tree=ui(h);assert.match(text(tree),/无有效窗口/);assert.equal(text(nodes(tree).find(n=>n.props?.className==='sti-factor-accuracy')),'—');assert.match(text(tree),/预测覆盖率 0%/);assert.equal(nodes(tree).some(n=>n.type==='svg'),false);h.store.dispose();
});
test('404 and 503 errors expose HTTP status and real cause without stale or synthetic results',async()=>{
  for(const status of [404,503]){
    let fail=false;const h=setup((url,init,base)=>fail&&url.includes('/factors/stock')?reply({error:status===404?'接口尚未接入':'真实本地回测不可用'},status):base(url,init));await h.store.queryFactor();fail=true;await h.store.queryFactor();const s=h.store.getSnapshot().factors.report;
    assert.equal(s.phase,'error');assert.equal(s.data,null);assert.equal(nodes(ui(h)).some(n=>n.type==='svg'),false);h.store.dispose();
  }
});
test('a non-JSON proxy 404 is still an honest HTTP error, not invented success',async()=>{
  const h=setup(()=>({ok:false,status:404,json:async()=>{throw Error('not JSON');}}));await h.store.queryFactor();assert.equal(h.store.getSnapshot().factors.report.data,null);assert.match(h.store.getSnapshot().factors.report.error.detail,/HTTP 404/);h.store.dispose();
});
test('invalid code or unavailable timeframe makes no network call and clears previous factor data',async()=>{
  const h=setup();h.store.factorInput({code:'123'});await h.store.queryFactor();assert.equal(h.requests.length,0);assert.equal(h.store.getSnapshot().factors.report.error.key,'invalidCode');h.store.factorInput({code:'601088'});await h.store.queryFactor();const count=h.requests.length;
  h.store.factorInput({timeframe:'1h'});assert.equal(h.requests.length,count);assert.equal(h.store.getSnapshot().factors.timeframe,'1d');assert.equal(h.store.getSnapshot().factors.report.data,null);h.store.dispose();
});
test('rule library is a real GET with id/name and switching uses only the agreed backtest endpoint',async()=>{
  const h=setup();h.store.factorTab('rules');await tick();assert.match(h.requests[0].url,/factors\/library\?limit=500$/);assert.equal(h.store.getSnapshot().factors.rules.data.total,2);const tree=ui(h);assert.match(text(tree),/另一条共用规则/);assert.match(text(tree),/量化因子总数/);assert.doesNotMatch(text(tree),/覆盖标的/);assert.match(text(tree),/趋势跟随：价格高于20日均线时看涨/);assert.match(text(tree),/模型未提供策略说明/);
  assert.equal(nodes(tree).some(n=>n.type==='button'&&text(n)==='查看当前股票量化因子表现'),false);assert.doesNotMatch(text(tree),/最高准确率标的|最高覆盖率标的/);assert.match(text(tree),/58%/);assert.match(text(tree),/42%/);assert.match(text(tree),/已淘汰/);assert.equal(h.requests.some(r=>r.url.includes('/factors/backtest')),false);h.store.dispose();
});
test('library selection with invalid current code surfaces its error in backtest without a request',async()=>{
  const h=setup();h.store.factorInput({code:'12'});h.store.factorTab('rules');await tick();const before=h.requests.length;await h.store.selectFactorRule('other-rule',true);assert.equal(h.requests.length,before);assert.equal(h.store.getSnapshot().factors.tab,'backtest');assert.equal(h.store.getSnapshot().factors.backtest.data,null);assert.equal(h.store.getSnapshot().factors.backtest.error.key,'invalidCode');assert.doesNotMatch(text(ui(h)),/58%/);h.store.dispose();
});
test('backtest tab requires a selected rule and re-queries that rule for a changed code',async()=>{
  const h=setup();h.store.factorTab('backtest');await tick();let tree=ui(h);assert.match(text(tree),/先在因子库选择一条已挖掘量化因子/);
  h.store.factorTab('rules');await tick();await h.store.selectFactorRule('other-rule',true);await tick();
  assert.equal(h.store.getSnapshot().factors.ruleId,'other-rule');assert.equal(h.store.getSnapshot().factors.tab,'backtest');assert.match(h.requests.at(-1).url,/factors\/backtest\?/);
  h.store.factorInput({code:'000001'});const before=h.requests.length;tree=ui(h);
  await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();
  assert.equal(h.requests.length,before+1);const params=new URL('http://test'+h.requests.at(-1).url).searchParams;
  assert.equal(params.get('rule_id'),'other-rule');assert.equal(params.get('code'),'000001');assert.equal(h.requests.at(-1).init.method,'GET');h.store.dispose();
});
test('backtest details show real confusion counts and limited false positive/negative samples',async()=>{
  const h=setup();await h.store.selectFactorRule('other-rule',true);const tree=ui(h);for(const value of ['方向混淆表','实际上涨','实际下跌','实际持平','2026-09-18','17','-6.4%','2026-09-21','2.5%','全样本回测，未做样本外'])assert.ok(text(tree).includes(value),value);assert.equal(nodes(tree).filter(n=>n.type==='rect').length,20);h.store.dispose();
});
test('backtest tab queries the default stock rule and later re-query retains an explicit backtest route',async()=>{
  const h=setup();await h.store.queryFactor();h.store.factorTab('backtest');await tick();assert.ok(h.requests.at(-1).url.includes('/factors/backtest?'));const tree=ui(h);await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();assert.ok(h.requests.at(-1).url.includes('/factors/backtest?'));h.store.dispose();
});
test('out-of-order stock replies never overwrite the current code and input immediately clears old evidence',async()=>{
  const pending=[],h=setup((url,init)=>new Promise(resolve=>pending.push({url,init,resolve})));const first=h.store.queryFactor();h.store.factorInput({code:'000001'});const second=h.store.queryFactor();assert.equal(pending[0].init.signal.aborted,true);assert.equal(h.store.getSnapshot().factors.report.data,null);
  pending[1].resolve(reply(report('000001')));await second;pending[0].resolve(reply(report('601088')));await first;assert.equal(h.store.getSnapshot().factors.report.data.target.code,'000001');h.store.dispose();
});
test('rule races, stock/rule identity mismatches and a late stock result cannot masquerade as selected rule',async()=>{
  const pending=[],h=setup((url,init)=>new Promise(resolve=>pending.push({url,init,resolve})));const original=h.store.queryFactor(),first=h.store.selectFactorRule('unified-rule'),second=h.store.selectFactorRule('other-rule');assert.equal(pending[0].init.signal.aborted,true);assert.equal(pending[1].init.signal.aborted,true);
  pending[2].resolve(reply(backtest('601088','other-rule')));await second;pending[1].resolve(reply(backtest()));await first;pending[0].resolve(reply(report()));await original;assert.equal(h.store.getSnapshot().factors.backtest.data.rule.id,'other-rule');assert.equal(h.store.getSnapshot().factors.report.data,null);h.store.dispose();
  for(const wrong of [backtest('000001','other-rule'),backtest('601088','unified-rule'),{...backtest('601088','other-rule'),target:{code:'601088',timeframe:'1h'}}]){
    const bad=setup(()=>reply(wrong));await bad.store.selectFactorRule('other-rule');assert.equal(bad.store.getSnapshot().factors.backtest.error.key,'factorContractError');assert.equal(bad.store.getSnapshot().factors.backtest.data,null);bad.store.dispose();
  }
});
test('schema rejects malformed metrics, duplicate horizons, synthetic ratios, counts and oversized samples',()=>{
  const h=setup();for(const mutate of [r=>r.metrics.accuracy=58,r=>r.metrics.per_horizon.pop(),r=>r.metrics.per_horizon[0].h=2,r=>r.metrics.confusion.up.up=-1,r=>r.target.code='000001',r=>r.metrics.coverage=undefined,r=>r.samples={false_positive:Array.from({length:6},()=>({date:'x',h:1,ret:0})),false_negative:[]}]){
    const r=report();mutate(r);assert.throws(()=>h.api.investFactorReport(r,{code:'601088',timeframe:'1d',category:'个股'}));
  }const valid=report();valid.metrics.per_horizon.reverse();assert.deepEqual(clone(h.api.investFactorReport(valid,{code:'601088',timeframe:'1d',category:'个股'}).metrics.per_horizon.map(r=>r.h)),Array.from({length:20},(_,i)=>i+1));h.store.dispose();
});
test('batch replaces disabled evolution placeholder; no fake request or cross-sectional tab',async()=>{
  const h=setup(),tree=ui(h);assert.equal(nodes(tree).some(n=>n.type==='button'&&text(n)==='自进化采集下一阶段接入'),false);assert.equal(nodes(tree).some(n=>n.props?.role==='tab'&&/横截面|自进化/.test(text(n))),false);
  await h.store.queryFactor();h.store.factorTab('rules');await tick();h.store.factorTab('backtest');await tick();assert.equal(h.requests.some(r=>/evolve|cross|research\/|expert/.test(r.url)),false);assert.equal(h.requests.some(r=>r.init.method!=='GET'),false);h.store.dispose();
});
test('cleanup aborts in-flight factors and discards late data without touching other research state',async()=>{
  let resolve;const h=setup((url,init)=>new Promise(r=>resolve=r));const querying=h.store.queryFactor();const effects=[];ui(h,'Factors',{},effects);const cleanup=effects.map(fn=>fn()).filter(fn=>typeof fn==='function');cleanup.forEach(fn=>fn());assert.equal(h.requests[0].init.signal.aborted,true);resolve(reply(report()));await querying;assert.equal(h.store.getSnapshot().factors.report.data,null);assert.equal(h.store.getSnapshot().job.data,null);assert.equal(h.store.getSnapshot().selectionJob.data,null);h.store.dispose();
});
test('factor styles use only native semantic tokens and responsive SVG width',()=>{
  assert.doesNotMatch(css,/#(?:[0-9a-f]{3,8})\b|rgba?\(|hsla?\(/i);assert.match(css,/sti-factor-chart svg[^}]*width:100%/);assert.match(css,/sti-factor-bar[^}]*var\(--dsw-alias-brand-primary\)/);assert.match(css,/sti-factor-accuracy/);
});
test('current native template registers factor entry at order33 with matching main ID and bare responsive SVG',async()=>{
  // Assemble exact existing build markers in memory only; do not write/build/install artifacts.
  const pages=(await readFile(new URL('lib/pages-bundle.js',root),'utf8')).replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm,'');
  const bridge=await readFile(new URL('tools/ai-bridge-source.js',root),'utf8');
  const script=template.replace('/*__PAGES__*/',()=>pages).replace('/*__COCKPIT__*/',()=>cockpit).replace('/*__BRIDGE__*/',()=>bridge).replace('/*__INVEST__*/',()=>source).replace('/*__CSS__*/',()=>JSON.stringify(css));
  let def;const R=fakeReact(),context=vm.createContext({window:{__ModuleLoader__:{load:value=>def=value}},AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout});vm.runInContext(script,context);const plugin=def.factory(name=>{assert.equal(name,'react');return R;}),regs=[],cleanup=[],navigations=[];
  plugin.apply({locale:{register:()=>()=>{},bind:()=>key=>key,subscribe:()=>()=>{},getSnapshot:()=>0},layout:{selectPanel:id=>navigations.push(id)},effect:fn=>{const d=fn();if(typeof d==='function')cleanup.push(d);},slots:{inject:(_name,fn)=>fn(),register:(options,component)=>{regs.push({options,component});return()=>{};}}});
  const left=regs.filter(r=>r.options.name==='sidebar.panellist'),main=regs.filter(r=>r.options.name==='main');assert.equal(left.length,6);assert.deepEqual(left.map(r=>r.options.order),[30,31,32,33,34,35]);const factor=left.find(r=>r.options.id==='dsh-super-trader-factors');assert.ok(factor);assert.equal(factor.options.order,33);assert.equal(factor.options.label(),'factors');assert.equal(factor.component({size:28,active:true}).type,'svg');assert.equal(factor.component({size:28,active:true}).props.width,28);
  const panel=main.find(r=>r.options.key===factor.options.id).component({});assert.equal(panel.props.initialTab,'factors');assert.equal(panel.type(panel.props).type,'section');assert.equal(main.length,6);assert.equal(regs.some(r=>r.options.name.includes('right')||r.options.key==='conversation'),false);assert.doesNotMatch(script,/iframe|document\.body/);assert.match(template,/factors:'dsh-super-trader-factors'/);for(const fn of cleanup.reverse())fn();
});
