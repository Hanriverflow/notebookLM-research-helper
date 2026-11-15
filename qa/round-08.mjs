const task = await taskSpace(2);
const page = task.page('p2');
console.log(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth })));
help('page.screenshot');
