import test from 'node:test';
import assert from 'node:assert/strict';
import { panel, backend, deferred, video, notebookUrl } from './panel-fixture.js';

test('read-only local preview starts with an installation notice and disabled actions', async () => {
  const f = await panel({ readonly: true });
  assert.match(f.get('context-label').textContent, /설치/); assert.equal(f.get('collect-videos').disabled, true);
  assert.equal(f.get('add-urls').disabled, true); assert.equal(f.get('notice').className, 'notice');
});

test('two rendered panels share search-scoped selection, delete, undo and checkbox focus', async () => {
  const shared = backend({ videos: [video(1, 'Alpha'), video(2, 'Beta')] });
  const a = await panel({ shared }), b = await panel({ shared });
  await a.change('video-search', 'Alpha', 'input');
  const checkbox = a.get('video-list').children[0].children[0]; checkbox.focus();
  await a.change(checkbox, false);
  assert.equal(a.document.activeElement.dataset.focusKey, `video:${video(1).url}`);
  assert.equal(b.get('video-list').children[0].children[0].checked, false);
  assert.match(a.get('delete-videos').textContent, /선택 1개 삭제 \(검색 밖 1개 포함\)/);
  await a.click('delete-videos');
  await shared.handler({ type: 'add', items: [video(3, 'Gamma')] });
  await a.click('undo-delete');
  assert.equal(b.get('video-count').textContent, '3'); assert.equal(b.get('video-list').children[0].children[0].checked, false);
  await a.change('select-videos', true);
  assert.equal(b.get('video-selected').textContent, '3');
  await a.change('select-videos', false);
  assert.equal(b.get('video-selected').textContent, '2');
});

test('fresh re-extraction replaces successful text, preserves failed text and retries only failures', async () => {
  const f = await panel(); await f.click('load-sources'); await f.click('extract-sources');
  assert.equal(f.get('retry-sources').disabled, true); assert.equal(f.get('extract-sources').disabled, false);
  f.script = call => call.operation === 'text' ? call.sourceId === 's0' ? { error: 'Refresh failed' } : { text: 'New text s1' } : f.defaultResult(call);
  await f.click('extract-sources'); await f.click('copy-markdown');
  assert.match(f.clipboard, /Text s0/); assert.match(f.clipboard, /New text s1/); assert.match(f.clipboard, /이전에 추출한 본문/); assert.match(f.clipboard, /Refresh failed/);
  const before = f.calls.length; f.script = call => ({ text: `Retried ${call.sourceId}` }); await f.click('retry-sources');
  assert.deepEqual(f.calls.slice(before).map(call => call.sourceId), ['s0']);
  await f.click('copy-markdown'); assert.match(f.clipboard, /Retried s0/); assert.doesNotMatch(f.clipboard, /이전에 추출한 본문/);
});

test('omission-only notebooks show every row and can export a report', async () => {
  const f = await panel({ sourceCount: 0, omissions: [{ rowIndex: 0, title: 'Unknown', reason: 'ID 없음' }, { rowIndex: 1, title: 'Duplicate', reason: '중복 ID' }] });
  await f.click('load-sources');
  assert.equal(f.get('source-count').textContent, '2'); assert.equal(f.get('source-omissions').children.length, 2);
  assert.equal(f.get('download-markdown').disabled, false); assert.equal(f.get('extract-sources').disabled, true);
  await f.click('copy-markdown'); assert.match(f.clipboard, /Unknown: ID 없음/); assert.match(f.clipboard, /Duplicate: 중복 ID/);
});

test('first 429 stops the shared queue at three requests and cooldown requires manual retry', async () => {
  const f = await panel({ sourceCount: 6 }); await f.click('load-sources');
  const requests = []; f.script = call => { const wait = deferred(); requests.push({ call, ...wait }); return wait.promise; };
  await f.click('extract-sources'); assert.equal(requests.length, 3);
  requests[0].resolve({ error: 'Too many', code: 'RATE_LIMITED', retryAt: Date.now() + 30000 }); await f.flush();
  assert.equal(requests.length, 3); assert.equal(f.get('retry-sources').disabled, true);
  requests[1].resolve({ text: 'First sibling' }); requests[2].resolve({ text: 'Second sibling' }); await f.flush();
  assert.equal(requests.length, 3); assert.equal(f.get('activity').hidden, true); assert.equal(f.get('cooldown').hidden, false);
  assert.equal(f.get('load-sources').disabled, true);
  await f.advance(31000); assert.equal(requests.length, 3); assert.equal(f.get('retry-sources').disabled, false);
  f.script = call => ({ text: `Retried ${call.sourceId}` }); const before = f.calls.length; await f.click('retry-sources');
  assert.deepEqual(f.calls.slice(before).map(call => call.sourceId).sort(), ['s0', 's3', 's4', 's5']);
});

test('cancel drains in-flight requests before allowing another job and keeps earlier text', async () => {
  const f = await panel({ sourceCount: 5 }); await f.click('load-sources'); await f.click('extract-sources');
  const requests = []; f.script = () => { const wait = deferred(); requests.push(wait); return wait.promise; };
  await f.click('extract-sources'); assert.equal(requests.length, 3); await f.click('stop-job');
  assert.equal(f.get('extract-sources').disabled, true); assert.equal(f.get('activity').hidden, false);
  f.get('extract-sources').fire('click'); await f.flush(); assert.equal(requests.length, 3);
  requests.forEach(wait => wait.resolve({ text: 'Must not replace on cancellation' })); await f.flush();
  assert.equal(f.get('activity').hidden, true); assert.equal(f.get('retry-sources').disabled, false);
  await f.click('copy-markdown'); assert.match(f.clipboard, /Text s0/); assert.match(f.clipboard, /최근 갱신이 중단/); assert.doesNotMatch(f.clipboard, /Must not replace/);
});

test('duplicate job starts are rejected before context lookup completes', async () => {
  const f = await panel(); const gate = deferred(); f.queryHook = () => gate.promise;
  f.get('load-sources').fire('click'); f.get('load-sources').fire('click'); await f.flush();
  assert.equal(f.calls.length, 0); gate.resolve(); await f.flush();
  assert.equal(f.calls.filter(call => call.operation === 'list').length, 1);
});

test('choosing another notebook or a failed load retains the old export and never follows active tabs', async () => {
  const otherUrl = notebookUrl.replace('789abc', '789def');
  const f = await panel({ tabs: [{ id: 20, active: true, url: notebookUrl, title: 'Same title' }, { id: 21, active: false, url: otherUrl + '?authuser=1', title: 'Same title' }, { id: 22, active: false, url: otherUrl, title: 'Other window', windowId: 2 }] });
  await f.click('load-sources'); await f.click('extract-sources');
  assert.equal(f.get('notebook-target').children.length, 3);
  assert.notEqual(f.get('notebook-target').children[1].textContent, f.get('notebook-target').children[2].textContent);
  await f.change('notebook-target', '21'); assert.equal(f.get('extract-sources').disabled, true); assert.equal(f.get('copy-markdown').disabled, false);
  f.script = () => ({ error: 'Cannot load other notebook' }); await f.click('load-sources'); await f.click('copy-markdown'); assert.match(f.clipboard, /Text s0/);
  f.tabs.forEach(tab => { tab.active = tab.id === 20; }); await f.refresh(); assert.equal(f.get('notebook-target').value, '21');
  f.tabs = f.tabs.filter(tab => tab.id !== 21); await f.refresh(); assert.equal(f.get('notebook-target').value, '21'); assert.equal(f.get('load-sources').disabled, true);
});

test('a changed tab discards list and collection batches before they are saved', async () => {
  const f = await panel();
  f.script = call => { const result = f.defaultResult(call); f.tabs[0].url += '?authuser=2'; return result; };
  await f.click('load-sources'); assert.equal(f.get('source-count').textContent, '0'); assert.match(f.get('notice').textContent, /바뀌었/);
  const y = await panel({ tabs: [{ id: 10, active: true, url: 'https://www.youtube.com/results?search_query=one' }] });
  y.script = call => { y.tabs[0].url = 'https://www.youtube.com/results?search_query=two'; return y.defaultResult(call); };
  await y.click('collect-videos'); assert.equal(y.get('video-count').textContent, '0');
});

test('repeated collection enriches without resurrecting another panel deletion', async () => {
  const f = await panel({ tabs: [{ id: 10, active: true, url: 'https://www.youtube.com/results?search_query=one' }] }); let reads = 0;
  f.script = async call => {
    if (call.scroll) { await f.shared.handler({ type: 'delete', urls: [video(1).url] }); return { videos: [] }; }
    reads++;
    return { videos: reads === 1 ? [video(1)] : [video(1, 'Enriched'), video(2)], label: '검색 결과', single: reads > 1 };
  };
  await f.click('collect-videos'); await f.advance(800);
  assert.equal(f.get('video-count').textContent, '1'); assert.match(f.get('video-list').textContent, /Video 2/); assert.doesNotMatch(f.get('video-list').textContent, /Enriched/);
});

test('storage failures can be retried with refresh and mutation controls stay disabled until saved', async () => {
  const f = await panel(); const gate = deferred();
  f.runtimeHook = async (command, next) => { if (command.type === 'add') await gate.promise; return next(command); };
  f.get('manual-urls').value = video(1).url; await f.click('add-urls');
  assert.equal(f.get('add-urls').disabled, true); assert.equal(f.get('video-count').textContent, '0');
  gate.resolve(); await f.flush(); assert.equal(f.get('add-urls').disabled, false); assert.equal(f.get('video-count').textContent, '1');
  let fails = true; const shared = backend(); const original = shared.handler;
  shared.handler = command => fails ? Promise.reject(new Error('Offline')) : original(command);
  const broken = await panel({ shared }); assert.match(broken.get('notice').textContent, /Offline/); assert.equal(broken.get('add-urls').disabled, true);
  fails = false; await broken.click('refresh-context'); assert.equal(broken.get('add-urls').disabled, false);
});

test('source selection retains keyboard focus through rerender', async () => {
  const f = await panel(); await f.click('load-sources');
  const checkbox = f.get('source-list').children[0].children[0]; checkbox.focus(); await f.change(checkbox, false);
  assert.equal(f.document.activeElement.dataset.focusKey, 'source:s0'); assert.equal(f.get('source-selected').textContent, '1개 선택');
});

test('opening notebooks selects a unique inactive tab or asks for an explicit choice', async () => {
  const youtube = { id: 10, active: true, url: 'https://www.youtube.com/results?search_query=one' };
  const f = await panel({ tabs: [youtube, { id: 20, active: false, url: notebookUrl }] });
  await f.click('open-notebook'); assert.equal(f.get('notebook-target').value, '20'); assert.equal(f.created.length, 0);
  const many = await panel({ tabs: [{ ...youtube }, { id: 20, active: false, url: notebookUrl }, { id: 21, active: false, url: notebookUrl + '?authuser=1' }] });
  await many.click('open-notebook'); assert.equal(many.created.length, 0); assert.equal(many.get('notebook-target').value, ''); assert.equal(many.document.activeElement, many.get('notebook-target')); assert.match(many.get('notice').textContent, /여러 개/);
});

test('list rate limiting uses cooldown too and a repeated limit doubles the fallback delay', async () => {
  const f = await panel(); f.script = () => ({ error: 'Rate limit', code: 'RATE_LIMITED' });
  await f.click('load-sources'); assert.equal(f.get('load-sources').disabled, true); assert.equal(f.get('cooldown').hidden, false);
  await f.advance(31000); assert.equal(f.get('load-sources').disabled, false); assert.equal(f.calls.length, 1);
  await f.click('load-sources'); assert.equal(f.calls[1].retryDelay, 60000);
  await f.advance(31000); assert.equal(f.get('load-sources').disabled, true);
  await f.advance(30000); assert.equal(f.get('load-sources').disabled, false); assert.equal(f.calls.length, 2);
});
