import {mkdir, readFile, writeFile, rename, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildExpertCreationPrompt} from './expert-creation-prompt.js';
import {onlineResearchEvidence} from './online-research.js';

const WORKSPACE_TITLE = '新建专家';
const fail = (message, status=503, extra={}) => Object.assign(new Error(message), {status, ...extra});

// Both the UI route and agent tool call this operation. Session/Workspace ownership
// remains with Harness; the plugin records only an idempotency receipt, not a chat log.
export class ExpertCreationService {
  constructor({workspaces, sessions, workingDirectory, fs={mkdir,readFile,writeFile,rename}, uuid=randomUUID}) {
    Object.assign(this,{workspaces,sessions,workingDirectory,fs,uuid});
    this.inFlight=new Map();this.recovery=new Map();this.workspacePending=null;this.researchSessions=new Set();
  }
  async workspace() {
    if(this.workspacePending)return this.workspacePending;
    this.workspacePending=this.resolveWorkspace();
    try{return await this.workspacePending;}finally{this.workspacePending=null;}
  }
  async resolveWorkspace() {
    if(!this.workspaces?.list||!this.workspaces?.create||!this.sessions?.create||!this.sessions?.prompt)
      throw fail('当前 DSH 未提供工作区或会话创建接口，未启动 AI。');
    const matches=this.workspaces.list().filter(w=>w.title===WORKSPACE_TITLE);
    if(matches.length>1)throw fail('存在多个名为“新建专家”的工作区，请先在 DSH 重命名以消除歧义。',409);
    if(matches.length===1)return matches[0];
    const parent=this.workingDirectory?.defaultDirectory;
    if(typeof parent!=='string'||!parent)throw fail('无法取得 DSH 默认工作目录，未创建工作区。');
    const path=join(parent,WORKSPACE_TITLE);
    await this.fs.mkdir(path,{recursive:true});
    const workspace=await this.workspaces.create(path,WORKSPACE_TITLE);
    if(workspace.title!==WORKSPACE_TITLE)throw fail('“新建专家”目录已登记为其他名称，请先在 DSH 确认工作区名称。',409);
    return workspace;
  }
  start({requirement,request_id}={},signal) {
    if(typeof requirement!=='string'||!requirement.trim())return Promise.reject(fail('请先描述想新建的专家。',400));
    requirement=requirement.trim();
    if(requirement.length>8000)return Promise.reject(fail('专家需求过长，请控制在 8000 字符以内。',400));
    request_id=request_id??this.uuid();
    if(typeof request_id!=='string'||! /^[a-zA-Z0-9-]{16,80}$/.test(request_id))return Promise.reject(fail('创建请求标识无效。',400));
    const active=this.inFlight.get(request_id);
    if(active){if(active.requirement!==requirement)return Promise.reject(fail('同一请求标识不能用于不同专家需求。',409));return active.promise;}
    const promise=this.run(requirement,request_id,signal).catch(error=>{
      const record=this.recovery.get(request_id);
      if(record?.sessionId&&!error.body)error.body={error:error.message,sessionId:record.sessionId,workspaceId:record.workspaceId,request_id};
      throw error;
    });
    this.inFlight.set(request_id,{requirement,promise});
    promise.finally(()=>this.inFlight.delete(request_id)).catch(()=>{});
    return promise;
  }
  rememberResearchSession(sessionId) {
    this.researchSessions.add(sessionId);
    if(this.researchSessions.size>256)this.researchSessions.delete(this.researchSessions.values().next().value);
  }
  async isResearchSession(sessionId,seen=new Set()) {
    if(this.researchSessions.has(sessionId))return true;
    if(seen.has(sessionId))return false;
    seen.add(sessionId);
    const rows=this.workspaces?.list?.();
    if(!Array.isArray(rows))throw fail('无法核验专家创建会话归属，未保存专家。',409);
    if(rows.some(w=>w.title===WORKSPACE_TITLE&&w.sessionIds?.includes(sessionId))){this.rememberResearchSession(sessionId);return true;}
    // Recover identity from durable startup receipts, including after a cwd change
    // or a Workspace rename. No Agent is activated and no receipt text is executed.
    for(const workspace of rows){
      const dir=join(workspace.path,'.super-trader','expert-creation');
      let files;try{files=await (this.fs.readdir??readdir)(dir);}catch(error){if(error.code==='ENOENT')continue;throw fail('无法读取专家创建回执，未保存专家。',409);}
      for(const name of files.filter(name=>/^[a-zA-Z0-9-]{16,80}\.json$/.test(name))){
        let record;try{record=JSON.parse(await this.fs.readFile(join(dir,name),'utf8'));}catch{continue;}
        if(record.workspaceId===workspace.id&&record.sessionId===sessionId){this.rememberResearchSession(sessionId);return true;}
      }
    }
    if(this.sessions?.inspect){
      let header;try{header=(await this.sessions.inspect(sessionId)).meta;}catch{throw fail('无法核验调用会话的来源，未保存专家。',409);}
      if(typeof header?.parentSession==='string'&&await this.isResearchSession(header.parentSession,seen)){this.rememberResearchSession(sessionId);return true;}
    }
    return false;
  }
  async assertOnlineResearch(agent,config,signal) {
    if(typeof agent?.id!=='string'||!agent.id)throw Object.assign(fail('无法识别调用会话，未保存专家。',409),{code:'online_research_context_unavailable'});
    if(!await this.isResearchSession(agent.id))return {required:false};
    if(!this.sessions?.inspect)throw Object.assign(fail('无法读取联网取证记录，未保存专家。',409),{code:'online_research_unverified'});
    let view;try{view=await this.sessions.inspect(agent.id,signal);}catch{throw Object.assign(fail('联网取证记录暂不可读，请稍后重试，未保存专家。',409),{code:'online_research_unverified'});}
    // A fork's inherited history cannot substitute for this research Session's own search.
    const inherited=Number.isInteger(view.inheritedEventCount)?Math.max(0,view.inheritedEventCount):0;
    const evidence=onlineResearchEvidence((view.events??[]).slice(inherited),config.system_prompt);
    if(!evidence.verified)throw Object.assign(fail('保存被拒绝：请先在本会话成功调用 web_search 搜索最新公开资料，再用 web_fetch 读取资料，并在 system_prompt 引用已读取的来源URL。联网失败、只有搜索摘要或凭模型记忆，均不能保存专家。',409),{code:'online_research_required',body:{error:'online_research_required',message:'需完成真实联网搜索、资料读取和来源引用后再保存。',searches:evidence.searches,reads:evidence.reads,citedReads:evidence.citedReads}});
    return {required:true,...evidence};
  }
  async loadReceipt(requestId) {
    if(typeof requestId!=='string'||! /^[a-zA-Z0-9-]{16,80}$/.test(requestId))throw fail('创建请求标识无效。',400);
    const matches=this.workspaces?.list?.().filter(w=>w.title===WORKSPACE_TITLE)??[];
    if(matches.length!==1)throw fail('找不到唯一的“新建专家”工作区。',404);
    const workspace=matches[0];
    let record=this.recovery.get(requestId);
    if(!record){
      try{record=JSON.parse(await this.fs.readFile(join(workspace.path,'.super-trader','expert-creation',requestId+'.json'),'utf8'));}
      catch{throw fail('未找到该专家创建任务。',404);}
    }
    if(record.requestId!==requestId||record.workspaceId!==workspace.id||!record.sessionId)throw fail('创建回执无效或会话尚未创建。',409);
    return {record,workspace};
  }
  async status(requestId) {
    const {record,workspace}=await this.loadReceipt(requestId);
    let activity={available:false};
    if(this.sessions.inspect){
      try{
        const view=await this.sessions.inspect(record.sessionId),events=view.events??[];
        const start=events.filter(e=>e.type==='turn/start').at(-1),end=events.filter(e=>e.type==='turn/end').at(-1),last=events.at(-1);
        activity={available:true,lastEvent:last?.type??null,lastSeq:last?.seq??null,
          running:!!start&&(!end||start.seq>end.seq),lastTurnEndReason:end?.data?.reason??null};
      }catch{activity={available:false,error:'会话状态暂不可读，可在 DSH 会话查看。'};}
    }
    return {request_id:requestId,workspaceId:workspace.id,workspaceTitle:workspace.title,sessionId:record.sessionId,submitted:record.accepted,activity,expertSaveVerified:false};
  }
  async cancel(requestId,{archive=false}={}) {
    const {record}=await this.loadReceipt(requestId);
    if(!this.sessions.cancel)throw fail('当前 DSH 未提供会话停止接口。');
    const result=await this.sessions.cancel({sessionId:record.sessionId});
    if(result?.accepted!==true)throw fail('DSH 尚未确认停止请求。');
    if(archive){
      if(!this.workspaces.archiveSession)throw fail('停止已请求，但归档接口不可用。');
      await this.workspaces.archiveSession(record.sessionId,{stopActivity:true});
    }
    return {request_id:requestId,sessionId:record.sessionId,status:'cancel_requested',archived:archive};
  }
  async run(requirement,requestId,signal) {
    const check=()=>{if(signal?.aborted)throw fail('创建已取消；若会话已创建，可在“新建专家”工作区继续。',499);};
    check();
    const workspace=await this.workspace();check();
    const dir=join(workspace.path,'.super-trader','expert-creation');
    await this.fs.mkdir(dir,{recursive:true});
    const file=join(dir,requestId+'.json');
    let record=this.recovery.get(requestId);
    if(!record){
      try{record=JSON.parse(await this.fs.readFile(file,'utf8'));}
      catch(error){if(error.code!=='ENOENT')throw fail('无法读取专家创建记录，请检查工作区存储。');}
    }
    if(record&&(record.requirement!==requirement||record.requestId!==requestId||record.workspaceId!==workspace.id))
      throw fail('创建记录与当前请求不一致，未新建会话。',409);
    record=record??{requestId,requirement,workspaceId:workspace.id,sessionId:null,accepted:false,warnings:[]};
    this.recovery.set(requestId,record);
    const save=async()=>{
      const tmp=file+'.tmp-'+this.uuid();
      await this.fs.writeFile(tmp,JSON.stringify(record,null,2),'utf8');
      await this.fs.rename(tmp,file);
    };
    const receipt=()=>({status:record.accepted?'accepted':'session_created',submitted:record.accepted,
      request_id:requestId,workspaceId:workspace.id,workspaceTitle:workspace.title,sessionId:record.sessionId,
      warnings:record.warnings,expertSaved:false});
    if(record.accepted){
      try{await save();this.recovery.delete(requestId);}catch{}
      return receipt();
    }
    await save();check();
    if(!record.sessionId){
      const created=await this.sessions.create({workspaceId:workspace.id});
      if(typeof created?.sessionId!=='string'||!created.sessionId)throw fail('DSH 未返回有效的新会话标识。');
      record.sessionId=created.sessionId;
      this.rememberResearchSession(record.sessionId);
      await save();
      if(this.sessions.rename){
        try{await this.sessions.rename({sessionId:record.sessionId,title:'新建专家：'+requirement.slice(0,48)});}
        catch{record.warnings.push('会话已创建，但自动命名失败，可在 DSH 中手动命名。');}
      }
    }
    check();
    try{
      const accepted=await this.sessions.prompt({requestId,sessionId:record.sessionId,mode:'queue',
        content:[{type:'text',text:buildExpertCreationPrompt(requirement,requestId)}]},signal??new AbortController().signal);
      if(accepted?.accepted!==true)throw fail('DSH 尚未确认接收专家创建任务，请重试同一请求。');
      record.accepted=true;
      try{await save();this.recovery.delete(requestId);}
      catch{record.warnings.push('AI 已受理，但启动回执落盘失败；请查看已创建会话，勿重复提交。');}
      return receipt();
    }catch(error){
      const message=error?.message||'AI 创建任务未能启动。';
      throw fail(message,error.status??503,{body:{error:message,sessionId:record.sessionId,workspaceId:workspace.id,request_id:requestId}});
    }
  }
}
