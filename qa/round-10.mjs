const task = await taskSpace(2);
const page = task.page('p2');
await page.goto('file:///D:/Code/Projects/youtube_search/research-helper/extension/help.html');
console.log({ guideTitle: await page.title(), guideUrl: await page.url() });
await task.finish({ keep: ['p2'] });
