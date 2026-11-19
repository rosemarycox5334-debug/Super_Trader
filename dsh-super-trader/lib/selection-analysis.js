import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {REVIEW_REPORT_NOTE} from './review-report.js';

const WORKSPACE_TITLE='Ai专家选股';
const fail=(message,status=503,body)=>{const e=Object.assign(new Error(message),{status});if(body)e.body=body;return e;};
const SECTOR=/^[0-9]{6}\.[A-Z][A-Z0-9]{1,7}$/;

export function normalizeSelectionRequest(body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw fail('选股参数格式无效',400);
  const scope=String(body.scope??'market');
  if(!['market','watchlist','sector'].includes(scope))throw fail('选股范围只支持 market / watchlist / sector',400);
  let sector=body.sector==null?'':String(body.sector).trim().toUpperCase();
  if(scope==='sector'){
    if(!SECTOR.test(sector))throw fail('板块选股需要完整指数 thscode，例如 881101.TI',400);
  }else if(sector)throw fail('只有板块范围允许指定 sector',400);
  const brief=String(body.brief??'').trim();
  if(Array.from(brief).length>1000)throw fail('研究线索最多 1000 字',400);
  const limit=body.limit_per_expert==null?5:body.limit_per_expert;
  if(!Number.isInteger(limit)||limit<1||limit>10)throw fail('每位专家候选数须为 1..10 的整数',400);
  let ids=[];
  if(body.expert_ids!=null){
    if(!Array.isArray(body.expert_ids)||!body.expert_ids.length||body.expert_ids.length>20)
      throw fail('expert_ids 须为 1..20 位专家',400);
    ids=body.expert_ids.map(id=>String(id));
    if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw fail('expert_ids 不可重复或为空',400);
  }
  return {scope,sector,brief,limit_per_expert:limit,expert_ids:ids};
}

function buildSelfWatchPrompt(expertLine){
  return `# AI 自选股逐只分析：我的自选股

用户已在“专家选股”页选择“自选股”。本次**不是海选名单**，而是把自选里的**每一只都评一遍**（个股、ETF、LOF 都要），请现在直接完成，不要等待用户再次发送，不要新建工作区或会话，也不要向用户提问。

## 第一步：取当前自选
调用 st_watchlist({"action":"list"})，拿到真实的 code / category / name。以工具返回为唯一事实来源，不要凭记忆或旧结果。

## 第二步：逐只深度研判（一只都不能跳）
对自选里的每一只依次执行：
1. st_stock_research({"code":"代码","category":"类别"})，类别原样传（个股 / ETF / LOF）。
2. st_team_research({"kind":"stock","code":"代码","wait":true})，不要传 expert_ids，${expertLine}；等到任务终态。
逐只串行执行，不要把“任务受理”或中间进度当成完成。

## 第三步：逐只输出
每一只单独一节，先给一句话结论：**值得观察 / 可以分批建仓 / 暂不参与**；然后包含：
- 专家票型（看多/看空/观望）与信心度（高/中/低，不是胜率）；
- 理由（完整）；
- 依据：数据来源与字段路径 → 实际数值 → 含义；字段名要翻成中文再展示，例如 parent_holder_net_profit→归母净利润、act_cash_flow_net→经营活动现金流量净额、pe_ttm→滚动市盈率；不要直接贴英文键名，需要时可写成“归母净利润（parent_holder_net_profit）”。
- 交易策略：操作、入场触发条件与价位、仓位、止损、目标、持有周期、放弃条件；
- 情景展望与风险。
**A股默认不能做空**：看空只写不买入、减仓或清仓、回避、观望。
**专家看不到量化因子**：专家小节不得出现因子方向/准确率；只有团队结果 factor_view 可用且通过 55% 门槛时才在该只末尾写因子校验，否则整段省略。

## 第四步：横向汇总
一张表：名称、代码、类别、结论、几位专家看多、关键价位、主要风险；说明排序只是观点整理，不是收益承诺。
对结论最积极的 1–3 只，给**可直接执行**的计划（方向与前提、分批位次、止损、目标与减仓、持有周期、放弃条件），价位必须来自工具返回的真实数据。

## 通用要求
${REVIEW_REPORT_NOTE}
全部用中文；不得输出“未提供、空数组、无依据”这类占位词；因子或量化没有可用成果时静默跳过，正文任何位置都不要写“因子不可用、量化无覆盖、无成果”这类说明。不得编造专家理由或证据；不预测具体点位承诺收益、不代客下单。
拿不到数据就如实写明并继续评下一只，不要反问用户，也不要空手结束。`;
}

export function buildSelectionPrompt(params){
  const scopeText=params.scope==='market'?'全A股':params.scope==='watchlist'?'自选股':`板块 ${params.sector}`;
  const expertLine=params.expert_ids.length
    ? `使用指定专家 ID：${params.expert_ids.join(', ')}（不要擅自增减）`
    : '不要传 expert_ids，使用全部启用专家';
  if(params.scope==='watchlist')return buildSelfWatchPrompt(expertLine);
  return `# AI 专家选股：${scopeText}

用户已在“专家选股”页发起本次选股。请现在直接完成，不要等待用户再次发送，也不要新建工作区或会话。

## 第一步：启动真实选股任务
调用 st_screen_stocks，参数：
- scope: "${params.scope}"${params.scope==='sector'?`\n- sector: "${params.sector}"`:''}
- limit_per_expert: ${params.limit_per_expert}
- brief: ${JSON.stringify(params.brief || '')}
- ${expertLine}

它会让每位专家各自在目录里探索、取证并形成名单，会真实调用模型并可能计费。返回 job id 后进入下一步。

## 第二步：等任务到终态
用 st_job({"action":"get","id":"<job id>","wait":true,"timeout_ms":600000}) 在进程内等到终态（完成/失败/取消）。返回是精简结果（已去掉整份行情报告与原始证据数据），直接阅读即可；不要用命令行 sleep 轮询，不要写脚本解析结果，也不要把结果复制成文件。若仍返回 running，再调用一次同样的 wait。中间进度不是结果，不要把“queued/running”写成分析结论；也不要在同一 job 上重复提交。任务可取消，取消时保留已有部分结果。

## 第二步之后的分支：选股池为空时不要提问，改做逐只分析
“专家选股”只在 A 股个股里选；如果你的自选股全是 ETF/LOF，st_screen_stocks 会返回 universe.total = 0，这是正常现象，不是故障。
出现这种情况时**不要向用户提问、不要空手结束**，直接改走下面的路径：
1. 调用 st_watchlist({"action":"list"}) 取当前自选（含代码、名称、类别）；
2. 对每一只自选标的（个股/ETF/LOF 都要）调用 st_stock_research({"code":"代码","category":"类别"})，再调用 st_team_research({"kind":"stock","code":"代码","wait":true}) 做逐只深度研判；
3. 按下面的“逐位专家展示”要求逐只展开，并对每只给出结论：**值得观察 / 可以分批建仓 / 暂不参与**，说明理由、关键价位与风险；
4. 最后在汇总里明确写：本次因为自选股不含 A 股个股，未走“专家选股”名单流程，改为逐只深度分析；这不是缺陷，也不是数据缺失。

## 第三步：逐位专家展示
每位专家单独一节，必须包含：
- 专家名称与候选（代码 + 名称）；
- 每位专家的选股思路（selection_approach）；
- 每只候选：入选理由、为什么符合该专家理念、信心度（高/中/低，不是胜率）、风险、缺失证据（missing_evidence）、依据（source_id 与 ref 指向的真实数值，字段名要翻成中文再展示，例如 parent_holder_net_profit→归母净利润、act_cash_flow_net→经营活动现金流量净额、pe_ttm→滚动市盈率；不要直接贴英文键名，需要时可写成“归母净利润（parent_holder_net_profit）”。 ）；
- 该专家排除的股票及原因（rejected），没有就省略；
- 若该专家没有候选，才写“弃权说明：…”并给出 abstained_reason 与已看到的依据；**有候选时不要叫弃权**，如需交代覆盖范围，写成“覆盖说明：…”。
不要替专家补造理由或证据；没有 evidence 的候选直接说明证据不足，不要编路径。

## 第四步：汇总
- 共同看中的标的（多位专家重叠）与分歧；
- 一张表：名称、代码、被几位专家选中、共同关注点、主要风险；
- 说明这只是配置投资理念的 AI 研究，不是全市场扫描或最优排名，不是买入建议；
- 对多处重叠或证据最扎实的 1–3 只，给一段**可直接执行**的观察/交易计划（方向与前提、分批触发位次、止损、目标与减仓、持有周期、放弃条件）；价位必须来自工具返回的真实行情，不得编造。

## 通用要求
${REVIEW_REPORT_NOTE}
不要用提问阻断流程：拿不到名单就按上面的分支自己完成分析，把不确定写成“需要盘中验证”，而不是反问用户。
全部用中文，除代码、字段路径外不出现英文字段名；把 confidence 写成信心度；不得输出“未提供、空数组、无依据”这类占位词，字段缺失就整段省略。因子或量化没有可用成果时静默跳过，正文任何位置都不要写“因子不可用、量化无覆盖、无成果”这类说明。
量化因子只作辅助（已保存的 LLM 同规则成果，内样本历史频率），没有成果就不提因子；不预测具体点位承诺收益、不代客下单。`;
}

export class SelectionAnalysisService {
  constructor({workspaces,sessions,workingDirectory,uuid=randomUUID,applyPermission}){
    Object.assign(this,{workspaces,sessions,workingDirectory,uuid,applyPermission});
    this.inFlight=new Map();this.records=new Map();this.workspacePending=null;
  }
  async workspace(){
    if(this.workspacePending)return this.workspacePending;
    this.workspacePending=this.resolveWorkspace();
    try{return await this.workspacePending;}finally{this.workspacePending=null;}
  }
  async resolveWorkspace(){
    if(!this.workspaces?.list||!this.workspaces?.create||!this.sessions?.create||!this.sessions?.prompt)
      throw fail('当前 DSH 未提供工作区或会话创建接口，未启动 AI。');
    const matches=this.workspaces.list().filter(w=>w.title===WORKSPACE_TITLE);
    if(matches.length>1)throw fail('存在多个名为“Ai专家选股”的工作区，请先在 DSH 重命名以消除歧义。',409);
    if(matches.length===1)return matches[0];
    const parent=this.workingDirectory?.defaultDirectory;
    if(typeof parent!=='string'||!parent)throw fail('无法取得 DSH 默认工作目录，未创建工作区。');
    const path=join(parent,WORKSPACE_TITLE);
    await mkdir(path,{recursive:true});
    const workspace=await this.workspaces.create(path,WORKSPACE_TITLE);
    if(workspace.title!==WORKSPACE_TITLE)throw fail('“Ai专家选股”目录已登记为其他名称，请先在 DSH 确认工作区名称。',409);
    return workspace;
  }
  start(body,signal){
    let params;
    try{params=normalizeSelectionRequest(body);}catch(error){return Promise.reject(error);}
    const request_id=body?.request_id??this.uuid();
    if(typeof request_id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(request_id))
      return Promise.reject(fail('选股请求标识无效',400));
    const signature=JSON.stringify(params);
    const active=this.inFlight.get(request_id);
    if(active){
      if(active.signature!==signature)return Promise.reject(fail('同一请求标识不能用于不同选股参数',409));
      return active.promise;
    }
    const promise=this.run(params,signature,request_id,signal);
    this.inFlight.set(request_id,{signature,promise});
    promise.finally(()=>this.inFlight.delete(request_id)).catch(()=>{});
    return promise;
  }
  receipt(record){
    return {status:'accepted',submitted:true,workspaceId:record.workspaceId,workspaceTitle:WORKSPACE_TITLE,
            sessionId:record.sessionId,params:record.params,request_id:record.requestId,warnings:record.warnings};
  }
  async run(params,signature,requestId,signal){
    const check=()=>{if(signal?.aborted)throw fail('选股已取消',499);};
    check();
    const workspace=await this.workspace();check();
    let record=this.records.get(requestId);
    if(record&&(record.signature!==signature||record.workspaceId!==workspace.id))
      throw fail('同一请求标识不能用于不同选股参数，未新建会话',409);
    record=record??{requestId,params,signature,workspaceId:workspace.id,sessionId:null,accepted:false,warnings:[]};
    this.records.set(requestId,record);
    if(record.accepted)return this.receipt(record);
    if(!record.sessionId){
      const created=await this.sessions.create({workspaceId:workspace.id});
      if(typeof created?.sessionId!=='string'||!created.sessionId)throw fail('DSH 未返回有效的新会话标识');
      record.sessionId=created.sessionId;
      if(typeof this.applyPermission==='function'){
        try{await this.applyPermission(record.sessionId);}
        catch{record.warnings.push('会话已创建，但未能自动切换为完全访问权限；可在会话内用 /permission 或权限选择器手动切换。');}
      }
      if(this.sessions.rename){
        try{await this.sessions.rename({sessionId:record.sessionId,title:'Ai专家选股：'+(params.scope==='market'?'全A股':params.scope==='watchlist'?'自选股':params.sector)});}
        catch{record.warnings.push('会话已创建，但自动命名失败，可在 DSH 中手动命名。');}
      }
    }
    check();
    try{
      const accepted=await this.sessions.prompt({requestId,sessionId:record.sessionId,mode:'queue',
        content:[{type:'text',text:buildSelectionPrompt(params)}]},signal??new AbortController().signal);
      if(accepted?.accepted!==true)throw fail('DSH 尚未确认接收选股任务，请重试。');
      record.accepted=true;
      return this.receipt(record);
    }catch(error){
      const message=error?.message||'AI 专家选股未能启动';
      throw fail(message,error?.status??503,{error:message,sessionId:record.sessionId,workspaceId:workspace.id,request_id:requestId});
    }
  }
}
