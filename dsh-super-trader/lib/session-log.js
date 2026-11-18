// Read-only access to DSH session logs on this machine.
// The files are multi-frame zstd JSONL; Node decodes one frame per call, so a
// small frame splitter is required to recover every event.
import {readdir, readFile, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {zstdDecompressSync} from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD]);
export const MAX_LOG_BYTES = 64 * 1024 * 1024;
export const SESSION_ID = /^session-[a-z0-9][a-z0-9-]{4,62}$/;

export function sessionsRoot(env = process.env) {
  return join(env.DSH_HOME || join(homedir(), '.dsh'), 'sessions');
}

/** Split concatenated zstd frames; a bad split is retried with the next boundary. */
export function decompressFrames(buffer) {
  const positions = [];
  let at = 0;
  while ((at = buffer.indexOf(MAGIC, at)) !== -1) { positions.push(at); at += 4; }
  if (!positions.length) throw new Error('不是有效的 zstd 会话日志');
  const chunks = [];
  let index = 0;
  while (index < positions.length) {
    let settled = false;
    for (let next = index + 1; next <= positions.length && !settled; next += 1) {
      const end = next < positions.length ? positions[next] : buffer.length;
      try {
        chunks.push(zstdDecompressSync(buffer.subarray(positions[index], end)));
        settled = true;
        index = next;
      } catch { /* frame boundary guess was wrong: include the next frame */ }
    }
    if (!settled) break;
  }
  return Buffer.concat(chunks);
}

export function parseEvents(buffer) {
  const text = decompressFrames(buffer).toString('utf8');
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* skip a damaged line, keep the rest */ }
  }
  return events;
}

async function sessionFile(sessionId) {
  const root = sessionsRoot();
  let entries;
  try { entries = await readdir(root, {withFileTypes: true}); } catch { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, sessionId, 'session.v4.jsonl.zstd');
    try {
      const info = await stat(file);
      if (info.isFile() && info.size > 0 && info.size <= MAX_LOG_BYTES) return {file, size: info.size, updatedAt: info.mtimeMs};
    } catch { /* not in this workspace directory */ }
  }
  return null;
}

export async function readSession(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new Error('session id 无效');
  const found = await sessionFile(sessionId);
  if (!found) throw new Error('本机找不到该会话日志，或日志超出 64MB 读取上限');
  const events = parseEvents(await readFile(found.file));
  const header = events.find(event => event.type === 'session')?.data || {};
  return {file: found.file, size: found.size, updatedAt: found.updatedAt, header, events};
}

function blocksText(content, maxChars) {
  const parts = [];
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'reasoning' && typeof block.text === 'string') parts.push('[思考] ' + block.text);
    else if (block.type === 'tool-call') parts.push('[调用 ' + String(block.name || '') + '] ' + String(block.arguments || ''));
    else if (block.type === 'tool-result' && typeof block.text === 'string') parts.push('[结果] ' + block.text);
  }
  const text = parts.join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) + ' …（截断）' : text;
}

export function toMessages(events, {offset = 0, limit = 40, includeTools = true, maxChars = 4000} = {}) {
  const messages = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const data = event.data || {};
    if (event.type === 'user/message') {
      messages.push({type: 'user', at: event.time, text: blocksText(data.content, maxChars)});
    } else if (event.type === 'assistant/message') {
      const message = data.message || {};
      const text = blocksText(message.content, maxChars);
      if (text) messages.push({type: 'assistant', at: event.time, text,
                                model: message.source?.model, stop: message.source?.replayState?.response?.stopReason});
    } else if (event.type === 'tool/call') {
      if (includeTools) messages.push({type: 'tool-call', at: event.time, tool: String(data.name || ''),
                                       text: String(data.arguments || '').slice(0, maxChars)});
    } else if (event.type === 'tool/result') {
      if (includeTools) {
        const message = data.message || {};
        messages.push({type: 'tool-result', at: event.time, tool: String(message.source?.callId || ''),
                       text: blocksText(message.content, maxChars), error: data.error?.name || null});
      }
    }
  }
  const total = messages.length;
  return {total, offset, limit, messages: messages.slice(offset, offset + limit)};
}

export async function listSessions({limit = 30, q = ''} = {}) {
  const root = sessionsRoot();
  let entries;
  try { entries = await readdir(root, {withFileTypes: true}); } catch { return {root, total: 0, items: []}; }
  const needle = String(q || '').trim().toLowerCase();
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let children;
    try { children = await readdir(join(root, entry.name), {withFileTypes: true}); } catch { continue; }
    for (const child of children) {
      if (!child.isDirectory() || !SESSION_ID.test(child.name)) continue;
      if (needle && !child.name.toLowerCase().includes(needle)) continue;
      const file = join(root, entry.name, child.name, 'session.v4.jsonl.zstd');
      try {
        const info = await stat(file);
        rows.push({session_id: child.name, workspace: entry.name, cwd: null, bytes: info.size, updated_at: info.mtimeMs});
      } catch { /* no log yet */ }
    }
  }
  rows.sort((a, b) => b.updated_at - a.updated_at);
  const page = rows.slice(0, Math.max(1, Math.min(200, limit)));
  for (const row of page) {
    try { row.cwd = (await readSession(row.session_id)).header.cwd || null; } catch { row.cwd = null; }
  }
  return {root, total: rows.length, items: page};
}
