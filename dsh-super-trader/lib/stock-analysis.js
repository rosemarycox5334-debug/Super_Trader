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
2. 调用 st_team_research({"kind":"stock","code":"${code}","wait":true})，不要传 expert_ids，使用全部启用专家；当前最多20位，不得为了绕开人数限制自行删减专家。它会真实调用模型并可能计费，并等待任务到终态。团队结果里的 factor_view 是给你最后汇总用的；专家本人看不到量化因子。
3. 不要把“任务受理”或中间进度当成完成；不要把“全部投票”当成分析结果。必须读取团队最终返回的每位专家内容。

## ETF 专项取证（标的类别为 ETF 时）
先读报告里的基金资料（规模原值、费率、带日期的净值、区间业绩、流动性）、披露持仓、基金财务指标和已验证因子。不要继续沿用“ETF不提供”旧占位判断；报告给了的必须使用。基金财务数据不是成分股营收，披露持仓不是实时指数成分。
按本轮分析范围设置，不使用实时IOPV/折溢价、指数估值分位及基金新闻：不补查这些项目、不输出其数据缺口、不把它们列为风险或观望理由。也不要再为这些项目发起网络检索或基金接口查询，更不要暗示已获得数据。
根据当前实际使用的价量、基金资料/净值/业绩、费率、披露持仓、流动性和已验证因子给出条件判断；不能只靠一张缺失表结束分析，也不能为了减少观望编造数据。

## 会话输出格式（必须遵守）
**全部用中文表述**：除股票代码、网址、必要的字段路径外，正文不要出现英文单词或英文字段名。把 buy/hold/reduce/avoid/wait 写成 买入（加仓）/持有/减仓（清仓）/回避/观望；不要出现 outlook、action、evidence、source、ref、abstained 这类词。
先给团队汇总：看多票、看空票、观望票、法定人数、共识或无共识、主要分歧。
然后**逐位专家展开**，每位专家单独一节，必须包含：
- 专家名称与投票（只写 看多 / 看空 / 观望）；
- 信心度（高/中/低，表示专家对该判断的信心，不是胜率或概率）；
- 理由（完整，不要只写一句结论）；
- 依据：逐条写“数据来源与字段路径 → 实际数值 → 该数据的含义”，不要只罗列路径；有多个引用时按重要性排序；
- 交易策略：操作（买入或加仓、持有、减仓或清仓、回避、观望）、入场触发条件与价位、仓位、止损、目标、持有周期、失效条件、风险收益比；
- 情景展望：短期、中期、多头情景、空头情景、失效条件；
- 风险。
**A股默认不能做空**：看空只能表达为“不买入、减仓或清仓、回避、观望”，不能出现做空、卖空、融券、借券、开空、回补等操作；专家给的计划若被标记为不可执行或提到做空，必须改写成可执行版本，不要照抄。
**专家看不到量化因子**：团队分析时量化因子与旧量化网格都没有提供给专家，所以每位专家的小节里不得出现“量化因子、因子方向、因子准确率”等内容，也不要替专家编造这类依据。
每位专家都必须给出交易策略，无论看多、看空还是观望：观望也要写“满足什么条件才动手、在哪个价位放弃”。
禁止输出“未提供、空数组、无依据、证据缺失”这类字样：字段缺失就整段省略，只写实际拿到的内容；因子或量化没有可用成果时静默跳过，正文任何位置都不要写“因子不可用、量化无覆盖、无成果”这类说明。不要用占位词或替专家补造。专家没有给出引用时不要编造，直接不写依据小节，但保留其交易策略。
最后给出你自己的综合判断，写成两层：
1）专家意见汇总：票数与分歧、哪些结论互相矛盾、共识强度；
2）量化因子校验：**只有**团队结果里 factor_view 可用、且通过 55% 准确率门槛时才写这一层，说明它的方向、全样本准确率、覆盖率，判断它支持还是削弱专家结论。
如果 factor_view 不可用、被门槛排除、或写着“尚无可验证的因子成果”，**整个第 2 层直接省略**：不写“量化因子校验”小节、不提因子、不写“本次不采用因子辅助”“因子无可用值”这类说明，直接进入综合交易策略，只用专家意见与可核实的价量/净值事实下结论。
再给出一段**可直接执行的综合交易策略**，必须写到能照着下单的程度，按下面六项逐条写，缺一项不算完成：
1）方向与前提：观望 / 买入 / 持有 / 减仓；并写明“缺哪个条件就不动手”。
2）分批位次：第一笔（如1/3）在什么条件下、第二笔在什么条件下、总仓位上限多少；触发条件要同时给出价位（基金另给净值）与量能或确认信号，例如“净值连续5日不破X且回升至Y上方，场内放量收在P上方、次日回踩不破Q”。
3）止损：价格止损一个价位；基金再给净值止损一个价位。写明任一触发即无条件离场、不摊平、不补仓。
4）目标与减仓：每一目标位对应减多少仓（如到第一目标减1/3）。
5）持有周期与成本：最短持有期和观察周期；基金要说明申赎费/交易成本的影响（如7天内赎回费高，就不做周内短线）。
6）仓位上限与放弃条件：单标的占总仓位上限、首次与累计上限；以及转为观望或放弃的条件（跌破关键位未收复、单周再跌超X%、披露持仓结构恶化、规模费率恶化、跟踪偏离扩大、场内价格与净值长期背离等）。
所有价位与净值必须来自本次报告的真实数据或其推算，不得凭空编造；不承诺收益、不预测具体日期价格。

量化因子不参与单个专家的判断，最多在第二步出现一次；不要把它塞回专家小节，也不要让所有专家看起来都在用量化。
不得只输出“全部投票”“无共识”之类汇总；不得编造专家理由或证据。不预测具体点位承诺收益、不代客下单。`;
}

export class StockAnalysisService {
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
      if(typeof this.applyPermission==='function'){
        try{await this.applyPermission(record.sessionId);}
        catch{record.warnings.push('会话已创建，但未能自动切换为完全访问权限；可在会话内用 /permission 或权限选择器手动切换。');}
      }
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
