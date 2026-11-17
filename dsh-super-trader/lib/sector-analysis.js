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
2. 如需多专家交叉验证，调用 st_team_research(kind="sector", code="${thscode}")；它会真实调用模型并可能计费，返回 job 后用 st_job 查询。不要把任务受理当成分析完成。
3. 板块报告缺失/不可用时明确写出缺什么；不要用个股或同号指数替代该板块。

## 输出要求
用中文给出可审计的板块分析，而不是复述原始数据：
- 板块趋势与所处阶段：均线结构、5/20日表现、支撑阻力、量能；
- 成分与广度：上涨/下跌/平盘样本，明确只是样本广度，不代表全板块；
- 量化证据：只引用实际返回的 h5/h10/h20 结果、样本与覆盖率；不可用就写不可用；
- 多空条件：支持走强的可观测条件，以及证伪/失效条件；
- 主要风险与分歧：至少一条反向证据；
- 数据时间和来源：报告 created_at、行情/量化截至日。

区分“数据观测”“研究者推断”，不承诺收益、不预测具体点位；不交易、不下单。若数据不足以支撑结论，直接说明，不编造。`;
}

export class SectorAnalysisService {
  constructor({workspaces,sessions,workingDirectory,uuid=randomUUID}){
    Object.assign(this,{workspaces,sessions,workingDirectory,uuid});
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
