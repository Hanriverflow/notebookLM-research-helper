import { readFile, access, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../extension/', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, ...Object.values(manifest.icons)]) await access(path.join(root, file));
for (const file of await readdir(root)) {
  if (file.endsWith('.js')) {
    execFileSync(process.execPath, ['--check', path.join(root, file)]);
    const js = await readFile(path.join(root, file), 'utf8');
    for (const [, imported] of js.matchAll(/^import .+ from ['"]([^'"]+)['"]/gm)) await access(path.resolve(root, imported));
  }
  if (file.endsWith('.html')) {
    const html = await readFile(path.join(root, file), 'utf8');
    for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (!/^(https?:|#)/.test(url)) await access(path.join(root, url));
    if (/\son\w+=/.test(html)) throw new Error('Inline handlers violate extension CSP: ' + file);
  }
}
if (manifest.background.type !== 'module') throw new Error('The background command handler requires a module worker');
if (manifest.host_permissions.some(host => host.includes('*://') || host.includes('<all_urls>'))) throw new Error('Overbroad host permission');
console.log('Manifest, packaged assets, JavaScript syntax and extension CSP checks passed.');
