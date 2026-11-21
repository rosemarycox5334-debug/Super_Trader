import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../tools/cockpit-source.js',import.meta.url),'utf8');
const clientSource=await readFile(new URL('../tools/client-source.js',import.meta.url),'utf8');
const investSource=await readFile(new URL('../tools/invest-source.js',import.meta.url),'utf8');
const css=await readFile(new URL('../assets/cockpit.css',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,statusText:'test',text:async()=>JSON.stringify(data),json:async()=>data});
const row=(date=Date.UTC(2026,10,12),extra={})=>({date_ms:date,open_price:10,high_price:12,low_price:9,close_price:11,volume:100,turnover:1000,...extra});
const history=(code='601088',extra={})=>({code,name:'Real stock',thscode:code+'.SH',interval:'1d',adjust:'forward',source:'real history provider',timestamp:Date.UTC(2026,10,13),fetched_at:'2026-11-13T02:00:00Z',cached:false,items:[row(),row(Date.UTC(2026,10,13),{open_price:11,close_price:10,volume:200})],warnings:[],...extra});
const quotes=(codes=['601088'],extra={})=>({source:'real quote provider',timestamp:Date.UTC(2026,10,13),fetched_at:'2026-11-13T02:00:00Z',cached:false,items:codes.map(code=>({code,name:'Real '+code,last_price:11.25,price_change:.25,price_change_ratio_pct:2.27,open_price:11,high_price:12,low_price:10,volume:1000,turnover:11000})),missing:[],warnings:[],...extra});
const quant=(code='601088',horizon=10,extra={})=>({symbol:{code,name:'Real '+code,category:'个股'},target:{horizon,target_date:'2026-11-19'},direction:0,probability:null,baseline_up:.514,rules:[],sample:{predictions:860,coverage:.45,period:['2018-01-01','2026-11-05']},source:'grid',evaluation:{type:'in_sample',calibrated:false},warnings:['历史内样本频率'],...extra});
function setup(overrides={}) {
  const requests=[],writes=[];
  const storage={getItem:()=>overrides.saved || null,setItem:(key,value)=>writes.push({key,value})};
  const defaultFetch=async(url,init={})=>{
    requests.push({url,init});
    if(url.endsWith('/base'))return reply({phase:'running',apiBase:'/dsh-super-trader/backend'});
    if(url.endsWith('/retry'))return reply({phase:'running'});
    if(url.endsWith('/api/status'))return reply({ok:true,grid:{snapshot:'2026-11-05'},capabilities:{research_data_available:true,grid_available:true,market_configured:true}});
    if(url.endsWith('/api/watchlist'))return reply(init.method==='POST'?{id:'W1'}:{items:[],max:200});
    const params=new URL('http://test'+url).searchParams;
    if(url.includes('/market/quotes'))return reply(quotes(params.get('codes').split(',')));
    if(url.includes('/market/history'))return reply(history(params.get('code')));
    if(url.includes('/quant/probability'))return reply(quant(params.get('code'),Number(params.get('horizon'))));
    if(url.endsWith('/api/journal'))return reply(init.method==='POST'?{id:'J1'}:{items:[]});
    return reply({error:'unexpected URL'},404);
  };
  const context=vm.createContext({AbortController,AbortSignal,URLSearchParams,DOMException,setTimeout,clearTimeout,console});
  const api=vm.runInContext(source+'\n({createCockpitStore,createCockpitComponents,cockpitMessages,cockpitHistoryModel,cockpitQuant,cockpitJournalPayload,cockpitEvidence,cockpitDraftPrompt,superTraderIcon});',context);
  const store=api.createCockpitStore({autoConnect:false,storage,fetch:overrides.fetch || defaultFetch,...overrides.options});
  return {api,store,requests,writes,context,defaultFetch};
}
function fakeReact() {
  return {Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),useEffect:()=>{},useState:value=>[typeof value==='function'?value():value,()=>{}],useRef:()=>({current:null})};
}
function nodes(tree) {return !tree || typeof tree!=='object'?[]:[tree,...(tree.props?.children || []).flat(Infinity).flatMap(nodes)];}

test('cockpit source is declaration-only and locale keys match in both languages',()=>{
  const h=setup();
  assert.equal(h.requests.length,0);
  assert.doesNotMatch(source,/^(?:import|export|const |let |window\.|document\.)/m);
  const messages=h.api.cockpitMessages();
  assert.deepEqual(Object.keys(messages.zh).sort(),Object.keys(messages.en).sort());
  // User decision: panel actions use the Super Trader product name in both languages.
  assert.match(messages.zh.analyze,/Super Trader/);assert.match(messages.en.analyze,/Super Trader/);
  h.store.dispose();
});
test('only code, horizon and tab persist; evidence and secrets never enter localStorage',async()=>{
  const h=setup({saved:JSON.stringify({code:'601088',horizon:7,tab:'settings',quote:{api_key:'do-not-load'}})});
  assert.equal(h.store.getSnapshot().selection.code,'601088');
  assert.equal(h.store.getSnapshot().selection.horizon,7);
  assert.equal(h.store.getSnapshot().tab,'settings');
  assert.equal(h.store.getSnapshot().quote.data,null);
  await h.store.query();
  h.store.setTab('watchlist');
  for(const write of h.writes)assert.deepEqual(Object.keys(JSON.parse(write.value)).sort(),['code','horizon','tab']);
  assert.doesNotMatch(JSON.stringify(h.writes),/api_key|last_price|860|evidence/);
  h.store.dispose();
});
test('invalid persisted selection is rejected and invalid code makes no network call',async()=>{
  const h=setup({saved:'{"code":"<script>","horizon":90,"tab":"unknown"}'});
  assert.equal(h.store.getSnapshot().selection.code,'');assert.equal(h.store.getSnapshot().selection.horizon,10);
  h.store.setCode('601');await h.store.query();
  assert.equal(h.requests.length,0);assert.equal(h.store.getSnapshot().notice.key,'invalidCode');
  h.store.setHorizon(21);assert.equal(h.store.getSnapshot().selection.horizon,10);h.store.dispose();
});
test('direct 6-digit lookup starts exactly three independent requests without a local symbol search',async()=>{
  const pending=[];
  const h=setup({fetch:(url,init)=>new Promise(resolve=>pending.push({url,init,resolve}))});
  h.store.setCode('601088');const querying=h.store.query();
  assert.equal(pending.length,3);
  assert.deepEqual(pending.map(p=>new URL('http://test'+p.url).pathname).sort(),['/dsh-super-trader/backend/api/market/history','/dsh-super-trader/backend/api/market/quotes','/dsh-super-trader/backend/api/quant/probability']);
  assert.match(pending[2].url,/limit=120&adjust=forward/);
  assert.match(pending[1].url,/code=601088&horizon=10/);
  pending[0].resolve(reply(quotes()));await turn();
  assert.equal(h.store.getSnapshot().quote.phase,'ready');assert.equal(h.store.getSnapshot().quant.phase,'loading');
  pending[1].resolve(reply(quant()));pending[2].resolve(reply(history()));await querying;
  assert.equal(h.store.getSnapshot().history.phase,'ready');h.store.dispose();
});
test('switching code aborts and invalidates all old evidence; racing responses cannot overwrite selection',async()=>{
  const pending=[];const h=setup({fetch:(url,init)=>new Promise(resolve=>pending.push({url,init,resolve}))});
  h.store.setCode('601088');const first=h.store.query();
  h.store.setCode('000001');const second=h.store.query();
  assert.ok(pending.slice(0,3).every(p=>p.init.signal.aborted));
  pending[3].resolve(reply(quotes(['000001'])));pending[4].resolve(reply(quant('000001')));pending[5].resolve(reply(history('000001')));await second;
  pending[0].resolve(reply(quotes()));pending[1].resolve(reply(quant()));pending[2].resolve(reply(history()));await first;
  const state=h.store.getSnapshot();assert.equal(state.selection.code,'000001');assert.equal(state.quote.data.code,'000001');assert.equal(state.quant.data.symbol.code,'000001');assert.equal(state.history.data.code,'000001');h.store.dispose();
});
test('horizon changes clear stale quant and retain the selected code across navigation tabs',async()=>{
  const h=setup();h.store.setCode('601088');await h.store.query();h.store.setHorizon(3);
  assert.equal(h.store.getSnapshot().quant.phase,'idle');h.store.setTab('advanced-experts');h.store.setTab('cockpit');
  assert.equal(h.store.getSnapshot().selection.code,'601088');assert.equal(h.store.getSnapshot().selection.horizon,3);
  await h.store.query();assert.equal(h.store.getSnapshot().quant.data.target.horizon,3);h.store.dispose();
});
test('quotes and history remain usable when quant has no local historical coverage',async()=>{
  const h=setup();const original=h.defaultFetch;
  const other=setup({fetch:(url,init)=>url.includes('/quant/')?Promise.resolve(reply({error:'no historical research data'},404)):original(url,init)});
  other.store.setCode('600000');await other.store.query();
  assert.equal(other.store.getSnapshot().quote.phase,'ready');assert.equal(other.store.getSnapshot().history.phase,'ready');assert.equal(other.store.getSnapshot().quant.phase,'error');
  assert.match(other.store.getSnapshot().quant.error.detail,/no historical/);h.store.dispose();other.store.dispose();
});
test('neutral probability remains null and mismatched or invented probability is rejected',()=>{
  const h=setup();const selection={code:'601088',horizon:10};
  assert.equal(h.api.cockpitQuant(quant(),selection).probability,null);
  for(const value of [quant('000001'),quant('601088',3),quant('601088',10,{probability:.8}),quant('601088',10,{direction:1,probability:1.2})])assert.throws(()=>h.api.cockpitQuant(value,selection));
  h.store.dispose();
});
test('missing quote and backend errors are explicit, never synthetic zero values',async()=>{
  const h=setup({fetch:async url=>url.includes('/quotes')?reply(quotes([])):url.includes('/history')?reply({error:'provider offline'},503):reply(quant())});
  h.store.setCode('601088');await h.store.query();const state=h.store.getSnapshot();
  assert.equal(state.quote.phase,'error');assert.equal(state.quote.error.key,'missingQuote');assert.equal(state.quote.data,null);assert.equal(state.history.phase,'error');assert.equal(state.quant.phase,'ready');h.store.dispose();
});
test('history schema rejects null OHLC, impossible candles, duplicate dates and wrong adjustment',()=>{
  const h=setup();const bad=[history('601088',{adjust:'none'}),history('601088',{interval:'1h'}),history('601088',{items:[]}),history('601088',{items:[row(undefined,{open_price:null})]}),history('601088',{items:[row(undefined,{low_price:12})]}),history('601088',{items:[row(),row()]})];
  for(const value of bad)assert.throws(()=>h.api.cockpitHistoryModel(value));
  assert.equal(h.api.cockpitHistoryModel(history('601088',{items:[row(undefined,{volume:null})]})).items[0].volume,null);h.store.dispose();
});
test('native SVG candles and volume use real schema; empty data produces no fake SVG',()=>{
  const h=setup(),React=fakeReact(),components=h.api.createCockpitComponents(React,h.store),t=key=>key;
  const rendered=components.CandleChart({data:history(),t});
  const all=nodes(rendered);assert.equal(all.filter(n=>n.type==='svg').length,1);
  assert.equal(all.filter(n=>n.type==='rect'&&String(n.props.className).includes('stc-volume')).length,2);
  assert.equal(all.filter(n=>n.type==='rect'&&!String(n.props.className).includes('stc-volume')).length,2);
  assert.doesNotMatch(JSON.stringify(rendered),/NaN|Infinity/);
  assert.equal(nodes(components.CandleChart({data:history('601088',{items:[]}),t})).filter(n=>n.type==='svg').length,0);h.store.dispose();
});
test('SVG handles real flat-price/doji candles without invalid geometry',()=>{
  const h=setup(),components=h.api.createCockpitComponents(fakeReact(),h.store);
  const tree=components.CandleChart({data:history('601088',{items:[row(undefined,{open_price:10,close_price:10,high_price:10,low_price:10,volume:0})]}),t:key=>key});
  assert.doesNotMatch(JSON.stringify(tree),/NaN|Infinity/);h.store.dispose();
});
test('prompt whitelists evidence, includes both source times and null, excludes credentials and unknown payload keys',async()=>{
  const h=setup({fetch:async url=>url.includes('/quotes')?reply(quotes(['601088'],{account:'private-account',api_key:'never-export',warnings:['api_key=topsecret']})):url.includes('/history')?reply(history('601088',{secret:'do-not-export'})):reply(quant('601088',10,{password:'not-for-ai'}))});
  h.store.setCode('601088');await h.store.query();
  const prompt=h.api.cockpitDraftPrompt(h.store.getSnapshot());
  assert.match(prompt,/2026-11-05/);assert.match(prompt,/"timestamp"/);assert.match(prompt,/"probability": null/);assert.match(prompt,/st_market_quotes/);assert.match(prompt,/未校准/);
  assert.doesNotMatch(prompt,/never-export|topsecret|do-not-export|not-for-ai|private-account/);assert.match(prompt,/REDACTED/);h.store.dispose();
});
test('saving freezes the exact currently displayed signal and provenance, not an invented AI opinion or trade price',async()=>{
  const h=setup();h.store.setCode('601088');await h.store.query();await h.store.saveResearch();
  const request=h.requests.find(r=>r.url.endsWith('/journal')&&r.init.method==='POST'),payload=JSON.parse(request.init.body);
  assert.equal(payload.action,'watch');assert.equal(payload.signal.direction,0);assert.equal(payload.signal.probability,null);assert.equal(payload.signal.snapshot,'2026-11-05');assert.equal(payload.signal.evaluation.type,'in_sample');
  assert.equal(payload.reasons.summary,'用户保存研究快照，非AI结论');assert.deepEqual(payload.reasons.votes,[]);assert.ok(payload.reasons.evidence.quote.timestamp);assert.equal(payload.reasons.evidence.history_summary.adjust,'forward');assert.equal('price' in payload,false);assert.equal(h.store.getSnapshot().save.data.id,'J1');h.store.dispose();
});
test('no successful quant means no journal POST, including after switching code',async()=>{
  const h=setup();h.store.setCode('601088');await h.store.saveResearch();assert.equal(h.requests.length,0);
  await h.store.query();h.store.setCode('000001');await h.store.saveResearch();assert.equal(h.requests.filter(r=>r.init.method==='POST').length,0);h.store.dispose();
});
test('DSH analysis uses only callback, exposes read-only fallback on failure and never calls Python experts/chat',async()=>{
  const h=setup();h.store.setCode('601088');await h.store.query();let received;
  await h.store.analyze(async prompt=>{received=prompt;throw Error('no selected session');});
  const state=h.store.getSnapshot();assert.equal(state.analysis.phase,'error');assert.equal(state.analysis.prompt,received);assert.match(state.analysis.error.detail,/no selected session/);
  assert.equal(h.requests.some(r=>/experts|agent\/chat/.test(r.url)),false);
  assert.equal(h.writes.some(w=>w.value.includes('DATA_EVIDENCE')),false);h.store.dispose();
});
test('stale analysis completion cannot attach itself to a newly selected symbol',async()=>{
  const h=setup();h.store.setCode('601088');let resolve;const pending=h.store.analyze(()=>new Promise(r=>{resolve=r;}));
  h.store.setCode('000001');resolve({accepted:true,sessionId:'session-a'});await pending;
  assert.equal(h.store.getSnapshot().analysis.phase,'idle');assert.equal(h.store.getSnapshot().selection.code,'000001');h.store.dispose();
});
test('accepted DSH session reference is optional and can be frozen without sending a model response',async()=>{
  const h=setup();h.store.setCode('601088');await h.store.query();await h.store.analyze(async()=>({accepted:true,sessionId:'session-one'}));
  const payload=clone(h.api.cockpitJournalPayload(h.store.getSnapshot()));assert.equal(payload.reasons.session_id,'session-one');assert.equal(payload.reasons.votes.length,0);h.store.dispose();
});
test('watchlist pagination requests exactly the current 50 on manual refresh and no quotes on page change',async()=>{
  const items=Array.from({length:120},(_,index)=>({code:String(600000+index),name:'Stock '+index,category:'个股'}));
  const requests=[];const h=setup({fetch:async(url,init)=>{requests.push({url,init});return reply(url.endsWith('/watchlist')?{items,max:200}:quotes(new URL('http://test'+url).searchParams.get('codes').split(',')));}});
  await h.store.loadWatchlist();assert.equal(requests.length,1);await h.store.loadPageQuotes();
  let codes=new URL('http://test'+requests[1].url).searchParams.get('codes').split(',');assert.equal(codes.length,50);assert.equal(codes[0],'600000');assert.equal(codes[49],'600049');
  h.store.setPage(1);assert.equal(requests.length,2);assert.equal(h.store.getSnapshot().pageQuotes.phase,'idle');await h.store.loadPageQuotes();
  codes=new URL('http://test'+requests[2].url).searchParams.get('codes').split(',');assert.equal(codes[0],'600050');assert.equal(codes[49],'600099');
  h.store.setPage(2);await h.store.loadPageQuotes();assert.equal(new URL('http://test'+requests[3].url).searchParams.get('codes').split(',').length,20);h.store.dispose();
});
test('unsupported watchlist classifications do not make market requests',async()=>{
  let calls=0;const h=setup({fetch:async()=>{calls++;return reply({items:[{code:'000001',category:'指数'},{code:'510300',category:'ETF'}],max:200});}});
  await h.store.loadWatchlist();await h.store.loadPageQuotes();assert.equal(calls,1);assert.equal(h.store.getSnapshot().pageQuotes.error.key,'noQuotes');h.store.dispose();
});
test('old page quote response cannot overwrite a new watchlist page',async()=>{
  const items=Array.from({length:51},(_,index)=>({code:String(600000+index),category:'个股'}));let resolve,signal;
  const h=setup({fetch:async(url,init)=>url.endsWith('/watchlist')?reply({items,max:200}):new Promise(r=>{resolve=r;signal=init.signal;})});
  await h.store.loadWatchlist();const pending=h.store.loadPageQuotes();h.store.setPage(1);assert.equal(signal.aborted,true);resolve(reply(quotes(['600000'])));await pending;assert.equal(h.store.getSnapshot().pageQuotes.phase,'idle');h.store.dispose();
});
test('retry startup is an explicit POST and then re-probes real status',async()=>{
  const h=setup();await h.store.retryBackend();await turn();
  assert.equal(h.requests[0].url,'/dsh-super-trader/retry');assert.equal(h.requests[0].init.method,'POST');
  assert.ok(h.requests.some(r=>r.url.endsWith('/base')));assert.ok(h.requests.some(r=>r.url.endsWith('/api/status')));assert.equal(h.store.getSnapshot().connection.ready,true);assert.equal(h.store.getSnapshot().status.grid.snapshot,'2026-11-05');h.store.dispose();
});
test('legacy status without capabilities remains supported and offline status does not erase selected code',async()=>{
  let fail=false;const h=setup({fetch:async url=>{if(fail)throw Error('backend disconnected');return reply(url.endsWith('/base')?{phase:'external',apiBase:'/proxy'}:url.endsWith('/status')?{ok:true,grid:{snapshot:'2026-11-05'}}:{items:[]});}});
  h.store.setCode('601088');await h.store.checkConnection();assert.equal(h.store.getSnapshot().connection.ready,true);fail=true;await h.store.checkConnection();assert.equal(h.store.getSnapshot().connection.ready,false);assert.equal(h.store.getSnapshot().selection.code,'601088');h.store.dispose();
});
test('journal list and review use existing read endpoints without inventing returns',async()=>{
  const requests=[];const h=setup({fetch:async url=>{requests.push(url);return reply(url.endsWith('/review')?{return:{available:false,reason:'insufficient_data'}}:{items:[{id:'J1'}]});}});
  await h.store.loadJournal();await h.store.reviewJournal('J1');assert.equal(h.store.getSnapshot().journal.data.items[0].id,'J1');assert.equal(h.store.getSnapshot().review.data.return.available,false);assert.match(requests[1],/\/journal\/J1\/review$/);h.store.dispose();
});
test('client registers seven workflow entries, bare SVG icons, no right sidebar or replacement conversation key',()=>{
  let definition;
  const React=fakeReact(),context=vm.createContext({window:{__ModuleLoader__:{load:value=>{definition=value;}}},AbortController,AbortSignal,URLSearchParams,DOMException,setTimeout,clearTimeout});
  const compiled=clientSource.replace('/*__PAGES__*/','function createPages(){ return {navigate(){},dispose(){}}; }').replace('/*__COCKPIT__*/',source).replace('/*__INVEST__*/',investSource).replace('/*__BRIDGE__*/','function createAnalysisBridge(){ return async()=>({accepted:false}); } function createExpertSessionBridge(){ return undefined; }').replace('/*__CSS__*/','"test css"');
  vm.runInContext(compiled,context);
  const plugin=definition.factory(name=>{assert.equal(name,'react');return React;});
  const registrations=[],cleanup=[];
  plugin.apply({locale:{register(){return ()=>{};},bind:()=>key=>key,subscribe:()=>()=>{},getSnapshot:()=>0},layout:{selectPanel(){}},effect(fn){const value=fn();if(typeof value==='function')cleanup.push(value);},slots:{inject(_owner,fn){return fn();},register(options,component){registrations.push({options,component});return ()=>{};}}});
  const left=registrations.filter(r=>r.options.name==='sidebar.panellist'),main=registrations.filter(r=>r.options.name==='main');
  assert.equal(left.length,7);assert.equal(main.length,7);assert.deepEqual(left.map(r=>r.options.order),[30,31,32,33,34,35,36]);assert.equal(registrations.some(r=>r.options.name.includes('right')),false);assert.equal(main.some(r=>r.options.key==='conversation'),false);
  for(const entry of left)assert.equal(entry.component({size:20,active:true}).type,'svg');
  for(const entry of main){const wrapped=entry.component({});assert.equal(wrapped.type(wrapped.props).type,'section');}
  assert.doesNotMatch(clientSource,/sidebarRightTabs|sidebar\.right\.pane|ui-primitives/);
  for(const fn of cleanup.reverse())fn();
});
test('explicit null quote item timestamp stays unknown instead of inheriting an unrelated envelope time',async()=>{
  const h=setup({fetch:async url=>url.includes('/quotes')?reply(quotes(['601088'],{items:[{code:'601088',timestamp:null,last_price:10}]})):url.includes('/history')?reply(history()):reply(quant())});
  h.store.setCode('601088');await h.store.query();assert.equal(h.store.getSnapshot().quote.data.timestamp,null);h.store.dispose();
});
test('draft preparation receipt remains unsubmitted and UI tells the user to review and send',async()=>{
  const h=setup();h.store.setCode('601088');await h.store.analyze(async()=>({status:'draft_prepared',sessionId:'session-draft',submitted:false}));
  assert.equal(h.store.getSnapshot().analysis.data.status,'draft_prepared');assert.equal(h.store.getSnapshot().analysis.data.submitted,false);
  const texts=h.api.cockpitMessages();assert.match(texts.zh.analysisAccepted,/尚未调用模型/);assert.match(texts.en.analysisAccepted,/no model has been called/);assert.match(texts.zh.portableNote,/不再依赖原仓库/);h.store.dispose();
});
test('an index selection never mixes an A-share quote or candle with the same numeric code',async()=>{
  const h=setup();await h.store.query('000001','指数');
  assert.equal(h.requests.length,1);assert.match(h.requests[0].url,/quant\/probability/);assert.equal(h.store.getSnapshot().quote.error.key,'unsupported');assert.equal(h.store.getSnapshot().history.error.key,'unsupported');h.store.dispose();
});
test('responsive cockpit styles use theme tokens, not literal colors or a hidden replacement page',()=>{
  assert.doesNotMatch(css,/#(?:[0-9a-f]{3,8})\b|rgba?\(|hsla?\(/i);
  assert.match(css,/--dsw-alias-/);assert.match(css,/minmax\(0,1fr\)/);assert.match(css,/overflow-wrap:anywhere/);assert.match(css,/max-width:420px/);assert.doesNotMatch(clientSource,/iframe|document\.body/);
});
