export const NOTEBOOK_HOSTS = new Set(['notebook.google.com', 'notebooklm.google.com']);

export function pageKind(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return 'other';
    if (url.hostname === 'www.youtube.com') return 'youtube';
    if (NOTEBOOK_HOSTS.has(url.hostname)) {
      return /\/notebook\/[0-9a-f-]{36}(?:\/|$)/i.test(url.pathname) ? 'notebook' : 'notebook-home';
    }
  } catch {}
  return 'other';
}

export function canonicalVideoUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    let id;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    else if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
    }
    return /^[\w-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch { return null; }
}

export function mergeVideos(existing, incoming, limit = 500) {
  const entries = new Map();
  for (const video of [...existing, ...incoming]) {
    const url = canonicalVideoUrl(video?.url);
    if (!url) continue;
    const normalized = {
      url,
      title: typeof video.title === 'string' ? video.title.trim().slice(0, 500) || url : url,
      channel: typeof video.channel === 'string' ? video.channel.trim().slice(0, 200) : '',
      selected: video.selected !== false,
    };
    const current = entries.get(url);
    if (current) {
      if (canonicalVideoUrl(current.title) === url && canonicalVideoUrl(normalized.title) !== url) current.title = normalized.title;
      if (!current.channel) current.channel = normalized.channel;
    } else if (entries.size < limit) entries.set(url, normalized);
  }
  return [...entries.values()];
}

export function linksFromText(text) {
  return mergeVideos([], (text.match(/https?:\/\/[^\s<>"']+/g) || []).map(url => ({ url })));
}

const heading = text => String(text || '').replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>])/g, '\\$1');
const safeUrl = value => {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; }
  catch { return ''; }
};

export function composeMarkdown(notebook, sources, date = new Date()) {
  const chosen = sources.filter(s => s.selected);
  const done = chosen.filter(s => s.lastSuccess?.text?.trim());
  const missing = chosen.filter(s => !done.includes(s));
  const omissions = notebook.omissions || [];
  const lines = [
    `# ${heading(notebook.title)}`, '',
    `- 추출 시각: ${date.toISOString()}`,
    `- 노트북: ${safeUrl(notebook.url)}`,
    `- 선택한 소스: ${chosen.length}개 / 본문 저장: ${done.length}개`,
    `- 목록에서 확인하지 못한 소스: ${omissions.length}개`,
    '- 본문은 노트북에 저장된 텍스트입니다. 동영상 화면·이미지·원본 파일은 포함하지 않습니다.', '',
  ];
  chosen.forEach((source, index) => {
    if (!done.includes(source)) return;
    lines.push('---', '', `## ${index + 1}. ${heading(source.title)}`, '', `- 종류: ${source.kind || '자료'}`);
    if (safeUrl(source.url)) lines.push(`- 주소: ${safeUrl(source.url)}`);
    if (source.channel) lines.push(`- 채널: ${heading(source.channel)}`);
    lines.push(`- 본문 추출 시각: ${source.lastSuccess.extractedAt}`);
    if (source.attempt.state !== 'done') lines.push(`- 주의: 이전에 추출한 본문입니다. ${source.attempt.state === 'cancelled' ? '최근 갱신이 중단되었습니다.' : '최근 갱신에 실패했습니다.'} ${heading(source.attempt.error || '')}`.trim());
    lines.push('', source.lastSuccess.text.replace(/\r\n/g, '\n').trim(), '');
  });
  if (missing.length) {
    lines.push('---', '', '## 추출하지 못한 소스', '');
    missing.forEach(s => lines.push(`- ${heading(s.title)}: ${heading(s.attempt.error || (s.attempt.state === 'cancelled' ? '추출 중단' : '아직 추출하지 않음'))}`));
  }
  if (omissions.length) {
    lines.push('---', '', '## 소스 목록에서 누락된 항목', '');
    omissions.forEach(s => lines.push(`- ${s.rowIndex + 1}번째 항목 · ${heading(s.title)}: ${heading(s.reason)}`));
  }
  return lines.join('\n') + '\n';
}

export function exportFilename(title, date = new Date()) {
  const name = String(title || '노트북').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70).replace(/[. ]+$/, '') || '노트북';
  const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  return `${name}_자료_${stamp}.md`;
}
