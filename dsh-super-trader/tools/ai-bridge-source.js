// Inlined into the Client factory. The stock-analysis bridge only prepares a draft;
// the independent expert-creation route starts its own explicitly requested Session.
// Session references and draft initialization follow the installed Session Controller
// and ui-conversation contracts; unavailable services degrade to the visible prompt.
function currentResearchSession(ctx, props = {}) {
  if (typeof props.sessionId === 'string' && props.sessionId) return props.sessionId;
  let sessions;
  try { sessions = ctx.get?.('sessions') ?? ctx.sessions; } catch {}
  const snapshot = sessions?.list?.getSnapshot?.();
  const retained = Object.values(snapshot?.byId ?? {}).filter(item => (item?.retainedBy?.mainView ?? 0) > 0);
  // Never choose an arbitrary background, subagent, or 'most recent' conversation.
  return retained.length === 1 && typeof retained[0]?.id === 'string' ? retained[0].id : undefined;
}
function createAnalysisBridge(ctx, props = {}) {
  return async function prepareAnalysis(prompt) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 30000) throw new Error('分析上下文为空或过长 / Invalid research context');
    const get = name => { try { return ctx.get?.(name) ?? ctx[name]; } catch { return undefined; } };
    const sessions = get('sessions'), layout = get('layout'), uiWorkspace = get('uiWorkspace');
    const input = get('conversation')?.input ?? get('uiConversation')?.input;
    const sessionId = currentResearchSession(ctx, props);
    if (!sessionId) throw new Error('请先选择一个会话，再带入分析；下方内容可手动复制。 / Select a conversation first, or copy the context below.');
    if (typeof input?.requestDraftInitialization !== 'function' || typeof sessions?.retain !== 'function') {
      throw new Error('当前桌面客户端未提供会话草稿初始化接口，请将下方内容复制到对话中。 / Draft initialization is unavailable in this desktop client; copy the context into the conversation.');
    }
    const navigation = layout?.beginNavigation?.();
    const check = () => { if (navigation?.aborted) throw new Error('导航已取消；未发送分析请求 / Navigation cancelled'); };
    check();
    const reference = sessions.retain(sessionId, {source:'controllerOperation', ...(navigation ? {signal:navigation} : {})});
    try {
      await reference.ready;
      check();
      const result = input.requestDraftInitialization(reference.binding, {prompt, whenDraftExists:'keep'});
      if (result === 'preserved') throw new Error('原有草稿已保留，未覆盖；请复制下方分析上下文自行追加。 / Existing draft preserved; append the context manually.');
      if (result !== 'applied') throw new Error('草稿未写入，请复制上下文重试 / Draft was not applied');
      check();
      // Reopen only the exact selected session; never create or silently switch identity.
      if (typeof uiWorkspace?.openSession === 'function') uiWorkspace.openSession(sessionId);
      else layout?.selectPanel?.(null);
      return {status:'draft_prepared', accepted:true, sessionId, submitted:false};
    } finally { reference.release(); }
  };
}

function createExpertSessionBridge(ctx) {
  let uiWorkspace;try{uiWorkspace=ctx.get?.('uiWorkspace')??ctx.uiWorkspace;}catch{}
  if(typeof uiWorkspace?.openSession!=='function')return undefined;
  const open=function openExpertSession(sessionId,workspaceId) {
    if(typeof sessionId!=='string'||!sessionId)throw new Error('缺少 AI 专家创建会话标识');
    // A session can live in another workspace (the review workspace): open that workspace
    // first, otherwise opening the session alone may be a no-op for the current one.
    if(typeof workspaceId==='string'&&workspaceId&&typeof uiWorkspace.openWorkspace==='function'){
      uiWorkspace.openWorkspace(workspaceId).then(()=>uiWorkspace.openSession(sessionId),
        ()=>uiWorkspace.openSession(sessionId)).catch(()=>{});
      return;
    }
    uiWorkspace.openSession(sessionId);
  };
  open.begin=()=>{try{return (ctx.get?.('layout')??ctx.layout)?.beginNavigation?.();}catch{}};
  return open;
}
