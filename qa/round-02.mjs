import { collectYouTube } from '../extension/page-actions.js';
import { writeFile } from 'node:fs/promises';
const task = await taskSpace(2);
const result = await task.page('p1').evaluate(collectYouTube, { scroll: false });
await writeFile('D:/Code/Projects/youtube_search/research-helper/qa/live-youtube.json', JSON.stringify(result, null, 2));
console.log({ liveVideos: result.videos?.length, example: result.videos?.slice(0, 2), error: result.error });
try { console.log({ loadedExtension: await task.cdp('Extensions.loadUnpacked', { path: 'D:/Code/Projects/youtube_search/research-helper/extension' }) }); }
catch (error) { console.log({ extensionTestAvailability: String(error.message).slice(0, 500) }); }
const preview = await task.newPage();
await preview.cdp('Emulation.setDeviceMetricsOverride', { width: 420, height: 960, deviceScaleFactor: 1, mobile: false });
await preview.goto('http://127.0.0.1:4318/?qa=1');
console.log({ preview: preview.label });
console.log(await preview.snapshot());
