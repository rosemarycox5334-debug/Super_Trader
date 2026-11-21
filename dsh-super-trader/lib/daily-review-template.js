// Pure daily preview projection and HTML export; inlined into the client build.
function investDailyReviewRows(value) {
  return Array.isArray(value)?value.filter(row=>row&&typeof row==='object'):[];
}
function investDailyReviewText(...values) {
  return values.find(value=>typeof value==='string'&&value.trim())?.trim()??'';
}
function investDailyReviewNumber(value) {
  return typeof value==='number'&&Number.isFinite(value)?value:null;
}
function investDailyReviewStamp(date) {
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const stamp=Date.parse(date+'T00:00:00Z');
  return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===date?stamp:null;
}
function investDailyReviewEventDate(value) {
  if(investDailyReviewStamp(value)!==null)return value;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||investDailyReviewStamp(value.slice(0,10))===null)return null;
  const stamp=Date.parse(value);
  // The ledger is dated in Shanghai market time (UTC+08:00 for its modern dates).
  return Number.isFinite(stamp)?new Date(stamp+8*60*60*1000).toISOString().slice(0,10):null;
}
function investDailyReviewRatio(value,base) {
  return value!==null&&base>0?investDailyReviewNumber(value/base-1):null;
}
function investDailyReviewReport(date, portfolios, details, {partial=false,historical=partial}={}) {
  const cutoff=investDailyReviewStamp(date), dates=new Map(), books=new Map();
  const counts={experts:0,triggered:0,queued:0,buys:0,sells:0,pending:0,unverified:0,selected:0};
  const result={date:cutoff===null?null:date,experts:[],counts,partial:!!(partial||historical),historical:!!historical,signals:[]};
  if(cutoff===null)return result;
  const expert=(id,name,initial=null)=>{
    if(!books.has(id))books.set(id,{id,name:name||id,initial,curve:new Map(),plans:[],queued:[],buys:[],sells:[]});
    return books.get(id);
  };
  const security=(row,target)=>{
    const code=investDailyReviewText(row.code,target?.code);
    return {code,name:investDailyReviewText(row.name,target?.name)||code};
  };
  const positivePrice=value=>investDailyReviewNumber(value)>0?value:null;
  const bookIds=new Set();
  for(const row of investDailyReviewRows(portfolios?.items)){
    const id=investDailyReviewText(row.expert_id);
    if(!id||bookIds.has(id))continue;
    bookIds.add(id);
    const book=expert(id,investDailyReviewText(row.expert_name),investDailyReviewNumber(row.initial_cash??portfolios.initial_cash));
    for(const point of investDailyReviewRows(row.curve)){
      const stamp=investDailyReviewStamp(point.date);
      if(stamp===null||stamp>cutoff)continue;
      const rawNav=investDailyReviewNumber(point.nav), nav=rawNav!==null&&rawNav>=0?rawNav:null;
      const value=nav===null?null:(investDailyReviewNumber(point.return)??investDailyReviewRatio(nav,book.initial));
      dates.set(stamp,point.date);
      book.curve.set(stamp,{nav,value,warnings:Array.isArray(point.warnings)?point.warnings.map(item=>investDailyReviewText(item)).filter(Boolean):[]});
    }
    if(!historical){
      const seen=new Set();
      for(const order of investDailyReviewRows(row.pending)){
        if(order.status!=='queued'||investDailyReviewEventDate(order.queued_at)!==date||!['buy','sell'].includes(order.side))continue;
        const item=security(order), orderId=investDailyReviewText(order.id);
        if(!item.code||(orderId&&seen.has(orderId)))continue;
        if(orderId)seen.add(orderId);
        book.queued.push({...item,side:order.side,reason:investDailyReviewText(order.reason)});
      }
    }
    // The same position may be returned open or closed; its dated entry is a
    // ledger fact in either case. Never use a closed position's exit reason as its entry reason.
    const entries=new Set(), exits=new Set();
    for(const [rows,closed] of [[row.closed,true],[row.positions,false]])for(const position of investDailyReviewRows(rows)){
      const item=security(position);
      if(!item.code)continue;
      const positionId=investDailyReviewText(position.id,position.plan_id);
      const entryDate=investDailyReviewEventDate(position.entry_date), exitDate=investDailyReviewEventDate(position.exit_date);
      if(entryDate===date&&(!positionId||!entries.has(positionId))){
        if(positionId)entries.add(positionId);
        book.buys.push({...item,price:positivePrice(position.entry_price),reason:investDailyReviewText(position.entry_reason,closed?'':position.reason)});
      }
      const exitId=investDailyReviewText(position.exit_order_id)||positionId;
      if(exitDate===date&&(!entryDate||entryDate<=date)&&(!exitId||!exits.has(exitId))){
        if(exitId)exits.add(exitId);
        book.sells.push({...item,price:positivePrice(position.exit_price),reason:investDailyReviewText(position.exit_reason,closed?position.reason:'')});
      }
    }
  }
  const seenPlans=new Set(), seenSignals=new Set(), unresolved=['pending','needs_ai','ambiguous','unavailable'];
  for(const detail of investDailyReviewRows(details))for(const target of investDailyReviewRows(detail.targets))for(const plan of investDailyReviewRows(target.plans)){
    const id=investDailyReviewText(plan.expert_id), item=security(plan,target);
    const selected=investDailyReviewEventDate(plan.selected_at);
    if(!id||!item.code||(selected&&selected>date))continue;
    const metrics=plan.metrics??{}, metricDate=investDailyReviewEventDate(metrics.as_of);
    const triggerDate=investDailyReviewEventDate(metrics.trigger?.date??metrics.base_date);
    const recordedDates=[metrics.observed_at,metrics.ai?.judged_on,metrics.ai?.judged_at].map(investDailyReviewEventDate);
    const notYetRecorded=recordedDates.some(day=>day&&day>date);
    const sameDayStatus=metricDate===date&&!notYetRecorded&&!historical;
    const reviewId=investDailyReviewText(detail.id,detail.review_id,plan.review_id), planId=investDailyReviewText(plan.plan_id);
    // Signals stay in the tracking table after their trigger day, while still
    // only using the evidence dated on or before this report's cutoff.
    if(metrics.status==='triggered'&&triggerDate!==null&&triggerDate<=date&&metricDate===date&&!notYetRecorded){
      const signalKey=planId?JSON.stringify(['signal',reviewId,planId]):null;
      if(!signalKey||!seenSignals.has(signalKey)){
        if(signalKey)seenSignals.add(signalKey);
        const windows={};
        for(const name of ['1d','3d','5d','10d','20d']){
          const value=investDailyReviewNumber(metrics.windows?.[name]);
          if(value!==null)windows[name]=value;
        }
        // Return since a trigger is measured from the condition price that was hit,
        // not from that day's close: marking at the close would report exactly 0.
        result.signals.push({...item,expertId:id,expertName:investDailyReviewText(plan.expert_name,id),
          triggerDate,triggerPrice:positivePrice(plan.entry_price??metrics.trigger?.price??metrics.base_price),
          triggerClose:positivePrice(metrics.base_price??metrics.trigger?.price),
          current:investDailyReviewNumber(metrics.current),
          maxDrawdown:investDailyReviewNumber(metrics.max_drawdown),
          windows,reviewId,planId});
      }
    }
    let status;
    if(metrics.status==='triggered'&&triggerDate===date&&!notYetRecorded)status='triggered';
    else if(sameDayStatus&&unresolved.includes(metrics.status))status=metrics.status;
    else if(selected===date)status='selected';
    else continue;
    const key=planId&&JSON.stringify([reviewId,planId]);
    if(key&&seenPlans.has(key))continue;
    if(key)seenPlans.add(key);
    const entry=positivePrice(plan.entry_price), direction=plan.entry_direction==='above'?'≥':plan.entry_direction==='below'?'≤':'';
    const reason=investDailyReviewText(plan.reason,plan.why_fit,(status!=='selected'&&metricDate===date&&!notYetRecorded)?metrics.reason:'');
    expert(id,investDailyReviewText(plan.expert_name)).plans.push({...item,status,reason,
      condition:investDailyReviewText(plan.entry_note)||(entry!==null&&direction?`${direction} ${entry}`:''),reviewId,planId});
    counts[status==='triggered'||status==='pending'||status==='selected'?status:'unverified']++;
  }
  const axis=[...dates].sort(([a],[b])=>a-b), last=axis.at(-1), previous=axis.at(-2);
  for(const book of books.values()){
    const current=book.curve.get(last?.[0]), prior=book.curve.get(previous?.[0]);
    const nav=current?.nav??null;
    let drawdown=null, peak=book.initial>0?book.initial:null;
    const points=axis.map(([stamp,day])=>{
      const point=book.curve.get(stamp), pointNav=point?.nav??null;
      if(pointNav!==null){
        peak=Math.max(peak??0,pointNav);
        const ratio=investDailyReviewRatio(pointNav,peak);
        if(ratio!==null)drawdown=Math.min(drawdown??0,ratio);
      }
      return {date:day,stamp,value:point?.value??null,nav:pointNav};
    });
    const {id,name,plans,queued,buys,sells}=book;
    result.experts.push({id,name,initial:book.initial,nav,navDate:nav===null?null:last[1],
      dayReturn:last?.[0]===cutoff?investDailyReviewRatio(nav,prior?.nav??null):null,
      totalReturn:current?.value??null,drawdown,points,plans,queued,buys,sells,
      warnings:[...new Set(current?.warnings??[])]});
    for(const type of ['queued','buys','sells'])counts[type]+=book[type].length;
  }
  counts.experts=result.experts.length;
  // Equal-weight tracking of triggered plans; a window stays absent until it matures.
  const average=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
  const windows={};
  for(const name of ['1d','3d','5d','10d','20d']){
    const value=average(result.signals.map(signal=>investDailyReviewNumber(signal.windows?.[name])).filter(v=>v!==null));
    if(value!==null)windows[name]=Math.round(value*1e6)/1e6;
  }
  const current=average(result.signals.map(signal=>signal.current).filter(v=>v!==null));
  const drawdown=average(result.signals.map(signal=>signal.maxDrawdown).filter(v=>v!==null));
  result.signalSummary={count:result.signals.length,current:current===null?null:Math.round(current*1e6)/1e6,
    maxDrawdown:drawdown===null?null:Math.round(drawdown*1e6)/1e6,windows};
  result.capital=investDailyReviewNumber(portfolios?.initial_cash)
    ?? (result.experts.length&&result.experts.every(expert=>expert.initial!==null)?result.experts[0].initial:null);
  return result;
}

// Design tokens (both palettes) are injected at build time from assets/design-tokens.json.
const INVEST_DAILY_REPORT_TOKEN_CSS="body{--st-paper:#F6F7F9;--st-surface:#FFFFFF;--st-sunken:#EFF1F4;--st-raised:#FFFFFF;--st-sidebar:#F1F3F5;--st-ink:#181C23;--st-ink2:#505B68;--st-rule:#DDE1E6;--st-rule2:#B7BFC9;--st-chapter-rule:#C1AA7F;--st-grid:rgba(32,45,64,0.07);--st-accent:#173955;--st-accent-ink:#FFFFFF;--st-accent-soft:#E8EEF4;--st-up:#B42318;--st-up-soft:#F8E6E2;--st-down:#0B7244;--st-down-soft:#E0F1E8;--st-flat:#5E6677;--st-error:#8E1A6B;--st-error-soft:#F5E3EE;--st-warn:#855400;--st-warn-soft:#F6EBD0;--st-shadow:0 2px 8px rgba(26,40,53,0.055);--st-radius:6px;--st-radius-lg:8px;--st-s1:#173955;--st-s2:#A3341F;--st-s3:#0E7A4B;--st-s4:#7A4B9C;--st-s5:#8A6A00;--st-s6:#B0285A;--st-s7:#2F6B7C;--st-s8:#5A5F52;--st-font-ui:\"Microsoft YaHei UI\",\"Microsoft YaHei\",\"PingFang SC\",\"Segoe UI\",system-ui,sans-serif;--st-font-display:Bahnschrift,\"Microsoft YaHei UI\",\"Segoe UI\",system-ui,sans-serif;--st-font-num:\"Cascadia Mono\",\"SFMono-Regular\",Consolas,\"Liberation Mono\",monospace}\nbody.theme-dark{--st-paper:#0A0E13;--st-surface:#10161E;--st-sunken:#0D1218;--st-raised:#18212E;--st-sidebar:#0D1218;--st-ink:#E4EAF2;--st-ink2:#9AA8BB;--st-rule:#1F2937;--st-rule2:#2E3C52;--st-chapter-rule:#2E3C52;--st-grid:rgba(154,168,187,0.07);--st-accent:#5BA7F7;--st-accent-ink:#06101C;--st-accent-soft:#14263D;--st-up:#FF7468;--st-up-soft:#2B1618;--st-down:#34D399;--st-down-soft:#0F2A22;--st-flat:#8896AA;--st-error:#F472B6;--st-error-soft:#2C1426;--st-warn:#E8B04A;--st-warn-soft:#2A2111;--st-shadow:none;--st-radius:2px;--st-radius-lg:3px;--st-s1:#5BA7F7;--st-s2:#FF8A7A;--st-s3:#34D399;--st-s4:#B79CF2;--st-s5:#E8B04A;--st-s6:#F472B6;--st-s7:#5CC8D6;--st-s8:#A3B18A;--st-font-ui:\"Segoe UI Variable\",\"Segoe UI\",\"Microsoft YaHei UI\",\"Microsoft YaHei\",system-ui,sans-serif;--st-font-display:\"Segoe UI Variable Display\",\"Segoe UI\",\"Microsoft YaHei UI\",\"Microsoft YaHei\",system-ui,sans-serif;--st-font-num:\"Cascadia Mono\",\"SFMono-Regular\",Consolas,\"Liberation Mono\",monospace}\n@media (prefers-color-scheme:dark){body.theme-auto{--st-paper:#0A0E13;--st-surface:#10161E;--st-sunken:#0D1218;--st-raised:#18212E;--st-sidebar:#0D1218;--st-ink:#E4EAF2;--st-ink2:#9AA8BB;--st-rule:#1F2937;--st-rule2:#2E3C52;--st-chapter-rule:#2E3C52;--st-grid:rgba(154,168,187,0.07);--st-accent:#5BA7F7;--st-accent-ink:#06101C;--st-accent-soft:#14263D;--st-up:#FF7468;--st-up-soft:#2B1618;--st-down:#34D399;--st-down-soft:#0F2A22;--st-flat:#8896AA;--st-error:#F472B6;--st-error-soft:#2C1426;--st-warn:#E8B04A;--st-warn-soft:#2A2111;--st-shadow:none;--st-radius:2px;--st-radius-lg:3px;--st-s1:#5BA7F7;--st-s2:#FF8A7A;--st-s3:#34D399;--st-s4:#B79CF2;--st-s5:#E8B04A;--st-s6:#F472B6;--st-s7:#5CC8D6;--st-s8:#A3B18A;--st-font-ui:\"Segoe UI Variable\",\"Segoe UI\",\"Microsoft YaHei UI\",\"Microsoft YaHei\",system-ui,sans-serif;--st-font-display:\"Segoe UI Variable Display\",\"Segoe UI\",\"Microsoft YaHei UI\",\"Microsoft YaHei\",system-ui,sans-serif;--st-font-num:\"Cascadia Mono\",\"SFMono-Regular\",Consolas,\"Liberation Mono\",monospace}}\n@media print{body,body.theme-dark,body.theme-auto{--st-paper:#F6F7F9;--st-surface:#FFFFFF;--st-sunken:#EFF1F4;--st-raised:#FFFFFF;--st-sidebar:#F1F3F5;--st-ink:#181C23;--st-ink2:#505B68;--st-rule:#DDE1E6;--st-rule2:#B7BFC9;--st-chapter-rule:#C1AA7F;--st-grid:rgba(32,45,64,0.07);--st-accent:#173955;--st-accent-ink:#FFFFFF;--st-accent-soft:#E8EEF4;--st-up:#B42318;--st-up-soft:#F8E6E2;--st-down:#0B7244;--st-down-soft:#E0F1E8;--st-flat:#5E6677;--st-error:#8E1A6B;--st-error-soft:#F5E3EE;--st-warn:#855400;--st-warn-soft:#F6EBD0;--st-shadow:0 2px 8px rgba(26,40,53,0.055);--st-radius:6px;--st-radius-lg:8px;--st-s1:#173955;--st-s2:#A3341F;--st-s3:#0E7A4B;--st-s4:#7A4B9C;--st-s5:#8A6A00;--st-s6:#B0285A;--st-s7:#2F6B7C;--st-s8:#5A5F52;--st-font-ui:\"Microsoft YaHei UI\",\"Microsoft YaHei\",\"PingFang SC\",\"Segoe UI\",system-ui,sans-serif;--st-font-display:Bahnschrift,\"Microsoft YaHei UI\",\"Segoe UI\",system-ui,sans-serif;--st-font-num:\"Cascadia Mono\",\"SFMono-Regular\",Consolas,\"Liberation Mono\",monospace}}";

function investDailyReviewEscape(value) {
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
// One DOM, two layouts. Rules are written once per design and emitted for the explicit class
// (theme-light / theme-dark) and, for theme-auto, inside the matching prefers-color-scheme query.
function investDailyReviewLayoutCss() {
  const rules={light:[],dark:[]};
  const L=(sel,decl)=>rules.light.push([sel,decl]), D=(sel,decl)=>rules.dark.push([sel,decl]);
  // ---- 数理研究院: a printed research brief. Serif headings, numbered sections, hairlines.
  L('','background-image:linear-gradient(var(--st-grid) 1px,transparent 1px),linear-gradient(90deg,var(--st-grid) 1px,transparent 1px);background-size:24px 24px');
  L('main','max-width:940px;counter-reset:sec');
  L('h1,h2','font-family:var(--st-font-display)');
  L('h1','font-size:clamp(1.7rem,4vw,2.45rem);font-weight:600;letter-spacing:.01em;margin:.15em 0 .2em');
  L('.masthead','padding:0 0 20px;margin-bottom:28px;border-bottom:3px double var(--st-rule2)');
  L('.kicker','font:600 .72rem var(--st-font-ui);letter-spacing:.2em;color:var(--st-accent)');
  L('.blk','margin-bottom:30px');
  L('.blk > h2','display:flex;align-items:baseline;gap:10px;padding:10px 0 8px;margin-bottom:12px;border-top:2px solid var(--st-ink);border-bottom:1px solid var(--st-rule);font-size:1.15rem');
  L('.blk > h2::before','counter-increment:sec;content:counter(sec,decimal-leading-zero);font:500 .78rem var(--st-font-num);color:var(--st-accent);letter-spacing:.06em');
  L('.fig','display:grid;grid-template-columns:minmax(0,1.75fr) minmax(0,1fr);gap:8px 32px;align-items:start');
  L('.fig-notes','border-left:1px solid var(--st-rule);padding-left:18px;color:var(--st-ink2);font-size:.9rem');
  L('.stats','display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:0 28px');
  L('.stats > div','display:flex;align-items:baseline;gap:8px;padding:6px 0');
  L('.stats > div::after','content:"";order:2;flex:1 1 20px;border-bottom:1px dotted var(--st-rule2);transform:translateY(-3px)');
  L('.stats dt','order:1');
  L('.stats dd','order:3;margin:0;font:600 1rem var(--st-font-num)');
  L('table','border-top:2px solid var(--st-ink)');
  L('th','border-bottom:1.5px solid var(--st-ink)');
  L('tbody tr:nth-child(even)','background:var(--st-sunken)');
  L('article','padding:18px 0;border-top:1px solid var(--st-rule2)');
  L('.commentary','border-left:3px solid var(--st-accent);padding:4px 0 4px 16px');
  L('.grid > section','border-top:1px solid var(--st-rule);padding:8px 0');
  L('.blk-experts','order:4');
  // ---- 量化交易台: an evening terminal. Status first, dense panels, no decoration.
  D('main','max-width:1240px;padding-top:16px;gap:10px');
  D('h1','font-size:1.1rem;font-weight:600;margin:0');
  D('.masthead','display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 18px;padding:10px 14px;border:1px solid var(--st-rule);background:var(--st-surface)');
  D('.masthead > p','margin:0;font-size:.82rem');
  D('.masthead > .kicker','order:3;margin-left:auto;font:600 .68rem var(--st-font-ui);letter-spacing:.16em;color:var(--st-ink2)');
  D('.masthead > .stats','flex:1 1 100%');
  D('.masthead > .commentary','flex:1 1 100%');
  D('.blk','margin:0;padding:10px 14px 12px;border:1px solid var(--st-rule);background:var(--st-surface)');
  D('.blk > h2','display:flex;align-items:center;gap:8px;margin:0 0 8px;font:600 .72rem var(--st-font-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--st-ink2)');
  D('.blk > h2::before','content:"";width:3px;height:11px;background:var(--st-accent)');
  D('.fig','display:block');
  D('.fig-notes','margin-top:6px;color:var(--st-ink2);font-size:.82rem');
  D('.stats','display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:0;border:1px solid var(--st-rule);background:var(--st-sunken);margin-top:10px');
  D('.stats > div','padding:7px 10px;border-right:1px solid var(--st-rule)');
  D('.stats dt','font-size:.68rem;letter-spacing:.04em;text-transform:none');
  D('.stats dd','margin:2px 0 0;font:600 1rem var(--st-font-num)');
  D('table','font-size:.84rem');
  D('th','background:var(--st-surface);border-bottom:1px solid var(--st-rule2);padding:5px 8px');
  D('td,th[scope=row]','padding:5px 8px');
  D('tbody tr:hover','background:var(--st-accent-soft)');
  D('article','margin:0;padding:10px 14px 12px;border:1px solid var(--st-rule);background:var(--st-surface)');
  D('article > h2','font-size:.95rem');
  D('.commentary','border:1px solid var(--st-rule);border-left:3px solid var(--st-accent);background:var(--st-sunken);padding:8px 12px');
  D('.grid','align-items:start');
  D('.grid > section','background:var(--st-sunken);border:1px solid var(--st-rule)');
  D('.blk-kpi','order:1');D('.blk-signals','order:2');D('.blk-chart','order:3');D('.blk-experts','order:4');
  const emit=(list,scope)=>list.map(([sel,decl])=>sel.split(',').map(part=>`${scope} ${part.trim()}`.trim()).join(',')+`{${decl}}`).join('\n');
  return [
    emit(rules.light,'body.theme-light'),`@media not (prefers-color-scheme:dark){\n${emit(rules.light,'body.theme-auto')}\n}`,
    emit(rules.dark,'body.theme-dark'),`@media (prefers-color-scheme:dark){\n${emit(rules.dark,'body.theme-auto')}\n}`
  ].join('\n');
}
const INVEST_DAILY_REPORT_BASE_CSS=`*{box-sizing:border-box}
body{margin:0;background:var(--st-paper);color:var(--st-ink);font:15px/1.6 var(--st-font-ui);font-variant-numeric:tabular-nums}
main{display:flex;flex-direction:column;max-width:1040px;margin:auto;padding:clamp(16px,4vw,44px)}
h1,h2,h3,h4,p,ul{margin:0}h2{font-size:1.2rem;line-height:1.35}h3{font-size:1rem}p+p,header p{margin-top:.45em}
time,.muted,small,dt{color:var(--st-ink2)}small{font-size:.82em}dd{margin:0}
.masthead,.blk,article{margin:0 0 20px}.masthead{min-width:0}.blk-experts{display:flex;flex-direction:column}
.kicker{margin:0;font-size:.72rem}
.num{text-align:right;font-family:var(--st-font-num);white-space:nowrap}
.pos{color:var(--st-up)}.neg{color:var(--st-down)}.zero,.nil{color:var(--st-ink2)}
.notice,.warnings{color:var(--st-warn)}.warnings{margin-top:.7em;padding-left:1.18em}
.basis{display:inline-block;margin-left:auto;padding:1px 8px;border:1px solid currentColor;border-radius:var(--st-radius);font:600 .72rem var(--st-font-ui);letter-spacing:.02em;white-space:nowrap}
.basis-settled{color:var(--st-accent)}.basis-observed{color:var(--st-warn);border-style:dashed}
.blk > h2 .basis{font-weight:600}
.blk-signals{border-left:3px dashed var(--st-warn);padding-left:14px}
.commentary{margin-top:16px;white-space:pre-wrap;overflow-wrap:anywhere}.commentary ul{padding-left:1.18em}.commentary h2,.commentary h3{font-size:1rem}
.stats,.grid{display:grid;gap:12px;margin:16px 0 0}
.stats{grid-template-columns:repeat(auto-fit,minmax(min(100%,138px),1fr))}.stats > div{min-width:0}
.stats dd{font-size:1.15rem;font-weight:650;font-variant-numeric:tabular-nums}
.grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))}.grid > section{min-width:0;padding:10px 12px;overflow-wrap:anywhere}
.grid ul{padding-left:1.18em}.grid li+li{margin-top:8px}.tag{font-size:.8rem;font-weight:600}
svg{width:100%;height:auto;color:var(--st-ink2);display:block}.axis{stroke:var(--st-rule2)}
.legend{display:flex;flex-wrap:wrap;gap:.15em 1em;padding:0;list-style:none;font-size:.88rem;margin-top:6px}
.table-scroll{overflow-x:auto;margin-top:8px}table{width:100%;border-collapse:collapse;font-size:.92rem}
th,td{padding:8px 6px;border-bottom:1px solid var(--st-rule);text-align:left;vertical-align:top}th{color:var(--st-ink2);font-weight:600;font-size:.84em}
th.num,td.num{text-align:right}thead th{white-space:nowrap}td.nw{white-space:nowrap}tbody th{color:var(--st-ink);font-size:inherit}
.fig-notes p+p{margin-top:.5em}
footer{order:9;color:var(--st-ink2);font-size:.88rem;margin-top:8px}
a:focus-visible,summary:focus-visible{outline:2px solid var(--st-accent);outline-offset:2px}
@media (max-width:640px){body.theme-light .fig,body.theme-auto .fig{grid-template-columns:minmax(0,1fr)}.fig-notes{border-left:0!important;padding-left:0!important}}
@media print{body{background:var(--st-surface)!important;background-image:none!important;font-size:12px}main{padding:0;max-width:none}.masthead,.blk,article{break-inside:avoid}.table-scroll{overflow:visible}}`;
function investDailyReviewHtml(report,lang='zh',commentary=null,options=null) {
  const en=lang==='en', e=investDailyReviewEscape, na='—';
  const theme=['light','dark','auto'].includes(options?.theme)?options.theme:'auto';
  const words=en?{
    title:'Daily simulation review',kicker:'SIMULATION RESEARCH BRIEF',simulation:'Simulation only. Candidate signals and observation returns are not portfolio P&L; only dated ledger fills are buys or sells.',
    frozen:'Activity records use frozen reasons or system classifications. No new AI commentary was generated by this formatter.',
    commentary:'Commentary',awaiting:'Awaiting AI commentary. Frozen reasons and system classifications are shown below.',watch:'Watch points',
    partial:'Partial report: some records were unavailable or could not be reconstructed.',
    historical:'Historical queue and unresolved plan status snapshots are unavailable here. Dashes are not zeroes.',
    experts:'Experts',triggered:'Triggered',queued:'New queued orders',buys:'Simulated buys',sells:'Simulated sells',pending:'Pending',unverified:'Unverified',selected:'Selected',needs_ai:'Needs verification',ambiguous:'Ambiguous',unavailable:'Unavailable',
    chart:'Settled portfolio cumulative return',chartNote:'Missing points break the line. A single observation is shown only as a marker.',emptyChart:'No settled return points.',
    chartHow:'Horizontal axis: settled sessions. Vertical axis: cumulative return on each expert’s own capital (%). Gaps are not filled with zero.',
    nav:'Settled NAV (CNY)',day:'Daily return',total:'Cumulative return',drawdown:'Max. observed drawdown',plans:'Plan signals',buy:'Buy',sell:'Sell',
    empty:'No matching records in available data.',missingReason:'No frozen reason supplied.',noExperts:'No expert data available.',
    capital:'Initial capital per expert',signals:'Triggered signals (observation only, not portfolio P&L)',signalCode:'Signal',
    settledBasis:'Settled ledger',observedBasis:'Observation basis',
    kpiTitle:'Expert NAV and exposure',kpiUnits:'NAV in CNY; returns in %. Every expert keeps an independent simulated capital. These are settled ledger figures.',
    expert:'Expert',navU:'Settled NAV (CNY)',totalU:'Cumulative (%)',dayU:'Daily (%)',ddU:'Max. drawdown (%)',actions:'Today: buy / sell / queued',
    triggerDate:'Trigger date',triggerPriceU:'Trigger condition price (CNY)',triggerCloseU:'Close that day (CNY)',livePriceU:'Latest price (CNY)',obsReturnU:'Observed return (%) vs. condition price',obsDdU:'Drawdown since trigger (%)',windowsU:'Matured windows (%)',
    obsFormula:'Observed return = latest price ÷ trigger condition price − 1. Account profit and loss is shown only by the settled NAV above.',
    matureWindows:'Matured windows',noSignal:'No plan was triggered on or before this cutoff.',
    noMature:'Triggered today: the return starts from the trigger close and no session has matured yet.',
    signalChart:'Triggered signals: equal-weight return by window',
    livePrice:'Latest price',liveNote:'Latest quotes as of',liveFailed:'Latest quotes are unavailable; archived values are shown.',
    liveCurve:'Triggered signals: cumulative return since trigger (equal weight)'
  }:{
    title:'模拟组合每日复盘',kicker:'模拟研究简报',simulation:'仅供模拟复盘。候选信号与观察收益不是组合盈亏；买卖仅依据有日期的模拟成交账本。',
    frozen:'活动记录依据冻结理由或系统分类；此排版器未生成新的 AI 点评。',
    commentary:'复盘点评',awaiting:'等待 AI 点评；下方仅展示冻结理由与系统分类。',watch:'后续关注',
    partial:'部分数据未能取得或无法还原。',historical:'无法还原历史排队快照与未决计划状态；横线不代表零。',
    experts:'专家',triggered:'已触发',queued:'当日新排队',buys:'模拟买入',sells:'模拟卖出',pending:'等待触发',unverified:'未验证',selected:'当日入选',needs_ai:'待验证',ambiguous:'条件不明确',unavailable:'数据不可用',
    chart:'已结算组合累计收益',chartNote:'缺值断线，单个观测只显示点位。',emptyChart:'暂无已结算收益点。',
    chartHow:'横轴：已结算交易日；纵轴：相对各专家独立本金的累计收益（%）。缺失日不补零。',
    nav:'已结算净值（元）',day:'单日收益',total:'累计收益',drawdown:'可观测最大回撤',plans:'计划信号',buy:'买',sell:'卖',
    empty:'可用数据中没有符合条件的记录。',missingReason:'未提供冻结理由。',noExperts:'暂无专家数据。',
    capital:'每位专家本金',signals:'已触发信号跟踪（观察口径，不是组合盈亏）',signalCode:'信号',
    settledBasis:'账户结算口径',observedBasis:'观察口径',
    kpiTitle:'各专家净值与暴露',kpiUnits:'净值单位：元；收益率单位：%。每位专家独立模拟本金，互不混合。以下均为已结算账本数据。',
    expert:'专家',navU:'已结算净值（元）',totalU:'累计收益（%）',dayU:'单日收益（%）',ddU:'最大回撤（%）',actions:'当日动作（买 / 卖 / 排队）',
    triggerDate:'触发日',triggerPriceU:'触发条件价（元）',triggerCloseU:'当日收盘（元）',livePriceU:'最新价（元）',obsReturnU:'观察收益（%）· 相对条件价',obsDdU:'触发以来回撤（%）',windowsU:'已成熟窗口（%）',
    obsFormula:'观察收益 = 最新价 ÷ 触发条件价 − 1。账户盈亏只看上方各专家的已结算净值，两者口径不同。',
    matureWindows:'已成熟窗口',noSignal:'截至该截点没有已触发的计划。',
    noMature:'当日触发：收益自触发日收盘起算，尚无已走完的交易日。',
    signalChart:'已触发信号：按窗口的等权收益',
    livePrice:'最新价',liveNote:'最新行情截至',liveFailed:'最新行情暂不可用，显示存档值。',
    liveCurve:'已触发信号：自触发日累计收益（等权）'
  };
  const locale=en?'en-US':'zh-CN', date=investDailyReviewStamp(report?.date)===null?na:report.date;
  const experts=investDailyReviewRows(report?.experts), historical=report?.historical===true;
  const expertComments=new Map();
  for(const item of investDailyReviewRows(commentary?.experts))if(typeof item.id==='string'&&!expertComments.has(item.id))expertComments.set(item.id,item);
  const commentarySummary=investDailyReviewText(commentary?.summary);
  const expertNote=expert=>{
    const item=expertComments.get(expert.id), comment=investDailyReviewText(item?.comment);
    const watch=(Array.isArray(item?.watch)?item.watch:[item?.watch]).map(value=>investDailyReviewText(value)).filter(Boolean);
    if(!comment&&!watch.length)return '';
    return `<section class="commentary"><h3>${e(words.commentary)}</h3>${comment?`<p>${e(comment)}</p>`:''}${watch.length?`<h4>${e(words.watch)}</h4><ul>${watch.map(value=>`<li>${e(value)}</li>`).join('')}</ul>`:''}</section>`;
  };
  const number=(value,options)=>investDailyReviewNumber(value)===null?na:new Intl.NumberFormat(locale,options).format(value);
  const money=value=>number(value,{minimumFractionDigits:2,maximumFractionDigits:2});
  const percent=value=>number(value,{style:'percent',maximumFractionDigits:2});
  // Direction is carried by the sign and the word-free glyphs + / − / —, never by colour alone.
  const signed=value=>{const n=investDailyReviewNumber(value);return n===null?na:(n>0?'+':n<0?'−':'')+new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:2}).format(Math.abs(n));};
  const tone=value=>{const n=investDailyReviewNumber(value);return n===null?'nil':n>0?'pos':n<0?'neg':'zero';};
  const ret=value=>`<span class="${tone(value)}">${e(signed(value))}</span>`;
  const summary=['experts','triggered','queued','buys','sells','pending','unverified'].map(key=>{
    const count=historical&&['queued','pending','unverified'].includes(key)?na:number(report?.counts?.[key],{maximumFractionDigits:0});
    return `<div><dt>${e(words[key])}</dt><dd>${e(count)}</dd></div>`;
  }).join('');
  const colors=['var(--st-s1)','var(--st-s2)','var(--st-s3)','var(--st-s4)','var(--st-s5)','var(--st-s6)','var(--st-s7)'];
  const chart=investDailyReviewChart(experts,colors,words,percent);
  const statusLabel=key=>typeof key==='string'&&Object.hasOwn(words,key)?words[key]:'—';
  const line=(row,extra)=>`<li><strong>${e([row.code,row.name===row.code?'':row.name].filter(Boolean).join(' '))}</strong>${extra?` <span class="tag">${e(extra)}</span>`:''}<div>${e(investDailyReviewText(row.reason)||words.missingReason)}</div>${investDailyReviewText(row.condition)?`<small>${e(row.condition)}</small>`:''}</li>`;
  const section=(title,rows,label,hidden=false)=>`<section><h3>${e(title)}</h3>${hidden?`<p class="muted">${e(words.historical)}</p>`:rows.length?`<ul>${rows.map(row=>line(row,label(row))).join('')}</ul>`:`<p class="muted">${e(words.empty)}</p>`}</section>`;
  const signals=investDailyReviewRows(report?.signals), signalSummary=report?.signalSummary??{};
  const windowNames=['1d','3d','5d','10d','20d'];
  const live=options?.live&&typeof options.live==='object'?options.live:null;
  const liveTime=(()=>{
    const stamp=live?.time;
    if(typeof stamp!=='number'&&typeof stamp!=='string')return '';
    const parsed=new Date(stamp);
    return Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat(locale,{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short',hour12:false}).format(parsed):'';
  })();
  const liveCurve=investDailyReviewRows(live?.curve).filter(point=>typeof point?.date==='string'&&investDailyReviewNumber(point.value)!==null);
  const liveChart=(()=>{
    if(liveCurve.length<2)return '';
    const values=liveCurve.map(point=>point.value);
    let low=Math.min(0,...values), high=Math.max(0,...values);
    if(high===low){high=0.001;low=-0.001;}
    const x=index=>64+index/(liveCurve.length-1)*672;
    const y=value=>120-(value-low)/(high-low)*96;
    const points=liveCurve.map((point,index)=>`${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
    const last=liveCurve.at(-1);
    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${e(words.liveCurve)}" viewBox="0 0 750 155"><line class="axis" x1="64" x2="736" y1="${y(0).toFixed(2)}" y2="${y(0).toFixed(2)}"/><polyline points="${points}" fill="none" style="stroke:var(--st-accent)" stroke-width="2"/><circle cx="${x(liveCurve.length-1).toFixed(2)}" cy="${y(last.value).toFixed(2)}" r="3" style="fill:var(--st-accent)"><title>${e(`${last.date} ${percent(last.value)}`)}</title></circle><text x="58" y="${(y(high)+4).toFixed(1)}" text-anchor="end" fill="currentColor" font-size="12">${e(percent(high))}</text><text x="58" y="${(y(low)+4).toFixed(1)}" text-anchor="end" fill="currentColor" font-size="12">${e(percent(low))}</text><text x="64" y="144" text-anchor="start" fill="currentColor" font-size="12">${e(liveCurve[0].date)}</text><text x="736" y="144" text-anchor="end" fill="currentColor" font-size="12">${e(last.date)}</text></svg>`;
  })();
  const signalRows=signals.map(signal=>{
    const quote=live?.quotes?.[signal.code], livePrice=Number(quote);
    const price=Number.isFinite(livePrice)&&livePrice>0?livePrice:null;
    const nowReturn=price!==null&&signal.triggerPrice>0?price/signal.triggerPrice-1:signal.current;
    const matured=windowNames.filter(name=>investDailyReviewNumber(signal.windows?.[name])!==null).map(name=>`${e(name)} ${ret(signal.windows[name])}`).join(' · ')||e(na);
    return `<tr><th scope="row">${e([signal.code,signal.name===signal.code?'':signal.name].filter(Boolean).join(' '))}<br><small>${e(investDailyReviewText(signal.expertName,signal.expertId))}</small></th><td class="nw">${e(investDailyReviewText(signal.triggerDate)||na)}</td><td class="num">${e(money(signal.triggerPrice))}</td><td class="num">${e(money(signal.triggerClose))}</td><td class="num">${e(price===null?na:money(price))}</td><td class="num">${ret(nowReturn)}</td><td class="num">${ret(signal.maxDrawdown)}</td><td>${matured}</td></tr>`;
  }).join('');
  const mature=windowNames.filter(name=>investDailyReviewNumber(signalSummary.windows?.[name])!==null);
  const signalBars=mature.length?`<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${e(words.signalChart)}" viewBox="0 0 750 170">${(()=>{
    const values=mature.map(name=>investDailyReviewNumber(signalSummary.windows[name]));
    const scale=Math.max(0.0001,...values.map(value=>Math.abs(value)));
    const zero=values.some(value=>value<0)?96:120;
    return mature.map((name,index)=>{
      const value=values[index], width=600/mature.length*0.5, step=600/mature.length;
      const x=72+step*index+step/2, height=Math.max(2,Math.abs(value)/scale*72), y=value<0?zero:zero-height;
      return `<rect x="${(x-width/2).toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" style="fill:var(${value<0?'--st-down':'--st-up'})"><title>${e(`${name} ${signed(value)}`)}</title></rect><text x="${x.toFixed(1)}" y="160" text-anchor="middle" fill="currentColor" font-size="12">${e(name)}</text><text x="${x.toFixed(1)}" y="${(value<0?zero+14:zero-height-6).toFixed(1)}" text-anchor="middle" fill="currentColor" font-size="11">${e(signed(value))}</text>`;
    }).join('');
  })()}</svg>`:'';
  const signalSection=`<section class="blk blk-signals"><h2>${e(words.signals)}<span class="basis basis-observed">${e(words.observedBasis)}</span></h2><p class="muted">${e(words.simulation)}</p>${signals.length?`<p class="muted">${e(live?`${words.liveNote} ${liveTime}`:words.liveFailed)}</p><div class="table-scroll"><table><thead><tr><th>${e(words.signalCode)}</th><th>${e(words.triggerDate)}</th><th class="num">${e(words.triggerPriceU)}</th><th class="num">${e(words.triggerCloseU)}</th><th class="num">${e(words.livePriceU)}</th><th class="num">${e(words.obsReturnU)}</th><th class="num">${e(words.obsDdU)}</th><th>${e(words.windowsU)}</th></tr></thead><tbody>${signalRows}</tbody></table></div><p class="muted">${e(words.obsFormula)}</p>${liveChart}${mature.length?signalBars:live?'':`<p class="notice">${e(words.noMature)}</p>`}`:`<p class="muted">${e(words.noSignal)}</p>`}</section>`;
  const kpiRows=experts.map(expert=>{
    const navDate=investDailyReviewStamp(expert.navDate)===null?'':expert.navDate;
    const count=rows=>number(investDailyReviewRows(rows).length,{maximumFractionDigits:0});
    return `<tr><th scope="row">${e(investDailyReviewText(expert.name,expert.id)||na)}</th><td class="num">${e(money(expert.nav))}${navDate?`<br><small>${e(navDate)}</small>`:''}</td><td class="num">${ret(expert.totalReturn)}</td><td class="num">${ret(expert.dayReturn)}</td><td class="num">${ret(expert.drawdown)}</td><td class="num">${e(count(expert.buys))} / ${e(count(expert.sells))} / ${e(historical?na:count(expert.queued))}</td></tr>`;
  }).join('');
  const kpiSection=`<section class="blk blk-kpi"><h2>${e(words.kpiTitle)}<span class="basis basis-settled">${e(words.settledBasis)}</span></h2><p class="muted">${e(words.kpiUnits)}</p>${kpiRows?`<div class="table-scroll"><table><thead><tr><th>${e(words.expert)}</th><th class="num">${e(words.navU)}</th><th class="num">${e(words.totalU)}</th><th class="num">${e(words.dayU)}</th><th class="num">${e(words.ddU)}</th><th class="num">${e(words.actions)}</th></tr></thead><tbody>${kpiRows}</tbody></table></div>`:`<p class="muted">${e(words.noExperts)}</p>`}</section>`;
  const cards=experts.map(expert=>{
    const navDate=investDailyReviewStamp(expert.navDate)===null?'':expert.navDate;
    const warnings=Array.isArray(expert.warnings)?expert.warnings.map(w=>investDailyReviewText(w)).filter(Boolean):[];
    return `<article><h2>${e(investDailyReviewText(expert.name,expert.id)||na)}</h2><dl class="stats">${[[words.nav,money(expert.nav),navDate,''],[words.day,signed(expert.dayReturn),'',tone(expert.dayReturn)],[words.total,signed(expert.totalReturn),'',tone(expert.totalReturn)],[words.drawdown,signed(expert.drawdown),'',tone(expert.drawdown)]].map(([label,value,session,cls])=>`<div><dt>${e(label)}${session?` <small>${e(session)}</small>`:''}</dt><dd${cls?` class="${cls}"`:''}>${e(value)}</dd></div>`).join('')}</dl>${expertNote(expert)}${warnings.length?`<ul class="warnings">${warnings.map(w=>`<li>${e(w)}</li>`).join('')}</ul>`:''}<div class="grid">${section(words.plans,investDailyReviewRows(expert.plans),row=>statusLabel(row.status))}${section(words.queued,investDailyReviewRows(expert.queued),row=>row.side==='buy'?words.buy:row.side==='sell'?words.sell:'',historical)}${section(words.buys,investDailyReviewRows(expert.buys),row=>money(row.price))}${section(words.sells,investDailyReviewRows(expert.sells),row=>money(row.price))}</div></article>`;
  }).join('');
  const css=`${INVEST_DAILY_REPORT_TOKEN_CSS}\n${INVEST_DAILY_REPORT_BASE_CSS}\n${investDailyReviewLayoutCss()}`;
  return `<!doctype html>
<html lang="${en?'en':'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="${theme==='auto'?'light dark':theme}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(words.title)} · ${e(date)}</title>
<style>
${css}
</style></head><body class="theme-${theme}"><main><header class="masthead"><p class="kicker">${e(words.kicker)}</p><time>${e(date)}</time><h1>${e(words.title)}</h1><p>${e(words.simulation)}</p><p class="muted">${e(words.capital)}: ${e(money(report?.capital))} ${e(en?'CNY':'元')} × ${e(number(experts.length,{maximumFractionDigits:0}))}</p>${report?.partial?`<p class="notice">${e(words.partial)}</p>`:''}${historical?`<p class="notice">${e(words.historical)}</p>`:''}<dl class="stats">${summary}</dl><section class="commentary"><h2>${e(words.commentary)}</h2><p class="${commentarySummary?'':'muted'}">${e(commentarySummary||words.awaiting)}</p></section></header><section class="blk blk-chart"><h2>${e(words.chart)}<span class="basis basis-settled">${e(words.settledBasis)}</span></h2><div class="fig"><figure style="margin:0">${chart}<figcaption class="muted">${e(words.chartNote)}</figcaption></figure><aside class="fig-notes"><p>${e(words.chartHow)}</p></aside></div></section>${kpiSection}${signalSection}<section class="blk-experts">${cards||`<p class="muted">${e(words.noExperts)}</p>`}</section><footer><p>${e(words.frozen)}</p></footer></main></body></html>`;
}

function investDailyReviewChart(experts,colors,words,percent) {
  const e=investDailyReviewEscape, axis=new Map();
  const series=experts.map(expert=>{
    const points=new Map();
    for(const p of investDailyReviewRows(expert.points)){
      const stamp=investDailyReviewStamp(p.date);
      if(stamp===null)continue;
      axis.set(stamp,p.date);
      points.set(stamp,investDailyReviewNumber(p.value));
    }
    return {name:investDailyReviewText(expert.name,expert.id),points};
  });
  const days=[...axis.keys()].sort((a,b)=>a-b);
  let lo=Infinity,hi=-Infinity;
  for(const {points} of series)for(const value of points.values())if(value!==null){lo=Math.min(lo,value);hi=Math.max(hi,value);}
  if(lo===Infinity)return `<p class="muted">${e(words.emptyChart)}</p>`;
  const scale=Math.max(1,Math.abs(hi),Math.abs(lo)), low=lo/scale, range=hi/scale-low;
  const x=index=>days.length===1?380:64+index/(days.length-1)*672;
  const y=value=>range>0?120-(value/scale-low)/range*96:72;
  const segments=[], legend=[];
  series.forEach(({name,points},index)=>{
    if(![...points.values()].some(value=>value!==null))return;
    const color=colors[index%colors.length];
    const paths=[], markers=[];
    let run=[];
    const flush=()=>{if(run.length>1)paths.push(`<polyline points="${run.join(' ')}" fill="none" style="stroke:${color}" stroke-width="2"/>`);run=[];};
    days.forEach((stamp,i)=>{
      const value=points.get(stamp)??null;
      if(value===null){flush();return;}
      const cx=x(i).toFixed(2), cy=y(value).toFixed(2);
      run.push(`${cx},${cy}`);
      markers.push(`<circle cx="${cx}" cy="${cy}" r="2.8" style="fill:${color}"><title>${e(`${name} · ${axis.get(stamp)} · ${percent(value)}`)}</title></circle>`);
    });
    flush();
    segments.push(...paths,...markers);
    legend.push(`<li><span style="color:${color}" aria-hidden="true">●</span> ${e(name)}</li>`);
  });
  const dateLabels=days.length===1?[[days[0],380,'middle']]:[[days[0],64,'start'],[days.at(-1),736,'end']];
  const ticks=lo===hi?[[lo,72]]:[[hi,24],[lo,120]];
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${e(words.chart)}" viewBox="0 0 750 155">${ticks.map(([value,at])=>`<line class="axis" x1="64" x2="736" y1="${at}" y2="${at}"/><text x="58" y="${at+4}" text-anchor="end" fill="currentColor" font-size="12">${e(percent(value))}</text>`).join('')}${segments.join('')}${dateLabels.map(([day,at,anchor])=>`<text x="${at}" y="144" text-anchor="${anchor}" fill="currentColor" font-size="12">${e(axis.get(day))}</text>`).join('')}</svg><ul class="legend">${legend.join('')}</ul>`;
}

export {investDailyReviewReport, investDailyReviewHtml};
