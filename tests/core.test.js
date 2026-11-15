import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalVideoUrl, mergeVideos, linksFromText, composeMarkdown, exportFilename, pageKind } from '../extension/core.js';

test('tracking and playlist parameters are removed; false hosts and shorts are rejected', () => {
  assert.equal(canonicalVideoUrl('https://youtu.be/abcdefghijk?t=10'), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(canonicalVideoUrl('https://www.youtube.com/watch?v=abcdefghijk&list=PLxxx'), 'https://www.youtube.com/watch?v=abcdefghijk');
  for (const url of ['https://youtube.com.attacker.test/watch?v=abcdefghijk', 'javascript:alert(1)', 'https://www.youtube.com/shorts/abcdefghijk', 'https://youtu.be/short']) assert.equal(canonicalVideoUrl(url), null);
});

test('collecting a second page preserves choices, deduplicates and bounds stored items', () => {
  const first = [{ url: 'https://youtu.be/abcdefghijk', title: 'First', selected: false }];
  const second = [{ url: 'https://youtube.com/watch?v=abcdefghijk', title: 'Duplicate' }, { url: 'https://youtu.be/12345678901', title: 'Next' }];
  const result = mergeVideos(first, second);
  assert.equal(result.length, 2); assert.equal(result[0].selected, false); assert.equal(result[0].title, 'First');
  assert.equal(mergeVideos(first, second, 1).length, 1);
});

test('manual input accepts multiple links but never playlist or channel URLs', () => {
  assert.equal(linksFromText('https://youtu.be/abcdefghijk\nhttps://www.youtube.com/watch?v=12345678901\nhttps://www.youtube.com/@channel/videos').length, 2);
});

test('export keeps numeric paragraphs, excludes deselected text, and reports partial failures', () => {
  const result = composeMarkdown({ title: 'Research\n# unsafe', url: 'https://notebook.google.com/notebook/test' }, [
    { title: 'First', selected: true, attempt: { state: 'done' }, lastSuccess: { text: 'Revenue\n\n2026\n\n100', extractedAt: '2026-11-01T02:00:00Z' }, url: 'https://example.com', kind: '문서' },
    { title: 'Second', selected: true, attempt: { state: 'error', error: 'No transcript' }, lastSuccess: null },
    { title: 'Secret', selected: false, attempt: { state: 'done' }, lastSuccess: { text: 'DO NOT EXPORT', extractedAt: '2026-11-01T02:00:00Z' } },
  ], new Date('2026-11-01T03:00:00Z'));
  assert.match(result, /Revenue\n\n2026\n\n100/);
  assert.match(result, /추출하지 못한 소스/); assert.match(result, /Second: No transcript/);
  assert.doesNotMatch(result, /DO NOT EXPORT/); assert.match(result, /선택한 소스: 2개 \/ 본문 저장: 1개/);
});

test('placeholder metadata fills at the cap without changing choices or valid titles', () => {
  const result = mergeVideos([{ url: 'https://youtu.be/abcdefghijk', selected: false }], [
    { url: 'https://youtu.be/12345678901', title: 'No room' },
    { url: 'https://youtu.be/abcdefghijk', title: 'Actual title', channel: 'Channel' },
  ], 1);
  assert.deepEqual(result, [{ url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Actual title', channel: 'Channel', selected: false }]);
  assert.equal(mergeVideos(result, [{ url: result[0].url, title: 'Replacement', channel: 'Other' }])[0].title, 'Actual title');
  assert.equal(mergeVideos([], [{ url: result[0].url, title: {}, channel: [] }])[0].title, result[0].url);
});

test('old successful text and omissions remain explicit in failed or cancelled exports', () => {
  for (const state of ['error', 'cancelled']) {
    const result = composeMarkdown({ title: 'Research', omissions: [{ rowIndex: 2, title: 'Broken', reason: 'ID 없음' }] }, [{
      title: 'Retained', selected: true, lastSuccess: { text: 'Earlier text', extractedAt: '2026-11-01T00:00:00Z' }, attempt: { state, error: 'Request ended' },
    }]);
    assert.match(result, /Earlier text/); assert.match(result, /2026-11-01T00:00:00Z/);
    assert.match(result, /이전에 추출한 본문/); assert.match(result, /3번째 항목 · Broken: ID 없음/);
  }
  assert.match(composeMarkdown({ title: 'Only omissions', omissions: [{ rowIndex: 0, title: 'Unknown', reason: 'ID 없음' }] }, []), /1번째 항목 · Unknown: ID 없음/);
});

test('export filenames are Windows-safe and keep a readable title', () => {
  const result = exportFilename('A/B:C*D?E"F<G>H|I', new Date(2026, 10, 1));
  assert.doesNotMatch(result, /[\\/:*?"<>|]/); assert.ok(result.endsWith('_자료_2026-11-01.md'));
});

test('page targeting accepts only HTTPS supported hosts and full notebook identifiers', () => {
  assert.equal(pageKind('https://notebook.google.com/notebook/12345678-1234-1234-1234-123456789abc?authuser=1'), 'notebook');
  assert.equal(pageKind('https://notebooklm.google.com/'), 'notebook-home');
  assert.equal(pageKind('https://notebook.google.com.attacker.test/'), 'other');
  assert.equal(pageKind('chrome://extensions'), 'other');
});
