import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoCommandHandler, connectVideos, VIDEO_STORE_KEY } from '../extension/video-store.js';

const video = n => ({ url: `https://www.youtube.com/watch?v=${String(n).padStart(11, '0')}` });
function fixture(initial = {}) {
  let stored = structuredClone(initial), fail = false;
  const listeners = new Set();
  const storage = {
    get: async () => structuredClone(stored),
    set: async values => {
      if (fail) throw new Error('Disk full');
      const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: stored[key], newValue: structuredClone(value) }]));
      stored = { ...stored, ...structuredClone(values) };
      listeners.forEach(fn => fn(changes, 'local'));
    },
  };
  let handler = createVideoCommandHandler(storage);
  const api = { storage: { onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } }, runtime: { sendMessage: async message => handler(message.command) } };
  return { api, storage, run: command => handler(command), restart: () => { handler = createVideoCommandHandler(storage); }, fail: value => { fail = value; }, stored: () => structuredClone(stored), emit: value => listeners.forEach(fn => fn({ [VIDEO_STORE_KEY]: { newValue: value } }, 'local')) };
}

test('two panels preserve concurrent additions, choices, deletion and scoped undo', async () => {
  const f = fixture(); let a, b;
  const first = connectVideos(f.api, s => { a = s; }), second = connectVideos(f.api, s => { b = s; });
  await Promise.all([first.ready, second.ready]);
  await Promise.all([first.command({ type: 'add', items: [video(1)] }), second.command({ type: 'add', items: [video(2)] })]);
  await first.command({ type: 'select', urls: [video(1).url], selected: false });
  const removed = await second.command({ type: 'delete', urls: [video(1).url] });
  await first.command({ type: 'add', items: [video(3)] });
  await second.command({ type: 'undo', token: removed.undoToken });
  assert.deepEqual(a, b); assert.equal(a.videos.length, 3);
  assert.deepEqual(a.videos.map(v => v.url), [video(1).url, video(2).url, video(3).url]);
  assert.deepEqual(Object.keys(a).sort(), ['revision', 'videos']);
  assert.equal(a.videos.find(v => v.url === video(1).url).selected, false);
  await assert.rejects(second.command({ type: 'undo', token: removed.undoToken }), /이미/);
  first.dispose(); second.dispose();
});

test('two concurrent additions at 499 share the same 500-item cap', async () => {
  const f = fixture(); await f.run({ type: 'add', items: Array.from({ length: 499 }, (_, n) => video(n)) });
  const results = await Promise.all([f.run({ type: 'add', items: [video(600)] }), f.run({ type: 'add', items: [video(601)] })]);
  assert.equal(results.reduce((sum, result) => sum + result.added, 0), 1);
  assert.equal((await f.run({ type: 'read' })).snapshot.videos.length, 500);
});

test('migration survives worker recreation and stale revisions never roll back a panel', async () => {
  const f = fixture({ videos: [video(1)] }); let latest;
  const client = connectVideos(f.api, s => { latest = s; }); await client.ready;
  f.restart(); await client.command({ type: 'add', items: [video(2)] });
  f.emit({ revision: 0, videos: [] });
  assert.equal(latest.videos.length, 2);
  assert.equal(f.stored().videos.length, 1);
  client.dispose();
});

test('slow initial response cannot overwrite a newer storage event', async () => {
  const f = fixture(); const baseSend = f.api.runtime.sendMessage; let release;
  f.api.runtime.sendMessage = async message => {
    const response = await baseSend(message);
    if (message.command.type === 'read') await new Promise(resolve => { release = resolve; });
    return response;
  };
  let latest; const client = connectVideos(f.api, s => { latest = s; });
  await new Promise(resolve => setImmediate(resolve));
  await f.run({ type: 'add', items: [video(4)] }); release(); await client.ready;
  assert.equal(latest.videos[0].url, video(4).url); client.dispose();
});

test('enrichment at 500 respects deleted items and undo invalidation after re-add', async () => {
  const f = fixture(); await f.run({ type: 'add', items: Array.from({ length: 500 }, (_, n) => video(n)) });
  await f.run({ type: 'add', items: [video(600), { ...video(1), title: 'Known title', channel: 'Known channel' }] });
  let result = await f.run({ type: 'read' }); assert.equal(result.snapshot.videos.length, 500);
  assert.equal(result.snapshot.videos[1].title, 'Known title');
  const removed = await f.run({ type: 'delete', urls: [video(1).url] });
  await f.run({ type: 'enrich', items: [{ ...video(1), title: 'Must not restore' }] });
  assert.equal((await f.run({ type: 'read' })).snapshot.videos.length, 499);
  await f.run({ type: 'add', items: [{ ...video(1), title: 'New title' }] });
  await f.run({ type: 'delete', urls: [video(1).url] });
  result = await f.run({ type: 'undo', token: removed.undoToken });
  assert.equal(result.restored, 0); assert.equal(result.snapshot.videos.length, 499);
});

test('undo reports capacity omissions and expires persisted tokens', async () => {
  const f = fixture(); await f.run({ type: 'add', items: [video(1)] });
  const removed = await f.run({ type: 'delete', urls: [video(1).url] });
  await f.run({ type: 'add', items: Array.from({ length: 500 }, (_, n) => video(n + 10)) });
  const result = await f.run({ type: 'undo', token: removed.undoToken });
  assert.equal(result.skipped, 1); assert.equal(result.restored, 0);
  const stale = f.stored(); stale[VIDEO_STORE_KEY].undoRecords = [{ token: 'expired', expiresAt: Date.now() - 1, videos: [], positions: {} }];
  await assert.rejects(fixture(stale).run({ type: 'undo', token: 'expired' }), /시간/);
});

test('corruption and failed writes preserve storage and do not publish successful snapshots', async () => {
  const corrupt = fixture({ [VIDEO_STORE_KEY]: { broken: true }, videos: [video(1)] });
  await assert.rejects(corrupt.run({ type: 'read' }), /형식/);
  assert.deepEqual(corrupt.stored()[VIDEO_STORE_KEY], { broken: true });
  const f = fixture(); let latest; const client = connectVideos(f.api, s => { latest = s; }); await client.ready;
  f.fail(true); await assert.rejects(client.command({ type: 'add', items: [video(1)] }), /Disk full/);
  assert.equal(latest.videos.length, 0); client.dispose();
});

test('a lost mutation response causes a read, never a second mutation', async () => {
  const f = fixture(); const send = f.api.runtime.sendMessage; const commands = [];
  f.api.runtime.sendMessage = async message => { commands.push(message.command.type); const result = await send(message); if (message.command.type === 'add') throw new Error('Response lost'); return result; };
  let latest; const client = connectVideos(f.api, s => { latest = s; }); await client.ready;
  await assert.rejects(client.command({ type: 'add', items: [video(1)] }), /Response lost/);
  assert.deepEqual(commands, ['read', 'add', 'read']); assert.equal(latest.videos.length, 1); client.dispose();
});
