import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('tools/invest-source.js',root),'utf8');
const cockpit=await readFile(new URL('tools/cockpit-source.js',root),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const experts=[{id:'value',name:'价值研究者',tag:'价值',criteria:'独立核实经营证据',enabled:true},{id:'growth',name:'成长研究者',tag:'成长',criteria:'自主发现增长线索',enabled:true},{id:'off',name:'停用专家',enabled:false}];
const result=(patch={})=>({kind:'expert_selection',scope:'market',brief:'',limit_per_expert:5,universe:{total:5100,source:'real A-share directory',timestamp:'2026-11-14T10:00:00+08:00'},expert_results:[],common_picks:[],differences:[],errors:[],activity:[],created_at:'2026-11-14T10:01:00+08:00',warnings:[],...patch});
const row=(id='value',patch={})=>({expert:experts.find(e=>e.id===id),selection_approach:'从经营与行业证据自主寻找',picks:[{code:'601088',name:'真实候选',thscode:'601088.SH',reason:'业务证据符合理念',why_fit:'现金流可核实',confidence:'medium',risks:['周期波动'],missing_evidence:['新闻暂缺'],evidence:[{source_id:'fund-1',ref:'经营现金流'}],quant_comment:'量化未覆盖，不影响候选展示'}],rejected:[{code:'000001',reason:'证据不能确认'}],abstained_reason:'',coverage:{reviewed:3,tool_calls:4,budget_exhausted:true},evidence_sources:[{id:'fund-1',kind:'financials',code:'601088',available:true,data:{source:'real financial provider',report_date:'2026-09-30',operating_cash_flow:12345}}],model:'configured-model',created_at:'2026-11-14T10:00:00+08:00',...patch});
function harness(custom) {
  const requests=[],timers=new Map();let serial=0,clock=0;
  const context=vm.createContext({AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout});
  const api=vm.runInContext(cockpit+'\n'+source+'\n({createInvestStore,createInvestComponents,investMessages})',context);
  const base=async(url,init={})=>{
    if(url.endsWith('/experts'))return reply({items:experts});
    if(url.endsWith('/research/select'))return reply({job:{id:'selection-42',status:'queued',progress:0,total:2}});
    if(url.endsWith('/research/team'))return reply({job:{id:'team-7',status:'queued',progress:0,total:1}});
    if(url.endsWith('/jobs/selection-42/cancel'))return reply({id:'selection-42',status:'cancelled'});
    if(url.endsWith('/jobs/selection-42'))return reply({id:'selection-42',status:'running',progress:1,total:2});
    if(url.endsWith('/jobs/team-7'))return reply({id:'team-7',status:'running',progress:0,total:1});
    if(url.endsWith('/watchlist')&&init.method==='POST')return reply({id:'watch-1'});
    return reply({error:'Unexpected '+url},404);
  };
  const store=api.createInvestStore({autoConnect:false,now:()=>clock,schedule:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},unschedule:id=>timers.delete(id),fetch:async(url,init)=>{requests.push({url,init});return custom?custom(url,init,base):base(url,init);}});
  return {api,store,requests,timers,clock:v=>clock=v,async timer(){const next=timers.entries().next().value;assert.ok(next,'timer exists');timers.delete(next[0]);await next[1].fn();await tick();}};
}
function react(effects=[]) {return {Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useSyncExternalStore:(_s,get)=>get(),useEffect:fn=>effects.push(fn)};}
function render(node){if(Array.isArray(node))return node.map(render);if(!node||typeof node!=='object')return node;if(typeof node.type==='function')return render(node.type(node.props));return {...node,props:{...node.props,children:(node.props?.children || []).map(render)}};}
function nodes(node){return Array.isArray(node)?node.flatMap(nodes):!node||typeof node!=='object'?[]:[node,...nodes(node.props?.children || [])];}
function text(node){return Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):String(node ?? '');}
function ui(h,name='Screen',props={},effects=[]){const c=h.api.createInvestComponents(react(effects),h.store),t=k=>h.api.investMessages().zh[k] || k;return render(c[name]({t,...props}));}
const starts=h=>h.requests.filter(r=>r.url.endsWith('/research/select'));
const gets=h=>h.requests.filter(r=>r.url.endsWith('/jobs/selection-42')&&r.init.method==='GET');
async function start(h,{poll=false}={}) {await h.store.loadExperts();if(poll)h.store.resumeSelectionPolling();await h.store.startSelection(true);await tick();}

test('default native UI has all-A-share scope, no style/grid candidates, and mount cannot call models',async()=>{
  const h=harness(),effects=[],off=h.store.subscribe(()=>{});const tree=ui(h,'Screen',{},effects);
  assert.equal(h.store.getSnapshot().screen.scope,'market');assert.equal(h.store.getSnapshot().screen.style,undefined);
  assert.match(text(tree),/专家自主|自主找候选/);assert.match(text(tree),/全A股/);assert.match(text(tree),/预算限制/);assert.match(text(tree),/并非全市场逐股扫描/);
  assert.doesNotMatch(text(tree),/趋势共振|偏多观察|本地量化库|第N天.*input/);
  assert.equal(nodes(tree).filter(n=>n.type==='input'&&n.props.type!=='checkbox').length,0);
  const cleanup=effects.map(fn=>fn()).filter(fn=>typeof fn==='function');await tick();
  assert.equal(h.requests.length,0);assert.equal(starts(h).length,0);assert.equal(h.requests.some(r=>/research\/screen|grid/.test(r.url)),false);
  cleanup.forEach(fn=>fn());off();h.store.dispose();
});
test('real enabled expert metadata and independent choices persist across page reloads',async()=>{
  const h=harness();await h.store.loadExperts();h.store.toggleSelectionExpert('growth');h.store.toggleExpert('value');
  h.store.navigate('experts');await h.store.loadExperts();h.store.navigate('screen');await h.store.loadExperts();
  assert.deepEqual(clone(h.store.getSnapshot().selectionExpertIds),['value']);assert.deepEqual(clone(h.store.getSnapshot().expertIds),['growth']);
  h.store.toggleSelectionExpert('off');assert.deepEqual(clone(h.store.getSnapshot().selectionExpertIds),['value']);
  const tree=ui(h);assert.match(text(tree),/独立核实经营证据/);assert.match(text(tree),/AI风格专家，非本人/);assert.doesNotMatch(text(tree),/停用专家/);assert.equal(starts(h).length,0);h.store.dispose();
});
test('only explicit click starts POST with selected experts and free-text preferences, double clicks coalesce',async()=>{
  let resolve;const h=harness((url,init,base)=>url.endsWith('/research/select')?new Promise(r=>resolve=r):base(url,init));
  await h.store.loadExperts();h.store.toggleSelectionExpert('growth');h.store.screenOptions({scope:'watchlist',brief:'偏好耐心研究，允许量化缺失'});
  await h.store.startSelection();assert.equal(starts(h).length,0);
  const tree=ui(h),button=nodes(tree).find(n=>n.type==='button'&&text(n).includes('开始专家选股'));
  const first=button.props.onClick();await h.store.startSelection(true);assert.equal(starts(h).length,1);
  assert.deepEqual(JSON.parse(starts(h)[0].init.body),{scope:'watchlist',expert_ids:['value'],brief:'偏好耐心研究，允许量化缺失',limit_per_expert:5});
  resolve(reply({job:{id:'selection-42',status:'queued',progress:0,total:1}}));await first;
  await h.store.startSelection(true);assert.equal(starts(h).length,1);assert.equal(h.store.getSnapshot().selectionJob.data.id,'selection-42');assert.equal(h.store.getSnapshot().job.data,null);h.store.dispose();
});
test('scope sector requires chosen qualified sector; invalid or >1000-character preferences never submit',async()=>{
  const h=harness();await h.store.loadExperts();h.store.screenOptions({scope:'sector'});await h.store.startSelection(true);assert.equal(h.store.getSnapshot().notice.key,'selectionMissingSector');assert.match(text(ui(h)),/板块页选择板块/);
  h.store.screenOptions({sector:'881101'});await h.store.startSelection(true);assert.equal(starts(h).length,0);
  h.store.screenOptions({sector:'881101.TI',brief:'字'.repeat(1001)});await h.store.startSelection(true);assert.equal(h.store.getSnapshot().notice.key,'selectionBriefLong');assert.equal(starts(h).length,0);
  h.store.screenOptions({brief:'关注行业差异'});await h.store.startSelection(true);assert.deepEqual(JSON.parse(starts(h)[0].init.body),{scope:'sector',sector:'881101.TI',expert_ids:['value','growth'],brief:'关注行业差异',limit_per_expert:5});h.store.dispose();
});
test('normalized brief and qualified sector are frozen exactly as posted and accept backend echoes',async()=>{
  const echoed=result({scope:'sector',sector:'881101.TI',brief:'保留自主研究偏好',expert_results:[row()]});
  const h=harness((url,init,base)=>url.endsWith('/jobs/selection-42')?reply({id:'selection-42',status:'done',result:echoed}):base(url,init)),off=h.store.subscribe(()=>{});
  h.store.screenOptions({scope:'sector',sector:' 881101.ti  ',brief:'  保留自主研究偏好\n '});await start(h,{poll:true});
  assert.deepEqual(JSON.parse(starts(h)[0].init.body),{scope:'sector',sector:'881101.TI',expert_ids:['value','growth'],brief:'保留自主研究偏好',limit_per_expert:5});
  const j=h.store.getSnapshot().selectionJob;assert.equal(j.params.brief,'保留自主研究偏好');assert.equal(j.params.sector,'881101.TI');assert.equal(j.error,null);assert.equal(j.data.status,'done');assert.equal(j.data.result.expert_results.length,1);assert.doesNotMatch(text(ui(h)),/原任务，不代表新请求/);off();h.store.dispose();
});
test('job partial progress preserves independent lists, evidence sources, missing quant, intersection and differences',async()=>{
  const partial=result({expert_results:[row()],common_picks:[{code:'601088',name:'共同候选',count:2,experts:experts.slice(0,2)}],differences:[{code:'000002',name:'独立差异',count:1,experts:[experts[1]]}],activity:[{expert_id:'value',action:'tool_result',tool:'financials',message:'已读取经营现金流',at:'2026-11-14T10:00:00+08:00'}],warnings:['达到取数预算，未逐股扫描']});
  const h=harness((url,init,base)=>url.endsWith('/jobs/selection-42')?reply({id:'selection-42',status:'running',progress:1,total:2,result:partial}):base(url,init)),off=h.store.subscribe(()=>{});
  await start(h,{poll:true});assert.equal(h.store.getSnapshot().selectionJob.data.progress,1);assert.equal([...h.timers.values()][0].ms,1800);
  const tree=ui(h);for(const phrase of ['阶段性研究','价值研究者','业务证据符合理念','周期波动','新闻暂缺','量化未覆盖','共同候选','独立差异','不是统一投票、胜率或上涨概率','经营现金流','2026-09-30','12345','已读取经营现金流','selection-42'])assert.ok(text(tree).includes(phrase),phrase);
  assert.ok(nodes(tree).some(n=>n.type==='details'));assert.equal(nodes(tree).some(n=>n.type==='pre'),false);assert.equal(nodes(tree).filter(n=>n.type==='button'&&text(n)==='研究这只').length,1);
  assert.equal(nodes(tree).filter(n=>n.type==='button'&&text(n)==='加入自选').length,1);off();h.store.dispose();
});
test('cited factual leaves preserve zero, negative and null while quant uses historical labels',()=>{
  const h=harness(),source={id:'facts',kind:'quant',code:'601088',available:true,data:{zero:0,negative:-12.5,missing:null,result:{probability:0,coverage:.25,direction:0}}};
  const tree=ui(h,'SelectionEvidence',{sources:[source],evidence:['/data/zero','/data/negative','/data/missing','/data/result/probability','/data/result/coverage','/data/result/direction'].map(ref=>({source_id:'facts',ref}))});
  const facts=nodes(tree).filter(n=>n.props?.className==='sti-metric').map(text);
  for(const value of ['引用事实 · zero 0','引用事实 · negative -12.5','引用事实 · missing null（未取得数值，不补零）','引用事实 · 量化因子历史命中率（内样本） 0%','引用事实 · 覆盖率 25%','引用事实 · 方向 中性'])assert.ok(facts.includes(value),value);
  assert.match(text(tree),/不是校准的未来概率/);h.store.dispose();
});
test('quarterly financial citation exposes the actual record value, fiscal period and nested dates',()=>{
  const h=harness(),stamp=Date.UTC(2026,10,14),source={id:'financial-1',kind:'fundamentals',code:'601088',available:true,data:{income:{available:true,data:{timestamp:stamp,items:[{fiscal_year:2026,fiscal_period:3,period_end_ms:Date.UTC(2026,8,29,16),report_date_ms:Date.UTC(2026,9,27,16),revenue:-7654321.12345}]}}}};
  const tree=ui(h,'SelectionEvidence',{sources:[source],evidence:[{source_id:'financial-1',ref:'/data/income/data/items/0/revenue'}]}),facts=nodes(tree).filter(n=>n.props?.className==='sti-metric').map(text);
  for(const value of ['引用事实 · revenue -7654321.12345','财务报告期 2026 · 3','报告期末 2026-09-30','披露日 2026-10-28'])assert.ok(facts.includes(value),value);
  assert.match(text(tree),/财务报表/);assert.ok(text(tree).includes(new Date(stamp).toLocaleString(undefined,{timeZone:'Asia/Shanghai',hour12:false})));assert.doesNotMatch(text(tree),/来源接口时间: —/);h.store.dispose();
});
test('invalid, inherited, non-leaf, escaped or unavailable pointers are explicitly unverified',()=>{
  const h=harness(),source={id:'strict',kind:'fundamentals',available:true,data:{income:{available:true,data:{items:[{revenue:0}]}},off:{available:false,value:5}}};
  for(const ref of ['/data/income/data/items/7/revenue','/data/income/data/items/01/revenue','/data/income/data/items','/data/__proto__/x','/data/constructor','/data/income/~2bad','/data/off/value','data/income']){
    const tree=ui(h,'SelectionEvidence',{sources:[source],evidence:[{source_id:'strict',ref}]});assert.match(text(tree),/引用指针失效/);assert.equal(nodes(tree).filter(n=>n.props?.className==='sti-metric').length,0,ref);
  }h.store.dispose();
});
test('completed empty lists, failed experts and missing evidence are explicit, never fabricated success',async()=>{
  const r=result({expert_results:[row('value',{picks:[],abstained_reason:'缺少关键财务证据'})],errors:[{expert:experts[1],error:'真实模型失败',status:'failed'}]});
  const h=harness();const tree=ui(h,'SelectionResult',{result:r});for(const phrase of ['没有入选候选','缺少关键财务证据','真实模型失败','暂无共同候选','暂无名单差异'])assert.ok(text(tree).includes(phrase),phrase);
  const missing=ui(h,'SelectionEvidence',{evidence:[{source_id:'missing',ref:'无法核实'}],sources:[]});assert.match(text(missing),/未找到对应证据来源/);assert.match(text(ui(h,'SelectionResult',{result:result()})),/不能视为成功选股/);h.store.dispose();
});
test('running empty expert list is unfinished, and visible research coverage is not universe size',()=>{
  const h=harness(),r=result({universe:{total:5582,source:'directory'},expert_results:[row('value',{status:'running',picks:[],coverage:{directory_unique_items:120,researched_count:0}})]});
  const tree=ui(h,'SelectionResult',{result:r,running:true});assert.match(text(tree),/正在研究，尚未形成名单/);assert.doesNotMatch(text(tree),/本专家没有入选候选/);assert.match(text(tree),/允许探索的股票数/);assert.doesNotMatch(text(tree),/覆盖池/);
  assert.ok(nodes(tree).some(n=>n.type==='p'&&text(n)==='实际浏览目录条目: 120 条 / 深入研究股票: 0 只'));
  const done=ui(h,'SelectionResult',{result:result({expert_results:[row('value',{status:'done',picks:[],coverage:{}})]})});assert.match(text(done),/本专家没有入选候选，不补齐、不凑数/);assert.ok(nodes(done).some(n=>n.type==='p'&&text(n)==='实际浏览目录条目: — 条 / 深入研究股票: — 只'));h.store.dispose();
});
test('form changes freeze old task parameters and expert names; running task cannot be resubmitted',async()=>{
  const h=harness();await start(h);h.store.screenOptions({scope:'watchlist',brief:'另一请求'});h.store.toggleSelectionExpert('growth');await h.store.startSelection(true);
  const j=h.store.getSnapshot().selectionJob;assert.equal(j.params.scope,'market');assert.equal(j.params.brief,'');assert.deepEqual(clone(j.params.expert_ids),['value','growth']);assert.equal(starts(h).length,1);
  const tree=ui(h);assert.match(text(tree),/原任务，不代表新请求/);assert.match(text(tree),/价值研究者 \/ 成长研究者/);h.store.dispose();
});
test('selection and team jobs cannot poll, cancel or consume one another',async()=>{
  const h=harness(),off=h.store.subscribe(()=>{});await start(h,{poll:true});h.store.navigate('experts');assert.equal(h.timers.size,0);
  await h.store.querySector({thscode:'881101.TI',name:'板块'});await h.store.startTeam(true);h.store.resumePolling();await tick();
  assert.equal(h.store.getSnapshot().job.data.id,'team-7');assert.equal(h.store.getSnapshot().selectionJob.data.id,'selection-42');
  h.store.stopPolling();h.store.navigate('screen');h.store.resumeSelectionPolling();await tick();await h.store.cancelSelection();
  assert.equal(h.store.getSnapshot().selectionJob.data.status,'cancelled');assert.equal(h.store.getSnapshot().job.data.status,'running');assert.equal(h.requests.some(r=>r.url.endsWith('/jobs/team-7/cancel')),false);off();h.store.dispose();
});
test('identity mismatches and unexpected expert results pause polling without corrupting the original task',async()=>{
  for(const bad of [{id:'wrong',status:'completed',result:result()},{id:'selection-42',status:'completed',result:result({kind:'stock'})},{id:'selection-42',status:'completed',result:result({scope:'watchlist'})},{id:'selection-42',status:'completed',result:result({expert_results:[row('off')]})}]){
    const h=harness((url,init,base)=>url.endsWith('/jobs/selection-42')?reply(bad):base(url,init)),off=h.store.subscribe(()=>{});await start(h,{poll:true});const j=h.store.getSnapshot().selectionJob;
    assert.equal(j.error.key,'invalidResponse');assert.equal(j.paused,true);assert.equal(j.data.result,undefined);assert.equal(j.data.id,'selection-42');off();h.store.dispose();
  }
});
test('leaving stops checks and late response, returning resumes same ID with no POST',async()=>{
  let resolve;const h=harness((url,init,base)=>url.endsWith('/jobs/selection-42')?new Promise(r=>resolve=r):base(url,init)),off=h.store.subscribe(()=>{});
  await start(h,{poll:true});assert.equal(gets(h).length,1);h.store.navigate('stock');assert.equal(gets(h)[0].init.signal.aborted,true);
  resolve(reply({id:'selection-42',status:'completed',result:result({expert_results:[row()]})}));await tick();assert.equal(h.store.getSnapshot().selectionJob.data.status,'queued');assert.equal(h.timers.size,0);
  h.store.navigate('screen');h.store.resumeSelectionPolling();await tick();assert.equal(gets(h).length,2);resolve(reply({id:'selection-42',status:'running',progress:1,total:2}));await tick();assert.equal(h.timers.size,1);assert.equal(starts(h).length,1);off();assert.equal(h.timers.size,0);h.store.dispose();
});
test('screen effect cleanup aborts check and preserves job ID for remount',async()=>{
  const h=harness(),off=h.store.subscribe(()=>{});await start(h);const effects=[];ui(h,'Screen',{},effects);const cleanups=effects.map(fn=>fn()).filter(fn=>typeof fn==='function');await tick();assert.equal(h.timers.size,1);
  cleanups.forEach(fn=>fn());assert.equal(h.timers.size,0);assert.equal(h.store.getSnapshot().selectionJob.data.id,'selection-42');h.store.resumeSelectionPolling();await tick();assert.equal(h.timers.size,1);off();h.store.dispose();
});
test('ten-minute automatic check cap pauses, retains ID and manually continues without stopping backend',async()=>{
  const h=harness(),off=h.store.subscribe(()=>{});await start(h,{poll:true});h.clock(600000);await h.timer();assert.equal(h.store.getSnapshot().selectionJob.paused,true);assert.equal(h.timers.size,0);assert.match(text(ui(h)),/后台未被停止/);
  h.store.resumeSelectionPolling(true);await tick();assert.equal(h.store.getSnapshot().selectionJob.paused,false);assert.equal(h.timers.size,1);assert.equal(starts(h).length,1);assert.equal(h.requests.some(r=>r.url.endsWith('/cancel')),false);off();h.store.dispose();
});
test('300 checks is an independent cap when the clock stays still',async()=>{
  const h=harness(),off=h.store.subscribe(()=>{});await start(h,{poll:true});for(let i=0;i<300;i++){if(!h.timers.size)break;await h.timer();}
  assert.equal(gets(h).length,300);assert.equal(h.store.getSnapshot().selectionJob.paused,true);assert.equal(h.timers.size,0);assert.equal(h.store.getSnapshot().selectionJob.data.id,'selection-42');off();h.store.dispose();
});
test('cancellation waits for real HTTP response, prevents re-submit and keeps partial evidence',async()=>{
  let resolve;const partial=result({expert_results:[row()]});const h=harness((url,init,base)=>url.endsWith('/jobs/selection-42/cancel')?new Promise(r=>resolve=r):url.endsWith('/jobs/selection-42')?reply({id:'selection-42',status:'running',progress:1,total:2,result:partial}):base(url,init)),off=h.store.subscribe(()=>{});
  await start(h,{poll:true});const cancel=h.store.cancelSelection();assert.equal(h.store.getSnapshot().selectionJob.cancelling,true);assert.equal(h.store.getSnapshot().selectionJob.data.status,'running');assert.match(text(ui(h)),/等待HTTP返回/);
  await h.store.cancelSelection();await h.store.startSelection(true);assert.equal(h.requests.filter(r=>r.url.endsWith('/cancel')).length,1);assert.equal(starts(h).length,1);
  resolve(reply({id:'selection-42',status:'cancelled'}));await cancel;assert.equal(h.store.getSnapshot().selectionJob.data.status,'cancelled');assert.equal(h.store.getSnapshot().selectionJob.data.result.expert_results.length,1);assert.equal(h.timers.size,0);off();h.store.dispose();
});
test('missing model and backend failure are honest errors with no fake job, retry or invented picks',async()=>{
  const h=harness((url,init,base)=>url.endsWith('/research/select')?reply({error:'未配置真实模型'},503):base(url,init));await start(h);assert.equal(h.store.getSnapshot().selectionJob.phase,'error');assert.equal(h.store.getSnapshot().selectionJob.data,null);assert.match(text(ui(h)),/未配置真实模型/);assert.equal(starts(h).length,1);assert.equal(h.timers.size,0);h.store.dispose();
  const h2=harness((url,init,base)=>url.endsWith('/jobs/selection-42')?reply({id:'selection-42',status:'failed',error:'专家取数预算耗尽',result:result({errors:[{expert:experts[0],error:'预算耗尽',status:'failed'}]})}):base(url,init)),off=h2.store.subscribe(()=>{});await start(h2,{poll:true});assert.equal(h2.timers.size,0);assert.match(text(ui(h2)),/预算耗尽/);assert.match(text(ui(h2)),/不能视为成功选股/);off();h2.store.dispose();
});
test('candidate actions use existing stock research and watchlist with no quant shortlist dependency',async()=>{
  const h=harness();const tree=ui(h,'SelectionResult',{result:result({expert_results:[row()]})});
  const add=nodes(tree).find(n=>n.type==='button'&&text(n)==='加入自选');await add.props.onClick();assert.deepEqual(JSON.parse(h.requests.at(-1).init.body),{code:'601088',category:'个股'});
  const research=nodes(tree).find(n=>n.type==='button'&&text(n)==='研究这只');await research.props.onClick();assert.equal(h.store.getSnapshot().tab,'stock');assert.equal(h.store.getSnapshot().target.code,'601088');assert.ok(h.requests.at(-1).url.endsWith('/research/stock?code=601088'));
  assert.equal(h.requests.some(r=>r.url.includes('/research/screen')||r.url.includes('/quant/')),false);h.store.dispose();
});
test('compact cancelling response resumes checks without relying on stale navigation state',async()=>{
  const h=harness((url,init,base)=>url.endsWith('/jobs/selection-42/cancel')?reply({id:'selection-42',status:'cancelling'}):base(url,init)),off=h.store.subscribe(()=>{});
  h.store.navigate('stock'); // Sidebar mounting does not necessarily synchronize store.tab.
  await start(h,{poll:true});await h.store.cancelSelection();await tick();assert.equal(h.timers.size,1);assert.equal(h.store.getSnapshot().selectionJob.cancelling,false);assert.equal(starts(h).length,1);off();h.store.dispose();
});
test('leaving during cancellation does not restart background polling after HTTP returns',async()=>{
  let resolve;const h=harness((url,init,base)=>url.endsWith('/jobs/selection-42/cancel')?new Promise(r=>resolve=r):base(url,init)),off=h.store.subscribe(()=>{});
  await start(h,{poll:true});const pending=h.store.cancelSelection();h.store.stopSelectionPolling();resolve(reply({id:'selection-42',status:'cancelling'}));await pending;await tick();assert.equal(h.timers.size,0);assert.equal(h.store.getSnapshot().selectionJob.data.id,'selection-42');off();h.store.dispose();
});
test('malformed inline result retains accepted job ID and cannot trigger another active submission',async()=>{
  const h=harness((url,init,base)=>url.endsWith('/research/select')?reply({job:{id:'selection-42',status:'running',result:result({kind:'stock'})}}):base(url,init));await start(h);const j=h.store.getSnapshot().selectionJob;
  assert.equal(j.data.id,'selection-42');assert.equal(j.data.result,undefined);assert.equal(j.error.key,'invalidResponse');assert.equal(j.paused,true);await h.store.startSelection(true);assert.equal(starts(h).length,1);h.store.dispose();
});
test('real done/error/interrupted statuses stop polling; partial expert failure is disclosed',async()=>{
  for(const status of ['done','error','interrupted']){
    const r=result({expert_results:[row()],errors:[{expert:experts[1],error:'真实专家失败',status:'error'}]});
    const h=harness((url,init,base)=>url.endsWith('/jobs/selection-42')?reply({id:'selection-42',status,progress:1,total:2,result:r}):base(url,init)),off=h.store.subscribe(()=>{});await start(h,{poll:true});assert.equal(h.timers.size,0);h.store.resumeSelectionPolling();await tick();assert.equal(gets(h).length,1);
    const body=text(ui(h));if(status==='interrupted')assert.match(body,/任务已中断/);if(status==='done')assert.match(body,/部分专家失败 \/ 未完成/);off();h.store.dispose();
  }
});
test('derived quant status never removes candidates and differentiates not-requested from unavailable',()=>{
  const h=harness();for(const [status,copy] of [['not_requested','未调用量化'],['unavailable','量化不可用'],['available','量化已取得']]){
    const r=row();r.picks[0].quant_status=status;const tree=ui(h,'SelectionResult',{result:result({expert_results:[r]})});assert.ok(text(tree).includes(copy));assert.match(text(tree),/业务证据符合理念/);assert.equal(nodes(tree).filter(n=>n.type==='button'&&text(n)==='研究这只').length,1);
  }h.store.dispose();
});
test('dispose aborts pending submission and never publishes late task identity',async()=>{
  let resolve;const h=harness((url,init,base)=>url.endsWith('/research/select')?new Promise(r=>resolve=r):base(url,init));await h.store.loadExperts();const p=h.store.startSelection(true);h.store.dispose();assert.equal(starts(h)[0].init.signal.aborted,true);resolve(reply({job:{id:'late',status:'running'}}));await p;assert.equal(h.store.getSnapshot().selectionJob.data,null);assert.equal(h.timers.size,0);
});
