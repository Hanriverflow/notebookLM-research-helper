const task = await taskSpace(5);
const page = task.page('p1');
const window = await task.cdp('Browser.getWindowForTarget', { targetId: page.targetId });
await task.cdp('Browser.setWindowBounds', { windowId: window.windowId, bounds: { windowState: 'normal' } });
await page.screenshot({ path: 'D:/Code/Projects/youtube_search/research-helper/qa/improvements/baseline.png' });
console.log(await page.snapshot({ scope: 'full_page' }));
