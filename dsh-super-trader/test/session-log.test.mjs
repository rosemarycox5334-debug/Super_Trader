import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {zstdCompressSync} from 'node:zlib';
import {decompressFrames, listSessions, parseEvents, readSession, toMessages, SESSION_ID} from '../lib/session-log.js';

const SID = 'session-0958abb2-6fcb-428f-afac-005b68d17226';
const events = [
  {type: 'session', time: 1, data: {version: 4, id: SID, createdAt: 1794984836042, cwd: 'C:\\work\\demo'}},
  {type: 'user/message', time: 2, data: {content: [{type: 'text', text: '请分析 600900'}]}},
  {type: 'assistant/message', time: 3, data: {message: {role: 'assistant',
    content: [{type: 'reasoning', text: '先取行情'}, {type: 'text', text: '我先取真实行情。'},
              {type: 'tool-call', id: 'c1', name: 'st_market_quotes', arguments: '{"codes":"600900"}'}],
    source: {kind: 'model', provider: 'p', model: 'm', replayState: {response: {stopReason: 'toolUse'}}}}}},
  {type: 'tool/call', time: 4, data: {callId: 'c1', name: 'st_market_quotes', arguments: '{"codes":"600900"}'}},
  {type: 'tool/result', time: 5, data: {message: {role: 'tool', source: {callId: 'c1'},
    content: [{type: 'text', text: '{"items":[{"code":"600900","last_price":30.68}]}'}]}}},
];

/** One zstd frame per line: this is what DSH actually writes. */
function frames(rows) {
  return Buffer.concat(rows.map(row => zstdCompressSync(Buffer.from(JSON.stringify(row) + '\n', 'utf8'))));
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'st-session-log-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const home = join(root, '.dsh');
  const dir = join(home, 'sessions', '--workspace-demo--', SID);
  await mkdir(dir, {recursive: true});
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), frames(events));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; });
  return {home, dir};
}

test('multi-frame session logs decode completely', async t => {
  await setup(t);
  const session = await readSession(SID);
  assert.equal(session.header.cwd, 'C:\\work\\demo');
  assert.equal(session.events.length, events.length);
  assert.ok(decompressFrames(await (await import('node:fs/promises')).readFile(join(session.file))).length > 0);
});

test('messages keep user, assistant and tool events in order', async t => {
  await setup(t);
  const session = await readSession(SID);
  const page = toMessages(session.events, {maxChars: 500});
  assert.deepEqual(page.messages.map(m => m.type), ['user', 'assistant', 'tool-call', 'tool-result']);
  assert.match(page.messages[0].text, /600900/);
  assert.match(page.messages[1].text, /我先取真实行情/);
  assert.match(page.messages[1].text, /\[思考\] 先取行情/);
  assert.match(page.messages[1].text, /\[调用 st_market_quotes\]/);
  assert.match(page.messages[3].text, /30\.68/);
  const withoutTools = toMessages(session.events, {includeTools: false});
  assert.deepEqual(withoutTools.messages.map(m => m.type), ['user', 'assistant']);
  const paged = toMessages(session.events, {offset: 2, limit: 1});
  assert.deepEqual(paged.messages.map(m => m.type), ['tool-call']);
  assert.equal(paged.total, 4);
});

test('truncation is explicit and bounded', async t => {
  await setup(t);
  const session = await readSession(SID);
  const page = toMessages(session.events, {maxChars: 200});
  assert.ok(page.messages[0].text.length <= 210);
});

test('list finds sessions with their cwd and rejects invalid ids', async t => {
  await setup(t);
  const listed = await listSessions({limit: 5});
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].session_id, SID);
  assert.equal(listed.items[0].cwd, 'C:\\work\\demo');
  assert.equal(SESSION_ID.test('../../etc/passwd'), false);
  await assert.rejects(readSession('session-..'), /session id 无效/);
  await assert.rejects(readSession('session-aaaaaaaa-bbbb'), /找不到该会话/);
});

test('a corrupted line does not lose the rest of the log', () => {
  const bad = Buffer.concat([zstdCompressSync(Buffer.from('{"type":"session","data":{"id":"x"}}\n')),
                             zstdCompressSync(Buffer.from('not-json\n')),
                             zstdCompressSync(Buffer.from('{"type":"user/message","data":{"content":[{"type":"text","text":"ok"}]}}\n'))]);
  const parsed = parseEvents(bad);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].type, 'user/message');
});
