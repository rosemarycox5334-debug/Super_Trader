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
    // Token pairs {name:{light,dark}} generated from assets/design-tokens.json at build time.
    // null in the raw template (tests, unbuilt source): the shell skin then stays off.
    const ST_HOST_TOKENS=/*__HOST_TOKENS__*/ null;
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
    // ---- Appearance: the host owns the light/dark/system preference ("theme" service).
    // This plugin only reads it, layers design tokens over it (removable) and exposes a
    // control that writes through the host's own setTheme. No second source of truth.
    // The shell palette is layered on the theme service's token layer whenever the plugin
    // is enabled; these are the ONLY global selectors it adds (selection colour, scrollbars,
    // our own settings row, hero mark).
    const SKIN_CSS=[
      'html[data-st-skin] ::selection{background:var(--st-accent-soft);color:var(--st-ink)}',
      'html[data-st-skin],html[data-st-skin] *{scrollbar-color:var(--st-rule2) transparent}',
      '.st-skin-row{display:flex;flex-direction:column;gap:12px;padding:14px 0;border-top:1px solid var(--st-rule,var(--dsw-alias-border-l1));color:var(--st-ink,var(--dsw-alias-label-primary));font:inherit}',
      '.st-skin-row *{box-sizing:border-box}',
      '.st-skin-line{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}',
      '.st-skin-title{font-weight:600}',
      '.st-skin-hint{margin:2px 0 0;font-size:12px;color:var(--st-ink2,var(--dsw-alias-label-secondary));max-width:56ch}',
      '.st-skin-seg{display:inline-flex;border:1px solid var(--st-rule2,var(--dsw-alias-border-l2));border-radius:var(--st-radius,6px);overflow:hidden}',
      '.st-skin-seg button{font:inherit;font-size:12px;padding:6px 11px;border:0;border-left:1px solid var(--st-rule2,var(--dsw-alias-border-l2));background:transparent;color:var(--st-ink,var(--dsw-alias-label-primary));cursor:pointer;white-space:nowrap}',
      '.st-skin-seg button:first-child{border-left:0}',
      '.st-skin-seg button[aria-pressed="true"]{background:var(--st-accent,var(--dsw-alias-brand-primary));color:var(--st-accent-ink,var(--dsw-alias-bg-base));font-weight:600}',
      '.st-skin-seg button:focus-visible{outline:2px solid var(--st-accent,var(--dsw-alias-brand-primary));outline-offset:2px}',
      '@media (prefers-reduced-motion:reduce){.st-skin-row *{transition:none!important}}'
    ].join('\n');
    function appearanceMessages() {
      return {
        zh:{appearanceTitle:'Super Trader 研究外观',appearanceHint:'与上方「外观」同一个设置：浅色为「机构研究简报」，深色为「量化交易台」，跟随系统时随操作系统切换。',appearanceSystem:'跟随系统',appearanceLight:'浅色 · 机构研究简报',appearanceDark:'深色 · 量化交易台',appearanceNow:'当前',appearanceGroup:'外观',quickLight:'浅色',quickDark:'深色',quickSystem:'系统'},
        en:{appearanceTitle:'Super Trader appearance',appearanceHint:'Same setting as Appearance above: light is “Institutional Research Brief”, dark is “Quant Desk”, and System follows the operating system.',appearanceSystem:'Follow system',appearanceLight:'Light · Institutional Research Brief',appearanceDark:'Dark · Quant desk',appearanceNow:'Current',appearanceGroup:'Appearance',quickLight:'Light',quickDark:'Dark',quickSystem:'System'}
      };
    }
    function systemScheme() {
      try{return typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}catch{return 'light';}
    }
    // The host theme snapshot is the authority for the effective scheme; the OS media query
    // is only the fallback when the theme service is absent (older host, tests).
    function createAppearance() {
      let service=null,listeners=new Set();
      let state={scheme:systemScheme(),preference:'system',themed:false};
      const publish=patch=>{
        const next={...state,...patch};
        if(Object.keys(patch).every(key=>next[key]===state[key]))return;
        state=next;for(const fn of [...listeners])fn();
      };
      const read=()=>{
        if(!service)return {scheme:systemScheme(),preference:'system',themed:false};
        try{
          const snap=service.getTheme();
          const scheme=snap?.active?.colorScheme==='dark'?'dark':snap?.active?.colorScheme==='light'?'light':systemScheme();
          const preference=['system','light','dark'].includes(snap?.preference)?snap.preference:'system';
          return {scheme,preference,themed:true};
        }catch{return {scheme:systemScheme(),preference:'system',themed:false};}
      };
      return {
        subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
        getSnapshot(){return state;},
        attach(theme){service=theme;publish(read());return()=>{if(service===theme){service=null;publish(read());}};},
        sync(){publish(read());},
        setPreference(id){if(service&&['system','light','dark'].includes(id)){try{service.setTheme(id);}catch{}}}
      };
    }
    // One settings row. There is no second switch: enabling the plugin is what applies the
    // shell palette, and disabling it restores the host appearance.
    function AppearanceControl({appearance,t,compact}) {
      const state=React.useSyncExternalStore(appearance.subscribe,appearance.getSnapshot,appearance.getSnapshot);
      if(!state.themed)return null;
      const options=[['system',compact?'quickSystem':'appearanceSystem'],['light',compact?'quickLight':'appearanceLight'],['dark',compact?'quickDark':'appearanceDark']];
      return h('div',{className:'st-skin-seg',role:'group','aria-label':t('appearanceGroup')},...options.map(([id,key])=>h('button',{key:id,type:'button','aria-pressed':state.preference===id,onClick:()=>appearance.setPreference(id)},t(key))));
    }
    function createAppearanceRow(appearance,t) {
      return function AppearanceRow() {
        const state=React.useSyncExternalStore(appearance.subscribe,appearance.getSnapshot,appearance.getSnapshot);
        return h('div',{className:'st-skin-row','data-st-theme':state.scheme,'data-st-row':'appearance'},
          h('div',{className:'st-skin-line'},
            h('div',null,h('div',{className:'st-skin-title'},t('appearanceTitle')),h('p',{className:'st-skin-hint'},t('appearanceHint'))),
            h(AppearanceControl,{appearance,t,compact:false})));
      };
    }
    const brandName='Super Trader';
    function SidebarBrandName() {return h('span',null,brandName);}
    function HeroMark({size=56}={}) {
      return h('svg',{width:size,height:size,viewBox:'0 0 48 48',fill:'none',role:'img','aria-label':brandName,style:{color:'var(--st-accent,var(--dsw-alias-brand-primary))'}},
        h('rect',{x:4,y:4,width:40,height:40,rx:6,stroke:'currentColor',strokeWidth:1.6}),
        h('path',{d:'M11 33l8-8 6 4 12-14',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round'}),
        h('path',{d:'M11 38h26',stroke:'currentColor',strokeWidth:1,opacity:.5}));
    }
    function postReportPreference(preference) {
      if(typeof fetch!=='function')return;
      try{
        const sent=fetch('/dsh-super-trader/appearance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({preference})});
        if(sent&&typeof sent.catch==='function')sent.catch(()=>{});
      }catch{}
    }
    // Runs only when the host provides the theme service. Everything it installs is owned by
    // `scope.effect`, so unloading the plugin (or the service) restores the host appearance.
    function installThemeSkin(scope,appearance,t) {
      const theme=scope.theme;
      if(!theme)return;
      scope.effect(()=>appearance.attach(theme),'super-trader: attach host theme');
      scope.effect(()=>scope.on('theme/change',()=>appearance.sync()),'super-trader: follow host theme');
      // Token layer + shell hooks are installed once while the plugin is enabled; the layer is
      // re-created only for a light/dark flip of the shell attribute, never for a theme flip
      // (the host recomposes the tokens itself).
      scope.effect(()=>{
        let registrations=[],shown=null;
        const clear=()=>{for(const dispose of registrations.splice(0).reverse())dispose();};
        const root=typeof document!=='undefined'?document.documentElement:null;
        // The settings-row stylesheet is needed with or without the skin.
        let tag;
        if(typeof document!=='undefined'&&document.head){
          tag=document.createElement('style');
          tag.dataset.plugin='dsh-super-trader';tag.dataset.shellVisibility='appearance-skin';
          tag.textContent=SKIN_CSS;document.head.appendChild(tag);
        }
        const update=()=>{
          const {scheme}=appearance.getSnapshot();
          const want=!!ST_HOST_TOKENS;
          if(root){if(want)root.setAttribute('data-st-skin',scheme);else root.removeAttribute('data-st-skin');}
          if(want===shown)return;
          shown=want;
          clear();
          if(!want)return;
          // Skin owns the occupants, not the sidebar button, its navigation, or its shortcuts.
          // A single slot keeps the lower priority: the live registry shows the host at 0
          // owning the seat, so the skin must register below it to take the seat.
          try {
            registrations.push(theme.overrideTokens('dsh-super-trader',ST_HOST_TOKENS));
            for(const [name,view,priority] of [['conversation.hero.brand.mark',HeroMark,0],['sidebar.brand.mark',HeroMark,-1],['sidebar.brand.name',SidebarBrandName,-1]]) {
              registrations.push(scope.slots.inject(name,()=>scope.slots.register({name,priority},view)));
            }
          } catch(error) {clear();root?.removeAttribute('data-st-skin');shown=null;throw error;}
        };
        const off=appearance.subscribe(update);
        const teardown=()=>{off();clear();tag?.remove();root?.removeAttribute('data-st-skin');};
        try{update();}catch(error){teardown();throw error;}
        return teardown;
      },'super-trader: shell skin tokens');
      scope.effect(()=>scope.slots.inject('settings.general.item',()=>scope.slots.register({name:'settings.general.item',id:'super-trader-appearance',order:10.5,locale:'superTrader',inject:()=>({})},createAppearanceRow(appearance,t))),'super-trader: appearance row');
      // Legacy report links carry no theme parameter: tell the Host which preference is active.
      scope.effect(()=>{
        let last;
        const push=()=>{const {preference}=appearance.getSnapshot();if(preference!==last){last=preference;postReportPreference(preference);}};
        push();
        return appearance.subscribe(push);
      },'super-trader: report appearance sync');
    }
    const oldMessages=cockpitMessages(),messages=investMessages(),appearanceText=appearanceMessages();
    const dicts=Object.fromEntries(Object.keys(messages).map(lang=>[lang,{...oldMessages[lang],...messages[lang],...appearanceText[lang]}]));
    function apply(ctx) {
      const panelIds={screen:'dsh-super-trader',stock:'dsh-super-trader-stock',sectors:'dsh-super-trader-sectors',factors:'dsh-super-trader-factors',experts:'dsh-super-trader-experts',watchlist:'dsh-super-trader-watchlist',review:'dsh-super-trader-review',journal:'dsh-super-trader-journal',settings:'dsh-super-trader-settings'};
      // Archived Sessions disappear from the visible Session list; the review entry uses
      // that fact to ask for a fresh conversation instead of reopening a dead identity.
      const sessionOpenable=sessionId=>{
        try{const snapshot=ctx.get?.('sessions')?.list?.getSnapshot?.();return !!snapshot?.byId?.[sessionId];}catch{return true;}
      };
      const store=createInvestStore({onNavigate:tab=>ctx.layout.selectPanel(panelIds[tab]),sessionOpenable});
      // The preserved store is explicitly initialized, and subscribed only in legacy tabs.
      const oldStore=createCockpitStore();
      const {Journal,Settings}=createCockpitComponents(React,oldStore);
      const {Invest}=createInvestComponents(React,store);
      const locale=ctx.locale;
      for(const [lang,dict] of Object.entries(dicts))ctx.effect(()=>locale.register('superTrader',lang,dict));
      ctx.effect(()=>installHiddenShell(),'super-trader: hidden host panels');
      const t=locale.bind('superTrader');
      const appearance=createAppearance();
      // Components read the effective scheme from the store: a flip re-renders, never remounts.
      store.setScheme(appearance.getSnapshot().scheme);
      ctx.effect(()=>appearance.subscribe(()=>store.setScheme(appearance.getSnapshot().scheme)),'super-trader: scheme to panels');
      if(typeof ctx.inject==='function')ctx.inject(['theme'],scope=>installThemeSkin(scope,appearance,t));
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
        const look=React.useSyncExternalStore(appearance.subscribe,appearance.getSnapshot,appearance.getSnapshot);
        const tab=props.initialTab || 'screen';
        const onAnalyze=createAnalysisBridge(ctx,props);
        const onOpenExpertSession=createExpertSessionBridge(ctx);
        return h('section',{className:'st-native-panel','aria-label':t(tab),'data-st-theme':look.scheme,'data-st-tab':tab},h('style',null,CSS),
          tab==='review'&&state.connection.ready?null:h('div',{className:'st-native-top'},h('div',{className:'st-native-status',role:'status','data-ready':state.connection.ready?'true':'false'},t(state.connection.ready?'connected':'offline')),h('div',{className:'st-native-modes'},h('button',{type:'button',onClick:()=>ctx.layout.selectPanel(null)},t('backChat')),!state.connection.ready?h('button',{type:'button',onClick:()=>store.retryConnection()},t('retryStart')):null)),
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
