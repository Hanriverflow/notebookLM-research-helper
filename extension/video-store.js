import { canonicalVideoUrl, mergeVideos } from './core.js';

export const VIDEO_STORE_KEY = 'videoLibrary';
const MAX_VIDEOS = 500;
const UNDO_MS = 5 * 60 * 1000;
const clone = value => structuredClone(value);
const snapshot = store => ({ revision: store.revision, videos: clone(store.videos) });

function validVideos(videos) {
  return Array.isArray(videos) && videos.length <= MAX_VIDEOS && new Set(videos.map(v => v?.url)).size === videos.length && videos.every(v => v && canonicalVideoUrl(v.url) === v.url && typeof v.title === 'string' && v.title.length <= 500 && typeof v.channel === 'string' && v.channel.length <= 200 && typeof v.selected === 'boolean');
}

function validateStore(store) {
  if (!store || store.version !== 1 || !Number.isSafeInteger(store.revision) || store.revision < 0 || !validVideos(store.videos) || !Array.isArray(store.undoRecords) || store.undoRecords.length > 10 || !store.undoRecords.every(r => r && typeof r.token === 'string' && Number.isFinite(r.expiresAt) && validVideos(r.videos) && r.positions && r.videos.every(v => Number.isInteger(r.positions[v.url]) && r.positions[v.url] >= 0))) {
    throw new Error('저장된 영상 목록 형식을 읽을 수 없습니다. 기존 저장 자료는 변경하지 않았습니다.');
  }
}

function validateCommand(command) {
  if (!command || !['read', 'add', 'enrich', 'select', 'delete', 'undo'].includes(command.type)) throw new Error('지원하지 않는 영상 목록 작업입니다.');
  if (['add', 'enrich'].includes(command.type) && (!Array.isArray(command.items) || command.items.length > 5000)) throw new Error('영상 목록을 확인해 주세요.');
  if (['select', 'delete'].includes(command.type) && (!Array.isArray(command.urls) || command.urls.some(url => !canonicalVideoUrl(url)))) throw new Error('변경할 영상 주소를 확인해 주세요.');
  if (command.type === 'select' && typeof command.selected !== 'boolean') throw new Error('영상 선택 상태를 확인해 주세요.');
  if (command.type === 'undo' && typeof command.token !== 'string') throw new Error('삭제 취소 정보를 확인해 주세요.');
}

export function createVideoCommandHandler(storage) {
  let queue = Promise.resolve();
  const execute = async command => {
    validateCommand(command);
    const stored = await storage.get([VIDEO_STORE_KEY, 'videos']);
    let store = stored[VIDEO_STORE_KEY];
    if (store === undefined) {
      store = { version: 1, revision: 0, videos: mergeVideos([], Array.isArray(stored.videos) ? stored.videos : []), undoRecords: [] };
      await storage.set({ [VIDEO_STORE_KEY]: store });
    } else { validateStore(store); store = clone(store); }
    if (command.type === 'read') return { snapshot: snapshot(store) };
    const now = Date.now();
    store.undoRecords = store.undoRecords.filter(record => record.expiresAt > now);
    let details = {};
    if (command.type === 'add' || command.type === 'enrich') {
      const previous = new Set(store.videos.map(v => v.url));
      const items = command.type === 'enrich' ? command.items.filter(v => previous.has(canonicalVideoUrl(v?.url))) : command.items;
      store.videos = mergeVideos(store.videos, items);
      const added = new Set(store.videos.filter(v => !previous.has(v.url)).map(v => v.url));
      store.undoRecords.forEach(record => { record.videos = record.videos.filter(v => !added.has(v.url)); });
      details = { added: added.size };
    } else if (command.type === 'select') {
      const urls = new Set(command.urls.map(canonicalVideoUrl));
      store.videos.forEach(v => { if (urls.has(v.url)) v.selected = command.selected; });
    } else if (command.type === 'delete') {
      const urls = new Set(command.urls.map(canonicalVideoUrl));
      const removed = store.videos.filter(v => urls.has(v.url));
      const positions = Object.fromEntries(removed.map(v => [v.url, store.videos.indexOf(v)]));
      store.videos = store.videos.filter(v => !urls.has(v.url));
      const token = removed.length ? crypto.randomUUID() : null;
      if (token) store.undoRecords.push({ token, expiresAt: now + UNDO_MS, videos: removed, positions });
      store.undoRecords = store.undoRecords.slice(-10);
      details = { deleted: removed.length, undoToken: token, undoExpiresAt: token ? now + UNDO_MS : null };
    } else if (command.type === 'undo') {
      const record = store.undoRecords.find(r => r.token === command.token);
      if (!record) throw new Error('삭제 취소 시간이 지났거나 이미 취소한 작업입니다.');
      const present = new Set(store.videos.map(v => v.url));
      const restorable = record.videos.filter(v => !present.has(v.url));
      const before = store.videos.length;
      for (const video of restorable) {
        if (store.videos.length >= MAX_VIDEOS) break;
        store.videos.splice(Math.min(record.positions[video.url], store.videos.length), 0, video);
      }
      store.undoRecords = store.undoRecords.filter(r => r !== record);
      details = { restored: store.videos.length - before, skipped: restorable.length - (store.videos.length - before) };
    }
    store.revision++;
    await storage.set({ [VIDEO_STORE_KEY]: store });
    return { snapshot: snapshot(store), ...details };
  };
  return command => {
    const result = queue.then(() => execute(command));
    queue = result.catch(() => {});
    return result;
  };
}

export function connectVideos(api, onSnapshot) {
  let revision = -1, disposed = false;
  const apply = value => {
    if (!disposed && value && Number.isSafeInteger(value.revision) && value.revision > revision && validVideos(value.videos)) {
      revision = value.revision;
      onSnapshot(snapshot(value));
    }
  };
  const changed = (changes, area) => { if (area === 'local') apply(changes[VIDEO_STORE_KEY]?.newValue); };
  api.storage.onChanged.addListener(changed);
  const send = async command => {
    const response = await api.runtime.sendMessage({ type: 'video-command', command });
    if (!response || response.error) throw new Error(response?.error || '저장 결과를 확인하지 못했습니다.');
    apply(response.snapshot);
    return response;
  };
  return {
    ready: send({ type: 'read' }),
    async command(command) {
      try { return await send(command); }
      catch (error) {
        try { await send({ type: 'read' }); } catch { error.message += ' 현재 저장 상태도 확인하지 못했습니다. 다시 시도하기 전에 패널을 다시 열어 주세요.'; }
        throw error;
      }
    },
    dispose() { disposed = true; api.storage.onChanged.removeListener(changed); },
  };
}
