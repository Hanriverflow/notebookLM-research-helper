const task = await taskSpace('Research Pocket extension QA 2026-11-01');
const page = task.page('p1');
await page.goto('https://www.youtube.com/results?search_query=notebooklm');
console.log({ spaceId: task.spaceId, page: page.label });
console.log(await page.snapshot());
