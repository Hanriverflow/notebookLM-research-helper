import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { installMockChrome } from '../tools/mock-chrome.js';
import { createVideoCommandHandler, connectVideos } from '../extension/video-store.js';
import { collectYouTube } from '../extension/page-actions.js';

test('preview panels use shared storage commands and notifications across separate hosts', async () => {
  const stored = new Map(), hosts = []; let lock = Promise.resolve();
  const host = () => {
    const listeners = new Set();
    const instance = { listeners, addEventListener: (name, fn) => { if (name === 'storage') listeners.add(fn); },
      navigator: { locks: { request: (name, fn) => { const result = lock.then(fn); lock = result.catch(() => {}); return result; } } },
      localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, newValue) => { const oldValue = stored.get(key) ?? null; stored.set(key, newValue); hosts.filter(other => other !== instance).forEach(other => other.listeners.forEach(fn => fn({ key, oldValue, newValue }))); } },
    }; hosts.push(instance); return instance;
  };
  let a, b; const first = connectVideos(installMockChrome(host()), value => { a = value; }); const second = connectVideos(installMockChrome(host()), value => { b = value; });
  await Promise.all([first.ready, second.ready]);
  await Promise.all([first.command({ type: 'add', items: [{ url: 'https://youtu.be/abcdefghijk' }] }), second.command({ type: 'add', items: [{ url: 'https://youtu.be/12345678901' }] })]);
  await first.command({ type: 'select', urls: [a.videos[0].url], selected: false });
  assert.deepEqual(a, b); assert.equal(a.videos.length, 2); assert.equal(b.videos[0].selected, false);
  const removed = await second.command({ type: 'delete', urls: [b.videos[0].url] });
  await first.command({ type: 'undo', token: removed.undoToken }); assert.deepEqual(a, b); assert.equal(b.videos.length, 2);
  first.dispose(); second.dispose();
});

test('service worker registers its listener synchronously and keeps asynchronous responses open', async () => {
  const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  let listener, stored = {}; let resolveResponse;
  const response = new Promise(resolve => { resolveResponse = resolve; });
  const chrome = { runtime: { id: 'extension-id', onMessage: { addListener: fn => { listener = fn; } } }, storage: { local: { get: async () => structuredClone(stored), set: async values => { stored = { ...stored, ...structuredClone(values) }; } } }, sidePanel: { setPanelBehavior: async () => {} } };
  vm.runInNewContext(source.replace(/^import .+;\r?\n/gm, ''), { chrome, createVideoCommandHandler, console });
  assert.equal(typeof listener, 'function');
  assert.equal(listener({ type: 'video-command', command: { type: 'add', items: [{ url: 'https://youtu.be/abcdefghijk' }] } }, { id: 'extension-id' }, resolveResponse), true);
  assert.equal((await response).snapshot.videos.length, 1);
  assert.equal(listener({ type: 'video-command', command: { type: 'read' } }, { id: 'other-id' }, () => assert.fail('Foreign sender was accepted')), undefined);
});

test('injected YouTube collection refuses changed routes before reading or scrolling', () => {
  let reads = 0, scrolls = 0;
  const context = { location: new URL('https://www.youtube.com/results?search_query=changed'), URL, URLSearchParams,
    document: { querySelectorAll: () => { reads++; return []; }, querySelector: () => null, documentElement: { scrollHeight: 0 } }, window: { scrollTo: () => { scrolls++; } },
  };
  const run = vm.runInNewContext(`(${collectYouTube.toString()})`, context);
  assert.equal(run({ route: 'https://www.youtube.com/results?search_query=original', scroll: true }).code, 'CONTEXT_CHANGED');
  assert.equal(reads, 0); assert.equal(scrolls, 0);
  assert.equal(run({ route: context.location.href, scroll: true }).videos.length, 0); assert.equal(reads, 1); assert.equal(scrolls, 1);
});
