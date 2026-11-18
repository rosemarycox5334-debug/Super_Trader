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
function harness(custom) {
  const requests=[],timers=new Map();let serial=0,clock=0;
  const context=vm.createContext({AbortSignal,AbortController,URLSearchParams,setTimeout,clearTimeout});
  const api=vm.runInContext(cockpit+'\n'+source+'\n({createInvestStore,createInvestComponents,investMessages})',context);
  const base=async(url,init={})=>{
    if(url.endsWith('/experts'))return reply({items:experts});
    if(url.endsWith('/selection-analysis')){
      const body=JSON.parse(init.body);
      return reply({status:'accepted',submitted:true,sessionId:'S-select',workspaceId:'W-select',params:body,request_id:body.request_id});
    }
    return reply({error:'Unexpected '+url},404);
  };
  const store=api.createInvestStore({autoConnect:false,now:()=>clock,schedule:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},unschedule:id=>timers.delete(id),fetch:async(url,init)=>{requests.push({url,init});return custom?custom(url,init,base):base(url,init);}});
  return {api,store,requests,timers};
}
function react(effects=[]) {return {Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useSyncExternalStore:(_s,get)=>get(),useEffect:fn=>effects.push(fn)};}
function render(node){if(Array.isArray(node))return node.map(render);if(!node||typeof node!=='object')return node;if(typeof node.type==='function')return render(node.type(node.props));return {...node,props:{...node.props,children:(node.props?.children || []).map(render)}};}
function nodes(node){return Array.isArray(node)?node.flatMap(nodes):!node||typeof node!=='object'?[]:[node,...nodes(node.props?.children || [])];}
function text(node){return Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):String(node ?? '');}
function ui(h,name='Screen',props={},effects=[]){const c=h.api.createInvestComponents(react(effects),h.store),t=k=>h.api.investMessages().zh[k] || k;return render(c[name]({t,...props}));}
const starts=h=>h.requests.filter(r=>r.url.endsWith('/selection-analysis'));

test('default native UI has all-A-share scope, no style/grid candidates, and mount cannot call models',async()=>{
  const h=harness(),effects=[],off=h.store.subscribe(()=>{});const tree=ui(h,'Screen',{},effects);
  assert.equal(h.store.getSnapshot().screen.scope,'market');assert.equal(h.store.getSnapshot().screen.style,undefined);
  assert.match(text(tree),/专家自主|自主找候选/);assert.match(text(tree),/全A股/);assert.match(text(tree),/预算限制/);assert.match(text(tree),/并非全市场逐股扫描/);
  assert.doesNotMatch(text(tree),/趋势共振|偏多观察|本地量化库/);
  assert.equal(nodes(tree).filter(n=>n.type==='input'&&n.props.type!=='checkbox').length,0);
  const cleanup=effects.map(fn=>fn()).filter(fn=>typeof fn==='function');await tick();
  assert.equal(h.requests.length,0);assert.equal(starts(h).length,0);
  cleanup.forEach(fn=>fn());off();h.store.dispose();
});
test('selection uses every enabled expert without asking the user to tick them',async()=>{
  const h=harness();await h.store.loadExperts();
  const tree=ui(h,'Screen'),body=text(tree);
  assert.doesNotMatch(body,/选择参与专家/);
  assert.match(body,/全部已启用的专家/);
  assert.equal(nodes(tree).filter(n=>n.type==='input'&&n.props.type==='checkbox').length,0);
  const opened=[];
  h.store.screenOptions({scope:'market'});
  await h.store.startSelectionAnalysis(id=>opened.push(id));await tick();
  const post=starts(h)[0];
  assert.equal(Object.hasOwn(JSON.parse(post.init.body),'expert_ids'),false);
  assert.equal(opened[0],'S-select');
  h.store.dispose();
});
test('only an explicit click opens Ai专家选股 session with the selected scope, experts and brief',async()=>{
  const h=harness(),opened=[];
  await h.store.loadExperts();h.store.toggleSelectionExpert('growth');h.store.screenOptions({scope:'watchlist',brief:'偏好耐心研究，允许量化缺失'});
  const tree=ui(h,'Screen',{onOpenExpertSession:id=>opened.push(id)}),button=nodes(tree).find(n=>n.type==='button'&&text(n).includes('开始专家选股'));
  assert.ok(button,'explicit start button');
  await button.props.onClick();await tick();
  assert.equal(starts(h).length,1);
  const body=JSON.parse(starts(h)[0].init.body);
  assert.equal(body.scope,'watchlist');assert.equal(Object.hasOwn(body,'expert_ids'),false);assert.equal(body.brief,'偏好耐心研究，允许量化缺失');assert.equal(body.limit_per_expert,5);
  assert.equal(opened[0],'S-select');
  await h.store.startSelectionAnalysis(()=>{});assert.equal(h.store.getSnapshot().selectionAi.phase,'ready');
  h.store.dispose();
});
test('scope sector requires a qualified sector and >1000-character brief never submits',async()=>{
  const h=harness();await h.store.loadExperts();h.store.screenOptions({scope:'sector'});await h.store.startSelectionAnalysis(()=>{});assert.equal(h.store.getSnapshot().notice.key,'selectionMissingSector');assert.match(text(ui(h)),/板块页选择板块/);
  h.store.screenOptions({sector:'881101'});await h.store.startSelectionAnalysis(()=>{});assert.equal(starts(h).length,0);
  h.store.screenOptions({sector:'881101.TI',brief:'字'.repeat(1001)});await h.store.startSelectionAnalysis(()=>{});assert.equal(h.store.getSnapshot().notice.key,'selectionBriefLong');assert.equal(starts(h).length,0);
  h.store.screenOptions({brief:'关注行业差异'});await h.store.startSelectionAnalysis(()=>{});await tick();
  assert.deepEqual(JSON.parse(starts(h)[0].init.body).sector,'881101.TI');h.store.dispose();
});
test('sector scope can be chosen on the selection page itself',async()=>{
  const h=harness((url,init,base)=>url.includes('/market/sectors')
    ? reply({items:[{name:'银行板块',thscode:'881101.TI'},{name:'煤炭板块',thscode:'881105.TI'}],total:2,source:'real directory'})
    : base(url,init));
  h.store.screenOptions({scope:'sector'});
  await h.store.loadSectors(0);
  const tree=ui(h,'Screen'),selects=nodes(tree).filter(n=>n.type==='select');
  const picker=selects.find(n=>nodes(n).some(o=>o.type==='option'&&String(o.props.value)==='881101.TI'));
  assert.ok(picker,'sector picker rendered on the page');
  picker.props.onChange({target:{value:'881105.TI'}});
  assert.equal(h.store.getSnapshot().screen.sector,'881105.TI');
  assert.equal(h.requests.some(r=>r.url.includes('/market/sectors')),true);
  h.store.dispose();
});
test('brief and sector are normalized exactly as posted and the receipt is kept',async()=>{
  const h=harness();
  h.store.screenOptions({scope:'sector',sector:' 881101.ti  ',brief:'  保留自主研究偏好\n '});
  await h.store.loadExperts();await h.store.startSelectionAnalysis(()=>{});await tick();
  const body=JSON.parse(starts(h)[0].init.body);
  assert.equal(body.sector,'881101.TI');assert.equal(body.brief,'保留自主研究偏好');assert.equal(body.limit_per_expert,5);
  assert.equal(h.store.getSnapshot().selectionAi.phase,'ready');
  assert.equal(h.store.getSnapshot().selectionAi.sessionId,'S-select');
  h.store.dispose();
});
