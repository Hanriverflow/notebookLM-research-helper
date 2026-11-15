const task = await taskSpace('research-pocket-improvements-20261108');
const page = task.page('p1');
await page.goto('http://127.0.0.1:4318/?qa=1');
console.log({ spaceId: task.spaceId, page: page.label });
console.log(await page.snapshot({ scope: 'full_page' }));
