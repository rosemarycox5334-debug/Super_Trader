import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const WORKSPACE_TITLE='Ai个股分析';
const fail=(message,status=503,body)=>{const e=Object.assign(new Error(message),{status});if(body)e.body=body;return e;};

export function buildStockAnalysisPrompt(name,code){
  return `# AI 个股分析：${name}（${code}）

用户已在“专家团队”页选择该个股并启动分析。请现在直接完成分析，不要等待用户再次发送，也不要新建工作区或会话。

## 数据与团队
1. 调用 st_stock_research({"code":"${code}"}) 读取真实个股报告：行情、120根日K/趋势、估值、财报、新闻、量化/因子覆盖。引用具体字段与日期，工具没返回的字段不得编造。
2. 调用 st_team_research({"kind":"stock","code":"${code}","wait":true})，不要传 expert_ids，使用全部启用专家；当前最多20位，不得为了绕开人数限制自行删减专家。它会真实调用模型并可能计费，并等待任务到终态。
3. 不要把“任务受理”或中间进度当成完成；不要把“7/7全部投票”当成分析结果。必须读取团队最终返回的每位专家内容。

## 会话输出格式（必须遵守）
先给团队汇总：有效票、弃权票、法定人数、共识/无共识、主要分歧。
然后**逐位专家展开**，每位专家单独一节，必须包含：
- 专家名称与投票（看多 / 看空 / 弃权）；
- 置信度；
- 理由（完整，不要只写一句结论）；
- 依据：逐条列出 evidence 的 source 与 ref，并说明它对应的数据含义；
- outlook：短期、中期、多头情景、空头情景、失效条件；
- 风险；
- 若该专家弃权，也要说明弃权原因和已看到的依据，不能省略。
最后给出你自己的综合判断、反向证据和失效条件。

不得只输出“7/7 全部投票”“无共识”之类汇总；不得编造专家理由或证据；专家没有提供的字段写“未提供”，不要补造。数据不足时明确缺口。不预测具体点位、不承诺收益、不交易。`;
}

export class StockAnalysisService {
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
    if(matches.length>1)throw fail('存在多个名为“Ai个股分析”的工作区，请先在 DSH 重命名以消除歧义。',409);
    if(matches.length===1)return matches[0];
    const parent=this.workingDirectory?.defaultDirectory;
    if(typeof parent!=='string'||!parent)throw fail('无法取得 DSH 默认工作目录，未创建工作区。');
    const path=join(parent,WORKSPACE_TITLE);
    await mkdir(path,{recursive:true});
    const workspace=await this.workspaces.create(path,WORKSPACE_TITLE);
    if(workspace.title!==WORKSPACE_TITLE)throw fail('“Ai个股分析”目录已登记为其他名称，请先在 DSH 确认工作区名称。',409);
    return workspace;
  }
  start({code,name,request_id}={},signal){
    if(typeof code!=='string'||!/^\d{6}$/.test(code))return Promise.reject(fail('个股代码必须是六位数字',400));
    if(typeof name!=='string'||!name.trim()||name.length>80)return Promise.reject(fail('个股名称无效',400));
    name=name.trim();
    request_id=request_id??this.uuid();
    if(typeof request_id!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(request_id))
      return Promise.reject(fail('分析请求标识无效',400));
    const active=this.inFlight.get(request_id);
    if(active){if(active.code!==code||active.name!==name)return Promise.reject(fail('同一请求标识不能用于不同个股',409));return active.promise;}
    const promise=this.run(code,name,request_id,signal);
    this.inFlight.set(request_id,{code,name,promise});
    promise.finally(()=>this.inFlight.delete(request_id)).catch(()=>{});
    return promise;
  }
  receipt(record){return {status:'accepted',submitted:true,workspaceId:record.workspaceId,workspaceTitle:WORKSPACE_TITLE,sessionId:record.sessionId,code:record.code,request_id:record.requestId,warnings:record.warnings};}
  async run(code,name,requestId,signal){
    const check=()=>{if(signal?.aborted)throw fail('分析已取消',499);};
    check();
    const workspace=await this.workspace();check();
    let record=this.records.get(requestId);
    if(record&&(record.code!==code||record.name!==name||record.workspaceId!==workspace.id))
      throw fail('同一请求标识不能用于不同个股，未新建会话',409);
    record=record??{requestId,code,name,workspaceId:workspace.id,sessionId:null,accepted:false,warnings:[]};
    this.records.set(requestId,record);
    if(record.accepted)return this.receipt(record);
    if(!record.sessionId){
      const created=await this.sessions.create({workspaceId:workspace.id});
      if(typeof created?.sessionId!=='string'||!created.sessionId)throw fail('DSH 未返回有效的新会话标识');
      record.sessionId=created.sessionId;
      if(this.sessions.rename){
        try{await this.sessions.rename({sessionId:record.sessionId,title:'Ai个股分析：'+name});}
        catch{record.warnings.push('会话已创建，但自动命名失败，可在 DSH 中手动命名。');}
      }
    }
    check();
    try{
      const accepted=await this.sessions.prompt({requestId,sessionId:record.sessionId,mode:'queue',
        content:[{type:'text',text:buildStockAnalysisPrompt(name,code)}]},signal??new AbortController().signal);
      if(accepted?.accepted!==true)throw fail('DSH 尚未确认接收个股分析任务，请重试。');
      record.accepted=true;
      return this.receipt(record);
    }catch(error){
      const message=error?.message||'AI 个股分析未能启动';
      throw fail(message,error?.status??503,{error:message,sessionId:record.sessionId,workspaceId:workspace.id,code,request_id:requestId});
    }
  }
}
