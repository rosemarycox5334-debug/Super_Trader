// Build input: declaration-only investment workflow + preserved advanced pages.
window.__ModuleLoader__.load({
  id:'dsh-super-trader',
  factory(require) {
    const React=require('react');
    const h=React.createElement;
    /*__PAGES__*/
    /*__COCKPIT__*/
    /*__BRIDGE__*/
    /*__INVEST__*/
    const CSS=/*__CSS__*/;
    // Super Trader turns the Web shell into an investment workstation. These
    // host rows are not part of that workflow; the style is installed globally
    // so every machine that installs the bundle gets the same sidebar.
    const HIDDEN_SHELL_CSS=[
      'nav[aria-label="全局面板"] button[aria-label="插件"],nav[aria-label="Global panels"] button[aria-label="Plugins"]',
      'button[aria-label="插件"],button[aria-label="Plugins"]',
      'nav[aria-label="全局面板"] button[aria-label="数据与设置"],nav[aria-label="Global panels"] button[aria-label="Data & Settings"]',
      'nav[aria-label="全局面板"] button[aria-label="Data and settings"],nav[aria-label="Global panels"] button[aria-label="Data and settings"]',
      'nav[aria-label="全局面板"] button[aria-haspopup="menu"],nav[aria-label="Global panels"] button[aria-haspopup="menu"]'
    ].map(selector=>selector+'{display:none!important}').join('\n');
    function installHiddenShell(){
      if(typeof document==='undefined'||!document.head)return;
      const tag=document.createElement('style');
      tag.dataset.plugin='dsh-super-trader';
      tag.dataset.shellVisibility='hidden-investment-shell';
      tag.textContent=HIDDEN_SHELL_CSS;
      document.head.appendChild(tag);
      return ()=>tag.remove();
    }
    const oldMessages=cockpitMessages(),messages=investMessages();
    const dicts=Object.fromEntries(Object.keys(messages).map(lang=>[lang,{...oldMessages[lang],...messages[lang]}]));
    function apply(ctx) {
      const panelIds={screen:'dsh-super-trader',stock:'dsh-super-trader-stock',sectors:'dsh-super-trader-sectors',factors:'dsh-super-trader-factors',experts:'dsh-super-trader-experts',watchlist:'dsh-super-trader-watchlist',review:'dsh-super-trader-review',journal:'dsh-super-trader-journal',settings:'dsh-super-trader-settings'};
      const store=createInvestStore({onNavigate:tab=>ctx.layout.selectPanel(panelIds[tab])});
      // The preserved store is explicitly initialized, and subscribed only in legacy tabs.
      const oldStore=createCockpitStore();
      const {Journal,Settings}=createCockpitComponents(React,oldStore);
      const {Invest}=createInvestComponents(React,store);
      const locale=ctx.locale;
      for(const [lang,dict] of Object.entries(dicts))ctx.effect(()=>locale.register('superTrader',lang,dict));
      ctx.effect(()=>installHiddenShell(),'super-trader: hidden host panels');
      const t=locale.bind('superTrader');
      ctx.effect(()=>()=>{store.dispose();oldStore.dispose();});
      function Legacy({tab,advanced}) {
        const state=React.useSyncExternalStore(oldStore.subscribe,oldStore.getSnapshot,oldStore.getSnapshot);
        const ref=React.useRef(null);
        React.useEffect(()=>{oldStore.setTab(advanced?'advanced-'+advanced:tab);},[tab,advanced]);
        React.useEffect(()=>{
          if(!advanced||!state.connection.ready||!ref.current)return;
          const stop=new AbortController(),pages=createPages({root:ref.current,baseUrl:state.connection.apiBase,signal:stop.signal,t});
          void pages.navigate(advanced);
          return()=>{stop.abort();pages.dispose();};
        },[advanced,state.connection.ready,state.connection.apiBase]);
        return advanced?h(React.Fragment,null,h('p',{className:'st-advanced-note'},t('advancedNote')),h('div',{ref,className:'st-advanced-host',hidden:!state.connection.ready}),!state.connection.ready?h('p',null,t('offline')):null):tab==='journal'?h(Journal,{t}):h(Settings,{t});
      }
      function Panel(props) {
        React.useSyncExternalStore(fn=>locale.subscribe(fn),()=>locale.getSnapshot());
        const state=React.useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
        const tab=props.initialTab || 'screen';
        const onAnalyze=createAnalysisBridge(ctx,props);
        const onOpenExpertSession=createExpertSessionBridge(ctx);
        return h('section',{className:'st-native-panel','aria-label':t(tab)},h('style',null,CSS),
          h('div',{className:'st-native-top'},h('div',{className:'st-native-status',role:'status','data-ready':state.connection.ready?'true':'false'},t(state.connection.ready?'connected':'offline')),h('div',{className:'st-native-modes'},h('button',{type:'button',onClick:()=>ctx.layout.selectPanel(null)},t('backChat')),!state.connection.ready?h('button',{type:'button',onClick:()=>store.retryConnection()},t('retryStart')):null)),
          state.connection.error?h('p',{className:'st-native-error',role:'alert'},t(state.connection.error.key)+': '+state.connection.error.detail):null,
          ['journal','settings'].includes(tab)?h(Legacy,{tab}):h(Invest,{tab,t,onAnalyze,onOpenExpertSession}));
      }
      function icon(path) {return function Icon(props) {return h('svg',{width:props.size || 20,height:props.size || 20,viewBox:'0 0 24 24',fill:'none','aria-hidden':'true'},h('path',{d:path,stroke:'currentColor',strokeWidth:props.active?1.9:1.6,strokeLinecap:'round',strokeLinejoin:'round'}));};}
      const entries=[
        {tab:'screen',order:30,Icon:icon('M4 4h16v3l-6 6v6l-4 2v-8L4 7Z')},
        {tab:'stock',order:31,Icon:props=>superTraderIcon(React,props)},
        {tab:'sectors',order:32,Icon:icon('M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z')},
        {tab:'factors',order:33,Icon:icon('M4 20V5M4 20h16M8 16v-4M12 16V8M16 16V5M7 7l5-3 5 2')},
        {tab:'experts',order:34,Icon:icon('M8 21v-4a4 4 0 0 1 8 0v4M9 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM3 19v-4a3 3 0 0 1 4-3M21 19v-4a3 3 0 0 0-4-3M4 5a2 2 0 1 0 0 4M20 5a2 2 0 1 1 0 4')},
        {tab:'watchlist',order:35,Icon:icon('m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6L3.2 9.4l6.1-.9Z')},
        {tab:'review',order:36,Icon:icon('M4 4h16v13H8l-4 4ZM8 9h8M8 13h5')}
      ];
      for(const entry of entries) {
        const id=panelIds[entry.tab];
        ctx.effect(()=>ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id,order:entry.order,label:()=>t(entry.tab)},entry.Icon)));
        ctx.effect(()=>ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:id},props=>h(Panel,{...props,initialTab:entry.tab}))));
      }
    }
    return {name:'super-trader',inject:['slots','locale','layout'],apply};
  }
});
