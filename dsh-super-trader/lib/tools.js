import {listSessions, readSession, toMessages, SESSION_ID} from './session-log.js';

const str = description => ({ type: 'string', description });
const horizon = { type: 'integer', description: '持有交易日数，整数 1–20；省略由后端使用默认值。' };
const category = str('标的类别；省略由后端解析。');
const code = str('非空标的代码，例如 601088。');
const threshold = { type: 'number', description: '有效票支持比例，0–1；后端默认 0.6。' };
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(Object.assign(new Error('Operation cancelled'), { code: 'cancelled' })); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  if (signal?.aborted) { abort(); return; }
  signal?.addEventListener('abort', abort, { once: true });
});

function validate(schema, args, path = 'args') {
  const invalid = message => { throw Object.assign(new Error(message), { code: 'invalid_arguments' }); };
  if (schema.type === 'object') {
    if (!args || typeof args !== 'object' || Array.isArray(args)) invalid(`${path} must be an object`);
    for (const key of schema.required ?? []) if (!Object.hasOwn(args, key)) invalid(`${key} is required`);
    for (const [key, value] of Object.entries(args)) {
      if (schema.properties) {
        if (!Object.hasOwn(schema.properties, key)) invalid(`Unknown argument: ${key}`);
        validate(schema.properties[key], value, key);
      }

    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(args)) invalid(`${path} must be an array`);
    for (const item of args) validate(schema.items, item, path);
  } else if (schema.type === 'integer' ? !Number.isInteger(args) : schema.type === 'number' ? typeof args !== 'number' || !Number.isFinite(args) : typeof args !== schema.type) invalid(`${path} must be ${schema.type}`);
  if (schema.enum && !schema.enum.includes(args)) invalid(`${path} must be one of ${schema.enum.join(', ')}`);
  if (schema.type === 'string' && !['note','brief'].includes(path) && !args.trim()) invalid(`${path} must be nonempty`);
  if (path === 'horizon' && (args < 1 || args > 20)) invalid('horizon must be an integer in 1..20');
  if (path === 'threshold' && (args < 0 || args > 1)) invalid('threshold must be in 0..1');
  if (path === 'price' && args <= 0) invalid('price must be positive');
  if (path === 'date' || path === 'entry_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args) || !Number.isFinite(Date.parse(args)) || new Date(args).toISOString().slice(0, 10) !== args) invalid(`${path} must be a real YYYY-MM-DD date`);
  }
}

function query(path, args) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) if (value !== undefined) params.set(key, String(value));
  return `${path}${params.size ? `?${params}` : ''}`;
}

function compactResearch(report) {
  const copy = structuredClone(report);
  if(copy.target?.category==='ETF')for(const source of copy.analysis_policy?.excluded_sources??[])delete copy[source];
  const bars = copy.history?.data?.items;
  if (Array.isArray(bars) && bars.length > 5) {
    copy.history.data.returned_count = bars.length;
    copy.history.data.omitted_items = bars.length - 5;
    copy.history.data.items = bars.slice(-5);
  }
  const members = copy.constituents?.data?.items;
  if (Array.isArray(members) && members.length > 10) {
    copy.constituents.data.returned_count = members.length;
    copy.constituents.data.omitted_items = members.length - 10;
    copy.constituents.data.items = members.slice(0,10);
  }
  return copy;
}

function failure(error) {
  return {
    error: { code: error.code ?? (error.name === 'AbortError' ? 'cancelled' : 'request_failed'), message: error.message ?? String(error) },
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.body === undefined ? {} : { body: error.body }),
    ...(error.state === undefined ? {} : { state: error.state }),
  };
}

/** Returns real ctx.tools.register definitions. No host-package imports or fabricated data.
 * Optional timing overrides are intended for deterministic/offline tests.
 */
export function createTools(manager, { pollTimeoutMs = 30000, pollIntervalMs = 400, teamPollMs = 3000, expertCreation } = {}) {
  const request = (method, path, body, exec, timeoutMs) => manager.request(method, path, body, { signal: exec?.signal, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  const tool = (name, description, properties, required, run, timeoutMs = 200000) => {
    const parameters = { type: 'object', properties, required, additionalProperties: false };
    return {
      name, description, parameters, timeoutMs,
      output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec = {}) {
        try {
          if (exec.signal?.aborted) throw Object.assign(new Error('Operation cancelled'), { code: 'cancelled' });
          validate(parameters, args);
          if (JSON.stringify(args).length > 60000) throw Object.assign(new Error('Arguments exceed 60 KiB'), {code:'invalid_arguments'});
          if (args.date !== undefined && args.horizon !== undefined) throw Object.assign(new Error('date and horizon are mutually exclusive'), { code: 'invalid_arguments' });
          return await run(args, exec);
        } catch (error) { return failure(error); }
      },
    };
  };
  return [
    tool('st_market_quotes', '查询同花顺真实 A 股行情快照，返回来源、接口快照时间和缓存状态；不是逐笔成交时间，不修改历史量化概率。',
      { codes: str('1–50个A股代码，英文逗号分隔，例如601088,000001；也支持601088.SH。裸代码由后端核实交易所。') }, ['codes'],
      (args, exec) => {
        const codes = args.codes.split(',').map(c => c.trim().toUpperCase());
        if (!codes.length || codes.length > 50 || codes.some(c => !/^\d{6}(?:\.(?:SH|SZ|BJ))?$/.test(c))) throw Object.assign(new Error('codes须为1–50个有效A股代码，以英文逗号分隔'), {code:'invalid_arguments'});
        return request('GET', query('/api/market/quotes', {codes:codes.join(',')}), undefined, exec, 45000);
      }),
    tool('st_quant_probability', '查询真实量化 JSON：概率为内样本历史频率，并非校准的未来概率；direction=0 时 probability=null，不得补造概率。',
      { code, category, horizon, date: str('未来目标日期 YYYY-MM-DD；与 horizon 二选一。'), recompute: { type: 'boolean', description: '是否跳过预算网格重新计算。' } }, ['code'],
      (args, exec) => request('GET', query('/api/quant/probability', args), undefined, exec)),
    tool('st_expert_analyze', '调用单位专家真实研判；结论必须有 evidence，无证据弃权，未配置模型时如实返回后端错误，不伪造专家意见。',
      { expert_id: str('专家 ID，可先在面板查看专家列表。'), code, category, horizon }, ['expert_id', 'code'],
      ({ expert_id, ...body }, exec) => request('POST', `/api/experts/${encodeURIComponent(expert_id)}/analyze`, body, exec)),
    tool('st_expert_config', '读取、保存或删除专家配置。删除只按用户明确要求执行，保留历史分析；AI创建会话保存前须完成真实web_search、web_fetch并引用来源。',
      { action:{type:'string',enum:['get','save','delete']},id:str('get/delete必填；save省略为新建，填写则更新该ID。'),
        name:str('新建必填：专家名称。'),tag:str('特点或风格。'),
        system_prompt:str('新建必填：完整方法论/系统提示词。'),
        criteria:{type:'array',items:str('判断标准。')},
        tools:{type:'array',items:{type:'string',enum:['quant_snapshot','filings_search','news_search','price_bars','ths_api']}},
        enabled:{type:'boolean'} },['action'],
      async ({action,...body},exec)=>{
        if(action==='get'||action==='delete'){
          if(!body.id||Object.keys(body).some(k=>k!=='id'))throw Object.assign(Error(action+'只接受id'),{code:'invalid_arguments'});
          return request(action==='get'?'GET':'DELETE',`/api/experts/${encodeURIComponent(body.id)}`,undefined,exec);
        }
        if(!body.id&&(!body.name||!body.system_prompt))throw Object.assign(Error('新建必须提供name与system_prompt'),{code:'invalid_arguments'});
        if(!body.id&&!body.tools)body.tools=['quant_snapshot','news_search'];
        await expertCreation?.assertOnlineResearch?.(exec?.agent,body,exec?.signal);
        return request('POST','/api/experts',body,exec);
      }),
    tool('st_expert_creation', '启动、查看或停止独立的 AI 专家创建会话。启动会联网研究并可能产生模型费用；受理回执不代表专家已保存。',
      {action:{type:'string',enum:['start','status','cancel'],description:'默认start。'},requirement:str('start必填：想创建的专家、参考人物或投资风格。'),request_id:str('status/cancel必填；start重试使用原回执值，避免重复建会话。'),archive:{type:'boolean',description:'仅cancel可用；停止后同时归档该创建会话，默认false。'}},[],
      ({action='start',requirement,request_id,archive},exec)=>{
        if(!expertCreation?.start)throw Object.assign(Error('AI 专家创建服务不可用'),{code:'unavailable'});
        if(action==='start'){
          if(!requirement||archive!==undefined)throw Object.assign(Error('start需要requirement且不接受archive'),{code:'invalid_arguments'});
          return expertCreation.start({requirement,...(request_id?{request_id}:{})},exec?.signal);
        }
        if(!request_id||requirement!==undefined||action==='status'&&archive!==undefined)throw Object.assign(Error('该操作需要原request_id'),{code:'invalid_arguments'});
        return action==='status'?expertCreation.status(request_id):expertCreation.cancel(request_id,{archive:archive??false});
      }),
    tool('st_expert_team', '调用真实专家团队并返回共识与证据；缺证据弃权、缺密钥返回错误，不伪造结论。',
      { code, category, horizon, threshold, require_unanimous: { type: 'boolean', description: '是否要求全体一致。' }, expert_ids: { type: 'array', items: str('参与的专家 ID。'), description: '可选专家 ID 列表。' } }, ['code'],
      (args, exec) => request('POST', '/api/experts/team/analyze', args, exec)),
    tool('st_watchlist_add', '将真实标的加入自选股（后端上限 200）；不会执行交易。',
      { code, category }, ['code'], (args, exec) => request('POST', '/api/watchlist', args, exec)),
    tool('st_watchlist_analyze', '提交自选批量研判并有限期轮询；超时返回 job_id 和查询路径，不声称已完成。传 job_id 只查询已有任务，不重复提交。',
      { horizon, threshold, with_experts: { type: 'boolean', description: '是否调用真实专家；缺密钥不会伪造意见。' }, job_id: str('已有任务 ID；设置时仅查询，不能同时传研判参数。') }, [],
      async ({ job_id, ...body }, exec) => {
        if (job_id !== undefined) {
          if (Object.keys(body).length) throw Object.assign(new Error('job_id cannot be combined with analyze parameters'), { code: 'invalid_arguments' });
          return request('GET', `/api/jobs/${encodeURIComponent(job_id)}`, undefined, exec);
        }
        const deadline = Date.now() + pollTimeoutMs;
        const initial = await request('POST', '/api/watchlist/analyze', body, exec, Math.max(1, deadline - Date.now()));
        let job = initial?.job ?? initial;
        const id = job?.id ?? job?.job_id;
        if (typeof id !== 'string' || !id) return { error: { code: 'invalid_job_response', message: 'Backend did not return a job ID' }, body: initial };
        const path = `/api/jobs/${encodeURIComponent(id)}`;
        while (!['done', 'error', 'cancelled', 'interrupted'].includes(job.status)) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) return { job_id: id, job, polling_timed_out: true, query_path: path };
          try { await sleep(Math.min(pollIntervalMs, remaining), exec.signal); }
          catch (error) { return { ...failure(error), job_id: id, query_path: path }; }
          if (Date.now() >= deadline) return { job_id: id, job, polling_timed_out: true, query_path: path };
          try { job = await request('GET', path, undefined, exec, Math.max(1, deadline - Date.now())); }
          catch (error) {
            if (error.code === 'request_timeout') return { job_id: id, job, polling_timed_out: true, query_path: path };
            return { ...failure(error), job_id: id, query_path: path };
          }
        }
        return { job_id: id, job };
      }),
    tool('st_journal_create', '新建并冻结操盘记录与真实后端信号；只记录，不下单，不伪造理由或收益。',
      { code, category, action: { type: 'string', enum: ['buy', 'sell', 'short', 'watch'], description: '记录动作 buy/sell/short/watch。' }, horizon, price: { type: 'number', description: '真实成交价，必须大于 0；未成交可省略。' }, entry_date: str('真实成交日期 YYYY-MM-DD，可回填历史。'), note: { type: 'string', description: '用户记录的备注，可为空。' }, signal: {type:'object', description:'可选，已实际查询的信号快照；direction=0 时 probability 必须为 null，勿编造。'}, reasons: {type:'object', description:'可选，冻结本次分析摘要、证据来源/时间及DSH会话引用；只引用真实已取得的数据。'} }, ['code', 'action'],
      (args, exec) => request('POST', '/api/journal', args, exec)),
    tool('st_journal_review', '读取真实前向收益与信号漂移；待填价格或数据不足时不编造收益。',
      { id: str('操盘记录 ID。') }, ['id'], ({ id }, exec) => request('GET', `/api/journal/${encodeURIComponent(id)}/review`, undefined, exec)),
    tool('st_memory_recall', '从后端持久记忆召回真实记录。',
      { q: str('非空搜索文本。'), scope: str('记忆作用域，后端默认 agent。') }, ['q'],
      (args, exec) => request('GET', query('/api/memory/recall', args), undefined, exec)),
    tool('st_market_history', '读取单只A股的真实日K线，含复权口径、数据时间和缺失值；图表数据不改变本地历史概率。',
      {code, limit:{type:'integer',description:'返回最近5–180根日K，默认60根。'}, adjust:{type:'string',enum:['forward','none','backward'],description:'复权方式，默认forward（前复权）。'}}, ['code'],
      (args,exec)=>{
        if (!/^\d{6}(?:\.(?:SH|SZ|BJ))?$/i.test(args.code) || (args.limit !== undefined && (args.limit<5 || args.limit>180))) throw Object.assign(new Error('代码或K线根数无效'),{code:'invalid_arguments'});
        return request('GET',query('/api/market/history',{...args,limit:args.limit ?? 60}),undefined,exec,45000);
      }),
    tool('st_watchlist', '读取或移除自选股；与看盘工作台共用同一份后端自选。加入标的用st_watchlist_add。',
      {action:{type:'string',enum:['list','remove']},code,category,offset:{type:'integer',description:'list起始偏移，默认0。'},limit:{type:'integer',description:'list返回1–200条，默认50。'}},['action'],
      async ({action,code,category,offset=0,limit=50},exec)=>{
        if (action==='remove') {
          if (!code || !category) throw Object.assign(new Error('remove需要code和category'),{code:'invalid_arguments'});
          return request('DELETE',query('/api/watchlist',{code,category}),undefined,exec);
        }
        if(offset<0 || limit<1 || limit>200) throw Object.assign(new Error('分页范围无效'),{code:'invalid_arguments'});
        const result=await request('GET','/api/watchlist',undefined,exec);
        return {...result,items:result.items.slice(offset,offset+limit),total:result.items.length,has_more:offset+limit<result.items.length};
      }),
    tool('st_journal', '列出、读取或补充研究记录；只能改备注、真实成交价和关闭状态，冻结信号与理由不改。',
      {action:{type:'string',enum:['list','get','update']},id:str('get/update所需的记录ID。'),note:{type:'string',description:'新备注，可为空。'},price:{type:'number',description:'补填真实成交价，必须大于0。'},closed:{type:'boolean'},offset:{type:'integer',description:'list起始偏移，默认0。'},limit:{type:'integer',description:'list返回1–100条，默认20。'}},['action'],
      async ({action,id,note,price,closed,offset=0,limit=20},exec)=>{
        if(action==='list'){
          if(offset<0 || limit<1 || limit>100) throw Object.assign(new Error('分页范围无效'),{code:'invalid_arguments'});
          const result=await request('GET','/api/journal',undefined,exec);
          return {items:result.items.slice(offset,offset+limit).map(r=>({id:r.id,symbol:r.symbol,action:r.action,horizon:r.horizon,price:r.price,closed:r.closed,note:r.note,created_at:r.created_at})),total:result.items.length,has_more:offset+limit<result.items.length};
        }
        if(!id) throw Object.assign(new Error('get/update需要id'),{code:'invalid_arguments'});
        const path='/api/journal/'+encodeURIComponent(id);
        if(action==='get')return request('GET',path,undefined,exec);
        const body=Object.fromEntries(Object.entries({note,price,closed}).filter(([,v])=>v!==undefined));
        if(!Object.keys(body).length)throw Object.assign(new Error('至少提供一个可修改字段'),{code:'invalid_arguments'});
        return request('PATCH',path,body,exec);
      }),
    tool('st_research_catalog', '搜索本地研究标的，或读取可调用的后端专家ID/名称；无历史数据时标的为空，行情仍可按代码查。',
      {kind:{type:'string',enum:['symbols','experts']},q:{type:'string',description:'标的代码或名称关键词；symbols必填。'},limit:{type:'integer',description:'返回1–50项，默认20。'}},['kind'],
      async ({kind,q,limit=20},exec)=>{
        if(limit<1 || limit>50 || (kind==='symbols' && !q?.trim()))throw Object.assign(new Error('缺少关键词或limit无效'),{code:'invalid_arguments'});
        const data=await request('GET',kind==='symbols'?query('/api/symbols/search',{q,limit}):'/api/experts',undefined,exec);
        return {items:data.items.slice(0,limit).map(row=>kind==='symbols'?row:{id:row.id,name:row.name,tag:row.tag,enabled:row.enabled}),has_more:data.items.length>limit};
      }),
    tool('st_job', '查询或取消后端研究任务；cancel只停止该任务，不发送证券订单。',
      {action:{type:'string',enum:['get','cancel']},id:str('研究任务ID。')},['action','id'],
      ({action,id},exec)=>request(action==='get'?'GET':'POST','/api/jobs/'+encodeURIComponent(id)+(action==='cancel'?'/cancel':''),undefined,exec)),
    tool('st_backend_retry', '显式重试启动失败的本地Super Trader后端；健康或外部后端不会被终止。',
      {},[],()=>manager.retryBackend()),
    tool('st_symbol_search', '按代码或名称查真实A股目录，不要求本地历史数据。',
      {q:str('股票代码或中文名关键词，1–60字。'),limit:{type:'integer',description:'最多1–50项，默认20。'}},['q'],
      (args,exec)=>{if(args.q.trim().length>60 || args.limit!==undefined && (args.limit<1 || args.limit>50))throw Object.assign(new Error('搜索参数无效'),{code:'invalid_arguments'});return request('GET',query('/api/market/search',args),undefined,exec,45000);}),
    tool('st_screen_stocks', '启动AI风格专家各自检索、取证和选股，会调用模型并可能计费；基本面与量化仅辅助，不按模型覆盖预筛。返回任务ID供st_job查询/取消，报告实际探索范围，不执行交易。',
      {scope:{type:'string',enum:['market','watchlist','sector'],description:'允许探索全A股/自选/指定板块，默认market；不等于承诺逐股完整分析。'},sector:str('scope=sector时必填目录给出的完整指数代码。'),expert_ids:{type:'array',items:str('已启用的专家ID。'),description:'可选1–20位独立选股专家；省略用已启用团队。'},brief:{type:'string',description:'可选投资偏好或关注线索，最多1000字。'},limit_per_expert:{type:'integer',description:'每位最多1–10只研究候选，默认5；证据不足可少于上限或为空。'}},[],
      (args,exec)=>{
        if(args.limit_per_expert!==undefined && (args.limit_per_expert<1 || args.limit_per_expert>10) || args.scope==='sector' && !/^\d{6}\.(?:SH|SZ|TI)$/.test(args.sector || '') || args.expert_ids!==undefined && (args.expert_ids.length<1 || args.expert_ids.length>20) || args.brief!==undefined && Array.from(args.brief).length>1000)throw Object.assign(new Error('专家选股范围、人数或偏好参数无效'),{code:'invalid_arguments'});
        return request('POST','/api/research/select',{...args,scope:args.scope ?? 'market',limit_per_expert:args.limit_per_expert ?? 5},exec,30000);
      }),
    tool('st_stock_research', '读取个股/ETF投研简报及截至日；ETF含基金资料、净值、费率、披露持仓与区间业绩。K线仅末5根，历史表现不是未来概率。',
      {code},['code'],async(args,exec)=>{
        if(!/^\d{6}$/.test(args.code))throw Object.assign(new Error('请输入六位A股代码'),{code:'invalid_arguments'});
        return compactResearch(await request('GET',query('/api/research/stock',args),undefined,exec,180000));
      }),
    tool('st_sector_research', '浏览真实行业/概念目录或读取板块趋势、量化覆盖与成分样本；样本强弱不冒充整个板块，不调用模型。',
      {action:{type:'string',enum:['catalog','report']},thscode:str('report必填，目录返回的完整指数代码，勿猜后缀。'),tag:{type:'string',enum:['industry','cn_concept','region','tszs'],description:'catalog类型，默认industry。'},q:{type:'string',description:'catalog名称关键词，可省略。'},offset:{type:'integer',description:'catalog起始偏移，默认0。'},limit:{type:'integer',description:'catalog返回1–50项，默认20。'}},['action'],
      async({action,thscode,...args},exec)=>{
        if(action==='report'){
          if(!/^\d{6}\.(?:SH|SZ|TI)$/.test(thscode || ''))throw Object.assign(new Error('缺少有效的板块thscode'),{code:'invalid_arguments'});
          return compactResearch(await request('GET',query('/api/research/sector',{thscode}),undefined,exec,180000));
        }
        if(args.limit!==undefined && (args.limit<1 || args.limit>50) || args.offset!==undefined && args.offset<0)throw Object.assign(new Error('目录分页参数无效'),{code:'invalid_arguments'});
        return request('GET',query('/api/market/sectors',{...args,limit:args.limit ?? 20}),undefined,exec,45000);
      }),
    tool('st_team_research', '启动结合多周期量化与真实行情证据的专家趋势会诊，会调用已配置模型并可能计费；默认等待任务终态后返回完整结果，wait=false 才立即返回任务ID。不执行交易。',
      {kind:{type:'string',enum:['stock','sector']},code:str('stock为六位股票代码；sector为目录给出的完整指数thscode。'),expert_ids:{type:'array',items:str('从专家目录取得的真实ID。'),description:'可选1–20位专家；省略使用已启用团队。'},wait:{type:'boolean',description:'默认true：轮询到任务完成/失败/取消后返回；false：只提交并返回job。'}},['kind','code'],
      async(args,exec)=>{
        if(!(args.kind==='stock'?/^\d{6}$/:/^\d{6}\.(?:SH|SZ|TI)$/).test(args.code) || args.expert_ids!==undefined && (args.expert_ids.length<1 || args.expert_ids.length>20))throw Object.assign(new Error('研究对象或专家列表无效'),{code:'invalid_arguments'});
        const body={kind:args.kind,code:args.code,...(args.expert_ids===undefined?{}:{expert_ids:args.expert_ids})};
        const initial=await request('POST','/api/research/team',body,exec,30000);
        if(args.wait===false)return initial;
        const job=initial?.job??initial, id=job?.id;
        if(typeof id!=='string'||!id)return initial;
        const path='/api/jobs/'+encodeURIComponent(id), deadline=Date.now()+1800000;
        let current=job;
        const terminal=['completed','succeeded','done','failed','error','cancelled','canceled','interrupted'];
        while(!terminal.includes(current.status)){
          const remaining=deadline-Date.now();
          if(remaining<=0)return {...initial,job:current,polling_timed_out:true,query_path:path};
          try{await sleep(Math.min(teamPollMs,remaining),exec.signal);}catch(error){return {...failure(error),job_id:id,job:current,query_path:path};}
          try{current=await request('GET',path,undefined,exec,Math.max(1000,deadline-Date.now()));}
          catch(error){return {...failure(error),job_id:id,job:current,query_path:path};}
        }
        return {...initial,job:current,job_id:id};
      }, 1850000),
    tool('st_factor_predict', '用量化因子规则预测股票未来1–20根日K的方向，并给出全历史回测的最终准确率、覆盖率与逐窗口表现；同一时间框架共用一条规则，历史频率不是未来概率。',
      {code,category:{type:'string',enum:['个股','ETF','指数'],description:'默认个股；同号代码按类别区分。'},timeframe:{type:'string',enum:['1d'],description:'K线时间框架；当前仅支持日线1d。'},rule_id:str('可选；指定种子或已提交规则ID，缺省用当前最优规则。')},['code'],
      async(args,exec)=>{
        if(!/^\d{6}$/.test(args.code) || args.timeframe!==undefined && args.timeframe!=='1d')throw Object.assign(new Error('请输入六位A股代码，时间框架当前仅支持1d'),{code:'invalid_arguments'});
        const path=args.rule_id
          ? query('/api/factors/backtest',{code:args.code,rule_id:args.rule_id,timeframe:args.timeframe ?? '1d',category:args.category})
          : query('/api/factors/stock',{code:args.code,timeframe:args.timeframe ?? '1d',category:args.category});
        const result=await request('GET',path,undefined,exec,60000);
        if(result.rules)result.rules=result.rules.slice(0,5);
        return result;
      }),
    tool('st_factor_code', '执行模型自己写的因子函数并回测：必须定义 factor(df)，返回与K线等长的数值数组（>0看涨、<0看跌、0/NaN中性）。代码在隔离子进程运行，禁止文件、网络、进程与反射；引擎做无前视检查后按1–20根合并给最终准确率。',
      {code,source:str('Python源码，必须包含 def factor(df)：可用 df["close"] 等列与 F 纯函数（rolling_mean/rsi/atr/zscore/where/clip 等）；禁止 import、open、文件/网络。'),timeframe:{type:'string',enum:['1d'],description:'当前仅支持日线1d。'},neutral_band:{type:'number',description:'|信号|≤该值记中性，0–5，默认0。'}},['code','source'],
      async(args,exec)=>{
        if(!/^\d{6}$/.test(args.code) || args.timeframe!==undefined && args.timeframe!=='1d' || args.source.length>20000 || args.neutral_band!==undefined && (args.neutral_band<0 || args.neutral_band>5))throw Object.assign(new Error('代码、时间框架或中性带参数无效'),{code:'invalid_arguments'});
        return request('POST','/api/factors/code',{code:args.code,source:args.source,timeframe:args.timeframe ?? '1d',neutral_band:args.neutral_band ?? 0},exec,120000);
      }),
    tool('st_factor_research', '启动LLM共同研究因子候选池并对所有本地标的并行回测，各标的独立保留最佳规则；start会调用模型并可能计费，不默认抽样，也不做横截面排名。universe/results只查询。任务用st_job查进度或取消。',
      {action:{type:'string',enum:['start','universe','results']},scope:{type:'string',enum:['all','targets'],description:'start默认all；targets仅用于明确限定的typedID子集。'},targets:{type:'array',items:str('category:code，例如个股:601088、ETF:510300。')},workers:{type:'integer',description:'评测进程数1–8，默认4；只影响本地回测并行度，不增加模型调用。'},max_trials:{type:'integer',description:'新尝试规则数（评测次数），正整数，不设上限；默认5。'},brief:{type:'string',description:'可选研究要求，最多2000字。'},job_id:str('results可按任务ID筛选。'),offset:{type:'integer',description:'results偏移，默认0。'},limit:{type:'integer',description:'results数量1–200，默认50。'},q:{type:'string',description:'results按名称/代码搜索。'}},['action'],
      ({action,...args},exec)=>{
        if(action==='universe')return request('GET','/api/factors/universe',undefined,exec,30000);
        if(action==='results')return request('GET',query('/api/factors/results',{job_id:args.job_id,offset:args.offset,limit:args.limit,q:args.q}),undefined,exec,30000);
        const body=Object.fromEntries(Object.entries(args).filter(([k])=>['scope','targets','workers','max_trials','brief'].includes(k)));
        return request('POST','/api/factors/research',body,exec,30000);
      }),
    tool('st_doctor', '诊断本地后端状态、模型配置与修复指引；日志脱敏，不返回密钥。',
      {}, [], (_args, exec) => manager.doctor({ signal: exec.signal })),
    tool('st_session_list', '列出本机所有 DSH 会话（id、工作目录、更新时间）；只读，用于找到要读取的会话 id，不受当前工作区限制。',
      { q: str('可选：按 session id 片段过滤。'), limit: { type: 'integer', description: '返回条数 1–200，默认 30。' } }, [],
      async (args) => {
        const limit = args.limit === undefined ? 30 : args.limit;
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw Object.assign(new Error('limit 须为 1–200'), {code:'invalid_arguments'});
        return listSessions({ limit, q: args.q || '' });
      }, 60000),
    tool('st_session_read', '按 session id 读取任意 DSH 会话的完整消息（只读，直接解压本机会话日志）；返回用户、助手、工具调用的消息列表，可用于复盘其他会话。',
      { session_id: str('完整会话 id，例如 session-0958abb2-6fcb-428f-afac-005b68d17226。'),
        offset: { type: 'integer', description: '消息起始下标，默认 0。' },
        limit: { type: 'integer', description: '返回条数 1–200，默认 40。' },
        include_tools: { type: 'boolean', description: '是否包含工具调用与结果，默认 true。' },
        max_chars: { type: 'integer', description: '每条消息最大字符数 200–20000，默认 4000。' } }, ['session_id'],
      async (args) => {
        if (!SESSION_ID.test(String(args.session_id || ''))) throw Object.assign(new Error('session_id 无效'), {code:'invalid_arguments'});
        const offset = args.offset === undefined ? 0 : args.offset;
        const limit = args.limit === undefined ? 40 : args.limit;
        const maxChars = args.max_chars === undefined ? 4000 : args.max_chars;
        if (!Number.isInteger(offset) || offset < 0) throw Object.assign(new Error('offset 须为非负整数'), {code:'invalid_arguments'});
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw Object.assign(new Error('limit 须为 1–200'), {code:'invalid_arguments'});
        if (!Number.isInteger(maxChars) || maxChars < 200 || maxChars > 20000) throw Object.assign(new Error('max_chars 须为 200–20000'), {code:'invalid_arguments'});
        const session = await readSession(String(args.session_id));
        const page = toMessages(session.events, { offset, limit, includeTools: args.include_tools !== false, maxChars });
        return { session_id: args.session_id, cwd: session.header.cwd || null, created_at: session.header.createdAt || null,
                 updated_at: session.updatedAt, bytes: session.size, total_messages: page.total,
                 offset: page.offset, limit: page.limit, messages: page.messages };
      }, 120000),
  ];
}
