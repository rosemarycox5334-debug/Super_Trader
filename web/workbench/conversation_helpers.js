/* Pure session helpers: additive schema-v3 migration, no DOM or network. */
function cleanMessages(items) {
  return (Array.isArray(items) ? items : []).slice(-60).filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string').map(m => ({
    role: m.role,
    text: m.text.slice(0, 5000),
    time: typeof m.time === 'string' ? m.time.slice(0, 30) : '',
    ...(typeof m.taskId === 'string' && /^[a-zA-Z0-9_-]{1,70}$/.test(m.taskId) ? {taskId: m.taskId} : {}),
    ...(Array.isArray(m.recordKeys) ? {recordKeys: [...new Set(m.recordKeys.filter(k => typeof k === 'string' && k.length < 45))].slice(0, 5)} : {})
  }));
}
function normalizeConversationState(saved) {
  const seen = new Set();
  const conversations = (Array.isArray(saved.conversations) ? saved.conversations : []).filter(c => {
    if (!c || typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,70}$/.test(c.id) || seen.has(c.id)) return false;
    seen.add(c.id); return true;
  }).slice(0, 30).map(c => ({
    id: c.id,
    title: typeof c.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 60) : '新对话',
    messages: cleanMessages(c.messages),
    draft: typeof c.draft === 'string' ? c.draft.slice(0, 1500) : '',
    updated: typeof c.updated === 'string' ? c.updated.slice(0, 60) : ''
  }));
  if (!conversations.length) {
    const legacy = cleanMessages(saved.messages);
    const first = legacy.find(m => m.role === 'user');
    conversations.push({id: 'chat-start', title: first ? first.text.slice(0, 32) : legacy.length ? '之前的研究对话' : '新对话', messages: legacy, draft: '', updated: ''});
  }
  const activeConversationId = conversations.some(c => c.id === saved.activeConversationId) ? saved.activeConversationId : conversations[0].id;
  const current = conversations.find(c => c.id === activeConversationId);
  return {conversations, activeConversationId, messages: cleanMessages(current.messages)};
}
function syncConversationState(s) {
  if (!Array.isArray(s.conversations) || !s.conversations.length) Object.assign(s, normalizeConversationState(s));
  let current = s.conversations.find(c => c.id === s.activeConversationId);
  if (!current) {
    const normalized = normalizeConversationState(s);
    s.conversations = normalized.conversations;
    s.activeConversationId = normalized.activeConversationId;
    current = s.conversations.find(c => c.id === s.activeConversationId);
  }
  current.messages = cleanMessages(s.messages);
  const first = current.messages.find(m => m.role === 'user');
  if (first && current.title === '新对话') current.title = first.text.slice(0, 32);
  return current;
}
function createConversationState(s, id, updated) {
  syncConversationState(s);
  if (!/^[a-zA-Z0-9_-]{1,70}$/.test(id) || s.conversations.some(c => c.id === id)) throw Error('会话 ID 无效或重复。');
  if (s.conversations.length >= 30) throw Error('最多保留 30 个对话，请先导出并删除不再需要的会话。');
  const next = {id, title: '新对话', messages: [], draft: '', updated};
  s.conversations.unshift(next);
  s.activeConversationId = next.id;
  s.messages = [];
  return next;
}
function switchConversationState(s, id) {
  syncConversationState(s);
  const target = s.conversations.find(c => c.id === id);
  if (!target) return false;
  syncConversationState(s);
  s.activeConversationId = id;
  s.messages = cleanMessages(target.messages);
  return true;
}
