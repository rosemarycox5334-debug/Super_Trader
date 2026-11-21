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
        result.signals.push({...item,expertId:id,expertName:investDailyReviewText(plan.expert_name,id),
          triggerDate,triggerPrice:positivePrice(metrics.base_price??metrics.trigger?.price),
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

function investDailyReviewEscape(value) {
  return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function investDailyReviewHtml(report,lang='zh',commentary=null) {
  const en=lang==='en', e=investDailyReviewEscape, na='—';
  const words=en?{
    title:'Daily simulation review',simulation:'Simulation only. Candidate signals and observation returns are not portfolio P&L; only dated ledger fills are buys or sells.',
    frozen:'Activity records use frozen reasons or system classifications. No new AI commentary was generated by this formatter.',
    commentary:'Commentary',awaiting:'Awaiting AI commentary. Frozen reasons and system classifications are shown below.',watch:'Watch points',
    partial:'Partial report: some records were unavailable or could not be reconstructed.',
    historical:'Historical queue and unresolved plan status snapshots are unavailable here. Dashes are not zeroes.',
    experts:'Experts',triggered:'Triggered',queued:'New queued orders',buys:'Simulated buys',sells:'Simulated sells',pending:'Pending',unverified:'Unverified',selected:'Selected',needs_ai:'Needs verification',ambiguous:'Ambiguous',unavailable:'Unavailable',
    chart:'Settled portfolio cumulative return',chartNote:'Missing points break the line. A single observation is shown only as a marker.',emptyChart:'No settled return points.',
    nav:'Settled NAV (CNY)',day:'Daily return',total:'Cumulative return',drawdown:'Max. observed drawdown',plans:'Plan signals',buy:'Buy',sell:'Sell',
    empty:'No matching records in available data.',missingReason:'No frozen reason supplied.',noExperts:'No expert data available.',
    capital:'Initial capital per expert',signals:'Triggered signals (observation only, not portfolio P&L)',signalCode:'Signal',
    triggerDay:'Trigger date / price',signalNow:'Return since trigger',signalDrawdown:'Drawdown since trigger',
    matureWindows:'Matured windows',noSignal:'No plan was triggered on or before this cutoff.',
    noMature:'Triggered today: the return starts from the trigger close and no session has matured yet.',
    signalChart:'Triggered signals: equal-weight return by window'
  }:{
    title:'模拟组合每日复盘',simulation:'仅供模拟复盘。候选信号与观察收益不是组合盈亏；买卖仅依据有日期的模拟成交账本。',
    frozen:'活动记录依据冻结理由或系统分类；此排版器未生成新的 AI 点评。',
    commentary:'复盘点评',awaiting:'等待 AI 点评；下方仅展示冻结理由与系统分类。',watch:'后续关注',
    partial:'部分数据未能取得或无法还原。',historical:'无法还原历史排队快照与未决计划状态；横线不代表零。',
    experts:'专家',triggered:'已触发',queued:'当日新排队',buys:'模拟买入',sells:'模拟卖出',pending:'等待触发',unverified:'未验证',selected:'当日入选',needs_ai:'待验证',ambiguous:'条件不明确',unavailable:'数据不可用',
    chart:'已结算组合累计收益',chartNote:'缺值断线，单个观测只显示点位。',emptyChart:'暂无已结算收益点。',
    nav:'已结算净值（元）',day:'单日收益',total:'累计收益',drawdown:'可观测最大回撤',plans:'计划信号',buy:'买',sell:'卖',
    empty:'可用数据中没有符合条件的记录。',missingReason:'未提供冻结理由。',noExperts:'暂无专家数据。',
    capital:'每位专家本金',signals:'已触发信号跟踪（观察口径，不是组合盈亏）',signalCode:'信号',
    triggerDay:'触发日 / 价',signalNow:'触发以来收益',signalDrawdown:'触发以来回撤',
    matureWindows:'已成熟窗口',noSignal:'截至该截点没有已触发的计划。',
    noMature:'当日触发：收益自触发日收盘起算，尚无已走完的交易日。',
    signalChart:'已触发信号：按窗口的等权收益'
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
  const summary=['experts','triggered','queued','buys','sells','pending','unverified'].map(key=>{
    const count=historical&&['queued','pending','unverified'].includes(key)?na:number(report?.counts?.[key],{maximumFractionDigits:0});
    return `<div><dt>${e(words[key])}</dt><dd>${e(count)}</dd></div>`;
  }).join('');
  const colors=['#1558a5','#9c3500','#00735d','#8a3593','#796000','#b6204b','#355b68'];
  const chart=investDailyReviewChart(experts,colors,words,percent);
  const statusLabel=key=>typeof key==='string'&&Object.hasOwn(words,key)?words[key]:'—';
  const line=(row,extra)=>`<li><strong>${e([row.code,row.name===row.code?'':row.name].filter(Boolean).join(' '))}</strong>${extra?` <span class="tag">${e(extra)}</span>`:''}<div>${e(investDailyReviewText(row.reason)||words.missingReason)}</div>${investDailyReviewText(row.condition)?`<small>${e(row.condition)}</small>`:''}</li>`;
  const section=(title,rows,label,hidden=false)=>`<section><h3>${e(title)}</h3>${hidden?`<p class="muted">${e(words.historical)}</p>`:rows.length?`<ul>${rows.map(row=>line(row,label(row))).join('')}</ul>`:`<p class="muted">${e(words.empty)}</p>`}</section>`;
  const signals=investDailyReviewRows(report?.signals), signalSummary=report?.signalSummary??{};
  const windowNames=['1d','3d','5d','10d','20d'];
  const signalRows=signals.map(signal=>`<tr><td>${e([signal.code,signal.name===signal.code?'':signal.name].filter(Boolean).join(' '))}<br><small>${e(investDailyReviewText(signal.expertName,signal.expertId))}</small></td><td>${e(investDailyReviewText(signal.triggerDate)||na)}<br><small>${e(money(signal.triggerPrice))}</small></td><td>${e(percent(signal.current))}</td><td>${e(percent(signal.maxDrawdown))}</td><td>${e(windowNames.filter(name=>investDailyReviewNumber(signal.windows?.[name])!==null).map(name=>`${name} ${percent(signal.windows[name])}`).join(' · ')||na)}</td></tr>`).join('');
  const mature=windowNames.filter(name=>investDailyReviewNumber(signalSummary.windows?.[name])!==null);
  const signalBars=mature.length?`<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${e(words.signalChart)}" viewBox="0 0 750 170">${(()=>{
    const values=mature.map(name=>investDailyReviewNumber(signalSummary.windows[name]));
    const scale=Math.max(0.0001,...values.map(value=>Math.abs(value)));
    const zero=values.some(value=>value<0)?96:120;
    return mature.map((name,index)=>{
      const value=values[index], width=600/mature.length*0.5, step=600/mature.length;
      const x=72+step*index+step/2, height=Math.max(2,Math.abs(value)/scale*72), y=value<0?zero:zero-height;
      return `<rect x="${(x-width/2).toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="${value<0?'#9c3500':'#1558a5'}"><title>${e(`${name} ${percent(value)}`)}</title></rect><text x="${x.toFixed(1)}" y="160" text-anchor="middle" fill="currentColor" font-size="12">${e(name)}</text><text x="${x.toFixed(1)}" y="${(value<0?zero+14:zero-height-6).toFixed(1)}" text-anchor="middle" fill="currentColor" font-size="11">${e(percent(value))}</text>`;
    }).join('');
  })()}</svg>`:'';
  const signalSection=`<figure><h2>${e(words.signals)}</h2><p class="muted">${e(words.simulation)}</p>${signals.length?`<div class="table-scroll"><table><thead><tr><th>${e(words.signalCode)}</th><th>${e(words.triggerDay)}</th><th>${e(words.signalNow)}</th><th>${e(words.signalDrawdown)}</th><th>${e(words.matureWindows)}</th></tr></thead><tbody>${signalRows}</tbody></table></div>${mature.length?signalBars:`<p class="notice">${e(words.noMature)}</p>`}`:`<p class="muted">${e(words.noSignal)}</p>`}</figure>`;
  const cards=experts.map(expert=>{
    const navDate=investDailyReviewStamp(expert.navDate)===null?'':expert.navDate;
    const warnings=Array.isArray(expert.warnings)?expert.warnings.map(w=>investDailyReviewText(w)).filter(Boolean):[];
    return `<article><h2>${e(investDailyReviewText(expert.name,expert.id)||na)}</h2><dl class="stats">${[[words.nav,money(expert.nav),navDate],[words.day,percent(expert.dayReturn)],[words.total,percent(expert.totalReturn)],[words.drawdown,percent(expert.drawdown)]].map(([label,value,session])=>`<div><dt>${e(label)}${session?` <small>${e(session)}</small>`:''}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>${expertNote(expert)}${warnings.length?`<ul class="warnings">${warnings.map(w=>`<li>${e(w)}</li>`).join('')}</ul>`:''}<div class="grid">${section(words.plans,investDailyReviewRows(expert.plans),row=>statusLabel(row.status))}${section(words.queued,investDailyReviewRows(expert.queued),row=>row.side==='buy'?words.buy:row.side==='sell'?words.sell:'',historical)}${section(words.buys,investDailyReviewRows(expert.buys),row=>money(row.price))}${section(words.sells,investDailyReviewRows(expert.sells),row=>money(row.price))}</div></article>`;
  }).join('');
  return `<!doctype html>
<html lang="${en?'en':'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${e(words.title)} · ${e(date)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef3f7;color:#152438;font:16px/1.55 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:clamp(16px,4vw,48px)}header,figure,article{margin:0 0 18px;padding:clamp(16px,3vw,28px);background:#fff;border:1px solid #ccdae5;border-radius:14px}h1,h2,h3,h4,p,ul{margin:0}.commentary{margin-top:16px;padding:12px;border:1px solid #ccdae5;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}.commentary ul{padding-left:1.18em}h1{font-size:clamp(1.5rem,4vw,2.3rem)}h2{font-size:1.25rem}h3{font-size:1rem}p+ p,header p{margin-top:.45em}time,.muted,small,dt{color:#475b71}.notice,.warnings{color:#694300}.stats,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,138px),1fr));gap:12px;margin:16px 0 0}.stats>div,.grid>section{padding:12px;background:#f2f6fa;border-radius:8px;min-width:0;overflow-wrap:anywhere}.stats dd{margin:0;font-size:1.23rem;font-weight:650;font-variant-numeric:tabular-nums}.grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))}.grid ul,.warnings{padding-left:1.18em}.grid li+li{margin-top:8px}.tag{font-size:.8rem;font-weight:600}.warnings{margin-top:.7em}svg{width:100%;height:auto;color:#475b71;display:block}.legend{display:flex;flex-wrap:wrap;gap:.15em 1em;padding:0;list-style:none;font-size:.9rem}footer{color:#475b71;font-size:.9rem}.table-scroll{overflow-x:auto;margin-top:8px}table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{padding:8px 6px;border-bottom:1px solid #d7e2ec;text-align:left;vertical-align:top}th{color:#475b71;font-weight:600;white-space:nowrap}@media print{body{background:#fff}main{padding:0}article,figure{break-inside:avoid}}
</style></head><body><main><header><time>${e(date)}</time><h1>${e(words.title)}</h1><p>${e(words.simulation)}</p><p class="muted">${e(words.capital)}: ${e(money(report?.capital))} ${e(en?'CNY':'元')} × ${e(number(experts.length,{maximumFractionDigits:0}))}</p>${report?.partial?`<p class="notice">${e(words.partial)}</p>`:''}${historical?`<p class="notice">${e(words.historical)}</p>`:''}<dl class="stats">${summary}</dl><section class="commentary"><h2>${e(words.commentary)}</h2><p class="${commentarySummary?'':'muted'}">${e(commentarySummary||words.awaiting)}</p></section></header><figure><h2>${e(words.chart)}</h2>${chart}<figcaption class="muted">${e(words.chartNote)}</figcaption></figure>${signalSection}${cards||`<p class="muted">${e(words.noExperts)}</p>`}<footer><p>${e(words.frozen)}</p></footer></main></body></html>`;
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
    const flush=()=>{if(run.length>1)paths.push(`<polyline points="${run.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`);run=[];};
    days.forEach((stamp,i)=>{
      const value=points.get(stamp)??null;
      if(value===null){flush();return;}
      const cx=x(i).toFixed(2), cy=y(value).toFixed(2);
      run.push(`${cx},${cy}`);
      markers.push(`<circle cx="${cx}" cy="${cy}" r="2.8" fill="${color}"><title>${e(`${name} · ${axis.get(stamp)} · ${percent(value)}`)}</title></circle>`);
    });
    flush();
    segments.push(...paths,...markers);
    legend.push(`<li><span style="color:${color}" aria-hidden="true">●</span> ${e(name)}</li>`);
  });
  const dateLabels=days.length===1?[[days[0],380,'middle']]:[[days[0],64,'start'],[days.at(-1),736,'end']];
  const ticks=lo===hi?[[lo,72]]:[[hi,24],[lo,120]];
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${e(words.chart)}" viewBox="0 0 750 155">${ticks.map(([value,at])=>`<line x1="64" x2="736" y1="${at}" y2="${at}" stroke="#ccd8e2"/><text x="58" y="${at+4}" text-anchor="end" fill="currentColor" font-size="12">${e(percent(value))}</text>`).join('')}${segments.join('')}${dateLabels.map(([day,at,anchor])=>`<text x="${at}" y="144" text-anchor="${anchor}" fill="currentColor" font-size="12">${e(axis.get(day))}</text>`).join('')}</svg><ul class="legend">${legend.join('')}</ul>`;
}

export {investDailyReviewReport, investDailyReviewHtml};
