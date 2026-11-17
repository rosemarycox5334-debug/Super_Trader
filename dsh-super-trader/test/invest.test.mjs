import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('tools/invest-source.js',root),'utf8');
const cockpit=await readFile(new URL('tools/cockpit-source.js',root),'utf8');
const compiled=await readFile(new URL('lib/client.js',root),'utf8');
const css=await readFile(new URL('assets/invest.css',root),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(r=>setImmediate(r));
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const date=Date.UTC(2026,10,13);
const history=(kind='stock',code='601088')=>({code,thscode:kind==='sector'?code:code+'.SH',interval:'1d',adjust:kind==='sector'?null:'forward',source:'real-history',timestamp:date,items:[{date_ms:date-86400000,open_price:10,close_price:11,high_price:12,low_price:9,volume:100},{date_ms:date,open_price:11,close_price:10,high_price:12,low_price:9,volume:200}]});
const quant=(h=10,kind='stock',code='601088')=>({symbol:{code:kind==='sector'?code.slice(0,6):code,category:kind==='sector'?'指数':'个股'},target:{horizon:h},direction:h===10?0:1,probability:h===10?null:.63,sample:{predictions:400,coverage:.6},evaluation:{type:'in_sample',calibrated:false},source:'grid'});
const report=(kind='stock',code='601088')=>({kind,target:{code,name:kind==='sector'?'真实板块':'真实股票',thscode:kind==='sector'?code:code+'.SH',category:kind==='sector'?'板块':'个股'},quote:{available:true,data:{source:'real-quotes',timestamp:date,items:[{code,thscode:kind==='sector'?code:code+'.SH',last_price:10,price_change_ratio_pct:2}]}},history:{available:true,data:history(kind,code)},trend:{available:true,data:{bias:'range',ma5:10,ma20:10,ma60:9,support_20d:8,resistance_20d:12}},quant:{available:true,identity:kind==='sector'?{kind,thscode:code}:undefined,as_of:'2026-11-05',items:[5,10,20].map(h=>({horizon:h,available:true,result:quant(h,kind,code)})),agreement:'mixed'},constituents:{available:true,data:{items:[{code:'601088',name:'真实股票',thscode:'601088.SH'}],total:1}},breadth:{available:true,data:{sample_size:1,total_constituents:1,up:1,down:0,flat:0,missing:0}},warnings:[],created_at:'2026-11-13T10:00:00+08:00'});
function setup(options={}) {
  const requests=[],timers=new Map();let serial=0,clock=0;
  const ctx=vm.createContext({AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout,console});
  const api=vm.runInContext(cockpit+'\n'+source+'\n({createInvestStore,createInvestComponents,investMessages,investReport,investTarget,investHistory});',ctx);
  const defaultFetch=async(url,init={})=>{
    const u=new URL('http://local'+url);
    if(url.endsWith('/base'))return reply({phase:'running',apiBase:'/dsh-super-trader/backend'});
    if(url.endsWith('/retry'))return reply({phase:'running'});
    if(url.endsWith('/status'))return reply({ok:true,grid:{snapshot:'2026-11-05'}});
    if(u.pathname.endsWith('/expert-creation'))return reply({status:'accepted',submitted:true,sessionId:'C1',workspaceId:'W1',request_id:JSON.parse(init.body).request_id,expertSaved:false});
    if(u.pathname.endsWith('/research/stock'))return reply(report('stock',u.searchParams.get('code')));
    if(u.pathname.endsWith('/research/sector'))return reply(report('sector',u.searchParams.get('thscode')));
    if(u.pathname.endsWith('/research/select'))return reply({job:{id:'S1',status:'queued',progress:0,total:1}});
    if(/\/experts\/[^/]+$/.test(u.pathname)&&init.method==='DELETE')return reply({deleted:decodeURIComponent(u.pathname.split('/').pop())});
    if(u.pathname.endsWith('/experts'))return init.method==='POST'?reply({id:'E3',...JSON.parse(init.body)}):reply({items:[{id:'E1',name:'真实专家一',tag:'价值',criteria:'现金流证据',enabled:true},{id:'E2',name:'真实专家二',enabled:false}]});
    if(u.pathname.endsWith('/market/sectors'))return reply({items:[{name:'真实板块',thscode:'881101.TI'}],total:31,source:'real directory'});
    if(u.pathname.endsWith('/market/search'))return reply({items:[{name:'真实股票',code:'601088',category:'个股',thscode:'601088.SH'}],source:'market directory'});
    if(u.pathname.endsWith('/watchlist'))return reply(init.method==='POST'?{id:'W1'}:{items:[]});
    if(u.pathname.endsWith('/research/team'))return reply({job:{id:'J1',status:'queued',progress:0,total:1}});
    if(url.endsWith('/cancel'))return reply({id:'J1',status:'cancelled'});
    if(url.endsWith('/jobs/J1'))return reply({id:'J1',status:'running',progress:0,total:1});
    return reply({error:'Unexpected URL'},404);
  };
  const store=api.createInvestStore({autoConnect:false,schedule:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},unschedule:id=>timers.delete(id),now:()=>clock,fetch:async(url,init)=>{requests.push({url,init});return (options.fetch || defaultFetch)(url,init,defaultFetch);},...options.store});
  return {api,store,requests,timers,defaultFetch,setClock:v=>{clock=v;},async runTimer(){const [id,entry]=timers.entries().next().value;timers.delete(id);await entry.fn();await tick();}};
}
function fakeReact(){return {Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useSyncExternalStore:(_s,g)=>g(),useEffect(){},useRef:()=>({current:null}),useState:v=>[v,()=>{}]};}
function render(node){if(Array.isArray(node))return node.map(render);if(!node||typeof node!=='object')return node;if(typeof node.type==='function')return render(node.type(node.props));return {...node,props:{...node.props,children:(node.props?.children || []).map(render)}};}
function nodes(node){return Array.isArray(node)?node.flatMap(nodes):!node||typeof node!=='object'?[]:[node,...nodes(node.props?.children || [])];}
function text(node){return Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):String(node ?? '');}
function ui(h,component,props={}){const R=fakeReact(),c=h.api.createInvestComponents(R,h.store),t=k=>h.api.investMessages().zh[k] || k;return render(c[component]({t,...props}));}

test('declarations have no effects; locale keys align and main copy concerns trends, not one-day guesses',()=>{
  const h=setup(),m=h.api.investMessages();assert.equal(h.requests.length,0);assert.deepEqual(Object.keys(m.zh).sort(),Object.keys(m.en).sort());assert.doesNotMatch(source,/^(?:import |export |window\.|document\.|const |let )/m);assert.match(m.zh.cost,/费用/);assert.match(m.zh.teamIntro,/AI风格专家，非本人/);assert.match(m.zh.disclaimer,/不是校准的未来概率/);h.store.dispose();
});
test('expert selection defaults to all A-shares without preset style or automatic model calls',async()=>{
  const h=setup();assert.match(text(ui(h,'Screen')),/全A股/);assert.match(text(ui(h,'Screen')),/专家各自按理念自主找候选/);assert.equal(h.requests.length,0);assert.equal(h.store.getSnapshot().screen.style,undefined);await h.store.screen();assert.equal(h.requests.length,0);assert.equal(h.store.getSnapshot().notice.key,'consentRequired');await h.store.loadExperts();await h.store.screen(true);const post=h.requests.find(r=>r.url.endsWith('/research/select'));assert.deepEqual(JSON.parse(post.init.body),{scope:'market',expert_ids:['E1'],brief:'',limit_per_expert:5});assert.equal(h.store.getSnapshot().selectionJob.data.id,'S1');assert.equal(h.requests.some(r=>r.url.includes('/research/screen')),false);h.store.dispose();
});
test('selection scope uses autonomous expert POST; stock open shares target to separate team',async()=>{
  const nav=[],h=setup({store:{onNavigate:t=>nav.push(t)}});h.store.screenOptions({scope:'watchlist',brief:'关注经营现金流'});await h.store.loadExperts();await h.store.screen(true);const post=h.requests.find(r=>r.url.endsWith('/research/select'));assert.deepEqual(JSON.parse(post.init.body),{scope:'watchlist',expert_ids:['E1'],brief:'关注经营现金流',limit_per_expert:5});await h.store.openStock('601088','中国神华');h.store.navigate('experts');assert.deepEqual(nav,['stock','experts']);assert.equal(h.store.getSnapshot().target.code,'601088');assert.equal(h.store.getSnapshot().report.data.kind,'stock');assert.equal(h.store.getSnapshot().job.data,null);assert.equal(h.requests.some(r=>r.url.includes('/research/team')),false);h.store.dispose();
});
test('one direct code request obtains independent quote, history, structure and 5/10/20 signals',async()=>{
  const h=setup();h.store.setCode('601088');await h.store.queryStock();assert.equal(h.requests.length,1);assert.match(h.requests[0].url,/research\/stock\?code=601088$/);const r=h.store.getSnapshot().report.data;assert.equal(r.quote.available,true);assert.deepEqual(clone(r.quant.items.map(i=>i.horizon)),[5,10,20]);assert.equal(r.quant.items[1].result.probability,null);const tree=ui(h,'Stock');assert.match(text(tree),/真实日K/);assert.match(text(tree),/信号一致性/);assert.equal(nodes(tree).filter(n=>n.type==='select').length,0);assert.doesNotMatch(text(tree),/持有交易日/);h.store.dispose();
});
test('invalid code makes no request and old code races cannot overwrite new brief',async()=>{
  const pending=[],h=setup({fetch:(url,init)=>new Promise(resolve=>pending.push({url,init,resolve}))});h.store.setCode('12');await h.store.queryStock();assert.equal(pending.length,0);assert.equal(h.store.getSnapshot().notice.key,'invalidCode');h.store.setCode('601088');const first=h.store.queryStock();h.store.setCode('000001');const second=h.store.queryStock();assert.equal(pending[0].init.signal.aborted,true);pending[1].resolve(reply(report('stock','000001')));await second;pending[0].resolve(reply(report()));await first;assert.equal(h.store.getSnapshot().report.data.target.code,'000001');h.store.dispose();
});
test('partial source failures leave the rest of the brief visible',async()=>{
  const r=report();r.quant={available:false,items:[],agreement:'unavailable'};r.quote={available:false,error:'provider offline'};const h=setup({fetch:async()=>reply(r)});await h.store.queryStock('601088');assert.equal(h.store.getSnapshot().report.phase,'ready');const tree=ui(h,'Stock');assert.match(text(tree),/provider offline/);assert.match(text(tree),/本地量化未覆盖/);assert.equal(nodes(tree).filter(n=>n.type==='svg').length,1);h.store.dispose();
});
test('mismatched full report is rejected; invalid neutral percentages disable only that period',async()=>{
  const r=report();r.quant.items[1].result.probability=.9;const h=setup({fetch:async()=>reply(r)});await h.store.queryStock('601088');assert.equal(h.store.getSnapshot().report.data.quant.items[1].available,false);assert.equal(h.store.getSnapshot().report.data.quant.items[0].available,true);await h.store.queryStock('000001');assert.equal(h.store.getSnapshot().report.phase,'error');assert.equal(h.store.getSnapshot().report.data,null);h.store.dispose();
});
test('sector requests use full identity, index null adjustment, breadth and real constituents',async()=>{
  const h=setup();h.store.sectorOptions({tag:'cn_concept',q:'新能源'});assert.equal(h.requests.length,0);await h.store.loadSectors(30);assert.match(h.requests[0].url,/tag=cn_concept/);assert.match(h.requests[0].url,/offset=30/);await h.store.querySector({thscode:'881101.TI',name:'真实板块'});const r=h.store.getSnapshot().report.data;assert.equal(r.kind,'sector');assert.equal(r.history.data.adjust,null);assert.equal(r.quant.items[0].available,true);const tree=ui(h,'Brief',{report:r});assert.match(text(tree),/指数，无复权/);assert.doesNotMatch(text(tree),/前复权/);assert.match(text(tree),/成分股/);h.store.screenSector();assert.equal(h.store.getSnapshot().screen.sector,'881101.TI');await h.store.loadExperts();await h.store.screen(true);const post=h.requests.find(r=>r.url.endsWith('/research/select'));assert.equal(JSON.parse(post.init.body).scope,'sector');assert.equal(JSON.parse(post.init.body).sector,'881101.TI');h.store.dispose();
});
test('sector quant needs explicit wrapper identity, never a same-number stock substitute',()=>{
  const h=setup(),r=report('sector','881101.TI'),target=h.api.investTarget('sector','881101.TI');delete r.quant.identity;assert.equal(h.api.investReport(r,target).quant.available,false);r.quant.identity={kind:'sector',thscode:'881101.TI'};r.quant.items.forEach(i=>{i.result.symbol.category='个股';});assert.equal(h.api.investReport(r,target).quant.available,false);assert.throws(()=>h.api.investHistory(history('stock','881101'),'sector'));h.store.dispose();
});
test('real chart renders observed candles, volume and explicit legend; no fake or future candles',()=>{
  const h=setup(),good=ui(h,'Candles',{data:history(),kind:'stock'});assert.equal(nodes(good).filter(n=>n.type==='rect').length,4);assert.match(text(good),/仅绘制已取得的历史数据/);assert.doesNotMatch(JSON.stringify(good),/NaN|Infinity/);const bad=history();bad.items=[];assert.equal(nodes(ui(h,'Candles',{data:bad,kind:'stock'})).filter(n=>n.type==='svg').length,0);h.store.dispose();
});
test('manual stock-name search is provider directory based, no per-keystroke calls',async()=>{
  const h=setup();h.store.setSearch('神');h.store.setSearch('神华');assert.equal(h.requests.length,0);await h.store.searchStocks();assert.match(h.requests[0].url,/market\/search\?q=/);assert.equal(h.store.getSnapshot().stockSearch.data.source,'market directory');assert.match(text(ui(h,'Stock')),/真实股票/);h.store.dispose();
});
test('expert list is real, enabled experts selected by default and disabled experts stay unchecked',async()=>{
  const h=setup();await h.store.loadExperts();assert.deepEqual(clone(h.store.getSnapshot().expertIds),['E1']);h.store.toggleExpert('E2');assert.deepEqual(clone(h.store.getSnapshot().expertIds),['E1']);const tree=ui(h,'Experts');assert.match(text(tree),/现金流证据/);assert.match(text(tree),/可能产生 API 费用/);assert.equal(h.requests.filter(r=>r.init.method==='POST').length,0);h.store.dispose();
});
test('expert cards share a bounded body with pinned actions, while edit forms stay auto-height',async()=>{
  const h=setup();await h.store.loadExperts();const tree=ui(h,'Experts');
  const bodies=nodes(tree).filter(n=>n.props?.className==='sti-expert-body'),footers=nodes(tree).filter(n=>n.props?.className==='sti-expert-footer');
  assert.equal(bodies.length,2);assert.equal(footers.length,2);
  for(const footer of footers)assert.ok(nodes(footer).some(n=>n.type==='button'&&text(n).trim()==='编辑'));
  assert.match(css,/\.sti-expert \{[^}]*height:430px/);assert.match(css,/\.sti-expert-body \{[^}]*overflow:auto/);
  h.store.editExpert('E1');const editing=ui(h,'Experts');const form=nodes(editing).find(n=>n.props?.className==='sti-expert sti-expert-edit');assert.ok(form);assert.equal(nodes(form).filter(n=>n.props?.className==='sti-expert-body').length,0);
  assert.match(css,/\.sti-expert\.sti-expert-edit \{[^}]*height:auto/);h.store.dispose();
});
test('expert methodology is visible and editable through the real experts endpoint',async()=>{
  const h=setup();await h.store.loadExperts();const tree=ui(h,'Experts');assert.match(text(tree),/方法论/);h.store.editExpert('E1');const form=ui(h,'Experts');const areas=nodes(form).filter(n=>n.type==='textarea');assert.ok(areas.length>=2);h.store.updateExpertDraft({system_prompt:'新的方法论'});await h.store.saveExpert();const post=h.requests.find(r=>r.url.endsWith('/experts')&&r.init.method==='POST');assert.ok(post);const body=JSON.parse(post.init.body);assert.equal(body.id,'E1');assert.equal(body.system_prompt,'新的方法论');assert.equal(h.store.getSnapshot().expertEdit,null);h.store.dispose();
});
test('expert navigation and new-expert buttons share one action row',async()=>{
  const h=setup(),tree=ui(h,'Experts');
  const row=nodes(tree).find(n=>n.props?.className==='sti-actions'&&(n.props.children||[]).some(c=>c?.type==='button'&&text(c).trim()==='新建专家'));
  assert.ok(row);assert.deepEqual(row.props.children.filter(c=>c?.type==='button').map(c=>text(c).trim()),['个股分析','板块分析','新建专家']);
  await h.store.queryStock('601088');const selected=ui(h,'Experts');assert.match(text(selected),/新建专家/);h.store.dispose();
});
test('new expert asks for natural-language requirements and starts only on explicit submit',async()=>{
  const h=setup(),opened=[];h.store.newExpert();const tree=ui(h,'Experts',{onOpenExpertSession:id=>opened.push(id)});
  assert.equal(h.requests.length,0);assert.match(text(tree),/想新建什么专家/);assert.match(text(tree),/可能产生模型费用/);
  assert.equal(nodes(tree).filter(n=>n.type==='textarea').length,1);assert.doesNotMatch(text(tree),/工具（每行一个）/);
  h.store.expertRequirement('我想参考 B站 北京炒家的公开方法');const result=await h.store.startExpertCreation(id=>opened.push(id));
  const post=h.requests.find(r=>r.url.endsWith('/expert-creation'));assert.ok(post);const body=JSON.parse(post.init.body);
  assert.equal(body.requirement,'我想参考 B站 北京炒家的公开方法');assert.ok(body.request_id.length>=16);assert.deepEqual(opened,['C1']);
  assert.equal(result.expertSaved,false);assert.equal(h.store.getSnapshot().expertResearch.phase,'accepted');assert.equal(h.store.getSnapshot().expertCreating,false);
  assert.equal(h.requests.some(r=>r.url.endsWith('/api/experts')&&r.init.method==='POST'),false);h.store.dispose();
});
test('empty requirement, missing navigation, and cancel never start AI',async()=>{
  const h=setup();h.store.newExpert();await h.store.startExpertCreation(()=>{});assert.equal(h.requests.length,0);
  h.store.expertRequirement('研究专家');await h.store.startExpertCreation();assert.equal(h.requests.length,0);assert.match(h.store.getSnapshot().expertResearch.error,/导航/);
  h.store.cancelNewExpert();assert.equal(h.store.getSnapshot().expertCreating,false);h.store.dispose();
});
test('AI creation prevents double submission and retries same request after a partial failure',async()=>{
  let resolvePost,attempt=0;const opened=[];
  const h=setup({fetch:(url,init,base)=>url.endsWith('/expert-creation')?new Promise(resolve=>{attempt++;resolvePost=resolve;}):base(url,init)});
  h.store.newExpert();h.store.expertRequirement('研究某种公开交易风格');const first=h.store.startExpertCreation(id=>opened.push(id));
  await h.store.startExpertCreation(()=>{});assert.equal(attempt,1);h.store.cancelNewExpert();assert.equal(h.store.getSnapshot().expertCreating,true);
  resolvePost(reply({error:'模型暂不可用',sessionId:'C1',workspaceId:'W1'},503));await first;
  assert.equal(h.store.getSnapshot().expertResearch.data.sessionId,'C1');assert.equal(h.store.getSnapshot().expertResearch.requirement,'研究某种公开交易风格');
  const oldId=h.store.getSnapshot().expertResearch.requestId;const second=h.store.startExpertCreation(id=>opened.push(id));
  assert.equal(JSON.parse(h.requests.at(-1).init.body).request_id,oldId);
  resolvePost(reply({status:'accepted',submitted:true,sessionId:'C1',workspaceId:'W1',expertSaved:false}));await second;
  assert.deepEqual(opened,['C1']);h.store.dispose();
});
test('accepted creation is not resubmitted when navigation fails or user returns',async()=>{
  const h=setup();h.store.newExpert();h.store.expertRequirement('参考公开方法论');await h.store.startExpertCreation(()=>{throw Error('导航失败');});
  assert.equal(h.store.getSnapshot().expertResearch.phase,'accepted');assert.equal(h.store.getSnapshot().expertResearch.data.submitted,true);
  await h.store.startExpertCreation(()=>{});assert.equal(h.requests.length,1);const opened=[];h.store.openExpertCreationSession(id=>opened.push(id));assert.deepEqual(opened,['C1']);h.store.dispose();
});
test('later user navigation suppresses only the late open, never cancels accepted AI work',async()=>{
  let finish;const h=setup({fetch:()=>new Promise(resolve=>finish=resolve)}),nav=new AbortController(),opened=[];
  const open=id=>opened.push(id);open.begin=()=>nav.signal;
  h.store.newExpert();h.store.expertRequirement('创建公开方法参考专家');const pending=h.store.startExpertCreation(open);nav.abort();
  finish(reply({status:'accepted',submitted:true,sessionId:'C1',workspaceId:'W1'}));await pending;
  assert.equal(h.store.getSnapshot().expertResearch.data.submitted,true);assert.deepEqual(opened,[]);assert.equal(h.requests.length,1);h.store.dispose();
});
test('AI accepted receipt does not invent an expert; later actual list refresh makes saved expert selectable',async()=>{
  let saved=false;const h=setup({fetch:(url,init,base)=>url.endsWith('/api/experts')&&init.method==='GET'?Promise.resolve(reply({items:[{id:'E1',name:'原专家',enabled:true},...(saved?[{id:'E3',name:'新专家',enabled:true}]:[])]})):base(url,init)});
  await h.store.loadExperts();h.store.newExpert();h.store.expertRequirement('新专家风格');await h.store.startExpertCreation(()=>{});
  assert.equal(h.store.getSnapshot().experts.data.items.length,1);assert.match(text(ui(h,'Experts')),/不代表专家已保存/);
  saved=true;await h.store.loadExperts();h.store.toggleExpert('E3');assert.ok(h.store.getSnapshot().expertIds.includes('E3'));h.store.dispose();
});
test('expert delete stays behind an inline confirmation and removes the real expert',async()=>{
  let deleted=false;
  const h=setup({fetch:(url,init,base)=>{
    if(/\/experts\/[^/]+$/.test(new URL('http://local'+url).pathname)&&init.method==='DELETE'){deleted=true;return Promise.resolve(reply({deleted:'E1'}));}
    if(url.endsWith('/experts'))return Promise.resolve(reply({items:[...(deleted?[]:[{id:'E1',name:'真实专家一',tag:'价值',criteria:'现金流证据',enabled:true}]),{id:'E2',name:'真实专家二',enabled:false}]}));
    return base(url,init);
  }});
  await h.store.loadExperts();const before=ui(h,'Experts');assert.match(text(before),/删除/);
  h.store.requestExpertDelete('E1');const confirming=ui(h,'Experts');assert.match(text(confirming),/确定删除专家/);assert.match(text(confirming),/真实专家一/);
  assert.equal(h.requests.some(r=>r.init.method==='DELETE'),false);
  await h.store.confirmExpertDelete();const del=h.requests.find(r=>r.init.method==='DELETE');assert.match(del.url,/\/experts\/E1$/);
  assert.equal(h.store.getSnapshot().expertDelete.id,null);assert.doesNotMatch(text(ui(h,'Experts')),/真实专家一/);assert.equal(h.store.getSnapshot().expertIds.includes('E1'),false);h.store.dispose();
});
test('expert delete cancel sends nothing and a failure keeps the confirmation visible',async()=>{
  const h=setup({fetch:(url,init,base)=>init.method==='DELETE'&&url.includes('/experts/')?Promise.resolve(reply({error:'专家不存在'},404)):base(url,init)});
  await h.store.loadExperts();h.store.requestExpertDelete('E1');h.store.cancelExpertDelete();assert.equal(h.requests.some(r=>r.init.method==='DELETE'),false);assert.equal(h.store.getSnapshot().expertDelete.id,null);
  h.store.requestExpertDelete('E1');await h.store.confirmExpertDelete();assert.equal(h.store.getSnapshot().expertDelete.id,'E1');assert.match(h.store.getSnapshot().expertDelete.error,/专家不存在/);assert.equal(h.store.getSnapshot().expertDelete.submitting,false);assert.equal(h.store.getSnapshot().experts.data.items.length,2);h.store.dispose();
});
test('team requires a user click, keeps full stock target, prevents duplicate submissions; 200 is not completion',async()=>{
  const h=setup();await h.store.queryStock('601088');await h.store.loadExperts();await h.store.startTeam();assert.equal(h.store.getSnapshot().notice.key,'consentRequired');assert.equal(h.requests.some(r=>r.url.endsWith('/research/team')),false);await h.store.startTeam(true);const posted=h.requests.find(r=>r.url.endsWith('/research/team'));assert.deepEqual(JSON.parse(posted.init.body),{kind:'stock',code:'601088',expert_ids:['E1']});assert.equal(h.store.getSnapshot().job.data.status,'queued');assert.equal(h.store.getSnapshot().job.data.result,undefined);await h.store.startTeam(true);assert.equal(h.requests.filter(r=>r.url.endsWith('/research/team')).length,1);h.store.dispose();
});
test('sector team submission keeps kind and full qualified code',async()=>{
  const h=setup();await h.store.querySector({thscode:'881101.TI',name:'真实板块'});await h.store.loadExperts();await h.store.startTeam(true);const body=JSON.parse(h.requests.at(-1).init.body);assert.equal(body.kind,'sector');assert.equal(body.code,'881101.TI');h.store.dispose();
});
test('missing model 503 surfaces real cause, with no invented job or automatic resubmission',async()=>{
  const h=setup({fetch:(url,init,base)=>url.endsWith('/research/team')?Promise.resolve(reply({error:'未配置模型密钥'},503)):base(url,init)});await h.store.queryStock('601088');await h.store.loadExperts();await h.store.startTeam(true);assert.equal(h.store.getSnapshot().job.phase,'error');assert.equal(h.store.getSnapshot().job.data,null);assert.match(h.store.getSnapshot().job.error.detail,/未配置模型密钥/);assert.equal(h.timers.size,0);h.store.dispose();
});
test('job polling stops when leaving, survives navigation by ID, and cancels only research',async()=>{
  const h=setup(),off=h.store.subscribe(()=>{});await h.store.queryStock('601088');await h.store.loadExperts();h.store.resumePolling();await h.store.startTeam(true);await tick();assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].ms,1800);h.store.stopPolling();assert.equal(h.timers.size,0);assert.equal(h.store.getSnapshot().job.data.id,'J1');h.store.resumePolling();await tick();assert.equal(h.timers.size,1);await h.store.cancelJob();assert.equal(h.store.getSnapshot().job.data.status,'cancelled');assert.equal(h.timers.size,0);assert.ok(h.requests.some(r=>r.url.endsWith('/jobs/J1/cancel')&&r.init.method==='POST'));assert.equal(h.requests.filter(r=>r.url.endsWith('/research/team')).length,1);assert.equal(h.requests.some(r=>/orders|trade\//.test(r.url)),false);off();h.store.dispose();
});
test('polling has five-minute cap; manual continue never resubmits',async()=>{
  const h=setup(),off=h.store.subscribe(()=>{});await h.store.queryStock('601088');await h.store.loadExperts();h.store.resumePolling();await h.store.startTeam(true);await tick();h.setClock(300001);await h.runTimer();assert.equal(h.store.getSnapshot().job.paused,true);assert.equal(h.timers.size,0);h.store.resumePolling(true);await tick();assert.equal(h.store.getSnapshot().job.paused,false);assert.equal(h.timers.size,1);assert.equal(h.requests.filter(r=>r.url.endsWith('/research/team')).length,1);off();h.store.dispose();
});
test('150 checks is an independent polling cap even if time does not advance',async()=>{
  const h=setup(),off=h.store.subscribe(()=>{});await h.store.queryStock('601088');await h.store.loadExperts();h.store.resumePolling();await h.store.startTeam(true);await tick();for(let i=0;i<150;i++){if(!h.timers.size)break;await h.runTimer();}assert.equal(h.store.getSnapshot().job.paused,true);assert.equal(h.requests.filter(r=>r.url.endsWith('/jobs/J1')).length,150);off();h.store.dispose();
});
test('late job result belongs to submitted target, not the newly selected stock',async()=>{
  const result={kind:'stock',target:{code:'601088',thscode:'601088.SH',name:'原股票'},report:report(),consensus:{decision:'up',up:1,down:0,abstained:0,support:1},votes:[],errors:[]};
  const h=setup({fetch:(url,init,base)=>url.endsWith('/jobs/J1')?Promise.resolve(reply({id:'J1',status:'completed',result})):base(url,init)}),off=h.store.subscribe(()=>{});await h.store.queryStock('601088');await h.store.loadExperts();await h.store.startTeam(true);await h.store.queryStock('000001');h.store.resumePolling();await tick();assert.equal(h.store.getSnapshot().job.data.result.target.code,'601088');assert.equal(h.store.getSnapshot().target.code,'000001');assert.match(text(ui(h,'Experts')),/属于另一个研究对象/);assert.match(text(ui(h,'Experts')),/报告研究对象: 原股票 601088/);off();h.store.dispose();
});
test('job response identity mismatches never become a team conclusion',async()=>{
  const h=setup({fetch:(url,init,base)=>url.endsWith('/jobs/J1')?Promise.resolve(reply({id:'J1',status:'completed',result:{kind:'stock',target:{code:'000001'}}})):base(url,init)}),off=h.store.subscribe(()=>{});await h.store.queryStock('601088');await h.store.loadExperts();await h.store.startTeam(true);h.store.resumePolling();await tick();assert.equal(h.store.getSnapshot().job.error.key,'invalidResponse');assert.equal(h.store.getSnapshot().job.data.result,undefined);off();h.store.dispose();
});
test('team views present outlook, disagreement, evidence, risks and abstention rather than only JSON',()=>{
  const h=setup(),result={kind:'stock',target:{code:'601088',name:'原股票'},report:report(),consensus:{decision:'mixed',up:2,down:1,abstained:1,support:2/3},votes:[{expert:{id:'E1',name:'真实专家'},vote:1,confidence:.7,reason:'量能修复但尚未突破',evidence:[{source:'history',ref:'20日阻力'}],outlook:{short_term:'震荡消化',medium_term:'量价确认后再判断',bull_case:'站稳阻力',bear_case:'失守支撑',invalidation:'量能背离'},risks:['宏观风险']},{expert:{id:'E3',name:'弃权专家'},abstained:true,reason:'证据缺失',evidence:[],risks:[]}],errors:['一项数据源缺失']};const tree=ui(h,'TeamResult',{result});for(const phrase of ['站稳阻力','失守支撑','量能背离','宏观风险','20日阻力','证据缺失','不是胜率或上涨概率','证据生成时间'])assert.match(text(tree),new RegExp(phrase));assert.equal(nodes(tree).some(n=>n.type==='pre'),false);h.store.dispose();
});
test('DSH secondary action only calls draft bridge and rejects stale draft completion',async()=>{
  const h=setup();await h.store.queryStock('601088');let resolve,received;const drafting=h.store.draft(prompt=>{received=prompt;return new Promise(r=>{resolve=r;});},k=>h.api.investMessages().zh[k] || k);assert.match(received,/DATA_EVIDENCE_JSON/);assert.match(received,/历史内样本命中率/);h.store.setCode('000001');resolve({accepted:true,submitted:false});await drafting;assert.equal(h.store.getSnapshot().draft.phase,'idle');assert.equal(h.requests.some(r=>/agent\/chat|research\/team/.test(r.url)),false);h.store.dispose();
});
test('watchlist additions use explicit clicks and stock context; watchlist opens real brief',async()=>{
  const h=setup();await h.store.queryStock('601088');await h.store.addWatch();const post=h.requests.at(-1);assert.deepEqual(JSON.parse(post.init.body),{code:'601088',category:'个股'});assert.equal(h.store.getSnapshot().add.phase,'ready');await h.store.querySector({thscode:'881101.TI'});const count=h.requests.length;await h.store.addWatch();assert.equal(h.requests.length,count);h.store.dispose();
});
test('compiled client registers exactly seven stable native entries and bare SVGs; cleanup is complete',()=>{
  let def;const R=fakeReact(),context=vm.createContext({window:{__ModuleLoader__:{load:v=>{def=v;}}},AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout});vm.runInContext(compiled,context);const plugin=def.factory(name=>{assert.equal(name,'react');return R;}),regs=[],cleanup=[];plugin.apply({locale:{register:()=>()=>{},bind:()=>k=>k,subscribe:()=>()=>{},getSnapshot:()=>0},layout:{selectPanel(){}},effect(fn){const d=fn();if(typeof d==='function')cleanup.push(d);},slots:{inject:(_s,fn)=>fn(),register:(options,component)=>{regs.push({options,component});return()=>{};}}});const left=regs.filter(r=>r.options.name==='sidebar.panellist'),main=regs.filter(r=>r.options.name==='main');assert.equal(left.length,7);assert.equal(main.length,7);assert.deepEqual(left.map(r=>r.options.order),[30,31,32,33,34,35,36]);assert.deepEqual(left.map(r=>r.options.id),['dsh-super-trader','dsh-super-trader-stock','dsh-super-trader-sectors','dsh-super-trader-factors','dsh-super-trader-experts','dsh-super-trader-watchlist','dsh-super-trader-journal']);for(const entry of left)assert.equal(entry.component({size:20,active:true}).type,'svg');for(const entry of main){const panel=entry.component({});assert.equal(panel.type(panel.props).type,'section');}assert.equal(regs.some(r=>r.options.name.includes('right')||r.options.key==='conversation'),false);assert.doesNotMatch(compiled,/iframe|document\.body|ui-primitives/);for(const fn of cleanup.reverse())fn();
});
test('installed client hides host Plugins, More and Data-settings entries globally with cleanup',()=>{
  let def;const R=fakeReact(),styles=[];
  const document={head:{appendChild:el=>styles.push(el)},createElement:()=>({dataset:{},textContent:'',remove(){styles.splice(styles.indexOf(this),1);}})};
  const context=vm.createContext({window:{__ModuleLoader__:{load:v=>{def=v;}}},document,AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout});
  vm.runInContext(compiled,context);const plugin=def.factory(name=>{assert.equal(name,'react');return R;}),regs=[],cleanup=[];
  plugin.apply({locale:{register:()=>()=>{},bind:()=>k=>k,subscribe:()=>()=>{},getSnapshot:()=>0},layout:{selectPanel(){}},effect(fn){const d=fn();if(typeof d==='function')cleanup.push(d);},slots:{inject:(_s,fn)=>fn(),register:(options,component)=>{regs.push({options,component});return()=>{};}}});
  assert.equal(styles.length,1);assert.equal(styles[0].dataset.plugin,'dsh-super-trader');assert.match(styles[0].textContent,/aria-label="插件"/);assert.match(styles[0].textContent,/aria-haspopup="menu"/);assert.match(styles[0].textContent,/display:none!important/);
  const left=regs.filter(r=>r.options.name==='sidebar.panellist');assert.equal(left.some(r=>r.options.id==='dsh-super-trader-settings'),false);
  for(const fn of cleanup.reverse())fn();assert.equal(styles.length,0);
});
test('theme-only responsive styles do not hardcode colors or hide the native application',()=>{
  assert.doesNotMatch(css,/#(?:[0-9a-f]{3,8})\b|rgba?\(|hsla?\(/i);assert.match(css,/--dsw-alias-/);assert.match(css,/minmax\(0,1fr\)/);assert.match(css,/max-width:420px/);assert.match(css,/overflow-wrap:anywhere/);
});
