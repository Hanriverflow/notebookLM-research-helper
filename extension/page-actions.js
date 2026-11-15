// These functions are serialized by chrome.scripting. Keep their dependencies inside each function.
export function collectYouTube({ scroll = false, route } = {}) {
  if (location.origin !== 'https://www.youtube.com') return { error: '유튜브 탭을 먼저 열어 주세요.' };
  if (route && location.origin + location.pathname + location.search !== route) return { error: '유튜브 페이지가 바뀌어 수집을 멈췄습니다.', code: 'CONTEXT_CHANGED' };
  const search = location.pathname === '/results';
  const channel = /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(?:\/|$)/.test(location.pathname);
  const playlistId = new URLSearchParams(location.search).get('list');
  const playlist = location.pathname === '/playlist' || (location.pathname === '/watch' && playlistId);
  const single = location.pathname === '/watch' && !playlistId;
  if (!search && !channel && !playlist && !single) return { error: '검색 결과, 채널의 동영상 탭, 재생목록 또는 영상 페이지를 열어 주세요.' };
  if (channel && !/\/videos\/?$/.test(location.pathname)) return { error: '채널에서 ‘동영상’ 탭을 선택해 주세요.' };
  if (single) {
    const id = new URLSearchParams(location.search).get('v');
    if (!/^[\w-]{11}$/.test(id || '')) return { error: '영상 주소를 확인해 주세요.' };
    return { videos: [{ url: `https://www.youtube.com/watch?v=${id}`, title: document.querySelector('ytd-watch-metadata h1')?.textContent?.trim() || document.title.replace(/ - YouTube$/, ''), channel: document.querySelector('ytd-video-owner-renderer #channel-name a')?.textContent?.trim() || '' }], label: '현재 영상', single: true };
  }
  const selector = search
    ? 'ytd-search #primary ytd-video-renderer, ytd-search #primary yt-lockup-view-model'
    : channel
      ? 'ytd-browse ytd-rich-grid-renderer ytd-rich-item-renderer, ytd-browse ytd-grid-video-renderer'
      : 'ytd-playlist-video-list-renderer ytd-playlist-video-renderer, ytd-playlist-panel-renderer ytd-playlist-panel-video-renderer';
  const videos = new Map();
  for (const card of document.querySelectorAll(selector)) {
    if (card.closest('[hidden],[aria-hidden="true"],ytd-shelf-renderer,ytd-reel-shelf-renderer,ytd-ad-slot-renderer')) continue;
    if (card.querySelector('[overlay-style="SHORTS"],a[href*="/shorts/"]')) continue;
    const a = card.querySelector('a#video-title[href],a#video-title-link[href],a.yt-lockup-metadata-view-model__title[href]') || card.querySelector('a[href*="/watch?"]');
    if (!a || (a.checkVisibility && !a.checkVisibility({ visibilityProperty: true, opacityProperty: true }))) continue;
    const url = new URL(a.href, location.href);
    const id = url.searchParams.get('v');
    if (url.hostname !== 'www.youtube.com' || url.pathname !== '/watch' || !/^[\w-]{11}$/.test(id || '')) continue;
    if (playlistId && url.searchParams.has('list') && url.searchParams.get('list') !== playlistId) continue;
    const canonical = `https://www.youtube.com/watch?v=${id}`;
    if (!videos.has(canonical)) videos.set(canonical, {
      url: canonical,
      title: (a.getAttribute('title')?.trim() || card.querySelector('#video-title, .yt-lockup-metadata-view-model__title')?.textContent?.trim() || a.textContent?.trim() || canonical),
      channel: card.querySelector('#channel-name a, .yt-content-metadata-view-model__metadata-row a')?.textContent?.trim() || '',
    });
  }
  if (scroll) {
    const panel = document.querySelector('ytd-playlist-panel-renderer #items');
    if (location.pathname === '/watch' && panel) panel.scrollTo(0, panel.scrollHeight);
    else window.scrollTo(0, document.documentElement.scrollHeight);
  }
  return { videos: [...videos.values()], label: search ? '검색 결과' : channel ? '채널 동영상' : '재생목록' };
}

export async function readNotebook({ operation, notebookId, sourceId, context: expectedContext, retryDelay = 30000 } = {}) {
  const hosts = ['notebook.google.com', 'notebooklm.google.com'];
  if (location.protocol !== 'https:' || !hosts.includes(location.hostname)) return { error: 'Gemini 노트북 탭에서 실행해 주세요.' };
  const match = location.pathname.match(/\/notebook\/([0-9a-f-]{36})(?:\/|$)/i);
  if (!match) return { error: '홈 화면에서 사용할 노트북을 먼저 열어 주세요.' };
  const id = match[1];
  const contextError = () => ({ error: '노트북이나 계정이 바뀌었습니다. 소스 목록을 다시 불러와 주세요.', code: 'CONTEXT_CHANGED' });
  if (notebookId && notebookId !== id) return contextError();
  const W = window.WIZ_global_data || {};
  if (!W.SNlM0e) return { error: '로그인과 로딩이 끝났는지 확인하고, 노트북을 새로고침한 뒤 다시 시도해 주세요.' };
  if (!['list', 'text'].includes(operation)) return { error: '지원하지 않는 작업입니다.' };
  const getContext = () => {
    const current = window.WIZ_global_data || {};
    const urlAuthuser = new URLSearchParams(location.search).get('authuser') || '';
    return { origin: location.origin, notebookId: location.pathname.match(/\/notebook\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] || '', authuser: urlAuthuser || (/^\d{1,2}$/.test(String(current.QrtxK)) ? String(current.QrtxK) : ''), urlAuthuser };
  };
  const context = getContext();
  if (expectedContext && Object.entries(expectedContext).some(([key, value]) => context[key] !== value)) return contextError();
  const contextChanged = () => Object.entries(context).some(([key, value]) => getContext()[key] !== value);
  const authUser = context.authuser;
  const rpcId = operation === 'list' ? 'rLM1Ne' : 'hizoJc';
  if (operation === 'text' && (typeof sourceId !== 'string' || !sourceId)) return { error: '소스를 다시 선택해 주세요.' };
  const args = operation === 'list' ? [id] : [[sourceId], [2], [2, null, [1], [1, null, null, null, null, null, null, null, null, null, [1, 3]]]];
  const params = new URLSearchParams({ rpcids: rpcId, 'source-path': `/notebook/${id}`, bl: W.cfb2h || '', 'f.sid': W.FdrFJe || '', hl: document.documentElement.lang || 'ko', _reqid: String(Math.floor(Math.random() * 800000) + 100000), rt: 'c' });
  if (authUser) params.set('authuser', authUser);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch('/_/LabsTailwindUi/data/batchexecute?' + params, {
      method: 'POST', credentials: 'include', signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
      body: new URLSearchParams({ 'f.req': JSON.stringify([[[rpcId, JSON.stringify(args), null, 'generic']]]), at: W.SNlM0e }),
    });
    if (contextChanged()) return contextError();
    if (!res.ok) {
      if (res.status === 429) {
        const retryAfter = res.headers?.get('Retry-After');
        const serverTime = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter || '');
        const delay = Math.min(300000, Math.max(30000, Number(retryDelay) || 30000));
        return { error: '요청이 많습니다. 잠시 후 표시된 시각에 다시 시도해 주세요.', code: 'RATE_LIMITED', retryAt: Math.max(Date.now() + delay, Number.isFinite(serverTime) ? serverTime : 0) };
      }
      return { error: `자료를 읽지 못했습니다 (HTTP ${res.status}). 새로고침 후 다시 시도해 주세요.`, code: 'HTTP_ERROR' };
    }
    let data;
    const responseText = await res.text();
    if (contextChanged()) return contextError();
    for (const line of responseText.split('\n')) {
      if (!line.trim().startsWith('[[')) continue;
      let chunk;
      try { chunk = JSON.parse(line); } catch { continue; }
      for (const row of chunk) {
        if (row?.[0] === 'wrb.fr' && row[1] === rpcId && row[2]) {
          try { data = JSON.parse(row[2]); } catch {}
        }
      }
    }
    if (!data) return { error: '노트북의 응답 형식을 읽지 못했습니다. 새로고침 후에도 같으면 확장 프로그램 업데이트가 필요합니다.' };
    if (operation === 'text') {
      if (!Array.isArray(data) || !Array.isArray(data[3])) return { error: '소스 본문 형식이 바뀌었거나 아직 처리 중입니다. 잠시 후 다시 시도해 주세요.' };
      const strings = [];
      const collect = value => { if (typeof value === 'string') strings.push(value); else if (Array.isArray(value)) value.forEach(collect); };
      collect(data[3]);
      const text = strings.join('\n\n').trim();
      return text ? { text } : { error: '본문이 없습니다. 노트북에서 이 소스의 처리 상태를 확인해 주세요.' };
    }
    const top = data?.[0];
    if (!Array.isArray(top) || !Array.isArray(top[1])) return { error: '소스 목록 형식이 바뀌었거나 아직 로딩 중입니다. 새로고침 후 다시 시도해 주세요.' };
    const findUrl = (value, depth = 0) => {
      if (typeof value === 'string') return /^https?:\/\//.test(value) ? value : '';
      if (!Array.isArray(value) || depth > 3) return '';
      for (const item of value) { const found = findUrl(item, depth + 1); if (found) return found; }
      return '';
    };
    const safeText = (value, limit, fallback = '') => typeof value === 'string' ? value.trim().slice(0, limit) || fallback : fallback;
    const safeUrl = value => {
      if (typeof value !== 'string' || value.length > 4096) return '';
      try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : ''; } catch { return ''; }
    };
    const sources = [], omissions = [], ids = new Set();
    for (const [rowIndex, source] of top[1].entries()) {
      const sid = source?.[0]?.[0];
      const title = safeText(source?.[1], 500, '제목 없는 자료');
      if (!Array.isArray(source) || !Array.isArray(source[0]) || typeof sid !== 'string' || !sid.trim() || sid.length > 500 || ids.has(sid)) {
        omissions.push({ rowIndex, title, reason: ids.has(sid) ? '중복 소스 ID' : '소스 ID를 확인하지 못함' });
        continue;
      }
      ids.add(sid);
      const meta = Array.isArray(source[2]) ? source[2] : [];
      const candidate = Array.isArray(meta[5]) ? safeUrl(meta[5][0]) : '';
      const youtube = candidate && ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(new URL(candidate).hostname) ? meta[5] : null;
      const url = safeUrl(youtube?.[0] || findUrl(meta));
      sources.push({ id: sid, title, url, channel: safeText(youtube?.[2], 200), kind: youtube ? '유튜브' : meta[4] === 3 ? 'PDF' : url ? '웹사이트' : '문서' });
    }
    return { notebook: { id, title: safeText(top[0], 500, '제목 없는 노트북'), url: `${context.origin}/notebook/${id}${authUser ? '?authuser=' + encodeURIComponent(authUser) : ''}`, context, reportedCount: top[1].length, omissions }, sources, omissions, reportedCount: top[1].length };
  } catch (error) {
    if (contextChanged()) return contextError();
    return { error: error.name === 'AbortError' ? '응답 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.' : '네트워크 연결을 확인하고 다시 시도해 주세요.' };
  } finally { clearTimeout(timeout); }
}
