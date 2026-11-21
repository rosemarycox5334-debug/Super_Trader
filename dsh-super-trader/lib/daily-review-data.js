import {investDailyReviewReport} from './daily-review-template.js';

const rows = v => Array.isArray(v) ? v : [];
const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const shanghai = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

export async function loadDailyReviewData(manager, now = new Date()) {
  const [today, time] = shanghai.format(now).split(' ');
  // In the absence of a finalized same-day observation, use the latest known completed date.
  const eligible = v => day(v) && (v < today || v === today && time >= '15:05');
  const [books, index] = await Promise.all([
    manager.request('GET','/api/portfolios'),manager.request('GET','/api/reviews'),
  ]);
  if (!Array.isArray(books?.portfolios) || !Array.isArray(index?.items)) throw new Error('日报数据格式不完整，未启动复盘。');
  const items = books.portfolios.map(b => {
    const initial = b.initial_cash ?? books.initial_cash;
    return {...b,initial_cash:initial,curve:rows(b.nav_history),pending:rows(b.queued_orders),positions:rows(b.open_positions),closed:rows(b.closed_positions)};
  });
  const batchIds = [...new Set(index.items.map(b=>b?.id).filter(v=>typeof v === 'string' && /^R-[A-Za-z0-9_-]{1,120}$/.test(v)))];
  const details = [];
  let partial = batchIds.length > 6 || index.pending_archive > 0;
  // Bound live requests: the bulk of histories belong in the existing per-batch review store.
  for (let i=0; i<Math.min(batchIds.length,6); i+=2) {
    const group = await Promise.allSettled(batchIds.slice(i,Math.min(i+2,6)).map(id=>manager.request('GET','/api/reviews/'+encodeURIComponent(id),undefined,{timeoutMs:18000})));
    for (const result of group) {
      if (result.status==='fulfilled' && Array.isArray(result.value?.targets)) details.push(result.value);
      else partial = true;
    }
  }
  const sessions = items.flatMap(e=>e.curve.map(p=>p.date??p.session));
  for(const detail of details) for(const target of detail.targets) for(const plan of rows(target.plans)) {
    const m=plan.metrics;
    if(m?.status!=='unavailable') sessions.push(m?.as_of, m?.trigger?.date, m?.base_date);
  }
  const date = sessions.filter(eligible).sort().at(-1);
  if (!date) throw Object.assign(new Error('还没有可复盘的已收盘交易日，请等到有收盘数据后再试。'),{status:409});
  return investDailyReviewReport(date,{...books,items},details,{partial,historical:false});
}
