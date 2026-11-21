// Same-origin transport only. Business rules remain in the existing backend.
export const ROOT = '/dsh-super-trader';
export const READY = new Set(['running', 'external']);
const READ = /^\/api\/(?:status|portfolios|reviews(?:\/(?!sync$)[^/]+)?|market\/(?:status|quotes|fund-quote|history|search|sectors)|research\/(?:screen|quant-screen|stock|sector)|factors\/(?:stock|rules|library|backtest|universe|results|research\/[^/]+\/transcript)|symbols\/search|quant\/probability|experts|watchlist|journal(?:\/export|\/[^/]+(?:\/review)?)?|jobs(?:\/[^/]+(?:\/stream)?)?|memory(?:\/recall|\/stats)?)$/;
const WRITE = /^\/api\/(?:reviews\/(?:sync|[^/]+\/judge)|factors\/(?:code|research)|research\/(?:team|select)|watchlist(?:\/analyze)?|experts(?:\/(?:[^/]+|team)\/analyze)?|journal(?:\/[^/]+)?|jobs\/[^/]+\/cancel)$/;
export function allowedEndpoint(method, pathname) {
  if (method === 'GET') return READ.test(pathname);
  if (method === 'POST') return WRITE.test(pathname);
  if (method === 'PATCH') return /^\/api\/journal\/[^/]+$/.test(pathname);
  if (method === 'DELETE') return /^\/api\/(?:watchlist|reviews\/[^/]+|journal\/[^/]+|experts\/[^/]+)$/.test(pathname);
  return false;
}
export function sendJson(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
export function trusted(req, origin) {
  // No ambient public-web authority: reject foreign origins, cross-site fetches and Host rebinding.
  try {
    const expected = new URL(origin);
    if (req.headers.host !== expected.host) return false;
    if (req.headers.origin && new URL(req.headers.origin).origin !== expected.origin) return false;
    return !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']);
  } catch { return false; }
}
async function bodyJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw Object.assign(new Error('请求体超过64 KiB'), {status:413});
    chunks.push(chunk);
  }
  if (!size) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求体必须是JSON'), {status:400}); }
}
export function createHandlers(manager, origin, fetchImpl = globalThis.fetch, expertCreation, sectorAnalysis, stockAnalysis, watchlistAnalysis, selectionAnalysis, integrationStatus, dailyReview) {
  const integration = async (req,res) => {
    if (!trusted(req,origin())) return sendJson(res,403,{error:'请求来源不同源，已拒绝'});
    if (req.method !== 'GET') return sendJson(res,405,{error:'GET required'});
    let data;
    try { data = typeof integrationStatus === 'function' ? integrationStatus() : {available:false,servers:[],preset:[]}; }
    catch (error) { data = {available:false,servers:[],preset:[],error:String(error?.message||error)}; }
    return sendJson(res,200,data);
  };
  const base = async (req,res) => {
    if (!trusted(req,origin())) return sendJson(res,403,{error:'仅允许宿主同源请求'});
    if (req.method !== 'GET') return sendJson(res,405,{error:'GET required'});
    return sendJson(res,200,{...manager.getState(), apiBase:ROOT+'/backend'});
  };
  const proxy = async (req,res) => {
    if (!trusted(req,origin())) return sendJson(res,403,{error:'仅允许宿主同源请求'});
    const cancel = new AbortController();
    const close = () => { if (!res.writableEnded) cancel.abort(); };
    res.once('close',close);
    try {
      const url = new URL(req.url,origin());
      const prefix = ROOT+'/backend';
      const pathname = url.pathname.slice(prefix.length);
      if (!url.pathname.startsWith(prefix+'/') || !allowedEndpoint(req.method,pathname)) return sendJson(res,404,{error:'未开放此接口'});
      const body = ['POST','PATCH'].includes(req.method) ? await bodyJson(req) : undefined;
      const path = pathname+url.search;
      // Stream/csv preserve wire bytes; other calls share manager.request with agent tools.
      if (req.method === 'GET' && (pathname.endsWith('/stream') || (pathname === '/api/journal/export' && url.searchParams.get('fmt') === 'csv'))) {
        await manager.ensureBackend();
        const state = manager.getState();
        if (!READY.has(state.phase)) return sendJson(res,503,{error:'后端未就绪',state});
        const upstream = await fetchImpl(state.baseUrl+path,{signal:AbortSignal.any([cancel.signal,AbortSignal.timeout(300000)]),redirect:'error'});
        res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type') || 'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        if (upstream.body) for await (const chunk of upstream.body) {
          if (!res.write(chunk)) await new Promise((resolve,reject) => {
            const done=()=>{res.off('close',closed);resolve();};
            const closed=()=>{res.off('drain',done);reject(new Error('closed'));};
            res.once('drain',done);res.once('close',closed);
          });
        }
        res.end();
      } else {
        const isReviewJudge = req.method === 'POST' && /^\/api\/reviews\/[^/]+\/judge(?:\?|$)/.test(path);
        const data = await manager.request(req.method,path,body,{signal:cancel.signal,timeoutMs:isReviewJudge?260000:180000});
        sendJson(res,200,data);
      }
    } catch (error) {
      if (res.headersSent) { if (!res.writableEnded) res.end(); }
      else sendJson(res,error.status || 503,error.body ?? {error:error.message || '后端请求失败',code:error.code || 'backend_unavailable'});
    } finally { res.off('close',close); }
  };
  const retry = async (req,res) => {
    if (!trusted(req,origin())) return sendJson(res,403,{error:'仅允许宿主同源请求'});
    if (req.method !== 'POST') return sendJson(res,405,{error:'POST required'});
    try { sendJson(res,200,await manager.retryBackend()); }
    catch (error) { sendJson(res,error.status || 503,{error:error.message || '后端重试失败',code:error.code || 'backend_unavailable'}); }
  };
  const createExpert = async (req,res) => {
    if(!trusted(req,origin()))return sendJson(res,403,{error:'仅允许宿主同源请求'});
    if(req.method!=='POST')return sendJson(res,405,{error:'POST required'});
    const cancel=new AbortController(),close=()=>{if(!res.writableEnded)cancel.abort();};
    res.once('close',close);
    try{
      const body=await bodyJson(req);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['requirement','request_id'].includes(k)))return sendJson(res,400,{error:'只接受专家需求与请求标识'});
      if(!expertCreation?.start)return sendJson(res,503,{error:'当前 DSH 未提供 AI 专家创建服务'});
      return sendJson(res,200,await expertCreation.start(body,cancel.signal));
    }catch(error){sendJson(res,error.status||503,error.body??{error:error.message||'AI 专家创建未启动'});}
    finally{res.off('close',close);}
  };
  const createSector = async (req,res) => {
    if(!trusted(req,origin()))return sendJson(res,403,{error:'仅允许宿主同源请求'});
    if(req.method!=='POST')return sendJson(res,405,{error:'POST required'});
    const cancel=new AbortController(),close=()=>{if(!res.writableEnded)cancel.abort();};
    res.once('close',close);
    try{
      const body=await bodyJson(req);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['thscode','name','request_id'].includes(k)))
        return sendJson(res,400,{error:'只接受板块代码、名称与请求标识'});
      if(!sectorAnalysis?.start)return sendJson(res,503,{error:'当前 DSH 未提供板块分析会话服务'});
      return sendJson(res,200,await sectorAnalysis.start(body,cancel.signal));
    }catch(error){sendJson(res,error.status||503,error.body??{error:error.message||'AI 板块分析未启动'});}
    finally{res.off('close',close);}
  };
  const createStock = async (req,res) => {
    if(!trusted(req,origin()))return sendJson(res,403,{error:'仅允许宿主同源请求'});
    if(req.method!=='POST')return sendJson(res,405,{error:'POST required'});
    const cancel=new AbortController(),close=()=>{if(!res.writableEnded)cancel.abort();};
    res.once('close',close);
    try{
      const body=await bodyJson(req);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['code','name','request_id'].includes(k)))
        return sendJson(res,400,{error:'只接受个股代码、名称与请求标识'});
      if(!stockAnalysis?.start)return sendJson(res,503,{error:'当前 DSH 未提供个股分析会话服务'});
      return sendJson(res,200,await stockAnalysis.start(body,cancel.signal));
    }catch(error){sendJson(res,error.status||503,error.body??{error:error.message||'AI 个股分析未启动'});}
    finally{res.off('close',close);}
  };

  const createWatchlist = async (req,res) => {
    if(!trusted(req,origin()))return sendJson(res,403,{error:'仅允许宿主同源请求'});
    if(req.method!=='POST')return sendJson(res,405,{error:'POST required'});
    const cancel=new AbortController(),close=()=>{if(!res.writableEnded)cancel.abort();};
    res.once('close',close);
    try{
      const body=await bodyJson(req);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['items','request_id'].includes(k)))
        return sendJson(res,400,{error:'只接受选中标的列表与请求标识'});
      if(!watchlistAnalysis?.start)return sendJson(res,503,{error:'当前 DSH 未提供自选股分析会话服务'});
      return sendJson(res,200,await watchlistAnalysis.start(body,cancel.signal));
    }catch(error){sendJson(res,error.status||503,error.body??{error:error.message||'AI 自选股分析未启动'});}
    finally{res.off('close',close);}
  };

  const createSelection = async (req,res) => {
    if(!trusted(req,origin()))return sendJson(res,403,{error:'仅允许宿主同源请求'});
    if(req.method!=='POST')return sendJson(res,405,{error:'POST required'});
    const cancel=new AbortController(),close=()=>{if(!res.writableEnded)cancel.abort();};
    res.once('close',close);
    try{
      const body=await bodyJson(req);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['scope','sector','expert_ids','brief','limit_per_expert','request_id'].includes(k)))
        return sendJson(res,400,{error:'只接受选股范围、专家、线索与请求标识'});
      if(!selectionAnalysis?.start)return sendJson(res,503,{error:'当前 DSH 未提供专家选股会话服务'});
      return sendJson(res,200,await selectionAnalysis.start(body,cancel.signal));
    }catch(error){sendJson(res,error.status||503,error.body??{error:error.message||'AI 专家选股未启动'});}
    finally{res.off('close',close);}
  };
  // Display preference only (light | dark | system), pushed by the desktop client. Held in memory:
  // the client re-announces it on every start, and it is never written into report records.
  const appearanceState = {preference:null};
  const reportTheme = () => appearanceState.preference==='light'||appearanceState.preference==='dark'?appearanceState.preference:'auto';
  const appearance = async (req,res) => {
    if(!trusted(req,origin()))return sendJson(res,403,{error:'仅允许宿主同源请求'});
    if(!['GET','POST'].includes(req.method))return sendJson(res,405,{error:'GET or POST required'});
    try {
      if(req.method==='POST'){
        const body=await bodyJson(req);
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='preference')||!['light','dark','system'].includes(body.preference))
          return sendJson(res,400,{error:'只接受 preference: light | dark | system'});
        appearanceState.preference=body.preference;
      }
      return sendJson(res,200,{preference:appearanceState.preference??'system',synced:appearanceState.preference!==null,reportTheme:reportTheme()});
    } catch(error) {return sendJson(res,error.status||400,{error:error.message||'无法读取外观偏好'});}
  };
  const dailyReviewIndex = async (req,res) => {
    if(!trusted(req,origin()))return sendJson(res,403,{error:'仅允许宿主同源请求'});
    if(!['GET','POST'].includes(req.method))return sendJson(res,405,{error:'GET or POST required'});
    if(!dailyReview)return sendJson(res,503,{error:'当前 DSH 未提供日复盘会话服务'});
    try {
      if(req.method==='GET')return sendJson(res,200,await dailyReview.history());
      const body=await bodyJson(req);
      // `restart` is the ONLY accepted field: it replaces an unopenable conversation
      // (for example one the user archived) instead of reusing it.
      if(body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='restart')||
        (body.restart!==undefined&&typeof body.restart!=='boolean')))return sendJson(res,400,{error:'立即复盘只接受可选的 restart 布尔值'});
      return sendJson(res,200,await dailyReview.start({restart:body?.restart===true}));
    } catch(error) {return sendJson(res,error.status||503,error.body??{error:error.message||'无法访问复盘会话'});}
  };
  const dailyReviewReport = async (req,res) => {
    if(!trusted(req,origin()))return sendJson(res,403,{error:'仅允许宿主同源请求'});
    if(req.method!=='GET')return sendJson(res,405,{error:'GET required'});
    const url=new URL(req.url,origin());
    const date=url.pathname.slice((ROOT+'/daily-review/report/').length);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return sendJson(res,404,{error:'日报不存在'});
    // Explicit whitelist override wins; otherwise the preference the desktop client last synced
    // (so original, parameterless links follow the user's choice); otherwise the OS scheme.
    const asked=url.searchParams.get('theme');
    const theme=['light','dark','auto'].includes(asked)?asked:reportTheme();
    try {
      if(!dailyReview)return sendJson(res,503,{error:'当前 DSH 未提供日复盘会话服务'});
      const html=await dailyReview.html(date,theme);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; sandbox"});
      res.end(html);
    } catch(error) {return sendJson(res,error.status||503,{error:error.message||'无法打开日报'});}
  };
  return {base,proxy,retry,integration,createExpert,createSector,createStock,createWatchlist,createSelection,dailyReviewIndex,dailyReviewReport,appearance};
}
