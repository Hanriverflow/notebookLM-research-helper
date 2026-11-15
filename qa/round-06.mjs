import { writeFile } from 'node:fs/promises';
const task = await taskSpace(2);
const page = task.page('p2');
console.log(await task.pages());
console.log(await page.snapshot({ scope: 'full_page' }));
const capture = await page.cdp('Page.captureScreenshot', { format: 'png' });
await writeFile('D:/Code/Projects/youtube_search/research-helper/qa/sources-preview.png', Buffer.from(capture.data, 'base64'));
console.log({ captured: true });
