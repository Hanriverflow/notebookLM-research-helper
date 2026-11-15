import { writeFile } from 'node:fs/promises';
const task = await taskSpace(5);
const page = task.page('p1');
const capture = await page.cdp('Page.captureScreenshot', { format: 'png' });
await writeFile('D:/Code/Projects/youtube_search/research-helper/qa/improvements/baseline.png', Buffer.from(capture.data, 'base64'));
console.log(await page.snapshot({ scope: 'full_page' }));
