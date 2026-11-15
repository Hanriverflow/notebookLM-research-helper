const task = await taskSpace(2);
const preview = task.page('p2');
await preview.click('#collect-videos');
await preview.waitForFunction(() => document.getElementById('video-count').textContent === '3' && document.getElementById('activity').hidden);
await preview.click('#video-list .item:nth-child(2) input');
await preview.reload();
await preview.waitForFunction(() => document.getElementById('video-selected').textContent === '2');
console.log({ persistedSelection: await preview.evaluate(() => document.getElementById('video-selected').textContent) });
await preview.click('#send-notebook');
await preview.waitForFunction(() => !document.getElementById('sources-view').hidden);
console.log(await preview.snapshot({ scope: 'full_page' }));
try { console.log({ loadedExtension: await task.page('p1').cdp('Extensions.loadUnpacked', { path: 'D:/Code/Projects/youtube_search/research-helper/extension' }) }); }
catch (error) { console.log({ extensionTestAvailability: String(error.message).slice(0, 350) }); }
