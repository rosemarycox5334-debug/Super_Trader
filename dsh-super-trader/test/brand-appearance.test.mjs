import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=async name=>readFile(new URL(`../tools/${name}-source.js`,import.meta.url),'utf8');
const [client,cockpit,invest,bridge]=await Promise.all(['client','cockpit','invest','ai-bridge'].map(source));
const script=client.replace('/*__COCKPIT__*/',()=>cockpit).replace('/*__INVEST__*/',()=>invest)
  .replace('/*__BRIDGE__*/',()=>bridge).replace('/*__CSS__*/','""').replace('/*__HOST_TOKENS__*/ null','{}');
const mark='sidebar.brand.mark',name='sidebar.brand.name',hero='conversation.hero.brand.mark',row='settings.general.item';
const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useSyncExternalStore:(_sub,snapshot)=>snapshot()};
const tree=node=> !node||typeof node!=='object'?[]:typeof node.type==='function'?tree(node.type(node.props)):
  [node,...node.props.children.flat(Infinity).flatMap(tree)];

function setup(){
  const hostMark={name:mark,priority:0,view:()=>null},hostName={name,priority:0,view:()=>null};
  const entries=new Set([hostMark,hostName]), events=new Set(), layers=new Set(), storage=new Map(), sets=[],requests=[];
  let definition,cleanup=[],pref='dark',lang='zh',dicts={};
  vm.runInNewContext(script,{window:{__ModuleLoader__:{load:v=>{definition=v;}}},AbortController,AbortSignal,URLSearchParams,setTimeout,clearTimeout,
    localStorage:{getItem:key=>storage.get(key),setItem:(key,val)=>storage.set(key,val)},fetch:(url,init)=>{requests.push({url,init});return Promise.resolve();}});
  const plugin=definition.factory(()=>react);
  const ctx={layout:{selectPanel(){}},effect(fn){const off=fn();if(off)cleanup.push(off);},inject(_deps,fn){fn(ctx);},
    slots:{inject(_key,fn){return fn();},register(options,view){const entry={...options,view};entries.add(entry);return()=>entries.delete(entry);}},
    locale:{register(_ns,lang,d){dicts[lang]=d;},bind:()=>key=>dicts[lang][key],subscribe:()=>()=>{},getSnapshot:()=>lang},
    theme:{getTheme:()=>({active:{colorScheme:pref==='dark'?'dark':'light'},preference:pref}),setTheme(id){sets.push(id);pref=id;for(const notify of events)notify();},overrideTokens(id){assert.ok(!layers.has(id));layers.add(id);return()=>layers.delete(id);}},
    on(event,notify){assert.equal(event,'theme/change');events.add(notify);return()=>events.delete(notify);}};
  // A single slot keeps the LOWER priority occupant (confirmed against the live registry:
  // the host sits at 0, the skin at -1 and wins). Keep this order in the test harness too.
  const matching=key=>Array.from(entries).filter(e=>e.name===key).sort((a,b)=>(a.priority??0)-(b.priority??0));
  const active=key=>matching(key)[0];
  return {enable:()=>plugin.apply(ctx),disable:()=>cleanup.splice(0).reverse().forEach(fn=>fn()),active,matching,sets,requests,layers,events,hostMark,hostName,
    setLang:l=>{lang=l;}, clicks:()=>tree(active(row).view()).filter(n=>n.type==='button'),panel:()=>matching('main').find(e=>e.key==='dsh-super-trader-stock').view({})};
}

test('enabling owns one sidebar logo pair; unload and reload restore it without duplication',()=>{
  const h=setup();h.enable();
  const checkInstalled=()=>{
    assert.equal(h.matching(mark).length,2);assert.equal(h.matching(name).length,2);assert.equal(h.matching(hero).length,1);
    const icon=h.active(mark).view({size:24});assert.equal(icon.type,'svg');assert.equal(icon.props.width,24);assert.equal(icon.props.height,24);
    assert.equal(icon.props.role,'img');assert.equal(icon.props['aria-label'],'Super Trader');assert.equal(icon.props.onClick,undefined);
    assert.equal(h.active(mark).view,h.active(hero).view);assert.equal(h.active(hero).view({}).props.width,56);
    // The skin must sit below the host's priority to take the single seat; above it loses.
    for(const key of [mark,name])assert.ok((h.active(key).priority??0)<(key===mark?h.hostMark.priority:h.hostName.priority));
    for(const lang of ['en','zh']){h.setLang(lang);const label=h.active(name).view();assert.deepEqual(Array.from(label.props.children),['Super Trader']);assert.equal(label.props.onClick,undefined);}
    assert.equal(h.layers.size,1);
    // One settings row, and no second on/off switch beside it.
    assert.equal(h.clicks().filter(n=>n.props.className==='st-skin-switch').length,0);
  };
  const checkRemoved=()=>{assert.deepEqual(h.matching(mark),[h.hostMark]);assert.deepEqual(h.matching(name),[h.hostName]);assert.equal(h.matching(hero).length,0);assert.equal(h.layers.size,0);};
  checkInstalled();h.disable();checkRemoved();h.enable();checkInstalled();
  h.disable();checkRemoved();assert.equal(h.events.size,0);
  h.enable();checkInstalled();h.disable();checkRemoved();
});

test('appearance reads host preference, controls share it, and theme changes preserve panel/brand identities',()=>{
  const h=setup();h.enable();const panel=h.panel(),brand=h.active(mark),initial=panel.type(panel.props),investView=initial.props.children.at(-1).type;
  assert.deepEqual(h.sets,[]);assert.equal(initial.props['data-st-theme'],'dark');
  const setting=h.clicks().find(n=>n.props.children[0]==='浅色 · 机构研究简报');setting.props.onClick();
  const next=h.panel();assert.equal(next.type,panel.type);const updated=next.type(next.props);assert.equal(updated.props['data-st-theme'],'light');
  assert.equal(updated.props.children.at(-1).type,investView);assert.equal(h.active(mark),brand);
  // The panel header no longer carries a second appearance control; the settings row is the only one.
  const header=updated.props.children[1];assert.ok(!tree(header).some(n=>n.props&&n.props.className==='st-skin-seg'));
  h.clicks().find(n=>n.props.children[0]==='跟随系统').props.onClick();
  assert.equal(h.clicks().find(n=>n.props.children[0]==='跟随系统').props['aria-pressed'],true);
  assert.deepEqual(h.sets,['light','system']);assert.ok(h.requests.every(r=>r.url==='/dsh-super-trader/appearance'&&r.init.method==='POST'));
  h.disable();h.enable();assert.deepEqual(h.sets,['light','system']);assert.equal(h.clicks().find(n=>n.props.children[0]==='跟随系统').props['aria-pressed'],true);h.disable();
});

test('both product dictionaries and client-authored error messages omit the old brand',()=>{
  const [legacy,workflow]=vm.runInNewContext(cockpit+'\n'+invest+'\n[cockpitMessages(),investMessages()]');
  for(const dict of [legacy,workflow]){
    for(const lang of ['zh','en'])for(const [key,copy] of Object.entries(dict[lang]))assert.doesNotMatch(copy,/\bDSH\b/,`${lang}.${key}`);
    assert.equal(dict.zh.backChat,'返回 Super Trader 对话');assert.equal(dict.en.backChat,'Back to Super Trader chat');
  }
  assert.equal(workflow.zh.draft,'带入 Super Trader 草稿');assert.equal(workflow.en.draft,'Prepare Super Trader draft');
  // Catch authored fallback errors outside the dictionaries; lowercase package IDs and routes remain unchanged.
  for(const file of [cockpit,invest,bridge])assert.doesNotMatch(file,/['"`][^'"`\n]*\bDSH\b[^'"`\n]*['"`]/);
});
