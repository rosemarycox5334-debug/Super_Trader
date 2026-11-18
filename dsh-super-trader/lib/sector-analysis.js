import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const WORKSPACE_TITLE='Ai板块分析';
const fail=(message,status=503,body)=>{const e=Object.assign(new Error(message),{status});if(body)e.body=body;return e;};

export function buildSectorAnalysisPrompt(name,thscode){
  return `# AI 板块分析：${name}（${thscode}）

用户已在“板块分析”页选择该板块并启动分析。请现在直接完成分析，不要等待用户再次发送，也不要新建工作区或会话。

## 必须先取真实数据
1. 调用 st_sector_research(action="report", thscode="${thscode}") 读取真实板块报告：最新行情、历史K线/趋势、成分样本、广度和量化覆盖。引用具体字段与日期，工具没返回的字段不得编造。
2. 如需多专家交叉验证，调用 st_team_research(kind="sector", code="${thscode}", wait=true)，不要传 expert_ids，使用全部启用专家；当前支持最多20位，不要为了绕开限制自行删减专家。它会真实调用模型并可能计费，并在返回前等待任务到终态。不要把任务受理或中间进度当成分析完成。
3. 板块行情/成分等关键数据缺失时写明缺什么；量化缺失不写。不要用个股或同号指数替代该板块。

## 团队逐位展示（如果调用了团队分析，必须遵守）
**全部用中文表述**：除板块代码、网址、必要的字段路径外，正文不要出现英文单词或英文字段名；把 buy/hold/reduce/avoid/wait 写成 买入（加仓）/持有/减仓（清仓）/回避/观望，不要出现 outlook、action、evidence、source、ref、abstained 这类词。
不能只写“全部投票”“无共识”或一句汇总。必须为每位专家单独一节，包含：
- 专家名称与投票（只写 看多 / 看空 / 观望）；
- 信心度（高/中/低，表示专家对该判断的信心，不是胜率或概率）；
- 完整理由，不要只写结论；
- 依据：逐条写“数据来源与字段路径 → 实际数值 → 数据含义”；字段名要翻成中文再展示，例如 parent_holder_net_profit→归母净利润、act_cash_flow_net→经营活动现金流量净额、pe_ttm→滚动市盈率；不要直接贴英文键名，需要时可写成“归母净利润（parent_holder_net_profit）”。
- 交易策略：操作、入场触发条件与价位或板块位置、仓位、止损、目标、持有周期、失效条件、风险收益比；
- 情景展望：短期、中期、多头情景、空头情景、失效条件；
- 风险。
**A股默认不能做空**：看空只能写成不买入、减仓或清仓、回避或观望，不得出现做空、卖空、融券、借券、开空、回补；专家给的计划若被标记不可执行，必须改写为可执行版本。
**专家看不到量化因子**：团队分析时量化因子与旧量化网格都没有提供给专家，每位专家的小节里不得出现量化因子方向、准确率等内容，也不要替专家编造这类依据。
每位专家无论看多、看空还是观望都必须给出交易策略；观望也要写清“什么条件才动手、在哪里放弃”。
禁止输出“未提供、空数组、无依据、证据缺失”这类字样：字段缺失就整段省略，只写实际拿到的内容；因子或量化没有可用成果时静默跳过，正文任何位置都不要写“因子不可用、量化无覆盖、无成果”这类说明。不要替专家补造引用。
先给团队汇总（看多、看空、观望、法定人数、共识或无共识、分歧），再逐位展开。

## 输出要求
用中文给出可审计的板块分析，而不是复述原始数据：
- 板块趋势与所处阶段：均线结构、5/20日表现、支撑阻力、量能；
- 成分与广度：上涨/下跌/平盘样本，明确只是样本广度，不代表全板块；
- 多空条件：支持走强的可观测条件，以及证伪/失效条件；
- 主要风险与分歧：至少一条反向证据；不要把“任务仍在运行/第几项”写进最终报告，必须等到终态后再总结；若最终仍无法完成，直接省略多专家部分，不写“尚未完成”章节；
- 综合判断必须分两层：第一层汇总专家票数与分歧；第二层才是量化校验，**且只在 factor_view 可用并达到 55% 准确率门槛时写**，说明方向、全样本准确率、覆盖率，以及它支持还是削弱专家结论；因子不可用、被门槛排除或标注“尚无可验证的因子成果”时，整层省略，不写“本次不采用因子辅助”“因子不可用”之类说明，直接进入策略；
- 综合交易策略：要写到可直接执行——方向与前提、分批位次（第一笔/第二笔的触发条件与总仓位上限）、止损（价格与关键位）、目标与逐档减仓、持有周期与成本、转为观望或放弃的条件；即使结论是观望，也给出条件化执行计划；价位必须来自本次报告的真实数据；
- 数据时间和来源：报告生成时间、行情截至日；量化有数据时才写量化截至日。

区分“数据观测”“研究者推断”，不承诺收益、不预测具体点位；不交易、不下单。若数据不足以支撑结论，直接说明，不编造。`;
}

export class SectorAnalysisService {
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
    if(matches.length>1)throw fail('存在多个名为“Ai板块分析”的工作区，请先在 DSH 重命名以消除歧义。',409);
    if(matches.length===1)return matches[0];
    const parent=this.workingDirectory?.defaultDirectory;
    if(typeof parent!=='string'||!parent)throw fail('无法取得 DSH 默认工作目录，未创建工作区。');
    const path=join(parent,WORKSPACE_TITLE);
    await mkdir(path,{recursive:true});
    const workspace=await this.workspaces.create(path,WORKSPACE_TITLE);
    if(workspace.title!==WORKSPACE_TITLE)throw fail('“Ai板块分析”目录已登记为其他名称，请先在 DSH 确认工作区名称。',409);
    return workspace;
  }
  start({thscode,name,request_id}={},signal){
    if(typeof thscode!=='string'||!/^\d{6}\.(?:SH|SZ|TI)$/.test(thscode.toUpperCase()))
      return Promise.reject(fail('板块代码必须是完整的 6位.SH/SZ/TI',400));
    thscode=thscode.toUpperCase();
    if(typeof name!=='string'||!name.trim()||name.length>80)return Promise.reject(fail('板块名称无效',400));
    name=name.trim();
    request_id=request_id??this.uuid();
    if(typeof request_id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(request_id))
      return Promise.reject(fail('分析请求标识无效',400));
    const active=this.inFlight.get(request_id);
    if(active){if(active.thscode!==thscode||active.name!==name)return Promise.reject(fail('同一请求标识不能用于不同板块',409));return active.promise;}
    const promise=this.run(thscode,name,request_id,signal);
    this.inFlight.set(request_id,{thscode,name,promise});
    promise.finally(()=>this.inFlight.delete(request_id)).catch(()=>{});
    return promise;
  }
  receipt(record){return {status:'accepted',submitted:true,workspaceId:record.workspaceId,workspaceTitle:WORKSPACE_TITLE,sessionId:record.sessionId,thscode:record.thscode,request_id:record.requestId,warnings:record.warnings};}
  async run(thscode,name,requestId,signal){
    const check=()=>{if(signal?.aborted)throw fail('分析已取消',499);};
    check();
    const workspace=await this.workspace();check();
    let record=this.records.get(requestId);
    if(record&&(record.thscode!==thscode||record.name!==name||record.workspaceId!==workspace.id))
      throw fail('同一请求标识不能用于不同板块，未新建会话',409);
    record=record??{requestId,thscode,name,workspaceId:workspace.id,sessionId:null,accepted:false,warnings:[]};
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
        try{await this.sessions.rename({sessionId:record.sessionId,title:'Ai板块分析：'+name});}
        catch{record.warnings.push('会话已创建，但自动命名失败，可在 DSH 中手动命名。');}
      }
    }
    check();
    try{
      const accepted=await this.sessions.prompt({requestId,sessionId:record.sessionId,mode:'queue',
        content:[{type:'text',text:buildSectorAnalysisPrompt(name,thscode)}]},signal??new AbortController().signal);
      if(accepted?.accepted!==true)throw fail('DSH 尚未确认接收板块分析任务，请重试。');
      record.accepted=true;
      return this.receipt(record);
    }catch(error){
      const message=error?.message||'AI 板块分析未能启动';
      throw fail(message,error?.status??503,{error:message,sessionId:record.sessionId,workspaceId:workspace.id,thscode,request_id:requestId});
    }
  }
}
