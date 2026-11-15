import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readNotebook } from '../extension/page-actions.js';

const notebookId = '12345678-1234-1234-1234-123456789abc';
const url = `https://notebook.google.com/notebook/${notebookId}?authuser=1`;
function fixture({ data, http = 200, auth = true, href = url, malformed = false, retryAfter, afterFetch, afterText } = {}) {
  const calls = [];
  const ctx = vm.createContext({
    location: new URL(href), URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    window: { WIZ_global_data: auth ? { SNlM0e: 'TEST_TOKEN_ONLY', QrtxK: '0' } : {} },
    document: { documentElement: { lang: 'ko' } },
    fetch: async (endpoint, options) => {
      calls.push({ endpoint, options });
      const id = new URL('https://test' + endpoint).searchParams.get('rpcids');
      afterFetch?.(ctx);
      return { ok: http === 200, status: http, headers: { get: () => retryAfter }, text: async () => { afterText?.(ctx); return malformed ? '<html>Sign in</html>' : ")]}'\n123\n" + JSON.stringify([['wrb.fr', id, JSON.stringify(data)]]); } };
    },
  });
  return { calls, run: args => vm.runInContext(`(${readNotebook.toString()})`, ctx)(args) };
}

test('notebook sources are parsed with per-source title, kind, URL and account context', async () => {
  const f = fixture({ data: [['My Notebook', [[['s1'], 'A video', [null, null, null, null, null, ['https://www.youtube.com/watch?v=abcdefghijk', null, 'Channel']]], [['s2'], 'Document', []]]]] });
  const result = await f.run({ operation: 'list' });
  assert.equal(result.sources.length, 2); assert.equal(result.sources[0].kind, '유튜브');
  assert.equal(result.sources[0].channel, 'Channel'); assert.equal(result.sources[1].kind, '문서');
  assert.ok(result.notebook.url.endsWith('?authuser=1'));
  assert.match(f.calls[0].endpoint, /authuser=1/);
  assert.doesNotMatch(JSON.stringify(result), /TEST_TOKEN_ONLY/);
});

test('source export reads nested text without removing numeric lines', async () => {
  const f = fixture({ data: [null, null, null, [['Sales'], ['2026'], [['100']]]] });
  const result = await f.run({ operation: 'text', notebookId, sourceId: 's1' });
  assert.equal(result.text, 'Sales\n\n2026\n\n100');
  const body = JSON.parse(f.calls[0].options.body.get('f.req'));
  assert.equal(body[0][0][0], 'hizoJc');
});

test('changed notebook or unavailable login fails before any network request', async () => {
  const f = fixture({ data: [] });
  assert.match((await f.run({ operation: 'text', notebookId: 'another', sourceId: 's1' })).error, /바뀌었습니다/);
  assert.equal(f.calls.length, 0);
  const noAuth = fixture({ auth: false });
  assert.match((await noAuth.run({ operation: 'list' })).error, /로그인/); assert.equal(noAuth.calls.length, 0);
});

test('foreign origins are refused even if a notebook-looking pathname is present', async () => {
  const f = fixture({ href: `https://evil.example/notebook/${notebookId}` });
  assert.match((await f.run({ operation: 'list' })).error, /탭에서 실행/); assert.equal(f.calls.length, 0);
});

test('empty text, malformed responses and schema changes are explicit failures', async () => {
  assert.match((await fixture({ data: [null, null, null, []] }).run({ operation: 'text', sourceId: 's1' })).error, /본문이 없습니다/);
  assert.match((await fixture({ malformed: true }).run({ operation: 'list' })).error, /응답 형식/);
  assert.match((await fixture({ data: { changed: true } }).run({ operation: 'list' })).error, /소스 목록 형식/);
});

test('rate limiting produces a useful retry message', async () => {
  assert.match((await fixture({ http: 429 }).run({ operation: 'list' })).error, /잠시 후/);
});

test('every malformed or duplicate source row becomes a visible omission', async () => {
  const result = await fixture({ data: [['Notebook', [null, [[], 'Missing'], [['s1'], { unsafe: true }, []], [['s1'], 'Duplicate', []], [['s2'], 'Valid', [null, null, null, null, null, [{ unsafe: true }, null, {}]]]]]] }).run({ operation: 'list' });
  assert.equal(result.reportedCount, 5); assert.equal(result.sources.length, 2); assert.equal(result.omissions.length, 3);
  assert.equal(result.sources[0].title, '제목 없는 자료'); assert.equal(result.sources[1].url, ''); assert.equal(result.sources[1].channel, '');
  assert.equal(result.omissions[2].reason, '중복 소스 ID'); assert.equal(result.omissions[2].rowIndex, 3);
  const all = await fixture({ data: [['Notebook', [null, []]]] }).run({ operation: 'list' });
  assert.equal(all.sources.length, 0); assert.equal(all.omissions.length, 2); assert.equal(all.error, undefined);
});

test('Retry-After seconds and dates are preserved with bounded fallback backoff', async () => {
  const start = Date.now();
  const seconds = await fixture({ http: 429, retryAfter: '90' }).run({ operation: 'list' });
  assert.equal(seconds.code, 'RATE_LIMITED'); assert.ok(seconds.retryAt >= start + 90000);
  const date = new Date(start + 120000).toUTCString();
  const timed = await fixture({ http: 429, retryAfter: date }).run({ operation: 'list' });
  assert.equal(timed.retryAt, Date.parse(date));
  const fallback = await fixture({ http: 429, retryAfter: 'invalid' }).run({ operation: 'list', retryDelay: 900000 });
  assert.ok(fallback.retryAt >= start + 300000 && fallback.retryAt < Date.now() + 300100);
});

test('notebook and account guards reject changes before fetch and after the response body', async () => {
  const f = fixture({ data: [] });
  const mismatch = await f.run({ operation: 'list', context: { origin: 'https://notebooklm.google.com' } });
  assert.equal(mismatch.code, 'CONTEXT_CHANGED'); assert.equal(f.calls.length, 0);
  for (const hook of ['afterFetch', 'afterText']) {
    const result = await fixture({ data: [['Notebook', []]], [hook]: ctx => { ctx.location = new URL(url.replace('authuser=1', 'authuser=2')); } }).run({ operation: 'list' });
    assert.equal(result.code, 'CONTEXT_CHANGED'); assert.equal(result.sources, undefined);
  }
  const result = await fixture({ href: url.split('?')[0], data: [['Notebook', []]], afterText: ctx => { ctx.window.WIZ_global_data.QrtxK = '2'; } }).run({ operation: 'list' });
  assert.equal(result.code, 'CONTEXT_CHANGED');
});
