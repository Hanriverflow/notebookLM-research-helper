import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../extension/', import.meta.url));
const tools = fileURLToPath(new URL('./', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const base = pathname.startsWith('/__qa__/') ? tools : root;
    const relative = pathname.startsWith('/__qa__/') ? pathname.slice(8) : pathname.startsWith('/extension/') ? pathname.slice(11) : pathname === '/' ? 'panel.html' : pathname.slice(1);
    const file = path.resolve(base, relative);
    if (!file.startsWith(path.resolve(base) + path.sep)) throw new Error('Invalid path');
    let data = await readFile(file);
    if (file.endsWith('panel.html') && url.searchParams.get('qa') === '1') data = Buffer.from(data.toString().replace('<script type="module" src="panel.js"></script>', '<script type="module" src="/__qa__/mock-chrome.js"></script>'));
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4318, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:4318 — QA fixture: ?qa=1'));
