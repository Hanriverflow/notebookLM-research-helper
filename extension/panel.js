import { pageKind, mergeVideos, linksFromText, composeMarkdown, exportFilename } from './core.js';
import { collectYouTube, readNotebook } from './page-actions.js';
import { connectVideos } from './video-store.js';

const $ = id => document.getElementById(id);
const state = { videos: [], sources: [], notebook: null, notebookTabId: null, targetTabId: null, notebookTabs: [], tab: null, view: 'videos', job: null, undo: null, cooldowns: new Map() };
const available = Boolean(globalThis.chrome?.runtime?.id);
let library, cooldownTimer;

function notify(message, error = false) {
  $('notice').textContent = message;
  $('notice').className = 'notice' + (error ? ' error' : '');
  $('notice').hidden = false;
}
function setView(view) {
  if (view !== state.view) $('notice').hidden = true;
  state.view = view;
  $('videos-view').hidden = view !== 'videos'; $('sources-view').hidden = view !== 'sources';
  for (const key of ['videos', 'sources']) {
    $(`tab-${key}`).classList.toggle('active', view === key);
    $(`tab-${key}`).setAttribute('aria-pressed', String(view === key));
  }
}
function urlContext(rawUrl) {
  const url = new URL(rawUrl);
  return { origin: url.origin, notebookId: url.pathname.match(/\/notebook\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] || '', urlAuthuser: url.searchParams.get('authuser') || '' };
}
const contextKey = context => JSON.stringify([context.origin, context.notebookId, context.urlAuthuser]);
const routeOf = rawUrl => { const url = new URL(rawUrl); return url.origin + url.pathname + url.search; };
function renderNotebookChoices() {
  const options = state.notebookTabs.map(tab => {
    const option = document.createElement('option'); option.value = String(tab.id);
    const context = urlContext(tab.url);
    option.textContent = `${tab.title || '노트북'} · ${context.notebookId.slice(0, 8)} · ${new URL(tab.url).hostname} · 계정 ${context.urlAuthuser || '기본'} · 탭 ${tab.id}`;
    return option;
  });
  const placeholder = document.createElement('option'); placeholder.value = '';
  placeholder.textContent = state.notebookTabs.length ? '자료를 꺼낼 노트북 선택' : '현재 창에 열린 노트북이 없습니다';
  if (state.targetTabId !== null && !state.notebookTabs.some(tab => tab.id === state.targetTabId)) {
    const missing = document.createElement('option'); missing.value = String(state.targetTabId); missing.textContent = '선택한 노트북 탭을 찾을 수 없습니다'; options.push(missing);
  }
  $('notebook-target').replaceChildren(placeholder, ...options);
  $('notebook-target').value = state.targetTabId === null ? '' : String(state.targetTabId);
}
async function refreshContext() {
  if (!available) return;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  state.tab = tabs.find(tab => tab.active);
  state.notebookTabs = tabs.filter(tab => pageKind(tab.url) === 'notebook');
  if (state.targetTabId === null && pageKind(state.tab?.url) === 'notebook') state.targetTabId = state.tab.id;
  renderNotebookChoices();
  const kind = pageKind(state.tab?.url);
  const labels = { youtube: '유튜브에서 영상을 모을 수 있어요', notebook: '이 노트북에서 자료를 꺼낼 수 있어요', 'notebook-home': '자료가 있는 노트북을 열어 주세요', other: '유튜브 또는 노트북 탭을 열어 주세요' };
  $('context-label').textContent = labels[kind];
  $('context-dot').classList.toggle('ready', ['youtube', 'notebook'].includes(kind)); updateButtons();
}
async function runInTab(tabId, func, args, world = 'ISOLATED') {
  if (!Number.isInteger(tabId)) throw new Error('사용할 탭을 먼저 열어 주세요.');
  let results;
  try { results = await chrome.scripting.executeScript({ target: { tabId }, func, args: [args], world }); }
  catch { throw new Error('페이지에 연결할 수 없습니다. 해당 탭을 새로고침하고 다시 시도해 주세요.'); }
  const value = results?.[0]?.result;
  if (!value) throw new Error('페이지에서 응답이 없습니다. 새로고침하고 다시 시도해 주세요.');
  if (value.error) { const error = new Error(value.error); error.code = value.code; error.retryAt = value.retryAt; throw error; }
  return value;
}
async function guardTab(tabId, expected, kind) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || pageKind(tab.url) !== kind || (kind === 'youtube' ? routeOf(tab.url) !== expected : contextKey(urlContext(tab.url)) !== contextKey(expected))) {
    const error = new Error('선택한 탭의 페이지가 바뀌었거나 닫혔습니다. 목록을 다시 불러와 주세요.'); error.code = 'CONTEXT_CHANGED'; throw error;
  }
}
function visibleVideos() {
  const query = $('video-search').value.trim().toLocaleLowerCase();
  return state.videos.filter(v => !query || [v.title, v.channel, v.url].some(value => value.toLocaleLowerCase().includes(query)));
}
function retrySources() { return state.sources.filter(s => s.selected && (!s.lastSuccess || ['error', 'cancelled'].includes(s.attempt.state))); }
function currentCooldown() {
  const tab = state.notebookTabs.find(t => t.id === state.targetTabId);
  return tab ? state.cooldowns.get(contextKey(urlContext(tab.url))) : null;
}
function loadedTargetMatches() {
  const tab = state.notebookTabs.find(t => t.id === state.targetTabId);
  return tab && state.notebook && tab.id === state.notebookTabId && contextKey(urlContext(tab.url)) === contextKey(state.notebook.context);
}
function updateButtons() {
  const busy = Boolean(state.job), chosen = state.videos.filter(v => v.selected).length;
  const selected = state.sources.filter(s => s.selected), shown = visibleVideos();
  const targetExists = state.notebookTabs.some(tab => tab.id === state.targetTabId);
  const cooldown = currentCooldown(), cooling = cooldown?.retryAt > Date.now();
  const canExport = state.notebook && (selected.length || state.notebook.omissions.length);
  $('collect-videos').disabled = busy || !library || pageKind(state.tab?.url) !== 'youtube';
  $('load-sources').disabled = busy || !available || !targetExists || cooling;
  $('extract-sources').disabled = busy || !selected.length || cooling || !loadedTargetMatches();
  $('retry-sources').disabled = busy || !retrySources().length || cooling || !loadedTargetMatches();
  $('notebook-target-note').hidden = !state.notebook || loadedTargetMatches();
  $('notebook-target-note').textContent = '다른 노트북을 선택했습니다. 새 목록을 불러올 때까지 아래의 이전 본문은 저장할 수 있습니다.';
  for (const id of ['copy-links', 'save-links', 'send-notebook', 'delete-videos']) $(id).disabled = busy || !chosen;
  for (const id of ['download-markdown', 'copy-markdown']) $(id).disabled = busy || !canExport;
  $('clear-videos').disabled = busy || !state.videos.length; $('select-videos').disabled = busy || !shown.length;
  $('select-sources').disabled = busy || !state.sources.length; $('add-urls').disabled = busy || !library;
  $('open-youtube').disabled = !available; $('open-notebook').disabled = !available;
  $('video-limit').disabled = busy; $('notebook-target').disabled = busy;
  $('undo-delete').disabled = busy || !state.undo || state.undo.expiresAt <= Date.now();
  const hiddenSelected = state.videos.filter(v => v.selected && !shown.includes(v)).length;
  $('delete-videos').textContent = `선택 ${chosen}개 삭제${hiddenSelected ? ` (검색 밖 ${hiddenSelected}개 포함)` : ''}`;
  $('cooldown').hidden = !cooling;
  $('cooldown').textContent = cooling ? `요청이 많아 멈췄습니다. ${new Date(cooldown.retryAt).toLocaleTimeString()}부터 직접 다시 시도할 수 있습니다.` : '';
  clearTimeout(cooldownTimer);
  if (cooling) { cooldownTimer = setTimeout(updateButtons, Math.min(cooldown.retryAt - Date.now() + 20, 60000)); cooldownTimer.unref?.(); }
  for (const input of document.querySelectorAll('.item input')) input.disabled = busy;
}
function setAllState(input, items) {
  const n = items.filter(i => i.selected).length;
  input.checked = Boolean(items.length) && n === items.length; input.indeterminate = n > 0 && n < items.length;
}
function replaceList(id, items, type) {
  const focusKey = document.activeElement?.dataset?.focusKey;
  const rows = items.map(item => makeItem(item, type)); $(id).replaceChildren(...rows);
  if (focusKey) rows.flatMap(row => [...row.children]).find(child => child.dataset?.focusKey === focusKey)?.focus();
}
function makeItem(item, type) {
  const row = document.createElement('div'); row.className = 'item' + (item.selected ? ' selected' : '');
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = item.selected;
  checkbox.dataset.focusKey = `${type}:${type === 'video' ? item.url : item.id}`;
  checkbox.setAttribute('aria-label', item.title + ' 선택');
  checkbox.addEventListener('change', async () => {
    if (type === 'source') { item.selected = checkbox.checked; renderSources(); return; }
    try { await changeVideos({ type: 'select', urls: [item.url], selected: checkbox.checked }); }
    catch (error) { renderVideos(); notify(error.message, true); }
  });
  const body = document.createElement('div'); body.className = 'item-body';
  const title = document.createElement(item.url && /^https?:\/\//.test(item.url) ? 'a' : 'span');
  title.className = 'item-title'; title.textContent = item.title;
  if (title.tagName === 'A') { title.href = item.url; title.target = '_blank'; title.rel = 'noreferrer noopener'; } body.append(title);
  const meta = document.createElement('div'); meta.className = 'item-meta';
  const badge = document.createElement('span'); badge.className = 'kind'; badge.textContent = type === 'video' ? 'YouTube' : item.kind;
  const subtitle = document.createElement('span'); subtitle.textContent = item.channel || (type === 'video' ? '영상 링크' : item.lastSuccess ? `${item.lastSuccess.text.length.toLocaleString()}자` : '본문 자료');
  meta.append(badge, subtitle); body.append(meta);
  if (item.attempt?.error) { const error = document.createElement('div'); error.className = 'item-error'; error.textContent = item.attempt.error; body.append(error); }
  if (type === 'source' && item.lastSuccess && item.attempt.state !== 'done') {
    const retained = document.createElement('div'); retained.className = 'item-error'; retained.textContent = `${new Date(item.lastSuccess.extractedAt).toLocaleString()} 본문 보존 중`; body.append(retained);
  }
  row.append(checkbox, body);
  if (type === 'source') {
    const status = document.createElement('span'); status.className = 'status ' + item.attempt.state;
    status.textContent = { idle: '대기', loading: '추출 중', done: '완료', error: '확인 필요', cancelled: '중단' }[item.attempt.state]; row.append(status);
  } return row;
}
function renderVideos() {
  const shown = visibleVideos(); replaceList('video-list', shown, 'video');
  $('video-count').textContent = state.videos.length; $('video-selected').textContent = state.videos.filter(v => v.selected).length;
  $('video-empty').hidden = Boolean(state.videos.length); $('video-no-results').hidden = !state.videos.length || Boolean(shown.length);
  $('video-actions').hidden = !state.videos.length; $('video-visible').textContent = `${shown.length}개 표시`;
  $('undo-delete').hidden = !state.undo; setAllState($('select-videos'), shown); updateButtons();
}
function renderSources() {
  replaceList('source-list', state.sources, 'source');
  const omissions = state.notebook?.omissions || [];
  $('source-count').textContent = state.notebook?.reportedCount ?? 0;
  $('source-selected').textContent = state.sources.filter(s => s.selected).length + '개 선택';
  $('source-empty').hidden = Boolean(state.sources.length || omissions.length); $('source-actions').hidden = !state.sources.length && !omissions.length;
  $('notebook-info').hidden = !state.notebook; $('notebook-title').textContent = state.notebook?.title || '';
  $('source-omissions').hidden = !omissions.length;
  $('source-omissions').replaceChildren(...omissions.map(omission => {
    const row = document.createElement('p'); row.textContent = `${omission.rowIndex + 1}번째 항목 · ${omission.title}: ${omission.reason}`; return row;
  })); setAllState($('select-sources'), state.sources); updateButtons();
}
function startJob(label, total, cancellable = true) {
  if (state.job) throw new Error('진행 중인 요청이 끝난 뒤 다시 시도해 주세요.');
  const job = { cancelled: false, halted: null, rateLimited: false, cancellable, focusKey: document.activeElement?.dataset?.focusKey };
  state.job = job; $('activity').hidden = false; $('stop-job').disabled = !cancellable; $('activity-text').textContent = label;
  if (total) { $('progress').max = total; $('progress').value = 0; } else $('progress').removeAttribute('value');
  $('notice').hidden = true; updateButtons(); return job;
}
function finishJob(job) {
  if (state.job === job) {
    state.job = null; $('activity').hidden = true; updateButtons();
    if (job.focusKey) [...document.querySelectorAll('.item input')].find(input => input.dataset.focusKey === job.focusKey)?.focus();
  }
}
async function changeVideos(command, onSuccess = () => {}) {
  const job = startJob('영상 목록을 저장하고 있어요', null, false);
  try { const result = await library.command(command); onSuccess(result); return result; }
  finally { finishJob(job); }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function collectVideos() {
  const job = startJob('영상 목록을 읽고 있어요');
  let collected = [], unchanged = 0, added = 0; const seen = new Set();
  try {
    await refreshContext();
    if (pageKind(state.tab?.url) !== 'youtube') throw new Error('유튜브 검색 결과, 채널 또는 재생목록 탭을 열어 주세요.');
    const tabId = state.tab.id, route = routeOf(state.tab.url), limit = Number($('video-limit').value);
    for (let round = 0; round < 45 && !job.cancelled; round++) {
      await guardTab(tabId, route, 'youtube');
      const result = await runInTab(tabId, collectYouTube, { scroll: false, route });
      await guardTab(tabId, route, 'youtube'); if (job.cancelled) break;
      const count = collected.length; collected = mergeVideos(collected, result.videos, limit || 500);
      const incoming = mergeVideos([], result.videos).filter(v => collected.some(item => item.url === v.url));
      const firstSeen = incoming.filter(v => !seen.has(v.url)), repeated = incoming.filter(v => seen.has(v.url)); firstSeen.forEach(v => seen.add(v.url));
      if (firstSeen.length) added += (await library.command({ type: 'add', items: firstSeen })).added;
      if (repeated.length) await library.command({ type: 'enrich', items: repeated });
      $('activity-text').textContent = `${result.label}에서 ${collected.length}개 찾았어요`;
      if (!limit || collected.length >= limit || result.single) break;
      unchanged = collected.length === count ? unchanged + 1 : 0;
      if (unchanged >= 6 || job.cancelled) break;
      await guardTab(tabId, route, 'youtube'); await runInTab(tabId, collectYouTube, { scroll: true, route }); await pause(800);
    }
    if (job.cancelled) notify(`수집을 멈췄습니다. 지금까지 추가한 ${added}개는 목록에 남아 있어요.`);
    else if (state.videos.length >= 500) notify('목록은 최대 500개까지 보관합니다. 기존 영상의 제목과 채널은 보완했어요.');
    else if (!collected.length) notify('일반 영상을 찾지 못했습니다. 목록이 보이는지 확인하고 다시 시도해 주세요.', true);
    else notify(added ? `${added}개를 추가했어요.` : '이미 모은 영상입니다. 비어 있던 제목과 채널은 보완했어요.');
  } finally { finishJob(job); }
}
function selectedLinks() { return state.videos.filter(v => v.selected).map(v => v.url).join('\n'); }
async function copy(text) {
  if (!text) throw new Error('먼저 자료를 선택해 주세요.');
  try { await navigator.clipboard.writeText(text); } catch { throw new Error('클립보드 복사가 막혔습니다. 파일 저장 버튼을 이용해 주세요.'); }
}
function download(text, filename, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function openNotebook() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const notebooks = tabs.filter(tab => pageKind(tab.url) === 'notebook');
  if (state.targetTabId === null && notebooks.length === 1) { state.targetTabId = notebooks[0].id; state.notebookTabs = notebooks; renderNotebookChoices(); }
  if (state.targetTabId !== null) {
    const target = tabs.find(tab => tab.id === state.targetTabId && pageKind(tab.url) === 'notebook');
    if (!target) throw new Error('선택한 노트북 탭을 찾을 수 없습니다. 다른 노트북을 직접 선택해 주세요.');
    await chrome.tabs.update(target.id, { active: true });
  } else if (notebooks.length > 1) {
    state.notebookTabs = notebooks; renderNotebookChoices(); setView('sources'); $('notebook-target').focus();
    notify('현재 창에 노트북이 여러 개 있습니다. 가져갈 노트북을 선택하고 노트북 열기를 눌러 주세요.'); return false;
  } else await chrome.tabs.create({ url: 'https://notebook.google.com/' });
  return true;
}
function checkCooldown(key) {
  const cooldown = state.cooldowns.get(key);
  if (cooldown?.retryAt > Date.now()) throw new Error(`${new Date(cooldown.retryAt).toLocaleTimeString()}부터 다시 시도할 수 있습니다.`);
}
function rateLimit(job, error, key) {
  const previous = state.cooldowns.get(key) || { strikes: 0, retryAt: 0 };
  const retryAt = Math.max(previous.retryAt, Number(error.retryAt) || Date.now() + Math.min(300000, 30000 * 2 ** previous.strikes));
  state.cooldowns.set(key, { retryAt, strikes: previous.strikes + (job.rateLimited ? 0 : 1) });
  job.rateLimited = true; job.halted = '요청 제한으로 추출하지 못했습니다.'; updateButtons();
}
async function loadSources() {
  const job = startJob('소스 목록을 읽고 있어요'); let key;
  try {
    await refreshContext();
    const tab = state.notebookTabs.find(t => t.id === state.targetTabId);
    if (!tab) throw new Error('현재 창에서 자료가 있는 노트북을 선택해 주세요.');
    const context = urlContext(tab.url); key = contextKey(context); checkCooldown(key); if (job.cancelled) return;
    const result = await runInTab(tab.id, readNotebook, { operation: 'list', context, retryDelay: Math.min(300000, 30000 * 2 ** (state.cooldowns.get(key)?.strikes || 0)) }, 'MAIN');
    await guardTab(tab.id, context, 'notebook'); if (job.cancelled || state.job !== job) return;
    const sameContext = state.notebook && JSON.stringify(state.notebook.context) === JSON.stringify(result.notebook.context);
    const old = sameContext ? new Map(state.sources.map(s => [s.id, s])) : new Map();
    state.notebook = { ...result.notebook, omissions: result.omissions, reportedCount: result.reportedCount }; state.notebookTabId = tab.id;
    state.sources = result.sources.map(s => ({ ...s, selected: old.get(s.id)?.selected ?? true, lastSuccess: old.get(s.id)?.lastSuccess || null, attempt: old.get(s.id)?.attempt || { state: 'idle' } }));
    state.cooldowns.delete(key); $('handoff-note').hidden = true; renderSources();
    notify(`${result.reportedCount}개 중 ${state.sources.length}개 소스를 불러왔어요.${result.omissions.length ? ` 확인하지 못한 ${result.omissions.length}개는 화면과 저장 파일에 남깁니다.` : ''}`);
  } catch (error) { if (error.code === 'RATE_LIMITED') rateLimit(job, error, key); throw error; }
  finally { finishJob(job); }
}
async function extractSources(mode) {
  if (state.job) throw new Error('진행 중인 요청이 끝난 뒤 다시 시도해 주세요.');
  if (!state.notebook) throw new Error('소스 목록을 먼저 불러와 주세요.');
  if (!loadedTargetMatches()) throw new Error('본문을 불러온 노트북을 선택하거나 새 소스 목록을 불러와 주세요.');
  const notebook = state.notebook, key = contextKey(notebook.context); checkCooldown(key);
  const pending = mode === 'fresh' ? state.sources.filter(s => s.selected) : retrySources(); if (!pending.length) return;
  const job = startJob(`0 / ${pending.length}개 추출`, pending.length);
  const tabId = state.notebookTabId, retryDelay = Math.min(300000, 30000 * 2 ** (state.cooldowns.get(key)?.strikes || 0));
  let cursor = 0, finished = 0; pending.forEach(source => { source.attempt = { state: 'idle' }; });
  const current = () => state.job === job && state.notebook === notebook;
  const worker = async () => {
    while (cursor < pending.length && !job.cancelled && !job.halted && current()) {
      const source = pending[cursor++]; source.attempt = { state: 'loading' }; renderSources();
      try {
        await guardTab(tabId, notebook.context, 'notebook');
        if (job.cancelled || job.halted) { source.attempt = { state: 'cancelled', error: job.halted || '추출을 중단했습니다.' }; continue; }
        const result = await runInTab(tabId, readNotebook, { operation: 'text', notebookId: notebook.id, sourceId: source.id, context: notebook.context, retryDelay }, 'MAIN');
        await guardTab(tabId, notebook.context, 'notebook'); if (!current()) return;
        if (job.cancelled) source.attempt = { state: 'cancelled', error: '추출을 중단했습니다.' };
        else { source.lastSuccess = { text: result.text, extractedAt: new Date().toISOString() }; source.attempt = { state: 'done' }; }
      } catch (error) {
        if (!current()) return;
        if (error.code === 'RATE_LIMITED') rateLimit(job, error, key);
        if (error.code === 'CONTEXT_CHANGED') job.halted = error.message;
        source.attempt = { state: job.cancelled ? 'cancelled' : 'error', error: error.message };
      }
      finished++; $('activity-text').textContent = `${finished} / ${pending.length}개 추출`; $('progress').value = finished; renderSources();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker)); if (!current()) return;
    pending.filter(source => source.attempt.state === 'idle').forEach(source => { source.attempt = { state: job.cancelled ? 'cancelled' : 'error', error: job.halted || '추출을 중단했습니다.' }; });
    if (!job.rateLimited && !job.cancelled && !job.halted) state.cooldowns.delete(key); renderSources();
    const selected = state.sources.filter(s => s.selected), done = selected.filter(s => s.lastSuccess).length;
    notify(`${job.cancelled ? '중지했습니다. ' : ''}${selected.length}개 중 ${done}개의 본문을 저장할 수 있어요. 이전 본문과 실패·누락 내역은 저장 파일에 표시됩니다.`, done === 0);
  } finally { finishJob(job); }
}
async function deleteVideos(urls) {
  await changeVideos({ type: 'delete', urls }, result => {
    if (result.undoToken) state.undo = { token: result.undoToken, expiresAt: result.undoExpiresAt };
    renderVideos(); notify(`${result.deleted}개를 삭제했습니다. 5분 안에 삭제 취소할 수 있어요.`);
  });
}
function on(id, action) { $(id).addEventListener('click', () => Promise.resolve().then(action).catch(error => notify(error.message || '작업을 완료하지 못했습니다.', true))); }

on('tab-videos', () => setView('videos')); on('tab-sources', () => setView('sources'));
on('refresh-context', async () => { if (available && !library) await connectLibrary(); await refreshContext(); }); on('collect-videos', collectVideos); on('load-sources', loadSources);
on('extract-sources', () => extractSources('fresh')); on('retry-sources', () => extractSources('retry'));
on('stop-job', () => { if (state.job?.cancellable) { state.job.cancelled = true; $('stop-job').disabled = true; $('activity-text').textContent = '진행 중인 요청이 끝나면 멈춥니다…'; } });
on('open-youtube', () => chrome.tabs.create({ url: 'https://www.youtube.com/' })); on('open-notebook', openNotebook);
on('add-urls', async () => {
  const videos = linksFromText($('manual-urls').value);
  if (!videos.length) throw new Error('일반 유튜브 영상 주소를 붙여 넣어 주세요. 쇼츠·채널 주소는 목록으로 추가할 수 없습니다.');
  await changeVideos({ type: 'add', items: videos }, result => { $('manual-urls').value = ''; notify(`${result.added}개의 링크를 추가했어요.`); });
});
on('clear-videos', () => deleteVideos(state.videos.map(v => v.url)));
on('delete-videos', () => deleteVideos(state.videos.filter(v => v.selected).map(v => v.url)));
on('undo-delete', () => changeVideos({ type: 'undo', token: state.undo.token }, result => { state.undo = null; renderVideos(); notify(`${result.restored}개를 복원했습니다.${result.skipped ? ` 용량 제한으로 ${result.skipped}개는 복원하지 못했습니다.` : ''}`); }));
on('copy-links', async () => { await copy(selectedLinks()); notify(`${state.videos.filter(v => v.selected).length}개의 링크를 복사했어요.`); });
on('save-links', () => { download(selectedLinks() + '\n', '유튜브_영상_링크.txt', 'text/plain;charset=utf-8'); notify('링크 목록 다운로드를 시작했어요.'); });
on('send-notebook', async () => { await copy(selectedLinks()); $('handoff-note').hidden = false; setView('sources'); if (await openNotebook() === false) return; await refreshContext(); notify('링크가 클립보드에 있어요. 노트북의 ‘소스 추가 → 웹사이트’에 붙여 넣으세요.'); });
on('download-markdown', () => { download(composeMarkdown(state.notebook, state.sources), exportFilename(state.notebook.title)); notify('다운로드를 시작했어요. 저장한 .md 파일을 AI 채팅에 첨부하거나 Obsidian으로 옮기세요.'); });
on('copy-markdown', async () => { await copy(composeMarkdown(state.notebook, state.sources)); notify('본문과 실패·누락 내역을 복사했어요.'); });
$('video-search').addEventListener('input', renderVideos);
$('notebook-target').addEventListener('change', () => {
  state.targetTabId = $('notebook-target').value ? Number($('notebook-target').value) : null;
  updateButtons();
});
$('select-videos').addEventListener('change', async event => {
  try { await changeVideos({ type: 'select', urls: visibleVideos().map(v => v.url), selected: event.target.checked }); }
  catch (error) { renderVideos(); notify(error.message, true); }
});
$('select-sources').addEventListener('change', event => { state.sources.forEach(s => { s.selected = event.target.checked; }); renderSources(); });

async function connectLibrary() {
  const connection = connectVideos(chrome, snapshot => { state.videos = snapshot.videos; renderVideos(); });
  try { await connection.ready; library = connection; }
  catch (error) { connection.dispose(); throw error; }
}
async function init() {
  renderVideos(); renderSources();
  if (!available) {
    $('context-label').textContent = '브라우저 확장 프로그램으로 설치해 주세요';
    notify('이 화면은 확장 프로그램 안에서 동작합니다. 오른쪽 위 ? 버튼에서 설치 방법을 확인하세요.'); return;
  }
  chrome.tabs.onActivated.addListener(() => refreshContext().catch(() => {}));
  chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.url || change.status === 'complete') refreshContext().catch(() => {}); });
  chrome.tabs.onRemoved.addListener(() => refreshContext().catch(() => {}));
  globalThis.addEventListener('unload', () => library?.dispose(), { once: true });
  await connectLibrary(); await refreshContext();
  if (pageKind(state.tab?.url) === 'notebook') setView('sources');
}
init().catch(error => notify(error.message, true));
