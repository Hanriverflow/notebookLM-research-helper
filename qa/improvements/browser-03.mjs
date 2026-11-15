const task = await taskSpace(5);
const page = task.page('p1');
console.log(await page.snapshot({ scope: 'full_page' }));
console.log(await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], scroll: [scrollX, scrollY], send: document.getElementById('send-notebook').getBoundingClientRect().toJSON() })));
try {
  console.log({ extension: await task.cdp('Extensions.loadUnpacked', { path: 'D:/Code/Projects/youtube_search/research-helper/extension' }) });
} catch (error) {
  console.log({ extensionInstall: 'unavailable', reason: error.message });
}
