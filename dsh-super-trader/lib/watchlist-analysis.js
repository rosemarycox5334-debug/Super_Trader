import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const WORKSPACE_TITLE='Ai自选股分析';
const fail=(message,status=503,body)=>{const e=Object.assign(new Error(message),{status});if(body)e.body=body;return e;};

export function normalizeWatchTargets(items){
  if(!Array.isArray(items))throw fail('请传入选中的自选股列表',400);
  const seen=new Set(),out=[];
  for(const raw of items){
    if(!raw||typeof raw!=='object')throw fail('自选股条目格式无效',400);
    const code=String(raw.code??'').trim();
    const category=String(raw.category??'').trim();
    const name=String(raw.name??'').trim();
    if(!/^\d{6}$/.test(code))throw fail('自选股代码必须是六位数字',400);
    if(!['个股','ETF','LOF'].includes(category))throw fail('自选股类别只支持个股、ETF、LOF',400);
    if(!name||name.length>80)throw fail('自选股名称无效',400);
    const key=code+'|'+category;
    if(seen.has(key))continue;
    seen.add(key);
    out.push({code,name,category});
  }
  if(!out.length)throw fail('请至少勾选一只自选股',400);
  return out;
}

export function buildWatchlistAnalysisPrompt(items){
  const list=items.map((item,index)=>`${index+1}. ${item.name}（${item.code}，${item.category}）`).join('\n');
  return `# AI 自选股分析：共 ${items.length} 只

用户已在“自选股”页勾选以下标的并启动分析。请现在直接完成，不要等待用户再次发送，也不要新建工作区或会话。

${list}

## 数据与团队（对每一只都要做）
1. 调用 st_stock_research({"code":"代码","category":"个股或ETF或LOF"}) 读取该标的真实报告；类别按上面标注原样传，LOF 就传 LOF，不要改写成 ETF。
2. 调用 st_team_research({"kind":"stock","code":"代码","wait":true})，不要传 expert_ids，使用全部启用专家；它会真实调用模型并可能计费，并等到终态。逐只串行执行，不要把“任务受理”当成完成。
3. 不要把“全部投票”当成分析结果，必须读取每位专家的最终内容。

## 每只标的的输出格式
先给一句话结论，再逐位专家展开：
- 专家名称与投票（只写 看多 / 看空 / 观望）；
- 信心度（高/中/低，表示专家对该判断的信心，不是胜率或概率）；
- 理由（完整）；
- 依据：逐条写“数据来源与字段路径 → 实际数值 → 含义”；字段名要翻成中文再展示，例如 parent_holder_net_profit→归母净利润、act_cash_flow_net→经营活动现金流量净额、pe_ttm→滚动市盈率；不要直接贴英文键名，需要时可写成“归母净利润（parent_holder_net_profit）”。
- 交易策略：操作（买入或加仓、持有、减仓或清仓、回避、观望）、入场触发条件与价位、仓位、止损、目标、持有周期、失效条件、风险收益比；
- 情景展望：短期、中期、多头情景、空头情景、失效条件；
- 风险。
再给该标的的专家票数汇总与一段**可直接执行**的交易策略，按六项写全：
1）方向与前提（观望/买入/持有/减仓，缺哪条不动手）；
2）分批位次（第一笔、第二笔各在什么条件下，总仓位上限）；
3）止损（价格一个价位；基金再加净值一个价位，任一触发无条件离场、不摊平）；
4）目标与减仓（每档目标减多少仓）；
5）持有周期与成本（最短持有期、申赎费或交易成本影响，不做日内）；
6）仓位上限与放弃条件（跌破关键位未收复、单周再跌超X%、持仓结构或规模费率恶化、跟踪偏离扩大等）。
所有价位与净值必须取自本次报告的真实数据或其推算，不得编造。**A股默认不能做空**：看空只能写成不买入、减仓或清仓、回避或观望，不得出现做空、卖空、融券、借券、开空、回补。
**专家看不到量化因子**：专家小节里不得出现因子方向或准确率。只有团队结果的 factor_view 可用且通过 55% 准确率门槛时，才在该标的末尾加一小节因子校验；否则整段省略，不写“因子不可用”“本次不采用因子辅助”之类说明。

## 最后的总表
用一张表汇总全部标的：名称、代码、类别、专家票型分布、关键价位（支撑/压力或入场/止损）、信心度，并按相对强弱排序；排序只是观点整理，不是收益承诺。再写 2–4 条共同风险与需要盘中验证的失效条件。

## 通用要求
全部用中文，除代码、网址、必要字段路径外不出现英文或英文字段名；把 buy/hold/reduce/avoid/wait 写成 买入（加仓）/持有/减仓（清仓）/回避/观望。
禁止输出“未提供、空数组、无依据、证据缺失”这类字样：字段缺失就整段省略。因子或量化没有可用成果时静默跳过，正文任何位置都不要写“因子不可用、量化无覆盖、无成果”这类说明。不得编造专家理由或证据，不预测具体点位承诺收益、不代客下单。`;
}

export class WatchlistAnalysisService {
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
    if(matches.length>1)throw fail('存在多个名为“Ai自选股分析”的工作区，请先在 DSH 重命名以消除歧义。',409);
    if(matches.length===1)return matches[0];
    const parent=this.workingDirectory?.defaultDirectory;
    if(typeof parent!=='string'||!parent)throw fail('无法取得 DSH 默认工作目录，未创建工作区。');
    const path=join(parent,WORKSPACE_TITLE);
    await mkdir(path,{recursive:true});
    const workspace=await this.workspaces.create(path,WORKSPACE_TITLE);
    if(workspace.title!==WORKSPACE_TITLE)throw fail('“Ai自选股分析”目录已登记为其他名称，请先在 DSH 确认工作区名称。',409);
    return workspace;
  }
  start({items,request_id}={},signal){
    let targets;
    try{targets=normalizeWatchTargets(items);}catch(error){return Promise.reject(error);}
    request_id=request_id??this.uuid();
    if(typeof request_id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(request_id))
      return Promise.reject(fail('分析请求标识无效',400));
    const signature=targets.map(x=>x.code+'|'+x.category).sort().join(',');
    const active=this.inFlight.get(request_id);
    if(active){
      if(active.signature!==signature)return Promise.reject(fail('同一请求标识不能用于不同标的组合',409));
      return active.promise;
    }
    const promise=this.run(targets,signature,request_id,signal);
    this.inFlight.set(request_id,{signature,promise});
    promise.finally(()=>this.inFlight.delete(request_id)).catch(()=>{});
    return promise;
  }
  receipt(record){
    return {status:'accepted',submitted:true,workspaceId:record.workspaceId,workspaceTitle:WORKSPACE_TITLE,
            sessionId:record.sessionId,items:record.targets,request_id:record.requestId,warnings:record.warnings};
  }
  async run(targets,signature,requestId,signal){
    const check=()=>{if(signal?.aborted)throw fail('分析已取消',499);};
    check();
    const workspace=await this.workspace();check();
    let record=this.records.get(requestId);
    if(record&&(record.signature!==signature||record.workspaceId!==workspace.id))
      throw fail('同一请求标识不能用于不同标的组合，未新建会话',409);
    record=record??{requestId,targets,signature,workspaceId:workspace.id,sessionId:null,accepted:false,warnings:[]};
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
        try{await this.sessions.rename({sessionId:record.sessionId,title:`Ai自选股分析：${targets.length}只`});}
        catch{record.warnings.push('会话已创建，但自动命名失败，可在 DSH 中手动命名。');}
      }
    }
    check();
    try{
      const accepted=await this.sessions.prompt({requestId,sessionId:record.sessionId,mode:'queue',
        content:[{type:'text',text:buildWatchlistAnalysisPrompt(targets)}]},signal??new AbortController().signal);
      if(accepted?.accepted!==true)throw fail('DSH 尚未确认接收自选股分析任务，请重试。');
      record.accepted=true;
      return this.receipt(record);
    }catch(error){
      const message=error?.message||'AI 自选股分析未能启动';
      throw fail(message,error?.status??503,{error:message,sessionId:record.sessionId,workspaceId:workspace.id,request_id:requestId});
    }
  }
}
