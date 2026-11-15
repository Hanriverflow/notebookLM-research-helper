import { createVideoCommandHandler } from '../extension/video-store.js';

export function installMockChrome(host = window) {
  const id = '12345678-1234-1234-1234-123456789abc';
  const context = { origin: 'https://notebook.google.com', notebookId: id, authuser: '0', urlAuthuser: '' };
  const notebook = { id, title: 'AI 리서치 워크플로 · 테스트 자료', url: `${context.origin}/notebook/${id}`, context };
  let tabs = [{ id: 10, active: true, url: 'https://www.youtube.com/results?search_query=AI', title: 'YouTube' }, { id: 20, active: false, url: notebook.url, title: notebook.title }];
  const changed = new Set(), activated = new Set(), updated = new Set(), removed = new Set();
  const event = listeners => ({ addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) });
  const key = 'research-pocket-qa-store';
  const read = () => JSON.parse(host.localStorage.getItem(key) || '{}');
  const publish = (before, after) => {
    const changes = Object.fromEntries(Object.keys(after).filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name])).map(name => [name, { oldValue: before[name], newValue: after[name] }]));
    changed.forEach(fn => fn(changes, 'local'));
  };
  const storage = {
    get: async () => structuredClone(read()),
    set: async value => { const before = read(), after = { ...before, ...value }; host.localStorage.setItem(key, JSON.stringify(after)); publish(before, after); },
  };
  host.addEventListener('storage', change => { if (change.key === key) publish(JSON.parse(change.oldValue || '{}'), JSON.parse(change.newValue || '{}')); });
  const handler = createVideoCommandHandler(storage);
  const videos = [
    { url: 'https://www.youtube.com/watch?v=abcdefghijk', title: '[테스트] AI 리서치, 자료 수집부터 정리까지', channel: '테스트 채널 A' },
    { url: 'https://www.youtube.com/watch?v=12345678901', title: '[테스트] 노트북으로 논문과 영상을 함께 읽기', channel: '테스트 채널 B' },
    { url: 'https://www.youtube.com/watch?v=ZYXWVUTSRQP', title: '[테스트] 출처가 남는 나만의 지식 보관함 만들기', channel: '테스트 채널 C' },
  ];
  host.__qa = { calls: [], failSource: true, slow: false, sourceCount: 3, rateLimited: false, omissions: [], tabs: () => structuredClone(tabs), setTabs: value => { tabs = value; updated.forEach(fn => fn(0, { status: 'complete' })); } };
  host.chrome = {
    runtime: { id: 'qa-fixture', sendMessage: async message => {
      if (message.type !== 'video-command') return;
      if (!host.navigator.locks) throw new Error('미리보기 공유 저장에는 Web Locks를 지원하는 브라우저가 필요합니다.');
      return host.navigator.locks.request('research-pocket-qa-store-writer', () => handler(message.command));
    } },
    storage: { local: storage, onChanged: event(changed) },
    tabs: {
      query: async query => structuredClone(query.active ? tabs.filter(tab => tab.active) : tabs),
      update: async (tabId, changes) => { const tab = tabs.find(t => t.id === tabId); if (!tab) throw new Error('Missing tab'); tabs.forEach(t => { t.active = t.id === tabId; }); Object.assign(tab, changes); activated.forEach(fn => fn({ tabId })); return structuredClone(tab); },
      create: async ({ url }) => { tabs.forEach(tab => { tab.active = false; }); const tab = { id: Math.max(...tabs.map(t => t.id), 0) + 1, active: true, url, title: '새 탭' }; tabs.push(tab); activated.forEach(fn => fn({ tabId: tab.id })); return structuredClone(tab); },
      onActivated: event(activated), onUpdated: event(updated), onRemoved: event(removed),
    },
    scripting: { executeScript: async ({ target, func, args }) => {
      host.__qa.calls.push({ name: func.name, tabId: target.tabId, args });
      await new Promise(resolve => setTimeout(resolve, host.__qa.slow ? 1200 : 180));
      const tab = tabs.find(t => t.id === target.tabId);
      if (!tab) return [{ result: { error: '탭이 닫혔습니다.', code: 'CONTEXT_CHANGED' } }];
      let result;
      if (func.name === 'collectYouTube') result = args[0].route !== tab.url ? { error: '페이지가 바뀌었습니다.', code: 'CONTEXT_CHANGED' } : { videos, label: '검색 결과', single: true };
      else if (host.__qa.rateLimited) result = { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED', retryAt: Date.now() + 30000 };
      else if (args[0].operation === 'list') result = { notebook, sources: Array.from({ length: host.__qa.sourceCount }, (_, i) => ({ ...videos[i % videos.length], id: `s${i}`, kind: '유튜브' })), omissions: host.__qa.omissions, reportedCount: host.__qa.sourceCount + host.__qa.omissions.length };
      else if (args[0].sourceId === 's1' && host.__qa.failSource) result = { error: '테스트용 실패. 자막이 아직 준비되지 않았습니다.' };
      else result = { text: `테스트용 전사 본문 ${args[0].sourceId}\n\n2026\n\n자료의 출처를 남기고 서로 비교합니다.` };
      return [{ result }];
    } },
  };
  return host.chrome;
}

if (typeof window !== 'undefined') {
  installMockChrome();
  const banner = document.createElement('div'); banner.textContent = 'UI 검증용 예시 데이터 · 실제 사용자 자료 아님';
  banner.style.cssText = 'background:#fff0ca;color:#856425;text-align:center;font:11px sans-serif;padding:9px'; document.body.prepend(banner);
  await import('../extension/panel.js');
}
